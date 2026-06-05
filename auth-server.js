/**
 * Frost ID OAuth 2.1 Auth Server for Blades of Hex
 *
 *   GET /auth/login    → redirect to Frost ID authorize (PKCE S256)
 *   GET /auth/callback → exchange code → JWT → redirect to game
 *
 * Run: node auth-server.js  (or pm2 start auth-server.js --name blades-auth)
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'auth-config.json'), 'utf-8'));

// ── In-memory PKCE verifier store (10-min TTL) ────────────
const verifiers = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of verifiers) if (v.expiresAt < now) verifiers.delete(k);
}, 60_000);
function storeVerifier(state, verifier) { verifiers.set(state, { verifier, expiresAt: Date.now() + 600000 }); }
function consumeVerifier(state) { const e = verifiers.get(state); if (!e) return null; verifiers.delete(state); return e.verifier; }

// ── JWT ──────────────────────────────────────────────────
function b64url(buf) { return buf.toString('base64url'); }
function signJWT(payload) {
  const now = Math.floor(Date.now() / 1000);
  const pld = JSON.stringify({ ...payload, iat: now, exp: now + 604800 }); // 7 days
  const h = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const p = b64url(Buffer.from(pld));
  const s = b64url(crypto.createHmac('sha256', cfg.jwtSecret).update(h + '.' + p).digest());
  return h + '.' + p + '.' + s;
}

// ── PKCE ─────────────────────────────────────────────────
function genVerifier() { return b64url(crypto.randomBytes(32)); }
function genChallenge(v) { return b64url(crypto.createHash('sha256').update(v).digest()); }
function genState() { return b64url(crypto.randomBytes(16)); }

// ── HTTP server ──────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // GET /auth/login
  if (req.method === 'GET' && url.pathname === '/auth/login') {
    const verifier = genVerifier();
    const challenge = genChallenge(verifier);
    const state = genState();
    storeVerifier(state, verifier);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUrl,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      scope: 'openid profile email'
    });

    res.writeHead(302, { Location: cfg.authorizeUrl + '?' + params.toString() });
    res.end();
    return;
  }

  // GET /auth/callback
  if (req.method === 'GET' && url.pathname === '/auth/callback') {
    const code  = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const err   = url.searchParams.get('error');

    if (err) { res.writeHead(302, { Location: '/?auth_error=' + encodeURIComponent(err) }); res.end(); return; }

    const verifier = consumeVerifier(state);
    if (!verifier) { res.writeHead(302, { Location: '/?auth_error=invalid_state' }); res.end(); return; }

    try {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: cfg.redirectUrl,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        code_verifier: verifier,
      });

      const tokenRes = await fetch(cfg.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      if (!tokenRes.ok) { res.writeHead(302, { Location: '/?auth_error=token' }); res.end(); return; }

      const tokenData = await tokenRes.json();
      const accessToken = tokenData.access_token;
      if (!accessToken) { res.writeHead(302, { Location: '/?auth_error=no_token' }); res.end(); return; }

      const userRes = await fetch(cfg.userinfoUrl || 'http://127.0.0.1:4000/oauth/userinfo', {
        headers: { Authorization: 'Bearer ' + accessToken },
      });
      if (!userRes.ok) { res.writeHead(302, { Location: '/?auth_error=userinfo' }); res.end(); return; }

      const user = await userRes.json();
      const jwt = signJWT({ sub: user.sub, email: user.email, preferred_username: user.username || user.email?.split('@')[0] || 'User' });

      res.writeHead(302, {
        Location: '/?token=' + jwt + '&username=' + encodeURIComponent(user.username || user.email?.split('@')[0] || 'User'),
      });
      res.end();
    } catch (e) {
      res.writeHead(302, { Location: '/?auth_error=' + encodeURIComponent(e.message) });
      res.end();
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(cfg.port, cfg.host, () => {
  console.log('[Auth] Frost ID auth server on http://' + cfg.host + ':' + cfg.port);
});
