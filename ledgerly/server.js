const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const mysql = require('mysql2/promise');

const PORT = Number(process.env.PORT || 3000);
const ROOT = process.cwd();
const MAX_BODY = 1_500_000;
const SESSION_COOKIE = 'webdev_app_session';
const OAUTH_STATE_COOKIE = 'ledgerly_oauth_state';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
let pool = null;
let dbReady = false;

function publicOrigin(req) {
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const host = req.headers.host || 'localhost:' + PORT;
  const local = host.startsWith('localhost') || host.startsWith('127.0.0.1');
  return (forwarded || (local ? 'http' : 'https')) + '://' + host;
}
function json(res, status, value, extraHeaders = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extraHeaders });
  res.end(body);
}
function html(res, status, body) { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(body); }
function text(res, status, body) { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(body); }
function b64(value) { return Buffer.from(value).toString('base64url'); }
function unb64(value) { return Buffer.from(value, 'base64url').toString('utf8'); }
function sign(value) { return crypto.createHmac('sha256', process.env.MANUS_JWT_SECRET || 'ledgerly-development-session-secret').update(value).digest('base64url'); }
function makeSession(user) { const head = b64(JSON.stringify({ alg:'HS256', typ:'JWT' })); const body = b64(JSON.stringify({ appId:process.env.MANUS_PROJECT_ID || '', openId:user.openId, name:user.name || '', email:user.email || '', iat:Math.floor(Date.now()/1000), exp:Math.floor(Date.now()/1000) + SESSION_MAX_AGE })); return head + '.' + body + '.' + sign(head + '.' + body); }
function readCookies(req) { return Object.fromEntries(String(req.headers.cookie || '').split(';').map((part) => part.trim()).filter(Boolean).map((part) => { const at = part.indexOf('='); return at < 0 ? [part, ''] : [part.slice(0, at), decodeURIComponent(part.slice(at + 1))]; })); }
function verifySession(req) {
  const token = readCookies(req)[SESSION_COOKIE]; if (!token) return null;
  const parts = token.split('.'); if (parts.length !== 3) return null;
  const expected = sign(parts[0] + '.' + parts[1]); const actual = parts[2]; if (expected.length !== actual.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual))) return null;
  try { const payload = JSON.parse(unb64(parts[1])); if (payload.appId && process.env.MANUS_PROJECT_ID && payload.appId !== process.env.MANUS_PROJECT_ID) return null; if (!payload.openId || payload.exp < Math.floor(Date.now()/1000)) return null; return payload; } catch { return null; }
}
function cookie(name, value, maxAge, req, httpOnly = true) { const host = req.headers.host || ''; const secure = !(host.startsWith('localhost') || host.startsWith('127.0.0.1')); return name + '=' + encodeURIComponent(value) + '; Path=/; Max-Age=' + maxAge + '; SameSite=' + (secure ? 'None' : 'Lax') + (secure ? '; Secure' : '') + (httpOnly ? '; HttpOnly' : ''); }
function clearCookie(name, req) { return cookie(name, '', 0, req); }
function readBody(req) { return new Promise((resolve, reject) => { let data = ''; let size = 0; req.on('data', (chunk) => { size += chunk.length; if (size > MAX_BODY) { reject(new Error('Request body too large.')); req.destroy(); return; } data += chunk; }); req.on('end', () => resolve(data)); req.on('error', reject); }); }
async function bodyJson(req) { const raw = await readBody(req); if (!raw) return {}; try { return JSON.parse(raw); } catch { throw new Error('Invalid JSON.'); } }
async function oauthPost(pathname, payload) { const endpoint = String(process.env.MANUS_OAUTH_API_URL || '').replace(/\/$/, '') + pathname; const response = await fetch(endpoint, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(payload) }); if (!response.ok) throw new Error('OAuth provider rejected the request.'); return response.json(); }
async function ensureDatabase() {
  if (!process.env.DATABASE_URL) return false;
  if (dbReady) return true;
  if (!pool) pool = mysql.createPool({ uri: process.env.DATABASE_URL, waitForConnections:true, connectionLimit:4, maxIdle:2, idleTimeout:60000, enableKeepAlive:true });
  await pool.query(`CREATE TABLE IF NOT EXISTS ledgerly_sync_documents (open_id VARCHAR(191) PRIMARY KEY, version BIGINT UNSIGNED NOT NULL DEFAULT 0, envelope_json LONGTEXT NOT NULL, device_id VARCHAR(191) NOT NULL, updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3))`);
  dbReady = true; return true;
}
function validateEnvelope(envelope) { return envelope && typeof envelope === 'object' && Number(envelope.version) === 1 && typeof envelope.salt === 'string' && envelope.salt.length <= 128 && typeof envelope.iv === 'string' && envelope.iv.length <= 128 && typeof envelope.data === 'string' && envelope.data.length > 0 && envelope.data.length <= 1_400_000; }
async function syncGet(user, res) { if (!(await ensureDatabase())) return json(res, 503, { error:'sync_unavailable' }); const [rows] = await pool.query('SELECT version, envelope_json, device_id, updated_at FROM ledgerly_sync_documents WHERE open_id = ?', [user.openId]); if (!rows.length) return json(res, 200, { version:0, envelope:null }); const row = rows[0]; return json(res, 200, { version:Number(row.version), envelope:JSON.parse(row.envelope_json), deviceId:row.device_id, updatedAt:row.updated_at }); }
async function syncPut(user, req, res) { if (!(await ensureDatabase())) return json(res, 503, { error:'sync_unavailable' }); const payload = await bodyJson(req); const baseVersion = Number(payload.baseVersion); const deviceId = String(payload.deviceId || '').slice(0, 191); if (!Number.isInteger(baseVersion) || baseVersion < 0 || !deviceId || !validateEnvelope(payload.envelope)) return json(res, 400, { error:'invalid_sync_payload' }); const connection = await pool.getConnection(); try { await connection.beginTransaction(); const [rows] = await connection.query('SELECT version, envelope_json, device_id, updated_at FROM ledgerly_sync_documents WHERE open_id = ? FOR UPDATE', [user.openId]); const current = rows.length ? rows[0] : null; const currentVersion = current ? Number(current.version) : 0; if (currentVersion !== baseVersion) { await connection.rollback(); return json(res, 409, { error:'sync_conflict', version:currentVersion, envelope:current ? JSON.parse(current.envelope_json) : null, deviceId:current?.device_id || null, updatedAt:current?.updated_at || null }); } const nextVersion = currentVersion + 1; const serialized = JSON.stringify(payload.envelope); await connection.query('INSERT INTO ledgerly_sync_documents (open_id, version, envelope_json, device_id) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE version=VALUES(version), envelope_json=VALUES(envelope_json), device_id=VALUES(device_id), updated_at=CURRENT_TIMESTAMP(3)', [user.openId, nextVersion, serialized, deviceId]); await connection.commit(); return json(res, 200, { version:nextVersion, savedAt:new Date().toISOString() }); } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); } }
function redirect(res, location, headers = {}) { res.writeHead(302, { Location:location, ...headers }); res.end(); }
async function handle(req, res) {
  const parsed = new URL(req.url, publicOrigin(req)); const pathname = parsed.pathname;
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': publicOrigin(req), 'Access-Control-Allow-Credentials':'true', 'Access-Control-Allow-Headers':'Content-Type', 'Access-Control-Allow-Methods':'GET,POST,PUT,OPTIONS' }); return res.end(); }
  if (pathname === '/_app/health' && req.method === 'GET') return json(res, 200, { ok:true, service:'ledgerly', database: Boolean(process.env.DATABASE_URL) });
  if (pathname === '/api/auth/login' && req.method === 'GET') { if (!process.env.MANUS_OAUTH_PORTAL_URL || !process.env.MANUS_PROJECT_ID) return json(res, 503, { error:'oauth_unavailable' }); const nonce = crypto.randomBytes(24).toString('base64url'); const redirectUri = publicOrigin(req) + '/auth/callback'; const state = b64(JSON.stringify({ nonce, redirectUri, createdAt:Date.now() })); const portal = new URL(String(process.env.MANUS_OAUTH_PORTAL_URL).replace(/\/$/, '') + '/app-auth'); portal.searchParams.set('appId', process.env.MANUS_PROJECT_ID); portal.searchParams.set('redirectUri', redirectUri); portal.searchParams.set('state', state); portal.searchParams.set('responseType', 'code'); return redirect(res, portal.toString(), { 'Set-Cookie':cookie(OAUTH_STATE_COOKIE, nonce, 600, req) }); }
  if (pathname === '/auth/callback' && req.method === 'GET') { try { const state = JSON.parse(unb64(parsed.searchParams.get('state') || '')); const saved = readCookies(req)[OAUTH_STATE_COOKIE]; const code = parsed.searchParams.get('code'); if (!code || !state.nonce || state.nonce !== saved || state.redirectUri !== publicOrigin(req) + '/auth/callback') throw new Error('Invalid OAuth state.'); const exchanged = await oauthPost('/webdev.v1.WebDevAuthPublicService/ExchangeToken', { clientId:process.env.MANUS_PROJECT_ID, grantType:'authorization_code', code, redirectUri:state.redirectUri }); const user = await oauthPost('/webdev.v1.WebDevAuthPublicService/GetUserInfo', { accessToken:exchanged.accessToken }); if (!user.openId) throw new Error('No user identity returned.'); return redirect(res, '/?sync=connected', { 'Set-Cookie':[cookie(SESSION_COOKIE, makeSession(user), SESSION_MAX_AGE, req), clearCookie(OAUTH_STATE_COOKIE, req)] }); } catch (error) { return html(res, 400, '<!doctype html><meta charset="utf-8"><title>Ledgerly sign-in failed</title><p>Ledgerly could not complete sign-in. You may close this tab and try again.</p>'); } }
  if (pathname === '/api/auth/me' && req.method === 'GET') { const user = verifySession(req); return user ? json(res, 200, { authenticated:true, user:{ openId:user.openId, name:user.name, email:user.email } }) : json(res, 401, { authenticated:false }); }
  if (pathname === '/api/auth/logout' && req.method === 'POST') return json(res, 200, { ok:true }, { 'Set-Cookie':clearCookie(SESSION_COOKIE, req) });
  if (pathname === '/api/sync' && req.method === 'GET') { const user = verifySession(req); if (!user) return json(res, 401, { error:'unauthorized' }); return syncGet(user, res); }
  if (pathname === '/api/sync' && req.method === 'PUT') { const user = verifySession(req); if (!user) return json(res, 401, { error:'unauthorized' }); try { return await syncPut(user, req, res); } catch (error) { console.error(error); return json(res, 500, { error:'sync_failed' }); } }
  if (pathname.startsWith('/api/')) return json(res, 404, { error:'not_found' });
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//, ''); const file = path.resolve(ROOT, relative); if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return text(res, 404, 'Not found'); const ext = path.extname(file); const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.webmanifest':'application/manifest+json', '.svg':'image/svg+xml' }; res.writeHead(200, { 'Content-Type':types[ext] || 'application/octet-stream', 'Cache-Control':ext === '.html' ? 'no-store' : 'public, max-age=3600', 'X-Content-Type-Options':'nosniff' }); fs.createReadStream(file).pipe(res);
}
const server = http.createServer((req, res) => { handle(req, res).catch((error) => { console.error(error); if (!res.headersSent) json(res, 500, { error:'internal_error' }); else res.destroy(); }); });
ensureDatabase().catch((error) => console.error('Database initialization deferred:', error.message)).finally(() => server.listen(PORT, '0.0.0.0', () => console.log(`Ledgerly server listening on ${PORT}`)));
process.on('SIGTERM', async () => { if (pool) await pool.end(); server.close(() => process.exit(0)); });
