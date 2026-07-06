const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');
const crypto = require('crypto');
const WebSocket = require('ws');

const HTTP_PORT  = process.env.PORT || process.env.HTTP_PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const ADMIN_TOKEN = 'blades-of-hex-admin-v2';

// ── Frost ID JWT verification ────────────────────────────
const JWT_SECRET = 'blades-auth-jwt-secret-2026-05-29';
function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}
function verifyJWT(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(parts[0] + '.' + parts[1]).digest();
    const actual = base64urlDecode(parts[2]);
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
    const payload = JSON.parse(base64urlDecode(parts[1]).toString('utf-8'));
    if (payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch { return null; }
}
// ─────────────────────────────────────────────────────────

// 黑名单与用户追踪
let blacklist = new Set();
const clients = new Map();       // clientId → { ip, roomId, role, connectTime }
const adminIPs = new Set();      // 管理后台连接的 IP
try {
    const adminConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'admin-config.json'), 'utf-8'));
    if (adminConfig.blacklist) blacklist = new Set(adminConfig.blacklist);
} catch(e) { /* admin-config.json 不存在时忽略 */ }

function saveBlacklist() {
    try {
        const configPath = path.join(__dirname, 'admin-config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        config.blacklist = [...blacklist];
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    } catch(e) { /* 写入失败静默忽略 */ }
}

// ====
//  静态文件服务
// ====
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png':  'image/png',
    '.ico':  'image/x-icon',
    '.mp3':  'audio/mpeg',
    '.wav':  'audio/wav',
    '.ogg':  'audio/ogg',
    '.oga':  'audio/ogg',
};

// ── Frost ID OAuth config ──────────────────────────────
const AUTH_CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'auth-config.json'), 'utf-8'));
const verifierStore = new Map();
setInterval(() => { const now = Date.now(); for (const [k,v] of verifierStore) if (v.expiresAt < now) verifierStore.delete(k); }, 60000);

function b64url(buf) { return buf.toString('base64url'); }
function sigJWT(payload) {
  const h = b64url(Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})));
  const p = b64url(Buffer.from(JSON.stringify({...payload,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+604800})));
  const s = b64url(crypto.createHmac('sha256',JWT_SECRET).update(h+'.'+p).digest());
  return h+'.'+p+'.'+s;
}
function genV() { return b64url(crypto.randomBytes(32)); }
function genC(v) { return b64url(crypto.createHash('sha256').update(v).digest()); }

function htmlForCB(url, jwt, uname) {
  const store = jwt ? 'localStorage.setItem("blades_token","'+jwt+'");localStorage.setItem("blades_user",\'{"username":"'+uname+'"}\');' : '';
  return '<html><body><script>'+store+'if(window.opener){window.opener.location.reload();window.close()}else{location.href="'+url+'"}</script></body></html>';
}

function staticHandler(req, res) {
    const rawQuery = req.url.split('?')[1] || '';
    const query = new URLSearchParams(rawQuery);
    let urlPath = req.url.split('?')[0];
    try { urlPath = decodeURIComponent(urlPath); } catch (_) {}
    // Map the root (and any directory path) to its index file. Must run AFTER
    // stripping the query string, otherwise "/?token=..." stays as "/" and
    // path.join() resolves to the project directory → fs read → EISDIR crash.
    if (urlPath === '/' || urlPath.endsWith('/')) urlPath += 'index.html';

    // ── OAuth routes ────────────────────────────────────
    if (urlPath === '/auth/login') {
      const verifier = genV(); const challenge = genC(verifier); const rstate = b64url(crypto.randomBytes(16));
      const combined = b64url(Buffer.from(verifier + '|' + rstate, 'utf-8'));
      const params = new URLSearchParams({
        response_type:'code',client_id:AUTH_CFG.clientId,redirect_uri:AUTH_CFG.redirectUrl,
        code_challenge:challenge,code_challenge_method:'S256',state:combined,scope:'openid profile email'
      });
      res.writeHead(302,{Location:AUTH_CFG.authorizeUrl+'?'+params.toString()}); res.end();
      return;
    }
    if (urlPath === '/auth/callback') {
      const code = query.get('code'); const state = query.get('state'); const err = query.get('error');
      if (err) { res.end(htmlForCB('/?auth_error='+err)); return; }
      let verifier = null;
      try { const d = Buffer.from(state, 'base64url').toString('utf-8'); verifier = d.split('|')[0]; } catch(e) {}
      if (!verifier) { res.end(htmlForCB('/?auth_error=invalid_state')); return; }
      fetch(AUTH_CFG.tokenUrl,{method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:AUTH_CFG.redirectUrl,
          client_id:AUTH_CFG.clientId,client_secret:AUTH_CFG.clientSecret,code_verifier:verifier})
      }).then(r=>r.ok?r.json():Promise.reject('token'))
      .then(d=>d.access_token?fetch(AUTH_CFG.userinfoUrl||'http://127.0.0.1:4000/oauth/userinfo',{headers:{Authorization:'Bearer '+d.access_token}}):Promise.reject('no_token'))
      .then(ur=>ur.ok?ur.json():Promise.reject('userinfo'))
      .then(u=>{
        const jwt=sigJWT({sub:u.sub,email:u.email,preferred_username:u.username||u.email?.split('@')[0]||'User'});
        const uname=u.username||u.email?.split('@')[0]||'User';
        const params = new URLSearchParams({token:jwt,username:uname}).toString();
        res.end(htmlForCB('/?'+params, jwt, uname));
      })
      .catch(e=>res.end(htmlForCB('/?auth_error='+(typeof e==='string'?e:e.message))));
      return;
    }

    if (urlPath === '/discover') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ server: 'BladesOfHex', httpPort: HTTP_PORT, httpsPort: HTTPS_PORT }));
        return;
    }

    const filePath = path.join(__dirname, urlPath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';

    fs.stat(filePath, (err, stats) => {
        if (err || stats.isDirectory()) {
            // Missing file, or a directory path that has no index → 404.
            // Reading a directory as a stream would throw EISDIR and crash.
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found');
            return;
        }
        const fileSize = stats.size;
        const range = req.headers.range;

        // Guard: any read error (EISDIR, EACCES, mid-stream failure) must not
        // bubble up as an uncaught exception that takes the whole server down.
        const onStreamError = () => {
            if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end();
        };

        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunkSize = end - start + 1;

            if (start >= fileSize) {
                res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
                res.end();
                return;
            }

            const stream = fs.createReadStream(filePath, { start, end });
            stream.on('error', onStreamError);
            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunkSize,
                'Content-Type': contentType,
                'Cache-Control': 'no-cache'
            });
            stream.pipe(res);
        } else {
            res.writeHead(200, {
                'Content-Type': contentType,
                'Content-Length': fileSize,
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            });
            fs.createReadStream(filePath).on('error', onStreamError).pipe(res);
        }
    });
}

// ====
//  房间系统
// ====
const rooms = new Map(); // roomId → { id, players: Map<ws, {ready, role}>, gameStarted }

// 房间号池：1-9，取最小可用
const ZOMBIE_TIMEOUT = 2 * 60 * 1000; // 2 分钟

const availableIds = new Set(['1','2','3','4','5','6','7','8','9']);

function acquireRoomId() {
    if (availableIds.size === 0) return null;
    // 取最小数字
    const sorted = [...availableIds].sort((a, b) => Number(a) - Number(b));
    const id = sorted[0];
    availableIds.delete(id);
    return id;
}

function releaseRoomId(id) {
    availableIds.add(id);
}

function roomList() {
    const list = [];
    for (const [id, room] of rooms) {
        // 未开始的对局，或对局中有玩家断线（可重连）
        if (!room.gameStarted || room._disconnectedRole || (room._disconnectedRoles && Object.keys(room._disconnectedRoles).length > 0)) {
            list.push({ roomId: id, playerCount: room.players.size, maxPlayers: room.maxPlayers || 2, skirmishFog: room.skirmishFog || false });
        }
    }
    return list;
}

function sendJson(ws, obj) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(obj));
    }
}

function broadcastRoom(room, obj, exclude = null) {
    for (const ws of room.players.keys()) {
        if (ws !== exclude) sendJson(ws, obj);
    }
}

function startZombieTimer(room) {
    if (room._zombieTimer) return;
    room._zombieSince = Date.now();
    // 保留 gameStarted / _disconnectedRoles / _savedState 以便双方重连恢复
    room._zombieTimer = setTimeout(() => {
        if (room.players.size === 0) {
            delete room._savedState;
            delete room._disconnectedRoles;
            room._disconnectedRole = null;
            releaseRoomId(room.id);
            rooms.delete(room.id);
            console.log(`[房间 ${room.id}] 僵尸超时，已释放`);
        }
    }, ZOMBIE_TIMEOUT);
    console.log(`[房间 ${room.id}] 双方断开，15 分钟后释放（可重连恢复）`);
}

function clearZombieTimer(room) {
    if (room._zombieTimer) {
        clearTimeout(room._zombieTimer);
        room._zombieTimer = null;
    }
    room._zombieSince = null;
}

function reviveRoom(room, ws) {
    clearZombieTimer(room);
    room.gameStarted = false;
    for (const p of room.players.keys()) p._ready = false;
    console.log(`[房间 ${room.id}] 玩家重连，房间复活`);
}

function leaveCurrentRoom(ws) {
    const room = ws._room;
    if (!room) return;
    // 对局中断线，记住角色以便重连（按 clientId 映射，支持双方先后断线）
    if (room.gameStarted) {
        const role = room.players.get(ws)?.role || null;
        if (role) {
            if (!room._disconnectedRoles) room._disconnectedRoles = {};
            room._disconnectedRoles[role] = ws._clientId || null;
        }
    }
    room.players.delete(ws);
    ws._room = null;
    ws._ready = false;
    if (room.players.size === 0) {
        // 所有人都断开 → 进入僵尸状态，15 分钟后释放
        startZombieTimer(room);
    } else {
        clearZombieTimer(room);
        broadcastRoom(room, { type: 'opponentLeft' });
        // 对局中不重置 gameStarted，保留重连可能
        if (!room.gameStarted) {
            for (const p of room.players.keys()) p._ready = false;
        }
    }
}

// ====
//  WebSocket 处理
// ====
function handleMessage(ws, rawData) {
    let msg;
    try { msg = JSON.parse(rawData); } catch { return; }

    // admin 消息标记（管理后台自身连接不计入用户列表）
    if (msg.type && msg.type.startsWith('admin')) {
        ws._isAdmin = true;
        adminIPs.add(ws._ip);
    } else if (msg.type && !msg.type.startsWith('admin')) {
        // 非 admin 消息 → 真实玩家，从 adminIPs 移除
        adminIPs.delete(ws._ip);
    }

    switch (msg.type) {

        case 'hello': {
            if (msg.clientId) {
                ws._clientId = msg.clientId;
                clients.set(msg.clientId, { ip: ws._ip, roomId: null, role: null, connectTime: Date.now() });
            }
            break;
        }

        case 'createRoom': {
            leaveCurrentRoom(ws);
            const roomId = acquireRoomId();
            if (!roomId) {
                sendJson(ws, { type: 'error', message: '服务器房间已满（最多 9 个），请稍后再试' });
                break;
            }
            const maxPlayers = msg.maxPlayers || 2; // 默认双人，可选3人
            const skirmishFog = msg.skirmishFog || false;
            const room = { id: roomId, players: new Map(), gameStarted: false, maxPlayers, skirmishFog };
            room.players.set(ws, { role: 'player1' });
            rooms.set(roomId, room);
            ws._room = room;
            ws._ready = false;
            if (ws._clientId && clients.has(ws._clientId)) clients.get(ws._clientId).roomId = roomId;
            sendJson(ws, { type: 'roomCreated', roomId, role: 'player1', maxPlayers, playerCount: 1 });
            console.log(`[房间 ${roomId}] 已创建 (player1, ${maxPlayers}P)`);
            break;
        }

        case 'joinRoom': {
            const roomId = msg.roomId;
            if (!roomId || !rooms.has(roomId)) {
                sendJson(ws, { type: 'error', message: '房间不存在' });
                break;
            }
            const room = rooms.get(roomId);

            // 对局中重连（支持新旧两种断线记录格式）
            const hasDisconnected = room._disconnectedRole ||
                (room._disconnectedRoles && Object.keys(room._disconnectedRoles).length > 0);
            console.log(`[重连] 房间${roomId} joinRoom，gameStarted=${room.gameStarted}，hasDisconnected=${hasDisconnected}，_disconnectedRoles=` + JSON.stringify(room._disconnectedRoles));
            if (room.gameStarted && hasDisconnected) {
                console.log(`[重连] 对局重连流程，当前在线=${room.players.size}，maxPlayers=${room.maxPlayers}`);
                leaveCurrentRoom(ws);

                // 清理同一 clientId 的残留旧连接：闪断重连时服务器可能尚未感知旧 socket
                // 关闭，旧连接仍占用角色会导致重连方匹配到他人角色（阵营错乱）或被误判房间已满
                const cid = ws._clientId;
                if (cid) {
                    for (const [pws, pdata] of [...room.players]) {
                        if (pws !== ws && pws._clientId === cid) {
                            room.players.delete(pws);
                            pws._room = null;
                            if (!room._disconnectedRoles) room._disconnectedRoles = {};
                            room._disconnectedRoles[pdata.role] = cid;
                            try { pws.close(); } catch (e) { /* ignore */ }
                            console.log(`[重连] 清理同clientId残留连接，释放角色=${pdata.role}`);
                        }
                    }
                }

                if (room.players.size >= room.maxPlayers) {
                    console.log(`[重连] 房间已满，拒绝重连`);
                    sendJson(ws, { type: 'error', message: '房间已满' });
                    break;
                }
                if (room.players.size === 0) clearZombieTimer(room);

                // 按 clientId 找回断线前的角色（跳过仍在线的角色，避免顶掉正常玩家）
                console.log(`[重连] 客户端ID=${cid}，_disconnectedRoles=` + JSON.stringify(room._disconnectedRoles));
                const onlineRoles = new Set([...room.players.values()].map(p => p.role));
                let role = null;
                if (cid && room._disconnectedRoles) {
                    for (const [r, id] of Object.entries(room._disconnectedRoles)) {
                        if (id === cid && !onlineRoles.has(r)) { role = r; delete room._disconnectedRoles[r]; break; }
                    }
                    if (Object.keys(room._disconnectedRoles).length === 0) delete room._disconnectedRoles;
                }
                // 兼容旧格式
                if (!role && room._disconnectedRole && !onlineRoles.has(room._disconnectedRole)) {
                    role = room._disconnectedRole;
                    room._disconnectedRole = null;
                }
                if (!role) {
                    console.log(`[重连] 无法确定角色，断开`);
                    sendJson(ws, { type: 'error', message: '无法确定你的角色，请重新创建房间' });
                    break;
                }
                console.log(`[重连] 确定角色=${role}`);

                room.players.set(ws, { role });
                ws._room = room;
                ws._ready = false;
                if (ws._clientId && clients.has(ws._clientId)) clients.get(ws._clientId).roomId = roomId;
                sendJson(ws, { type: 'reconnected', roomId, role });
                console.log(`[重连] 已发送 reconnected 给重连方`);
                // 告知所有在线对手玩家重连了，各自恢复其角色确保 _myRole 正确
                const others = [...room.players.keys()].filter(p => p !== ws);
                if (others.length > 0) {
                    for (const p of others) {
                        const roleOfP = room.players.get(p)?.role || null;
                        sendJson(p, { type: 'opponentReconnected', role: roleOfP });
                    }
                    console.log(`[重连] 已发送 opponentReconnected 给 ${others.length} 个对手`);
                } else {
                    console.log(`[重连] 无对手在线`);
                }
                // 向重连方 + 所有在线对手同步暂存的对局状态
                console.log(`[重连] _savedState=` + (room._savedState ? '有' : '无'));
                if (room._savedState) {
                    const syncMsg = { type: 'action', actionType: 'stateSync', state: room._savedState };
                    sendJson(ws, syncMsg);
                    for (const p of others) sendJson(p, syncMsg);
                    console.log(`[房间 ${roomId}] 重连完成，已同步暂存状态`);
                } else {
                    console.log(`[房间 ${roomId}] 无暂存状态可同步！`);
                }
                console.log(`[房间 ${roomId}] 玩家重连为 ${role}，对局恢复`);
                break;
            }

            // 正常加入流程
            if (room.gameStarted && room.players.size >= room.maxPlayers) {
                sendJson(ws, { type: 'error', message: '房间对局已开始' });
                break;
            }
            if (room.players.size >= room.maxPlayers) {
                sendJson(ws, { type: 'error', message: '房间已满' });
                break;
            }
            leaveCurrentRoom(ws);
            if (room.players.size === 0) reviveRoom(room, ws);
            const nextIdx = room.players.size;
            const role = nextIdx === 0 ? 'player1' : nextIdx === 1 ? 'player2' : 'player3';
            room.players.set(ws, { role });
            ws._room = room;
            ws._ready = false;
            if (ws._clientId && clients.has(ws._clientId)) clients.get(ws._clientId).roomId = roomId;
            sendJson(ws, { type: 'roomJoined', roomId, role, maxPlayers: room.maxPlayers || 2, playerCount: room.players.size });
            // 通知房间内所有其他玩家（有人加入）+ 通知新玩家已有对手
            for (const [playerWs, playerData] of room.players) {
                if (playerWs !== ws && playerWs.readyState === WebSocket.OPEN) {
                    sendJson(playerWs, { type: 'opponentJoined', role: playerData.role });
                    // 告知新加入者已有对手
                    sendJson(ws, { type: 'opponentJoined', role: playerData.role });
                }
            }
            const total = room.players.size;
            const maxP = room.maxPlayers || 2;
            console.log(`[房间 ${roomId}] 玩家加入 (${total}/${maxP})`);
            break;
        }

        case 'unready': {
            const room = ws._room;
            if (!room || room.gameStarted) break;
            ws._ready = false;
            const others = [...room.players.keys()].filter(p => p !== ws);
            for (const o of others) sendJson(o, { type: 'opponentUnready' });
            break;
        }

        case 'listRooms': {
            sendJson(ws, { type: 'roomList', rooms: roomList() });
            break;
        }

        case 'leaveRoom': {
            leaveCurrentRoom(ws);
            sendJson(ws, { type: 'roomLeft' });
            break;
        }

        case 'ready': {
            const room = ws._room;
            if (!room || room.players.size < room.maxPlayers) break;
            ws._ready = true;
            const others = [...room.players.keys()].filter(p => p !== ws);
            for (const o of others) sendJson(o, { type: 'opponentReady' });
            const allReady = ws._ready && others.every(o => o._ready);
            if (allReady) {
                room.gameStarted = true;
                const players = [...room.players.keys()];
                const roles = room.maxPlayers === 3
                    ? ['player1', 'player2', 'player3']
                    : ['player1', 'player2'];
                // 随机打乱角色
                for (let i = roles.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [roles[i], roles[j]] = [roles[j], roles[i]];
                }
                for (let i = 0; i < players.length; i++) {
                    room.players.set(players[i], { ...room.players.get(players[i]), role: roles[i] });
                    sendJson(players[i], { type: 'start', role: roles[i], isThreePlayer: room.maxPlayers === 3, skirmishFog: room.skirmishFog || false });
                }
                console.log(`[房间 ${room.id}] ${room.maxPlayers}人准备完毕，游戏开始`);
            }
            break;
        }

        case 'rematch': {
            const room = ws._room;
            if (!room) break;
            ws._rematchReady = true;
            const other = [...room.players.keys()].find(p => p !== ws);
            if (other) sendJson(other, { type: 'rematchPending' });
            if (ws._rematchReady && other && other._rematchReady) {
                ws._rematchReady = false;
                other._rematchReady = false;
                ws._ready = false;
                other._ready = false;
                room.gameStarted = true;
                const roleA = Math.random() < 0.5 ? 'player1' : 'player2';
                const roleB = roleA === 'player1' ? 'player2' : 'player1';
                room.players.set(ws, { role: roleA });
                room.players.set(other, { role: roleB });
                sendJson(ws, { type: 'start', role: roleA, skirmishFog: room.skirmishFog || false });
                sendJson(other, { type: 'start', role: roleB, skirmishFog: room.skirmishFog || false });
                console.log(`[房间 ${room.id}] 再来一局`);
            }
            break;
        }

        case 'saveState': {
            const room = ws._room;
            if (!room || !room.gameStarted) break;
            room._savedState = msg.state;
            console.log(`[房间 ${room.id}] 已暂存游戏状态`);
            break;
        }

        case 'toast':
        case 'commanderSync': {
            const room = ws._room;
            if (!room) break;
            for (const [playerWs] of room.players) {
                if (playerWs !== ws && playerWs.readyState === WebSocket.OPEN) {
                    sendJson(playerWs, msg);
                }
            }
            break;
        }

        case 'action': {
            const room = ws._room;
            if (!room) break;
            // 每次动作都暂存状态，确保双方断线后均有最新状态可恢复
            if (msg.state) {
                room._savedState = msg.state;
                if (msg.state.cardDrawPile) console.log(`[房间 ${room.id}] 动作暂存: drawPile=${msg.state.cardDrawPile.length}，p1Hand=${(msg.state.playerHands||{}).player1?.length||0}，p2Hand=${(msg.state.playerHands||{}).player2?.length||0}`);
            }
            for (const [playerWs] of room.players) {
                if (playerWs !== ws && playerWs.readyState === WebSocket.OPEN) {
                    sendJson(playerWs, msg);
                }
            }
            break;
        }

        // ==== 管理后台消息 ====
        case 'adminListAll': {
            if (msg.token !== ADMIN_TOKEN) break;
            const allRooms = [];
            for (const [id, room] of rooms) {
                const playerList = [];
                for (const [pws, pinfo] of room.players) {
                    playerList.push({ role: pinfo.role, ready: pws._ready || false, ip: pws._ip || 'unknown' });
                }
                allRooms.push({
                    roomId: id, playerCount: room.players.size,
                    gameStarted: room.gameStarted, players: playerList,
                    zombieSince: room._zombieSince || null
                });
            }
            sendJson(ws, { type: 'adminRoomList', rooms: allRooms });
            break;
        }

        case 'adminCloseRoom': {
            if (msg.token !== ADMIN_TOKEN) break;
            const roomId = msg.roomId;
            const room = rooms.get(roomId);
            if (!room) { sendJson(ws, { type: 'adminCloseResult', roomId, ok: false, reason: '房间不存在' }); break; }
            broadcastRoom(room, { type: 'roomClosed', reason: '管理员关闭了房间' });
            for (const pws of room.players.keys()) {
                pws._room = null;
                try { pws.close(); } catch(e) {}
            }
            room.players.clear();
            clearZombieTimer(room);
            releaseRoomId(roomId);
            rooms.delete(roomId);
            console.log(`[房间 ${roomId}] 已被管理员强制关闭`);
            sendJson(ws, { type: 'adminCloseResult', roomId, ok: true });
            break;
        }

        case 'adminListUsers': {
            if (msg.token !== ADMIN_TOKEN) break;
            const users = [];
            for (const [clientId, info] of clients) {
                // 管理后台自身的连接不显示
                if (adminIPs.has(info.ip) && !info.roomId) continue;
                users.push({ ip: info.ip, clientId, roomId: info.roomId, role: info.role, connectTime: info.connectTime, banned: blacklist.has(info.ip) });
            }
            sendJson(ws, { type: 'adminUserList', users, blacklist: [...blacklist] });
            break;
        }

        case 'adminBanUser': {
            if (msg.token !== ADMIN_TOKEN) break;
            const banIp = msg.ip;
            if (!banIp) break;
            blacklist.add(banIp);
            saveBlacklist();
            // 踢掉该 IP 的所有连接
            for (const [id, room] of rooms) {
                for (const pws of room.players.keys()) {
                    if (pws._ip === banIp) {
                        sendJson(pws, { type: 'banned', message: '你已被管理员封禁' });
                        pws._room = null;
                        try { pws.close(); } catch(e) {}
                    }
                }
            }
            // 清理被踢玩家的房间状态和客户端记录
            for (const [id, room] of rooms) {
                let changed = false;
                for (const pws of room.players.keys()) {
                    if (pws._ip === banIp) { room.players.delete(pws); changed = true; }
                }
                if (changed && room.players.size === 0) startZombieTimer(room);
            }
            for (const [clientId, info] of clients) {
                if (info.ip === banIp) clients.delete(clientId);
            }
            console.log(`[管理] IP ${banIp} 已被封禁`);
            sendJson(ws, { type: 'adminBanResult', ip: banIp, ok: true });
            break;
        }

        case 'adminUnbanUser': {
            if (msg.token !== ADMIN_TOKEN) break;
            const unbanIp = msg.ip;
            if (!unbanIp) break;
            blacklist.delete(unbanIp);
            saveBlacklist();
            console.log(`[管理] IP ${unbanIp} 已解除封禁`);
            sendJson(ws, { type: 'adminUnbanResult', ip: unbanIp, ok: true });
            break;
        }

        case 'adminFlushRooms': {
            if (msg.token !== ADMIN_TOKEN) break;
            let count = 0;
            for (const [id, room] of rooms) {
                broadcastRoom(room, { type: 'roomClosed', reason: '管理员清空了所有房间' });
                for (const pws of room.players.keys()) {
                    pws._room = null;
                    try { pws.close(); } catch(e) {}
                }
                room.players.clear();
                clearZombieTimer(room);
                releaseRoomId(id);
                count++;
            }
            rooms.clear();
            console.log(`[管理] 已清空所有房间（共 ${count} 个）`);
            sendJson(ws, { type: 'adminFlushResult', count, ok: true });
            break;
        }

        case 'adminPing': {
            if (msg.token !== ADMIN_TOKEN) break;
            sendJson(ws, { type: 'adminPong', uptime: process.uptime() });
            break;
        }

        case 'chat': {
            const room = ws._room;
            if (!room) break;

            const senderEntry = room.players.get(ws);
            if (!senderEntry) break;
            const senderRole = senderEntry.role;

            const text = String(msg.text || '').trim().substring(0, 500);
            if (!text) break;

            const chatMsg = {
                type: 'chat',
                channel: msg.channel,
                text: text,
                senderRole: senderRole
            };

            if (msg.channel === 'private' && msg.targetRole) {
                chatMsg.targetRole = msg.targetRole;
                const targetWs = [...room.players.keys()].find(
                    p => room.players.get(p)?.role === msg.targetRole && p.readyState === 1
                );
                if (targetWs) {
                    sendJson(targetWs, chatMsg);
                    console.log(`[房间 ${room.id}] 私聊 ${senderRole} -> ${msg.targetRole}: ${text.substring(0, 30)}`);
                }
            } else if (msg.channel === 'room') {
                broadcastRoom(room, chatMsg, ws);
                console.log(`[房间 ${room.id}] 公聊 ${senderRole}: ${text.substring(0, 30)}`);
            }
            break;
        }

        default:
            break;
    }
}

function attachWebSocket(httpServer) {
    const wss = new WebSocket.Server({ server: httpServer });

    wss.on('connection', (ws, req) => {
        const ip = (req?.socket?.remoteAddress || ws._socket?.remoteAddress || 'unknown').replace(/^::ffff:/, '');
        ws._ip = ip;

        // Frost ID token verification
        const url = new URL(req.url, 'http://localhost');
        const token = url.searchParams.get('token');
        if (token) {
          const payload = verifyJWT(token);
          if (payload) {
            ws._userId = payload.sub;
            ws._username = payload.preferred_username || payload.email?.split('@')[0] || 'User';
          }
        }

        // 黑名单检查
        if (blacklist.has(ip)) {
            sendJson(ws, { type: 'banned', message: '你的IP已被管理员封禁' });
            ws.close();
            return;
        }

        ws._room = null;
        ws._ready = false;
        ws._rematchReady = false;
        ws._isAdmin = false;
        ws._clientId = null;

        ws.on('message', (data) => handleMessage(ws, data));

        ws.on('close', () => {
            const hadRoom = !!ws._room;
            leaveCurrentRoom(ws);
            if (ws._clientId) clients.delete(ws._clientId);
            if (hadRoom) console.log(`[连接] 玩家断线，当前房间数: ${rooms.size}`);
        });

        ws.on('error', () => {});
    });

    return wss;
}

// ====
//  启动服务器
// ====
const httpServer = http.createServer(staticHandler);
attachWebSocket(httpServer);
httpServer.listen(HTTP_PORT, () => {
    console.log(`HTTP  服务器已在 :${HTTP_PORT} 启动`);
});

const CERT_DIR = path.join(__dirname, 'certs');
const CERT_FILE = path.join(CERT_DIR, 'cert.pem');
const KEY_FILE = path.join(CERT_DIR, 'key.pem');

let httpsServer = null;

if (fs.existsSync(KEY_FILE) && fs.existsSync(CERT_FILE)) {
    const tlsOptions = {
        key:  fs.readFileSync(KEY_FILE),
        cert: fs.readFileSync(CERT_FILE),
    };
    httpsServer = https.createServer(tlsOptions, staticHandler);
    attachWebSocket(httpsServer);
    httpsServer.listen(HTTPS_PORT, '127.0.0.1', () => {
        console.log(`HTTPS 服务器已在 :${HTTPS_PORT} 启动`);
    });
} else {
    console.log('未检测到证书文件，仅启动 HTTP。运行 node generate-cert.js 可生成证书。');
}

// ====
//  启动提示
// ====
function getLocalIPs() {
    const nets = os.networkInterfaces();
    const ips = [];
    for (const iface of Object.values(nets)) {
        for (const n of iface) {
            if (n.family === 'IPv4' && !n.internal) ips.push(n.address);
        }
    }
    return ips;
}

const ips = getLocalIPs();

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  Blades of Hex — 联机服务器');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');
console.log('  本机访问:');
console.log(`    http://localhost:${HTTP_PORT}`);
if (httpsServer) console.log(`    https://localhost:${HTTPS_PORT}`);
console.log('');
console.log('  局域网地址:');
ips.forEach(ip => {
    console.log(`    http://${ip}:${HTTP_PORT}`);
    if (httpsServer) console.log(`    https://${ip}:${HTTPS_PORT}`);
});
if (ips.length === 0) console.log('    （未检测到局域网IP）');
console.log('');
console.log(`  HTTP  端口 : ${HTTP_PORT}`);
if (httpsServer) console.log(`  HTTPS 端口 : ${HTTPS_PORT}`);
console.log('  房间数 : 0');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');
