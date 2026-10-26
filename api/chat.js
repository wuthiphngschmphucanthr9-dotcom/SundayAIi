// Vercel Serverless Function (Gemini, แบบสตรีม: ตัวหนังสือทยอยขึ้นระหว่างที่ AI เขียน)
const SYSTEM = "คุณเป็นผู้ช่วยเขียนโค้ดมืออาชีพ ตอบเป็นภาษาเดียวกับผู้ใช้ (ส่วนใหญ่เป็นภาษาไทย) อธิบายสั้น กระชับ แล้วให้โค้ดใน code fence ที่ระบุภาษาเสมอ ชี้ข้อควรระวังสำคัญเท่าที่จำเป็น ถ้าผู้ใช้ขอหน้าเว็บ ให้ตอบเป็นไฟล์ HTML เดียวที่สมบูรณ์ใน ```html block เดียว (CSS และ JS อยู่ในไฟล์เดียว ไม่พึ่งไฟล์หรือรูปภายนอก ออกแบบให้สวย ใช้สีและฟอนต์ที่เข้ากับหัวข้อ รองรับมือถือ) และห้ามใช้ localStorage กฎสำคัญ: ทำตามที่ผู้ใช้สั่งให้ตรงตัวทุกข้อ (ภาษา ฟีเจอร์ สไตล์ ชื่อ โครงสร้าง) อย่าเปลี่ยนโจทย์ อย่าถามกลับถ้าพอเดาได้ ให้เขียนโค้ดเต็มที่ใช้งานได้จริง ไม่ย่อ ไม่ใช้ ... แทนส่วนของโค้ด ถ้าผู้ใช้ไม่ระบุภาษาให้เลือกที่เหมาะกับงาน";
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const FALLBACK = 'gemini-3.8-flash';
const wait = ms => new Promise(s => setTimeout(s, ms));

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'ใช้ได้เฉพาะ POST' });
  // คีย์เป็นของผู้ใช้แต่ละคน ส่งมาทาง header (ไม่เก็บ ไม่บันทึก)
  const key = String(req.headers['x-user-key'] || '').trim();
  if (!key) return res.status(401).json({ error: 'ยังไม่ได้ใส่คีย์ Gemini' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const messages = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
  const valid = messages.length > 0 &&
    messages.every(m => m && (m.role === 'user' || m.role === 'assistant') &&
      typeof m.content === 'string' && m.content.length > 0 && m.content.length <= 20000);
  if (!valid || messages[0].role !== 'user' || messages[messages.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'รูปแบบข้อความไม่ถูกต้อง' });
  }

  const payload = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    generationConfig: { maxOutputTokens: 8000, thinkingConfig: { thinkingLevel: 'low' } },
  };
  const urlFor = m => 'https://generativelanguage.googleapis.com/v1beta/models/' + m + ':streamGenerateContent?alt=sse';

  try {
    let r;
    let model = MODEL;
    for (let i = 0; i < 3; i++) {
      r = await fetch(urlFor(model), {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (r.ok) break;
      if (r.status === 404 && model !== FALLBACK) { model = FALLBACK; continue; }
      if (r.status === 400 && payload.generationConfig.thinkingConfig) {
        delete payload.generationConfig.thinkingConfig;
        continue;
      }
      if (r.status === 503) { await wait(1200); continue; }
      break;
    }
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      const msg = (data.error && data.error.message) || '';
      const bad = r.status === 401 || r.status === 403 || (r.status === 400 && /api key/i.test(msg));
      return res.status(bad ? 401 : r.status === 429 ? 429 : 502).json({ error: msg || 'เรียก AI ไม่สำเร็จ' });
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');

    const decoder = new TextDecoder();
    let buf = '', got = false, trunc = false;
    for await (const chunk of r.body) {
      buf += decoder.decode(chunk, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const j = line.slice(5).trim();
        if (!j) continue;
        try {
          const d = JSON.parse(j);
          const c = (d.candidates || [])[0];
          if (c) {
            const t = ((c.content && c.content.parts) || []).map(p => p.text || '').join('');
            if (t) { got = true; res.write(t); }
            if (c.finishReason === 'MAX_TOKENS') trunc = true;
          }
        } catch (e) {}
      }
    }
    if (!got) res.write('\u0001EMPTY');
    if (trunc) res.write('\u0001TRUNC');
    return res.end();
  } catch (e) {
    if (!res.headersSent) return res.status(502).json({ error: 'เชื่อมต่อ AI ไม่ได้' });
    return res.end();
  }
};
