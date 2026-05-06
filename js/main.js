import { loadSettings, initCanvas, canvas, LOGICAL_W, LOGICAL_H, HEX_SIZE, COMMANDER_CONFIG, shuffleAndSplitPool } from './config.js';
import { gameState, updateUI, logMessage, applyRemoteState, notify, dismissToast, updateStatsPanel, updateRecruitCostDisplay, serializeState, finalizeDeployment } from './state.js';
import { setGameStateRef as setHexTileGameStateRef } from './HexTile.js';
import { setLogMessageRef, setGameStateRef } from './Unit.js';
import { initMap, triggerVictoryEffect } from './gameLogic.js';
import { renderGame } from './renderer.js';
import { initInput, initKeyboard, initSettingsPanel } from './input.js';
import { connectToServer, setNetworkCallbacks, getMyRole, sendMessage, isNetworkGame, syncCommanderState, sendAction } from './network.js';
import { CAMP } from './config.js';
import {
    clearTransientEffects, triggerTurnFlash,
    triggerAttackFlash, triggerRecruitFlash,
    spawnExplosionParticles, spawnDirectionalParticles,
    spawnRecruitEffect, spawnSlashMarks,
    triggerScreenShake, spawnMoraleEffect, spawnCommanderSkillEffect
} from './effects.js';
import { HexTile } from './HexTile.js';
import { Unit } from './Unit.js';
import { playSound } from './audio.js';
import './cheat.js';

loadSettings();
initCanvas();
setHexTileGameStateRef(gameState);
setLogMessageRef(logMessage);
setGameStateRef(gameState);

// ==== 自适应布局 ====
function fitCanvas() {
    const wrapper = document.getElementById('canvasWrapper');
    const cw = wrapper.clientWidth;
    const ch = wrapper.clientHeight;
    const scale = Math.min(cw / LOGICAL_W, ch / LOGICAL_H);
    canvas.style.width  = Math.floor(LOGICAL_W * scale) + 'px';
    canvas.style.height = Math.floor(LOGICAL_H * scale) + 'px';
}

window.addEventListener('resize', fitCanvas);
window.addEventListener('orientationchange', () => setTimeout(fitCanvas, 200));
// Initial fit is called in startGame after gameWrapper becomes visible

// ==== 游戏循环（始终运行，画布隐藏时无开销） ===================
function gameLoop() {
    renderGame();

    // Animate tooltip speed and ATK display
    const ttip = document.getElementById('unitTooltip');
    if (ttip.classList.contains('visible') && gameState.selectedTile && gameState.selectedTile.unit) {
        const spdEl = document.getElementById('tooltipSpd');
        const atkEl = document.getElementById('tooltipAtk');
        const u = gameState.selectedTile.unit;
        const mpRemaining = Math.round(u.displaySpeed);
        let cost = 0;
        if (gameState.selectedUnit === u && gameState.hoveredTile && gameState.moveParents) {
            const entry = gameState.moveParents.get(gameState.hoveredTile);
            if (entry && gameState.movableTiles.includes(gameState.hoveredTile) && !gameState.hoveredTile.unit) {
                const afterMove = entry.remaining;
                cost = mpRemaining - afterMove;
            }
        }
        if (spdEl) {
            spdEl.innerHTML = cost > 0
                ? `<span style="color:#6cf;">⚡ ${mpRemaining}(-${cost})/${u.config.speed}</span>`
                : `<span style="color:#6cf;">⚡ ${mpRemaining}/${u.config.speed}</span>`;
        }
        if (atkEl) {
            const effAtk = u.getEffectiveAttack();
            const atkDelta = effAtk - u.config.attack;
            if (atkDelta !== 0) {
                const sign = atkDelta > 0 ? '+' : '';
                const deltaColor = atkDelta > 0 ? '#ffd700' : '#b080e8';
                atkEl.innerHTML = `<span style="color:#ff6;">⚔ ${effAtk}<span style="font-size:10px;color:${deltaColor};">(${sign}${atkDelta})</span></span>`;
            } else {
                atkEl.innerHTML = `<span style="color:#ff6;">⚔ ${effAtk}</span>`;
            }
        }
    } else if (ttip.classList.contains('visible') && !gameState.selectedTile) {
        ttip.classList.remove('visible');
    }

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
        if (isNetworkGame()) {
            beginNetworkCommanderFlow(role);
        } else {
            startGame(role);
        }
    }, 2500);
}

// ==== 开始游戏（本地或联机均调用此函数） ----
function startGame(networkRole) {
    lobbyOverlay.style.display = 'none';
    document.getElementById('gameWrapper').style.display = '';
    document.getElementById('lobbyReady').style.display = 'none';
    document.getElementById('lobbyReadyBtn').disabled = false;
    document.getElementById('lobbyReadyBtn').textContent = '准备';

    // 重置胜利/断线残留状态
    document.body.style.pointerEvents = '';
    document.getElementById('victoryOverlay').classList.remove('show');
    document.getElementById('rematchStatus').textContent = '';
    dismissToast();

    fitCanvas();
    initMap();
    initInput();
    initKeyboard();
    initSettingsPanel();
    updateUI();
    // 跳过将领流程（直接开始或联机模式）
    gameState.commanderPhase = 'done';

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

// ==== 准备按钮 ----
document.getElementById('lobbyReadyBtn').addEventListener('click', () => {
    sendMessage({ type: 'rematch' });
    document.getElementById('lobbyReadyBtn').disabled = true;
    document.getElementById('lobbyReadyBtn').textContent = '已准备';
    document.getElementById('lobbyReadyStatus').textContent = '等待对手准备...';
});

// ==== 再来一局 ----
document.getElementById('rematchBtn').addEventListener('click', () => {
    const statusEl = document.getElementById('rematchStatus');
    if (isNetworkGame()) {
        sendMessage({ type: 'rematch' });
        statusEl.textContent = '等待对手确认...';
    } else {
        // 本地模式直接重开
        document.getElementById('victoryOverlay').classList.remove('show');
        document.body.style.pointerEvents = '';
        startGame(null);
    }
});

// ==== 本地模式 ----
localModeBtn.addEventListener('click', () => {
    hideModes();
    beginCommanderPhase();
});

// ==== 将领选择流程 =====================
let _commanderPending = null;
let _commanderTransitioning = false; // 防止移动端双击重复触发

function beginCommanderPhase() {
    document.getElementById('lobbyOverlay').style.display = 'none';
    const pool = shuffleAndSplitPool();
    gameState.commanderPoolP1 = pool.p1;
    gameState.commanderPoolP2 = pool.p2;
    gameState.commanderP1 = null;
    gameState.commanderP2 = null;
    gameState.commanderP1Confirmed = false;
    gameState.commanderP2Confirmed = false;
    gameState.commanderP1Deployed = false;
    gameState.commanderP2Deployed = false;
    gameState.commanderPhase = 'selection';
    _showCommanderSelection('player1');
}

function beginNetworkCommanderFlow(role) {
    document.getElementById('lobbyOverlay').style.display = 'none';
    gameState.commanderP1 = null;
    gameState.commanderP2 = null;
    gameState.commanderP1Confirmed = false;
    gameState.commanderP2Confirmed = false;
    gameState.commanderP1Deployed = false;
    gameState.commanderP2Deployed = false;
    gameState.commanderPhase = 'selection';

    const myRole = getMyRole();
    if (myRole === 'player1') {
        // 主机生成将池并同步
        const pool = shuffleAndSplitPool();
        gameState.commanderPoolP1 = pool.p1;
        gameState.commanderPoolP2 = pool.p2;
        syncCommanderState(pool.p1, pool.p2, null, null, false, false, false, false, 'selection');
        _showCommanderSelection('player1');
    } else {
        // 客机等待主机同步将池
        _waitForNetworkPool('player2');
    }
}

function _waitForNetworkPool(forPlayer) {
    const pool = forPlayer === 'player1' ? gameState.commanderPoolP1 : gameState.commanderPoolP2;
    if (pool && pool.length > 0) {
        _showCommanderSelection(forPlayer);
    } else {
        setTimeout(() => _waitForNetworkPool(forPlayer), 200);
    }
}

function _showCommanderSelection(forPlayer) {
    const overlay = document.getElementById('commanderOverlay');
    const title = document.getElementById('commanderTitle');
    const cardsDiv = document.getElementById('commanderCards');
    const statusDiv = document.getElementById('commanderStatus');
    const pool = forPlayer === 'player1' ? gameState.commanderPoolP1 : gameState.commanderPoolP2;
    const campName = forPlayer === 'player1' ? '红军' : '蓝军';
    const campColor = forPlayer === 'player1' ? '#ffaaaa' : '#aaaaff';

    _commanderPending = null;
    title.textContent = `${campName} — 选择将领`;
    title.style.color = campColor;
    statusDiv.textContent = '点击将领预选，再次点击确认';
    statusDiv.style.color = '#888';
    cardsDiv.innerHTML = '';

    for (const key of pool) {
        const cfg = COMMANDER_CONFIG[key];
        const card = document.createElement('div');
        card.className = 'commander-card';
        card.id = `cmd-card-${key}`;
        const bonusParts = [];
        if (cfg.hpBonus) bonusParts.push(`HP+${cfg.hpBonus}`);
        if (cfg.atkBonus) bonusParts.push(`ATK+${cfg.atkBonus}`);
        if (cfg.spdBonus) bonusParts.push(`SPD+${cfg.spdBonus}`);
        card.innerHTML = `
            <div class="commander-card-name">★ ${cfg.name}</div>
            <div class="commander-card-skill">【${cfg.skill}】</div>
            <div class="commander-card-bonus">${bonusParts.join(' ')}</div>
            <div class="commander-card-desc">${cfg.desc}</div>
        `;
        card.addEventListener('click', () => {
            if (card.classList.contains('confirmed')) return;
            if (_commanderPending === key) {
                // 确认
                card.classList.remove('selected');
                card.classList.add('confirmed');
                if (forPlayer === 'player1') {
                    gameState.commanderP1 = key;
                    gameState.commanderP1Confirmed = true;
                } else {
                    gameState.commanderP2 = key;
                    gameState.commanderP2Confirmed = true;
                }
                statusDiv.textContent = '已确认 ✓';
                statusDiv.style.color = '#4CAF50';
                // 禁用其他卡片
                cardsDiv.querySelectorAll('.commander-card').forEach(c => {
                    if (!c.classList.contains('confirmed')) c.style.pointerEvents = 'none';
                });
                _commanderPending = null;
                // 联机模式同步选将
                if (isNetworkGame()) {
                    syncCommanderState(
                        gameState.commanderPoolP1, gameState.commanderPoolP2,
                        gameState.commanderP1, gameState.commanderP2,
                        gameState.commanderP1Confirmed, gameState.commanderP2Confirmed,
                        gameState.commanderP1Deployed, gameState.commanderP2Deployed,
                        gameState.commanderPhase
                    );
                }
                _onCommanderSelected(forPlayer);
            } else {
                // 预选
                cardsDiv.querySelectorAll('.commander-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                _commanderPending = key;
                statusDiv.textContent = `已预选【${cfg.name}】，再次点击确认`;
                statusDiv.style.color = '#ffd700';
            }
        });
        cardsDiv.appendChild(card);
    }

    overlay.classList.add('show');
}

function _onCommanderSelected(forPlayer) {
    if (_commanderTransitioning) return;
    _commanderTransitioning = true;
    if (isNetworkGame()) {
        _checkBothConfirmed();
    } else if (forPlayer === 'player1') {
        setTimeout(() => { _showCommanderSelection('player2'); _commanderTransitioning = false; }, 800);
    } else {
        setTimeout(() => {
            document.getElementById('commanderOverlay').classList.remove('show');
            gameState.commanderPhase = 'deployment';
            startGameDeployment();
            _commanderTransitioning = false;
        }, 800);
    }
}

function _checkBothConfirmed() {
    if (gameState.commanderP1Confirmed && gameState.commanderP2Confirmed) {
        setTimeout(() => {
            document.getElementById('commanderOverlay').classList.remove('show');
            gameState.commanderPhase = 'deployment';
            startGameDeployment();
        }, 800);
    }
}

function startGameDeployment() {
    const lobbyOverlay = document.getElementById('lobbyOverlay');
    lobbyOverlay.style.display = 'none';
    document.getElementById('gameWrapper').style.display = '';
    document.getElementById('lobbyReady').style.display = 'none';
    document.getElementById('lobbyReadyBtn').disabled = false;
    document.getElementById('lobbyReadyBtn').textContent = '准备';
    document.body.style.pointerEvents = '';
    document.getElementById('victoryOverlay').classList.remove('show');
    document.getElementById('rematchStatus').textContent = '';
    dismissToast();
    fitCanvas();
    initMap();
    initInput();
    initKeyboard();
    initSettingsPanel();
    updateUI();
    // 禁止操作直到双方部署完毕
    gameState.currentCamp = CAMP.player1;
    updateButtonColors();
    notify('请红军选择目标单位部署将领（选中后二次点击确认）');
}

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
            notify('对手已断开连接', 'warn', true);
            logMessage('⚠ 对手已断开连接');
        },
        onRematchPending: () => {
            document.getElementById('lobbyReadyStatus').textContent = '对手已准备！';
        },
        onOpponentJoined: (role) => {
            dismissToast();
            hideModes();
            document.getElementById('lobbyReady').style.display = '';
            document.getElementById('lobbyReadyStatus').textContent = '';
            setStatus('对手已连接，点击准备开始对局');
        },
        onCommanderSync: (msg) => {
            const hadPool = gameState.commanderPoolP1.length > 0;
            gameState.commanderPoolP1 = msg.commanderPoolP1 || [];
            gameState.commanderPoolP2 = msg.commanderPoolP2 || [];
            gameState.commanderP1 = msg.commanderP1 || null;
            gameState.commanderP2 = msg.commanderP2 || null;
            gameState.commanderP1Confirmed = msg.commanderP1Confirmed || false;
            gameState.commanderP2Confirmed = msg.commanderP2Confirmed || false;
            gameState.commanderP1Deployed = msg.commanderP1Deployed || false;
            gameState.commanderP2Deployed = msg.commanderP2Deployed || false;
            gameState.commanderPhase = msg.commanderPhase || 'selection';
            // 客机收到将池后显示选将界面
            if (!hadPool && gameState.commanderPoolP2.length > 0 && gameState.commanderPhase === 'selection') {
                const myRole = getMyRole();
                _showCommanderSelection(myRole);
            }
            // 对方确认后检查是否双方都确认（仅在selection阶段）
            if (gameState.commanderPhase === 'selection') {
                _checkBothConfirmed();
            }
            // 对方部署后检查是否双方都部署完毕（仅在deployment阶段，避免覆盖deployDone同步）
            if (gameState.commanderPhase === 'deployment' &&
                gameState.commanderP1Deployed && gameState.commanderP2Deployed) {
                gameState.commanderPhase = 'done';
                gameState.currentCamp = CAMP.player1;
                if (isNetworkGame()) sendAction('deployDone', serializeState());
                for (const tile of gameState.tiles) {
                    if (tile.unit && tile.unit.commander) {
                        tile.unit.canAct = true;
                        tile.unit.remainingMP = tile.unit.config.speed;
                    }
                }
                ['endTurnBtn', 'surrenderBtn', 'recruitInfantry', 'recruitCavalry', 'recruitArcher'].forEach(id => {
                    const btn = document.getElementById(id);
                    if (btn) btn.disabled = false;
                });
                const turnEl = document.getElementById('currentTurn');
                if (turnEl) { turnEl.textContent = '红军'; turnEl.style.color = '#ffaaaa'; }
                updateButtonColors();
                updateUI();
                notify('双方将领已部署，战斗开始！');
            }
        }
    });

    connectToServer(url).catch(err => {
        setStatus(`连接失败：${err.message}`, true);
        showModes();
        joinForm.style.display = url.includes('localhost') ? 'none' : 'flex';
    });
}

// ==== 处理对手发来的操作 ----
async function handleRemoteAction(msg) {
    const wasGameOver = gameState.gameOver;
    applyRemoteState(msg.state, HexTile, Unit);

    if (gameState.gameOver && !wasGameOver) {
        triggerVictoryEffect();
        return;
    }

    // 联机：主机收到 P2 的 endTurn 后，若状态切换为中立，执行 AI 回合
    if (msg.actionType === 'endTurn' && gameState.currentCamp === CAMP.neutral && !gameState.gameOver) {
        if (getMyRole() === 'player1') {
            const { processNeutralTurn } = await import('./ai.js');
            await processNeutralTurn();
            if (!gameState.gameOver) {
                const { endTurn } = await import('./gameLogic.js');
                await endTurn(); // 自动结束中立 → P1，广播
            }
        }
        return;
    }

    const e = msg.effects;
    switch (msg.actionType) {
        case 'move':
            playSound('move');
            if (e) {
                const movedUnit = gameState.tiles.reduce((found, t) =>
                    found || (t.unit?.id === e.unitId ? t.unit : null), null);
                if (movedUnit && e.path) {
                    movedUnit.startMovePath(e.path);
                }
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
                if (e.cityCaptured) {
                    spawnExplosionParticles(e.x, e.y, '#ffd700', 12);
                }
                if (e.moraleFxUnitId) {
                    const moraleUnit = gameState.tiles.reduce((f, t) => f || (t.unit?.id === e.moraleFxUnitId ? t.unit : null), null);
                    if (moraleUnit) spawnMoraleEffect(moraleUnit);
                }
                if (e.cmdSkillFxX != null) {
                    spawnCommanderSkillEffect(e.cmdSkillFxX, e.cmdSkillFxY);
                }
                // 伤害数字
                if (e.attackDmg > 0) {
                    gameState.damageTexts.push({
                        x: e.x, y: e.y, value: e.attackDmg, isCrit: e.attackIsCrit,
                        timeLeft: 900, lastUpdate: Date.now()
                    });
                }
                // 反击伤害数字
                if (e.counterDmg > 0) {
                    gameState.damageTexts.push({
                        x: e.counterX, y: e.counterY, value: e.counterDmg, isCrit: false,
                        timeLeft: 750, lastUpdate: Date.now()
                    });
                }
                // 治疗数字
                if (e.healAmt > 0) {
                    gameState.healTexts.push({
                        x: e.healX, y: e.healY, value: e.healAmt,
                        timeLeft: 1000, lastUpdate: Date.now()
                    });
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
