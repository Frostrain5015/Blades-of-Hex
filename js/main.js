import { loadSettings, settings, initCanvas } from './config.js';
import { gameState, updateUI, logMessage, applyRemoteState, initLogToggle } from './state.js';
import { setGameStateRef } from './HexTile.js';
import { setLogMessageRef, setGameStateRefForUnit } from './Unit.js';
import { initMap, triggerVictoryEffect } from './gameLogic.js';
import { renderGame } from './renderer.js';
import { initInput, initKeyboard, initSettingsPanel } from './input.js';
import { connectToServer, setNetworkCallbacks } from './network.js';
import {
    clearTransientEffects, triggerTurnFlash,
    triggerAttackFlash, triggerRecruitFlash,
    spawnExplosionParticles, spawnDirectionalParticles,
    spawnRecruitEffect, spawnSlashMarks,
    triggerScreenShake
} from './effects.js';
import { HexTile } from './HexTile.js';
import { Unit } from './Unit.js';
import { playSound } from './audio.js';
import './cheat.js';

loadSettings();
initCanvas();
setGameStateRef(gameState);
setLogMessageRef(logMessage);
setGameStateRefForUnit(gameState);
initLogToggle();

// ==== 移动端横屏自适应 ===================
const GAME_BASE_W = 1260; // canvas 1000 + panel 256 + gaps ~12
const GAME_BASE_H = 810;  // canvas 750 + topbar ~48 + gaps

function fitToViewport() {
    const wrapper = document.getElementById('gameWrapper');
    const lobby = document.getElementById('lobbyOverlay');
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Only scale on small screens
    if (vw >= GAME_BASE_W && vh >= GAME_BASE_H) {
        wrapper.style.transform = '';
        lobby.style.transform = '';
        return;
    }

    const scaleX = vw / GAME_BASE_W;
    const scaleY = vh / GAME_BASE_H;
    const scale = Math.min(scaleX, scaleY, 1);

    wrapper.style.transform = `scale(${scale})`;
    wrapper.style.transformOrigin = 'top left';
    // Center vertically if height-constrained
    if (scaleY < scaleX) {
        const offsetX = (vw - GAME_BASE_W * scale) / 2;
        wrapper.style.marginLeft = offsetX + 'px';
    } else {
        wrapper.style.marginLeft = '0';
    }

    lobby.style.transform = `scale(${Math.min(vw / 400, vh / 560, 1)})`;
    lobby.style.transformOrigin = 'center center';
}

window.addEventListener('resize', fitToViewport);
window.addEventListener('orientationchange', () => setTimeout(fitToViewport, 200));
fitToViewport();

// ==== 游戏循环（始终运行，画布隐藏时无开销） ===================
function gameLoop() {
    renderGame();
    requestAnimationFrame(gameLoop);
}
requestAnimationFrame(gameLoop);

// ==== 大厅 UI ===================
const lobbyOverlay   = document.getElementById('lobbyOverlay');
const localModeBtn   = document.getElementById('localModeBtn');
const hostModeBtn    = document.getElementById('hostModeBtn');
const joinModeBtn    = document.getElementById('joinModeBtn');
const joinForm       = document.getElementById('joinForm');
const connectBtn     = document.getElementById('connectBtn');
const backBtn        = document.getElementById('backBtn');
const serverIpInput  = document.getElementById('serverIpInput');
const lobbyStatus    = document.getElementById('lobbyStatus');

function setStatus(msg, isError = false) {
    lobbyStatus.textContent = msg;
    lobbyStatus.style.color = isError ? '#ff6666' : '#ffdd88';
}

function showModes() {
    localModeBtn.style.display = '';
    hostModeBtn.style.display  = '';
    joinModeBtn.style.display  = '';
    joinForm.style.display = 'none';
}

function hideModes() {
    localModeBtn.style.display = 'none';
    hostModeBtn.style.display  = 'none';
    joinModeBtn.style.display  = 'none';
}

// ==== 阵营揭示动画（联机模式开局前） ----
function showFactionReveal(role) {
    const overlay = document.getElementById('factionReveal');
    const dice = document.getElementById('factionRevealDice');
    const text = document.getElementById('factionRevealText');
    const isRed = role === 'player1';
    const campName = isRed ? '红军' : '蓝军';
    const campColor = isRed ? '#ffaaaa' : '#aaaaff';

    overlay.classList.add('show');
    dice.classList.remove('landed');
    text.classList.remove('show');
    text.textContent = '';

    // Phase 1: dice spinning (~1.2s)
    setTimeout(() => {
        // Phase 2: dice lands, reveal faction
        dice.classList.add('landed');
        text.textContent = `你是指挥官 · ${campName}`;
        text.style.color = campColor;
        text.classList.add('show');
    }, 1200);

    // Phase 3: dismiss and start (~2.5s total)
    setTimeout(() => {
        overlay.classList.remove('show');
        startGame(role);
    }, 2500);
}

// ==== 开始游戏（本地或联机均调用此函数） ----
function startGame(networkRole) {
    lobbyOverlay.style.display = 'none';
    document.getElementById('gameWrapper').style.display = '';

    initMap();
    initInput();
    initKeyboard();
    initSettingsPanel();
    updateUI();

    if (networkRole) {
        const isRed = networkRole === 'player1';
        const roleLabel = isRed ? '🔴 红军' : '🔵 蓝军';
        const indicator = document.getElementById('networkIndicator');
        indicator.style.display = 'flex';
        document.getElementById('networkRoleText').textContent = `联机 | 你是 ${roleLabel}`;

        // 联机模式隐藏存档/读档按钮（防止状态不同步）
        document.getElementById('saveGameBtn').style.display = 'none';
        document.getElementById('loadGameBtn').style.display = 'none';

        logMessage(`联网对战开始 — 你控制${roleLabel}`);
        if (!isRed) {
            // 蓝军等待红军先手
            logMessage('等待红军玩家操作...');
        }
    }
}

// ==== 本地模式 ----
localModeBtn.addEventListener('click', () => startGame(null));

// ==== 创建联网对战（主机） ----
hostModeBtn.addEventListener('click', () => {
    hideModes();
    setStatus('正在连接本机服务器...');
    setupNetworkAndConnect('ws://localhost:8080');
});

// ==== 加入联网对战 ----
const LAST_IP_KEY = 'bladesOfHex_lastIp';
const joinModeChoice = document.getElementById('joinModeChoice');
const manualForm = document.getElementById('manualForm');
const autoScanBtn = document.getElementById('autoScanBtn');
const manualConnectBtn = document.getElementById('manualConnectBtn');
const backToChoiceBtn = document.getElementById('backToChoiceBtn');

joinModeBtn.addEventListener('click', () => {
    hideModes();
    joinForm.style.display = 'flex';
    joinModeChoice.style.display = '';
    manualForm.style.display = 'none';
    setStatus('');
});

function getSubnetFromIp(ip) {
    const parts = ip.split('.');
    if (parts.length !== 4) return null;
    return `${parts[0]}.${parts[1]}.${parts[2]}`;
}

async function discoverLAN() {
    const lastIp = localStorage.getItem(LAST_IP_KEY);
    const subnet = lastIp ? getSubnetFromIp(lastIp) : null;
    const subnetsToScan = subnet ? [subnet] : ['192.168.1', '192.168.0', '192.168.31', '10.0.0'];
    const promises = [];
    for (const subnet of subnetsToScan) {
        for (let i = 1; i <= 254; i++) {
            const ip = `${subnet}.${i}`;
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 600);
            promises.push(
                fetch(`http://${ip}:3000/discover`, { signal: ctrl.signal })
                    .then(r => r.json())
                    .then(data => { clearTimeout(t); if (data.server === 'BladesOfHex') return ip; })
                    .catch(() => { clearTimeout(t); return null; })
            );
        }
    }
    const results = await Promise.all(promises);
    return results.filter(Boolean);
}

// 自动扫描 → 连第一个
autoScanBtn.addEventListener('click', async () => {
    joinModeChoice.style.display = 'none';
    setStatus('正在扫描局域网...');
    const hosts = await discoverLAN();
    if (hosts.length === 0) {
        setStatus('未发现局域网主机，请尝试手动连接', true);
        joinModeChoice.style.display = '';
        return;
    }
    const ip = hosts[0];
    localStorage.setItem(LAST_IP_KEY, ip);
    joinForm.style.display = 'none';
    setStatus(`自动连接 ${ip}...`);
    setupNetworkAndConnect(`ws://${ip}:8080`);
});

function isValidIPv4(ip) {
    if (!ip) return false;
    if (/[^\d.]/.test(ip)) return false;
    const parts = ip.split('.');
    if (parts.length !== 4) return false;
    return parts.every(p => {
        if (p === '' || (p.length > 1 && p[0] === '0')) return false;
        const n = parseInt(p, 10);
        return n >= 0 && n <= 255;
    });
}

function updateConnectBtnState() {
    connectBtn.disabled = !isValidIPv4(serverIpInput.value.trim());
}

// 手动连接 → 展开填写区域
manualConnectBtn.addEventListener('click', () => {
    joinModeChoice.style.display = 'none';
    manualForm.style.display = '';
    const lastIp = localStorage.getItem(LAST_IP_KEY);
    if (lastIp) serverIpInput.value = lastIp;
    updateConnectBtnState();
});

serverIpInput.addEventListener('input', updateConnectBtnState);

connectBtn.addEventListener('click', () => {
    const ip = serverIpInput.value.trim();
    localStorage.setItem(LAST_IP_KEY, ip);
    joinForm.style.display = 'none';
    setStatus(`正在连接 ${ip}...`);
    setupNetworkAndConnect(`ws://${ip}:8080`);
});

backBtn.addEventListener('click', () => {
    showModes();
    setStatus('');
});

backToChoiceBtn.addEventListener('click', () => {
    manualForm.style.display = 'none';
    joinModeChoice.style.display = '';
    setStatus('');
});

// ==== 建立网络连接并注册回调 ----
function setupNetworkAndConnect(url) {
    setNetworkCallbacks({
        onAssigned: () => {
            setStatus('已连接到房间，等待阵营分配...');
        },
        onWaiting: () => setStatus('等待对手加入...'),
        onStart: (role) => showFactionReveal(role),
        onRemoteAction: handleRemoteAction,
        onOpponentLeft: () => {
            const banner = document.getElementById('opponentTurnBanner');
            if (banner) {
                banner.innerHTML = '<span>⚠</span><span>对手已断开连接</span>';
                banner.style.display = 'flex';
                banner.style.color = '#ff8888';
            }
            logMessage('⚠ 对手已断开连接');
        }
    });

    connectToServer(url).catch(err => {
        setStatus(`连接失败：${err.message}`, true);
        showModes();
        joinForm.style.display = url.includes('localhost') ? 'none' : 'flex';
    });
}

// ==== 处理对手发来的操作 ----
function handleRemoteAction(msg) {
    const wasGameOver = gameState.gameOver;
    applyRemoteState(msg.state, HexTile, Unit);
    // 不清除特效，让旧特效自然淡出，新特效叠加上去

    if (gameState.gameOver && !wasGameOver) {
        triggerVictoryEffect();
        return;
    }

    const e = msg.effects;
    switch (msg.actionType) {
        case 'move':
            if (e) {
                const movedUnit = gameState.tiles.reduce((found, t) =>
                    found || (t.unit?.id === e.unitId ? t.unit : null), null);
                if (movedUnit) movedUnit.startMovePath([{ x: e.fromX, y: e.fromY }, { x: movedUnit.tile.x, y: movedUnit.tile.y }]);
            }
            break;
        case 'endTurn':
            playSound('turnEnd');
            triggerTurnFlash(gameState.currentCamp.color);
            break;
        case 'attack':
            playSound(e?.isCrit ? 'crit' : 'attack');
            if (e) {
                triggerAttackFlash(e.x, e.y, e.isCrit);
                spawnDirectionalParticles(e.fromX ?? e.x, e.fromY ?? e.y, e.x, e.y, '#ff8844', e.isCrit ? 22 : 10);
                spawnSlashMarks(e.x, e.y, e.fromX ?? e.x, e.fromY ?? e.y, e.isCrit);
                triggerScreenShake(e.isCrit ? 6 : 3, e.isCrit ? 200 : 120);
                if (e.killed) {
                    spawnExplosionParticles(e.x, e.y, '#ff2200', 30);
                    spawnExplosionParticles(e.x, e.y, '#ffaa00', 15);
                    triggerScreenShake(4, 150);
                }
            }
            break;
        case 'recruit':
            playSound('recruit');
            if (e) {
                triggerRecruitFlash(e.x, e.y);
                spawnRecruitEffect(e.x, e.y);
            }
            break;
    }
}
