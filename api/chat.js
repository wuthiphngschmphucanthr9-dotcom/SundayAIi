// Vercel Serverless Function (Gemini Real-time Streaming - อ่านครบถ้วน & ตอบเร็ว)
const SYSTEM = "คุณคือวิศวกรซอฟต์แวร์อาวุโสและผู้ช่วยอัจฉริยะ SundayAI ตอบคำถามให้ตรงประเด็น ครบถ้วน และทำงานได้จริง ปฏิบัติตามกฎเหล่านี้ทุกครั้ง: 1) อ่านคำสั่งและไฟล์ที่แนบมาให้ครบทุกบรรทัด แล้วทำทุกข้อที่ขอ ห้ามข้าม ห้ามเปลี่ยนโจทย์ 2) ใช้ภาษา เฟรมเวิร์ก ชื่อ และสไตล์ที่ผู้ใช้ระบุตรงตัว 3) ถ้าคำสั่งกำกวม ให้ตีความอย่างสมเหตุสมผลแล้วลงมือทำเลย 4) โค้ดต้องสมบูรณ์ รันได้จริง ห้ามย่อ ห้ามใช้ ... 5) โค้ดทุกชิ้นต้องอยู่ใน code fence ที่ระบุภาษา 6) ตอบเป็นภาษาเดียวกับผู้ใช้ (ส่วนใหญ่ภาษาไทย) 7) ใส่อีโมจิที่เหมาะสมและทันสมัยประกอบหัวข้อหรือข้อความสำคัญอย่างพอดี (ไม่รกจนเกินไป) เพื่อให้อ่านง่าย น่าสนใจ และเป็นกันเอง (ห้ามใส่อีโมจิในบล็อกโค้ดเด็ดขาด)";

// อัปเดตชื่อโมเดล Gemini รุ่นล่าสุดตามที่ Google API แนะนำ
const FAST = process.env.GEMINI_FAST_MODEL || 'gemini-3.8-flash-lite';
const SMART = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const BACKUP_MODELS = [
    'gemini-3.8-flash',
    'gemini-3.8-flash-lite',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite'
];

const SAFETY = ['HARASSMENT', 'HATE_SPEECH', 'SEXUALLY_EXPLICIT', 'DANGEROUS_CONTENT'].map(c => ({
    category: 'HARM_CATEGORY_' + c,
    threshold: 'BLOCK_ONLY_HIGH'
}));

const NUDGE = '\n\n[คำสั่งระบบ: อ่านข้อมูลทั้งหมดข้างต้นให้ครบถ้วน แล้วเริ่มตอบทันทีอย่างรวดเร็ว ตรงประเด็น ครบทุกข้อ ใส่อีโมจิประกอบพอดี (ยกเว้นในโค้ด) หากสั่งเขียนหรือแก้โค้ด ให้ส่งโค้ดฉบับเต็มที่รันได้จริง]';
const RETRY = '\n[ย้ำ: ตอบคำขอนี้ให้ครบถ้วนทันที]';
const BEAST = "โหมดโหด: ทำงานระดับมือโปรสายท็อป 1) วางโครงสร้างให้สะอาด อ่านง่าย และต่อยอดได้ 2) จัดการกรณีขอบ ข้อผิดพลาด และอินพุตแปลกๆ ให้ครบ 3) ใส่ใจประสิทธิภาพ 4) ถ้าเป็นหน้าเว็บ เกม หรือแอป ให้ทำให้อลังการ ดีไซน์โดดเด่น แอนิเมชันลื่น รองรับมือถือ 5) ใส่คอมเมนต์ภาษาไทยเฉพาะจุดสำคัญ 6) ปิดท้ายด้วยสรุป 3-5 ข้อพร้อมอีโมจินำหน้าหัวข้อว่าเด่นตรงไหนและวิธีใช้";

const wait = ms => new Promise(s => setTimeout(s, ms));

// ค้นหาโมเดล Flash ที่คีย์นี้รองรับโดยอัตโนมัติ หากชื่อโมเดลหลักเกิด 404
async function discoverAvailableFlashModel(key, triedSet) {
    try {
        const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
            headers: { 'x-goog-api-key': key }
        });
        if (!res.ok) return null;
        const data = await res.json();
        const models = (data.models || [])
            .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('streamGenerateContent'))
            .map(m => String(m.name || '').replace(/^models\//, ''))
            .filter(name => /flash/i.test(name) && !/image|audio|tts|exp/i.test(name));

        // เรียงจากเวอร์ชันใหม่สุดไปเก่าสุด
        models.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
        return models.find(name => !triedSet.has(name)) || null;
    } catch (e) {
        return null;
    }
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'ใช้ได้เฉพาะ POST' });

    const key = String(req.headers['x-user-key'] || '').trim();
    if (!key) return res.status(401).json({ error: 'กรุณาใส่ Gemini API Key ก่อนเริ่มแชท' });

    let body = {};
    try {
        body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    } catch (e) {
        return res.status(400).json({ error: 'รูปแบบข้อมูล JSON ไม่ถูกต้อง' });
    }

    const messages = Array.isArray(body.messages) ? body.messages.slice(-20) : [];
    const valid = messages.length > 0 &&
        messages.every(m => m && (m.role === 'user' || m.role === 'assistant') &&
            typeof m.content === 'string' && m.content.trim().length > 0 && m.content.length <= 250000);

    if (!valid || messages[messages.length - 1].role !== 'user') {
        return res.status(400).json({ error: 'รูปแบบประวัติข้อความไม่ถูกต้องหรือข้อความยาวเกินกำหนด' });
    }

    const mode = body.mode === 'beast' ? 'beast' : body.mode === 'smart' ? 'smart' : 'fast';
    const beast = mode === 'beast';
    const budget = beast ? 1024 : 0;

    const build = (thinkingBudget, extra) => {
        const config = {
            temperature: beast ? 0.65 : 0.5,
            maxOutputTokens: beast ? 16384 : 8192,
            thinkingConfig: { thinkingBudget: thinkingBudget > 0 ? thinkingBudget : 0 }
        };

        return {
            systemInstruction: { parts: [{ text: beast ? SYSTEM + '\n\n' + BEAST : SYSTEM }] },
            contents: messages.map((m, i) => {
                const isLast = i === messages.length - 1;
                const parts = [{
                    text: isLast ? m.content + NUDGE + (extra || '') : m.content
                }];

                if (m.image && m.image.base64) {
                    parts.push({
                        inlineData: {
                            mimeType: m.image.mimeType || 'image/jpeg',
                            data: m.image.base64
                        }
                    });
                }

                return {
                    role: m.role === 'assistant' ? 'model' : 'user',
                    parts
                };
            }),
            generationConfig: config,
            safetySettings: SAFETY,
        };
    };

    const urlFor = m => `https://generativelanguage.googleapis.com/v1beta/models/${m}:streamGenerateContent?alt=sse`;

    async function open(payload, initialModel) {
        let r;
        let model = initialModel;
        const triedModels = new Set([model]);
        let discovered = false;

        for (let i = 0; i < 6; i++) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);
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

            if (r.ok) return { response: r, usedModel: model };

            // หากชื่อโมเดลไม่พบ (404) ให้ไล่สลับโมเดลสำรอง หรือค้นหารุ่นล่าสุดจาก API อัตโนมัติ
            if (r.status === 404) {
                const nextBackup = BACKUP_MODELS.find(m => !triedModels.has(m));
                if (nextBackup) {
                    model = nextBackup;
                    triedModels.add(model);
                    continue;
                }
                if (!discovered) {
                    discovered = true;
                    const foundModel = await discoverAvailableFlashModel(key, triedModels);
                    if (foundModel) {
                        model = foundModel;
                        triedModels.add(model);
                        continue;
                    }
                }
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

            if (r.status === 503 || r.status === 500) {
                await wait(300);
                continue;
            }
            break;
        }
        return { response: r, usedModel: model };
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
        const startModel = mode === 'fast' ? FAST : SMART;
        const { response: r, usedModel } = await open(build(budget), startModel);
        if (!r.ok) {
            const data = await r.json().catch(() => ({}));
            const msg = (data.error && data.error.message) || '';
            console.error('gemini error', r.status, msg);
            const bad = r.status === 401 || r.status === 403 || (r.status === 400 && /api key/i.test(msg));
            if (bad) return res.status(401).json({ error: 'คีย์ Gemini ใช้ไม่ได้ กรุณาตรวจสอบแล้วใส่ใหม่' });
            if (r.status === 429) return res.status(429).json({ error: 'โควตาของคีย์นี้เต็มหรือส่งถี่เกินไป รอสักครู่แล้วลองใหม่' });
            return res.status(502).json({ error: `AI ขัดข้อง (${r.status}): ${msg || 'ลองใหม่อีกครั้ง'}` });
        }

        res.status(200);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('X-Accel-Buffering', 'no');

        let out = await pump(r);
        if (!out.got && out.reason !== 'SAFETY' && out.reason !== 'PROHIBITED_CONTENT') {
            const retryRes = await open(build(0, RETRY), usedModel);
            if (retryRes.response && retryRes.response.ok) out = await pump(retryRes.response);
        }
        if (!out.got) {
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
