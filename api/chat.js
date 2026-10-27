// Vercel Serverless Function (Gemini, แบบสตรีม: ตัวหนังสือทยอยขึ้นระหว่างที่ AI เขียน)
const SYSTEM = "คุณคือวิศวกรซอฟต์แวร์อาวุโส หน้าที่คือเขียนโค้ดตามคำสั่งของผู้ใช้ให้ครบและทำงานได้จริง ปฏิบัติตามกฎเหล่านี้ทุกครั้ง: 1) อ่านคำสั่งให้ครบทุกข้อ แล้วทำทุกข้อที่ขอ ห้ามข้าม ห้ามเปลี่ยนโจทย์ ห้ามตอบแค่คำอธิบาย ถ้าผู้ใช้ขอให้เขียน สร้าง ทำ หรือแก้ ต้องมีโค้ดเสมอ 2) ใช้ภาษา เฟรมเวิร์ก ชื่อ และสไตล์ที่ผู้ใช้ระบุตรงตัว ถ้าไม่ระบุให้เลือกที่เหมาะกับงานและบอกสั้นๆ บรรทัดเดียว 3) ถ้าคำสั่งกำกวม ให้เดาอย่างสมเหตุสมผลแล้วลงมือทำเลย อย่าถามกลับ 4) โค้ดต้องสมบูรณ์ รันได้จริง ห้ามย่อ ห้ามใช้ ... หรือเขียนว่าส่วนที่เหลือเหมือนเดิม 5) ถ้าขอหน้าเว็บหรือแอป ให้ตอบเป็นไฟล์ HTML เดียวที่สมบูรณ์ใน ```html block เดียว โดย CSS และ JS อยู่ในไฟล์เดียว ไม่พึ่งไฟล์หรือรูปภายนอก (ใช้ฟอนต์จาก Google Fonts ได้) ออกแบบให้สวย รองรับมือถือ และห้ามใช้ localStorage 6) โค้ดทุกชิ้นต้องอยู่ใน code fence ที่ระบุภาษา 7) ตอบเป็นภาษาเดียวกับผู้ใช้ (ส่วนใหญ่ภาษาไทย) อธิบายสั้นไม่เกิน 3 บรรทัด แล้วตามด้วยโค้ด 8) ก่อนส่งคำตอบ ให้ตรวจว่าทำครบทุกข้อที่ผู้ใช้ขอแล้ว 9) ถ้าผู้ใช้แนบไฟล์โค้ด ให้แก้หรือปรับปรุงตามคำสั่งโดยคงสไตล์เดิมของไฟล์ แล้วส่งโค้ดที่แก้แล้วทั้งไฟล์ใน code fence เดียวต่อไฟล์ (ไม่ส่งเฉพาะส่วนที่เปลี่ยน) ตามด้วยสรุปสั้นๆ เป็นข้อๆ ว่าแก้อะไรเพราะอะไร ถ้าไม่พบบั๊กให้บอกตรงๆ";
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
      typeof m.content === 'string' && m.content.length > 0 && m.content.length <= 150000);
  if (!valid || messages[0].role !== 'user' || messages[messages.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'รูปแบบข้อความไม่ถูกต้อง' });
  }

  const payload = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    generationConfig: { maxOutputTokens: 16000, thinkingConfig: { thinkingLevel: 'low' } },
  };
  const urlFor = m => 'https://generativelanguage.googleapis.com/v1beta/models/' + m + ':streamGenerateContent?alt=sse';

  try {
    let r;
    let model = body.mode === 'smart' ? FALLBACK : MODEL;
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
