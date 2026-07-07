import { loadSettings, saveSettings, settings, initCanvas, canvas, LOGICAL_W, LOGICAL_H, invalidateBoard, getRoundIndex } from './config.js';
import { allCommanders as COMMANDER_CONFIG, shuffleAndSplitPool } from '../commander/index.js';
import { gameState, updateUI, logMessage, applyRemoteState, notify, dismissToast, resetGameState, serializeState, updateButtonColors, getViewingCamp } from './state.js';
import { setGameStateRef as setHexTileGameStateRef } from './HexTile.js';
import { setLogMessageRef, setGameStateRef } from './Unit.js';
import { setLogMessageRef as setCiLogRef, setGameStateRef as setCiGameRef, setSpawnFxRef, setSpawnGoldenBeamRef, setSpawnOrbitBeamsRef, setClearOrbitBeamsRef, setSpawnBeamProjectilesRef, setLaunchOrbitSwordsRef, setSpawnHealingChainRef, getCommander } from './commanderInterface.js';
import { initMap, grantTurnStartIncome, triggerVictoryEffect, showInfo, updateDistrictColor, forceDistrictFade, resetConfirmActive, rebindGameEvents, setOnFogUpdated } from './gameLogic.js';
import { renderGame, drawCardCanvas } from './renderer.js';
import { initInput, initKeyboard, initSettingsPanel, rebindInputEvents, rebindKeyboardEvents } from './input.js';
import { connectToServer, setNetworkCallbacks, getMyRole, sendMessage, isNetworkGame, syncCommanderState, createRoom, joinRoom, listRooms, leaveRoom, sendReady, sendUnready, manualReconnect, sendChatMessage, roleToCamp } from './network.js';
import { CAMP } from './config.js';
import { preloadPortraits, reloadPortraits } from './portraitLoader.js';
import {
    triggerTurnFlash,
    triggerAttackFlash, triggerRecruitFlash, triggerHealFlash,
    spawnExplosionParticles, spawnDirectionalParticles, spawnGoldParticles,
    spawnRecruitEffect,
    triggerScreenShake, spawnMoraleEffect, spawnCommanderSkillEffect, spawnRankUpEffect,
    spawnProjectile, triggerRecoil, triggerCharge,
    spawnBloodDrain, spawnGongxinRipple, spawnLightningStrike,
    spawnMinisterDominionRing,
    spawnCardUseEffect,
    spawnGoldenBeam, spawnPaladinOrbitBeams, clearPaladinOrbitBeams, spawnPaladinBeamProjectiles, launchPaladinOrbitSwords,
    spawnHealingChain,
    spawnSlashMarks,
    spawnAirstrikeEffect, spawnAirliftEffect,
    spawnHealParticles,
    spawnReinforceEffect,
    clearTransientEffects
} from './effects.js';
import { isTileVisible } from './fogOfWar.js';
import { HexTile } from './HexTile.js';
import { Unit } from './Unit.js';
import { playSound, initAudio, setMuted, startBattleBGM, stopBattleBGM, stopLobbyBGM } from './audio.js';
import './cheat.js';

loadSettings();
initCanvas();
initAudio();
setHexTileGameStateRef(gameState);
setLogMessageRef(logMessage);
setGameStateRef(gameState);
setCiLogRef(logMessage);
setCiGameRef(() => gameState);
setSpawnFxRef(spawnCommanderSkillEffect);
setSpawnGoldenBeamRef(spawnGoldenBeam);
setSpawnOrbitBeamsRef(spawnPaladinOrbitBeams);
setClearOrbitBeamsRef(clearPaladinOrbitBeams);
setSpawnBeamProjectilesRef(spawnPaladinBeamProjectiles);
setLaunchOrbitSwordsRef(launchPaladinOrbitSwords);
setSpawnHealingChainRef(spawnHealingChain);

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

// 刷新保护：游戏进行中误触 F5 / Ctrl+R 时弹出浏览器确认对话框
window.addEventListener('beforeunload', (e) => {
    if (
        gameState &&
        !gameState.gameOver &&
        gameState.commanderPhase === 'done' &&
        document.getElementById('gameWrapper').style.display !== 'none'
    ) {
        e.preventDefault();
        e.returnValue = ''; // 兼容旧浏览器
    }
});

// Initial fit is called in startGame after gameWrapper becomes visible

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

    requestAnimationFrame(gameLoop);
}
requestAnimationFrame(gameLoop);

// 首次进入大厅时后台预加载所有将领头像，避免对局中慢加载
preloadPortraits();

// 启动首页将领立绘轮播（异步：内部会预检立绘存在性，失败静默跳过）
requestAnimationFrame(() => { _startHeroCarousel().catch(err => console.warn('[轮播] 启动失败:', err)); });

// 初始化聊天系统（事件绑定，仅一次）
_initChat();

// ==== 大厅 UI ===================
const lobbyOverlay      = document.getElementById('lobbyOverlay');
const lobbyHomeContent  = document.getElementById('lobbyHomeContent');
const mpLobbyContent    = document.getElementById('multiplayerLobbyContent');
const roomWaitContent   = document.getElementById('roomWaitingContent');
const lobbyReadyContent = document.getElementById('lobbyReadyContent');
const roomIdValue       = document.getElementById('roomIdValue');
const roomWaitingText   = document.getElementById('roomWaitingText');
const roomList          = document.getElementById('roomList');
const roomListEmpty     = document.getElementById('roomListEmpty');
const readyBtn          = document.getElementById('readyBtn');
const lobbyStatus       = document.getElementById('lobbyStatus');
const connectionBar     = document.getElementById('connectionBar');
const connectionLabel   = document.getElementById('connectionLabel');
const connectionDot     = connectionBar.querySelector('.connection-dot');
const reconnectBtn      = document.getElementById('reconnectBtn');
let _activeLobbyView    = null;

function _detectServerLocation() {
    const hn = location.hostname;
    const isLocal = hn === 'localhost' || hn === '127.0.0.1' || hn === '::1' ||
        /^192\.168\./.test(hn) || /^10\./.test(hn) || /^172\.(1[6-9]|2\d|3[01])\./.test(hn);
    return isLocal ? '内网穿透' : 'Frost Rain · 云端';
}

function setConnectionState(state) {
    // state: 'disconnected' | 'connecting' | 'connected'
    connectionDot.className = 'connection-dot ' + state;
    connectionBar.className = 'connection-bar visible ' + state;
    switch (state) {
        case 'connecting': connectionLabel.textContent = '连接中...'; break;
        case 'connected':  connectionLabel.textContent = '服务器已连接'; break;
        default:           connectionLabel.textContent = '未连接'; break;
    }
    document.getElementById('serverLocation').textContent = _detectServerLocation();
    // 重连成功后隐藏按钮
    if (state === 'connected') reconnectBtn.style.display = 'none';
}

// 首页常驻连接状态（页面加载时自动检测服务器）
connectionBar.classList.add('visible');
setConnectionState('connecting');
connectToServer(wsUrl(location.host)).then(() => {
    setConnectionState('connected');
    setNetworkCallbacks({
        onDisconnected: () => setConnectionState('disconnected'),
        onReconnecting: (n) => { setConnectionState('connecting'); connectionLabel.textContent = '重连中 (' + n + '/2)...'; },
        onReconnectFailed: () => { setConnectionState('disconnected'); connectionLabel.textContent = '连接失败'; reconnectBtn.style.display = ''; },
        onSocketReconnected: () => setConnectionState('connected')
    });
    // 连接成功 → 隐藏加载遮罩、展示主页
    document.getElementById('loadingOverlay').classList.add('hidden');
    showHome();
}).catch(() => {
    setConnectionState('disconnected');
    // 连接失败 → 仍展示主页（本地/PVE 模式不需要服务器）
    document.getElementById('loadingOverlay').classList.add('hidden');
    showHome('服务器未连接，您仍可进行本地游戏');
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

function _switchLobbyView(viewId, anim = true) {
    const target = document.getElementById(viewId);
    if (!target || _activeLobbyView === viewId) return;

    const oldEl = _activeLobbyView ? document.getElementById(_activeLobbyView) : null;
    const prevView = _activeLobbyView;
    _activeLobbyView = viewId;

    if (!anim || typeof gsap === 'undefined' || !oldEl) {
        document.querySelectorAll('.lobby-view').forEach(v => { v.classList.remove('active'); v.style.display = 'none'; });
        target.style.display = '';
        target.classList.add('active');
        return;
    }

    // 记录旧视图高度并锁定，防止新视图撑高面板导致跳变
    const leftPanel = document.getElementById('lobbyLeftPanel');
    const oldHeight = leftPanel.offsetHeight;
    leftPanel.style.minHeight = oldHeight + 'px';

    // 旧视图立即脱离文档流，防止双视图叠加影响布局
    oldEl.style.position = 'absolute';
    oldEl.style.inset = '8px 0 8px 4px';
    oldEl.style.pointerEvents = 'none';

    const tl = gsap.timeline();
    tl.to(oldEl, { opacity: 0, x: -16, duration: 0.22, ease: 'power2.in', onComplete: () => {
        oldEl.style.display = 'none';
        oldEl.style.position = '';
        oldEl.style.inset = '';
        oldEl.style.pointerEvents = '';
        oldEl.classList.remove('active');
        leftPanel.style.minHeight = '';
    }});
    tl.fromTo(target, { opacity: 0, x: 16 }, { opacity: 1, x: 0, duration: 0.28, ease: 'power2.out', onStart: () => {
        target.style.display = '';
        target.classList.add('active');
    }}, '-=0.08');
}

let _bgmPlayHandler = null;
let _bgmLastPlayed = 0;
const BGM_COOLDOWN = 25000;

function showHome(msg) {
    document.getElementById('lobbyOverlay').style.display = '';
    _updateChatAvailability();
    _switchLobbyView('lobbyHomeContent');
    connectionBar.classList.add('visible');
    if (msg) setStatus(msg, true);
    _syncMuteBtn();
    stopBattleBGM();

    if (_bgmPlayHandler) {
        document.removeEventListener('click', _bgmPlayHandler);
        document.removeEventListener('touchstart', _bgmPlayHandler);
        _bgmPlayHandler = null;
    }

    if (Howler.ctx && Howler.ctx.state === 'running') {
        if (Date.now() - _bgmLastPlayed > BGM_COOLDOWN) {
            _bgmLastPlayed = Date.now();
            playSound('lobby_bgm');
        }
        return;
    }

    _bgmPlayHandler = () => {
        document.removeEventListener('click', _bgmPlayHandler);
        document.removeEventListener('touchstart', _bgmPlayHandler);
        _bgmPlayHandler = null;
        _bgmLastPlayed = Date.now();

        const play = () => { playSound('lobby_bgm'); };
        if (Howler.ctx && Howler.ctx.state === 'suspended') {
            Howler.ctx.resume().then(play).catch(play);
        } else {
            play();
        }
    };
    document.addEventListener('click', _bgmPlayHandler);
    document.addEventListener('touchstart', _bgmPlayHandler);
}

// ---- 将领立绘轮播 & GSAP 入场动画 ----
let _heroCommanders = ['paladin','fallenAngel','vampire','berserker','magician','advisor','ironGuard','centurion','staller','martyr','priest','minister','necromancer','astrologer','diplomat','colonel'];
let _heroCarouselIdx = 0;
let _heroCarouselTimer = null;
let _heroCarouselReady = false;

// 预检立绘文件是否存在，过滤掉缺失图片的将领
function _filterValidCommanders() {
    return new Promise((resolve) => {
        const list = _heroCommanders;
        if (list.length === 0) { resolve([]); return; }
        const valid = [];
        let pending = list.length;
        for (const cmdId of list) {
            const cfg = COMMANDER_CONFIG[cmdId];
            const name = cfg ? cfg.name : cmdId;
            const img = new Image();
            img.onload = () => { valid.push(cmdId); if (--pending === 0) resolve(valid); };
            img.onerror = () => {
                console.warn(`[轮播] 将领立绘不存在，跳过：${cmdId}`);
                if (--pending === 0) resolve(valid);
            };
            img.src = `img/commander/${name}.jpg`;
        }
    });
}

async function _startHeroCarousel() {
    const frame = document.querySelector('.hero-portrait-frame');
    const dotsContainer = document.getElementById('heroCarouselDots');
    if (!frame || !dotsContainer) return;

    // 过滤掉图片缺失的将领
    _heroCommanders = await _filterValidCommanders();
    if (_heroCommanders.length === 0) {
        console.warn('[轮播] 所有将领立绘均缺失，停止轮播');
        return;
    }

    // 重置索引（过滤后列表可能变短）
    _heroCarouselIdx = 0;

    // 生成圆点
    dotsContainer.innerHTML = '';
    for (let i = 0; i < _heroCommanders.length; i++) {
        const dot = document.createElement('span');
        dot.className = 'hdot' + (i === _heroCarouselIdx ? ' active' : '');
        dot.addEventListener('click', () => _jumpHeroCarousel(i));
        dotsContainer.appendChild(dot);
    }

    _showHeroSlide(_heroCarouselIdx, false);

    if (!_heroCarouselReady) {
        _heroCarouselReady = true;
        _animateHeroEntrance();
    }

    // 自动轮播
    if (_heroCarouselTimer) clearInterval(_heroCarouselTimer);
    _heroCarouselTimer = setInterval(() => {
        if (_heroCommanders.length === 0) return;
        _heroCarouselIdx = (_heroCarouselIdx + 1) % _heroCommanders.length;
        _showHeroSlide(_heroCarouselIdx, true);
        _updateHeroDots();
    }, 4500);
}

function _stopHeroCarousel() {
    if (_heroCarouselTimer) { clearInterval(_heroCarouselTimer); _heroCarouselTimer = null; }
}

function _showHeroSlide(idx, animate) {
    if (!_heroCommanders.length) return;
    const cmdId = _heroCommanders[idx];
    const cfg = COMMANDER_CONFIG[cmdId];
    const name = cfg ? cfg.name : cmdId;
    const imgA = document.getElementById('heroPortraitA');
    const imgB = document.getElementById('heroPortraitB');

    const src = `img/commander/${name}.jpg`;
    const activeImg = imgA.classList.contains('active') ? imgA : imgB;
    const idleImg  = imgA.classList.contains('active') ? imgB : imgA;

    if (!animate) {
        activeImg.src = src;
        activeImg.classList.add('active');
        idleImg.classList.remove('active');
        return;
    }

    const preload = new Image();
    preload.onload = () => {
        idleImg.src = src;
        idleImg.classList.add('active');
        activeImg.classList.remove('active');
    };
    preload.onerror = () => {
        // 图片加载失败：跳过当前将领，换下一张
        console.warn(`[轮播] 切换立绘失败：${cmdId}`);
        const next = (idx + 1) % _heroCommanders.length;
        if (next !== idx) {
            _heroCarouselIdx = next;
            _showHeroSlide(next, true);
            _updateHeroDots();
        }
    };
    preload.src = src;
}

function _jumpHeroCarousel(idx) {
    if (!_heroCommanders.length) return;
    _heroCarouselIdx = idx;
    _showHeroSlide(idx, true);
    _updateHeroDots();
    // 重置自动轮播计时
    if (_heroCarouselTimer) clearInterval(_heroCarouselTimer);
    _heroCarouselTimer = setInterval(() => {
        if (_heroCommanders.length === 0) return;
        _heroCarouselIdx = (_heroCarouselIdx + 1) % _heroCommanders.length;
        _showHeroSlide(_heroCarouselIdx, true);
        _updateHeroDots();
    }, 4500);
}

function _updateHeroDots() {
    const dots = document.querySelectorAll('#heroCarouselDots .hdot');
    dots.forEach((d, i) => d.classList.toggle('active', i === _heroCarouselIdx));
}

function _animateHeroEntrance() {
    if (typeof gsap === 'undefined') return;
    const tl = gsap.timeline();
    const box = document.querySelector('.lobby-box');
    const portrait = document.querySelector('.hero-portrait-frame');
    const title = document.querySelector('.hero-title-block');
    const buttons = document.querySelectorAll('.hero-btn');
    const dots = document.getElementById('heroCarouselDots');

    tl.fromTo(box, { opacity: 0, scale: 0.96, y: 12 }, { opacity: 1, scale: 1, y: 0, duration: 0.5, ease: 'power3.out' });
    tl.fromTo(portrait, { opacity: 0, x: 40, scale: 0.95 }, { opacity: 1, x: 0, scale: 1, duration: 0.7, ease: 'power2.out' }, '-=0.15');
    tl.fromTo(title, { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.55, ease: 'power2.out' }, '-=0.3');
    tl.fromTo(buttons, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.4, stagger: 0.08, ease: 'back.out(1.2)' }, '-=0.2');
    tl.fromTo(dots, { opacity: 0 }, { opacity: 1, duration: 0.3 }, '-=0.1');
}

function showMultiplayerLobby() {
    _switchLobbyView('multiplayerLobbyContent');
    connectionBar.classList.add('visible');
    setStatus('');
}

function showRoomWaiting(roomId, maxPlayers = 2, playerCount = 1) {
    _switchLobbyView('roomWaitingContent');
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
    document.getElementById('backToVictoryBtn').style.display = 'none';
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
    _updateChatAvailability();
    document.getElementById('gameWrapper').style.display = 'none';
    document.getElementById('backToVictoryBtn').style.display = 'none';
    const lobby = document.getElementById('lobbyOverlay');
    lobby.style.display = '';
    showHome();
});

// ==== 查看完整棋局（遭遇战模式） ----
document.getElementById('viewFullBoardBtn').addEventListener('click', () => {
    const vo = document.getElementById('victoryOverlay');
    vo.classList.remove('show');
    gameState.skirmishFog = false;
    document.body.style.pointerEvents = '';
    document.getElementById('backToVictoryBtn').style.display = '';
    invalidateBoard();
});

// ==== 从完整棋局返回结算界面 ----
document.getElementById('backToVictoryBtn').addEventListener('click', () => {
    document.getElementById('backToVictoryBtn').style.display = 'none';
    gameState.skirmishFog = true;
    document.body.style.pointerEvents = 'none';
    const vo = document.getElementById('victoryOverlay');
    vo.classList.add('show');
    vo.style.opacity = '1';
    invalidateBoard();
});

// ==== 准备弹窗 =====================
let _prepAction = null; // 'solo' | 'multiplayer'

function _buildPrepOptionRow(containerId, choices) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    let selected = choices[0].id;
    for (const c of choices) {
        const el = document.createElement('div');
        el.className = 'prep-option' + (c.id === selected ? ' selected' : '');
        el.dataset.value = c.id;
        el.innerHTML = `<div class="prep-option-title">${c.title}</div><div class="prep-option-desc">${c.desc}</div>`;
        el.addEventListener('click', () => {
            container.querySelectorAll('.prep-option').forEach(o => o.classList.remove('selected'));
            el.classList.add('selected');
        });
        container.appendChild(el);
    }
}

function _getPrepSelection(containerId) {
    const sel = document.querySelector(`#${containerId} .prep-option.selected`);
    return sel ? sel.dataset.value : null;
}

function _showPrepDialog(action) {
    _prepAction = action;
    const title = document.getElementById('prepTitle');

    if (action === 'createRoom') {
        title.textContent = '创建房间';
        document.getElementById('prepLabel1').textContent = '对战人数';
        document.getElementById('prepLabel2').textContent = '对战模式';
        document.getElementById('prepSectionDiff').classList.add('hidden');
        _buildPrepOptionRow('prepOptions1', [
            { id: '2p', title: '双人', desc: '1v1 在线对战' },
            { id: '3p', title: '三人', desc: '三方混战' }
        ]);
        _buildPrepOptionRow('prepOptions2', [
            { id: 'standard', title: '标准模式', desc: '正常规则' },
            { id: 'skirmish', title: '遭遇战', desc: '战争迷雾' }
        ]);
    } else {
        title.textContent = '本地游戏';
        document.getElementById('prepLabel1').textContent = '对战类型';
        document.getElementById('prepLabel2').textContent = '对战模式';
        const diffSection = document.getElementById('prepSectionDiff');
        _buildPrepOptionRow('prepOptions1', [
            { id: 'pve', title: 'PVE 对战AI', desc: '红军 vs 蓝军AI' },
            { id: 'local', title: '本地双人', desc: '两位玩家轮流' }
        ]);
        _buildPrepOptionRow('prepOptions2', [
            { id: 'standard', title: '标准模式', desc: '正常规则' },
            { id: 'skirmish', title: '遭遇战', desc: '战争迷雾' }
        ]);
        _buildPrepOptionRow('prepOptionsDiff', [
            { id: 'easy', title: '简单', desc: 'AI 1x 经济' },
            { id: 'medium', title: '中等', desc: 'AI 1.5x 经济' },
            { id: 'hard', title: '困难', desc: 'AI 2x 经济' }
        ]);
        diffSection.classList.remove('hidden');
        const updateDiff = () => {
            const sel = _getPrepSelection('prepOptions1');
            diffSection.classList.toggle('hidden', sel !== 'pve');
        };
        document.getElementById('prepOptions1').addEventListener('click', () => setTimeout(updateDiff, 50));
        updateDiff();
    }

    _switchLobbyView('prepContent');

    document.getElementById('prepConfirm').onclick = () => {
        _executePrepChoice();
    };
}

// prep 返回按钮：回到进入 prep 之前的视图
document.getElementById('prepBackBtn').addEventListener('click', () => {
    // 联机模式回到联机大厅，单人模式回到首页
    if (_prepAction === 'createRoom') {
        showMultiplayerLobby();
    } else {
        showHome();
    }
});

function _executePrepChoice() {
    const sel1 = _getPrepSelection('prepOptions1');
    const sel2 = _getPrepSelection('prepOptions2');
    const isSkirmish = sel2 === 'skirmish';

    if (_prepAction === 'createRoom') {
        const maxP = sel1 === '3p' ? 3 : 2;
        gameState.isThreePlayer = maxP === 3;
        gameState.skirmishFog = isSkirmish;
        setStatus(`正在创建${maxP}人房间...`);
        createRoom(maxP);
        return;
    }

    // 单人模式
    if (sel1 === 'pve') {
        gameState.gameMode = 'pve';
        gameState.skirmishFog = isSkirmish;
        gameState.aiOpponentCamp = CAMP.player2;
        const diff = _getPrepSelection('prepOptionsDiff');
        gameState.aiDifficulty = diff === 'medium' ? 1.5 : diff === 'hard' ? 2.0 : 1.0;
        beginPVECommanderPhase('player1');
    } else {
        gameState.gameMode = isSkirmish ? 'skirmish' : 'local';
        gameState.skirmishFog = isSkirmish;
        gameState.aiOpponentCamp = null;
        beginCommanderPhase();
    }
}

// ==== 单人模式按钮 ====
document.getElementById('soloGameBtn').addEventListener('click', () => _showPrepDialog('solo'));

// ==== 多人游戏 → 直接连接服务器进大厅 ====
document.getElementById('multiplayerBtn').addEventListener('click', () => {
    if (isNetworkGame() || connectionDot.classList.contains('connected')) {
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
        console.error('WebSocket 连接失败:', err);
        showHome(`连接失败：${err.message}（请确认服务器已启动）`);
    });
});

// ==== 大厅静音按钮 ====
const lobbyMuteBtn = document.getElementById('lobbyMuteBtn');

function _syncMuteBtn() {
    if (settings.soundEnabled) {
        lobbyMuteBtn.textContent = '🔊'; // 🔊
        lobbyMuteBtn.classList.remove('muted');
    } else {
        lobbyMuteBtn.textContent = '🔇'; // 🔇
        lobbyMuteBtn.classList.add('muted');
    }
}

lobbyMuteBtn.addEventListener('click', () => {
    settings.soundEnabled = !settings.soundEnabled;
    setMuted(!settings.soundEnabled);
    _syncMuteBtn();
    const cb = document.getElementById('soundEnabled');
    if (cb) cb.checked = settings.soundEnabled;
    saveSettings();
});

// ==== 聊天系统状态变量（必须在 showHome() 前初始化，避免 TDZ 错误） =====
const _chatHistory = { room: [], player1: [], player2: [], player3: [] };
let _chatChannel = 'room';
let _chatTargetRole = null;
let _chatLastSendTime = 0;
const CHAT_COOLDOWN = 500;
const _chatUnread = { room: 0, player1: 0, player2: 0, player3: 0 };
let _chatDragStartX = 0, _chatDragStartY = 0, _chatDragOrigX = 0, _chatDragOrigY = 0, _chatDragging = false;

// 初始化大厅：设置 _activeLobbyView、注册 BGM 交互监听、同步静音按钮
// 延迟到连接完成后执行，避免连接完成前闪出主页
// showHome();  // 移至 connectToServer 完成后

// ==== 将领选择流程 =====================
let _commanderPending = null;
let _commanderTransitioning = false; // 防止移动端双击重复触发

function beginCommanderPhase() {
    _stopHeroCarousel();
    document.getElementById('lobbyOverlay').style.display = 'none';
    _deploymentStarted = false;
    const savedMode = gameState.gameMode;
    const savedFog = gameState.skirmishFog;
    resetGameState();
    gameState.gameMode = savedMode;
    gameState.skirmishFog = savedFog;
    _commanderTransitioning = false;
    const pool = shuffleAndSplitPool();
    gameState.commanderPoolP1 = pool.p1;
    gameState.commanderPoolP2 = pool.p2;
    gameState.commanderPhase = 'selection';
    _showCommanderSelection('player1');
}

// PVE 模式将领选择：人类与 AI 轮流选将
function beginPVECommanderPhase(humanRole) {
    _stopHeroCarousel();
    document.getElementById('lobbyOverlay').style.display = 'none';
    _deploymentStarted = false;
    const savedFog = gameState.skirmishFog;
    const savedDiff = gameState.aiDifficulty;
    resetGameState();
    // 保持 PVE 模式状态（resetGameState 会清掉，重新设置）
    gameState.gameMode = 'pve';
    gameState.skirmishFog = savedFog;
    gameState.aiDifficulty = savedDiff;
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
    const wasSkirmish = gameState.skirmishFog;
    const wasMode = gameState.gameMode;
    resetGameState();
    gameState.isThreePlayer = wasThreePlayer;
    gameState.skirmishFog = wasSkirmish;
    gameState.gameMode = wasMode;
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
    cardsDiv.querySelectorAll('.commander-card').forEach(c => c.remove());
    const deckEl = document.getElementById('commanderDeck');
    if (deckEl) { deckEl.style.display = 'none'; gsap.set(deckEl, { clearProps: 'transform,opacity' }); }
    overlay.classList.add('show');
}

function _buildSkillHTML(cfg) {
    if (cfg.skills && cfg.skills.length) {
        return cfg.skills.map(s => {
            const typeTag = s.type === 'active'
                ? '<span class="cmdr-skill-type cmdr-skill-active">主动</span>'
                : '<span class="cmdr-skill-type cmdr-skill-passive">被动</span>';
            return `<div class="cmdr-skill-block">` +
                `<div class="cmdr-detail-skill">${typeTag}【${s.name}】</div>` +
                `<div class="cmdr-detail-desc">${s.desc.replace(/\n/g, '<br>')}</div>` +
            `</div>`;
        }).join('');
    }
    const isActive = !!cfg.activeSkill;
    const typeTag = isActive
        ? '<span class="cmdr-skill-type cmdr-skill-active">主动</span>'
        : '<span class="cmdr-skill-type cmdr-skill-passive">被动</span>';
    return `<div class="cmdr-detail-skill">${typeTag}【${cfg.skill}】</div>` +
        `<div class="cmdr-detail-desc">${cfg.desc.replace(/\n/g, '<br>')}</div>`;
}

function _showCommanderSelection(forPlayer) {
    const overlay = document.getElementById('commanderOverlay');
    const title = document.getElementById('commanderTitle');
    const cardsDiv = document.getElementById('commanderCards');
    const statusDiv = document.getElementById('commanderStatus');
    const deckEl = document.getElementById('commanderDeck');
    const pool = _forPlayerPool(forPlayer);
    const ci = _forPlayerCampName(forPlayer);

    _commanderPending = null;
    title.textContent = `${ci.name} — 选择将领`;
    title.style.color = ci.color;
    statusDiv.textContent = '点击将领预选，再次点击确认';
    statusDiv.style.color = '#888';
    statusDiv.style.opacity = '0';
    cardsDiv.querySelectorAll('.commander-card').forEach(c => c.remove());

    // 创建卡片（双面结构）
    const cardDatas = [];
    for (const key of pool) {
        const cfg = COMMANDER_CONFIG[key];
        const bonusParts = [];
        if (cfg.hpBonusPct)  bonusParts.push(`生命值 +${Math.round(cfg.hpBonusPct * 100)}%`);
        if (cfg.atkBonusPct) bonusParts.push(`攻击力 +${Math.round(cfg.atkBonusPct * 100)}%`);
        if (cfg.defBonus) bonusParts.push(`防御力 +${cfg.defBonus}%`);
        if (cfg.spdBonus) bonusParts.push(`行动力 +${cfg.spdBonus}`);

        const card = document.createElement('div');
        card.className = 'commander-card animating';
        card.id = `cmd-card-${key}`;
        card.innerHTML =
            `<div class="commander-card-inner">` +
                `<div class="cmdr-reveal-back"></div>` +
                `<div class="cmdr-persistent" style="display:none">` +
                    `<div class="cmdr-face-portrait">` +
                        `<img src="img/commander/${cfg.name}.jpg" class="cmdr-portrait-full" />` +
                        `<div class="cmdr-portrait-label">${cfg.name}</div>` +
                    `</div>` +
                    `<div class="cmdr-face-details">` +
                        `<div class="cmdr-detail-name">${cfg.name}</div>` +
                        `<div class="cmdr-detail-bonus">${bonusParts.join('<br>')}</div>` +
                        _buildSkillHTML(cfg) +
                    `</div>` +
                `</div>` +
            `</div>`;
        cardsDiv.appendChild(card);
        cardDatas.push({ el: card, key, cfg });
    }

    // 显示牌堆
    deckEl.style.display = 'block';
    deckEl.style.opacity = '0';
    deckEl.style.transform = 'translate(-50%, -50%) scale(0.8)';
    overlay.classList.add('show');

    // 固定卡片尺寸（与 CSS .commander-card 保持一致）
    const CARD_W = 180;
    const CARD_H = 260;

    requestAnimationFrame(() => {
        const containerW = cardsDiv.clientWidth;
        const containerH = Math.max(cardsDiv.clientHeight, CARD_H);

        // 牌堆中心即容器中心（deck 由 CSS left:50%/top:50% + translate(-50%,-50%) 居中）
        const deckCX = containerW / 2;
        const deckCY = containerH / 2;

        // 从 flex 布局读取每张卡的实际终点位置（offsetLeft/Top 相对 cardsDiv）
        const targets = cardDatas.map(({ el }) => ({
            cx: el.offsetLeft + CARD_W / 2,
            cy: el.offsetTop + CARD_H / 2,
        }));

        const tl = gsap.timeline();

        // 阶段 1：牌堆出现
        tl.to(deckEl, { opacity: 1, scale: 1, duration: 0.45, ease: 'back.out(1.6)' }, 0);

        // 阶段 2：发牌（卡片不脱离文档流，用 GSAP 变换从牌堆中心飞向 flex 自然位置）
        const dealStagger = 0.26;
        const dealBase = 0.42;
        cardDatas.forEach(({ el }, i) => {
            const t = targets[i];
            const dx = t.cx - deckCX;
            const dy = t.cy - deckCY;
            const st = dealBase + i * dealStagger;
            // 卡片在自然位置；x:-dx,y:-dy 将其拉回牌堆中心
            tl.fromTo(el,
                { x: -dx, y: -dy, opacity: 0 },
                { x: -dx * 0.65, y: -22, opacity: 0.85, duration: 0.16, ease: 'power2.out' },
                st
            );
            tl.to(el,
                { x: 0, y: 0, opacity: 1, duration: 0.34, ease: 'back.out(1.2)' },
                st + 0.16
            );
        });

        const lastDealEnd = dealBase + (cardDatas.length - 1) * dealStagger + 0.16 + 0.34;

        // 牌堆消失
        tl.set(deckEl, { display: 'none' }, lastDealEnd - 0.05);

        // 阶段 3：翻牌 + 状态文字淡入
        const flipBase = lastDealEnd + 0.12;
        const flipStagger = 0.24;
        tl.to(statusDiv, { opacity: 1, duration: 0.4, ease: 'power2.out' }, flipBase);

        cardDatas.forEach(({ el }, i) => {
            const inner = el.querySelector('.commander-card-inner');
            const revealBack = inner.querySelector('.cmdr-reveal-back');
            const persistent = inner.querySelector('.cmdr-persistent');
            const st = flipBase + i * flipStagger;
            tl.to(inner, { scaleX: 0.01, duration: 0.15, ease: 'power2.in' }, st);
            tl.call(() => { revealBack.style.display = 'none'; persistent.style.display = ''; }, null, st + 0.15);
            tl.to(inner, { scaleX: 1, duration: 0.22, ease: 'back.out(1.3)' }, st + 0.16);
        });

        const lastFlipEnd = flipBase + (cardDatas.length - 1) * flipStagger + 0.16 + 0.22;

        // 阶段 4：清理恢复（卡片保持在文档流中，仅清除 GSAP 变换）
        tl.call(() => {
            cardDatas.forEach(({ el }) => {
                gsap.set(el, { clearProps: 'transform,opacity' });
                const inner = el.querySelector('.commander-card-inner');
                gsap.set(inner, { clearProps: 'transform' });
                el.classList.remove('animating');
            });
        }, null, lastFlipEnd + 0.05);

        // 绑定点击事件 + GSAP hover 翻转
        tl.call(() => {
            for (let i = 0; i < cardDatas.length; i++) {
                const { el, key, cfg } = cardDatas[i];
                const persistent = el.querySelector('.cmdr-persistent');

                // GSAP hover 翻转
                el.addEventListener('mouseenter', () => {
                    if (el.classList.contains('animating')) return;
                    gsap.to(persistent, { rotateY: 180, duration: 0.45, ease: 'power2.out', overwrite: true });
                });
                el.addEventListener('mouseleave', () => {
                    if (el.classList.contains('animating')) return;
                    gsap.to(persistent, { rotateY: 0, duration: 0.45, ease: 'power2.out', overwrite: true });
                });

                el.addEventListener('click', function handler() {
                    if (el.classList.contains('confirmed')) return;
                    if (_commanderPending === key) {
                        el.classList.remove('selected');
                        el.classList.add('confirmed');
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
                        cardsDiv.querySelectorAll('.commander-card').forEach(c => {
                            if (!c.classList.contains('confirmed')) c.style.pointerEvents = 'none';
                        });
                        _commanderPending = null;
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
                        cardsDiv.querySelectorAll('.commander-card').forEach(c => c.classList.remove('selected'));
                        el.classList.add('selected');
                        _commanderPending = key;
                        statusDiv.textContent = `已预选【${cfg.name}】，再次点击确认`;
                        statusDiv.style.color = '#ffd700';
                    }
                });
            }
        }, null, lastFlipEnd + 0.05);
    });
}

// 更新上方信息卡阵营徽章为将领透明底立绘
function updateCampEmblems() {
    const camps = [
        { id: 'emblemP1', cmdKey: gameState.commanderP1, camp: CAMP.player1, textDefault: '红' },
        { id: 'emblemP2', cmdKey: gameState.commanderP2, camp: CAMP.player2, textDefault: '蓝' },
        { id: 'emblemP3', cmdKey: gameState.commanderP3, camp: CAMP.player3, textDefault: '绿' },
    ];
    const viewingCamp = gameState.skirmishFog ? getViewingCamp() : null;

    for (const { id, cmdKey, camp, textDefault } of camps) {
        const el = document.getElementById(id);
        if (!el) continue;
        const emblem = el.closest('.camp-emblem');
        if (!emblem) continue;
        const textEl = emblem.querySelector('.camp-emblem-text');

        // 遭遇战：敌方将领未发现时隐藏立绘
        let hidden = false;
        if (viewingCamp && camp !== viewingCamp && cmdKey) {
            hidden = !_isCommanderUnitVisible(camp, cmdKey, viewingCamp);
        }

        if (cmdKey && !hidden) {
            const cfg = COMMANDER_CONFIG[cmdKey];
            if (cfg) {
                el.src = `img/commander_tr/${cfg.name}.png`;
                emblem.classList.add('has-portrait');
                el.classList.toggle('iron-guard-crop', cmdKey === 'ironGuard');
                continue;
            }
        }
        el.src = '';
        el.classList.remove('iron-guard-crop');
        emblem.classList.remove('has-portrait');
        if (textEl) textEl.textContent = hidden ? '?' : textDefault;
    }
}

function _isCommanderUnitVisible(camp, cmdKey, viewingCamp) {
    for (const tile of gameState.tiles) {
        if (tile.unit && tile.unit.commander === cmdKey && tile.unit.camp === camp) {
            return isTileVisible(tile, viewingCamp, gameState);
        }
    }
    // 将领未部署到任何单位 → 视为未发现
    return false;
}

function _onCommanderSelected(forPlayer) {
    if (_commanderTransitioning) return;
    _commanderTransitioning = true;
    updateCampEmblems();
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

function _roleToCampInfo(role) {
    const camp = roleToCamp(role);
    if (!camp) return { name: '未知', color: '#888888' };
    return { name: camp.name, color: camp.color };
}

function _getChatHistoryKey(channel, targetRole) {
    return channel === 'room' ? 'room' : targetRole;
}

function openChat(channel, targetRole = null) {
    if (!isNetworkGame()) return;
    const overlay = document.getElementById('chatOverlay');
    const headerLabel = document.getElementById('chatChannelLabel');
    const chatInput = document.getElementById('chatInput');

    _chatChannel = channel;
    _chatTargetRole = targetRole;

    if (channel === 'room') {
        headerLabel.textContent = '公共频道';
    } else if (targetRole) {
        const targetInfo = _roleToCampInfo(targetRole);
        headerLabel.textContent = `与${targetInfo.name}的私聊`;
    }

    // 清除该频道未读
    const key = _getChatHistoryKey(channel, targetRole);
    _chatUnread[key] = 0;
    _updateChatUnreadIndicator();

    _renderChatMessages();
    overlay.classList.add('show');
    chatInput.focus();
}

function closeChat() {
    document.getElementById('chatOverlay').classList.remove('show');
    _chatChannel = 'room';
    _chatTargetRole = null;
}

function togglePublicChat() {
    if (document.getElementById('chatOverlay').classList.contains('show') && _chatChannel === 'room') {
        closeChat();
    } else {
        openChat('room');
    }
}

function _renderChatMessages() {
    const messagesDiv = document.getElementById('chatMessages');
    messagesDiv.innerHTML = '';

    const key = _getChatHistoryKey(_chatChannel, _chatTargetRole);
    const history = _chatHistory[key] || [];
    const myRole = getMyRole();

    for (const msg of history) {
        messagesDiv.appendChild(_createMessageElement(msg, myRole));
    }
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function _createMessageElement(msg, myRole) {
    const isSelf = msg.senderRole === myRole;
    const div = document.createElement('div');
    div.className = 'chat-msg ' + (isSelf ? 'self' : 'other');

    if (!isSelf) {
        const senderLabel = document.createElement('div');
        senderLabel.className = 'chat-msg-sender';
        senderLabel.style.color = msg.color;
        senderLabel.textContent = msg.senderName;
        div.appendChild(senderLabel);
    }

    const textEl = document.createElement('div');
    textEl.className = 'chat-msg-text';
    textEl.textContent = msg.text;
    div.appendChild(textEl);

    return div;
}

function addChatMessage(senderRole, text, channel, targetRole) {
    const senderInfo = _roleToCampInfo(senderRole);
    const msg = {
        senderRole,
        senderName: senderInfo.name,
        color: senderInfo.color,
        text,
        timestamp: Date.now()
    };

    const key = _getChatHistoryKey(channel, targetRole);
    if (!_chatHistory[key]) _chatHistory[key] = [];
    _chatHistory[key].push(msg);
    if (_chatHistory[key].length > 200) {
        _chatHistory[key] = _chatHistory[key].slice(-200);
    }

    // 判断当前是否正在查看对应频道
    const isCurrentlyViewing =
        (_chatChannel === channel) &&
        (channel === 'room' || _chatTargetRole === targetRole);

    const overlay = document.getElementById('chatOverlay');
    if (isCurrentlyViewing && overlay.classList.contains('show')) {
        const messagesDiv = document.getElementById('chatMessages');
        const atBottom = messagesDiv.scrollHeight - messagesDiv.scrollTop - messagesDiv.clientHeight < 60;
        messagesDiv.appendChild(_createMessageElement(msg, getMyRole()));
        if (atBottom) messagesDiv.scrollTop = messagesDiv.scrollHeight;
    } else {
        _chatUnread[key] = (_chatUnread[key] || 0) + 1;
        _updateChatUnreadIndicator();
    }
}

function _sendChatMessage() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;

    const now = Date.now();
    if (now - _chatLastSendTime < CHAT_COOLDOWN) return;
    _chatLastSendTime = now;

    const myRole = getMyRole();
    if (!myRole) return;

    addChatMessage(myRole, text, _chatChannel, _chatTargetRole);
    sendChatMessage(_chatChannel, text, _chatTargetRole);

    input.value = '';
    input.focus();
}

function _initChatPanelDrag() {
    const panel = document.getElementById('chatPanel');
    const header = document.getElementById('chatHeader');

    header.addEventListener('mousedown', (e) => {
        if (e.target === document.getElementById('chatCloseBtn')) return;
        e.preventDefault();
        _chatDragging = true;
        _chatDragStartX = e.clientX;
        _chatDragStartY = e.clientY;
        const rect = panel.getBoundingClientRect();
        _chatDragOrigX = rect.left;
        _chatDragOrigY = rect.top;
        // 切换为 left/top 定位
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        panel.style.left = _chatDragOrigX + 'px';
        panel.style.top = _chatDragOrigY + 'px';
    });

    document.addEventListener('mousemove', (e) => {
        if (!_chatDragging) return;
        const dx = e.clientX - _chatDragStartX;
        const dy = e.clientY - _chatDragStartY;
        let nx = _chatDragOrigX + dx;
        let ny = _chatDragOrigY + dy;
        // 边界限制
        const pw = panel.offsetWidth;
        const ph = panel.offsetHeight;
        nx = Math.max(0, Math.min(window.innerWidth - pw, nx));
        ny = Math.max(0, Math.min(window.innerHeight - ph, ny));
        panel.style.left = nx + 'px';
        panel.style.top = ny + 'px';
    });

    document.addEventListener('mouseup', () => { _chatDragging = false; });
}

function _initChat() {
    document.getElementById('chatCloseBtn').addEventListener('click', closeChat);
    document.getElementById('chatSendBtn').addEventListener('click', _sendChatMessage);

    document.getElementById('chatInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            _sendChatMessage();
        }
    });

    document.addEventListener('mousedown', (e) => {
        const overlay = document.getElementById('chatOverlay');
        if (!overlay.classList.contains('show')) return;
        const panel = document.getElementById('chatPanel');
        if (!panel.contains(e.target)) closeChat();
    });

    document.getElementById('chatToggleBtn').addEventListener('click', togglePublicChat);

    _initChatPanelDrag();

    // Ctrl+Enter 全局快捷键
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'Enter' && isNetworkGame()) {
            e.preventDefault();
            togglePublicChat();
        }
    });
}

function _initEmblemChatClicks() {
    const myRole = getMyRole();
    if (!myRole) return;
    const myCamp = roleToCamp(myRole);
    if (!myCamp) return;

    const cardMappings = [
        { cardId: 'campCard1', camp: CAMP.player1, role: 'player1' },
        { cardId: 'campCard2', camp: CAMP.player2, role: 'player2' },
        { cardId: 'campCard3', camp: CAMP.player3, role: 'player3' },
    ];

    for (const { cardId, camp, role } of cardMappings) {
        const card = document.getElementById(cardId);
        if (!card) continue;
        const emblem = card.querySelector('.camp-emblem');
        if (!emblem) continue;

        // 移除旧监听器
        emblem.classList.remove('chat-enabled');
        const newEmblem = emblem.cloneNode(true);
        emblem.parentNode.replaceChild(newEmblem, emblem);

        if (card.style.display === 'none') continue;

        const freshEmblem = card.querySelector('.camp-emblem');
        freshEmblem.classList.add('chat-enabled');

        freshEmblem.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (!isNetworkGame()) return;
            if (camp === myCamp) {
                openChat('room');
            } else {
                openChat('private', role);
            }
        });
    }
}

function _updateChatAvailability() {
    const toggleBtn = document.getElementById('chatToggleBtn');
    if (!toggleBtn) return;
    if (isNetworkGame()) {
        toggleBtn.style.display = '';
    } else {
        toggleBtn.style.display = 'none';
        closeChat();
    }
}

function _updateChatUnreadIndicator() {
    const toggleBtn = document.getElementById('chatToggleBtn');
    if (!toggleBtn) return;
    let total = 0;
    for (const v of Object.values(_chatUnread)) total += v || 0;
    if (total > 0) {
        toggleBtn.classList.add('has-unread');
        toggleBtn.title = `聊天 (${total} 条未读)`;
    } else {
        toggleBtn.classList.remove('has-unread');
        toggleBtn.title = '聊天 (Ctrl+Enter)';
    }
}

let _deploymentStarted = false;
let _opponentCount = 0;

// 三人模式：显示绿军面板，蓝军卡统一左对齐（开局与重连恢复共用）
function applyTopbarLayout() {
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
}

function startGame() {
    if (_deploymentStarted) return;
    _deploymentStarted = true;
    _stopHeroCarousel();
    const lobbyOverlay = document.getElementById('lobbyOverlay');
    lobbyOverlay.style.display = 'none';
    document.getElementById('gameWrapper').style.display = '';
    document.getElementById('lobbyReadyBtn').disabled = false;
    document.getElementById('lobbyReadyBtn').textContent = '准备';
    document.getElementById('backToVictoryBtn').style.display = 'none';
    applyTopbarLayout();
    document.body.style.pointerEvents = '';
    const vo = document.getElementById('victoryOverlay');
    vo.classList.remove('show');
    vo.style.opacity = '';
    vo.style.backgroundColor = '';
    document.getElementById('rematchStatus').textContent = '';
    dismissToast();
    fitCanvas();
    stopLobbyBGM();
    stopBattleBGM();

    // 3秒全屏倒计时
    _runCountdown(() => {
        preloadPortraits();
        initMap();
        initInput();
        initKeyboard();
        initSettingsPanel();
        setOnFogUpdated(updateCampEmblems);
        updateCampEmblems();
        _updateChatAvailability();
        _initEmblemChatClicks();
        gameState.currentCamp = CAMP.player1;
        grantTurnStartIncome(CAMP.player1);
        updateUI();
        updateButtonColors();
        startBattleBGM();
        playSound('turnEnd');

        const limitRound = gameState.isThreePlayer ? 25 : 18;
        const factionName = gameState.isThreePlayer ? '三方' : '双人';
        showInfo(`${factionName}模式：${limitRound}回合内控制比其他势力更多的城市即可获得胜利！`);
    });
}

// ---- 3-2-1 全屏倒计时 ----
function _runCountdown(onDone) {
    const overlay = document.getElementById('countdownOverlay');
    const numEl = document.getElementById('countdownNumber');
    overlay.classList.add('show');

    if (typeof gsap === 'undefined') {
        setTimeout(() => { overlay.classList.remove('show'); onDone(); }, 3000);
        return;
    }

    function _tick(n) {
        numEl.textContent = n;
        playSound('countdown');
        gsap.fromTo(numEl, { scale: 1.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: 'power2.out' });
        if (n > 1) {
            setTimeout(() => {
                gsap.to(numEl, { scale: 0.5, opacity: 0, duration: 0.25, ease: 'power2.in', onComplete: () => _tick(n - 1) });
            }, 650);
        } else {
            setTimeout(() => {
                gsap.to([overlay, numEl], { opacity: 0, duration: 0.35, ease: 'power2.in', onComplete: () => {
                    overlay.classList.remove('show');
                    overlay.style.opacity = '';
                    numEl.style.opacity = '';
                    numEl.style.transform = '';
                    onDone();
                }});
            }, 700);
        }
    }
    _tick(3);
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
        card.className = 'mp-room-card';
        const maxP = r.maxPlayers || 2;
        const full = r.playerCount >= maxP;
        const modeLabel = (maxP === 3 ? '三人' : '双人') + ' · ' + (r.skirmishFog ? '遭遇战' : '标准');
        card.innerHTML = `<span class="mp-room-id">${r.roomId}</span><span class="mp-room-mode">${modeLabel}</span><span class="mp-room-players">${r.playerCount}/${maxP}</span><span class="mp-room-arrow">→</span>`;
        if (full) {
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


// 创建房间 → 先弹出准备弹窗选择人数和模式
document.getElementById('createRoomBtn').addEventListener('click', () => _showPrepDialog('createRoom'));

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
        readyBtn.classList.add('cancel');
        _readyCount++;
        sendReady();
    } else {
        readyBtn.textContent = '准备';
        readyBtn.classList.remove('cancel');
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
            _opponentCount = 0;
            showRoomWaiting(roomId, maxPlayers, playerCount || 1);
            _isReady = false;
            _readyCount = 0;
            readyBtn.textContent = '准备';
            readyBtn.classList.remove('cancel');
            readyBtn.style.background = '#27ae60';
        },

        onRoomJoined: (roomId, role, maxPlayers, playerCount) => {
            gameState.isThreePlayer = maxPlayers === 3;
            _opponentCount = 0; // 由后续 opponentJoined 消息逐个累加，避免重复计数
            showRoomWaiting(roomId, maxPlayers, playerCount || 2);
            _isReady = false;
            _readyCount = 0;
            readyBtn.textContent = '准备';
            readyBtn.classList.remove('cancel');
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
            console.log('[重连] onDisconnected 触发，isNetworkGame=' + isNetworkGame() + '，_myRole=' + (typeof getMyRole === 'function' ? getMyRole() : '?'));
            setConnectionState('disconnected');
            if (isNetworkGame()) showHome('已断开连接，正在尝试重连...'); else console.log('[重连] onDisconnected: 非联机状态，不跳转主页');
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

        onStart: (role, isThreePlayer, skirmishFog) => {
            if (isThreePlayer !== undefined) gameState.isThreePlayer = isThreePlayer;
            if (skirmishFog !== undefined) gameState.skirmishFog = skirmishFog;
            showFactionReveal(role);
        },

        onRemoteAction: handleRemoteAction,

        onOpponentLeft: () => {
            notify('对手已断开连接', 'warn', true);
            logMessage('⚠ 对手已断开连接');
            // 对局中：立即存下全量状态到服务器
            if (gameState.commanderPhase === 'done') {
                const st = serializeState();
                console.log('[重连] saveState: drawPile=' + (st.cardDrawPile ? st.cardDrawPile.length : '?') + '，p1Hand=' + (st.playerHands ? st.playerHands.player1.length : '?') + '，p2Hand=' + (st.playerHands ? st.playerHands.player2.length : '?'));
                sendMessage({ type: 'saveState', state: st });
                logMessage('📦 已暂存对局状态到服务器');
            }
            roomWaitingText.textContent = '对手已离开，等待重连...';
            readyBtn.disabled = true;
            readyBtn.textContent = '准备';
            readyBtn.classList.remove('cancel');
            readyBtn.style.background = '#27ae60';
            _isReady = false;
            _readyCount = 0;
        },

        // 对手重连 → 服务器会同步暂存状态，仅通知
        onOpponentReconnected: () => {
            notify('对手已重连', '', false);
            logMessage('🔗 对手已重连');
        },

        // 自己重连（大厅/对局中统一处理）
        onReconnected: (role) => {
            console.log('[重连] onReconnected 触发，role=' + role);
            setConnectionState('connected');
            // 对局中重连：跳过揭示动画，直接恢复游戏界面与状态
            if (role) {
                console.log('[重连] 对局中重连，开始恢复UI...');
                // 重连后强制重新加载将领立绘（旧 Image 对象可能已失效）
                reloadPortraits();
                console.log('[重连] reloadPortraits 完成，commanderP1=' + gameState.commanderP1 + '，P2=' + gameState.commanderP2);
                _isReady = false;
                readyBtn.textContent = '准备';
                readyBtn.classList.remove('cancel');
                document.getElementById('lobbyOverlay').style.display = 'none';
                document.getElementById('victoryOverlay').classList.remove('show');
                document.getElementById('factionReveal').classList.remove('show');
                document.getElementById('commanderOverlay').classList.remove('show');
                // 清除残留确认弹窗（含遮罩 + _confirmActive 标志）
                resetConfirmActive();
                document.body.style.pointerEvents = '';
                console.log('[重连] 清除残留特效...');
                // 清除残留粒子特效，重置棋盘底板
                clearTransientEffects();
                console.log('[重连] 重置棋盘...');
                resetGameState();
                // 允许 stateSync 覆盖当前重置状态
                _deploymentStarted = false;
                console.log('[重连] _deploymentStarted=false，等待stateSync...');
                document.getElementById('lobbyOverlay').style.display = 'none';
                document.getElementById('gameWrapper').style.display = '';
                document.getElementById('opponentTurnBanner').style.display = '';
                document.getElementById('networkIndicator').style.display = 'flex';
                document.getElementById('networkRoleText').textContent =
                    role === 'player1' ? '红军' : role === 'player2' ? '蓝军' : '绿军';
                _updateChatAvailability();
                console.log('[重连] UI已恢复，当前_myRole=' + (typeof getMyRole === 'function' ? getMyRole() : '?'));
                setTimeout(() => {
                    const wrapper = document.getElementById('canvasWrapper');
                    const cw = wrapper.clientWidth;
                    const ch = wrapper.clientHeight;
                    const scale = Math.min(cw / 1000, ch / 750);
                    const canvas = document.getElementById('gameCanvas');
                    canvas.style.width  = Math.floor(1000 * scale) + 'px';
                    canvas.style.height = Math.floor(750 * scale) + 'px';
                    console.log('[重连] 画布自适应完成');
                }, 100);
            } else {
                console.log('[重连] 大厅重连，刷新房间列表');
                // 大厅重连：刷新房间列表
                listRooms();
            }
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
            if (msg.skirmishFog !== undefined) gameState.skirmishFog = msg.skirmishFog;
            if (msg.gameMode !== undefined) gameState.gameMode = msg.gameMode;
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
                                tile.unit._cmdrAssignedAt = performance.now();
                                const cmdCfg = getCommander(cmdId);
                                if (cmdCfg) {
                                    const u = tile.unit;
                                    const hpFlat = Math.round(u.config.hp * (cmdCfg.hpBonusPct || 0));
                                    const atkFlat = Math.round(u.config.attack * (cmdCfg.atkBonusPct || 0));
                                    u.hp += hpFlat;
                                    u.maxHp += hpFlat;
                                    u.displayHp = u.hp;
                                    u._atkBonus = (u._atkBonus || 0) + atkFlat;
                                    u.remainingMP += cmdCfg.spdBonus || 0;
                                    u.displaySpeed += cmdCfg.spdBonus || 0;
                                }
                                break;
                            }
                        }
                    }
                }
            }
            updateCampEmblems();
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
        },

        onChatMessage: (msg) => {
            console.log('[Chat] 收到消息:', msg.channel, 'from', msg.senderRole, 'text:', msg.text?.substring(0, 30));
            const myRole = getMyRole();
            if (!myRole) { console.log('[Chat] myRole 为空，忽略'); return; }
            console.log('[Chat] myRole=' + myRole);
            const { channel, senderRole, text, targetRole } = msg;
            if (channel === 'room') {
                if (senderRole !== myRole) {
                    addChatMessage(senderRole, text, 'room', null);
                    // 自动跳转到消息所在频道（无论面板是否已打开）
                    if (_chatChannel !== 'room' || !document.getElementById('chatOverlay').classList.contains('show')) {
                        openChat('room');
                    }
                }
            } else if (channel === 'private') {
                if (targetRole === myRole && senderRole !== myRole) {
                    addChatMessage(senderRole, text, 'private', senderRole);
                    // 自动跳转到消息所在频道
                    if (_chatChannel !== 'private' || _chatTargetRole !== senderRole || !document.getElementById('chatOverlay').classList.contains('show')) {
                        openChat('private', senderRole);
                    }
                }
            }
        }
    });
}

// ==== 处理对手发来的操作 ----
let _remoteAiRunning = false;  // 防止远程AI重入
async function handleRemoteAction(msg) {
    const wasGameOver = gameState.gameOver;

    // 服务器下发的暂存状态：仅在尚未开始对局时恢复（防止对战中途地形重绘）
    if (msg.actionType === 'stateSync') {
        console.log('[重连] 收到 stateSync，_deploymentStarted=' + _deploymentStarted + '，hasState=' + !!(msg.state));
        if (!_deploymentStarted) {
            console.log('[重连] stateSync 通过检测，开始应用远程状态...');
            document.getElementById('lobbyOverlay').style.display = 'none';
            document.getElementById('gameWrapper').style.display = '';
            document.getElementById('opponentTurnBanner').style.display = '';
            document.getElementById('networkIndicator').style.display = 'flex';
            document.body.style.pointerEvents = '';
            _deploymentStarted = true;
            console.log('[重连] 调用 applyRemoteState，tiles=' + (msg.state && msg.state.tiles ? msg.state.tiles.length : '?'));
            applyRemoteState(msg.state, HexTile, Unit);
            console.log('[重连] applyRemoteState 完成，当前 tiles=' + gameState.tiles.length + '，currentCamp=' + (gameState.currentCamp && gameState.currentCamp.name));
            console.log('[重连] 卡牌状态: drawPile=' + gameState.cardDrawPile.length + '，discard=' + gameState.cardDiscardPile.length + '，p1Hand=' + gameState.playerHands.player1.length + '，p2Hand=' + gameState.playerHands.player2.length);
            // 重连恢复后重建顶栏布局（isThreePlayer 已由 applyRemoteState 恢复）
            applyTopbarLayout();
            // 初始同步时创建圣骑士环绕剑
            for (const tile of gameState.tiles) {
                if (tile.unit && tile.unit.commander === 'paladin') {
                    let count = tile.unit._faith || 0;
                    if (tile.unit._smiteReady) count += tile.unit._smiteCharged ? 2 : 1;
                    spawnPaladinOrbitBeams(tile.unit.id, tile.x, tile.y, count);
                }
            }
            updateUI();
            updateCampEmblems();
            renderGame();
            _checkSpectatorBanner();
            // 重连后重新绑定所有游戏事件（按钮 + 画布 + 键盘）
            rebindGameEvents();
            rebindInputEvents();
            rebindKeyboardEvents();
            _initEmblemChatClicks();
            console.log('[重连] 事件监听已重新绑定');
            console.log('[重连] stateSync 处理完毕，_deploymentStarted=' + _deploymentStarted);
        } else {
            console.log('[重连] stateSync 被跳过（_deploymentStarted=true），忽略此消息');
        }
        return;
    }

    applyRemoteState(msg.state, HexTile, Unit);
    updateUI(); // 远程状态同步后刷新UI（资金、统计面板、招募费用等）
    renderGame(); // 强制立即重绘画布，不等下一帧

    // 三人模式：检查本地玩家是否已投降，显示观战横幅
    _checkSpectatorBanner();

    if (gameState.gameOver && !wasGameOver) {
        setTimeout(() => triggerVictoryEffect(), 1500);
        return;
    }

    // 联机：主机收到 P2 的 endTurn 后，若状态切换为中立，自动推进回合
    // （中立AI已暂时禁用以修复联机回合切换bug，后续恢复时需重写此段）
    if (msg.actionType === 'endTurn' && gameState.currentCamp === CAMP.neutral && !gameState.gameOver) {
        if (getMyRole() === 'player1' && !_remoteAiRunning) {
            _remoteAiRunning = true;
            try {
                gameState.aiActing = true;
                try {
                    const { endTurn } = await import('./gameLogic.js');
                    await endTurn();
                } finally {
                    gameState.aiActing = false;
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
                if (e.capturedCity) {
                    const cc = e.capturedCity;
                    const cityTile = gameState.tileMap.get(`${cc.q},${cc.r}`);
                    if (cityTile && cc.campKey) {
                        const campMap = { player1: CAMP.player1, player2: CAMP.player2, player3: CAMP.player3 };
                        forceDistrictFade(cityTile, campMap[cc.campKey] || cityTile.camp);
                    }
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
                        timeLeft: 900, lastUpdate: performance.now()
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
            // 重放殉道者爆炸等将领产生的伤害数字
            if (e && e.dmgTexts) {
                for (const dt of e.dmgTexts) {
                    gameState.damageTexts.push({ ...dt, lastUpdate: performance.now() });
                }
            }
            // 重放牧师圣链治疗特效
            if (e && e.healingChains) {
                for (const hc of e.healingChains) {
                    spawnHealingChain(hc.fromX, hc.fromY, hc.toX, hc.toY);
                }
            }
            break;
        case 'tacticalCard':
            if (e) {
                // 烧牌动画（观战者：中央淡入+燃烧）
                spawnCardUseEffect(e.cardId, LOGICAL_W / 2, LOGICAL_H / 2, false, 0, 0, e.burnDisplayName || null);
                // 飞机动画提前启动，与烧牌重叠播放
                if (e.cardId === 'airdrop' || e.cardId === 'airstrike') {
                    spawnAirstrikeEffect(e.x, e.y, e.airstrikeResults || [], e.cardId === 'airdrop' ? 'airdrop' : 'airstrike');
                }
                // 具体特效延迟 1.6s 后播放（与烧牌结束对齐）
                const cardType = e.cardId;
                setTimeout(() => {
                    switch (cardType) {
                        case 'lightning': {
                            const lt = e.q != null ? gameState.tileMap.get(`${e.q},${e.r}`) : gameState.tiles.find(t => t.x === e.x && t.y === e.y);
                            if (lt && lt.unit && e.dmg) {
                                // 统一伤害入口：真实伤害绕过护盾，击杀清理由 applyDamage 处理
                                const dc = lt.unit.camp;
                                const killed = lt.unit.applyDamage(e.dmg, { source: 'true' });
                                if (killed) {
                                    const dck = dc === CAMP.player1 ? 'player1' : dc === CAMP.player2 ? 'player2' : dc === CAMP.player3 ? 'player3' : 'neutral';
                                    gameState.killCount[dck] = (gameState.killCount[dck] || 0) + 1;
                                }
                            }
                            playSound('lightning');
                            spawnLightningStrike(e.x, e.y);
                            triggerScreenShake(10, 350);
                            if (e.dmg) gameState.damageTexts.push({
                                x: e.x, y: e.y, value: e.dmg, isTrueDmg: true,
                                timeLeft: 1000, lastUpdate: performance.now()
                            });
                            break;
                        }
                        case 'heal': {
                            const ht = e.q != null ? gameState.tileMap.get(`${e.q},${e.r}`) : gameState.tiles.find(t => t.x === e.x && t.y === e.y);
                            if (ht && ht.unit && e.healAmt) {
                                ht.unit.hp = Math.min(ht.unit.maxHp, ht.unit.hp + e.healAmt);
                                gameState.healTexts.push({
                                    x: e.x, y: e.y, value: e.healAmt,
                                    timeLeft: 1000, lastUpdate: performance.now()
                                });
                                spawnHealParticles(e.x, e.y);
                                triggerHealFlash(e.x, e.y);
                            }
                            break;
                        }
                        case 'shield': {
                            const st = e.q != null ? gameState.tileMap.get(`${e.q},${e.r}`) : gameState.tiles.find(t => t.x === e.x && t.y === e.y);
                            if (st && st.unit) {
                                st.unit._shield += 50;
                                st.unit._shieldMax = Math.max(st.unit._shieldMax, st.unit._shield);
                                st.unit._shieldTurns = 3;
                            }
                            spawnCommanderSkillEffect(e.x, e.y, '🛡️', '护盾');
                            break;
                        }
                        case 'mgNest': {
                            const mgTile = e.q != null ? gameState.tileMap.get(`${e.q},${e.r}`) : gameState.tiles.find(t => t.x === e.x && t.y === e.y);
                            if (mgTile && mgTile.unit) mgTile.unit._airdropWaiting = false;
                            spawnRecruitEffect(e.x, e.y);
                            triggerRecruitFlash(e.x, e.y);
                            break;
                        }
                        case 'airdrop':
                            playSound('airstrike');
                            setTimeout(() => {
                                const adTile = e.q != null ? gameState.tileMap.get(`${e.q},${e.r}`) : gameState.tiles.find(t => t.x === e.x && t.y === e.y);
                                if (adTile && adTile.unit) {
                                    adTile.unit._airdropWaiting = false;
                                    if (adTile.isCity && adTile.unit.camp !== adTile.camp) {
                                        updateDistrictColor(adTile, adTile.unit.camp, adTile.unit);
                                    } else if (adTile.isCity && adTile.unit.camp === adTile.camp) {
                                        // 状态同步已更新camp，手动触发行政区渐变色以匹配本地视觉效果
                                        const did = adTile.districtId;
                                        for (const t of gameState.tiles) {
                                            if (t.districtId === did) t.setCampWithFade(adTile.unit.camp);
                                        }
                                    }
                                    if (adTile.isCity) {
                                        spawnExplosionParticles(e.x, e.y, '#ffd700', 12);
                                        spawnGoldParticles(e.x, e.y);
                                    }
                                }
                                spawnRecruitEffect(e.x, e.y);
                                triggerRecruitFlash(e.x, e.y);
                            }, 1500);
                            break;
                        case 'imprison':
                            spawnCommanderSkillEffect(e.x, e.y, '🔗', '禁锢');
                            break;
                        case 'forceMarch': {
                            const fm = e.q != null ? gameState.tileMap.get(`${e.q},${e.r}`) : gameState.tiles.find(t => t.x === e.x && t.y === e.y);
                            if (fm && fm.unit) {
                                fm.unit.canAct = true;
                                fm.unit.remainingMP += 2;
                            }
                            spawnCommanderSkillEffect(e.x, e.y, '🏃', '强行军');
                            break;
                        }
                        case 'airstrike': {
                            const airstrikeResults = e.airstrikeResults || [];
                            playSound('airstrike');
                            // damage/HP/particles delayed to match bomb impact timing (~1200ms into flight)
                            setTimeout(() => {
                                for (const r of airstrikeResults) {
                                    const tile = gameState.tileMap.get(`${r.q},${r.r}`);
                                    if (!tile) continue;
                                    if (tile.unit) {
                                        // 统一伤害入口：空袭为远程攻击
                                        const dc = tile.unit.camp;
                                        const killed = tile.unit.applyDamage(r.dmg, { source: 'ranged' });
                                        if (killed) {
                                            const dck = dc === CAMP.player1 ? 'player1' : dc === CAMP.player2 ? 'player2' : dc === CAMP.player3 ? 'player3' : 'neutral';
                                            gameState.killCount[dck] = (gameState.killCount[dck] || 0) + 1;
                                        }
                                    }
                                    spawnExplosionParticles(tile.x, tile.y, '#ff8800', 10);
                                    gameState.damageTexts.push({
                                        x: tile.x, y: tile.y, value: r.dmg, isCrit: false,
                                        timeLeft: 900, lastUpdate: performance.now()
                                    });
                                }
                                if (e.q != null) {
                                    const tgtTile = gameState.tileMap.get(`${e.q},${e.r}`);
                                    if (tgtTile) tgtTile._cityDisabledUntil = getRoundIndex(gameState) + 2;
                                }
                                triggerScreenShake(6, 300);
                            }, 1200);
                            break;
                        }
                        case 'airlift': {
                            // 传送已随 state 同步，远端重放空运动画（落地前隐藏该单位）
                            const aUnit = e.unitId ? gameState.tiles.reduce((f, t) => f || (t.unit?.id === e.unitId ? t.unit : null), null) : null;
                            const fromX = e.fromX != null ? e.fromX : e.x;
                            const fromY = e.fromY != null ? e.fromY : e.y - 100;
                            const landAt = spawnAirliftEffect(fromX, fromY, e.x, e.y, { color: aUnit ? aUnit.camp.color : '#8ab4ff', q: e.q, r: e.r });
                            if (aUnit) aUnit._airliftLandAt = landAt;
                            break;
                        }
                        case 'diveStrafe': {
                            // E4 空军上校：伤害在本地延迟结算，远端同样在此结算以保持一致
                            playSound('airstrike');
                            spawnAirstrikeEffect(e.x, e.y, [{ q: e.q, r: e.r, dmg: e.dmg }], 'diveStrafe', e.q, e.r);
                            setTimeout(() => {
                                const dt = e.q != null ? gameState.tileMap.get(`${e.q},${e.r}`) : null;
                                if (dt && dt.unit && e.dmg) {
                                    const dc = dt.unit.camp;
                                    const killed = dt.unit.applyDamage(e.dmg, { source: 'ranged' });
                                    if (killed) {
                                        const dck = dc === CAMP.player1 ? 'player1' : dc === CAMP.player2 ? 'player2' : dc === CAMP.player3 ? 'player3' : 'neutral';
                                        gameState.killCount[dck] = (gameState.killCount[dck] || 0) + 1;
                                    }
                                }
                                spawnExplosionParticles(e.x, e.y, '#ff8800', 15);
                                if (e.dmg) gameState.damageTexts.push({ x: e.x, y: e.y, value: e.dmg, isCrit: false, timeLeft: 900, lastUpdate: performance.now() });
                                triggerScreenShake(6, 300);
                            }, 1200);
                            break;
                        }
                        case 'carpetBomb': {
                            const cResults = e.carpetBombResults || [];
                            playSound('airstrike');
                            spawnAirstrikeEffect(e.x, e.y, cResults, 'carpetBomb', e.q, e.r);
                            setTimeout(() => {
                                for (const r of cResults) {
                                    const tile = gameState.tileMap.get(`${r.q},${r.r}`);
                                    if (!tile) continue;
                                    spawnExplosionParticles(tile.x, tile.y, '#ff8800', 10);
                                    // 仅对有单位的地块结算伤害并显示伤害数字（空地不显示）
                                    if (tile.unit && r.dmg) {
                                        const dc = tile.unit.camp;
                                        const killed = tile.unit.applyDamage(r.dmg, { source: 'ranged' });
                                        if (killed) {
                                            const dck = dc === CAMP.player1 ? 'player1' : dc === CAMP.player2 ? 'player2' : dc === CAMP.player3 ? 'player3' : 'neutral';
                                            gameState.killCount[dck] = (gameState.killCount[dck] || 0) + 1;
                                        }
                                        gameState.damageTexts.push({ x: tile.x, y: tile.y, value: r.dmg, isCrit: false, timeLeft: 900, lastUpdate: performance.now() });
                                    }
                                }
                                triggerScreenShake(8, 400);
                            }, 1200);
                            break;
                        }
                        case 'landmine':
                            // 地雷位置不能暴露给对手；爆炸由 mineTrigger 在 move 中广播
                            break;
                        case 'scout': {
                            // 侦察揭示数据已通过 state 同步（scoutReveals + visibleTiles）
                            // 远端仅重放视觉特效，不再修改数据避免阵营错配
                            spawnCommanderSkillEffect(e.x, e.y, '🔭', '侦察');
                            break;
                        }
                        case 'commanderDeploy':
                            playSound('recruit');
                            spawnCommanderSkillEffect(e.x, e.y);
                            if (e.commander === 'minister') {
                                const cmdTile = e.q != null ? gameState.tileMap.get(`${e.q},${e.r}`) : null;
                                if (cmdTile && cmdTile.isCity) spawnMinisterDominionRing(e.x, e.y);
                            }
                            break;
                    }
                }, 1600);
            }
            break;
        case 'attack':
            try {
                const _rmSmite = e?.smiteDmg > 0;
                const _rmSmiteLabel = e?.smiteLabel || '至圣斩';
                const _rmFromX = e?.fromX ?? e?.x;
                const _rmFromY = e?.fromY ?? e?.y;

                const _execAttackFx = () => {
                if (_rmSmite) {
                    setTimeout(() => playSound('lightning'), 500);
                } else {
                    playSound(e.attackerType === 'archer' || e.attackerType === 'mgNest' ? 'cannon' : (e?.isCrit ? 'crit' : 'attack'));
                }
                if (e) {
                    triggerAttackFlash(e.x, e.y, e.isCrit);
                    if (e.attackerType === 'archer' || e.attackerType === 'mgNest') {
                        spawnProjectile(e.fromX ?? e.x, e.fromY ?? e.y, e.x, e.y, e.isCrit);
                        triggerRecoil(e.fromX ?? e.x, e.fromY ?? e.y, e.x, e.y);
                        spawnDirectionalParticles(e.fromX ?? e.x, e.fromY ?? e.y, e.x, e.y, '#ff8844', e.isCrit ? 8 : 4);
                    } else {
                        spawnDirectionalParticles(e.fromX ?? e.x, e.fromY ?? e.y, e.x, e.y, '#ff8844', e.isCrit ? 22 : 10);
                        spawnSlashMarks(e.x, e.y, e.fromX ?? e.x, e.fromY ?? e.y, e.isCrit);
                        if (!e.killed && e.attackerType !== 'mgNest') triggerCharge(e.attackerUnitId ?? 0, e.fromX ?? e.x, e.fromY ?? e.y, e.x, e.y);
                    }
                    triggerScreenShake(e.isCrit ? 6 : 3, e.isCrit ? 200 : 120);
                    if (e.killed) {
                        spawnExplosionParticles(e.x, e.y, '#ff2200', 30);
                        spawnExplosionParticles(e.x, e.y, '#ffaa00', 15);
                        triggerScreenShake(4, 150);
                    }
                    if (e.cityCaptured) {
                        spawnExplosionParticles(e.x, e.y, '#ffd700', 12);
                        // 远端强制播放行政区渐变动画
                        const capturedTile = (e.q != null && e.r != null)
                            ? gameState.tileMap.get(`${e.q},${e.r}`) : null;
                        if (capturedTile) {
                            const attackerCamp = gameState.tiles.reduce((c, t) =>
                                c || (t.unit?.id === e.attackerUnitId ? t.unit.camp : null), null);
                            if (attackerCamp) forceDistrictFade(capturedTile, attackerCamp);
                        }
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
                            timeLeft: 900, lastUpdate: performance.now()
                        });
                    }
                    // 反击伤害数字
                    if (e.counterDmg > 0) {
                        gameState.damageTexts.push({
                            x: e.counterX, y: e.counterY, value: e.counterDmg, isCrit: false,
                            timeLeft: 750, lastUpdate: performance.now()
                        });
                    }
                    // 至圣斩真伤数字（金色真实伤害样式）
                    if (e.smiteDmg > 0) {
                        gameState.damageTexts.push({
                            x: e.x, y: e.y, value: e.smiteDmg, isTrueDmg: true,
                            timeLeft: 900, lastUpdate: performance.now()
                        });
                        triggerAttackFlash(e.x, e.y, true);
                        spawnCommanderSkillEffect(e.x, e.y, '✝️', '至圣斩', true);
                        triggerScreenShake(_rmSmiteLabel === '至圣斩·誓约' ? 10 : 8, 350);
                    }
                    // 圣骑士誓言金色光束
                    if (e.goldenBeamDatas) {
                        for (const gb of e.goldenBeamDatas) {
                            spawnGoldenBeam(gb.x, gb.y);
                        }
                    }
                    // 圣骑士至圣斩剑弹射（每把剑从各自轨道位置飞出）
                    // 注：环绕剑在 applyRemoteState 中已按 _faith 同步，此处仅播放弹射特效
                    if (e.paladinProjectileDatas && e.paladinProjectileDatas.length) {
                        for (const d of e.paladinProjectileDatas) {
                            spawnPaladinBeamProjectiles(d.fromX, d.fromY, d.toX, d.toY, 1);
                        }
                    }
                    // 治疗数字
                    if (e.healAmt > 0) {
                        gameState.healTexts.push({
                            x: e.healX, y: e.healY, value: e.healAmt,
                            timeLeft: 1000, lastUpdate: performance.now()
                        });
                    }
                }
                }; // _execAttackFx

                if (_rmSmite) {
                    spawnCommanderSkillEffect(_rmFromX, _rmFromY, '✝️', _rmSmiteLabel, true);
                    setTimeout(_execAttackFx, 500);
                } else {
                    _execAttackFx();
                }
            } catch (err) {
                console.warn('Remote attack effects error:', err);
            }
            break;
        case 'recruit':
            if (e) {
                triggerRecruitFlash(e.x, e.y);
                spawnRecruitEffect(e.x, e.y);
            }
            break;
        case 'reinforce':
            if (e && e.unitId) {
                const rUnit = gameState.tiles.reduce((f, t) => f || (t.unit?.id === e.unitId ? t.unit : null), null);
                if (rUnit && rUnit.tile) {
                    rUnit.heal(e.healAmt);
                    rUnit.tile._reinforcedThisTurn = true;
                    spawnReinforceEffect(e.x, e.y, e.healAmt);
                }
            }
            break;
        case 'activateSkill': {
            if (e && e.unitId) {
                const skillUnit = gameState.tiles.reduce((f, t) => f || (t.unit?.id === e.unitId ? t.unit : null), null);
                if (skillUnit && skillUnit.commander) {
                    const cmdCfg = getCommander(skillUnit.commander);
                    if (cmdCfg && cmdCfg.activeSkill) {
                        cmdCfg.activeSkill.onActivate(skillUnit, {
                            gameState, logMessage,
                            spawnFx: spawnCommanderSkillEffect,
                            spawnOrbitBeams: spawnPaladinOrbitBeams,
                            isReplay: true
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
    // 远端同步圣骑士环绕剑（paladinOrbitBeams 不参与序列化，在所有特效播放后同步）
    for (const tile of gameState.tiles) {
        if (tile.unit && tile.unit.commander === 'paladin') {
            let count = tile.unit._faith || 0;
            if (tile.unit._smiteReady) count += tile.unit._smiteCharged ? 2 : 1;
            spawnPaladinOrbitBeams(tile.unit.id, tile.x, tile.y, count);
        }
    }
}

