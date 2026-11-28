// Vercel Serverless Function (Gemini Real-time Streaming - Full Output Enforcement)
const SYSTEM = `คุณคือวิศวกรซอฟต์แวร์ระดับ Principal Engineer และผู้ช่วยอัจฉริยะ SundayAI

[กฎเหล็กสูงสุด - ห้ามฝ่าฝืนโดยเด็ดขาด]
1. **ห้ามขี้เกียจและห้ามย่อโค้ด (NO LAZY CODING):** ต้องเขียนโค้ดออกมาให้ครบทุกบรรทัด ตั้งแต่บรรทัดแรกจนถึงบรรทัดสุดท้าย ห้ามใช้คำว่า "// ... โค้ดส่วนที่เหลือ", "// TODO", "/* ส่วนนี้เหมือนเดิม */" หรือละส่วนใดส่วนหนึ่งไว้เด็ดขาด
2. **ทำตามคำสั่งทุกข้อ 100%:** อ่านความต้องการของผู้ใช้ทีละข้ออย่างละเอียด แล้วทำให้ครบทุกฟีเจอร์ ทุกเงื่อนไข ทุกไฟล์ที่ระบุ ห้ามตัดทอนหรือเปลี่ยนสเปกเอง
3. **พร้อมรันทันที (Production-Ready):** โค้ดทุกชิ้นต้องสมบูรณ์ สามารถคัดลอกไปรันหรือ Deploy ได้ทันทีโดยไม่มีตัวแปรที่ยังไม่ประกาศ หรือฟังก์ชันที่เขียนไม่เสร็จ
4. **รูปแบบการตอบ:** ใส่โค้ดทั้งหมดใน Markdown Code Block ที่ระบุภาษาชัดเจน (เช่น \`\`\`html, \`\`\`javascript, \`\`\`python) หากขอเป็นไฟล์เดียว (เช่น เว็บแอป HTML) ให้รวม HTML, CSS และ JavaScript ไว้ในไฟล์เดียวอย่างสมบูรณ์
5. **ภาษาและสไตล์:** อธิบายเป็นภาษาไทยที่กระชับ ชัดเจน ใส่อีโมจิประกอบหัวข้อนอกโค้ดอย่างพอดี (ห้ามใส่อีโมจิในโค้ด ยกเว้นส่วน UI ที่ผู้ใช้ต้องการ)`;

const FAST = process.env.GEMINI_FAST_MODEL || 'gemini-3.5-flash-lite';
const SMART = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const FALLBACK_MODELS = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];

const SAFETY = ['HARASSMENT', 'HATE_SPEECH', 'SEXUALLY_EXPLICIT', 'DANGEROUS_CONTENT'].map(c => ({
  category: 'HARM_CATEGORY_' + c,
  threshold: 'BLOCK_ONLY_HIGH'
}));

// คำสั่งกำกับท้ายข้อความผู้ใช้ เพื่อบังคับให้โมเดลเขียนโค้ดออกมาให้ครบทุกบรรทัดไม่ย่อ
const STRICT_CODE_DIRECTIVE = `\n\n[ข้อกำหนดการส่งมอบงาน: กรุณาเขียนโค้ดฉบับเต็ม 100% ครบทุกบรรทัดและครบทุกข้อตามที่สั่งข้างต้น ห้ามย่อ ห้ามตัดตอน และห้ามใช้คอมเมนต์ละโค้ดเด็ดขาด]`;
const RETRY_PROMPT = `\n\n[ระบบแจ้งเตือน: คำตอบก่อนหน้าไม่สมบูรณ์ กรุณาเขียนโค้ดฉบับเต็มทั้งหมดตั้งแต่ต้นจนจบให้ครบทุกฟังก์ชันทันที]`;

const BEAST = `โหมดโหด (BEAST MODE - จัดเต็มระดับสูงสุด):
- ออกแบบสถาปัตยกรรมโค้ดให้สมบูรณ์แบบที่สุด ครบทุกฟีเจอร์ที่สั่งและเพิ่มรายละเอียดที่ช่วยให้ใช้งานได้จริงอย่างลื่นไหล
- จัดการ Error handling, Edge cases และ Validation ครบทุกจุด
- หากเป็นหน้าเว็บ เกม หรือแอปพลิเคชัน ต้องทำ UI/UX ให้สวยงามอลังการ มีแอนิเมชันลื่นไหล รองรับทั้งคอมพิวเตอร์และมือถือ (Responsive) และทำงานได้จริงครบทุกปุ่มทุกฟังก์ชัน
- เขียนโค้ดให้ครบทุกบรรทัด 100% ห้ามตัดทอนแม้แต่บรรทัดเดียว
- ใส่คอมเมนต์ภาษาไทยอธิบายโครงสร้างสำคัญ
- ปิดท้ายด้วยสรุปจุดเด่นและวิธีใช้งาน 3-5 ข้อพร้อมอีโมจิ`;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'ใช้ได้เฉพาะ POST' });
  }

  // 1. ตรวจสอบ Gemini API Key จาก Header
  const key = String(req.headers['x-user-key'] || '').trim();
  if (!key) {
    return res.status(401).json({ error: 'กรุณาใส่ Gemini API Key ก่อนเริ่มแชท' });
  }

  // 2. แปลงข้อมูล Body JSON
  let body = {};
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch (e) {
    return res.status(400).json({ error: 'รูปแบบข้อมูล JSON ไม่ถูกต้อง' });
  }

  // 3. ตรวจสอบความถูกต้องของประวัติแชท (เก็บสูงสุด 16 ข้อความล่าสุดเพื่อไม่ให้ลืมบริบท)
  const messages = Array.isArray(body.messages) ? body.messages.slice(-16) : [];
  const valid = messages.length > 0 &&
    messages.every(m => m && (m.role === 'user' || m.role === 'assistant') &&
    typeof m.content === 'string' && m.content.trim().length > 0 && m.content.length <= 200000);

  if (!valid || messages[messages.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'รูปแบบประวัติข้อความไม่ถูกต้อง' });
  }

  const mode = body.mode === 'beast' ? 'beast' : body.mode === 'smart' ? 'smart' : 'fast';
  const beast = mode === 'beast';
  const smart = mode === 'smart';

  // ตรวจจับว่าคำสั่งล่าสุดเป็นการขอเขียนโค้ด / สร้างเว็บ / สร้างแอป / แก้โค้ด หรือไม่
  const lastUserMsg = messages[messages.length - 1].content;
  const isCodeRequest = /(เขียนโค้ด|สร้างเว็บ|สร้างเกม|สร้างแอป|แก้โค้ด|เขียนโปรแกรม|ทำเว็บ|ทำแอป|ทำเกม|ทั้งหมด|ครบทุก|code|html|css|js|javascript|typescript|python|react|next|vue|php|sql|api|script|function|app|game|web)/i.test(lastUserMsg);

  // ปิด thinkingBudget ในโหมด fast/smart (ตั้งเป็น 0) เพื่อป้องกัน Vercel Timeout (10 วิ) และให้เริ่มพ่นโค้ดทันที!
  // เปิดคิดล่วงหน้าเฉพาะโหมด beast แค่ 512 tokens เพื่อให้ตอบเร็วและไม่ค้าง
  const budget = beast ? 512 : 0;

  const build = (thinkingBudget, extraDirective) => {
    const config = {
      // ใช้ temperature ต่ำ (0.25 - 0.35) เพื่อให้โมเดลเขียนโค้ดตรงตามสั่งเป๊ะๆ ไม่ข้าม ไม่ย่อ
      temperature: beast ? 0.35 : 0.25,
      // ใช้ค่ามาตรฐานที่เสถียรกับทุกโมเดล (8192 สำหรับ Flash/Lite และ 16384 สำหรับ Beast) ป้องกัน Error 400
      maxOutputTokens: beast ? 16384 : 8192,
    };

    if (thinkingBudget > 0) {
      config.thinkingConfig = { thinkingBudget };
    } else {
      config.thinkingConfig = { thinkingBudget: 0 };
    }

    // แนบคำสั่งบังคับเขียนครบทุกบรรทัดต่อท้ายข้อความล่าสุดหากเป็นงานเขียนโค้ด
    const finalDirective = (isCodeRequest ? STRICT_CODE_DIRECTIVE : '') + (extraDirective || '');

    return {
      systemInstruction: {
        parts: [{ text: beast ? SYSTEM + '\n\n' + BEAST : SYSTEM }]
      },
      contents: messages.map((m, i) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{
          text: i === messages.length - 1 ? m.content + finalDirective : m.content
        }],
      })),
      generationConfig: config,
      safetySettings: SAFETY,
    };
  };

  const urlFor = m => `https://generativelanguage.googleapis.com/v1beta/models/${m}:streamGenerateContent?alt=sse`;

  // ฟังก์ชันเชื่อมต่อ Gemini API พร้อมระบบสลับโมเดลสำรองอัตโนมัติ
  async function open(basePayload, initialModel) {
    const queue = [initialModel, ...FALLBACK_MODELS.filter(m => m !== initialModel)];
    let r;

    for (let i = 0; i < queue.length; i++) {
      const model = queue[i];
      const payload = JSON.parse(JSON.stringify(basePayload));
      let retryCount = 0;

      while (retryCount < 3) {
        const controller = new AbortController();
        // ตั้ง Timeout การเชื่อมต่อแรกเริ่มไว้ที่ 15 วินาที หากช้าให้สลับโมเดลทันที
        const timeoutId = setTimeout(() => controller.abort(), 15000);
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

        if (r.status === 400) {
          const j = await r.clone().json().catch(() => ({}));
          const errMsg = (j.error && j.error.message) || '';
          if (/api key/i.test(errMsg)) return r;

          // หากเกิด 400 ให้ค่อยๆ ถอด config เสริมออกทีละตัวเพื่อลองกับโมเดลเดิม
          if (payload.generationConfig && payload.generationConfig.thinkingConfig) {
            delete payload.generationConfig.thinkingConfig;
            retryCount++;
            continue;
          }
          if (payload.generationConfig && payload.generationConfig.maxOutputTokens > 8192) {
            payload.generationConfig.maxOutputTokens = 8192;
            retryCount++;
            continue;
          }
          if (payload.safetySettings) {
            delete payload.safetySettings;
            retryCount++;
            continue;
          }
        }

        // หากไม่พบโมเดล (404), เซิร์ฟเวอร์แน่น (503), ติดลิมิต (429) หรือ 400 ที่แก้ไม่ได้ ให้ไปโมเดลถัดไปทันที
        break;
      }
    }
    return r;
  }

  // ฟังก์ชันอ่านข้อมูล Stream แบบ Real-time และส่งกลับไปยัง Client ทันที
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
            // กรองเอาเฉพาะข้อความคำตอบ ไม่รวมส่วนความคิดภายใน (thought)
            const t = parts.filter(p => !p.thought).map(p => p.text || '').join('');
            if (t) {
              got = true;
              res.write(t);
            }
            if (c.finishReason === 'MAX_TOKENS') trunc = true;
            else if (c.finishReason && c.finishReason !== 'STOP') reason = c.finishReason;
          }
        } catch (e) {
          // ข้าม chunk ที่ JSON ยังมาไม่ครบและรอรวมกับ chunk ถัดไป
        }
      }
    }
    return { got, trunc, reason };
  }

  try {
    // หากเป็นคำสั่งเขียนโค้ด ให้ใช้โมเดล SMART เสมอแม้ผู้ใช้จะเลือกโหมด fast ไว้ เพื่อให้ได้โค้ดครบถ้วนไม่ตกหล่น
    const selectedModel = (mode === 'fast' && !isCodeRequest) ? FAST : SMART;

    const r = await open(build(budget, ''), selectedModel);

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

    // หากไม่ได้รับข้อความกลับมาเลย (เช่น โมเดลคิดจนหมดเวลาหรือติด Safety แบบเงียบ) ให้ยิงซ้ำทันทีโดยปิด thinking
    if (!out.got && out.reason !== 'SAFETY' && out.reason !== 'PROHIBITED_CONTENT') {
      const r2 = await open(build(0, RETRY_PROMPT), SMART);
      if (r2 && r2.ok) out = await pump(r2);
    }

    if (!out.got) {
      res.write('ขออภัย AI ไม่สามารถตอบคำขอนี้ได้' + (out.reason ? ` (เหตุผล: ${out.reason})` : '') + '\n\nลองปรับคำถามให้ชัดเจนขึ้นแล้วส่งใหม่ครับ');
    }
    if (out.trunc) {
      res.write('\n\n⚠️ (ข้อความยาวเกินขีดจำกัดสูงสุดของโมเดล พิมพ์คำว่า "เขียนต่อจากเดิม" เพื่อให้ AI เขียนส่วนที่เหลือจนจบครับ)');
    }
    return res.end();
  } catch (e) {
    console.error('chat error', e && e.message);
    if (!res.headersSent) {
      return res.status(502).json({ error: 'เชื่อมต่อ AI ไม่ได้หรือหมดเวลาการรอ' });
    }
    return res.end();
  }
};
