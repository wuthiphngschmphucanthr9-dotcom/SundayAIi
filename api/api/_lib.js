// ฟังก์ชันกลางที่ใช้ร่วมกัน (ไฟล์ขึ้นต้นด้วย _ Vercel จะไม่นับเป็น endpoint)
const crypto = require('crypto');

function dbConf() {
  return {
    url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
    tok: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
  };
}
async function call(path, body) {
  const { url, tok } = dbConf();
  if (!url || !tok) throw new Error('NO_DB');
  const r = await fetch(url + path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + tok, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}
async function redis(...cmd) {
  const d = await call('', cmd.map(String));
  if (d.error) throw new Error(d.error);
  return d.result;
}
async function pipe(cmds) {
  const d = await call('/pipeline', cmds.map(c => c.map(String)));
  if (!Array.isArray(d)) throw new Error((d && d.error) || 'PIPE_FAIL');
  return d.map(x => { if (x.error) throw new Error(x.error); return x.result; });
}

async function getSettings() {
  const h = (await redis('HGETALL', 'sd:settings')) || [];
  const o = {};
  for (let i = 0; i < h.length; i += 2) o[h[i]] = h[i + 1];
  return {
    price: Number(o.price) > 0 ? Number(o.price) : 10,
    maintenance: o.maintenance === '1',
    notice: o.notice || '',
    rate: Number(o.rate) > 0 ? Number(o.rate) : 12,
  };
}
function readBody(req) {
  const b = req.body;
  if (typeof b === 'string') { try { return JSON.parse(b || '{}'); } catch (e) { return {}; } }
  return b || {};
}
function ip(req) { return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || '0'; }
async function limit(key, max, ttl) {
  const n = await redis('INCR', key);
  if (Number(n) === 1) await redis('EXPIRE', key, ttl);
  return Number(n) <= max;
}

const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function genCode() {
  const b = crypto.randomBytes(12); let s = '';
  for (let i = 0; i < 12; i++) s += ALPHA[b[i] % ALPHA.length];
  return 'SD-' + s.slice(0, 4) + '-' + s.slice(4, 8) + '-' + s.slice(8, 12);
}
function normCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20); }
async function getCode(code) {
  if (!code) return null;
  const v = await redis('GET', 'sd:code:' + code);
  return v ? JSON.parse(v) : null;
}
async function saveCode(rec) {
  await pipe([['SET', 'sd:code:' + rec.code, JSON.stringify(rec)], ['SADD', 'sd:codes', rec.code]]);
}
async function newCode(minutes, extra) {
  const now = Date.now();
  const rec = Object.assign({ code: genCode(), created: now, expires: now + minutes * 60000, minutes, revoked: false }, extra || {});
  await saveCode(rec);
  return rec;
}
function codeState(rec) {
  if (!rec) return 'none';
  if (rec.revoked) return 'revoked';
  if (rec.expires <= Date.now()) return 'expired';
  return 'active';
}

// โทเคนแอดมิน (ลงลายเซ็นด้วยรหัสผ่านแอดมิน หมดอายุ 12 ชม.)
function safeEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function secret() { return crypto.createHash('sha256').update('sd-admin:' + (process.env.ADMIN_PASSWORD || '')).digest(); }
function signAdmin() {
  const exp = Date.now() + 12 * 3600 * 1000;
  return exp + '.' + crypto.createHmac('sha256', secret()).update(String(exp)).digest('hex');
}
function checkAdmin(tok) {
  if (!process.env.ADMIN_PASSWORD) return false;
  const [exp, sig] = String(tok || '').split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEq(sig, crypto.createHmac('sha256', secret()).update(exp).digest('hex'));
}

module.exports = { redis, pipe, getSettings, readBody, ip, limit, genCode, normCode, getCode, saveCode, newCode, codeState, safeEq, signAdmin, checkAdmin };
