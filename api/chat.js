// Vercel Serverless Function (Gemini Real-time Streaming)
const SYSTEM = "คุณคือวิศวกรซอฟต์แวร์อาวุโสและผู้ช่วยอัจฉริยะ SundayAI ตอบคำถามให้ตรงประเด็น ครบถ้วน และทำงานได้จริง ปฏิบัติตามกฎเหล่านี้ทุกครั้ง: 1) อ่านคำสั่งให้ครบทุกข้อ แล้วทำทุกข้อที่ขอ ห้ามข้าม ห้ามเปลี่ยนโจทย์ 2) ใช้ภาษา เฟรมเวิร์ก ชื่อ และสไตล์ที่ผู้ใช้ระบุตรงตัว 3) ถ้าคำสั่งกำกวม ให้ตีความอย่างสมเหตุสมผลแล้วลงมือทำเลย 4) โค้ดต้องสมบูรณ์ รันได้จริง ห้ามย่อ ห้ามใช้ ... 5) โค้ดทุกชิ้นต้องอยู่ใน code fence ที่ระบุภาษา 6) ตอบเป็นภาษาเดียวกับผู้ใช้ (ส่วนใหญ่ภาษาไทย) 7) ใส่อีโมจิที่เหมาะสมและทันสมัยประกอบหัวข้อหรือข้อความสำคัญอย่างพอดี (ไม่รกจนเกินไป) เพื่อให้อ่านง่าย น่าสนใจ และเป็นกันเอง (ห้ามใส่อีโมจิในบล็อกโค้ดเด็ดขาด)";

// ใช้ชื่อโมเดล Gemini รุ่นล่าสุด (ตรวจสอบให้แน่ใจว่าตั้งค่า ENV หรือใช้ชื่อรุ่นที่ API รองรับ)
const FAST = process.env.GEMINI_FAST_MODEL || 'gemini-2.5-flash';
const SMART = process.env.GEMINI_MODEL || 'gemini-2.5-pro';

const SAFETY = ['HARASSMENT', 'HATE_SPEECH', 'SEXUALLY_EXPLICIT', 'DANGEROUS_CONTENT'].map(c => ({
  category: 'HARM_CATEGORY_' + c,
  threshold: 'BLOCK_ONLY_HIGH'
}));

const NUDGE = '\n\n[หมายเหตุถึงระบบ: ตอบให้ตรงประเด็น กระชับชัดเจน และครบถ้วน ใส่อีโมจิประกอบพอดี (ยกเว้นในโค้ด) หากสั่งเขียนหรือแก้โค้ด ให้ตอบด้วยโค้ดที่สมบูรณ์รันได้จริง]';
const RETRY = '\n[ย้ำ: ตอบคำขอนี้ให้ครบถ้วนทันที]';
const BEAST = "โหมดโหด: ทำงานระดับมือโปรสายท็อป 1) วางโครงสร้างให้สะอาด อ่านง่าย และต่อยอดได้ 2) จัดการกรณีขอบ ข้อผิดพลาด และอินพุตแปลกๆ ให้ครบ 3) ใส่ใจประสิทธิภาพ 4) ถ้าเป็นหน้าเว็บ เกม หรือแอป ให้ทำให้อลังการ ดีไซน์โดดเด่น แอนิเมชันลื่น รองรับมือถือ 5) ใส่คอมเมนต์ภาษาไทยเฉพาะจุดสำคัญ 6) ปิดท้ายด้วยสรุป 3-5 ข้อพร้อมอีโมจินำหน้าหัวข้อว่าเด่นตรงไหนและวิธีใช้";

const wait = ms => new Promise(s => setTimeout(s, ms));

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'ใช้ได้เฉพาะ POST' });

  // รับคีย์ Gemini จาก Header (ไม่เก็บลงฐานข้อมูล)
  const key = String(req.headers['x-user-key'] || '').trim();
  if (!key) return res.status(401).json({ error: 'กรุณาใส่ Gemini API Key ก่อนเริ่มแชท' });

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
  // ลด thinkingBudget เพื่อลดเวลาคิดก่อนเริ่มสตรีมคำตอบแรก (TTFT)
  const budget = beast ? 2048 : mode === 'smart' ? 512 : 0;

  const build = (thinkingBudget, extra) => {
    const config = {
      temperature: beast ? 0.7 : 0.6,
      maxOutputTokens: beast ? 16384 : 8192,
    };
    if (thinkingBudget > 0) {
      config.thinkingConfig = { thinkingBudget };
    }

    return {
      systemInstruction: { parts: [{ text: beast ? SYSTEM + '\n\n' + BEAST : SYSTEM }] },
      contents: messages.map((m, i) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: i === messages.length - 1 ? m.content + NUDGE + (extra || '') : m.content }],
      })),
      generationConfig: config,
      safetySettings: SAFETY,
    };
  };

  // [จุดที่แก้ 1] เพิ่มเครื่องหมาย Backtick (`) ครอบ URL
  const urlFor = m => `https://generativelanguage.googleapis.com/v1beta/models/${m}:streamGenerateContent?alt=sse`;

  async function open(payload, model) {
    let r, swapped = false;
    for (let i = 0; i < 2; i++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);
      try {
        r = await fetch(urlFor(model), {
          method: 'POST',
          headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
      if (r.ok) return r;
      if (r.status === 404 && !swapped) {
        model = model === FAST ? SMART : FAST;
        swapped = true;
        continue;
      }
      if (r.status === 400) {
        const j = await r.clone().json().catch(() => ({}));
        if (/api key/i.test((j.error && j.error.message) || '')) break;
        if (payload.generationConfig && payload.generationConfig.thinkingConfig) {
          delete payload.generationConfig.thinkingConfig;
          continue;
        }
        if (payload.safetySettings) {
          delete payload.safetySettings;
          continue;
        }
      }
      if (r.status === 503) {
        await wait(400);
        continue;
      }
      break;
    }
    return r;
  }

  async function pump(r) {
    const decoder = new TextDecoder();
    let buf = '', got = false, trunc = false, reason = '';
    for await (const chunk of r.body) {
      buf += decoder.decode(chunk, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const j = line.slice(5).trim();
        if (!j || j === '[DONE]') continue;
        try {
          const d = JSON.parse(j);
          if (d.promptFeedback && d.promptFeedback.blockReason) reason = d.promptFeedback.blockReason;
          const c = (d.candidates || [])[0];
          if (c) {
            const parts = (c.content && c.content.parts) || [];
            // กรองเฉพาะข้อความคำตอบจริง (ไม่เอาส่วน thought ของโมเดล)
            const t = parts.filter(p => !p.thought).map(p => p.text || '').join('');
            if (t) {
              got = true;
              res.write(t);
            }
            if (c.finishReason === 'MAX_TOKENS') trunc = true;
            else if (c.finishReason && c.finishReason !== 'STOP') reason = c.finishReason;
          }
        } catch (e) {}
      }
    }
    return { got, trunc, reason };
  }

  try {
    const model = mode === 'fast' ? FAST : SMART;
    const r = await open(build(budget), model);
    if (!r || !r.ok) {
      const data = r ? await r.json().catch(() => ({})) : {};
      const msg = (data.error && data.error.message) || '';
      const status = r ? r.status : 502;
      console.error('gemini error', status, msg);
      const bad = status === 401 || status === 403 || (status === 400 && /api key/i.test(msg));
      if (bad) return res.status(401).json({ error: 'คีย์ Gemini ใช้ไม่ได้ กรุณาตรวจสอบแล้วใส่ใหม่' });
      if (status === 429) return res.status(429).json({ error: 'โควตาของคีย์นี้เต็มหรือส่งถี่เกินไป รอสักครู่แล้วลองใหม่' });
      // [จุดที่แก้ 2] เพิ่มเครื่องหมาย Backtick (`) ครอบข้อความ error
      return res.status(502).json({ error: `AI ขัดข้อง (${status}): ${msg || 'ลองใหม่อีกครั้ง'}` });
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');

    let out = await pump(r);
    // ลองซ้ำเฉพาะกรณีไม่ถูกบล็อกความปลอดภัยและไม่มีข้อความตอบกลับเลย
    if (!out.got && out.reason !== 'SAFETY' && out.reason !== 'PROHIBITED_CONTENT') {
      const r2 = await open(build(0, RETRY), FAST);
      if (r2 && r2.ok) out = await pump(r2);
    }
    if (!out.got) {
      // [จุดที่แก้ 3] เพิ่มเครื่องหมาย Backtick (`) ครอบข้อความเหตุผล
      res.write('ขออภัย AI ไม่สามารถตอบคำขอนี้ได้' + (out.reason ? ` (เหตุผล: ${out.reason})` : '') + '\n\nลองปรับคำถามให้ชัดเจนขึ้นแล้วส่งใหม่ครับ');
    }
    if (out.trunc) res.write('\n\n⚠️ (ข้อความถูกตัดเนื่องจากยาวเกินขีดจำกัด)');
    return res.end();
  } catch (e) {
    console.error('chat error', e && e.message);
    if (!res.headersSent) return res.status(502).json({ error: 'เชื่อมต่อ AI ไม่ได้หรือหมดเวลาการรอ' });
    return res.end();
  }
};
