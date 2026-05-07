const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');
const crypto = require('crypto');
const WebSocket = require('ws');

const HTTP_PORT  = process.env.HTTP_PORT  || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;

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
};

function staticHandler(req, res) {
    let urlPath = req.url === '/' ? '/index.html' : req.url;
    urlPath = urlPath.split('?')[0];

    if (urlPath === '/discover') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ server: 'BladesOfHex', httpPort: HTTP_PORT, httpsPort: HTTPS_PORT }));
        return;
    }

    const filePath = path.join(__dirname, urlPath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found');
            return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
}

// ====
//  房间系统
// ====
const rooms = new Map(); // roomId → { id, players: Map<ws, {ready, role}>, gameStarted }

// 房间号池：1-9，取最小可用
const ZOMBIE_TIMEOUT = 15 * 60 * 1000; // 15 分钟

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
        if (!room.gameStarted || room._disconnectedRole) {
            list.push({ roomId: id, playerCount: room.players.size });
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
    // 对局作废，清除重连标记
    room.gameStarted = false;
    room._disconnectedRole = null;
    room._zombieTimer = setTimeout(() => {
        if (room.players.size === 0) {
            releaseRoomId(room.id);
            rooms.delete(room.id);
            console.log(`[房间 ${room.id}] 僵尸超时，已释放`);
        }
    }, ZOMBIE_TIMEOUT);
    console.log(`[房间 ${room.id}] 双方断开，15 分钟后释放`);
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
    // 对局中断线，记住角色以便重连
    if (room.gameStarted) {
        room._disconnectedRole = room.players.get(ws)?.role || null;
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

    switch (msg.type) {

        case 'createRoom': {
            leaveCurrentRoom(ws);
            const roomId = acquireRoomId();
            if (!roomId) {
                sendJson(ws, { type: 'error', message: '服务器房间已满（最多 9 个），请稍后再试' });
                break;
            }
            const room = { id: roomId, players: new Map(), gameStarted: false };
            room.players.set(ws, { role: 'player1' });
            rooms.set(roomId, room);
            ws._room = room;
            ws._ready = false;
            sendJson(ws, { type: 'roomCreated', roomId, role: 'player1' });
            console.log(`[房间 ${roomId}] 已创建 (player1)`);
            break;
        }

        case 'joinRoom': {
            const roomId = msg.roomId;
            if (!roomId || !rooms.has(roomId)) {
                sendJson(ws, { type: 'error', message: '房间不存在' });
                break;
            }
            const room = rooms.get(roomId);

            // 对局中重连
            if (room.gameStarted && room._disconnectedRole) {
                if (room.players.size >= 2) {
                    sendJson(ws, { type: 'error', message: '房间已满' });
                    break;
                }
                leaveCurrentRoom(ws);
                if (room.players.size === 0) clearZombieTimer(room);
                const role = room._disconnectedRole;
                room._disconnectedRole = null;
                room.players.set(ws, { role });
                ws._room = room;
                ws._ready = false;
                sendJson(ws, { type: 'reconnected', roomId, role });
                // 告诉对手玩家重连了，需要同步状态
                const other = [...room.players.keys()].find(p => p !== ws);
                if (other) {
                    sendJson(other, { type: 'opponentReconnected' });
                }
                console.log(`[房间 ${roomId}] 玩家重连为 ${role}，对局恢复`);
                break;
            }

            // 正常加入流程
            if (room.gameStarted && room.players.size >= 2) {
                sendJson(ws, { type: 'error', message: '房间对局已开始' });
                break;
            }
            if (room.players.size >= 2) {
                sendJson(ws, { type: 'error', message: '房间已满' });
                break;
            }
            leaveCurrentRoom(ws);
            if (room.players.size === 0) reviveRoom(room, ws);
            const role = room.players.size === 0 ? 'player1' : 'player2';
            room.players.set(ws, { role });
            ws._room = room;
            ws._ready = false;
            sendJson(ws, { type: 'roomJoined', roomId, role });
            const other = [...room.players.keys()].find(p => p !== ws);
            if (other) {
                const otherRole = role === 'player1' ? 'player2' : 'player1';
                sendJson(other, { type: 'opponentJoined', role: otherRole });
                sendJson(ws, { type: 'opponentJoined', role: role === 'player1' ? 'player2' : 'player1' });
                console.log(`[房间 ${roomId}] 双方到齐`);
            } else {
                console.log(`[房间 ${roomId}] 玩家加入（等待对手）`);
            }
            break;
        }

        case 'unready': {
            const room = ws._room;
            if (!room || room.gameStarted) break;
            ws._ready = false;
            const other = [...room.players.keys()].find(p => p !== ws);
            if (other) sendJson(other, { type: 'opponentUnready' });
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
            if (!room || room.players.size < 2) break;
            ws._ready = true;
            const other = [...room.players.keys()].find(p => p !== ws);
            if (other) sendJson(other, { type: 'opponentReady' });
            if (ws._ready && other && other._ready) {
                // 双方都准备 → 开始对局
                room.gameStarted = true;
                const players = [...room.players.keys()];
                const roleA = Math.random() < 0.5 ? 'player1' : 'player2';
                const roleB = roleA === 'player1' ? 'player2' : 'player1';
                room.players.set(players[0], { ...room.players.get(players[0]), role: roleA });
                room.players.set(players[1], { ...room.players.get(players[1]), role: roleB });
                sendJson(players[0], { type: 'start', role: roleA });
                sendJson(players[1], { type: 'start', role: roleB });
                console.log(`[房间 ${room.id}] 双方准备完毕，游戏开始`);
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
                sendJson(ws, { type: 'start', role: roleA });
                sendJson(other, { type: 'start', role: roleB });
                console.log(`[房间 ${room.id}] 再来一局`);
            }
            break;
        }

        case 'commanderSync':
        case 'action': {
            // 游戏动作转发给房间内另一人
            const room = ws._room;
            if (!room) break;
            const other = [...room.players.keys()].find(p => p !== ws);
            if (other) sendJson(other, msg);
            break;
        }

        default:
            break;
    }
}

function attachWebSocket(httpServer) {
    const wss = new WebSocket.Server({ server: httpServer });

    wss.on('connection', (ws) => {
        ws._room = null;
        ws._ready = false;
        ws._rematchReady = false;

        ws.on('message', (data) => handleMessage(ws, data));

        ws.on('close', () => {
            leaveCurrentRoom(ws);
            console.log(`[连接] 玩家断线，当前房间数: ${rooms.size}`);
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
    httpsServer.listen(HTTPS_PORT, () => {
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
