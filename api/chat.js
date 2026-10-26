// Vercel Serverless Function: เก็บ API key ไว้ฝั่งเซิร์ฟเวอร์เท่านั้น
const SYSTEM = "คุณเป็นผู้ช่วยเขียนโค้ดมืออาชีพ ตอบเป็นภาษาเดียวกับผู้ใช้ (ส่วนใหญ่เป็นภาษาไทย) อธิบายสั้น กระชับ แล้วให้โค้ดใน code fence ที่ระบุภาษาเสมอ ชี้ข้อควรระวังสำคัญเท่าที่จำเป็น ถ้าผู้ใช้ขอหน้าเว็บ ให้ตอบเป็นไฟล์ HTML เดียวที่สมบูรณ์ใน ```html block เดียว (CSS และ JS อยู่ในไฟล์เดียว ไม่พึ่งไฟล์หรือรูปภายนอก ออกแบบให้สวย ใช้สีและฟอนต์ที่เข้ากับหัวข้อ รองรับมือถือ) และห้ามใช้ localStorage กฎสำคัญ: ทำตามที่ผู้ใช้สั่งให้ตรงตัวทุกข้อ (ภาษา ฟีเจอร์ สไตล์ ชื่อ โครงสร้าง) อย่าเปลี่ยนโจทย์ อย่าถามกลับถ้าพอเดาได้ ให้เขียนโค้ดเต็มที่ใช้งานได้จริง ไม่ย่อ ไม่ใช้ ... แทนส่วนของโค้ด ถ้าผู้ใช้ไม่ระบุภาษาให้เลือกที่เหมาะกับงาน";
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'ใช้ได้เฉพาะ POST' });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: 'ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY บนเซิร์ฟเวอร์' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const messages = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
  const valid = messages.length > 0 &&
    messages.every(m => m && (m.role === 'user' || m.role === 'assistant') &&
      typeof m.content === 'string' && m.content.length > 0 && m.content.length <= 20000);
  if (!valid || messages[0].role !== 'user' || messages[messages.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'รูปแบบข้อความไม่ถูกต้อง' });
  }

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 4000, system: SYSTEM, messages }),
    });
    const data = await r.json();
    if (!r.ok) {
      const status = r.status === 429 ? 429 : 502;
      return res.status(status).json({ error: (data.error && data.error.message) || 'เรียก AI ไม่สำเร็จ' });
    }
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    return res.status(200).json({ text, truncated: data.stop_reason === 'max_tokens' });
  } catch (e) {
    return res.status(502).json({ error: 'เชื่อมต่อ AI ไม่ได้' });
  }
};
