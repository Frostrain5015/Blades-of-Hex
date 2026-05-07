import { loadSettings, initCanvas, canvas, LOGICAL_W, LOGICAL_H, HEX_SIZE, COMMANDER_CONFIG, shuffleAndSplitPool } from './config.js';
import { gameState, updateUI, logMessage, applyRemoteState, notify, dismissToast, finalizeDeployment, resetGameState, serializeState } from './state.js';
import { setGameStateRef as setHexTileGameStateRef } from './HexTile.js';
import { setLogMessageRef, setGameStateRef } from './Unit.js';
import { setLogMessageRef as setCiLogRef, setGameStateRef as setCiGameRef, setSpawnFxRef } from './commanderInterface.js';
import { initMap, triggerVictoryEffect } from './gameLogic.js';
import { renderGame } from './renderer.js';
import { initInput, initKeyboard, initSettingsPanel } from './input.js';
import { connectToServer, setNetworkCallbacks, getMyRole, sendMessage, isNetworkGame, syncCommanderState, createRoom, joinRoom, listRooms, leaveRoom, sendReady, sendUnready } from './network.js';
import { CAMP } from './config.js';
import {
    clearTransientEffects, triggerTurnFlash,
    triggerAttackFlash, triggerRecruitFlash,
    spawnExplosionParticles, spawnDirectionalParticles,
    spawnRecruitEffect, spawnSlashMarks,
    triggerScreenShake, spawnMoraleEffect, spawnCommanderSkillEffect,
    spawnProjectile, triggerRecoil, triggerCharge,
    spawnBloodDrain, spawnPurpleLightning,
    spawnGoldenFlame, spawnVictoryRipple, spawnCoinRain
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

function setConnectionState(state) {
    // state: 'disconnected' | 'connecting' | 'connected'
    connectionDot.className = 'connection-dot ' + state;
    connectionBar.className = 'connection-bar visible ' + state;
    switch (state) {
        case 'connecting': connectionLabel.textContent = '连接中...'; break;
        case 'connected':  connectionLabel.textContent = '服务器已连接'; break;
        default:           connectionLabel.textContent = '未连接'; break;
    }
}

function setStatus(msg, isError = false) {
    lobbyStatus.textContent = msg;
    lobbyStatus.style.color = isError ? '#ff6666' : '#ffdd88';
}

function showHome(msg) {
    lobbyHome.style.display = '';
    multiplayerLobby.style.display = 'none';
    roomWaiting.style.display = 'none';
    document.getElementById('lobbyReady').style.display = 'none';
    connectionBar.classList.remove('visible');
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

function showRoomWaiting(roomId) {
    lobbyHome.style.display = 'none';
    multiplayerLobby.style.display = 'none';
    roomWaiting.style.display = '';
    document.getElementById('lobbyReady').style.display = 'none';
    connectionBar.classList.add('visible');
    roomIdValue.textContent = roomId;
    roomWaitingText.textContent = '等待对手加入...';
    readyBtn.disabled = true;
    setStatus('');
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

// ==== 单人游戏 ----
document.getElementById('localGameBtn').addEventListener('click', () => {
    showHome(); // 把首页藏起来（实际上 beginCommanderPhase 会隐藏整个 lobbyOverlay）
    beginCommanderPhase();
});

// ==== 将领选择流程 =====================
let _commanderPending = null;
let _commanderTransitioning = false; // 防止移动端双击重复触发

function beginCommanderPhase() {
    document.getElementById('lobbyOverlay').style.display = 'none';
    // 清除上一局所有遗留状态
    resetGameState();
    _commanderTransitioning = false;
    const pool = shuffleAndSplitPool();
    gameState.commanderPoolP1 = pool.p1;
    gameState.commanderPoolP2 = pool.p2;
    gameState.commanderPhase = 'selection';
    _showCommanderSelection('player1');
}

function beginNetworkCommanderFlow(role) {
    document.getElementById('lobbyOverlay').style.display = 'none';
    // 清除上一局所有遗留状态
    resetGameState();
    _commanderTransitioning = false;
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
        if (cfg.hpBonus)  bonusParts.push(`生命值 +${cfg.hpBonus}`);
        if (cfg.atkBonus) bonusParts.push(`攻击力 +${cfg.atkBonus}`);
        if (cfg.defBonus) bonusParts.push(`防御力 +${cfg.defBonus}%`);
        if (cfg.spdBonus) bonusParts.push(`行动力 +${cfg.spdBonus}`);
        card.innerHTML = `
            <div class="commander-card-name">★ ${cfg.name}</div>
            <div class="commander-card-skill">【${cfg.skill}】</div>
            <div class="commander-card-bonus">${bonusParts.join('<br>')}</div>
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
    // 禁止操作直到双方部署完毕
    gameState.currentCamp = CAMP.player1;
    updateButtonColors();
    notify('请红军选择目标单位部署将领（选中后二次点击确认）');
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
        card.innerHTML = `<span class="room-card-id">${r.roomId}</span><span class="room-card-count">${r.playerCount}/2</span>`;
        if (r.playerCount >= 2) {
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

// 多人游戏 → 连接服务器
document.getElementById('multiplayerBtn').addEventListener('click', () => {
    setConnectionState('connecting');
    lobbyHome.style.display = 'none';
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

// 创建房间
document.getElementById('createRoomBtn').addEventListener('click', () => {
    setStatus('正在创建房间...');
    createRoom();
});

// 刷新房间列表
document.getElementById('refreshRoomsBtn').addEventListener('click', () => {
    listRooms();
});

// 返回首页
document.getElementById('backToHomeBtn').addEventListener('click', () => {
    leaveRoom();
    setStatus('');
    showHome();
});

// 准备 / 取消准备
let _isReady = false;
document.getElementById('readyBtn').addEventListener('click', () => {
    _isReady = !_isReady;
    if (_isReady) {
        readyBtn.textContent = '已准备 · 点击取消';
        sendReady();
    } else {
        readyBtn.textContent = '准备';
        sendUnready();
    }
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

        onRoomCreated: (roomId, role) => {
            showRoomWaiting(roomId);
            _isReady = false;
            readyBtn.textContent = '准备';
        },

        onRoomJoined: (roomId, role) => {
            showRoomWaiting(roomId);
            _isReady = false;
            readyBtn.textContent = '准备';
        },

        onRoomList: (list) => renderRoomList(list),

        onRoomLeft: () => {},

        onOpponentJoined: (role) => {
            roomWaitingText.textContent = '对手已加入！';
            readyBtn.disabled = false;
        },

        onOpponentReady: () => {
            document.getElementById('lobbyReadyStatus').textContent = '对手已准备！';
        },

        onOpponentUnready: () => {
            document.getElementById('lobbyReadyStatus').textContent = '';
        },

        onError: (message) => {
            setStatus(message, true);
        },

        onDisconnected: () => {
            setConnectionState('disconnected');
            showHome('已断开连接');
        },

        onStart: (role) => {
            roomWaiting.style.display = 'none';
            showFactionReveal(role);
        },

        onRemoteAction: handleRemoteAction,

        onOpponentLeft: () => {
            notify('对手已断开连接', 'warn', true);
            logMessage('⚠ 对手已断开连接');
            roomWaitingText.textContent = '对手已离开，等待新对手...';
            readyBtn.disabled = true;
            readyBtn.textContent = '准备';
            _isReady = false;
        },

        // 对手重连 → 发送当前完整状态
        onOpponentReconnected: () => {
            const state = serializeState();
            sendAction('stateSync', state);
            notify('对手已重连', '', false);
            logMessage('🔗 对手已重连');
        },

        // 自己重连 → 跳过揭示动画，直接进入对局
        onReconnected: (role) => {
            _isReady = false;
            readyBtn.textContent = '准备';
            document.getElementById('roomWaiting').style.display = 'none';
            const vo = document.getElementById('victoryOverlay');
            vo.classList.remove('show');
            vo.style.opacity = '';
            vo.style.backgroundColor = '';
            document.body.style.pointerEvents = '';
            document.getElementById('factionReveal').classList.remove('show');
            document.getElementById('lobbyOverlay').style.display = 'none';
            document.getElementById('gameWrapper').style.display = '';
            document.getElementById('opponentTurnBanner').style.display = '';
            // 显示网络标识
            const ni = document.getElementById('networkIndicator');
            ni.style.display = 'flex';
            document.getElementById('networkRoleText').textContent =
                role === 'player1' ? '红军' : '蓝军';
        },

        onRematchPending: () => {
            document.getElementById('lobbyReadyStatus').textContent = '对手已准备！';
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
            if (msg.deployedUnitP1 || msg.deployedUnitP2) {
                const myRole = getMyRole();
                const targetUnitId = myRole === 'player1' ? msg.deployedUnitP2 : msg.deployedUnitP1;
                const targetCmdId = myRole === 'player1' ? gameState.commanderP2 : gameState.commanderP1;
                if (targetUnitId && targetCmdId) {
                    for (const tile of gameState.tiles) {
                        if (tile.unit && tile.unit.id === targetUnitId) {
                            tile.unit.commander = targetCmdId;
                            const cmdCfg = COMMANDER_CONFIG[targetCmdId];
                            if (cmdCfg) {
                                tile.unit.hp += cmdCfg.hpBonus;
                                tile.unit.maxHp += cmdCfg.hpBonus;
                                tile.unit.displayHp = tile.unit.hp;
                                tile.unit._atkBonus = cmdCfg.atkBonus;
                                tile.unit.remainingMP += cmdCfg.spdBonus;
                                tile.unit.displaySpeed += cmdCfg.spdBonus;
                            }
                            break;
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
            if (gameState.commanderPhase === 'deployment' &&
                gameState.commanderP1Deployed && gameState.commanderP2Deployed) {
                finalizeDeployment();
            }
        }
    });
}

// ==== 处理对手发来的操作 ----
async function handleRemoteAction(msg) {
    const wasGameOver = gameState.gameOver;

    // deployDone 不需要完整状态重建（已通过 syncCommanderState 同步），避免地形重绘
    if (msg.actionType === 'deployDone') {
        finalizeDeployment();
        return;
    }

    applyRemoteState(msg.state, HexTile, Unit);
    updateUI(); // 远程状态同步后刷新UI（金币、统计面板、招募费用等）

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
                if (e.cmdFx) {
                    spawnCommanderSkillEffect(e.cmdFx.x, e.cmdFx.y, e.cmdFx.glyph, e.cmdFx.label);
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
        case 'attack':
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
                if (e.moraleFxUnitId) {
                    const moraleUnit = gameState.tiles.reduce((f, t) => f || (t.unit?.id === e.moraleFxUnitId ? t.unit : null), null);
                    if (moraleUnit) spawnMoraleEffect(moraleUnit);
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

