let ws = null, authenticated = false, autoScroll = true;
let _autoStartOn = false, _depsInstalled = true;

const loginScreen = document.getElementById('loginScreen');
const dashboard = document.getElementById('dashboard');
const loginError = document.getElementById('loginError');
const statusBadge = document.getElementById('statusBadge');
const statusLabel = document.getElementById('statusLabel');
const uptimeDisplay = document.getElementById('uptimeDisplay');
const memDisplay = document.getElementById('memDisplay');
const roomGrid = document.getElementById('roomGrid');
const roomListEmpty = document.getElementById('roomListEmpty');
const logTerminal = document.getElementById('logTerminal');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const restartBtn = document.getElementById('restartBtn');
const autoStartBtn = document.getElementById('autoStartBtn');
const initBtn = document.getElementById('initServerBtn');

function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);
    ws.onmessage = ({ data }) => {
        let msg; try { msg = JSON.parse(data); } catch { return; }
        switch (msg.type) {
            case 'authResult':
                if (msg.ok) { authenticated = true; loginScreen.style.display = 'none'; dashboard.style.display = ''; }
                else loginError.textContent = msg.message || '密码错误';
                break;
            case 'serverStatus': updateServerStatus(msg.status, msg.uptime); break;
            case 'serverInfo':
                document.getElementById('httpPortInput').value = msg.httpPort;
                document.getElementById('httpsPortInput').value = msg.httpsPort;
                break;
            case 'initState': updateInitState(msg.installed); break;
            case 'autoStartState': updateAutoStartBtn(msg.registered); break;
            case 'memUpdate': memDisplay.textContent = msg.memMB + ' MB'; break;
            case 'roomList': renderRoomList(msg.rooms || []); break;
            case 'log': appendLog(msg.text, msg.level); break;
            case 'logExport': downloadText(msg.text, 'blades-of-hex-logs.txt'); break;
            case 'closeRoomResult':
                if (!msg.ok) alert('关闭失败: ' + (msg.reason || '未知错误'));
                else send({ type: 'listRooms' });
                break;
            case 'flushResult': if (msg.ok) alert('已清空 ' + msg.count + ' 个房间'); break;
            case 'cacheBumped': alert('客户端缓存已刷新 (v' + msg.version + ')，用户刷新页面即可获取最新版本'); break;
            case 'portsUpdated': alert('端口已更新，需重启游戏服务器生效'); break;
            case 'error': alert(msg.message); break;
        }
    };
    ws.onclose = () => { authenticated = false; };
}

function send(msg) {
	    if (ws && ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(msg)); return; }
	    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
	        loginError.textContent = '连接已断开，请刷新页面重试';
	        document.getElementById('passwordInput').disabled = true;
	        document.getElementById('loginBtn').disabled = true;
	    }
	}

function updateServerStatus(status, uptime) {
    const prev = statusBadge.className.replace('status-badge ', '').replace(' transition', '');
    statusBadge.className = 'status-badge ' + status + (prev !== status ? ' transition' : '');
    statusLabel.textContent = status === 'running' ? '运行中' : status === 'starting' ? '启动中...' : '已停止';
    startBtn.disabled = status === 'running' || status === 'starting';
    stopBtn.disabled = status !== 'running';
    restartBtn.disabled = status !== 'running';
    uptimeDisplay.textContent = status === 'running' && uptime != null ? formatUptime(uptime) : '';
    if (status === 'running') send({ type: 'listRooms' });
}

function updateInitState(installed) {
    _depsInstalled = installed;
    initBtn.disabled = installed;
    if (installed) initBtn.textContent = '初始化服务器 (已就绪)';
}

function updateAutoStartBtn(registered) {
    _autoStartOn = registered;
    autoStartBtn.textContent = registered ? '取消开机自启' : '注册开机自启';
    autoStartBtn.className = 'admin-btn ' + (registered ? 'danger' : 'secondary');
}

function formatUptime(ms) {
    if (!ms || ms < 0) return '';
    const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return (h ? h + 'h ' : '') + (m ? m + 'm ' : '') + sec + 's';
}

function renderRoomList(rooms) {
    roomGrid.innerHTML = '';
    if (!rooms || rooms.length === 0) { roomGrid.style.display = 'none'; roomListEmpty.style.display = ''; return; }
    roomGrid.style.display = ''; roomListEmpty.style.display = 'none';
    for (const r of rooms) {
        let sc, st;
        if (r.gameStarted) { sc = 'playing'; st = '对局中'; }
        else if (r.zombieSince) { sc = 'zombie'; st = '僵尸'; }
        else { sc = 'waiting'; st = '等待中'; }
        const ips = r.players && r.players.length ? r.players.map(p => p.ip).join('  ·  ') : '暂无玩家';
        const card = document.createElement('div');
        card.className = 'admin-room-card' + (r.gameStarted ? ' in-progress' : '');
        card.innerHTML =
            `<span class="admin-room-card-id">${r.roomId}</span>` +
            `<div class="admin-room-card-body">` +
                `<div class="admin-room-card-row">` +
                    `<span class="admin-room-card-count">${r.playerCount} / 2 人</span>` +
                    `<span class="admin-room-card-status ${sc}">${st}</span>` +
                `</div>` +
                `<div class="admin-room-card-row"><span class="admin-room-card-ips">${ips}</span></div>` +
            `</div>` +
            `<button class="admin-btn tiny danger admin-room-card-close" data-room="${r.roomId}">关闭</button>`;
        roomGrid.appendChild(card);
    }
    roomGrid.querySelectorAll('.admin-room-card-close').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            if (confirm('确定要强制关闭房间 ' + btn.dataset.room + ' 吗？')) send({ type: 'closeRoom', roomId: btn.dataset.room });
        });
    });
}

function appendLog(text, level) {
    const line = document.createElement('div');
    line.className = 'log-line log-' + (level || 'stdout');
    line.textContent = new Date().toLocaleTimeString() + ' ' + text;
    logTerminal.appendChild(line);
    if (autoScroll) logTerminal.scrollTop = logTerminal.scrollHeight;
    while (logTerminal.children.length > 500) logTerminal.firstChild.remove();
}

function downloadText(text, filename) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' })); a.download = filename; a.click();
}

// ==== Events ====
document.getElementById('loginBtn').addEventListener('click', () => {
    loginError.textContent = '';
    send({ type: 'auth', password: document.getElementById('passwordInput').value });
});
document.getElementById('passwordInput').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('loginBtn').click(); });

document.getElementById('refreshRoomsBtn').addEventListener('click', () => send({ type: 'listRooms' }));

startBtn.addEventListener('click', () => send({ type: 'startServer' }));
stopBtn.addEventListener('click', () => { if (confirm('确定要停止游戏服务器吗？')) send({ type: 'stopServer' }); });
restartBtn.addEventListener('click', () => { if (confirm('确定要重启游戏服务器吗？')) send({ type: 'restartServer' }); });
document.getElementById('applyPortsBtn').addEventListener('click', () => {
    send({ type: 'updatePorts', httpPort: +document.getElementById('httpPortInput').value, httpsPort: +document.getElementById('httpsPortInput').value });
});

initBtn.addEventListener('click', () => {
    if (!_depsInstalled || confirm('依赖已安装，确定要重新运行安装吗？')) send({ type: 'npmInstall' });
});
document.getElementById('generateCertBtn').addEventListener('click', () => send({ type: 'generateCert' }));
document.getElementById('flushRoomsBtn').addEventListener('click', () => {
    if (confirm('确定要清空所有房间吗？不可恢复！')) send({ type: 'flushRooms' });
});
document.getElementById('exportLogsBtn').addEventListener('click', () => send({ type: 'exportLogs' }));
autoStartBtn.addEventListener('click', () => {
    if (_autoStartOn && !confirm('确定要取消开机自启吗？')) return;
    send({ type: 'toggleAutoStart' });
});
document.getElementById('clearLogBtn').addEventListener('click', () => { logTerminal.innerHTML = ''; });
document.getElementById('bumpCacheBtn').addEventListener('click', () => {
    if (confirm('确定要刷新客户端缓存吗？所有玩家需要刷新页面才能获取更新。')) send({ type: 'bumpCache' });
});
document.getElementById('autoScrollCheck').addEventListener('change', e => { autoScroll = e.target.checked; });
document.getElementById('logoutBtn').addEventListener('click', () => { if (ws) ws.close(); location.reload(); });

connect();
