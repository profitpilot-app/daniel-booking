// Daniel Quintanilla booking page: static page + POST /api/lead that texts Daniel.
// No dependencies. All secrets come from environment variables (never sent to the browser).
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 10000;
const TO = process.env.NOTIFY_TO || '+18326202855';           // Daniel's cell
const PUB = path.join(__dirname, 'public');
const TYPES = { avail: 'Confirm Availability', drive: 'Schedule a Test Drive', trade: 'Trade-In Value' };

// ---------- spam protection: per-IP + global rate limits ----------
const hits = new Map(); let globalHits = [];
let lastDelivery = null; // non-secret status of the most recent send, shown on /healthz
function limited(ip) {
  const now = Date.now(), hour = 3600e3;
  globalHits = globalHits.filter(t => now - t < hour);
  const arr = (hits.get(ip) || []).filter(t => now - t < hour);
  if (arr.length >= (+process.env.PER_IP_PER_HOUR || 5) || globalHits.length >= (+process.env.GLOBAL_PER_HOUR || 40)) return true;
  arr.push(now); hits.set(ip, arr); globalHits.push(now); return false;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some(t => now - t < 3600e3)) hits.delete(k); }, 600e3).unref();

const clean = (s, n = 120) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

// ---------- SMS providers (first configured one wins) ----------
async function sendSms(body) {
  if (process.env.QUO_API_KEY && process.env.QUO_FROM) {            // Quo (OpenPhone) API
    const r = await fetch('https://api.openphone.com/v1/messages', {
      method: 'POST', headers: { Authorization: process.env.QUO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: body, from: process.env.QUO_FROM, to: [TO] }) });
    const t = await r.text(); if (!r.ok) throw new Error('quo ' + r.status + ' ' + t.slice(0, 200)); return 'quo';
  }
  if (process.env.TWILIO_SID && process.env.TWILIO_TOKEN && process.env.TWILIO_FROM) {   // Twilio
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_SID}/Messages.json`, {
      method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(process.env.TWILIO_SID + ':' + process.env.TWILIO_TOKEN).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: TO, From: process.env.TWILIO_FROM, Body: body }) });
    const t = await r.text(); if (!r.ok) throw new Error('twilio ' + r.status + ' ' + t.slice(0, 200)); return 'twilio';
  }
  if (!process.env.TEXTBELT_KEY) return 'off';                       // no SMS provider configured
  const key = process.env.TEXTBELT_KEY;                              // Textbelt paid key
  const r = await fetch('https://textbelt.com/text', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: TO, message: body, key }) });
  const j = await r.json().catch(() => ({}));
  if (!j.success) throw new Error('textbelt ' + JSON.stringify(j).slice(0, 200));
  return 'textbelt (quota left: ' + j.quotaRemaining + ')';
}

// ntfy.sh push (topic is a secret env var; never in the repo or the page)
async function sendNtfy(title, body, phoneDigits) {
  const topic = process.env.NTFY_TOPIC; if (!topic) return 'off';
  const tel = 'tel:+1' + phoneDigits.slice(-10);
  const r = await fetch(process.env.NTFY_SERVER || 'https://ntfy.sh/', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, title, message: body, priority: 4, tags: ['car', 'bell'], click: tel,
      actions: [{ action: 'view', label: 'Call customer', url: tel, clear: false }, { action: 'view', label: 'Text customer', url: 'sms:+1' + phoneDigits.slice(-10), clear: false }] }) });
  const t = await r.text(); if (!r.ok) throw new Error('ntfy ' + r.status + ' ' + t.slice(0, 200));
  return 'ok';
}

// Optional email backup through FormSubmit (address already activated on Daniel's other page)
async function sendEmailBackup(fields, subject) {
  const to = process.env.BACKUP_EMAIL; if (!to) return 'off';
  const site = process.env.SITE_URL || 'https://daniel-booking.onrender.com';
  const r = await fetch('https://formsubmit.co/ajax/' + to, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: site, Referer: site + '/' },
    body: JSON.stringify(Object.assign({ _subject: subject, _template: 'table' }, fields)) });
  const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch {}
  if (!(j.success === true || j.success === 'true')) throw new Error('formsubmit ' + r.status + ' ' + t.replace(/\s+/g, ' ').slice(0, 300));
  return 'ok';
}

async function handleLead(req, res, raw) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  let d; try { d = JSON.parse(raw); } catch { return json(res, 400, { ok: false, error: 'bad request' }); }
  if (d.website || d.company_url) return json(res, 200, { ok: true });               // honeypot: pretend success
  if (d.t && Date.now() - Number(d.t) < 2500) return json(res, 200, { ok: true });    // filled too fast = bot
  const type = TYPES[d.type] ? d.type : null;
  const name = clean(d.name, 60), phone = clean(d.phone, 25), email = clean(d.email, 80);
  const digits = phone.replace(/\D/g, '');
  if (!type || !name || digits.length < 10 || digits.length > 11) return json(res, 400, { ok: false, error: 'Please enter your name and a 10-digit phone number.' });
  if (limited(ip)) return json(res, 429, { ok: false, error: 'Too many requests. Please call or text 832-620-2855.' });

  const car = clean(d.car, 80), stock = clean(d.stock, 20), notes = clean(d.notes, 200);
  let when = '';
  if (d.date || d.time) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(d.time || ''));
    if (m && +m[1] < 9) return json(res, 400, { ok: false, error: 'Please pick a time at 9:00 AM or later.' });
    if (m) { const h = +m[1]; when = clean(d.date, 20) + ' ' + ((h % 12) || 12) + ':' + m[2] + (h < 12 ? ' AM' : ' PM'); }
    else when = clean(d.date, 20);
  }
  const trade = type === 'trade' ? [clean(d.tyear, 4), clean(d.tmake, 25), clean(d.tmodel, 30)].filter(Boolean).join(' ') + (d.tmiles ? ', ' + clean(d.tmiles, 10) + ' mi' : '') : '';
  const fmtPhone = digits.length === 10 ? `${digits.slice(0,3)}-${digits.slice(3,6)}-${digits.slice(6)}` : phone;
  const test = d.test === 'TEST' ? 'TEST - ' : '';
  const lines = [`${test}New lead: ${TYPES[type]}`, `Name: ${name}`, `Phone: ${fmtPhone}`];
  if (email) lines.push(`Email: ${email}`);
  lines.push(`Vehicle: ${car || 'not specified'}${stock ? ' (Stk ' + stock + ')' : ''}`);
  if (when) lines.push(`Time: ${when}`);
  if (trade.trim()) lines.push(`Trade: ${trade}`);
  if (d.lang === 'es') lines.push('Prefers Spanish');
  if (notes) lines.push(`Note: ${notes}`);
  const body = lines.join('\n');

  console.log('[lead]', new Date().toISOString(), JSON.stringify({ ip, body }));
  const title = `${test}${type === 'drive' ? 'Test Drive request' : type === 'trade' ? 'Trade-In request' : 'Availability check'}: ${name}`;
  const [sms, mail, push] = await Promise.allSettled([sendSms(body), sendEmailBackup(
    { 'Request type': TYPES[type], Name: name, Phone: fmtPhone, Email: email, Vehicle: car, 'Stock #': stock, Time: when, Trade: trade, Notes: notes },
    `${test}${TYPES[type]}: ${car || 'vehicle'} - ${name}`), sendNtfy(title, body, digits)]);
  const st = x => x.status === 'fulfilled' ? x.value : 'FAILED: ' + x.reason.message;
  lastDelivery = { at: new Date().toISOString(), sms: st(sms), email: st(mail), ntfy: st(push) };
  console.log('[delivery]', JSON.stringify(lastDelivery));
  const ok = x => x.status === 'fulfilled' && x.value !== 'off';
  const emailed = ok(mail);
  if (!ok(sms) && !emailed && !ok(push)) return json(res, 502, { ok: false, error: 'send failed', emailed: false });
  json(res, 200, { ok: true, emailed });
}

function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/api/lead') {
    let raw = ''; req.on('data', c => { raw += c; if (raw.length > 8000) req.destroy(); });
    req.on('end', () => handleLead(req, res, raw).catch(e => { console.error(e); json(res, 500, { ok: false, error: 'server error' }); }));
    return;
  }
  if (url.pathname === '/healthz') return json(res, 200, { ok: true, sms: process.env.QUO_API_KEY ? 'quo' : process.env.TWILIO_SID ? 'twilio' : process.env.TEXTBELT_KEY ? 'textbelt' : 'off', ntfy: !!process.env.NTFY_TOPIC, email: !!process.env.BACKUP_EMAIL, lastDelivery });
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.normalize(path.join(PUB, p));
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { // unknown paths fall back to the page so /?car=... and /car/... both work
      return fs.readFile(path.join(PUB, 'index.html'), (e2, b2) => { res.writeHead(200, { 'Content-Type': MIME['.html'] }); res.end(b2); });
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    res.end(buf);
  });
}).listen(PORT, () => console.log('listening on', PORT));
