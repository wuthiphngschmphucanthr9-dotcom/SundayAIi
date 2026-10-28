// ระบบร้านค้า: ตรวจสถานะ / รับซองทรูมันนี่ / หลังบ้านแอดมิน
const L = require('./_lib');

const TM_MSG = {
  VOUCHER_OUT_OF_STOCK: 'ซองนี้ถูกรับไปแล้ว',
  TARGET_USER_REDEEMED: 'ซองนี้ถูกรับไปแล้ว',
  VOUCHER_NOT_FOUND: 'ไม่พบซองนี้ ตรวจสอบลิงก์อีกครั้ง',
  VOUCHER_EXPIRED: 'ซองนี้หมดอายุแล้ว',
  CANNOT_GET_OWN_VOUCHER: 'รับซองของตัวเองไม่ได้',
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'ใช้ได้เฉพาะ POST' });
  const b = L.readBody(req);
  try {
    if (b.action === 'status') return await status(req, res);
    if (b.action === 'redeem') return await redeem(req, res, b);
    if (b.action === 'login') return await login(req, res, b);
    if (typeof b.action === 'string' && b.action.indexOf('admin_') === 0) return await admin(req, res, b);
    return res.status(400).json({ error: 'ไม่รู้จักคำสั่ง' });
  } catch (e) {
    console.error('shop error', e && e.message);
    if (e && e.message === 'NO_DB') return res.status(503).json({ error: 'ยังไม่ได้เชื่อมฐานข้อมูล (Upstash Redis)' });
    return res.status(500).json({ error: 'ระบบขัดข้อง ลองใหม่อีกครั้ง' });
  }
};

// เรียกรับซองทรูมันนี่: ลองที่อยู่แบบของแอดมิน (/v1) ก่อน แล้วสำรองด้วยแบบเดิม
async function callTM(hash, phone) {
  const urls = [
    'https://gift.truemoney.com/campaign/v1/vouchers/' + hash + '/redeem',
    'https://gift.truemoney.com/campaign/vouchers/' + hash + '/redeem',
  ];
  for (const u of urls) {
    try {
      const r = await fetch(u, {
        method: 'POST',
        headers: {
          'content-type': 'application/json', accept: 'application/json',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        },
        body: JSON.stringify({ mobile: phone, voucher_hash: hash }),
      });
      const data = await r.json().catch(() => null);
      if (data && data.status) return { data, via: u.indexOf('/v1/') > -1 ? 'v1' : 'legacy', http: r.status };
    } catch (e) { /* ลองที่อยู่ถัดไป */ }
  }
  return { data: null, via: '', http: 0 };
}

async function status(req, res) {
  const out = { serverNow: Date.now(), price: 10, maintenance: false, notice: '', session: null };
  try {
    const set = await L.getSettings();
    out.price = set.price; out.maintenance = set.maintenance; out.notice = set.notice;
    const code = L.normCode(req.headers['x-access-code']);
    if (code) { const rec = await L.getCode(code); out.session = { state: L.codeState(rec), expires: rec ? rec.expires : 0 }; }
  } catch (e) { out.degraded = true; }
  return res.status(200).json(out);
}

async function redeem(req, res, b) {
  const phone = String(process.env.TRUEMONEY_PHONE || '').replace(/\D/g, '');
  if (!phone) return res.status(500).json({ error: 'ระบบรับเงินยังไม่ได้ตั้งค่า แจ้งแอดมิน' });
  const set = await L.getSettings();
  if (set.maintenance) return res.status(503).json({ error: 'ระบบปิดปรับปรุงชั่วคราว' });
  if (!(await L.limit('sd:rl:redeem:' + L.ip(req), 8, 600))) return res.status(429).json({ error: 'ลองบ่อยเกินไป รอสักครู่' });

  const raw = String(b.voucher || '').trim();
  const m = raw.match(/[?&]v=([A-Za-z0-9]{10,40})/) || raw.match(/^([A-Za-z0-9]{10,40})$/);
  if (!m) return res.status(400).json({ error: 'ลิงก์ซองไม่ถูกต้อง ต้องเป็นลิงก์ gift.truemoney.com' });
  const hash = m[1], lockKey = 'sd:voucher:' + hash;

  const got = await L.redis('SET', lockKey, 'pending', 'NX', 'EX', '120');
  if (!got) {
    const v = await L.redis('GET', lockKey);
    if (v && v !== 'pending') {
      const rec = await L.getCode(v);
      if (rec && L.codeState(rec) === 'active') return res.status(200).json({ code: rec.code, expires: rec.expires, minutes: rec.minutes, again: true, serverNow: Date.now() });
      return res.status(409).json({ error: 'ซองนี้ถูกใช้ไปแล้ว' });
    }
    return res.status(409).json({ error: 'กำลังประมวลผลซองนี้ รอสักครู่แล้วลองใหม่' });
  }

  const tm = await callTM(hash, phone);
  const data = tm.data;

  if (!data || !data.status) {
    await L.redis('DEL', lockKey);
    return res.status(502).json({ error: 'เชื่อมต่อระบบ TrueMoney ไม่ได้ ลองใหม่อีกครั้ง หรือแจ้งแอดมิน' });
  }
  if (data.status.code !== 'SUCCESS') {
    await L.redis('DEL', lockKey);
    return res.status(400).json({ error: TM_MSG[data.status.code] || data.status.message || 'รับซองไม่สำเร็จ' });
  }

  // เงินเข้าแล้ว ต้องออกรหัสให้ได้ ถ้าพังให้ดูบันทึกของ Vercel (เก็บลิงก์ซองไว้ให้แอดมินเติมให้ด้วยมือ)
  try {
    const d = data.data || {};
    let amount = Number((d.my_ticket && d.my_ticket.amount_baht) || 0);
    if (!(amount > 0)) amount = Number((d.voucher && d.voucher.amount_baht) || 0);
    const minutes = Math.max(1, Math.floor((amount / set.price) * 60));

    let rec = null;
    const ex = L.normCode(b.code);
    if (ex) {
      rec = await L.getCode(ex);
      if (rec && !rec.revoked) { rec.expires = Math.max(Date.now(), rec.expires) + minutes * 60000; rec.minutes = (rec.minutes || 0) + minutes; await L.saveCode(rec); }
      else rec = null;
    }
    if (!rec) rec = await L.newCode(minutes, { source: 'truemoney', amount, voucher: hash.slice(0, 6) });

    await L.pipe([
      ['SET', lockKey, rec.code],
      ['LPUSH', 'sd:orders', JSON.stringify({ t: Date.now(), code: rec.code, amount, minutes, v: hash.slice(0, 6) })],
      ['LTRIM', 'sd:orders', '0', '999'],
      ['HINCRBYFLOAT', 'sd:stats', 'revenue', String(amount)],
      ['HINCRBY', 'sd:stats', 'orders', '1'],
    ]);
    return res.status(200).json({ code: rec.code, expires: rec.expires, minutes, amount, serverNow: Date.now() });
  } catch (e) {
    console.error('REDEEMED_BUT_FAILED voucher=' + hash + ' phone=' + phone + ' err=' + (e && e.message));
    return res.status(500).json({ error: 'รับซองแล้วแต่ออกรหัสไม่สำเร็จ กรุณาแจ้งแอดมินพร้อมลิงก์ซองนี้' });
  }
}

async function login(req, res, b) {
  if (!process.env.ADMIN_PASSWORD) return res.status(500).json({ error: 'ยังไม่ได้ตั้ง ADMIN_PASSWORD บนเซิร์ฟเวอร์' });
  if (!(await L.limit('sd:rl:admin:' + L.ip(req), 6, 600))) return res.status(429).json({ error: 'ลองผิดหลายครั้ง รอ 10 นาที' });
  if (!L.safeEq(String(b.password || ''), process.env.ADMIN_PASSWORD)) return res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง' });
  return res.status(200).json({ token: L.signAdmin() });
}

async function listCodes() {
  const names = (await L.redis('SMEMBERS', 'sd:codes')) || [];
  if (!names.length) return [];
  const [vals, usesFlat] = await Promise.all([L.redis('MGET', ...names.map(n => 'sd:code:' + n)), L.redis('HGETALL', 'sd:uses')]);
  const uses = {}; for (let i = 0; i < (usesFlat || []).length; i += 2) uses[usesFlat[i]] = Number(usesFlat[i + 1]);
  return vals.filter(Boolean).map(v => JSON.parse(v)).sort((a, b) => b.created - a.created).slice(0, 500)
    .map(r => ({ code: r.code, state: L.codeState(r), created: r.created, expires: r.expires, minutes: r.minutes, source: r.source, amount: r.amount || 0, note: r.note || '', uses: uses[r.code] || 0 }));
}

async function admin(req, res, b) {
  if (!L.checkAdmin(req.headers['x-admin-token'])) return res.status(401).json({ error: 'หมดเวลาล็อกอิน' });
  const mins = Math.floor(Number(b.minutes));
  switch (b.action) {
    case 'admin_summary': {
      const [flat, orders, codes] = await Promise.all([L.redis('HGETALL', 'sd:stats'), L.redis('LRANGE', 'sd:orders', '0', '999'), listCodes()]);
      const st = {}; for (let i = 0; i < (flat || []).length; i += 2) st[flat[i]] = Number(flat[i + 1]);
      const list = (orders || []).map(o => JSON.parse(o));
      const off = 7 * 3600e3, day0 = Math.floor((Date.now() + off) / 86400e3) * 86400e3 - off;
      const sum = f => list.filter(f).reduce((n, o) => n + o.amount, 0);
      return res.status(200).json({
        revenue: st.revenue || 0, orders: st.orders || 0, chats: st.chats || 0,
        today: sum(o => o.t >= day0), week: sum(o => o.t >= Date.now() - 7 * 86400e3),
        active: codes.filter(c => c.state === 'active').length, recent: list.slice(0, 30),
      });
    }
    case 'admin_tmtest': {
      const phone = String(process.env.TRUEMONEY_PHONE || '').replace(/\D/g, '');
      if (!phone) return res.status(200).json({ ok: false, msg: 'ยังไม่ได้ตั้ง TRUEMONEY_PHONE' });
      const probe = 'TEST' + require('crypto').randomBytes(7).toString('hex').toUpperCase().slice(0, 14);
      const tm = await callTM(probe, phone);
      if (!tm.data) return res.status(200).json({ ok: false, msg: 'เชื่อมต่อทรูมันนี่ไม่ได้ (อาจถูกบล็อกเซิร์ฟเวอร์) ลองใหม่ หรือแจ้งผมให้ปรับวิธีเชื่อมต่อ' });
      return res.status(200).json({ ok: true, msg: 'เชื่อมต่อได้ (' + (tm.via === 'v1' ? 'ที่อยู่ v1' : 'ที่อยู่สำรอง') + ') ทรูมันนี่ตอบ: ' + tm.data.status.code + ' · ซองทดสอบเป็นซองปลอม ไม่มีการรับเงิน' });
    }
    case 'admin_codes': return res.status(200).json({ codes: await listCodes() });
    case 'admin_create': {
      if (!(mins >= 1 && mins <= 60 * 24 * 30)) return res.status(400).json({ error: 'จำนวนนาทีต้องอยู่ระหว่าง 1 ถึง 43200' });
      const rec = await L.newCode(mins, { source: 'admin', note: String(b.note || '').slice(0, 60) });
      return res.status(200).json({ code: rec.code });
    }
    case 'admin_extend': case 'admin_revoke': case 'admin_unrevoke': case 'admin_delete': {
      const code = L.normCode(b.code), rec = await L.getCode(code);
      if (!rec) return res.status(404).json({ error: 'ไม่พบรหัสนี้' });
      if (b.action === 'admin_delete') { await L.pipe([['DEL', 'sd:code:' + code], ['SREM', 'sd:codes', code], ['HDEL', 'sd:uses', code]]); return res.status(200).json({ ok: true }); }
      if (b.action === 'admin_extend') {
        if (!(mins >= 1 && mins <= 60 * 24 * 30)) return res.status(400).json({ error: 'จำนวนนาทีไม่ถูกต้อง' });
        rec.expires = Math.max(Date.now(), rec.expires) + mins * 60000; rec.minutes = (rec.minutes || 0) + mins;
      } else rec.revoked = b.action === 'admin_revoke';
      await L.saveCode(rec);
      return res.status(200).json({ ok: true });
    }
    case 'admin_settings_get': return res.status(200).json(await L.getSettings());
    case 'admin_settings_set': {
      const price = Number(b.price), rate = Math.floor(Number(b.rate));
      if (!(price >= 1 && price <= 1000) || !(rate >= 1 && rate <= 120)) return res.status(400).json({ error: 'ราคาต้อง 1-1000 บาท และจำกัดต่อนาที 1-120 ครั้ง' });
      await L.redis('HSET', 'sd:settings', 'price', price, 'rate', rate, 'maintenance', b.maintenance ? '1' : '0', 'notice', String(b.notice || '').slice(0, 200));
      return res.status(200).json({ ok: true });
    }
    default: return res.status(400).json({ error: 'ไม่รู้จักคำสั่งแอดมิน' });
  }
}
