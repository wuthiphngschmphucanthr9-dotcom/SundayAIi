// Vercel Serverless Function (Gemini Real-time Streaming)
const SYSTEM = `คุณคือวิศวกรซอฟต์แวร์อาวุโสและผู้ช่วยอัจฉริยะ SundayAI ตอบคำถามให้ตรงประเด็น ครบถ้วน และทำงานได้จริง

กฎเหล็กที่ต้องปฏิบัติตามอย่างเคร่งครัดทุกครั้ง:
1. อ่านคำสั่งให้ครบทุกข้อ แล้วทำทุกข้อที่ขอ ห้ามข้าม ห้ามเปลี่ยนโจทย์ และห้ามปฏิเสธการเขียนโค้ด
2. หากผู้ใช้สั่งให้เขียนโค้ด สร้างแอป สร้างเว็บ หรือแก้โค้ด **ต้องลงมือเขียนโค้ดให้ทันที** ห้ามอธิบายแค่แนวคิดแล้วไม่ให้โค้ด
3. โค้ดต้องสมบูรณ์ 100% รันได้จริง ห้ามย่อโค้ด ห้ามละไว้ในฐานที่เข้าใจ และห้ามใช้คอมเมนต์อย่าง //... หรือ /* โค้ดส่วนที่เหลือ */ เด็ดขาด
4. โค้ดทุกชิ้นต้องอยู่ใน Markdown code fence ที่ระบุภาษาชัดเจน (เช่น \`\`\`html, \`\`\`javascript, \`\`\`python)
5. ใช้ภาษา เฟรมเวิร์ก ชื่อตัวแปร และสไตล์ตามที่ผู้ใช้ระบุอย่างตรงตัว หากคำสั่งกำกวม ให้ตีความอย่างสมเหตุสมผลแล้วลงมือเขียนโค้ดทันที
6. ตอบเป็นภาษาเดียวกับผู้ใช้ (ส่วนใหญ่ภาษาไทย)
7. ใส่อีโมจิที่เหมาะสมประกอบหัวข้อหรือคำอธิบายนอกโค้ดอย่างพอดีเพื่อให้อ่านง่าย (ห้ามใส่อีโมจิในบล็อกโค้ดเด็ดขาด ยกเว้นโค้ด UI ที่จำเป็น)`;

const FAST = process.env.GEMINI_FAST_MODEL || 'gemini-3.5-flash-lite';
const SMART = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const FALLBACK_MODELS = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];

const SAFETY = ['HARASSMENT', 'HATE_SPEECH', 'SEXUALLY_EXPLICIT', 'DANGEROUS_CONTENT'].map(c => ({
  category: 'HARM_CATEGORY_' + c,
  threshold: 'BLOCK_ONLY_HIGH'
}));

const RETRY_PROMPT = '\n\n[คำสั่งเพิ่มเติม: กรุณาตอบคำขอข้างต้นด้วยโค้ดที่สมบูรณ์และรันได้จริงทันที ห้ามย่อเด็ดขาด]';

const BEAST = `โหมดโหด (Beast Mode - ระดับ Senior Principal Engineer):
1. เขียนโค้ดระดับโปรดักชัน โครงสร้างสะอาด อ่านง่าย และต่อยอดได้จริง
2. จัดการ Edge cases, Error handling และอินพุตแปลกๆ ให้ครบถ้วน
3. ใส่ใจประสิทธิภาพสูงสุด (Performance & Optimization)
4. ถ้าเป็นหน้าเว็บ เกม หรือแอป ให้ทำให้อลังการ ดีไซน์ทันสมัยระดับมืออาชีพ แอนิเมชันลื่นไหล และรองรับมือถือ (Responsive) ในไฟล์เดียวหรือครบทุกไฟล์ที่ขอ
5. ใส่คอมเมนต์ภาษาไทยอธิบายเฉพาะจุดที่ซับซ้อนหรือสำคัญ
6. ปิดท้ายด้วยสรุป 3-5 ข้อพร้อมอีโมจินำหน้าหัวข้อ อธิบายจุดเด่นและวิธีนำไปใช้งาน`;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'ใช้ได้เฉพาะ POST' });
  }

  // รับคีย์ Gemini จาก Header (ไม่เก็บลงฐานข้อมูล)
  const key = String(req.headers['x-user-key'] || '').trim();
  if (!key) {
    return res.status(401).json({ error: 'กรุณาใส่ Gemini API Key ก่อนเริ่มแชท' });
  }

  let body = {};
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch (e) {
    return res.status(400).json({ error: 'รูปแบบข้อมูล JSON ไม่ถูกต้อง' });
  }

  const messages = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
  const valid = messages.length > 0 &&
    messages.every(m => m && (m.role === 'user' || m.role === 'assistant') &&
    typeof m.content === 'string' && m.content.trim().length > 0 && m.content.length <= 150000);

  if (!valid || messages[messages.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'รูปแบบประวัติข้อความไม่ถูกต้อง' });
  }

  const mode = body.mode === 'beast' ? 'beast' : body.mode === 'smart' ? 'smart' : 'fast';
  const beast = mode === 'beast';
  const smart = mode === 'smart';

  // จัดสรร thinkingBudget ให้เหมาะสมกับแต่ละโหมด เพื่อไม่ให้ AI ตัดตอนหรือเขียนโค้ดไม่ออก
  // fast: 0 (ตอบทันที), smart: 1024 (คิดวางโครงสร้างโค้ดได้), beast: 4096 (คิดเชิงลึกสำหรับงานซับซ้อน)
  const budget = beast ? 4096 : smart ? 1024 : 0;

  const build = (thinkingBudget, extra) => {
    const config = {
      temperature: beast ? 0.5 : 0.4, // ลด temperature ลงเล็กน้อยเพื่อให้เขียนโค้ดแม่นยำและไม่หลุดกรอบ
      maxOutputTokens: beast ? 32768 : 16384, // ขยายเพดานความยาวโค้ดให้เขียนไฟล์ใหญ่ได้จบในครั้งเดียว
    };

    if (thinkingBudget > 0) {
      config.thinkingConfig = { thinkingBudget };
    } else {
      config.thinkingConfig = { thinkingBudget: 0 };
    }

    return {
      systemInstruction: {
        parts: [{ text: beast ? SYSTEM + '\n\n' + BEAST : SYSTEM }]
      },
      contents: messages.map((m, i) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        // ส่งข้อความผู้ใช้ตรงๆ ไม่เอา NUDGE ที่ทำให้สับสนไปต่อท้าย ยกเว้นกรณีสั่ง Retry
        parts: [{ text: i === messages.length - 1 ? m.content + (extra || '') : m.content }],
      })),
      generationConfig: config,
      safetySettings: SAFETY,
    };
  };

  const urlFor = m => `https://generativelanguage.googleapis.com/v1beta/models/${m}:streamGenerateContent?alt=sse`;

  async function open(basePayload, initialModel) {
    const queue = [initialModel, ...FALLBACK_MODELS.filter(m => m !== initialModel)];
    let r;

    for (let i = 0; i < queue.length; i++) {
      const model = queue[i];
      const payload = JSON.parse(JSON.stringify(basePayload));
      let retriedSameModel = false;

      while (true) {
        const controller = new AbortController();
        // เพิ่ม Timeout เป็น 30 วินาที รองรับกรณีโหมด beast/smart ที่คิดโครงสร้างโค้ดนานขึ้น
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        try {
          r = await fetch(urlFor(model), {
            method: 'POST',
            headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });
        } catch (err) {
          clearTimeout(timeoutId);
          break;
        } finally {
          clearTimeout(timeoutId);
        }

        if (r.ok) return r;

        if (r.status === 400 && !retriedSameModel) {
          const j = await r.clone().json().catch(() => ({}));
          const errMsg = (j.error && j.error.message) || '';
          if (/api key/i.test(errMsg)) return r;

          if (payload.generationConfig && payload.generationConfig.thinkingConfig) {
            delete payload.generationConfig.thinkingConfig;
            retriedSameModel = true;
            continue;
          }
        }

        if (r.status === 404 || r.status === 503 || r.status === 429 || r.status === 400) {
          break;
        }

        return r;
      }
    }
    return r;
  }

  async function pump(r) {
    const decoder = new TextDecoder();
    const reader = r.body.getReader();
    let buf = '', got = false, trunc = false, reason = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const j = line.slice(5).trim();
        if (!j || j === '[DONE]') continue;
        try {
          const d = JSON.parse(j);
          if (d.promptFeedback && d.promptFeedback.blockReason) {
            reason = d.promptFeedback.blockReason;
          }
          const c = (d.candidates || [])[0];
          if (c) {
            const parts = (c.content && c.content.parts) || [];
            // กรองเฉพาะส่วนที่เป็นคำตอบจริง (ไม่เอาส่วน thought)
            const t = parts.filter(p => !p.thought).map(p => p.text || '').join('');
            if (t) {
              got = true;
              res.write(t);
            }
            if (c.finishReason === 'MAX_TOKENS') trunc = true;
            else if (c.finishReason && c.finishReason !== 'STOP') reason = c.finishReason;
          }
        } catch (e) {
          // ข้าม chunk ที่ JSON ยังมาไม่ครบ
        }
      }
    }
    return { got, trunc, reason };
  }

  try {
    // หากผู้ใช้สั่งให้เขียนโค้ดในโหมด fast ให้ขยับไปใช้โมเดล SMART อัตโนมัติเพื่อคุณภาพโค้ดที่ดีกว่า
    const lastUserMsg = messages[messages.length - 1].content;
    const isCodeRequest = /(เขียนโค้ด|สร้างเว็บ|สร้างเกม|สร้างแอป|แก้โค้ด|code|html|css|js|javascript|python|react|api|sql|script|function)/i.test(lastUserMsg);
    const selectedModel = (mode === 'fast' && !isCodeRequest) ? FAST : SMART;
    const effectiveBudget = (mode === 'fast' && isCodeRequest) ? 512 : budget;

    const r = await open(build(effectiveBudget), selectedModel);

    if (!r || !r.ok) {
      const data = r ? await r.json().catch(() => ({})) : {};
      const msg = (data.error && data.error.message) || '';
      const status = r ? r.status : 502;
      console.error('gemini error', status, msg);

      const bad = status === 401 || status === 403 || (status === 400 && /api key/i.test(msg));
      if (bad) return res.status(401).json({ error: 'คีย์ Gemini ใช้ไม่ได้ กรุณาตรวจสอบแล้วใส่ใหม่' });
      if (status === 429) return res.status(429).json({ error: 'โควตาของคีย์นี้เต็มหรือส่งถี่เกินไป รอสักครู่แล้วลองใหม่' });
      if (status === 503) return res.status(503).json({ error: 'เซิร์ฟเวอร์ AI กำลังมีผู้ใช้งานหนาแน่นชั่วคราว กรุณาลองใหม่อีกครั้งในอีกสักครู่' });
      return res.status(502).json({ error: `AI ขัดข้อง (${status}): ${msg || 'ลองใหม่อีกครั้ง'}` });
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');

    let out = await pump(r);
    if (!out.got && out.reason !== 'SAFETY' && out.reason !== 'PROHIBITED_CONTENT') {
      const r2 = await open(build(512, RETRY_PROMPT), SMART);
      if (r2 && r2.ok) out = await pump(r2);
    }
    if (!out.got) {
      res.write('ขออภัย AI ไม่สามารถตอบคำขอนี้ได้' + (out.reason ? ` (เหตุผล: ${out.reason})` : '') + '\n\nลองปรับคำถามให้ชัดเจนขึ้นแล้วส่งใหม่ครับ');
    }
    if (out.trunc) res.write('\n\n⚠️ (ข้อความถูกตัดเนื่องจากยาวเกินขีดจำกัด พิมพ์ "เขียนต่อ" เพื่อให้ AI เขียนส่วนที่เหลือครับ)');
    return res.end();
  } catch (e) {
    console.error('chat error', e && e.message);
    if (!res.headersSent) {
      return res.status(502).json({ error: 'เชื่อมต่อ AI ไม่ได้หรือหมดเวลาการรอ' });
    }
    return res.end();
  }
};
