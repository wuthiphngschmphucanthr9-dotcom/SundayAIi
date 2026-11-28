// Vercel Serverless Function (Gemini 2.5 Flash 3.8 Real-time Streaming)
const SYSTEM = "คุณคือวิศวกรซอฟต์แวร์อาวุโสและผู้ช่วยอัจฉริยะ ตอบคำถามให้ตรงประเด็น ครบถ้วน รวดเร็ว และทำงานได้จริง โค้ดต้องสมบูรณ์ รันได้จริง ห้ามย่อ ห้ามใช้ ... และอยู่ใน code fence เท่านั้น";

const FAST_MODEL = process.env.GEMINI_FAST_MODEL || 'gemini-2.5-flash-3.8';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST method only' });
  }

  const key = String(req.headers['x-user-key'] || '').trim();
  if (!key) {
    return res.status(401).json({ error: 'Missing Gemini API Key' });
  }

  let body = {};
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const messages = Array.isArray(body.messages) ? body.messages.slice(-8) : [];
  if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'Invalid message format' });
  }

  const payload = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    generationConfig: {
      temperature: 0.5,
      maxOutputTokens: 8192,
    }
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${FAST_MODEL}:streamGenerateContent?alt=sse`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    const apiResponse = await fetch(url, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!apiResponse.ok) {
      const errData = await apiResponse.json().catch(() => ({}));
      return res.status(apiResponse.status).json({ error: errData.error?.message || 'Gemini API Error' });
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');

    const decoder = new TextDecoder();
    let buffer = '';

    for await (const chunk of apiResponse.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        
        if (!line.startsWith('data:')) continue;
        const jsonStr = line.slice(5).trim();
        if (!jsonStr || jsonStr === '[DONE]') continue;

        try {
          const parsed = JSON.parse(jsonStr);
          const parts = parsed.candidates?.[0]?.content?.parts || [];
          const text = parts.map(p => p.text || '').join('');
          if (text) {
            res.write(text);
          }
        } catch (e) {}
      }
    }

    return res.end();
  } catch (err) {
    if (!res.headersSent) {
      return res.status(502).json({ error: 'Upstream connection timeout or failure' });
    }
    return res.end();
  }
};
