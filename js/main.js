import { loadSettings, saveSettings, settings, initCanvas, canvas, LOGICAL_W, LOGICAL_H, invalidateBoard, getRoundIndex } from './config.js';
import { allCommanders as COMMANDER_CONFIG, shuffleAndSplitPool } from '../commander/index.js';
import { gameState, updateUI, logMessage, applyRemoteState, notify, dismissToast, resetGameState, serializeState, updateButtonColors, getViewingCamp } from './state.js';
import { setGameStateRef as setHexTileGameStateRef } from './HexTile.js';
import { setLogMessageRef, setGameStateRef } from './Unit.js';
import { setLogMessageRef as setCiLogRef, setGameStateRef as setCiGameRef, setSpawnFxRef, setSpawnGoldenBeamRef, setSpawnOrbitBeamsRef, setClearOrbitBeamsRef, setSpawnBeamProjectilesRef, setLaunchOrbitSwordsRef, setSpawnHealingChainRef, setSpawnBloodDrainRef, setSpawnGongxinRippleRef, getCommander } from './commanderInterface.js';
import { initMap, grantTurnStartIncome, triggerVictoryEffect, showInfo, updateDistrictColor, forceDistrictFade, resetConfirmActive, rebindGameEvents, setOnFogUpdated, reapColonelKill } from './gameLogic.js';
import { renderGame, drawCardCanvas } from './renderer.js';
import { initInput, initKeyboard, initSettingsPanel, rebindInputEvents, rebindKeyboardEvents, syncBoardActionBar } from './input.js';
import { connectToServer, setNetworkCallbacks, getMyRole, sendMessage, isNetworkGame, syncCommanderState, createRoom, joinRoom, listRooms, leaveRoom, sendReady, sendUnready, manualReconnect, sendChatMessage, roleToCamp } from './network.js';
import { CAMP, COMMANDER_REROLL_COST } from './config.js';
import { COMMANDER_DRAFT } from '../rules/constants.js';
import { preloadPortraits, reloadPortraits } from './portraitLoader.js';
import {
    triggerTurnFlash,
    triggerAttackFlash, triggerRecruitFlash, triggerHealFlash,
    spawnExplosionParticles, spawnDirectionalParticles, spawnGoldParticles,
    spawnRecruitEffect,
    triggerScreenShake, spawnMoraleEffect, spawnCommanderSkillEffect, spawnRankUpEffect,
    spawnProjectile, spawnDroneProjectile, spawnStrafeTracer, spawnDroneSuicideFlak, spawnDroneDive, triggerRecoil, triggerCharge,
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
import './unitPresentationAdapter.js';
import { playSound, initAudio, setMuted, startBattleBGM, stopBattleBGM, stopLobbyBGM } from './audio.js';
import { loadCommanderFx } from './commanderFx.js';
import { emit } from './eventBus.js';
import { createHeroCarousel } from './heroCarousel.js';
import { createPreparationController } from './preparationController.js';
import { initChat, updateChatAvailability, initEmblemChatClicks, addChatMessage, openChat, isChatViewing } from './chatController.js';
import { setupTutorialBattlefield, setupRainCityBattlefield, runTutorialOpponentScript } from './tutorialScenario.js';
import { createTutorialController, setTutorialControllerRef } from './tutorialController.js';
import { createCampaignController, setCampaignControllerRef, refreshCampaignLobbyProgress } from './campaignController.js';
import { RAIN_CITY_SCENARIO } from '../campaign/content/heartAsFire.js';
import './visualEventBridge.js';
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
	const _tutorialController = createTutorialController();
	setTutorialControllerRef(_tutorialController);
	const _campaignController = createCampaignController({
		onRetry: () => beginCampaignScenario(),
		onReturn: () => returnToCampaignLobby()
	});
	setCampaignControllerRef(_campaignController);

// 将领专属视觉特效 ref 注入（供 commander 钩子通过 helpers 调用；headless 不注入即 no-op）
setSpawnBloodDrainRef(spawnBloodDrain);
setSpawnGongxinRippleRef(spawnGongxinRipple);

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
    syncBoardActionBar();

    // 对策卡手牌独立画布
    drawCardCanvas(now);

    requestAnimationFrame(gameLoop);
}
requestAnimationFrame(gameLoop);

// 首次进入大厅时后台预加载所有将领头像，避免对局中慢加载
preloadPortraits();

// 首屏立绘就绪信号：首图加载完成/失败/无图均 resolve，用于延后撤下加载遮罩
let _heroReadyResolve;
const _heroReadyPromise = new Promise(res => { _heroReadyResolve = res; });
function _signalHeroReady() { if (_heroReadyResolve) { _heroReadyResolve(); _heroReadyResolve = null; } }
const _heroCarousel = createHeroCarousel({ onReady: _signalHeroReady });
const _startHeroCarousel = () => _heroCarousel.start();
const _stopHeroCarousel = () => _heroCarousel.stop();

// 首屏立绘就绪后再撤下加载遮罩（避免露出空图占位）；最长兜底 4s 防图片异常卡住
let _loadingDismissed = false;
function _dismissLoadingWhenReady() {
    if (_loadingDismissed) return;
    _loadingDismissed = true;
    Promise.race([_heroReadyPromise, new Promise(res => setTimeout(res, 4000))])
        .then(() => document.getElementById('loadingOverlay').classList.add('hidden'));
}

// 启动首页将领立绘轮播（异步：内部会预检立绘存在性，失败静默跳过）
requestAnimationFrame(() => { _startHeroCarousel().catch(err => { console.warn('[轮播] 启动失败:', err); _signalHeroReady(); }); });

// 初始化聊天系统（事件绑定，仅一次）
initChat();

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
        onReconnecting: (n) => { setConnectionState('connecting'); connectionLabel.textContent = '重连中...'; },
        onReconnectFailed: () => { setConnectionState('disconnected'); connectionLabel.textContent = '连接断开，正在自动重连'; },
        onSocketReconnected: () => setConnectionState('connected')
    });
    // 连接成功 → 首屏立绘就绪后撤下加载遮罩、展示主页
    _dismissLoadingWhenReady();
    showHome();
}).catch(() => {
    setConnectionState('disconnected');
    // 连接失败 → 仍展示主页（本地/PVE 模式不需要服务器）
    _dismissLoadingWhenReady();
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

    document.getElementById('lobbyLeftPanel')?.classList.toggle('campaign-active', viewId === 'campaignLobbyContent');

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
    updateChatAvailability();
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

function showCampaignLobby() {
    _stopHeroCarousel();
    _heroCarousel.showCommander('berserker');
    refreshCampaignLobbyProgress();
    document.getElementById('lobbyOverlay').style.display = '';
    document.getElementById('gameWrapper').style.display = 'none';
    connectionBar.classList.add('visible');
    _switchLobbyView('campaignLobbyContent');
}

function returnToCampaignLobby() {
    _campaignController.stop();
    resetGameState();
    _deploymentStarted = false;
    document.body.style.pointerEvents = '';
    stopBattleBGM();
    playSound('lobby_bgm');
    showCampaignLobby();
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
    if (gameState.tutorialMode) return; // 教程模式禁止重新开局
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
    updateChatAvailability();
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
const _preparationController = createPreparationController({
    beginCommanderPhase,
    beginPVECommanderPhase,
    beginTrainingCommanderPhase,
    showHome,
    showMultiplayerLobby,
    setStatus,
    switchLobbyView: _switchLobbyView
});
_preparationController.init();

document.getElementById('campaignBtn').addEventListener('click', showCampaignLobby);
document.getElementById('campaignBackBtn').addEventListener('click', () => {
    showHome();
    _startHeroCarousel().catch(err => console.warn('[轮播] 恢复失败:', err));
});
document.getElementById('rainCityLevelBtn').addEventListener('click', () => {
    document.getElementById('startRainCityBtn').focus();
});
document.getElementById('startRainCityBtn').addEventListener('click', () => beginCampaignScenario());


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
function beginTrainingCountdown() {
    _stopHeroCarousel();
    document.getElementById('lobbyOverlay').style.display = 'none';
    _deploymentStarted = false;
    const commanderP1 = gameState.commanderP1;
    const commanderP2 = gameState.commanderP2;
    const commanderP1Secondary = gameState.commanderP1Secondary;
    const commanderP2Secondary = gameState.commanderP2Secondary;
    const commanderP3 = gameState.commanderP3;
    const commanderP3Secondary = gameState.commanderP3Secondary;
    const savedFog = gameState.skirmishFog;
    const savedDoubleCommanderMode = gameState.doubleCommanderMode;
    const savedThreePlayer = gameState.isThreePlayer;
    resetGameState();
    // 双人双将训练场沿用 PVE 回合逻辑；三人训练场保持同设备本地对战。
    gameState.gameMode = savedDoubleCommanderMode && !savedThreePlayer ? 'pve' : 'training';
    gameState.isThreePlayer = savedThreePlayer;
    gameState.skirmishFog = savedFog;
    gameState.doubleCommanderMode = savedDoubleCommanderMode;
    gameState.aiOpponentCamp = savedDoubleCommanderMode && !savedThreePlayer ? CAMP.player2 : null;
    gameState.aiDifficulty = 1.0;
    gameState._trainingMode = true;
    gameState.commanderPhase = 'done';
    gameState.commanderP1 = commanderP1;
    gameState.commanderP2 = commanderP2;
    gameState.commanderP1Secondary = commanderP1Secondary;
    gameState.commanderP2Secondary = commanderP2Secondary;
    gameState.commanderP3 = commanderP3;
    gameState.commanderP3Secondary = commanderP3Secondary;
    gameState.commanderP1Confirmed = !!commanderP1;
    gameState.commanderP2Confirmed = !!commanderP2;
    gameState.commanderP1SecondaryConfirmed = !!commanderP1Secondary;
    gameState.commanderP2SecondaryConfirmed = !!commanderP2Secondary;
    gameState.commanderP3Confirmed = !!commanderP3;
    gameState.commanderP3SecondaryConfirmed = !!commanderP3Secondary;
    gameState.commanderP1Deployed = false;
    gameState.commanderP2Deployed = false;
    gameState.commanderP1SecondaryDeployed = false;
    gameState.commanderP2SecondaryDeployed = false;
    gameState.commanderP3Deployed = false;
    gameState.commanderP3SecondaryDeployed = false;
    // 3秒倒计时后开始
    const overlay = document.getElementById('commanderOverlay');
    overlay.classList.remove('show');
    document.getElementById('gameWrapper').style.display = '';
    const cb = document.getElementById('turnTransitionText');
    let count = 3;
    cb.textContent = '训练场 - ' + count;
    cb.style.color = '#ffd700';
    document.getElementById('turnTransitionOverlay').classList.add('show');
    const timer = setInterval(() => {
        count--;
        if (count > 0) { cb.textContent = '训练场 - ' + count; }
        else {
            clearInterval(timer);
            document.getElementById('turnTransitionOverlay').classList.remove('show');
            _deploymentStarted = true;
            loadCommanderFx(gameState).catch(err => console.warn('[commanderFx] 加载失败:', err));
            preloadPortraits();
            initMap();
            initInput();
            initKeyboard();
            initSettingsPanel();
            setOnFogUpdated(updateCampEmblems);
            updateCampEmblems();
            updateChatAvailability();
            initEmblemChatClicks();
            gameState.currentCamp = CAMP.player1;
            grantTurnStartIncome(CAMP.player1);
            updateUI();
            updateButtonColors();
            startBattleBGM();
            playSound('turnEnd');
            renderGame();
        }
    }, 1000);
}

// ==== 固定剧本教程 ==========================================================
// 跳过选将与部署：仍沿用 PVE 的本地操作权限和胜利结算，但 AI 由教程脚本接管。
function beginTutorial() {
	_tutorialController.stop();
	_stopHeroCarousel();
	_deploymentStarted = true;
	resetGameState();
	document.getElementById('networkIndicator').style.display = 'none';
	gameState.gameMode = 'pve';
	gameState._trainingMode = true;
	gameState.tutorialMode = true;
	gameState.isThreePlayer = false;
	gameState.skirmishFog = false;
	gameState.doubleCommanderMode = false;
	gameState.aiOpponentCamp = CAMP.player2;
	gameState.aiDifficulty = 1.0;
	gameState.commanderPhase = 'done';
	gameState.commanderP1 = 'berserker';
	gameState.commanderP2 = 'centurion';
	gameState.commanderP1Confirmed = true;
	gameState.commanderP2Confirmed = true;
	gameState.commanderP1Deployed = true;
	gameState.commanderP2Deployed = true;

	document.getElementById('lobbyOverlay').style.display = 'none';
	document.getElementById('gameWrapper').style.display = '';
	document.getElementById('backToVictoryBtn').style.display = 'none';
	document.body.style.pointerEvents = '';
	const victoryOverlay = document.getElementById('victoryOverlay');
	victoryOverlay.classList.remove('show');
	victoryOverlay.style.opacity = '';
	victoryOverlay.style.backgroundColor = '';
	dismissToast();
	applyTopbarLayout();
	fitCanvas();
	stopLobbyBGM();
	stopBattleBGM();
	loadCommanderFx(gameState).catch(err => console.warn('[commanderFx] 教程将领特效加载失败:', err));

	_showCampaignIntro({
	campaignTitle: '将星列传 · 我心如火',
	scenarioSubtitle: '序 雨幕下的孤城'
}, () => {
		initMap();
		setupTutorialBattlefield();
		runTutorialOpponentScript().catch(err => console.warn('[tutorial] AI 脚本初始化失败:', err));
		initInput();
		initKeyboard();
		initSettingsPanel();
		setOnFogUpdated(updateCampEmblems);
		updateCampEmblems();
		updateChatAvailability();
		initEmblemChatClicks();
		gameState.currentCamp = CAMP.player1;
		grantTurnStartIncome(CAMP.player1);
		updateUI();
		updateButtonColors();
		startBattleBGM();
		playSound('turnEnd');
		renderGame();
		_tutorialController.start();
	});
}

// ==== 单人战役：《我心如火》·《雨幕下的孤城》 =============================
function beginCampaignScenario() {
	_campaignController.stop();
	_tutorialController.stop();
	_stopHeroCarousel();
	_deploymentStarted = true;
	resetGameState();
	gameState.gameMode = 'pve';
	gameState.campaignMode = true;
	gameState.campaignId = 'heart-as-fire';
	gameState.scenarioId = 'rain-city';
	gameState.campaignPhase = 'briefing';
	gameState.tutorialMode = true; // 首阶段使用严格引导锁；夺城后由战役控制器解除。
	gameState.tutorialStep = 'briefing';
	gameState._trainingMode = false;
	gameState.isThreePlayer = false;
	gameState.skirmishFog = false;
	gameState.doubleCommanderMode = false;
	gameState.aiOpponentCamp = CAMP.player2;
	gameState.aiDifficulty = 1.0;
	gameState.commanderPhase = 'done';

	document.getElementById('networkIndicator').style.display = 'none';
	document.getElementById('lobbyOverlay').style.display = 'none';
	document.getElementById('gameWrapper').style.display = '';
	document.getElementById('backToVictoryBtn').style.display = 'none';
	document.body.style.pointerEvents = '';
	const victoryOverlay = document.getElementById('victoryOverlay');
	victoryOverlay.classList.remove('show');
	victoryOverlay.style.opacity = '';
	victoryOverlay.style.backgroundColor = '';
	dismissToast();
	applyTopbarLayout();
	fitCanvas();
	stopLobbyBGM();
	stopBattleBGM();

	_runCountdown(() => {
		gameState.rng.setState(RAIN_CITY_SCENARIO.seed);
		initMap();
		setupRainCityBattlefield();
		loadCommanderFx(gameState).catch(err => console.warn('[campaign] 将领特效加载失败:', err));
		initInput();
		initKeyboard();
		initSettingsPanel();
		setOnFogUpdated(updateCampEmblems);
		updateCampEmblems();
		updateChatAvailability();
		initEmblemChatClicks();
		gameState.currentCamp = CAMP.player1;
		grantTurnStartIncome(CAMP.player1);
		updateUI();
		updateButtonColors();
		startBattleBGM();
		playSound('turnEnd');
		renderGame();
		_campaignController.start();
		emit('turn:started', { camp: CAMP.player1, campKey: 'player1', turnCounter: gameState.turnCounter });
	});
}
// 初始化大厅：设置 _activeLobbyView、注册 BGM 交互监听、同步静音按钮
// 延迟到连接完成后执行，避免连接完成前闪出主页
// showHome();  // 移至 connectToServer 完成后

// ==== 将领选择流程 =====================
let _commanderPending = null;
let _commanderTransitioning = false; // 防止移动端双击重复触发

const _commanderSlots = {
    player1: { primary: 'commanderP1', secondary: 'commanderP1Secondary', primaryConfirmed: 'commanderP1Confirmed', secondaryConfirmed: 'commanderP1SecondaryConfirmed' },
    player2: { primary: 'commanderP2', secondary: 'commanderP2Secondary', primaryConfirmed: 'commanderP2Confirmed', secondaryConfirmed: 'commanderP2SecondaryConfirmed' },
    player3: { primary: 'commanderP3', secondary: 'commanderP3Secondary', primaryConfirmed: 'commanderP3Confirmed', secondaryConfirmed: 'commanderP3SecondaryConfirmed' }
};

function _isCommanderSelectionComplete(forPlayer) {
    const slots = _commanderSlots[forPlayer];
    return !!(gameState[slots.primary] && (!gameState.doubleCommanderMode || gameState[slots.secondary]));
}

function _selectCommander(forPlayer, commanderId) {
    const slots = _commanderSlots[forPlayer];
    if (!gameState[slots.primary]) {
        gameState[slots.primary] = commanderId;
        gameState[slots.primaryConfirmed] = !gameState.doubleCommanderMode;
        return { selectionNumber: 1, complete: !gameState.doubleCommanderMode };
    }
    if (gameState.doubleCommanderMode && !gameState[slots.secondary] && gameState[slots.primary] !== commanderId) {
        gameState[slots.secondary] = commanderId;
        gameState[slots.primaryConfirmed] = true;
        gameState[slots.secondaryConfirmed] = true;
        return { selectionNumber: 2, complete: true };
    }
    return { selectionNumber: 0, complete: _isCommanderSelectionComplete(forPlayer) };
}

function beginCommanderPhase() {
    _stopHeroCarousel();
    document.getElementById('lobbyOverlay').style.display = 'none';
    _deploymentStarted = false;
    const savedMode = gameState.gameMode;
    const savedFog = gameState.skirmishFog;
    const savedDoubleCommanderMode = gameState.doubleCommanderMode;
    resetGameState();
    gameState.gameMode = savedMode;
    gameState.skirmishFog = savedFog;
    gameState.doubleCommanderMode = savedDoubleCommanderMode;
    _commanderTransitioning = false;
    const pool = shuffleAndSplitPool(false, savedDoubleCommanderMode ? COMMANDER_DRAFT.dualCandidatesPerPlayer : COMMANDER_DRAFT.candidatesPerPlayer, gameState.rng);
    gameState.commanderPoolP1 = pool.p1;
    gameState.commanderPoolP2 = pool.p2;
    gameState.commanderPhase = 'selection';
    _showCommanderSelection('player1');
}

// PVE 模式将领选择：人类与 AI 轮流选将
function beginTrainingCommanderPhase(humanRole) {
    _stopHeroCarousel();
    document.getElementById('lobbyOverlay').style.display = 'none';
    _deploymentStarted = false;
    const savedFog = gameState.skirmishFog;
    const savedDoubleCommanderMode = gameState.doubleCommanderMode;
    const savedThreePlayer = gameState.isThreePlayer;
    const savedDiff = gameState.aiDifficulty;
    resetGameState();
    gameState.gameMode = 'training';
    gameState.isThreePlayer = savedThreePlayer;
    gameState.skirmishFog = savedFog;
    gameState.doubleCommanderMode = savedDoubleCommanderMode;
    gameState.aiDifficulty = savedDiff;
    gameState.aiOpponentCamp = savedThreePlayer ? null : CAMP.player2;
    gameState._trainingMode = true;
    _commanderTransitioning = false;
    if (savedDoubleCommanderMode) {
        const pool = shuffleAndSplitPool(savedThreePlayer, COMMANDER_DRAFT.dualCandidatesPerPlayer, gameState.rng);
        gameState.commanderPoolP1 = pool.p1;
        gameState.commanderPoolP2 = pool.p2;
        if (savedThreePlayer) gameState.commanderPoolP3 = pool.p3 || [];
        gameState.commanderPhase = 'selection';
        _pveHumanRole = 'player1';
        _showCommanderSelection('player1');
        return;
    }
    const allKeys = Object.keys(COMMANDER_CONFIG);
    gameState.commanderPoolP1 = allKeys;
    gameState.commanderPoolP2 = [];
    gameState.commanderPhase = 'selection';
    _pveHumanRole = 'player1';
    _showTrainingCommanderSelection('player1');
}

function beginPVECommanderPhase(humanRole) {
    _stopHeroCarousel();
    document.getElementById('lobbyOverlay').style.display = 'none';
    _deploymentStarted = false;
    const savedFog = gameState.skirmishFog;
    const savedDoubleCommanderMode = gameState.doubleCommanderMode;
    const savedDiff = gameState.aiDifficulty;
    resetGameState();
    // 保持 PVE 模式状态（resetGameState 会清掉，重新设置）
    gameState.gameMode = 'pve';
    gameState.skirmishFog = savedFog;
    gameState.doubleCommanderMode = savedDoubleCommanderMode;
    gameState.aiDifficulty = savedDiff;
    gameState.aiOpponentCamp = humanRole === 'player1' ? CAMP.player2 : CAMP.player1;
    _commanderTransitioning = false;
    const pool = shuffleAndSplitPool(false, savedDoubleCommanderMode ? COMMANDER_DRAFT.dualCandidatesPerPlayer : COMMANDER_DRAFT.candidatesPerPlayer, gameState.rng);
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
    const picks = [];
    for (const pref of _GROK_PREF) {
        if (pool.includes(pref) && !picks.includes(pref)) picks.push(pref);
        if (picks.length === (gameState.doubleCommanderMode ? 2 : 1)) break;
    }
    for (const commanderId of pool) {
        if (!picks.includes(commanderId)) picks.push(commanderId);
        if (picks.length === (gameState.doubleCommanderMode ? 2 : 1)) break;
    }
    for (const commanderId of picks) _selectCommander(forPlayer, commanderId);
}

function _forPlayerCampName(forPlayer) {
    if (forPlayer === 'player1') return { name: '红军', color: '#cc4444' };
    if (forPlayer === 'player2') return { name: '蓝军', color: '#4488cc' };
    return { name: '绿军', color: '#44aa44' };
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
    const wasDoubleCommanderMode = gameState.doubleCommanderMode;
    const wasMode = gameState.gameMode;
    resetGameState();
    gameState.isThreePlayer = wasThreePlayer;
    gameState.skirmishFog = wasSkirmish;
    gameState.doubleCommanderMode = wasDoubleCommanderMode;
    gameState.gameMode = wasMode;
    _commanderTransitioning = false;
    gameState.commanderPhase = 'selection';

    const myRole = getMyRole();
    if (myRole === 'player1') {
        const is3P = gameState.isThreePlayer;
        const pool = shuffleAndSplitPool(is3P, wasDoubleCommanderMode ? COMMANDER_DRAFT.dualCandidatesPerPlayer : COMMANDER_DRAFT.candidatesPerPlayer, gameState.rng);
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
    const campName = document.getElementById('commanderCampName');
    const logo = document.getElementById('commanderLogo');
    const cardsDiv = document.getElementById('commanderCards');
    const subtitle = document.getElementById('commanderSubtitle');
    const ci = _forPlayerCampName(forPlayer);

    _commanderPending = null;
    campName.textContent = `${ci.name}`;
    campName.style.color = ci.color;
    logo.style.setProperty('--camp-color', ci.color);
    subtitle.textContent = 'AI 正在选择将领...';
    subtitle.style.color = '#aaa';
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
                `<div class="cmdr-detail-desc">${(s.desc || '暂无技能说明').replace(/\n/g, '<br>')}</div>` +
            `</div>`;
        }).join('');
    }
    const isActive = !!cfg.activeSkill;
    const typeTag = isActive
        ? '<span class="cmdr-skill-type cmdr-skill-active">主动</span>'
        : '<span class="cmdr-skill-type cmdr-skill-passive">被动</span>';
    const name = cfg.skill || cfg.activeSkill?.name || '技能';
    const desc = cfg.tooltipDesc || cfg.desc || cfg.activeSkill?.desc || '暂无技能说明';
    return `<div class="cmdr-skill-block">` +
        `<div class="cmdr-detail-skill">${typeTag}【${name}】</div>` +
        `<div class="cmdr-detail-desc">${desc.replace(/\n/g, '<br>')}</div>` +
    `</div>`;
}

function _showTrainingCommanderSelection(forPlayer) {
    const overlay = document.getElementById('commanderOverlay');
    const campName = document.getElementById('commanderCampName');
    const logo = document.getElementById('commanderLogo');
    const cardsDiv = document.getElementById('commanderCards');
    const subtitle = document.getElementById('commanderSubtitle');
    const deckEl = document.getElementById('commanderDeck');
    const pool = Object.keys(COMMANDER_CONFIG);
    const ci = _forPlayerCampName(forPlayer);

    _commanderPending = null;
    const _trainRerollBtn = document.getElementById('commanderRerollBtn');
    if (_trainRerollBtn) _trainRerollBtn.classList.remove('visible');
    campName.textContent = '训练场';
    campName.style.color = ci.color;
    logo.style.setProperty('--camp-color', ci.color);
    subtitle.textContent = '点击将领预选，再次点击确认';
    subtitle.style.color = '#888';
    subtitle.style.opacity = '0';
    cardsDiv.querySelectorAll('.commander-card').forEach(c => c.remove());

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
                        `<img src="img/commander/${cfg.name}.webp" class="cmdr-portrait-full" />` +
                        `<div class="cmdr-portrait-label">${cfg.name}</div>` +
                    `</div>` +
                    `<div class="cmdr-face-details">` +
                        `<div class="cmdr-detail-name">${cfg.name}</div>` +
                        (bonusParts.length ? `<div class="cmdr-detail-bonus">${bonusParts.join(' · ')}</div>` : '') +
                        _buildSkillHTML(cfg) +
                    `</div>` +
                `</div>` +
            `</div>`;
        card.dataset.key = key;
        card._bound = false;
        cardDatas.push({ el: card, key });
        cardsDiv.appendChild(card);
    }

    // 显示牌堆
    if (deckEl) {
        deckEl.style.display = "block";
        deckEl.style.opacity = "0";
        deckEl.style.transform = "translate(-50%, -50%) scale(0.8)";
    }
    overlay.classList.add("show");
    // 训练场选将面板加宽
    document.querySelector('.commander-panel')?.classList.add('commander-panel-training');
    const CARD_W = 180, CARD_H = 260;
    const CARDS_PER_ROW = 6;
    requestAnimationFrame(() => {
        const containerW = cardsDiv.clientWidth;
        const containerH = Math.max(cardsDiv.clientHeight, CARD_H);
        const totalSlots = cardDatas.length;
        const gap = 12;
        const rows = Math.ceil(totalSlots / CARDS_PER_ROW);
        const cols = Math.min(totalSlots, CARDS_PER_ROW);
        const totalW = cols * CARD_W + (cols - 1) * gap;
        const totalH = rows * CARD_H + (rows - 1) * gap;
        const startX = (containerW - totalW) / 2;
        const startY = (containerH - totalH) / 2;
        const tl = gsap.timeline();
        const dealDuration = 0.4;
        const dealStagger = 0.06;
        cardDatas.forEach(({ el }, i) => {
            const row = Math.floor(i / CARDS_PER_ROW);
            const col = i % CARDS_PER_ROW;
            const x = startX + col * (CARD_W + gap);
            const y = startY + row * (CARD_H + gap);
            gsap.set(el, { x, y, opacity: 0, scale: 0.6 });
            tl.to(el, { opacity: 1, scale: 1, duration: dealDuration, ease: "back.out(1.5)" }, i * dealStagger);
        });
        const lastDealEnd = (totalSlots - 1) * dealStagger + dealDuration;
        const flipBase = lastDealEnd + 0.12;
        const flipStagger = 0.18;
        tl.to(subtitle, { opacity: 1, duration: 0.3, ease: "power2.out" }, flipBase);
        cardDatas.forEach(({ el }, i) => {
            const inner = el.querySelector(".commander-card-inner");
            const revealBack = inner.querySelector(".cmdr-reveal-back");
            const persistent = inner.querySelector(".cmdr-persistent");
            const st = flipBase + i * flipStagger;
            tl.to(inner, { scaleX: 0.01, duration: 0.12, ease: "power2.in" }, st);
            tl.call(() => { revealBack.style.display = "none"; persistent.style.display = ""; }, null, st + 0.12);
            tl.to(inner, { scaleX: 1, duration: 0.12, ease: "power2.out" }, st + 0.12);
        });
        if (deckEl) {
            tl.to(deckEl, { opacity: 0, scale: 0.85, duration: 0.25, ease: "power2.out" }, lastDealEnd + 0.05);
            tl.set(deckEl, { display: "none" }, lastDealEnd + 0.30);
        }
        tl.call(() => {
            cardDatas.forEach(({ el }) => {
                const inner = el.querySelector(".commander-card-inner");
                const revealBack = inner.querySelector(".cmdr-reveal-back");
                const persistent = inner.querySelector(".cmdr-persistent");
                revealBack.style.display = "none";
                persistent.style.display = "";
                gsap.set(el, { clearProps: "transform,opacity" });
                gsap.set(inner, { clearProps: "transform" });
                el.classList.remove("animating");
                // GSAP hover 翻转（与普通选将一致）
                el.addEventListener('mouseenter', () => {
                    gsap.to(persistent, { rotateY: 180, duration: 0.45, ease: 'power2.out', overwrite: true });
                });
                el.addEventListener('mouseleave', () => {
                    gsap.to(persistent, { rotateY: 0, duration: 0.45, ease: 'power2.out', overwrite: true });
                });
            });
        }, null, "+=");
    });
    // 两阶段选将：先点一张卡选红军，再点另一张选蓝军
    let _trainPhase = 'player1'; // 'player1' | 'player2'
    subtitle.textContent = '请为红军选择将领';
    subtitle.style.color = ci.color;
    cardsDiv.addEventListener('click', function _handler(e) {
        const cardEl = e.target.closest('.commander-card');
        if (!cardEl) return;
        const key = cardEl.dataset.key;
        const cfg = COMMANDER_CONFIG[key];
        if (!cfg || cardEl.classList.contains('camp-selected') || cardEl.classList.contains('taken')) return;

        if (_commanderPending === key) {
            // Double-click confirm
            _commanderPending = null;
            const slots = _commanderSlots[_trainPhase];
            gameState[slots.primary] = key;
            gameState[slots.primaryConfirmed] = true;
            const deployedKey = _trainPhase === 'player1'
                ? 'commanderP1Deployed'
                : _trainPhase === 'player2' ? 'commanderP2Deployed' : 'commanderP3Deployed';
            gameState[deployedKey] = false;

            const nextPhase = _trainPhase === 'player1'
                ? 'player2'
                : (_trainPhase === 'player2' && gameState.isThreePlayer ? 'player3' : null);
            if (nextPhase) {
                cardEl.classList.remove('selected');
                const campLabel = _trainPhase === 'player1' ? '红军' : _trainPhase === 'player2' ? '蓝军' : '绿军';
                const campHex = _trainPhase === 'player1' ? '#cc4444' : _trainPhase === 'player2' ? '#4488cc' : '#44aa44';
                cardEl.style.setProperty('--camp-color', campHex);
                cardEl.style.setProperty('--camp-label', "'" + campLabel + "'");
                cardEl.classList.add('camp-selected');
                cardEl.style.pointerEvents = 'none';
                const nextName = nextPhase === 'player2' ? '蓝军' : '绿军';
                subtitle.textContent = `${campLabel}已选 ${cfg.name}，请为${nextName}选择将领`;
                subtitle.style.color = '#4CAF50';
                _trainPhase = nextPhase;
            } else {
                const selectedNames = [
                    `红军：${gameState.commanderP1}`,
                    `蓝军：${gameState.commanderP2}`
                ];
                if (gameState.isThreePlayer) selectedNames.push(`绿军：${gameState.commanderP3}`);
                subtitle.textContent = selectedNames.join(' ／ ');
                subtitle.style.color = '#4CAF50';
                cardsDiv.querySelectorAll('.commander-card').forEach(c => c.style.pointerEvents = 'none');
                setTimeout(() => {
                    beginTrainingCountdown();
                }, 300);
                cardsDiv.removeEventListener('click', _handler);
            }
        } else {
            cardsDiv.querySelectorAll('.commander-card').forEach(c => c.classList.remove('selected'));
            cardEl.classList.add('selected');
            _commanderPending = key;
            subtitle.textContent = `已预选【${cfg.name}】，再次点击确认`;
            subtitle.style.color = '#ffd700';
        }
    });
}

function _showCommanderSelection(forPlayer) {
    const overlay = document.getElementById('commanderOverlay');
    const campName = document.getElementById('commanderCampName');
    const logo = document.getElementById('commanderLogo');
    const cardsDiv = document.getElementById('commanderCards');
    const subtitle = document.getElementById('commanderSubtitle');
    const deckEl = document.getElementById('commanderDeck');
    const pool = _forPlayerPool(forPlayer);
    const ci = _forPlayerCampName(forPlayer);
    const rerollBtn = document.getElementById('commanderRerollBtn');
    if (rerollBtn) rerollBtn.classList.remove('visible', 'armed');

    _commanderPending = null;
    campName.textContent = `${ci.name}`;
    campName.style.color = ci.color;
    logo.style.setProperty('--camp-color', ci.color);
    subtitle.textContent = gameState.doubleCommanderMode
        ? '点击将领预选，再次点击确认；请选择 2 名将领'
        : '点击将领预选，再次点击确认';
    subtitle.style.color = '#888';
    subtitle.style.opacity = '0';
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
                        `<img src="img/commander/${cfg.name}.webp" class="cmdr-portrait-full" />` +
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
        tl.to(subtitle, { opacity: 1, duration: 0.4, ease: 'power2.out' }, flipBase);

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
                    if (el.classList.contains('confirmed') || el.classList.contains('taken')) return;
                    if (_commanderPending === key) {
                        const selection = _selectCommander(forPlayer, key);
                        if (selection.selectionNumber === 0) return;
                        el.classList.remove('selected');
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
                        if (!selection.complete) {
                            el.classList.add('taken', 'dual-selected');
                            el.style.pointerEvents = 'none';
                            subtitle.textContent = `已选择【${cfg.name}】，请选择第 2 名将领`;
                            subtitle.style.color = '#ffd700';
                            return;
                        }
                        el.classList.add('confirmed');
                        subtitle.textContent = '已确认 ✓';
                        subtitle.style.color = '#4CAF50';
                        cardsDiv.querySelectorAll('.commander-card').forEach(c => {
                            if (!c.classList.contains('confirmed') && !c.classList.contains('taken')) c.style.pointerEvents = 'none';
                        });
                        if (rerollBtn) rerollBtn.classList.remove('visible');
                        _onCommanderSelected(forPlayer);
                    } else {
                        cardsDiv.querySelectorAll('.commander-card').forEach(c => c.classList.remove('selected'));
                        el.classList.add('selected');
                        _commanderPending = key;
                        subtitle.textContent = `已预选【${cfg.name}】，再次点击确认`;
                        subtitle.style.color = '#ffd700';
                    }
                });
            }

            // 洗牌换将按钮：翻牌动画结束后出现，每人限一次；已洗牌状态不显示
            if (rerollBtn && gameState.doubleCommanderMode) {
                rerollBtn.classList.remove('visible');
                rerollBtn.onclick = null;
            } else if (rerollBtn) {
                const alreadyRerolled = !!(gameState.commanderRerolled && gameState.commanderRerolled[forPlayer]);
                if (alreadyRerolled) {
                    rerollBtn.classList.remove('visible');
                    rerollBtn.onclick = null;
                } else {
                    rerollBtn.classList.add('visible');
                    rerollBtn.textContent = `🎲换一批将领 $${COMMANDER_REROLL_COST}`;
                    rerollBtn.onclick = () => _rerollCommanders(forPlayer);
                }
            }
        }, null, lastFlipEnd + 0.05);
    });
}

// 洗牌换将：从未被占用（其他玩家已摇到的排除）的将领中重新发放 3 名，重播翻牌动画，每人限一次
function _rerollCommanders(forPlayer) {
    if (_commanderTransitioning) return;
    if (gameState.doubleCommanderMode) return;
    if (gameState.commanderRerolled && gameState.commanderRerolled[forPlayer]) return;

    // 未被占用 = 所有将领 − 各玩家当前牌池（含自己这 3 名）
    const occupied = new Set([
        ...(gameState.commanderPoolP1 || []),
        ...(gameState.commanderPoolP2 || []),
        ...(gameState.commanderPoolP3 || []),
    ]);
    const available = Object.keys(COMMANDER_CONFIG).filter(k => !occupied.has(k));
    if (available.length < 3) return; // 理论上不会发生（17 将领，最多占用 9）

    for (let i = available.length - 1; i > 0; i--) {
        const j = gameState.rng.int(i + 1);
        [available[i], available[j]] = [available[j], available[i]];
    }
    const newPool = available.slice(0, 3);

    if (!gameState.commanderRerolled) gameState.commanderRerolled = { player1: false, player2: false, player3: false };
    gameState.commanderRerolled[forPlayer] = true;
    // 换将后初始资金置为$1（而非默认$4），首回合直接生效
    gameState.playerGold[forPlayer] = 1;
    if (forPlayer === 'player1') gameState.commanderPoolP1 = newPool;
    else if (forPlayer === 'player2') gameState.commanderPoolP2 = newPool;
    else gameState.commanderPoolP3 = newPool;
    _commanderPending = null;
    playSound('cardDraw');

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

    // 重新渲染选将界面并重播发牌 + 翻牌动画
    _showCommanderSelection(forPlayer);
}

// 更新上方信息卡阵营徽章为将领透明底立绘
function updateCampEmblems() {
    const camps = [
        { id: 'emblemP1', cmdKey: gameState.commanderP1 || gameState.commanderP1Secondary, camp: CAMP.player1, textDefault: '红' },
        { id: 'emblemP2', cmdKey: gameState.commanderP2 || gameState.commanderP2Secondary, camp: CAMP.player2, textDefault: '蓝' },
        { id: 'emblemP3', cmdKey: gameState.commanderP3 || gameState.commanderP3Secondary, camp: CAMP.player3, textDefault: '绿' },
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
                el.src = `img/commander_tr/${cfg.name}.webp`;
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
    } else if (gameState.gameMode === 'pve' || (gameState.gameMode === 'training' && gameState.doubleCommanderMode && !gameState.isThreePlayer)) {
        // PVE 模式：人类选完后 AI 自动选
        const beginSelectedMatch = () => {
            document.getElementById('commanderOverlay').classList.remove('show');
            gameState.commanderPhase = 'done';
            if (gameState.gameMode === 'training') {
                beginTrainingCountdown();
            } else {
                startGame();
                _triggerInitialAITurn().catch(err => console.error('initialAI error:', err));
            }
            _commanderTransitioning = false;
        };
        if (_pveHumanRole === 'player1' && forPlayer === 'player1') {
            // 人类 P1 选完，AI 选 P2
            _pveAIQuickPick('player2');
            setTimeout(() => {
                beginSelectedMatch();
            }, 800);
        } else if (_pveHumanRole === 'player2' && forPlayer === 'player2') {
            // 人类 P2 选完（AI P1 已选），开始游戏 + AI 先手
            setTimeout(() => {
                beginSelectedMatch();
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
                if (gameState.gameMode === 'training') beginTrainingCountdown();
                else startGame();
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
    const playerConfirmed = (forPlayer) => {
        const slots = _commanderSlots[forPlayer];
        return gameState[slots.primaryConfirmed]
            && (!gameState.doubleCommanderMode || gameState[slots.secondaryConfirmed]);
    };
    const allConfirmed = gameState.isThreePlayer
        ? playerConfirmed('player1') && playerConfirmed('player2') && playerConfirmed('player3')
        : playerConfirmed('player1') && playerConfirmed('player2');
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

    // 按需加载本局将领视觉特效模块（在倒计时前发起，3秒窗口内完成动态 import）
    loadCommanderFx(gameState).catch(err => console.warn('[commanderFx] 加载失败:', err));

    // 3秒全屏倒计时
    _runCountdown(() => {
        preloadPortraits();
        initMap();
        initInput();
        initKeyboard();
        initSettingsPanel();
        setOnFogUpdated(updateCampEmblems);
        updateCampEmblems();
        updateChatAvailability();
        initEmblemChatClicks();
        gameState.currentCamp = CAMP.player1;
        grantTurnStartIncome(CAMP.player1);
        updateUI();
        updateButtonColors();
        startBattleBGM();
        playSound('turnEnd');

        const limitRound = gameState.isThreePlayer ? 25 : 18;
        const factionName = gameState.isThreePlayer ? '三人' : '双人';
        showInfo(`${factionName}模式：${limitRound}回合内控制比其他势力更多的城市即可获得游戏胜利`);
    });
}

// ---- 战役剧情开场遮罩（通用接口） ----
// config: { campaignTitle: '将星列传 · 我心如火', scenarioSubtitle: '序 雨幕下的孤城' }
// onDismiss: 点击遮罩后回调，此时遮罩已淡出
function _showCampaignIntro(config, onDismiss) {
	const overlay = document.getElementById('turnTransitionOverlay');
	const textEl = document.getElementById('turnTransitionText');
	const subEl = overlay.querySelector('.turn-transition-sub');
	if (!overlay) { onDismiss(); return; }

	// 隐藏原始子元素，注入 campaign 内容
	textEl.style.display = 'none';
	if (subEl) subEl.style.display = 'none';
	overlay.querySelectorAll('.campaign-intro-subtitle, .campaign-intro-title, .campaign-intro-hint').forEach(el => el.remove());

	const subtitle = document.createElement('div');
	subtitle.className = 'campaign-intro-subtitle';
	subtitle.textContent = config.campaignTitle || '';

	const title = document.createElement('div');
	title.className = 'campaign-intro-title';
	title.textContent = config.scenarioSubtitle || '';

	const hint = document.createElement('div');
	hint.className = 'campaign-intro-hint';
	hint.textContent = '点击开始';

	overlay.appendChild(subtitle);
	overlay.appendChild(title);
	overlay.appendChild(hint);

	overlay.classList.add('show');
	overlay.style.cursor = 'pointer';
	overlay.onclick = function handler() {
		overlay.classList.remove('show');
		overlay.style.opacity = '';
		overlay.onclick = null;
		// 移除 campaign 元素，恢复原始子元素
		subtitle.remove();
		title.remove();
		hint.remove();
		textEl.style.display = '';
		if (subEl) subEl.style.display = '';
		// 给淡出留时间再启动
		setTimeout(() => onDismiss(), 350);
	};
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
        const rules = [r.skirmishFog ? '遭遇战' : '标准'];
        if (r.doubleCommanderMode) rules.push('双将');
        const modeLabel = (maxP === 3 ? '三人' : '双人') + ' · ' + rules.join(' · ');
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
document.getElementById('createRoomBtn').addEventListener('click', () => _preparationController.showPrepDialog('createRoom'));

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
            setConnectionState('disconnected');
            if (isNetworkGame()) showHome('已断开连接，正在尝试重连...');
        },

        onSocketReconnected: () => {
            setConnectionState('connected');
        },

        onReconnecting: (attempt) => {
            setConnectionState('connecting');
            connectionLabel.textContent = '重连中...';
        },

        onReconnectFailed: () => {
            setConnectionState('disconnected');
            connectionLabel.textContent = '连接断开，正在自动重连';
            reconnectBtn.style.display = '';
        },

        onStart: (role, isThreePlayer, skirmishFog, doubleCommanderMode) => {
            if (isThreePlayer !== undefined) gameState.isThreePlayer = isThreePlayer;
            if (skirmishFog !== undefined) gameState.skirmishFog = skirmishFog;
            if (doubleCommanderMode !== undefined) gameState.doubleCommanderMode = doubleCommanderMode;
            showFactionReveal(role);
        },

        onRemoteAction: handleRemoteAction,

        onOpponentLeft: (role) => {
            const campCardId = role === 'player1' ? 'campCard1' : role === 'player2' ? 'campCard2' : role === 'player3' ? 'campCard3' : null;
            // 对局中：头像变灰 + 转圈，不弹通知
            if (gameState.commanderPhase === 'done') {
                const card = document.getElementById(campCardId);
                if (card) card.classList.add('disconnected');
                const st = serializeState();
                sendMessage({ type: 'saveState', state: st });
            } else {
                // 大厅等房间阶段：显示等待文字
                roomWaitingText.textContent = '对手已离开，等待重连...';
                readyBtn.disabled = true;
                readyBtn.textContent = '准备';
                readyBtn.classList.remove('cancel');
                readyBtn.style.background = '#27ae60';
                _isReady = false;
                _readyCount = 0;
            }
        },

        // 对手重连 → 服务器会同步暂存状态，仅通知
        onOpponentReconnected: (role) => {
            const campCardId = role === 'player1' ? 'campCard1' : role === 'player2' ? 'campCard2' : role === 'player3' ? 'campCard3' : null;
            const card = document.getElementById(campCardId);
            if (card) card.classList.remove('disconnected');
        },

        // 自己重连（大厅/对局中统一处理）
        onReconnected: (role) => {
            setConnectionState('connected');
            if (role) {
                reloadPortraits();
                _isReady = false;
                readyBtn.textContent = '准备';
                readyBtn.classList.remove('cancel');
                document.getElementById('lobbyOverlay').style.display = 'none';
                document.getElementById('victoryOverlay').classList.remove('show');
                document.getElementById('factionReveal').classList.remove('show');
                document.getElementById('commanderOverlay').classList.remove('show');
                resetConfirmActive();
                document.body.style.pointerEvents = '';
                clearTransientEffects();
                resetGameState();
                _deploymentStarted = false;
                document.getElementById('lobbyOverlay').style.display = 'none';
                document.getElementById('gameWrapper').style.display = '';
                document.getElementById('opponentTurnBanner').style.display = '';
                document.getElementById('networkIndicator').style.display = 'flex';
                document.getElementById('networkRoleText').textContent =
                    role === 'player1' ? '红军' : role === 'player2' ? '蓝军' : '绿军';
                updateChatAvailability();
                setTimeout(() => {
                    const wrapper = document.getElementById('canvasWrapper');
                    const cw = wrapper.clientWidth;
                    const ch = wrapper.clientHeight;
                    const scale = Math.min(cw / 1000, ch / 750);
                    const canvas = document.getElementById('gameCanvas');
                    canvas.style.width  = Math.floor(1000 * scale) + 'px';
                    canvas.style.height = Math.floor(750 * scale) + 'px';
                }, 100);
            } else {
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
            gameState.commanderP1Secondary = msg.commanderP1Secondary || null;
            gameState.commanderP2Secondary = msg.commanderP2Secondary || null;
            gameState.commanderP3Secondary = msg.commanderP3Secondary || null;
            gameState.commanderP1Confirmed = msg.commanderP1Confirmed || false;
            gameState.commanderP2Confirmed = msg.commanderP2Confirmed || false;
            gameState.commanderP3Confirmed = msg.commanderP3Confirmed || false;
            gameState.commanderP1SecondaryConfirmed = msg.commanderP1SecondaryConfirmed || false;
            gameState.commanderP2SecondaryConfirmed = msg.commanderP2SecondaryConfirmed || false;
            gameState.commanderP3SecondaryConfirmed = msg.commanderP3SecondaryConfirmed || false;
            gameState.commanderP1Deployed = msg.commanderP1Deployed || false;
            gameState.commanderP2Deployed = msg.commanderP2Deployed || false;
            gameState.commanderP3Deployed = msg.commanderP3Deployed || false;
            gameState.commanderP1SecondaryDeployed = msg.commanderP1SecondaryDeployed || false;
            gameState.commanderP2SecondaryDeployed = msg.commanderP2SecondaryDeployed || false;
            gameState.commanderP3SecondaryDeployed = msg.commanderP3SecondaryDeployed || false;
            gameState.commanderRerolled = {
                player1: msg.commanderRerolledP1 || false,
                player2: msg.commanderRerolledP2 || false,
                player3: msg.commanderRerolledP3 || false,
            };
            gameState.commanderPhase = msg.commanderPhase || 'selection';
            if (msg.skirmishFog !== undefined) gameState.skirmishFog = msg.skirmishFog;
            if (msg.doubleCommanderMode !== undefined) gameState.doubleCommanderMode = msg.doubleCommanderMode;
            if (msg.gameMode !== undefined) gameState.gameMode = msg.gameMode;
            if (msg.commanderDeployment || msg.deployedUnitP1 || msg.deployedUnitP2 || msg.deployedUnitP3) {
                const myRole = getMyRole();
                const applyDeployment = (unitId, cmdId) => {
                    if (!unitId || !cmdId) return;
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
                };
                if (msg.commanderDeployment) {
                    const deployment = msg.commanderDeployment;
                    if (deployment.campKey !== myRole) applyDeployment(deployment.unitId, deployment.commanderId);
                } else {
                const getOtherDeploy = (role) => {
                    if (role === 'player1') return { unitId: msg.deployedUnitP2, cmdId: gameState.commanderP2, unitId2: msg.deployedUnitP3, cmdId2: gameState.commanderP3 };
                    if (role === 'player2') return { unitId: msg.deployedUnitP1, cmdId: gameState.commanderP1, unitId2: msg.deployedUnitP3, cmdId2: gameState.commanderP3 };
                    return { unitId: msg.deployedUnitP1, cmdId: gameState.commanderP1, unitId2: msg.deployedUnitP2, cmdId2: gameState.commanderP2 };
                };
                const deploy = getOtherDeploy(myRole);
                for (const { unitId, cmdId } of [{ unitId: deploy.unitId, cmdId: deploy.cmdId }, { unitId: deploy.unitId2, cmdId: deploy.cmdId2 }]) {
                    applyDeployment(unitId, cmdId);
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
            const myRole = getMyRole();
            if (!myRole) return;
            const { channel, senderRole, text, targetRole } = msg;
            if (channel === 'room') {
                if (senderRole !== myRole) {
                    addChatMessage(senderRole, text, 'room', null);
                    // 自动跳转到消息所在频道（无论面板是否已打开）
                    if (!isChatViewing('room')) {
                        openChat('room');
                    }
                }
            } else if (channel === 'private') {
                if (targetRole === myRole && senderRole !== myRole) {
                    addChatMessage(senderRole, text, 'private', senderRole);
                    // 自动跳转到消息所在频道
                    if (!isChatViewing('private', senderRole)) {
                        openChat('private', senderRole);
                    }
                }
            }
        }
    });
}

// ==== 处理对手发来的操作 ----
// 中立回合接管：远端状态落在中立阵营且本机是驱动方（回合序最后一名存活玩家）时，
// 由本机代理中立 AI。gameLogic 内部有 _turnProcessing/aiActing 互斥，重复调用安全。
function _maybeResumeNeutralTurn() {
    if (gameState.gameOver || gameState.currentCamp !== CAMP.neutral) return;
    import('./gameLogic.js')
        .then(({ resumeNeutralTurnIfNeeded }) => resumeNeutralTurnIfNeeded())
        .catch(e => console.warn('Neutral resume error:', e));
}

async function handleRemoteAction(msg) {
    const wasGameOver = gameState.gameOver;

    // 服务器下发的暂存状态：仅在尚未开始对局时恢复（防止对战中途地形重绘）
    if (msg.actionType === 'stateSync') {
        const needsGameBootstrap = !_deploymentStarted;
        if (needsGameBootstrap) {
            document.getElementById('lobbyOverlay').style.display = 'none';
            document.getElementById('gameWrapper').style.display = '';
            document.getElementById('opponentTurnBanner').style.display = '';
            document.getElementById('networkIndicator').style.display = 'flex';
            document.body.style.pointerEvents = '';
            _deploymentStarted = true;
        }
        applyRemoteState(msg.state, HexTile, Unit);
        if (needsGameBootstrap) {
            applyTopbarLayout();
            loadCommanderFx(gameState).catch(err => console.warn('[commanderFx] 重连加载失败:', err));
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
            rebindGameEvents();
            rebindInputEvents();
            rebindKeyboardEvents();
            initSettingsPanel();
            initEmblemChatClicks();
        } else {
            syncBoardActionBar();
            updateUI();
            renderGame();
            updateCampEmblems();
            _checkSpectatorBanner();
        }
        // 重连/服务端纠偏后若正值中立回合，由驱动方客户端接手推进
        _maybeResumeNeutralTurn();
        return;
    }

    // 避免广播回显在 AI 处理期间覆盖 gameState（本端 endTurn 链已在处理，回显多余）
    if (!gameState.aiActing && !gameState.gameOver) {
        applyRemoteState(msg.state, HexTile, Unit);
        await loadCommanderFx(gameState).catch(err => console.warn('[commanderFx] 状态同步加载失败:', err));
        syncBoardActionBar();
        updateUI();
        renderGame();
    }

    // 三人模式：检查本地玩家是否已投降，显示观战横幅
    _checkSpectatorBanner();

    if (gameState.gameOver && !wasGameOver) {
        setTimeout(() => triggerVictoryEffect(), 1500);
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
                    if (fx.glyph === '💥' && fx.label === '殉道') playSound('explosion');
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
                                playSound('explosion');
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
                                playSound('machinegun');
                                const tx = e.x, ty = e.y;
                                for (let i = 0; i < 20; i++) {
                                    setTimeout(() => {
                                        const fireTime = 600 + i * 20;
                                        const p = Math.min(1, fireTime / 1350);
                                        const px = tx - 380 + 720 * p, py = ty - 300 + 320 * p;
                                        const ang = Math.atan2(320, 720);
                                        spawnStrafeTracer(px + Math.cos(ang) * 22, py + Math.sin(ang) * 22, tx, ty);
                                    }, i * 20);
                                }
                            }, 600);
                            setTimeout(() => {
                                const dt = e.q != null ? gameState.tileMap.get(`${e.q},${e.r}`) : null;
                                if (dt && dt.unit && e.dmg) {
                                    const dc = dt.unit.camp;
                                    const _isCmdR = !!dt.unit.commander;
                                    const killed = dt.unit.applyDamage(e.dmg, { source: 'ranged' });
                                    if (killed) {
                                        const dck = dc === CAMP.player1 ? 'player1' : dc === CAMP.player2 ? 'player2' : dc === CAMP.player3 ? 'player3' : 'neutral';
                                        gameState.killCount[dck] = (gameState.killCount[dck] || 0) + 1;
                                        const _colR = gameState.tiles.reduce((f, t) => f || (t.unit && t.unit.commander === 'colonel' && t.unit.camp !== dc && t.unit.camp !== CAMP.neutral && t.unit.hp > 0 ? t.unit : null), null);
                                        if (_colR) reapColonelKill(_colR, _isCmdR);
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
                                playSound('explosion');
                                for (const r of cResults) {
                                    const tile = gameState.tileMap.get(`${r.q},${r.r}`);
                                    if (!tile) continue;
                                    spawnExplosionParticles(tile.x, tile.y, '#ff8800', 10);
                                    // 仅对有单位的地块结算伤害并显示伤害数字（空地不显示）
                                    if (tile.unit && r.dmg) {
                                        const dc = tile.unit.camp;
                                        const _isCmdR = !!tile.unit.commander;
                                        const killed = tile.unit.applyDamage(r.dmg, { source: 'ranged' });
                                        if (killed) {
                                            const dck = dc === CAMP.player1 ? 'player1' : dc === CAMP.player2 ? 'player2' : dc === CAMP.player3 ? 'player3' : 'neutral';
                                            gameState.killCount[dck] = (gameState.killCount[dck] || 0) + 1;
                                            const _colR = gameState.tiles.reduce((f, t) => f || (t.unit && t.unit.commander === 'colonel' && t.unit.camp !== dc && t.unit.camp !== CAMP.neutral && t.unit.hp > 0 ? t.unit : null), null);
                                            if (_colR) reapColonelKill(_colR, _isCmdR);
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
                    playSound(e.attackerIsDrone || e.attackerType === 'mgNest' ? 'machinegun' : e.attackerType === 'archer' ? 'cannon' : (e?.isCrit ? 'crit' : 'attack'));
                }
                if (e) {
                    triggerAttackFlash(e.x, e.y, e.isCrit);
                    if (e.attackerIsDrone || e.attackerType === 'mgNest') {
                        spawnDroneProjectile(e.fromX ?? e.x, e.fromY ?? e.y, e.x, e.y, e.isCrit);
                        spawnDirectionalParticles(e.fromX ?? e.x, e.fromY ?? e.y, e.x, e.y, '#ff8844', e.isCrit ? 8 : 4);
                    } else if (e.attackerType === 'archer') {
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
                    if (e.berserkerQixue) {
                        spawnCommanderSkillEffect(e.fromX ?? e.x, e.fromY ?? e.y, '🩸', '泣血');
                        spawnExplosionParticles(e.x, e.y, '#b71c1c', 24);
                        spawnExplosionParticles(e.x, e.y, '#ff6b4a', 14);
                        for (const splash of e.berserkerSplash || []) {
                            spawnDirectionalParticles(e.x, e.y, splash.x, splash.y, '#d63c3c', splash.isCrit ? 12 : 8);
                            spawnExplosionParticles(splash.x, splash.y, '#b71c1c', splash.isCrit ? 16 : 10);
                            spawnExplosionParticles(splash.x, splash.y, '#ff8a65', splash.isCrit ? 8 : 5);
                            gameState.damageTexts.push({
                                x: splash.x, y: splash.y, value: splash.dmg, isCrit: splash.isCrit,
                                timeLeft: 900, lastUpdate: performance.now()
                            });
                        }
                        if (e.berserkerSplash?.length) playSound('explosion');
                        triggerScreenShake(8, 260);
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
                    // 反击伤害数字 + 远程单位反击炮弹动画
                    if (e.counterDmg > 0) {
                        gameState.damageTexts.push({
                            x: e.counterX, y: e.counterY, value: e.counterDmg, isCrit: !!e.counterIsCrit,
                            timeLeft: 750, lastUpdate: performance.now()
                        });
                        if (e.counterIsRanged) {
                            playSound(e.counterUsesDroneProjectile ? 'machinegun' : 'cannon');
                            triggerAttackFlash(e.counterX, e.counterY, e.counterIsCrit);
                            if (e.counterUsesDroneProjectile || e.counterIsDrone) {
                                spawnDroneProjectile(e.x, e.y, e.counterX, e.counterY, e.counterIsCrit);
                            } else {
                                spawnProjectile(e.x, e.y, e.counterX, e.counterY, e.counterIsCrit);
                                triggerRecoil(e.x, e.y, e.counterX, e.counterY);
                            }
                            spawnDirectionalParticles(e.x, e.y, e.counterX, e.counterY, '#ff8844', e.counterIsCrit ? 8 : 4);
                            triggerScreenShake(e.counterIsCrit ? 6 : 3, e.counterIsCrit ? 200 : 120);
                        }
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
        case 'droneDeploy':
            if (e) {
                emit('tianyan:droneDeploy', e);
            }
            break;
        case 'droneSuicide':
            if (e) {
                spawnDroneDive(e.fromX, e.fromY, e.x, e.y, e.campKey || 'p1');
                for (const r of e.results || []) {
                    gameState.damageTexts.push({
                        x: r.x,
                        y: r.y,
                        value: r.dmg,
                        isCrit: !!r.isCrit,
                        timeLeft: 900,
                        lastUpdate: performance.now()
                    });
                }
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

    // 对手 endTurn 把回合推进到中立（或投降直切中立）：驱动方客户端在此接手执行中立 AI
    _maybeResumeNeutralTurn();
}
