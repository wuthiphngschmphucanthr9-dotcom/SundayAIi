const SYSTEM = "คุณเป็นผู้ช่วยเขียนโค้ดมืออาชีพ ตอบเป็นภาษาเดียวกับผู้ใช้ (ส่วนใหญ่เป็นภาษาไทย) อธิบายสั้น กระชับ แล้วให้โค้ดใน code fence ที่ระบุภาษาเสมอ ชี้ข้อควรระวังสำคัญเท่าที่จำเป็น ถ้าผู้ใช้ขอหน้าเว็บ ให้ตอบเป็นไฟล์ HTML เดียวที่สมบูรณ์ใน ```html block เดียว (CSS และ JS อยู่ในไฟล์เดียว ไม่พึ่งไฟล์หรือรูปภายนอก ออกแบบให้สวย ใช้สีและฟอนต์ที่เข้ากับหัวข้อ รองรับมือถือ) และห้ามใช้ localStorage กฎสำคัญ: ทำตามที่ผู้ใช้สั่งให้ตรงตัวทุกข้อ (ภาษา ฟีเจอร์ สไตล์ ชื่อ โครงสร้าง) อย่าเปลี่ยนโจทย์ อย่าถามกลับถ้าพอเดาได้ ให้เขียนโค้ดเต็มที่ใช้งานได้จริง ไม่ย่อ ไม่ใช้ ... แทนส่วนของโค้ด ถ้าผู้ใช้ไม่ระบุภาษาให้เลือกที่เหมาะกับงาน";
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const wait = ms => new Promise(s => setTimeout(s, ms));

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'ใช้ได้เฉพาะ POST' });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: 'ยังไม่ได้ตั้งค่า GEMINI_API_KEY' });

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
    generationConfig: { maxOutputTokens: 8000, thinkingConfig: { thinkingBudget: 0 } },
  };
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent';

  try {
    let r, data;
    for (let i = 0; i < 4; i++) {
      r = await fetch(url, {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      data = await r.json().catch(() => ({}));
      if (r.ok) break;
      if (r.status === 400 && payload.generationConfig.thinkingConfig) {
        delete payload.generationConfig.thinkingConfig;
        continue;
      }
      if (r.status === 503 || r.status === 429) { await wait(1500); continue; }
      break;
    }
    if (!r.ok) {
      return res.status(r.status === 429 ? 429 : 502).json({ error: (data.error && data.error.message) || 'เรียก AI ไม่สำเร็จ' });
    }
    const cand = (data.candidates || [])[0];
    const parts = (cand && cand.content && cand.content.parts) || [];
    const text = parts.map(p => p.text || '').join('');
    if (!text) return res.status(502).json({ error: 'AI ไม่ได้ส่งคำตอบกลับมา ลองถามใหม่อีกครั้ง' });
    return res.status(200).json({ text, truncated: cand.finishReason === 'MAX_TOKENS' });
  } catch (e) {
    return res.status(502).json({ error: 'เชื่อมต่อ AI ไม่ได้' });
  }
};
