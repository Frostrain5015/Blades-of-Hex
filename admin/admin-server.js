const http      = require('http');
const fs        = require('fs');
const path      = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');

// ==== 配置 =====================
const PROJECT_ROOT = path.join(__dirname, '..');
let config = { adminPort: 3099, gameHttpPort: 3000, gameHttpsPort: 3443, password: 'admin', blacklist: [], notes: {} };
try {
    config = { ...config, ...JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'admin-config.json'), 'utf-8')) };
} catch(e) { console.log('未检测到 admin-config.json，使用默认配置'); }

const ADMIN_TOKEN = 'blades-of-hex-admin-v2';

function saveConfig() {
    try {
        fs.writeFileSync(path.join(PROJECT_ROOT, 'admin-config.json'), JSON.stringify(config, null, 2), 'utf-8');
    } catch(e) {}
}

// 检测依赖是否已安装
function isDepsInstalled() {
    return fs.existsSync(path.join(PROJECT_ROOT, 'node_modules', 'ws'));
}

// 检测是否已注册开机自启
function isAutoStartRegistered() {
    try {
        const startupDir = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
        return fs.existsSync(path.join(startupDir, 'BladesOfHex-Admin.vbs'));
    } catch(e) { return false; }
}

// 刷新客户端缓存（递增 index.html 版本号）
function bumpClientCache() {
    const indexPath = path.join(PROJECT_ROOT, 'index.html');
    let html = fs.readFileSync(indexPath, 'utf-8');
    const match = html.match(/main\.js\?v=(\d+)/);
    if (match) {
        const newVer = parseInt(match[1]) + 1;
        html = html.replace(/main\.js\?v=\d+/, 'main.js?v=' + newVer);
        fs.writeFileSync(indexPath, html, 'utf-8');
        return newVer;
    }
    return null;
}

// 定期推送内存占用
setInterval(() => {
    const mem = process.memoryUsage();
    broadcastToAuthed({ type: 'memUpdate', memMB: Math.round(mem.heapUsed / 1024 / 1024) });
}, 10000);

// ==== 游戏进程管理器 ===========
let gameProcess = null;
let gameStartTime = null;
let gameStatus = 'stopped'; // 'stopped' | 'starting' | 'running'

function killGameProcess() {
    if (!gameProcess) return;
    try {
        if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', String(gameProcess.pid), '/f', '/t'], { stdio: 'ignore' });
        } else {
            gameProcess.kill('SIGTERM');
            setTimeout(() => { try { gameProcess.kill('SIGKILL'); } catch(e) {} }, 5000);
        }
    } catch(e) { /* 进程已退出 */ }
}

function spawnGameServer() {
    const env = {
        ...process.env,
        HTTP_PORT: String(config.gameHttpPort),
        HTTPS_PORT: String(config.gameHttpsPort)
    };
    // detached + unref: 游戏服独立于管理后台进程，关闭 CMD 窗口也不影响
    gameProcess = spawn('node', ['server.js'], {
        cwd: PROJECT_ROOT, env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true
    });
    gameProcess.unref();
    gameStatus = 'starting';
    gameStartTime = Date.now();
    broadcastToAuthed({ type: 'serverStatus', status: 'starting' });
    addLogLine('[管理] 游戏服务器启动中...', 'admin');

    gameProcess.stdout.on('data', (chunk) => { handleProcessOutput(chunk, 'stdout'); });
    gameProcess.stderr.on('data', (chunk) => { handleProcessOutput(chunk, 'stderr'); });

    gameProcess.on('exit', (code) => {
        addLogLine(`[管理] 游戏服务器已退出 (code=${code})`, 'admin');
        gameProcess = null;
        gameStartTime = null;
        gameStatus = 'stopped';
        broadcastToAuthed({ type: 'serverStatus', status: 'stopped' });
    });

    gameProcess.on('error', (err) => {
        addLogLine(`[管理] 游戏服务器启动失败: ${err.message}`, 'stderr');
        gameProcess = null;
        gameStatus = 'stopped';
        broadcastToAuthed({ type: 'serverStatus', status: 'stopped' });
    });

    // 延迟检测进程是否成功启动
    setTimeout(() => {
        if (gameProcess && gameStatus === 'starting') {
            gameStatus = 'running';
            broadcastToAuthed({ type: 'serverStatus', status: 'running', uptime: 0 });
        }
    }, 2000);
}

// ==== 日志系统 =================
const logBuffer = [];
const MAX_LOG_BUFFER = 300;
let stdoutRemainder = '';
let stderrRemainder = '';

function addLogLine(text, level) {
    logBuffer.push({ text, level, time: Date.now() });
    if (logBuffer.length > MAX_LOG_BUFFER) logBuffer.shift();
    broadcastToAuthed({ type: 'log', text, level });
}

function handleProcessOutput(chunk, level) {
    const remainder = level === 'stdout' ? 'stdoutRemainder' : 'stderrRemainder';
    const lines = (eval(remainder) + chunk.toString()).split('\n');
    eval(`${remainder} = lines.pop()`);
    for (const line of lines) {
        if (!line.trim()) continue;
        addLogLine(line, level);
    }
}

// ==== 游戏服 WebSocket 代理 ====
function proxyToGameServer(message, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${config.gameHttpPort}`);
        const timer = setTimeout(() => { try { ws.close(); } catch(e) {}; reject(new Error('proxy timeout')); }, timeoutMs);
        ws.on('open', () => ws.send(JSON.stringify(message)));
        ws.on('message', (data) => { clearTimeout(timer); resolve(JSON.parse(data.toString())); ws.close(); });
        ws.on('error', () => { clearTimeout(timer); reject(new Error('proxy connect error')); });
    });
}

// ==== 静态文件服务 =============
const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon'
};

function staticHandler(req, res) {
    let urlPath = req.url === '/' ? '/admin.html' : req.url.split('?')[0];
    const filePath = path.join(__dirname, urlPath);
    const ext = path.extname(filePath).toLowerCase();
    if (!MIME[ext]) { res.writeHead(404); res.end('404'); return; }
    fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('404'); return; }
        res.writeHead(200, { 'Content-Type': MIME[ext] });
        res.end(data);
    });
}

// ==== WebSocket 服务 ===========
const httpServer = http.createServer(staticHandler);
const wss = new WebSocket.Server({ server: httpServer });

function sendJson(ws, obj) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); }
function broadcastToAuthed(obj) {
    for (const client of wss.clients) {
        if (client._authenticated) sendJson(client, obj);
    }
}

wss.on('connection', (ws) => {
    ws._authenticated = false;

    ws.on('message', async (data) => {
        let msg;
        try { msg = JSON.parse(data); } catch { return; }

        if (!ws._authenticated && msg.type !== 'auth') {
            sendJson(ws, { type: 'error', message: '请先登录' }); return;
        }

        switch (msg.type) {
            case 'auth': {
                if (msg.password === config.password) {
                    ws._authenticated = true;
                    sendJson(ws, { type: 'authResult', ok: true });
                    // 发送当前状态
                    sendJson(ws, { type: 'serverStatus', status: gameStatus,
                        uptime: gameStartTime ? Date.now() - gameStartTime : 0 });
                    sendJson(ws, { type: 'serverInfo', httpPort: config.gameHttpPort, httpsPort: config.gameHttpsPort });
                    sendJson(ws, { type: 'initState', installed: isDepsInstalled() });
                    sendJson(ws, { type: 'autoStartState', registered: isAutoStartRegistered() });
                    sendJson(ws, { type: 'memUpdate', memMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) });
                    // 发送历史日志
                    for (const entry of logBuffer) sendJson(ws, { type: 'log', text: entry.text, level: entry.level });
                } else {
                    sendJson(ws, { type: 'authResult', ok: false, message: '密码错误' });
                }
                break;
            }

            case 'startServer': {
                if (gameProcess) { sendJson(ws, { type: 'error', message: '服务器已在运行' }); break; }
                spawnGameServer();
                break;
            }

            case 'stopServer': {
                if (!gameProcess) { sendJson(ws, { type: 'error', message: '服务器未运行' }); break; }
                killGameProcess();
                break;
            }

            case 'restartServer': {
                if (gameProcess) {
                    killGameProcess();
                    const checkExit = setInterval(() => {
                        if (!gameProcess) { clearInterval(checkExit); spawnGameServer(); }
                    }, 300);
                } else {
                    spawnGameServer();
                }
                break;
            }

            case 'listRooms': {
                if (!gameProcess || gameStatus !== 'running') {
                    sendJson(ws, { type: 'roomList', rooms: [] }); break;
                }
                try {
                    const res = await proxyToGameServer({ type: 'adminListAll', token: ADMIN_TOKEN });
                    broadcastToAuthed({ type: 'roomList', rooms: res.rooms || [] });
                } catch(e) {
                    sendJson(ws, { type: 'error', message: '无法连接游戏服务器' });
                }
                break;
            }

            case 'closeRoom': {
                if (!gameProcess || gameStatus !== 'running') {
                    sendJson(ws, { type: 'error', message: '服务器未运行' }); break;
                }
                try {
                    const res = await proxyToGameServer({ type: 'adminCloseRoom', roomId: msg.roomId, token: ADMIN_TOKEN });
                    sendJson(ws, { type: 'closeRoomResult', ...res });
                    // 刷新房间列表
                    const listRes = await proxyToGameServer({ type: 'adminListAll', token: ADMIN_TOKEN });
                    broadcastToAuthed({ type: 'roomList', rooms: listRes.rooms || [] });
                } catch(e) {
                    sendJson(ws, { type: 'error', message: '无法连接游戏服务器' });
                }
                break;
            }

            case 'listUsers': {
                if (!gameProcess || gameStatus !== 'running') {
                    sendJson(ws, { type: 'userList', users: [], blacklist: [] }); break;
                }
                try {
                    const res = await proxyToGameServer({ type: 'adminListUsers', token: ADMIN_TOKEN });
                    const users = (res.users || []).map(u => ({
                        ...u,
                        note: (config.notes && config.notes[u.ip]) || null
                    }));
                    sendJson(ws, { type: 'userList', users, blacklist: res.blacklist || [] });
                } catch(e) {
                    sendJson(ws, { type: 'error', message: '无法连接游戏服务器' });
                }
                break;
            }

            case 'banUser': {
                if (!gameProcess || gameStatus !== 'running') {
                    sendJson(ws, { type: 'error', message: '服务器未运行' }); break;
                }
                try {
                    const res = await proxyToGameServer({ type: 'adminBanUser', ip: msg.ip, token: ADMIN_TOKEN });
                    sendJson(ws, { type: 'banResult', ...res });
                } catch(e) {
                    sendJson(ws, { type: 'error', message: '无法连接游戏服务器' });
                }
                break;
            }

            case 'unbanUser': {
                if (!gameProcess || gameStatus !== 'running') {
                    sendJson(ws, { type: 'error', message: '服务器未运行' }); break;
                }
                try {
                    const res = await proxyToGameServer({ type: 'adminUnbanUser', ip: msg.ip, token: ADMIN_TOKEN });
                    sendJson(ws, { type: 'unbanResult', ...res });
                } catch(e) {
                    sendJson(ws, { type: 'error', message: '无法连接游戏服务器' });
                }
                break;
            }

            case 'addUserNote': {
                const ip = msg.ip;
                const note = (msg.note || '').trim().slice(0, 100);
                if (!ip) break;
                if (!config.notes) config.notes = {};
                if (note) {
                    config.notes[ip] = note;
                    addLogLine(`[管理] 已为 ${ip} 添加备注: ${note}`, 'admin');
                } else {
                    delete config.notes[ip];
                    addLogLine(`[管理] 已清除 ${ip} 的备注`, 'admin');
                }
                saveConfig();
                sendJson(ws, { type: 'noteUpdated', ip, note: note || null });
                break;
            }

            case 'flushRooms': {
                if (!gameProcess || gameStatus !== 'running') {
                    sendJson(ws, { type: 'error', message: '服务器未运行' }); break;
                }
                try {
                    const res = await proxyToGameServer({ type: 'adminFlushRooms', token: ADMIN_TOKEN });
                    sendJson(ws, { type: 'flushResult', ...res });
                    addLogLine(`[管理] 已清空全部房间（${res.count} 个）`, 'admin');
                } catch(e) {
                    sendJson(ws, { type: 'error', message: '无法连接游戏服务器' });
                }
                break;
            }

            case 'npmInstall': {
                addLogLine('[管理] 开始安装依赖 (npm install)...', 'admin');
                const npmProc = spawn('npm', ['install'], { cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'pipe'], shell: true });
                npmProc.stdout.on('data', (c) => addLogLine(c.toString().trim(), 'stdout'));
                npmProc.stderr.on('data', (c) => addLogLine(c.toString().trim(), 'stderr'));
                npmProc.on('exit', (code) => {
                    addLogLine(`[管理] npm install ${code === 0 ? '成功' : '失败 (code=' + code + ')'}`, code === 0 ? 'stdout' : 'stderr');
                });
                break;
            }

            case 'generateCert': {
                addLogLine('[管理] 开始生成 TLS 证书...', 'admin');
                const certProc = spawn('node', ['generate-cert.js', '--force'], { cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
                certProc.stdout.on('data', (c) => addLogLine(c.toString().trim(), 'stdout'));
                certProc.stderr.on('data', (c) => addLogLine(c.toString().trim(), 'stderr'));
                certProc.on('exit', (code) => {
                    addLogLine(`[管理] 证书生成${code === 0 ? '成功' : '失败 (code=' + code + ')'}`, code === 0 ? 'stdout' : 'stderr');
                });
                break;
            }

            case 'exportLogs': {
                const text = logBuffer.map(e => `[${new Date(e.time).toISOString()}] ${e.text}`).join('\n');
                sendJson(ws, { type: 'logExport', text });
                break;
            }

            case 'toggleAutoStart': {
                try {
                    const startupDir = process.platform === 'win32'
                        ? path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
                        : null;
                    if (!startupDir) { sendJson(ws, { type: 'error', message: '仅支持 Windows' }); break; }
                    const shortcutPath = path.join(startupDir, 'BladesOfHex-Admin.vbs');
                    if (fs.existsSync(shortcutPath)) {
                        fs.unlinkSync(shortcutPath);
                        addLogLine('[管理] 已取消开机自启', 'admin');
                        sendJson(ws, { type: 'autoStartState', registered: false });
                    } else {
                        const vbsPath = path.join(PROJECT_ROOT, 'start-admin-silent.vbs');
                        const batPath = path.join(PROJECT_ROOT, 'start-admin.bat');
                        const vbsContent = 'CreateObject("Wscript.Shell").Run """' + batPath.replace(/\\/g, '\\\\') + '""", 0, False';
                        fs.writeFileSync(vbsPath, vbsContent, 'utf-8');
                        fs.copyFileSync(vbsPath, shortcutPath);
                        addLogLine('[管理] 已注册开机自启', 'admin');
                        sendJson(ws, { type: 'autoStartState', registered: true });
                    }
                } catch(e) {
                    sendJson(ws, { type: 'error', message: '操作失败: ' + e.message });
                }
                break;
            }

            case 'bumpCache': {
                const ver = bumpClientCache();
                if (ver) {
                    addLogLine(`[管理] 客户端缓存已刷新 (v${ver})`, 'admin');
                    sendJson(ws, { type: 'cacheBumped', version: ver });
                } else {
                    sendJson(ws, { type: 'error', message: '缓存刷新失败' });
                }
                break;
            }

            case 'updatePorts': {
                if (msg.httpPort) config.gameHttpPort = Number(msg.httpPort);
                if (msg.httpsPort) config.gameHttpsPort = Number(msg.httpsPort);
                sendJson(ws, { type: 'portsUpdated', httpPort: config.gameHttpPort, httpsPort: config.gameHttpsPort });
                addLogLine(`[管理] 端口配置已更新 (HTTP:${config.gameHttpPort} HTTPS:${config.gameHttpsPort})，需重启生效`, 'admin');
                break;
            }

            case 'getServerInfo': {
                sendJson(ws, { type: 'serverInfo', httpPort: config.gameHttpPort, httpsPort: config.gameHttpsPort,
                    uptime: gameStartTime ? Date.now() - gameStartTime : 0, gameStatus });
                break;
            }

            default: break;
        }
    });
});

// ==== 游戏服健康检查 ==========
async function checkGameServer() {
    if (!gameProcess) return;
    try {
        await proxyToGameServer({ type: 'adminPing', token: ADMIN_TOKEN }, 3000);
        if (gameStatus !== 'running') {
            gameStatus = 'running';
            broadcastToAuthed({ type: 'serverStatus', status: 'running', uptime: gameStartTime ? Date.now() - gameStartTime : 0 });
        }
    } catch(e) {
        if (gameStatus === 'running') {
            gameStatus = 'stopped';
            gameProcess = null;
            gameStartTime = null;
            addLogLine('[管理] 游戏服务器无响应，已标记为停止', 'stderr');
            broadcastToAuthed({ type: 'serverStatus', status: 'stopped' });
        }
    }
}

// 启动时检测残留游戏服
setTimeout(async () => {
    try {
        const ws = new WebSocket(`ws://localhost:${config.gameHttpPort}`);
        ws.on('open', () => {
            ws.send(JSON.stringify({ type: 'adminPing', token: ADMIN_TOKEN }));
        });
        ws.on('message', (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'adminPong') {
                gameStatus = 'running';
                gameStartTime = Date.now() - (msg.uptime || 0) * 1000;
                addLogLine('[管理] 检测到正在运行的游戏服务器，已接管', 'admin');
                broadcastToAuthed({ type: 'serverStatus', status: 'running', uptime: Date.now() - gameStartTime });
            }
            ws.close();
        });
        ws.on('error', () => {});
        setTimeout(() => { try { ws.close(); } catch(e) {} }, 3000);
    } catch(e) {}
}, 1500);

// 定期健康检查（每30秒）
setInterval(checkGameServer, 30000);

// ==== 进程退出清理 ============
// 仅清理自身，不连带杀死游戏服务器（独立生命周期）
process.on('SIGINT', () => { process.exit(0); });
process.on('SIGTERM', () => { process.exit(0); });

// ==== 启动 =====================
httpServer.listen(config.adminPort, () => {
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  Blades of Hex — 管理后台');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log(`  管理后台: http://localhost:${config.adminPort}`);
    console.log(`  默认密码: ${config.password}`);
    console.log('');
    console.log('  游戏服务器需在管理面板中手动启动。');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
});
