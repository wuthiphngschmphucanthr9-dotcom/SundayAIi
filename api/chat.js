// Vercel Serverless Function (Gemini Real-time Streaming) - พัฒนาโดยอาวุโส
const SYSTEM = "คุณคือวิศวกรซอฟต์แวร์อาวุโสและผู้ช่วยอัจฉริยะ ตอบคำถามให้ตรงประเด็น ครบถ้วน และทำงานได้จริง ปฏิบัติตามกฎเหล่านี้ทุกครั้ง: 1) อ่านคำสั่งให้ครบทุกข้อ แล้วทำทุกข้อที่ขอ ห้ามข้าม ห้ามเปลี่ยนโจทย์ 2) ใช้ภาษา เฟรมเวิร์ก ชื่อ และสไตล์ที่ผู้ใช้ระบุตรงตัว 3) ถ้าคำสั่งกำกวม ให้ตีความอย่างสมเหตุสมผลแล้วลงมือทำเลย 4) โค้ดต้องสมบูรณ์ รันได้จริง ห้ามย่อ ห้ามใช้ ... 5) โค้ดทุกชิ้นต้องอยู่ใน code fence ที่ระบุภาษา 6) ตอบเป็นภาษาไทย 7) ใส่อีโมจิที่เหมาะสมและทันสมัยประกอบหัวข้อหรือข้อความสำคัญอย่างพอดี (ห้ามใส่อีโมจิในบล็อกโค้ดเด็ดขาด)";

const FAST = process.env.GEMINI_FAST_MODEL || 'gemini-2.5-flash';
const SMART = process.env.GEMINI_MODEL || 'gemini-2.5-pro';

const SAFETY = ['HARASSMENT', 'HATE_SPEECH', 'SEXUALLY_EXPLICIT', 'DANGEROUS_CONTENT'].map(c => ({
  category: 'HARM_CATEGORY_' + c,
  threshold: 'BLOCK_ONLY_HIGH'
}));

const NUDGE = '\n\n[หมายเหตุ: ตอบให้ตรงประเด็น กระชับชัดเจน และครบถ้วน โค้ดต้องสมบูรณ์รันได้จริง]';
const RETRY = '\n[ย้ำ: ตอบคำขอนี้ให้ครบถ้วนทันที]';

const wait = ms => new Promise(s => setTimeout(s, ms));

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'รองรับเฉพาะเมธอด POST เท่านั้น' });
  }

  const key = String(req.headers['x-user-key'] || '').trim();
  if (!key) {
    return res.status(401).json({ error: 'กรุณาระบุ Gemini API Key ใน Header x-user-key' });
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
    return res.status(400).json({ error: 'ประวัติข้อความไม่ถูกต้องตามรูปแบบที่กำหนด' });
  }

  const mode = body.mode === 'smart' ? 'smart' : 'fast';
  const modelToUse = mode === 'smart' ? SMART : FAST;

  const buildPayload = (extraText) => ({
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: messages.map((m, i) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: i === messages.length - 1 ? m.content + NUDGE + (extraText || '') : m.content }],
    })),
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 8192,
    },
    safetySettings: SAFETY,
  });

  const urlFor = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;

  async function callGemini(payload, modelName) {
    let response;
    for (let i = 0; i < 2; i++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);
      try {
        response = await fetch(urlFor(modelName), {
          method: 'POST',
          headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (response.ok) return response;
      if (response.status === 503) {
        await wait(500);
        continue;
      }
      break;
    }
    return response;
  }

  async function streamResponse(response, resWriter) {
    const decoder = new TextDecoder();
    let buffer = '';
    let hasContent = false;
    let isTruncated = false;
    let blockReason = '';

    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let newlineIdx;
      while ((newlineIdx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        
        if (!line.startsWith('data:')) continue;
        const jsonStr = line.slice(5).trim();
        if (!jsonStr || jsonStr === '[DONE]') continue;

        try {
          const parsed = JSON.parse(jsonStr);
          if (parsed.promptFeedback && parsed.promptFeedback.blockReason) {
            blockReason = parsed.promptFeedback.blockReason;
          }
          const candidate = (parsed.candidates || [])[0];
          if (candidate) {
            const parts = (candidate.content && candidate.content.parts) || [];
            const textContent = parts.map(p => p.text || '').join('');
            if (textContent) {
              hasContent = true;
              resWriter.write(textContent);
            }
            if (candidate.finishReason === 'MAX_TOKENS') {
              isTruncated = true;
            } else if (candidate.finishReason && candidate.finishReason !== 'STOP') {
              blockReason = candidate.finishReason;
            }
          }
        } catch (err) {
          // ข้ามข้อผิดพลาดในการแปลง JSON ของแต่ละสตรีม
        }
      }
    }
    return { hasContent, isTruncated, blockReason };
  }

  try {
    let apiResponse = await callGemini(buildPayload(), modelToUse);

    if (!apiResponse || !apiResponse.ok) {
      const errorData = await apiResponse?.json().catch(() => ({}));
      const errorMsg = (errorData.error && errorData.error.message) || 'เกิดข้อผิดพลาดไม่ทราบสาเหตุ';
      
      if (apiResponse && (apiResponse.status === 401 || apiResponse.status === 403)) {
        return res.status(401).json({ error: 'API Key ไม่ถูกต้องหรือหมดสิทธิ์การใช้งาน' });
      }
      if (apiResponse && apiResponse.status === 429) {
        return res.status(429).json({ error: 'โควตาการใช้งานเต็ม หรือส่งคำขอถี่เกินไป' });
      }
      return res.status(502).json({ error: `ไม่สามารถเชื่อมต่อ AI ได้ (${apiResponse?.status || 500}): ${errorMsg}` });
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');

    let result = await streamResponse(apiResponse, res);

    if (!result.hasContent && !result.blockReason) {
      const retryResponse = await callGemini(buildPayload(RETRY), modelToUse);
      if (retryResponse && retryResponse.ok) {
        result = await streamResponse(retryResponse, res);
      }
    }

    if (!result.hasContent) {
      res.write('ขออภัย ระบบไม่สามารถสร้างคำตอบสำหรับคำขอนี้ได้' + (result.blockReason ? ` (เหตุผล: ${result.blockReason})` : ''));
    }

    if (result.isTruncated) {
      res.write('\n\n⚠️ *(คำเตือน: ข้อความถูกตัดทอนเนื่องจากเกินขีดจำกัดความยาว)*');
    }

    return res.end();
  } catch (err) {
    console.error('Serverless Function Error:', err);
    if (!res.headersSent) {
      return res.status(502).json({ error: 'เกิดข้อผิดพลาดภายในระบบเซิร์ฟเวอร์' });
    }
    return res.end();
  }
};
