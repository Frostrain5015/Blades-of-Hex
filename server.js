const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const WebSocket = require('ws');

const HTTP_PORT = 3000;
const WS_PORT   = 8080;

// ====
//  静态文件服务（HTTP :3000）
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

const httpServer = http.createServer((req, res) => {
    // 默认首页
    let urlPath = req.url === '/' ? '/index.html' : req.url;
    // 去掉查询字符串
    urlPath = urlPath.split('?')[0];

    // LAN 发现端点
    if (urlPath === '/discover') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ server: 'BladesOfHex', wsPort: WS_PORT }));
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
});

httpServer.listen(HTTP_PORT);

// ====
//  WebSocket 中继服务器（WS :8080）
// ====
const rooms = [];

function findOrCreateRoom() {
    const waiting = rooms.find(r => r.players.length === 1);
    if (waiting) return waiting;
    const room = { players: [] };
    rooms.push(room);
    return room;
}

const wss = new WebSocket.Server({ port: WS_PORT });

wss.on('connection', (ws) => {
    const room = findOrCreateRoom();
    room.players.push(ws);
    ws.room = room;
    ws.role = room.players.length === 1 ? 'player1' : 'player2';

    ws.send(JSON.stringify({ type: 'assigned' }));

    if (room.players.length === 1) {
        ws.send(JSON.stringify({ type: 'waiting' }));
        console.log('[房间] 玩家已连接，等待对手加入...');
    } else {
        // 双方到齐，分配阵营但不自动开始——等双方都点准备
        const roleA = Math.random() < 0.5 ? 'player1' : 'player2';
        const roleB = roleA === 'player1' ? 'player2' : 'player1';
        room.players[0].role = roleA;
        room.players[1].role = roleB;
        room.players[0].send(JSON.stringify({ type: 'opponentJoined', role: roleA }));
        room.players[1].send(JSON.stringify({ type: 'opponentJoined', role: roleB }));
        console.log(`[房间] 双方已连接（等待准备确认）`);
    }

    ws.on('message', (data) => {
        let msg;
        try { msg = JSON.parse(data); } catch { return; }
        // 再来一局
        if (msg.type === 'rematch') {
            ws._rematchReady = true;
            const other = ws.room.players.find(p => p !== ws);
            if (other) other.send(JSON.stringify({ type: 'rematchPending' }));
            if (ws._rematchReady && other && other._rematchReady) {
                ws._rematchReady = false;
                other._rematchReady = false;
                const roleA = Math.random() < 0.5 ? 'player1' : 'player2';
                const roleB = roleA === 'player1' ? 'player2' : 'player1';
                ws.room.players[0].role = roleA;
                ws.room.players[1].role = roleB;
                ws.room.players[0].send(JSON.stringify({ type: 'start', role: roleA }));
                ws.room.players[1].send(JSON.stringify({ type: 'start', role: roleB }));
                console.log('[房间] 双方再来一局，游戏开始！');
            }
            return;
        }
        // 普通游戏动作转发
        const other = ws.room.players.find(p => p !== ws);
        if (other && other.readyState === WebSocket.OPEN) {
            other.send(data.toString());
        }
    });

    ws.on('close', () => {
        ws.room.players = ws.room.players.filter(p => p !== ws);
        const other = ws.room.players[0];
        if (other && other.readyState === WebSocket.OPEN) {
            other.send(JSON.stringify({ type: 'opponentLeft' }));
        }
        if (ws.room.players.length === 0) {
            const idx = rooms.indexOf(ws.room);
            if (idx !== -1) rooms.splice(idx, 1);
        }
        console.log(`[房间] 玩家断线，剩余房间数: ${rooms.length}`);
    });

    ws.on('error', () => {});
});

// ====
//  启动提示
// ====
function getLocalIPs() {
    const os = require('os');
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
console.log('  Blades of Hex — 局域网联机服务器');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');
console.log('  【玩家A（主机，你）】');
console.log('  打开浏览器访问：');
console.log('    http://localhost:3000');
console.log('  进入游戏后点击 "创建联网对战"');
console.log('');
console.log('  【玩家B（对手，无需安装任何东西）】');
console.log('  将以下任意地址发给对手，让他在浏览器打开：');
ips.forEach(ip => console.log(`    http://${ip}:3000`));
if (ips.length === 0) console.log('    （未检测到局域网IP，请手动查询）');
console.log('  对手打开后点击 "加入联网对战"，输入你的IP地址');
console.log('');
console.log('  WebSocket 端口 : 8080');
console.log('  HTTP 游戏页面  : 3000');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');
