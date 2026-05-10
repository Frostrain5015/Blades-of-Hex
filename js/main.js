import { loadSettings, initCanvas, canvas, LOGICAL_W, LOGICAL_H, HEX_SIZE, COMMANDER_CONFIG, shuffleAndSplitPool, TACTICAL_CARD_CONFIG } from './config.js';
import { gameState, updateUI, logMessage, applyRemoteState, notify, dismissToast, resetGameState, serializeState } from './state.js';
import { setGameStateRef as setHexTileGameStateRef } from './HexTile.js';
import { setLogMessageRef, setGameStateRef } from './Unit.js';
import { setLogMessageRef as setCiLogRef, setGameStateRef as setCiGameRef, setSpawnFxRef, getCommander } from './commanderInterface.js';
import { initMap, triggerVictoryEffect } from './gameLogic.js';
import { renderGame, drawCardCanvas } from './renderer.js';
import { initInput, initKeyboard, initSettingsPanel } from './input.js';
import { connectToServer, setNetworkCallbacks, getMyRole, sendMessage, isNetworkGame, syncCommanderState, createRoom, joinRoom, listRooms, leaveRoom, sendReady, sendUnready, manualReconnect, disconnect, sendAction } from './network.js';
import { CAMP } from './config.js';
import {
    clearTransientEffects, triggerTurnFlash,
    triggerAttackFlash, triggerRecruitFlash,
    spawnExplosionParticles, spawnDirectionalParticles, spawnGoldParticles,
    spawnRecruitEffect, spawnSlashMarks,
    triggerScreenShake, spawnMoraleEffect, spawnCommanderSkillEffect, spawnRankUpEffect,
    spawnProjectile, triggerRecoil, triggerCharge,
    spawnBloodDrain, spawnGongxinRipple, spawnLightningStrike,
    spawnGoldenFlame, spawnVictoryRipple, spawnCoinRain,
    spawnCardUseEffect, spawnHealParticles, spawnAirstrikeEffect
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
setCiLogRef(logMessage);
setCiGameRef(() => gameState);
setSpawnFxRef(spawnCommanderSkillEffect);

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

// ==== 对策卡 UI 渲染 ===================
// 对策卡已改为 canvas 渲染，不再使用 DOM 区域
function renderTacticalCards() {}

// ==== 游戏循环（始终运行，画布隐藏时无开销） ===================
function gameLoop() {
    const now = performance.now();
    renderGame();

    // 对策卡手牌独立画布
    drawCardCanvas(now);

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

    renderTacticalCards();

    requestAnimationFrame(gameLoop);
}
requestAnimationFrame(gameLoop);

// ==== 大厅 UI ===================
const lobbyOverlay      = document.getElementById('lobbyOverlay');
const lobbyHome         = document.getElementById('lobbyHome');
const multiplayerLobby  = document.getElementById('multiplayerLobby');
const roomWaiting       = document.getElementById('roomWaiting');
const roomIdValue       = document.getElementById('roomIdValue');
const roomWaitingStatus = document.getElementById('roomWaitingStatus');
const roomWaitingText   = document.getElementById('roomWaitingText');
const roomList          = document.getElementById('roomList');
const roomListEmpty     = document.getElementById('roomListEmpty');
const readyBtn          = document.getElementById('readyBtn');
const lobbyStatus       = document.getElementById('lobbyStatus');
const connectionBar     = document.getElementById('connectionBar');
const connectionLabel   = document.getElementById('connectionLabel');
const connectionDot     = connectionBar.querySelector('.connection-dot');
const reconnectBtn      = document.getElementById('reconnectBtn');

function setConnectionState(state) {
    // state: 'disconnected' | 'connecting' | 'connected'
    connectionDot.className = 'connection-dot ' + state;
    connectionBar.className = 'connection-bar visible ' + state;
    switch (state) {
        case 'connecting': connectionLabel.textContent = '连接中...'; break;
        case 'connected':  connectionLabel.textContent = '服务器已连接'; break;
        default:           connectionLabel.textContent = '未连接'; break;
    }
    // 重连成功后隐藏按钮
    if (state === 'connected') reconnectBtn.style.display = 'none';
}

// 首页常驻连接状态（页面加载时自动检测服务器）
connectionBar.classList.add('visible');
setConnectionState('connecting');
connectToServer(wsUrl(location.host)).then(() => {
    setConnectionState('connected');
    // 首页连接成功后注册回调（不进入房间，仅保持连接）
    setNetworkCallbacks({
        onDisconnected: () => setConnectionState('disconnected'),
        onReconnecting: (n) => { setConnectionState('connecting'); connectionLabel.textContent = '重连中 (' + n + '/2)...'; },
        onReconnectFailed: () => { setConnectionState('disconnected'); connectionLabel.textContent = '连接失败'; reconnectBtn.style.display = ''; },
        onSocketReconnected: () => setConnectionState('connected')
    });
}).catch(() => {
    setConnectionState('disconnected');
});

// 手动重连按钮
reconnectBtn.addEventListener('click', () => {
    reconnectBtn.style.display = 'none';
    setConnectionState('connecting');
    manualReconnect();
});

function setStatus(msg, isError = false) {
    lobbyStatus.textContent = msg;
    lobbyStatus.style.color = isError ? '#ff6666' : '#ffdd88';
}

function showHome(msg) {
    lobbyHome.style.display = '';
    multiplayerLobby.style.display = 'none';
    roomWaiting.style.display = 'none';
    document.getElementById('lobbyReady').style.display = 'none';
    connectionBar.classList.add('visible'); // 首页也显示连接状态
    if (msg) setStatus(msg, true);
}

function showMultiplayerLobby() {
    lobbyHome.style.display = 'none';
    multiplayerLobby.style.display = '';
    roomWaiting.style.display = 'none';
    document.getElementById('lobbyReady').style.display = 'none';
    connectionBar.classList.add('visible');
    setStatus('');
}

function showRoomWaiting(roomId, maxPlayers = 2, playerCount = 1) {
    lobbyHome.style.display = 'none';
    multiplayerLobby.style.display = 'none';
    roomWaiting.style.display = '';
    document.getElementById('lobbyReady').style.display = 'none';
    connectionBar.classList.add('visible');
    roomIdValue.textContent = roomId;
    const maxP = maxPlayers || 2;
    const cur = playerCount || 1;
    const countEl = document.getElementById('roomWaitingCount');
    if (countEl) countEl.textContent = '';
    _opponentCount = cur - 1;
    _readyCount = 0;
    // 房间已满则直接允许准备
    readyBtn.disabled = (cur < maxP);
    _updateRoomWaitingCount();
    setStatus('');
}

function _updateRoomWaitingCount() {
    const total = (_opponentCount || 0) + 1;
    const maxP = gameState.isThreePlayer ? 3 : 2;
    const countEl = document.getElementById('roomWaitingCount');
    if (countEl) countEl.textContent = '';
    if (total >= maxP) {
        roomWaitingText.textContent = `房间满(${_readyCount}/${maxP}人已准备)`;
        readyBtn.disabled = false;
    } else {
        roomWaitingText.textContent = `等待对手加入...(${total}/${maxP})`;
        readyBtn.disabled = total === 1;
    }
}

// 三人模式：检查本地玩家是否已投降，显示观战横幅
function _checkSpectatorBanner() {
    if (!gameState.isThreePlayer || !isNetworkGame()) return;
    const role = getMyRole();
    if (!role) return;
    const myCamp = role === 'player1' ? CAMP.player1 : role === 'player2' ? CAMP.player2 : role === 'player3' ? CAMP.player3 : null;
    if (!myCamp) return;
    const banner = document.getElementById('opponentTurnBanner');
    if (!banner) return;
    if (gameState.surrenderedCamps.includes(myCamp)) {
        banner.innerHTML = '<span>👁</span><span>您已战败，观战中</span>';
        banner.classList.add('visible');
    }
}

// ==== 阵营揭示动画（联机模式开局前） ----
function showFactionReveal(role) {
    // 清除胜利遮罩残留（GSAP inline style）
    const vo = document.getElementById('victoryOverlay');
    vo.classList.remove('show');
    vo.style.opacity = '';
    vo.style.backgroundColor = '';
    document.body.style.pointerEvents = '';

    const overlay = document.getElementById('factionReveal');
    const dice = document.getElementById('factionRevealDice');
    const text = document.getElementById('factionRevealText');
    const ci = _forPlayerCampName(role);
    const campName = ci.name;
    const campColor = ci.color;

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
        } else if (gameState.gameMode === 'pve') {
            beginPVECommanderPhase(role);
        } else {
            beginCommanderPhase();
        }
    }, 2500);
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
    if (isNetworkGame()) {
        document.getElementById('rematchStatus').textContent = '等待对手确认...';
        sendMessage({ type: 'rematch' });
    } else if (gameState.gameMode === 'pve') {
        // PVE 模式：清除胜利遮罩，强制人类为红军→选将→对局
        const overlay = document.getElementById('victoryOverlay');
        overlay.classList.remove('show');
        overlay.style.opacity = '';
        overlay.style.backgroundColor = '';
        document.body.style.pointerEvents = '';
        gameState.aiOpponentCamp = CAMP.player2;
        beginPVECommanderPhase('player1');
    } else {
        // 本地模式：清除胜利遮罩，重新走骰子→选将→部署→对局
        const overlay = document.getElementById('victoryOverlay');
        overlay.classList.remove('show');
        overlay.style.opacity = '';
        overlay.style.backgroundColor = '';
        document.body.style.pointerEvents = '';
        showFactionReveal('player1');
    }
});

// ==== 胜利界面退出 ----
document.getElementById('exitToLobbyBtn').addEventListener('click', () => {
    const vo = document.getElementById('victoryOverlay');
    vo.classList.remove('show');
    vo.style.opacity = '';
    vo.style.backgroundColor = '';
    document.body.style.pointerEvents = '';
    resetGameState();
    document.getElementById('gameWrapper').style.display = 'none';
    const lobby = document.getElementById('lobbyOverlay');
    lobby.style.display = '';
    showHome();
});

// ==== PVE 模式 — 强制玩家为红军，跳过投骰 ====
document.getElementById('pveGameBtn').addEventListener('click', () => {
    showHome();
    gameState.gameMode = 'pve';
    gameState.aiOpponentCamp = CAMP.player2; // 蓝军固定为 AI（Grok）
    beginPVECommanderPhase('player1');        // 人类固定为红军
});

// ==== 单人游戏（本地双人） ----
document.getElementById('localGameBtn').addEventListener('click', () => {
    showHome();
    gameState.gameMode = 'local';
    gameState.aiOpponentCamp = null;
    beginCommanderPhase();
});

// ==== 将领选择流程 =====================
let _commanderPending = null;
let _commanderTransitioning = false; // 防止移动端双击重复触发

function beginCommanderPhase() {
    document.getElementById('lobbyOverlay').style.display = 'none';
    // 清除上一局所有遗留状态
    _deploymentStarted = false;
    resetGameState();
    _commanderTransitioning = false;
    const pool = shuffleAndSplitPool();
    gameState.commanderPoolP1 = pool.p1;
    gameState.commanderPoolP2 = pool.p2;
    gameState.commanderPhase = 'selection';
    _showCommanderSelection('player1');
}

// PVE 模式将领选择：人类与 AI 轮流选将
function beginPVECommanderPhase(humanRole) {
    document.getElementById('lobbyOverlay').style.display = 'none';
    _deploymentStarted = false;
    resetGameState();
    // 保持 PVE 模式状态（resetGameState 会清掉，重新设置）
    gameState.gameMode = 'pve';
    gameState.aiOpponentCamp = humanRole === 'player1' ? CAMP.player2 : CAMP.player1;
    _commanderTransitioning = false;
    const pool = shuffleAndSplitPool();
    gameState.commanderPoolP1 = pool.p1;
    gameState.commanderPoolP2 = pool.p2;
    gameState.commanderPhase = 'selection';

    if (humanRole === 'player1') {
        // 人类是 P1：人类先选 → AI 后选
        _pveHumanRole = 'player1';
        _showCommanderSelection('player1');
    } else {
        // 人类是 P2：AI 先选 → 人类后选（立刻显示遮罩避免闪屏）
        _pveHumanRole = 'player2';
        _showCommanderWaiting('player2');
        _pveAIQuickPick('player1');
        setTimeout(() => {
            _showCommanderSelection('player2');
            _commanderTransitioning = false;
        }, 600);
    }
}

let _pveHumanRole = null;

// AI 快速选将：从池中按进攻偏好选择（Grok 选将偏好）
const _GROK_PREF = ['centurion', 'berserker', 'vampire', 'fallenAngel', 'ironGuard', 'staller', 'advisor', 'minister'];
function _pveAIQuickPick(forPlayer) {
    const pool = forPlayer === 'player1' ? gameState.commanderPoolP1 : gameState.commanderPoolP2;
    // Grok 选将偏好（与 .ai/grok.js COMMANDER_PREFERENCE 同步）
    let picked = pool[0];
    for (const pref of _GROK_PREF) {
        if (pool.includes(pref)) { picked = pref; break; }
    }
    if (forPlayer === 'player1') {
        gameState.commanderP1 = picked;
        gameState.commanderP1Confirmed = true;
    } else {
        gameState.commanderP2 = picked;
        gameState.commanderP2Confirmed = true;
    }
}

function _forPlayerCampName(forPlayer) {
    if (forPlayer === 'player1') return { name: '红军', color: '#ffaaaa' };
    if (forPlayer === 'player2') return { name: '蓝军', color: '#aaaaff' };
    return { name: '绿军', color: '#aaffaa' };
}
function _forPlayerPool(forPlayer) {
    if (forPlayer === 'player1') return gameState.commanderPoolP1;
    if (forPlayer === 'player2') return gameState.commanderPoolP2;
    return gameState.commanderPoolP3;
}

function beginNetworkCommanderFlow(role) {
    document.getElementById('lobbyOverlay').style.display = 'none';
    _deploymentStarted = false;
    const wasThreePlayer = gameState.isThreePlayer;
    resetGameState();
    gameState.isThreePlayer = wasThreePlayer;
    _commanderTransitioning = false;
    gameState.commanderPhase = 'selection';

    const myRole = getMyRole();
    if (myRole === 'player1') {
        const is3P = gameState.isThreePlayer;
        const pool = shuffleAndSplitPool(is3P);
        gameState.commanderPoolP1 = pool.p1;
        gameState.commanderPoolP2 = pool.p2;
        if (is3P) gameState.commanderPoolP3 = pool.p3 || [];
        syncCommanderState(
            pool.p1, pool.p2, null, null, false, false, false, false, 'selection',
            null, null,
            pool.p3 || [], null, false, false, null
        );
        _showCommanderSelection('player1');
    } else {
        _waitForNetworkPool(myRole);
    }
}

function _waitForNetworkPool(forPlayer) {
    const pool = _forPlayerPool(forPlayer);
    if (pool && pool.length > 0) {
        _showCommanderSelection(forPlayer);
    } else {
        setTimeout(() => _waitForNetworkPool(forPlayer), 200);
    }
}

function _showCommanderWaiting(forPlayer) {
    const overlay = document.getElementById('commanderOverlay');
    const title = document.getElementById('commanderTitle');
    const cardsDiv = document.getElementById('commanderCards');
    const statusDiv = document.getElementById('commanderStatus');
    const ci = _forPlayerCampName(forPlayer);

    _commanderPending = null;
    title.textContent = `${ci.name} — 选择将领`;
    title.style.color = ci.color;
    statusDiv.textContent = 'AI 正在选择将领...';
    statusDiv.style.color = '#aaa';
    cardsDiv.innerHTML = '';
    overlay.classList.add('show');
}

function _showCommanderSelection(forPlayer) {
    const overlay = document.getElementById('commanderOverlay');
    const title = document.getElementById('commanderTitle');
    const cardsDiv = document.getElementById('commanderCards');
    const statusDiv = document.getElementById('commanderStatus');
    const pool = _forPlayerPool(forPlayer);
    const ci = _forPlayerCampName(forPlayer);

    _commanderPending = null;
    title.textContent = `${ci.name} — 选择将领`;
    title.style.color = ci.color;
    statusDiv.textContent = '点击将领预选，再次点击确认';
    statusDiv.style.color = '#888';
    cardsDiv.innerHTML = '';

    for (const key of pool) {
        const cfg = COMMANDER_CONFIG[key];
        const card = document.createElement('div');
        card.className = 'commander-card';
        card.id = `cmd-card-${key}`;
        const bonusParts = [];
        if (cfg.hpBonus)  bonusParts.push(`生命值 +${cfg.hpBonus}`);
        if (cfg.atkBonus) bonusParts.push(`攻击力 +${cfg.atkBonus}`);
        if (cfg.defBonus) bonusParts.push(`防御力 +${cfg.defBonus}%`);
        if (cfg.spdBonus) bonusParts.push(`行动力 +${cfg.spdBonus}`);
        card.innerHTML = `
            <div class="commander-card-name">★ ${cfg.name}</div>
            <div class="commander-card-skill">【${cfg.skill}】</div>
            <div class="commander-card-bonus">${bonusParts.join('<br>')}</div>
            <div class="commander-card-desc">${cfg.desc.replace(/\n/g, '<br>')}</div>
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
                } else if (forPlayer === 'player2') {
                    gameState.commanderP2 = key;
                    gameState.commanderP2Confirmed = true;
                } else {
                    gameState.commanderP3 = key;
                    gameState.commanderP3Confirmed = true;
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
                        gameState.commanderPhase,
                        null, null,
                        gameState.commanderPoolP3, gameState.commanderP3,
                        gameState.commanderP3Confirmed, gameState.commanderP3Deployed, null
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
    } else if (gameState.gameMode === 'pve') {
        // PVE 模式：人类选完后 AI 自动选
        if (_pveHumanRole === 'player1' && forPlayer === 'player1') {
            // 人类 P1 选完，AI 选 P2
            _pveAIQuickPick('player2');
            setTimeout(() => {
                document.getElementById('commanderOverlay').classList.remove('show');
                gameState.commanderPhase = 'done';
                startGame();
                _triggerInitialAITurn().catch(err => console.error('initialAI error:', err));
                _commanderTransitioning = false;
            }, 800);
        } else if (_pveHumanRole === 'player2' && forPlayer === 'player2') {
            // 人类 P2 选完（AI P1 已选），开始游戏 + AI 先手
            setTimeout(() => {
                document.getElementById('commanderOverlay').classList.remove('show');
                gameState.commanderPhase = 'done';
                startGame();
                _triggerInitialAITurn().catch(err => console.error('initialAI error:', err));
                _commanderTransitioning = false;
            }, 800);
        }
    } else if (gameState.isThreePlayer) {
        // 三人本地模式
        if (forPlayer === 'player1') {
            setTimeout(() => { _showCommanderSelection('player2'); _commanderTransitioning = false; }, 800);
        } else if (forPlayer === 'player2') {
            setTimeout(() => { _showCommanderSelection('player3'); _commanderTransitioning = false; }, 800);
        } else {
            setTimeout(() => {
                document.getElementById('commanderOverlay').classList.remove('show');
                gameState.commanderPhase = 'done';
                startGame();
                _commanderTransitioning = false;
            }, 800);
        }
    } else if (forPlayer === 'player1') {
        setTimeout(() => { _showCommanderSelection('player2'); _commanderTransitioning = false; }, 800);
    } else {
        setTimeout(() => {
            document.getElementById('commanderOverlay').classList.remove('show');
            gameState.commanderPhase = 'done';
            startGame();
            _commanderTransitioning = false;
        }, 800);
    }
}

// PVE 模式：开局时若 AI 先手则触发 AI 回合
// 先执行 AI 行动，再通过 endTurn 旋转阵营并链式处理中立
async function _triggerInitialAITurn() {
    try {
        if (gameState.gameMode !== 'pve' || !gameState.aiOpponentCamp) return;
        if (gameState.currentCamp !== gameState.aiOpponentCamp) return;

        logMessage(`PVE 开局：${gameState.aiOpponentCamp.name} AI 先手，准备行动...`);
        await new Promise(r => setTimeout(r, 1500));
        if (gameState.gameOver) return;

        gameState.aiActing = true;
        try {
            const { processOpponentTurn } = await import('./ai.js');
            await Promise.race([
                processOpponentTurn(gameState.aiOpponentCamp),
                new Promise((_, reject) => setTimeout(() => reject(new Error('AI_TIMEOUT')), 15000))
            ]);
        } catch (e) {
            if (e && e.message === 'AI_TIMEOUT') {
                logMessage('AI对手超时，跳过回合');
            } else {
                logMessage('AI对手执行出错，跳过回合');
            }
            console.warn('AI opponent error:', e);
        } finally {
            gameState.aiActing = false;
        }

        await new Promise(r => setTimeout(r, 2500));

        // 结束 AI 回合，旋转阵营并链式处理中立 AI
        if (!gameState.gameOver) {
            const { endTurn } = await import('./gameLogic.js');
            await endTurn();
        }
    } catch (fatalError) {
        console.error('_triggerInitialAITurn 致命错误:', fatalError);
        gameState.aiActing = false;
        // 保证回合能前进，不被卡住
        if (!gameState.gameOver) {
            try {
                const { endTurn } = await import('./gameLogic.js');
                await endTurn();
            } catch (e2) {
                console.error('endTurn 也失败了:', e2);
            }
        }
    }
}

function _checkBothConfirmed() {
    const allConfirmed = gameState.isThreePlayer
        ? gameState.commanderP1Confirmed && gameState.commanderP2Confirmed && gameState.commanderP3Confirmed
        : gameState.commanderP1Confirmed && gameState.commanderP2Confirmed;
    if (allConfirmed && !_deploymentStarted) {
        setTimeout(() => {
            document.getElementById('commanderOverlay').classList.remove('show');
            gameState.commanderPhase = 'done';
            startGame();
        }, 800);
    }
}

let _deploymentStarted = false;
let _opponentCount = 0;

function startGame() {
    if (_deploymentStarted) return;
    _deploymentStarted = true;
    const lobbyOverlay = document.getElementById('lobbyOverlay');
    lobbyOverlay.style.display = 'none';
    document.getElementById('gameWrapper').style.display = '';
    document.getElementById('lobbyReady').style.display = 'none';
    document.getElementById('lobbyReadyBtn').disabled = false;
    document.getElementById('lobbyReadyBtn').textContent = '准备';
    // 三人模式：显示绿军面板，蓝军卡统一左对齐
    const camp3 = document.getElementById('campCard3');
    if (camp3) camp3.style.display = gameState.isThreePlayer ? '' : 'none';
    const camp2 = document.getElementById('campCard2');
    if (camp2) {
        if (gameState.isThreePlayer) {
            camp2.classList.remove('align-right');
            const info = camp2.querySelector('.camp-info');
            if (info) info.classList.remove('align-right');
        } else {
            camp2.classList.add('align-right');
            const info = camp2.querySelector('.camp-info');
            if (info) info.classList.add('align-right');
        }
    }
    document.body.style.pointerEvents = '';
    const vo = document.getElementById('victoryOverlay');
    vo.classList.remove('show');
    vo.style.opacity = '';
    vo.style.backgroundColor = '';
    document.getElementById('rematchStatus').textContent = '';
    dismissToast();
    fitCanvas();
    initMap();
    initInput();
    initKeyboard();
    initSettingsPanel();
    updateUI();
    gameState.currentCamp = CAMP.player1;
    updateButtonColors();
}

// 根据当前页面协议和端口推导 WebSocket 地址
function wsUrl(host) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const hostHasPort = host.includes(':');
    if (hostHasPort) return `${proto}://${host}`;
    return location.port ? `${proto}://${host}:${location.port}` : `${proto}://${host}`;
}

// ==== 多人游戏大厅 ===================

function renderRoomList(list) {
    roomList.innerHTML = '';
    if (!list || list.length === 0) {
        roomListEmpty.style.display = '';
        roomList.style.display = 'none';
        return;
    }
    roomListEmpty.style.display = 'none';
    roomList.style.display = '';
    list.forEach(r => {
        const card = document.createElement('div');
        card.className = 'room-card';
        const maxP = r.maxPlayers || 2;
        card.innerHTML = `<span class="room-card-id">${r.roomId}</span><span class="room-card-count">${r.playerCount}/${maxP}</span>`;
        if (r.playerCount >= maxP) {
            card.classList.add('full');
            card.title = '房间已满';
        } else {
            card.addEventListener('click', () => {
                joinRoom(r.roomId);
                setStatus(`正在加入房间 ${r.roomId}...`);
            });
        }
        roomList.appendChild(card);
    });
}

// 多人游戏 → 连接服务器（若已连接则直接进入大厅）
document.getElementById('multiplayerBtn').addEventListener('click', () => {
    lobbyHome.style.display = 'none';
    if (isNetworkGame() || connectionDot.classList.contains('connected')) {
        // 已有活跃连接，直接进大厅
        registerNetworkCallbacks();
        showMultiplayerLobby();
        listRooms();
        return;
    }
    setConnectionState('connecting');
    registerNetworkCallbacks();
    connectToServer(wsUrl(location.host)).then(() => {
        setConnectionState('connected');
        showMultiplayerLobby();
        listRooms();
    }).catch(err => {
        setConnectionState('disconnected');
        console.error('WebSocket 连接失败:', err, 'URL:', wsUrl(location.host));
        showHome(`连接失败：${err.message}（请确认服务器已启动，并刷新页面）`);
    });
});

// 房间模式切换（2P/3P）
let _roomMode = 2;
document.querySelectorAll('.room-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        _roomMode = parseInt(btn.dataset.mode);
        document.querySelectorAll('.room-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    });
});

// 创建房间
document.getElementById('createRoomBtn').addEventListener('click', () => {
    setStatus(`正在创建${_roomMode}人房间...`);
    createRoom(_roomMode);
});

// 刷新房间列表
document.getElementById('refreshRoomsBtn').addEventListener('click', () => {
    listRooms();
});

// 返回首页（保持连接以便指示灯常驻）
document.getElementById('backToHomeBtn').addEventListener('click', () => {
    leaveRoom();
    setStatus('');
    showHome();
});

// 准备 / 取消准备
let _isReady = false;
let _readyCount = 0;
document.getElementById('readyBtn').addEventListener('click', () => {
    _isReady = !_isReady;
    if (_isReady) {
        readyBtn.textContent = '取消准备';
        readyBtn.style.background = '#c0392b';
        _readyCount++;
        sendReady();
    } else {
        readyBtn.textContent = '准备';
        readyBtn.style.background = '#27ae60';
        _readyCount--;
        sendUnready();
    }
    _updateRoomWaitingCount();
});

// 离开房间
document.getElementById('leaveRoomBtn').addEventListener('click', () => {
    leaveRoom();
    showMultiplayerLobby();
    listRooms();
});

// ==== 网络回调注册（多人模式专用）====
function registerNetworkCallbacks() {
    setNetworkCallbacks({
        onConnected: () => {},

        onRoomCreated: (roomId, role, maxPlayers, playerCount) => {
            gameState.isThreePlayer = maxPlayers === 3;
            showRoomWaiting(roomId, maxPlayers, playerCount || 1);
            _isReady = false;
            readyBtn.textContent = '准备';
            readyBtn.style.background = '#27ae60';
        },

        onRoomJoined: (roomId, role, maxPlayers, playerCount) => {
            gameState.isThreePlayer = maxPlayers === 3;
            showRoomWaiting(roomId, maxPlayers, playerCount || 2);
            _isReady = false;
            readyBtn.textContent = '准备';
            readyBtn.style.background = '#27ae60';
        },

        onRoomList: (list) => renderRoomList(list),

        onRoomLeft: () => {},

        onOpponentJoined: (role) => {
            _opponentCount = (_opponentCount || 0) + 1;
            _updateRoomWaitingCount();
            readyBtn.disabled = false;
        },

        onOpponentReady: () => {
            _readyCount++;
            _updateRoomWaitingCount();
            document.getElementById('lobbyReadyStatus').textContent = '对手已准备';
        },

        onOpponentUnready: () => {
            _readyCount--;
            _updateRoomWaitingCount();
            document.getElementById('lobbyReadyStatus').textContent = '';
        },

        onError: (message) => {
            setStatus(message, true);
        },

        onRoomClosed: (reason) => {
            notify(reason || '房间已被关闭', 'warn', true);
            showHome();
        },

        onBanned: (message) => {
            alert(message || '你已被管理员封禁');
            showHome();
        },

        onDisconnected: () => {
            setConnectionState('disconnected');
            if (isNetworkGame()) showHome('已断开连接，正在尝试重连...');
        },

        onSocketReconnected: () => {
            setConnectionState('connected');
        },

        onReconnecting: (attempt) => {
            setConnectionState('connecting');
            connectionLabel.textContent = '重连中 (' + attempt + '/2)...';
        },

        onReconnectFailed: () => {
            setConnectionState('disconnected');
            connectionLabel.textContent = '连接失败';
            reconnectBtn.style.display = '';
        },

        onReconnected: () => {
            setConnectionState('connected');
            // WebSocket 重连成功 → 重新获取房间列表
            listRooms();
        },

        onStart: (role, isThreePlayer) => {
            if (isThreePlayer !== undefined) gameState.isThreePlayer = isThreePlayer;
            roomWaiting.style.display = 'none';
            showFactionReveal(role);
        },

        onRemoteAction: handleRemoteAction,

        onOpponentLeft: () => {
            notify('对手已断开连接', 'warn', true);
            logMessage('⚠ 对手已断开连接');
            // 对局中：立即存下全量状态到服务器
            if (gameState.commanderPhase === 'done') {
                sendMessage({ type: 'saveState', state: serializeState() });
                logMessage('📦 已暂存对局状态到服务器');
            }
            roomWaitingText.textContent = '对手已离开，等待重连...';
            readyBtn.disabled = true;
            readyBtn.textContent = '准备';
            readyBtn.style.background = '#27ae60';
            _isReady = false;
        },

        // 对手重连 → 服务器会同步暂存状态，仅通知
        onOpponentReconnected: () => {
            notify('对手已重连', '', false);
            logMessage('🔗 对手已重连');
        },

        // 自己重连 → 跳过揭示动画，直接进入对局
        onReconnected: (role) => {
            _isReady = false;
            readyBtn.textContent = '准备';
            readyBtn.style.background = '#27ae60';
            // 清除各种遮罩残留
            document.getElementById('roomWaiting').style.display = 'none';
            document.getElementById('victoryOverlay').classList.remove('show');
            document.getElementById('factionReveal').classList.remove('show');
            document.getElementById('commanderOverlay').classList.remove('show');
            document.body.style.pointerEvents = '';
            // 初始化棋盘（stateSync 到达后会覆盖，但先有底板避免空画布）
            resetGameState();
            // 显示游戏界面
            document.getElementById('lobbyOverlay').style.display = 'none';
            document.getElementById('gameWrapper').style.display = '';
            document.getElementById('opponentTurnBanner').style.display = '';
            document.getElementById('networkIndicator').style.display = 'flex';
            document.getElementById('networkRoleText').textContent =
                role === 'player1' ? '红军' : '蓝军';
            // 触发画布自适应
            setTimeout(() => {
                const wrapper = document.getElementById('canvasWrapper');
                const cw = wrapper.clientWidth;
                const ch = wrapper.clientHeight;
                const scale = Math.min(cw / 1000, ch / 750);
                const canvas = document.getElementById('gameCanvas');
                canvas.style.width  = Math.floor(1000 * scale) + 'px';
                canvas.style.height = Math.floor(750 * scale) + 'px';
            }, 100);
        },

        onRematchPending: () => {
            document.getElementById('lobbyReadyStatus').textContent = '对手已准备';
        },

        onCommanderSync: (msg) => {
            const hadPool = gameState.commanderPoolP1.length > 0;
            gameState.commanderPoolP1 = msg.commanderPoolP1 || [];
            gameState.commanderPoolP2 = msg.commanderPoolP2 || [];
            gameState.commanderPoolP3 = msg.commanderPoolP3 || [];
            gameState.commanderP1 = msg.commanderP1 || null;
            gameState.commanderP2 = msg.commanderP2 || null;
            gameState.commanderP3 = msg.commanderP3 || null;
            gameState.commanderP1Confirmed = msg.commanderP1Confirmed || false;
            gameState.commanderP2Confirmed = msg.commanderP2Confirmed || false;
            gameState.commanderP3Confirmed = msg.commanderP3Confirmed || false;
            gameState.commanderP1Deployed = msg.commanderP1Deployed || false;
            gameState.commanderP2Deployed = msg.commanderP2Deployed || false;
            gameState.commanderP3Deployed = msg.commanderP3Deployed || false;
            gameState.commanderPhase = msg.commanderPhase || 'selection';
            if (msg.deployedUnitP1 || msg.deployedUnitP2 || msg.deployedUnitP3) {
                const myRole = getMyRole();
                const getOtherDeploy = (role) => {
                    if (role === 'player1') return { unitId: msg.deployedUnitP2, cmdId: gameState.commanderP2, unitId2: msg.deployedUnitP3, cmdId2: gameState.commanderP3 };
                    if (role === 'player2') return { unitId: msg.deployedUnitP1, cmdId: gameState.commanderP1, unitId2: msg.deployedUnitP3, cmdId2: gameState.commanderP3 };
                    return { unitId: msg.deployedUnitP1, cmdId: gameState.commanderP1, unitId2: msg.deployedUnitP2, cmdId2: gameState.commanderP2 };
                };
                const deploy = getOtherDeploy(myRole);
                for (const { unitId, cmdId } of [{ unitId: deploy.unitId, cmdId: deploy.cmdId }, { unitId: deploy.unitId2, cmdId: deploy.cmdId2 }]) {
                    if (unitId && cmdId) {
                        for (const tile of gameState.tiles) {
                            if (tile.unit && tile.unit.id === unitId) {
                                tile.unit.commander = cmdId;
                                const cmdCfg = getCommander(cmdId);
                                if (cmdCfg) {
                                    tile.unit.hp += cmdCfg.hpBonus || 0;
                                    tile.unit.maxHp += cmdCfg.hpBonus || 0;
                                    tile.unit.displayHp = tile.unit.hp;
                                    tile.unit._atkBonus = (tile.unit._atkBonus || 0) + (cmdCfg.atkBonus || 0);
                                    tile.unit.remainingMP += cmdCfg.spdBonus || 0;
                                    tile.unit.displaySpeed += cmdCfg.spdBonus || 0;
                                }
                                break;
                            }
                        }
                    }
                }
            }
            if (!hadPool && gameState.commanderPoolP2.length > 0 && gameState.commanderPhase === 'selection') {
                const myRole = getMyRole();
                _showCommanderSelection(myRole);
            }
            if (gameState.commanderPhase === 'selection') {
                _checkBothConfirmed();
            }
        },

        onToast: (text, toastType) => {
            notify(text, toastType || 'info');
        }
    });
}

// ==== 处理对手发来的操作 ----
let _remoteAiRunning = false;  // 防止远程AI重入
async function handleRemoteAction(msg) {
    const wasGameOver = gameState.gameOver;

    // 服务器下发的暂存状态：无条件显示游戏界面并恢复
    if (msg.actionType === 'stateSync') {
        document.getElementById('lobbyOverlay').style.display = 'none';
        document.getElementById('gameWrapper').style.display = '';
        document.getElementById('roomWaiting').style.display = 'none';
        document.getElementById('opponentTurnBanner').style.display = '';
        document.getElementById('networkIndicator').style.display = 'flex';
        document.body.style.pointerEvents = '';
        _deploymentStarted = true;
        applyRemoteState(msg.state, HexTile, Unit);
        updateUI();
        renderGame();
        _checkSpectatorBanner();
        return;
    }

    applyRemoteState(msg.state, HexTile, Unit);
    updateUI(); // 远程状态同步后刷新UI（金币、统计面板、招募费用等）
    renderGame(); // 强制立即重绘画布，不等下一帧

    // 三人模式：检查本地玩家是否已投降，显示观战横幅
    _checkSpectatorBanner();

    if (gameState.gameOver && !wasGameOver) {
        setTimeout(() => triggerVictoryEffect(), 1500);
        return;
    }

    // 联机：主机收到 P2 的 endTurn 后，若状态切换为中立，执行 AI 回合
    if (msg.actionType === 'endTurn' && gameState.currentCamp === CAMP.neutral && !gameState.gameOver) {
        if (getMyRole() === 'player1' && !_remoteAiRunning) {
            _remoteAiRunning = true;
            try {
                const { processNeutralTurn } = await import('./ai.js');
                try {
                    await Promise.race([
                        processNeutralTurn(),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('AI_TIMEOUT')), 15000))
                    ]);
                } catch (e) {
                    if (e && e.message === 'AI_TIMEOUT') {
                        logMessage('中立AI超时，强制结束回合');
                    } else {
                        logMessage('中立AI执行出错，跳过回合');
                    }
                    console.warn('Neutral AI error (remote):', e);
                } finally {
                    gameState.aiActing = false;
                }
                // 通知 + 延迟 → 切换回合
                notify('本轮行动完毕 即将进入下一轮...', 'info');
                logMessage('本轮行动完毕 即将进入下一轮...');
                sendMessage({ type: 'toast', text: '本轮行动完毕 即将进入下一轮...', toastType: 'info' });
                await new Promise(r => setTimeout(r, 2500));
                // 调用 endTurn() 前手动锁定 aiActing，防止 endTurn 再次检测中立并触发二次 AI
                if (!gameState.gameOver) {
                    gameState.aiActing = true;
                    try {
                        const { endTurn } = await import('./gameLogic.js');
                        await endTurn();
                    } finally {
                        gameState.aiActing = false;
                    }
                }
            } finally {
                _remoteAiRunning = false;
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
                if (e.cmdFx) {
                    spawnCommanderSkillEffect(e.cmdFx.x, e.cmdFx.y, e.cmdFx.glyph, e.cmdFx.label);
                }
                if (e.mineTrigger) {
                    spawnDirectionalParticles(e.mineTrigger.x, e.mineTrigger.y + 10, e.mineTrigger.x, e.mineTrigger.y - 50, '#ff4400', 20);
                    spawnDirectionalParticles(e.mineTrigger.x, e.mineTrigger.y + 10, e.mineTrigger.x, e.mineTrigger.y - 50, '#ffaa00', 12);
                    spawnExplosionParticles(e.mineTrigger.x, e.mineTrigger.y, '#664400', 8);
                    triggerScreenShake(6, 250);
                    playSound('attack');
                    gameState.damageTexts.push({
                        x: e.mineTrigger.x, y: e.mineTrigger.y,
                        value: e.mineTrigger.dmg, isCrit: true,
                        timeLeft: 900, lastUpdate: Date.now()
                    });
                }
            }
            break;
        case 'endTurn':
            playSound('turnEnd');
            triggerTurnFlash(gameState.currentCamp.color);
            // 重放回合将领特效（铁卫治疗、尚书屯田等）
            if (e && e.cmdFxList) {
                for (const fx of e.cmdFxList) {
                    spawnCommanderSkillEffect(fx.x, fx.y, fx.glyph, fx.label);
                }
            }
            break;
        case 'tacticalCard':
            if (e) {
                // 烧牌动画（观战者：中央淡入+燃烧）
                spawnCardUseEffect(e.cardId, LOGICAL_W / 2, LOGICAL_H / 2, false);
                // 具体特效延迟 1.2s 后播放
                const cardType = e.cardId;
                setTimeout(() => {
                    switch (cardType) {
                        case 'lightning': {
                            const lt = e.q != null ? gameState.tileMap.get(`${e.q},${e.r}`) : gameState.tiles.find(t => t.x === e.x && t.y === e.y);
                            if (lt && lt.unit && e.dmg) {
                                lt.unit.hp = Math.max(0, lt.unit.hp - e.dmg);
                                if (lt.unit.hp <= 0) {
                                    const dc = lt.unit.camp;
                                    const dck = dc === CAMP.player1 ? 'player1' : dc === CAMP.player2 ? 'player2' : dc === CAMP.player3 ? 'player3' : 'neutral';
                                    gameState.killCount[dck] = (gameState.killCount[dck] || 0) + 1;
                                    lt.unit = null;
                                    spawnExplosionParticles(e.x, e.y, '#ff4400', 28);
                                    spawnExplosionParticles(e.x, e.y, '#ffaa00', 14);
                                    triggerScreenShake(4, 150);
                                }
                            }
                            playSound('attack');
                            spawnLightningStrike(e.x, e.y);
                            triggerScreenShake(10, 350);
                            if (e.dmg) gameState.damageTexts.push({
                                x: e.x, y: e.y, value: e.dmg, isTrueDmg: true,
                                timeLeft: 1000, lastUpdate: Date.now()
                            });
                            break;
                        }
                        case 'heal': {
                            const ht = e.q != null ? gameState.tileMap.get(`${e.q},${e.r}`) : gameState.tiles.find(t => t.x === e.x && t.y === e.y);
                            if (ht && ht.unit && e.healAmt) {
                                ht.unit.hp = Math.min(ht.unit.maxHp, ht.unit.hp + e.healAmt);
                                gameState.healTexts.push({
                                    x: e.x, y: e.y, value: e.healAmt,
                                    timeLeft: 1000, lastUpdate: Date.now()
                                });
                                spawnHealParticles(e.x, e.y);
                                playSound('recruit');
                            }
                            break;
                        }
                        case 'shield': {
                            const st = e.q != null ? gameState.tileMap.get(`${e.q},${e.r}`) : gameState.tiles.find(t => t.x === e.x && t.y === e.y);
                            if (st && st.unit) {
                                st.unit._shield = 50;
                                st.unit._shieldMax = 50;
                                st.unit._shieldTurns = 3;
                            }
                            playSound('recruit');
                            spawnCommanderSkillEffect(e.x, e.y, '🛡️', '护盾');
                            break;
                        }
                        case 'mgNest': {
                            const mgTile = e.q != null ? gameState.tileMap.get(`${e.q},${e.r}`) : gameState.tiles.find(t => t.x === e.x && t.y === e.y);
                            if (mgTile && mgTile.unit) mgTile.unit._airdropWaiting = false;
                            playSound('recruit');
                            spawnRecruitEffect(e.x, e.y);
                            break;
                        }
                        case 'airdrop':
                            spawnAirstrikeEffect(e.x, e.y, [], 'airdrop');
                            setTimeout(() => {
                                const adTile = e.q != null ? gameState.tileMap.get(`${e.q},${e.r}`) : gameState.tiles.find(t => t.x === e.x && t.y === e.y);
                                if (adTile && adTile.unit) {
                                    adTile.unit._airdropWaiting = false;
                                    if (adTile.isCity && adTile.unit.camp !== adTile.camp) {
                                        spawnExplosionParticles(e.x, e.y, '#ffd700', 12);
                                        spawnGoldParticles(e.x, e.y);
                                    }
                                }
                                playSound('recruit');
                                spawnRecruitEffect(e.x, e.y);
                            }, 1600);
                            break;
                        case 'imprison':
                            playSound('recruit');
                            spawnCommanderSkillEffect(e.x, e.y, '🔗', '禁锢');
                            break;
                        case 'forceMarch': {
                            const fm = e.q != null ? gameState.tileMap.get(`${e.q},${e.r}`) : gameState.tiles.find(t => t.x === e.x && t.y === e.y);
                            if (fm && fm.unit) {
                                fm.unit.canAct = true;
                                fm.unit.remainingMP += 2;
                            }
                            playSound('recruit');
                            spawnCommanderSkillEffect(e.x, e.y, '🏃', '强行军');
                            break;
                        }
                        case 'airstrike': {
                            // re-apply kills on remote
                            if (e.killedTiles) {
                                for (const kt of e.killedTiles) {
                                    const tile = gameState.tileMap.get(`${kt.q},${kt.r}`);
                                    if (tile && tile.unit) {
                                        const dc = tile.unit.camp;
                                        const dck = dc === CAMP.player1 ? 'player1' : dc === CAMP.player2 ? 'player2' : dc === CAMP.player3 ? 'player3' : 'neutral';
                                        gameState.killCount[dck] = (gameState.killCount[dck] || 0) + 1;
                                        tile.unit = null;
                                    }
                                }
                            }
                            spawnAirstrikeEffect(e.x, e.y, []);
                            setTimeout(() => {
                                playSound('attack');
                                spawnExplosionParticles(e.x, e.y, '#ff8800', 18);
                                triggerScreenShake(6, 300);
                            }, 1600);
                            break;
                        }
                        case 'landmine':
                            playSound('recruit');
                            spawnCommanderSkillEffect(e.x, e.y, '💣', '地雷');
                            break;
                        case 'commanderDeploy':
                            playSound('recruit');
                            spawnCommanderSkillEffect(e.x, e.y);
                            break;
                    }
                }, 1600);
            }
            break;
        case 'attack':
            try {
                playSound(e?.isCrit ? 'crit' : 'attack');
                if (e) {
                    triggerAttackFlash(e.x, e.y, e.isCrit);
                    if (e.attackerType === 'archer') {
                        spawnProjectile(e.fromX ?? e.x, e.fromY ?? e.y, e.x, e.y, e.isCrit);
                        triggerRecoil(e.fromX ?? e.x, e.fromY ?? e.y, e.x, e.y);
                        spawnDirectionalParticles(e.fromX ?? e.x, e.fromY ?? e.y, e.x, e.y, '#ff8844', e.isCrit ? 8 : 4);
                    } else {
                        spawnDirectionalParticles(e.fromX ?? e.x, e.fromY ?? e.y, e.x, e.y, '#ff8844', e.isCrit ? 22 : 10);
                        spawnSlashMarks(e.x, e.y, e.fromX ?? e.x, e.fromY ?? e.y, e.isCrit);
                        if (!e.killed) triggerCharge(e.attackerUnitId ?? 0, e.fromX ?? e.x, e.fromY ?? e.y, e.x, e.y);
                    }
                    triggerScreenShake(e.isCrit ? 6 : 3, e.isCrit ? 200 : 120);
                    if (e.killed) {
                        spawnExplosionParticles(e.x, e.y, '#ff2200', 30);
                        spawnExplosionParticles(e.x, e.y, '#ffaa00', 15);
                        triggerScreenShake(4, 150);
                    }
                    if (e.cityCaptured) {
                        spawnExplosionParticles(e.x, e.y, '#ffd700', 12);
                    }
                    if (e.cmdFxData) {
                        spawnCommanderSkillEffect(e.cmdFxData.x, e.cmdFxData.y, e.cmdFxData.glyph, e.cmdFxData.label);
                    }
                    if (e.ctrCmdFxData) {
                        spawnCommanderSkillEffect(e.ctrCmdFxData.x, e.ctrCmdFxData.y, e.ctrCmdFxData.glyph, e.ctrCmdFxData.label);
                    }
                    if (e.cmdFxExtra) {
                        spawnCommanderSkillEffect(e.cmdFxExtra.x, e.cmdFxExtra.y, e.cmdFxExtra.glyph, e.cmdFxExtra.label);
                    }
                    // 将领专属特效
                    if (e.bloodDrain) {
                        spawnBloodDrain(e.bloodDrain.toX, e.bloodDrain.toY, e.bloodDrain.fromX, e.bloodDrain.fromY);
                    }
                    if (e.purpleLightning) {
                        spawnGongxinRipple(e.purpleLightning.x, e.purpleLightning.y, e.purpleLightning.converted || false);
                    }
                    if (e.ctrBloodDrain) {
                        spawnBloodDrain(e.ctrBloodDrain.toX, e.ctrBloodDrain.toY, e.ctrBloodDrain.fromX, e.ctrBloodDrain.fromY);
                    }
                    if (e.moraleFxUnitId) {
                        const moraleUnit = gameState.tiles.reduce((f, t) => f || (t.unit?.id === e.moraleFxUnitId ? t.unit : null), null);
                        if (moraleUnit) spawnMoraleEffect(moraleUnit);
                    }
                    if (e.ctrMoraleFxUnitId) {
                        const ctrMoraleUnit = gameState.tiles.reduce((f, t) => f || (t.unit?.id === e.ctrMoraleFxUnitId ? t.unit : null), null);
                        if (ctrMoraleUnit) spawnMoraleEffect(ctrMoraleUnit);
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
            } catch (err) {
                console.warn('Remote attack effects error:', err);
            }
            break;
        case 'recruit':
            playSound('recruit');
            if (e) {
                triggerRecruitFlash(e.x, e.y);
                spawnRecruitEffect(e.x, e.y);
            }
            break;
        case 'activateSkill': {
            if (e && e.unitId) {
                const skillUnit = gameState.tiles.reduce((f, t) => f || (t.unit?.id === e.unitId ? t.unit : null), null);
                if (skillUnit && skillUnit.commander) {
                    const cmdCfg = getCommander(skillUnit.commander);
                    if (cmdCfg && cmdCfg.activeSkill) {
                        cmdCfg.activeSkill.onActivate(skillUnit, {
                            gameState, logMessage, spawnFx: spawnCommanderSkillEffect
                        });
                        skillUnit.activeSkillDur = cmdCfg.activeSkill.duration;
                        skillUnit.activeSkillCD = cmdCfg.activeSkill.cooldown;
                    }
                }
            }
            break;
        }
    }
    // 重放晋升特效
    if (msg.actionType === 'attack' || msg.actionType === 'move') {
        if (e && e.rankUps) {
            for (const ru of e.rankUps) {
                spawnRankUpEffect(ru.x, ru.y, ru.rank || 1);
            }
        }
    }
}

