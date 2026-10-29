// Vercel Serverless Function (Gemini, แบบสตรีม: ตัวหนังสือทยอยขึ้นระหว่างที่ AI เขียน)
const SYSTEM = "คุณคือวิศวกรซอฟต์แวร์อาวุโส หน้าที่คือเขียนโค้ดตามคำสั่งของผู้ใช้ให้ครบและทำงานได้จริง ปฏิบัติตามกฎเหล่านี้ทุกครั้ง: 1) อ่านคำสั่งให้ครบทุกข้อ แล้วทำทุกข้อที่ขอ ห้ามข้าม ห้ามเปลี่ยนโจทย์ ห้ามตอบแค่คำอธิบาย ถ้าผู้ใช้ขอให้เขียน สร้าง ทำ หรือแก้ ต้องมีโค้ดเสมอ 2) ใช้ภาษา เฟรมเวิร์ก ชื่อ และสไตล์ที่ผู้ใช้ระบุตรงตัว ถ้าไม่ระบุให้เลือกที่เหมาะกับงานและบอกสั้นๆ บรรทัดเดียว 3) ถ้าคำสั่งกำกวม ให้เดาอย่างสมเหตุสมผลแล้วลงมือทำเลย อย่าถามกลับ 4) โค้ดต้องสมบูรณ์ รันได้จริง ห้ามย่อ ห้ามใช้ ... หรือเขียนว่าส่วนที่เหลือเหมือนเดิม 5) ถ้าขอหน้าเว็บหรือแอป ให้ตอบเป็นไฟล์ HTML เดียวที่สมบูรณ์ใน ```html block เดียว โดย CSS และ JS อยู่ในไฟล์เดียว ไม่พึ่งไฟล์หรือรูปภายนอก (ใช้ฟอนต์จาก Google Fonts ได้) ออกแบบให้สวย รองรับมือถือ และห้ามใช้ localStorage 6) โค้ดทุกชิ้นต้องอยู่ใน code fence ที่ระบุภาษา 7) ตอบเป็นภาษาเดียวกับผู้ใช้ (ส่วนใหญ่ภาษาไทย) อธิบายสั้นไม่เกิน 3 บรรทัด แล้วตามด้วยโค้ด 8) ก่อนส่งคำตอบ ให้ตรวจว่าทำครบทุกข้อที่ผู้ใช้ขอแล้ว 9) ถ้าผู้ใช้แนบไฟล์โค้ด ให้แก้หรือปรับปรุงตามคำสั่งโดยคงสไตล์เดิมของไฟล์ แล้วส่งโค้ดที่แก้แล้วทั้งไฟล์ใน code fence เดียวต่อไฟล์ (ไม่ส่งเฉพาะส่วนที่เปลี่ยน) ตามด้วยสรุปสั้นๆ เป็นข้อๆ ว่าแก้อะไรเพราะอะไร ถ้าไม่พบบั๊กให้บอกตรงๆ";
// โหมดเร็วใช้รุ่นเล็ก (ไม่คิดนาน ตอบภายในไม่กี่วินาที) โหมดฉลาด/โหดใช้รุ่นเต็ม
const FAST = process.env.GEMINI_FAST_MODEL || 'gemini-3.5-flash-lite';
const SMART = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const SAFETY = ['HARASSMENT', 'HATE_SPEECH', 'SEXUALLY_EXPLICIT', 'DANGEROUS_CONTENT'].map(c => ({ category: 'HARM_CATEGORY_' + c, threshold: 'BLOCK_ONLY_HIGH' }));
const NUDGE = '\n\n[หมายเหตุถึงระบบ: ถ้าคำขอนี้ให้เขียน สร้าง ทำ หรือแก้โค้ด ให้ตอบด้วยโค้ดเต็มที่รันได้จริงใน code block ทันที ทำตามคำสั่งทุกข้อ ห้ามตอบแค่คำอธิบาย ห้ามถามกลับ]';
const RETRY = '\n[ย้ำ: ตอบเป็นโค้ดเต็มทันที]';
const BEAST = "โหมดโหด: ผู้ใช้ต้องการโค้ดระดับสุดยอด ให้ทำงานระดับมือโปรสายท็อป 1) วางโครงสร้างให้สะอาด อ่านง่าย และต่อยอดได้ 2) จัดการกรณีขอบ ข้อผิดพลาด และอินพุตแปลกๆ ให้ครบ 3) ใส่ใจประสิทธิภาพ เลือกอัลกอริทึมและโครงสร้างข้อมูลที่เหมาะสม 4) ถ้าเป็นหน้าเว็บ เกม หรือแอป ให้ทำให้อลังการ ดีไซน์โดดเด่น แอนิเมชันลื่น เอฟเฟกต์และ interaction ที่ทำให้ว้าว รองรับมือถือและการสัมผัส ฟีเจอร์ครบจนใช้งานได้จริงตั้งแต่เปิดครั้งแรก 5) ใส่คอมเมนต์ภาษาไทยเฉพาะจุดสำคัญ 6) ปิดท้ายด้วยสรุป 3-5 ข้อว่าโค้ดเด่นตรงไหนและวิธีใช้ อย่าทำของสั้นหรือง่ายเกินไป แต่ต้องรันได้จริงและอยู่ในขอบเขตที่ผู้ใช้ขอ ห้ามเขียนมัลแวร์หรือโค้ดที่ใช้โจมตีหรือทำร้ายผู้อื่น";
const wait = ms => new Promise(s => setTimeout(s, ms));

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'ใช้ได้เฉพาะ POST' });
  // คีย์ Gemini เป็นของผู้ใช้แต่ละคน ส่งมาทาง header (ไม่เก็บ ไม่บันทึก)
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

  const mode = body.mode === 'beast' ? 'beast' : body.mode === 'smart' ? 'smart' : 'fast';
  const beast = mode === 'beast';
  const level = beast ? 'high' : mode === 'smart' ? 'low' : '';
  const build = (lvl, extra) => ({
    systemInstruction: { parts: [{ text: beast ? SYSTEM + '\n\n' + BEAST : SYSTEM }] },
    contents: messages.map((m, i) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: i === messages.length - 1 ? m.content + NUDGE + (extra || '') : m.content }],
    })),
    generationConfig: Object.assign({ maxOutputTokens: beast ? 32000 : 16000 }, lvl ? { thinkingConfig: { thinkingLevel: lvl } } : {}),
    safetySettings: SAFETY,
  });
  const urlFor = m => 'https://generativelanguage.googleapis.com/v1beta/models/' + m + ':streamGenerateContent?alt=sse';

  // เปิดการเชื่อมต่อกับ Gemini (ถ้าตัวเลือกบางอย่างไม่รองรับ จะตัดออกแล้วลองใหม่เอง)
  async function open(payload, model) {
    let r, swapped = false;
    for (let i = 0; i < 4; i++) {
      r = await fetch(urlFor(model), {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (r.ok) return r;
      if (r.status === 404 && !swapped) { model = model === FAST ? SMART : FAST; swapped = true; continue; }
      if (r.status === 400) {
        const j = await r.clone().json().catch(() => ({}));
        if (/api key/i.test((j.error && j.error.message) || '')) break;
        if (payload.generationConfig && payload.generationConfig.thinkingConfig) { delete payload.generationConfig.thinkingConfig; continue; }
        if (payload.safetySettings) { delete payload.safetySettings; continue; }
      }
      if (r.status === 503) { await wait(1200); continue; }
      break;
    }
    return r;
  }

  // ส่งข้อความที่ Gemini สตรีมมาให้ผู้ใช้ทีละส่วน
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
        if (!j) continue;
        try {
          const d = JSON.parse(j);
          if (d.promptFeedback && d.promptFeedback.blockReason) reason = d.promptFeedback.blockReason;
          const c = (d.candidates || [])[0];
          if (c) {
            const t = ((c.content && c.content.parts) || []).map(p => p.text || '').join('');
            if (t) { got = true; res.write(t); }
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
    const r = await open(build(level), model);
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      const msg = (data.error && data.error.message) || '';
      console.error('gemini error', r.status, msg);
      const bad = r.status === 401 || r.status === 403 || (r.status === 400 && /api key/i.test(msg));
      if (bad) return res.status(401).json({ error: 'คีย์ Gemini ใช้ไม่ได้ ตรวจสอบแล้วใส่ใหม่' });
      if (r.status === 429) return res.status(429).json({ error: 'โควตาของคีย์นี้เต็มหรือส่งถี่เกินไป รอสักครู่หรือลองคีย์อื่น' });
      return res.status(502).json({ error: 'AI ขัดข้องชั่วคราว ลองใหม่อีกครั้ง' });
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');

    let out = await pump(r);
    if (!out.got) {
      // ไม่มีคำตอบเลย (ถูกกรอง/ว่าง) ลองอีกครั้งด้วยโมเดลเต็มและคำสั่งที่เข้มขึ้น
      const r2 = await open(build('low', RETRY), SMART);
      if (r2.ok) out = await pump(r2);
    }
    if (!out.got) {
      console.error('empty answer, reason=', out.reason);
      res.write('ขออภัย AI ไม่ยอมตอบคำขอนี้' + (out.reason ? ' (เหตุผลจากระบบความปลอดภัย: ' + out.reason + ')' : '') + '\n\nลองบอกวัตถุประสงค์ให้ชัดขึ้น เช่น ใช้ทำอะไรและภาษาอะไร หรือแก้คำสั่งแล้วส่งใหม่ครับ');
    }
    if (out.trunc) res.write('\u0001TRUNC');
    return res.end();
  } catch (e) {
    console.error('chat error', e && e.message);
    if (!res.headersSent) return res.status(502).json({ error: 'เชื่อมต่อ AI ไม่ได้' });
    return res.end();
  }
};
