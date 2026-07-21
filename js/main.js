import { loadSettings, saveSettings, settings, initCanvas, canvas, LOGICAL_W, LOGICAL_H, invalidateBoard } from './config.js';
import { allCommanders as COMMANDER_CONFIG, shuffleAndSplitPool } from '../commander/index.js';
import { gameState, updateUI, setOnUIUpdate, logMessage, applyRemoteState, notify, dismissToast, resetGameState, serializeState, updateButtonColors, getViewingCamp, configureSkirmishState } from './state.js';
import { setGameStateRef as setHexTileGameStateRef } from './HexTile.js';
import { setLogMessageRef, setGameStateRef, setIsNetworkGameRef } from './Unit.js';
import { setLogMessageRef as setCiLogRef, setGameStateRef as setCiGameRef, setSpawnFxRef, setSpawnGoldenBeamRef, setSpawnOrbitBeamsRef, setClearOrbitBeamsRef, setSpawnBeamProjectilesRef, setSpawnHealingChainRef, setSpawnBloodDrainRef, setSpawnGongxinRippleRef, getCommander } from './commanderInterface.js';
import { initMap, grantTurnStartIncome, triggerVictoryEffect, showInfo, updateDistrictColor, forceDistrictFade, resetConfirmActive, rebindGameEvents, setOnFogUpdated, reapColonelKill, reconcilePendingSurrender, creditEagleSynergyDamage } from './gameLogic.js';
import { renderGame, drawCardCanvas, isHumanTurnForInteractionHints, renderTerrainSnapshot } from './renderer.js';
import { initInput, initKeyboard, initSettingsPanel, rebindInputEvents, rebindKeyboardEvents, syncBoardActionBar } from './input.js';
import { connectToServer, setNetworkCallbacks, getMyRole, sendMessage, isNetworkGame, syncCommanderState, createRoom, joinRoom, listRooms, leaveRoom, sendReady, sendUnready, manualReconnect, sendChatMessage, roleToCamp } from './network.js';
import { COMMANDER_REROLL_COST } from './config.js';
import { COMMANDER_DRAFT } from '../rules/constants.js';
import { ORBITAL_STRIKE_TICK_DELAYS_MS } from '../rules/cards.js';
import { damageCityPool, getCityPoolTile } from '../rules/citySiege.js';
import { preloadPortraits, reloadPortraits } from './portraitLoader.js';
import {
    triggerTurnFlash,
    triggerAttackFlash, triggerRecruitFlash, triggerHealFlash,
    spawnExplosionParticles, spawnDirectionalParticles, spawnGoldParticles,
    spawnRecruitEffect,
    triggerScreenShake, spawnMoraleEffect, spawnCommanderSkillEffect, spawnRankUpEffect,
    spawnProjectile, spawnTorpedo, getTorpedoFlightMs, spawnDroneProjectile, spawnStrafeTracer, spawnDroneSuicideFlak, spawnDroneDive, triggerRecoil, triggerCharge,
    spawnBloodDrain, spawnGongxinRipple, spawnLightningStrike, spawnOrbitalBeam,
    spawnMinisterDominionRing,
    spawnCardUseEffect,
    spawnGoldenBeam, spawnPaladinOrbitBeams, spawnPaladinBeamProjectiles, clearPaladinOrbitBeams,
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
import { replayFloatTexts, setFloatTextsSuppressed, setFloatTextCaptureSuppressed } from './floatTexts.js';
import { createHeroCarousel } from './heroCarousel.js';
import { createPreparationController } from './preparationController.js';
import { initChat, updateChatAvailability, initEmblemChatClicks, addChatMessage, openChat, isChatViewing } from './chatController.js';
import { createCampaignController, setCampaignControllerRef } from './campaignController.js';
import { getChronicle, loadScenario } from '../campaign/catalog.js';
import { renderCampaignLobby } from '../campaign/lobby.js';
import { isScenarioUnlocked, readProgress } from '../campaign/progress.js';
import './visualEventBridge.js';
import './cheat.js';
import { FACTION_PALETTE, PLAYER_FACTION_COLOR_KEYS, campToKey, getFlagColors } from '../rules/camps.js';
import { campFromKey, getRoleCamp, setPlayerFactionColor, setPlayerFactionFlagEmoji, getViewingCampKey, STANDARD_FLAG_EMOJIS } from '../rules/diplomacy.js';
import { rollFactionTurnOrder } from '../rules/turns.js';
import { ATTACK_PRESENTATION, CARRIER_STRAFE_IMPACT_MS, classifyAttackPresentation, getDiveStrafeMuzzlePosition } from '../rules/attackPresentation.js';
import { createFlagPreview } from './flagRenderer.js';
import { renderResultFlagPreviews } from './resultFlagPreview.js';
import {
    ensurePlayerProfileReady,
    readStandardFlagPreferences,
    writeStandardFlagPreference
} from './playerProfile.js';
import {
    RENDERER_BACKEND,
    PixiBattlefieldRenderer,
    battlefieldSnapshotToPixi,
    buildBattlefieldSnapshot,
    createBattlefieldRenderer,
    shouldSyncBattlefieldSnapshot
} from './rendering/index.js';
import { battlefieldDelegation, setBattlefieldDelegation } from './rendering/delegation.js';
import {
    AIR_COMMAND_IMPACT_DELAY_MS
} from '../rules/airCommands.js';
import { getCommanderFactionSynergy } from '../rules/factionSynergies.js';
import { getOracleStatueAnchor, CELESTINE_ORACLE_PULSE_TIMING } from '../rules/celestine.js';
import { resolveBorrowDay } from '../rules/tianheng.js';

const TURN_ORDER_REVEAL_DURATION_MS = 5000;
const TURN_ORDER_COUNTDOWN_DELAY_MS = 2000;
let _factionRevealTimer = null;
let _factionRevealCountdownTimers = [];
let _factionRevealAnimationFrame = null;

function _readSavedFlagCustomizations() {
    return readStandardFlagPreferences();
}

function _saveFlagCustomization(factionKey) {
    const faction = gameState.factions?.[factionKey];
    if (!faction) return;
    writeStandardFlagPreference(factionKey, { colorId: faction.colorId, emoji: faction.flagEmoji });
}

function _savedFlagEmojisFromState() {
    return Object.fromEntries(['player1', 'player2', 'player3']
        .filter(key => gameState.factions?.[key]?.flagEmoji)
        .map(key => [key, gameState.factions[key].flagEmoji]));
}

function _applySavedFlagCustomizations(factionKeys) {
    const saved = _readSavedFlagCustomizations();
    let changed = false;
    for (const factionKey of factionKeys) {
        const entry = saved[factionKey];
        if (!entry || typeof entry !== 'object') continue;
        if (setPlayerFactionColor(gameState, factionKey, entry.colorId)) changed = true;
        if (setPlayerFactionFlagEmoji(gameState, factionKey, entry.emoji)) changed = true;
        if (gameState.factions?.[factionKey]?.colorId) {
            gameState.factionColorSelections[factionKey] = gameState.factions[factionKey].colorId;
        }
    }
    return changed;
}

await ensurePlayerProfileReady();
loadSettings();
initCanvas();
initAudio();
setHexTileGameStateRef(gameState);
setLogMessageRef(logMessage);
setGameStateRef(gameState);
setIsNetworkGameRef(isNetworkGame);
setCiLogRef(logMessage);
setCiGameRef(() => gameState);
setSpawnFxRef(spawnCommanderSkillEffect);
setSpawnGoldenBeamRef(spawnGoldenBeam);
setSpawnOrbitBeamsRef(spawnPaladinOrbitBeams);
setClearOrbitBeamsRef(clearPaladinOrbitBeams);
setSpawnBeamProjectilesRef(spawnPaladinBeamProjectiles);
setSpawnHealingChainRef(spawnHealingChain);

// 战场渲染边界保持后端中立；当前注册 PixiJS，Canvas 只承担混合模式
// 的辅助图层与离屏纹理，不再作为可独立运行的完整战场后端。
const _battlefieldStage = document.getElementById('canvasStage');
let _battlefieldRenderer = null;
let _battlefieldRendererGeneration = 0;
let _battlefieldSnapshot = null;
let _battlefieldSnapshotCheckedAt = -Infinity;
let _battlefieldFrameId = 0;
let _battlefieldLastFrameAt = performance.now();
// Pixi 地形贴图：Canvas 用同一套地形代码画进离屏画布，Pixi 仅作为纹理显示。
// 双缓冲：占领渐变把终态画进背面画布并一次性上传，随后由 GPU 对两张静态
// 纹理做 alpha 交叉淡化——渐变期间零全图重画、零纹理上传。
let _terrainCanvases = [null, null];
let _terrainCanvasRatios = [1, 1];
let _terrainFrontIndex = 0;
let _terrainTextureDirty = true;
// 非空时：下一次贴图同步渲染渐变终态并启动 GPU 交叉淡化，而非全量重画。
let _terrainPendingFade = null;

const DEFAULT_BATTLEFIELD_BACKEND = RENDERER_BACKEND.PIXI_WEBGL;
const BATTLEFIELD_BACKEND_INTEGRATIONS = new Map([
    [RENDERER_BACKEND.PIXI_WEBGL, Object.freeze({
        delegation: Object.freeze({ interactionHints: true, terrain: true }),
        getCanvas: renderer => renderer?.canvas || null,
        canvasClassName: 'battlefield-pixi-canvas',
        createScene: (snapshot, context) => battlefieldSnapshotToPixi(snapshot, {
            overlayOnly: true,
            includeUnits: false,
            showGrid: context.showGrid,
            performanceProfile: context.performanceProfile
        }),
        syncTerrain: (renderer, source, scale) => renderer.syncTerrainTexture(source, scale),
        crossfadeTerrain: (renderer, source, scale, durationMs, now) => (
            typeof renderer.beginTerrainCrossfade === 'function'
                ? renderer.beginTerrainCrossfade(source, scale, durationMs, now)
                : false
        )
    })]
]);

function _battlefieldIntegration(boundary = _battlefieldRenderer) {
    return BATTLEFIELD_BACKEND_INTEGRATIONS.get(boundary?.backend) || null;
}

function _syncBattlefieldRendererDom(boundary = _battlefieldRenderer) {
    const backend = boundary?.backend || '';
    if (_battlefieldStage) _battlefieldStage.dataset.renderBackend = backend;
    const integration = _battlefieldIntegration(boundary);
    const backendCanvas = integration?.getCanvas(boundary?.renderer) || null;
    const delegation = integration?.delegation || {};
    const terrainDelegated = Boolean(delegation.terrain);
    if (backendCanvas && integration?.canvasClassName) {
        backendCanvas.classList?.add(integration.canvasClassName);
    }
    setBattlefieldDelegation(delegation);
    // 地形模式下 Pixi canvas 在 Canvas canvas 之下
    if (terrainDelegated && backendCanvas) {
        backendCanvas.style.zIndex = '0';
        canvas.style.zIndex = '2';
        canvas.style.position = 'absolute';
        canvas.style.inset = '0';
    } else if (backendCanvas) {
        backendCanvas.style.zIndex = '2';
        canvas.style.zIndex = '1';
        canvas.style.position = '';
        canvas.style.inset = '';
    } else {
        canvas.style.zIndex = '1';
        canvas.style.position = '';
        canvas.style.inset = '';
    }
}

async function _replaceBattlefieldRenderer() {
    const generation = ++_battlefieldRendererGeneration;
    const previous = _battlefieldRenderer;

    const boundary = createBattlefieldRenderer({
        preferredBackend: DEFAULT_BATTLEFIELD_BACKEND,
        performanceProfile: settings.performanceProfile || 'auto',
        reducedMotion: settings.reducedMotion ? true : undefined,
        rendererFactories: new Map([
            [RENDERER_BACKEND.PIXI_WEBGL, ({ capabilities }) => new PixiBattlefieldRenderer({
                capabilities,
                performanceProfile: settings.performanceProfile || 'auto',
                reducedMotion: settings.reducedMotion ? true : undefined,
                onContextLost: error => console.warn('[渲染] 图形上下文已丢失，等待浏览器恢复:', error),
                onContextRestored: () => {
                    _battlefieldSnapshot = null;
                    _battlefieldSnapshotCheckedAt = -Infinity;
                    _terrainTextureDirty = true;
                },
                onNotificationError: error => console.error('[渲染] 上下文通知失败:', error)
            })]
        ]),
        onBackendFailure: record => {
            console.error(`[渲染] 后端 ${record.backend} 不可用 (${record.reason})`, record.error || '');
        }
    });

    try {
        await boundary.initialize(_battlefieldStage, {
            width: LOGICAL_W,
            height: LOGICAL_H,
            devicePixelRatio: window.devicePixelRatio || 1,
            backgroundAlpha: 0
        });
    } catch (error) {
        boundary.destroy();
        if (previous) {
            console.error('[渲染] 新后端初始化失败，保留当前后端:', error);
            return false;
        }
        throw new Error('战场渲染后端初始化失败', { cause: error });
    }
    if (generation !== _battlefieldRendererGeneration) {
        boundary.destroy();
        return;
    }
    _battlefieldRenderer = boundary;
    previous?.destroy();
    _battlefieldSnapshot = null;
    _battlefieldSnapshotCheckedAt = -Infinity;
    _terrainTextureDirty = true;
    _terrainPendingFade = null;
    _syncBattlefieldRendererDom(boundary);
    return true;
}

function _syncBattlefieldScene(now) {
    const integration = _battlefieldIntegration();
    if (!_battlefieldRenderer || !integration?.createScene) return;
    if (now - _battlefieldSnapshotCheckedAt < 50) return;
    _battlefieldSnapshotCheckedAt = now;
    try {
        const next = buildBattlefieldSnapshot(gameState, {
            viewingCamp: getViewingCamp(),
            humanTurn: isHumanTurnForInteractionHints()
        });
        if (!shouldSyncBattlefieldSnapshot(_battlefieldSnapshot, next)) {
            return;
        }
        // 地形贴图只在地形相关状态（占领变色/地表/工事/城镇）变化时重画。
        // hover/选中/单位移动等交互变化不再触发全图重画 + GPU 纹理上传。
        if (_battlefieldSnapshot?.terrainSignature !== next.terrainSignature) {
            // 占领变色自带 1.5s 地块渐变：不再按 50ms 节拍整幅重画，改为
            // 渲染一次终态贴图并交给 GPU 交叉淡化（见 _syncBackendTerrainTexture）。
            const fadeMs = _maxSurfaceTransitionRemainingMs(next.tiles, now);
            if (fadeMs > 0) _terrainPendingFade = { durationMs: fadeMs };
            else _terrainTextureDirty = true;
        }
        _battlefieldSnapshot = next;
        // 地形走 Canvas 快照贴图（见 _syncBackendTerrainTexture），后端场景
        // 恒为叠加层：只承载交互提示，绝不自绘平面色块地形。
        _battlefieldRenderer.syncScene(integration.createScene(next, {
            showGrid: settings.showGrid !== false,
            performanceProfile: _battlefieldRenderer.policy?.profile || 'balanced'
        }));
    } catch (error) {
        console.error('[渲染] 后端场景同步失败:', error);
    }
}

// 快照地块上仍在进行中的地表渐变的最长剩余时长（ms），无渐变返回 0。
function _maxSurfaceTransitionRemainingMs(tiles, now) {
    let max = 0;
    for (const tile of tiles) {
        const transition = tile.surface?.transition;
        if (!transition) continue;
        const remaining = transition.startedAtMs + transition.durationMs - now;
        if (remaining > max) max = remaining;
    }
    return max;
}

function _ensureTerrainCanvas(index, ratio) {
    if (!_terrainCanvases[index] || _terrainCanvasRatios[index] !== ratio) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(LOGICAL_W * ratio);
        canvas.height = Math.round(LOGICAL_H * ratio);
        _terrainCanvases[index] = canvas;
        _terrainCanvasRatios[index] = ratio;
    }
    return _terrainCanvases[index];
}

// 地形贴图同步：委托生效时把 Canvas 地形画进离屏画布，交给注册后端显示。
// 依赖 renderGame() 已在本帧执行（材质层缓存已同步）。
function _syncBackendTerrainTexture(now) {
    const integration = _battlefieldIntegration();
    const renderer = _battlefieldRenderer?.renderer;
    if (!integration?.syncTerrain || !battlefieldDelegation.terrain || !renderer) return;
    const pendingFade = _terrainPendingFade;
    _terrainPendingFade = null;
    if (!_terrainTextureDirty && !pendingFade) return;
    _terrainTextureDirty = false;
    try {
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        if (pendingFade && integration.crossfadeTerrain) {
            // 渐变终态画进背面画布 → 一次上传 → GPU alpha 淡入。正面画布
            // 支撑的旧纹理在渐变期间原样保留，淡化结束后由渲染器接管为新基底。
            const backIndex = 1 - _terrainFrontIndex;
            const back = _ensureTerrainCanvas(backIndex, ratio);
            renderTerrainSnapshot(back.getContext('2d'), now, ratio, { finalizeFades: true });
            integration.crossfadeTerrain(renderer, back, 1 / ratio, pendingFade.durationMs, now);
            _terrainFrontIndex = backIndex;
        } else {
            const front = _ensureTerrainCanvas(_terrainFrontIndex, ratio);
            renderTerrainSnapshot(front.getContext('2d'), now, ratio);
            integration.syncTerrain(renderer, front, 1 / ratio);
        }
    } catch (error) {
        console.error('[渲染] 后端地形贴图同步失败:', error);
    }
}

await _replaceBattlefieldRenderer();

window.addEventListener('battlefield-renderer-settings-changed', event => {
    const changed = event.detail?.changed;
    invalidateBoard();
    if (changed === 'showGrid') {
        _battlefieldSnapshot = null;
        _battlefieldSnapshotCheckedAt = -Infinity;
        return;
    }
    void _replaceBattlefieldRenderer();
});
	// 编辑器测试中的关卡配置；非空时结算面板的重试/返回路由到编辑器而非战役大厅。
	let _playtestConfig = null;
	const _campaignController = createCampaignController({
		onRetry: () => _playtestConfig ? startScenarioFromConfig(_playtestConfig) : startScenario(_currentChronicleId, _currentScenarioId),
		onReturn: () => _playtestConfig ? returnToEditorFromPlaytest() : returnToCampaignLobby()
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
    if (_battlefieldStage) {
        _battlefieldStage.style.width = canvas.style.width;
        _battlefieldStage.style.height = canvas.style.height;
    }
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
    const deltaMs = Math.min(50, Math.max(0, now - _battlefieldLastFrameAt));
    _battlefieldLastFrameAt = now;
    const renderer = _battlefieldRenderer;
    if (renderer) {
        // 混合渲染：Canvas 保留辅助图层，已注册后端承担委托给它的图层。
        renderGame();
        _syncBattlefieldScene(now);
        _syncBackendTerrainTexture(now);
        try {
            renderer.render({ nowMs: now, deltaMs, frameId: ++_battlefieldFrameId });
        } catch (error) {
            console.error('[渲染] 后端帧渲染失败:', error);
        }
    }
    syncBoardActionBar();

    // 对策卡手牌独立画布
    drawCardCanvas(now);

    // 顶部阵营信息卡旗帜预览渲染
    if (_campFlagAnimationStarted) {
        _renderCampFlagPreviews(now);
    }
    renderResultFlagPreviews(now);

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
    document.getElementById('lobbyLeftPanel')?.classList.toggle('solo-active', viewId === 'soloLobbyContent');
    document.body.classList.toggle('campaign-lobby-active', viewId === 'campaignLobbyContent');

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
    renderCampaignLobby({
        onStartScenario: (chronicleId, scenarioId) => startScenario(chronicleId, scenarioId),
        onPortraitChange: (commanderId) => _heroCarousel.showCommander(commanderId)
    });
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
    const myCamp = roleToCamp(role);
    if (!myCamp) return;
    const banner = document.getElementById('opponentTurnBanner');
    if (!banner) return;
    if (gameState.surrenderedCamps.includes(myCamp)) {
        banner.innerHTML = '<span>👁</span><span>您已战败，观战中</span>';
        banner.classList.add('visible');
    }
}

// ==== 进入选将。阵营颜色在选将页选择，掷骰只决定行动顺序。 ----
function showFactionReveal(role) {
    // 清除胜利遮罩残留（GSAP inline style）
    const vo = document.getElementById('victoryOverlay');
    vo.classList.remove('show');
    vo.style.opacity = '';
    vo.style.backgroundColor = '';
    document.body.style.pointerEvents = '';

    if (isNetworkGame()) beginNetworkCommanderFlow(role);
    else if (gameState.gameMode === 'pve') beginPVECommanderPhase('player1');
    else beginCommanderPhase();
}

function _revealTurnOrder(onComplete) {
    _assignAutomaticFactionColors();
    if (!isNetworkGame()) rollFactionTurnOrder(gameState, gameState.rng);
    const overlay = document.getElementById('factionReveal');
    const flags = document.getElementById('factionRevealFlags');
    const players = (gameState.turnOrder || []).filter(key => key !== 'neutral');
    if (!overlay || !flags || players.length === 0) {
        onComplete();
        return;
    }
    if (_factionRevealTimer) window.clearTimeout(_factionRevealTimer);
    _factionRevealCountdownTimers.forEach(timer => window.clearTimeout(timer));
    _factionRevealCountdownTimers = [];
    if (_factionRevealAnimationFrame) window.cancelAnimationFrame(_factionRevealAnimationFrame);
    _factionRevealAnimationFrame = null;
    flags.replaceChildren();
    const previews = [];
    players.forEach((key, index) => {
        const faction = gameState.factions?.[key] || {};
        const card = document.createElement('div');
        card.className = 'faction-reveal-flag';
        card.style.setProperty('--reveal-delay', `${360 + index * 520}ms`);

        const canvas = document.createElement('canvas');
        canvas.className = 'faction-reveal-flag-canvas';
        canvas.width = 224;
        canvas.height = 160;
        canvas.setAttribute('aria-hidden', 'true');
        const preview = createFlagPreview(canvas);
        preview.setFaction(faction);
        previews.push(preview);

        const name = document.createElement('div');
        name.className = 'faction-reveal-name';
        name.textContent = faction.name || key;
        card.append(canvas, name);
        flags.appendChild(card);
        requestAnimationFrame(() => card.classList.add('reveal'));
    });
    const renderFlagPreviews = (now) => {
        previews.forEach(preview => preview.render(now));
        _factionRevealAnimationFrame = window.requestAnimationFrame(renderFlagPreviews);
    };
    _factionRevealAnimationFrame = window.requestAnimationFrame(renderFlagPreviews);

    const countdown = document.getElementById('factionRevealCountdown');
    const countdownNumber = document.getElementById('factionRevealCountdownNumber');
    countdown?.classList.remove('show');
    countdownNumber?.classList.remove('pulse');
    [3, 2, 1].forEach((number, index) => {
        const timer = window.setTimeout(() => {
            if (!countdown || !countdownNumber) return;
            countdownNumber.textContent = String(number);
            countdown.classList.add('show');
            countdownNumber.classList.remove('pulse');
            void countdownNumber.offsetWidth;
            countdownNumber.classList.add('pulse');
            playSound('countdown');
        }, TURN_ORDER_COUNTDOWN_DELAY_MS + index * 1000);
        _factionRevealCountdownTimers.push(timer);
    });
    overlay.classList.add('show');
    _factionRevealTimer = window.setTimeout(() => {
        _factionRevealTimer = null;
        _factionRevealCountdownTimers = [];
        try {
            // 保持准备遮罩覆盖，在其下同步建图并完成首回合初始化，避免露出空棋盘。
            onComplete();
        } finally {
            overlay.classList.remove('show');
            countdown?.classList.remove('show');
            countdownNumber?.classList.remove('pulse');
            if (_factionRevealAnimationFrame) window.cancelAnimationFrame(_factionRevealAnimationFrame);
            _factionRevealAnimationFrame = null;
        }
    }, TURN_ORDER_REVEAL_DURATION_MS);
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
        // PVE 模式：清除胜利遮罩，保留稳定人类席位后重新选将
        const overlay = document.getElementById('victoryOverlay');
        overlay.classList.remove('show');
        overlay.style.opacity = '';
        overlay.style.backgroundColor = '';
        document.body.style.pointerEvents = '';
        gameState.aiOpponentCamp = null;
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
    const fromEditor = gameState.campaignId === '__editor__';
    if (gameState.campaignMode) _campaignController.stop();
    resetGameState();
    updateChatAvailability();
    document.getElementById('gameWrapper').style.display = 'none';
    document.getElementById('backToVictoryBtn').style.display = 'none';
    if (fromEditor) {
        // 编辑器测试 → 返回编辑器
        import('../campaign/editor/editor.js').then(m => m.reopenEditorAfterPlaytest());
    } else {
        const lobby = document.getElementById('lobbyOverlay');
        lobby.style.display = '';
        showHome();
    }
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
    showMultiplayerLobby,
    setStatus,
    switchLobbyView: _switchLobbyView
});
_preparationController.init();

// ==== 单人游戏二级菜单：将星列传 / 标准对局 / 训练场 ====
function showSoloMenu() {
    _switchLobbyView('soloLobbyContent');
    connectionBar.classList.add('visible');
}
document.getElementById('soloGameBtn').addEventListener('click', showSoloMenu);
document.getElementById('soloBackBtn').addEventListener('click', () => showHome());

document.getElementById('campaignBtn').addEventListener('click', showCampaignLobby);
document.getElementById('campaignBackBtn').addEventListener('click', () => {
    // 将星列传隶属单人游戏 → 返回上级二级菜单，并恢复立绘轮播
    showSoloMenu();
    // 隐藏电影海报，恢复立绘可见性
    const poster = document.getElementById('campaignPoster');
    if (poster) poster.classList.remove('active');
    for (const id of ['heroPortraitA', 'heroPortraitB']) {
        const el = document.getElementById(id);
        if (el) el.style.opacity = '';
    }
    _startHeroCarousel().catch(err => console.warn('[轮播] 恢复失败:', err));
});
// 关卡卡/进入按钮由 campaign/lobby.js 依数据生成并绑定（见 showCampaignLobby）。

// ==== 战役编辑器（大厅第三入口；模块按需加载） ====
document.getElementById('editorBtn').addEventListener('click', async () => {
    let editor;
    try {
        editor = await import('../campaign/editor/editor.js');
    } catch (err) {
        console.error('[editor] 编辑器加载失败', err);
        setStatus('编辑器加载失败，请刷新后重试', true);
        return;
    }
    editor.initEditor({
        onPlaytest: (config) => startScenarioFromConfig(config),
        onBack: () => {
            document.getElementById('lobbyOverlay').style.display = '';
            showHome();
            _startHeroCarousel().catch(err => console.warn('[轮播] 恢复失败:', err));
        }
    });
    _stopHeroCarousel();
    document.getElementById('lobbyOverlay').style.display = 'none';
    editor.openEditor();
});


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
function beginTrainingMatch() {
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
    const savedStandardMapId = gameState.standardMapId;
    const savedColors = { ...(gameState.factionColorSelections || {}) };
    const savedFlagEmojis = _savedFlagEmojisFromState();
    const savedOrder = [...(gameState.turnOrder || [])];
    const savedRolls = { ...(gameState.turnOrderRolls || {}) };
    const savedAssignments = { ...(gameState.roleAssignments || {}) };
    resetGameState();
    // 双人双将训练场沿用 PVE 回合逻辑；三人训练场保持同设备本地对战。
    gameState.gameMode = savedDoubleCommanderMode && !savedThreePlayer ? 'pve' : 'training';
    gameState.isThreePlayer = savedThreePlayer;
    gameState.skirmishFog = savedFog;
    gameState.doubleCommanderMode = savedDoubleCommanderMode;
    gameState.standardMapId = savedStandardMapId;
    configureSkirmishState({
        playerCount: savedThreePlayer ? 3 : 2,
        colors: savedColors,
        flagEmojis: savedFlagEmojis,
        controllers: savedThreePlayer
            ? { player1: 'human', player2: 'human', player3: 'human' }
            : { player1: 'human', player2: savedDoubleCommanderMode ? 'ai' : 'human' }
    });
    if (savedOrder.length) gameState.turnOrder = savedOrder;
    gameState.turnOrderRolls = savedRolls;
    if (Object.keys(savedAssignments).length) gameState.roleAssignments = savedAssignments;
    gameState.aiOpponentCamp = savedDoubleCommanderMode && !savedThreePlayer
        ? campFromKey('player2', gameState)
        : null;
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
    // 准备遮罩仍覆盖时预先加载棋盘，移除遮罩后直接进入训练场。
    _deploymentStarted = true;
    loadCommanderFx(gameState).catch(err => console.warn('[commanderFx] 加载失败:', err));
    preloadPortraits();
    initMap();
    initInput();
	rebindGameEvents();
    initKeyboard();
    initSettingsPanel();
    setOnFogUpdated(updateCampEmblems);
    updateCampEmblems();
    updateChatAvailability();
    initEmblemChatClicks();
    const firstCamp = campFromKey(gameState.turnOrder?.[0], gameState) || campFromKey('player1', gameState);
    gameState.currentCamp = firstCamp;
    grantTurnStartIncome(firstCamp);
    updateUI();
    updateButtonColors();
    renderGame();
    const overlay = document.getElementById('commanderOverlay');
    overlay.classList.remove('show');
    document.getElementById('gameWrapper').style.display = '';
    startBattleBGM();
    playSound('turnEnd');
}

// ==== 固定剧本教程 ==========================================================
// 跳过选将与部署：仍沿用 PVE 的本地操作权限和胜利结算，但 AI 由教程脚本接管。

// ==== 单人战役：通用关卡启动（懒加载关卡内容 → 建图 → 交由通用控制器驱动）====
let _currentChronicleId = null;
let _currentScenarioId = null;

async function startScenario(chronicleId, scenarioId) {
	const chronicle = getChronicle(chronicleId);
	if (!chronicle || !isScenarioUnlocked(chronicle.scenarios, scenarioId, readProgress(chronicle.storageKey))) {
		console.warn(`[campaign] 关卡尚未解锁：${chronicleId}/${scenarioId}`);
		return;
	}
	let scenario;
	try {
		scenario = await loadScenario(chronicleId, scenarioId);
	} catch (err) {
		console.error(`[campaign] 关卡加载失败：${chronicleId}/${scenarioId}`, err);
		return;
	}
	if (!scenario) { console.warn(`[campaign] 未找到关卡：${chronicleId}/${scenarioId}`); return; }
	_currentChronicleId = chronicleId;
	_currentScenarioId = scenarioId;
	_playtestConfig = null;
	_launchScenario(scenario);
}

// 编辑器测试：配置直接包装为 scenario 启动，跳过选将与倒计时，不写通关进度。
async function startScenarioFromConfig(config) {
	let scenario;
	try {
		const { scenarioFromConfig } = await import('../campaign/runtime/scenarioFromConfig.js');
		// 保留编辑器当前快照，并用另一份副本编译运行时，避免运行时字段回写到下次试玩。
		_playtestConfig = structuredClone(config);
		scenario = scenarioFromConfig(structuredClone(_playtestConfig), { storageKey: '' });
	} catch (err) {
		console.error('[editor] 试玩关卡构建失败', err);
		return;
	}
	document.getElementById('editorOverlay').style.display = 'none';
	_launchScenario(scenario);
}

function returnToEditorFromPlaytest() {
	_campaignController.stop();
	resetGameState();
	_deploymentStarted = false;
	document.body.style.pointerEvents = '';
	stopBattleBGM();
	document.getElementById('gameWrapper').style.display = 'none';
	import('../campaign/editor/editor.js').then(m => m.reopenEditorAfterPlaytest());
}

function _launchScenario(scenario) {
	_campaignController.stop();
	_stopHeroCarousel();
	_deploymentStarted = true;
	resetGameState();
	gameState.gameMode = 'pve';
	gameState.campaignMode = true;
	gameState.campaignId = _playtestConfig ? '__editor__' : _currentChronicleId;
	gameState.scenarioId = scenario.id;
	gameState.scenarioDisplayId = scenario.displayId || (scenario.id || '').toUpperCase();
	gameState.scenarioTitle = scenario.title || '';
	gameState.campaignPhase = scenario.initialStep;
		gameState._campaignIntro = scenario.intro || {};
	// tutorialMode 默认 false；需要锁定操作时在触发器 showStep 中设 lock: true。
	gameState.isThreePlayer = false;
	gameState.skirmishFog = false;
	gameState.doubleCommanderMode = false;
	// 配置关卡会在 buildBattlefield 中按阵营配置设置 AI 阵营；不在这里覆盖，
	// 否则自定义阵营和作者设定的回合顺序会被硬编码的 player2 破坏。
	gameState.aiOpponentCamp = null;
	gameState.aiDifficulty = scenario.aiDifficulty ?? 1.0;
	gameState.commanderPhase = 'done';

	_campaignController.loadScenarioRuntime(scenario);

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

	// 在遮罩后预先加载棋盘，避免玩家点击后才看到空棋盘
	gameState.rng.setState(scenario.seed);
	// 配置关卡自带棋盘（半径/城市/区划由配置决定），跳过标准建图。
	if (!scenario.buildsOwnBoard) initMap();
	scenario.buildBattlefield();
	loadCommanderFx(gameState).catch(err => console.warn('[campaign] 将领特效加载失败:', err));
	initInput();
	rebindGameEvents();
	initKeyboard();
	initSettingsPanel();
	setOnFogUpdated(updateCampEmblems);
	updateCampEmblems();
	setOnUIUpdate(() => {
	    _updateCampFlagPreviews();
	    _syncCampFlagVisibility();
	});
	_ensureCampFlagPreviews();
	_updateCampFlagPreviews();
	_syncCampFlagVisibility();
	updateChatAvailability();
	initEmblemChatClicks();
	// 配置关卡：初始金币以配置为准，不叠加首回合收入（编辑器所见即所得）。
	if (!scenario.buildsOwnBoard) grantTurnStartIncome(gameState.currentCamp);
	updateUI();
	updateButtonColors();
	renderGame();

	_showCampaignIntro(scenario.intro, () => {
		startBattleBGM();
		playSound('turnEnd');
		_campaignController.start();
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
    const savedThreePlayer = gameState.isThreePlayer;
    const savedStandardMapId = gameState.standardMapId;
    resetGameState();
    gameState.gameMode = savedMode;
    gameState.skirmishFog = savedFog;
    gameState.doubleCommanderMode = savedDoubleCommanderMode;
    gameState.standardMapId = savedStandardMapId;
    configureSkirmishState({
        playerCount: savedThreePlayer ? 3 : 2,
        controllers: { player1: 'human', player2: 'human', player3: 'human' }
    });
    _applySavedFlagCustomizations(savedThreePlayer ? ['player1', 'player2', 'player3'] : ['player1', 'player2']);
    _commanderTransitioning = false;
    const pool = shuffleAndSplitPool(savedThreePlayer, savedDoubleCommanderMode ? COMMANDER_DRAFT.dualCandidatesPerPlayer : COMMANDER_DRAFT.candidatesPerPlayer, gameState.rng);
    gameState.commanderPoolP1 = pool.p1;
    gameState.commanderPoolP2 = pool.p2;
    if (savedThreePlayer) gameState.commanderPoolP3 = pool.p3 || [];
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
    const savedStandardMapId = gameState.standardMapId;
    resetGameState();
    gameState.gameMode = 'training';
    gameState.isThreePlayer = savedThreePlayer;
    gameState.skirmishFog = savedFog;
    gameState.doubleCommanderMode = savedDoubleCommanderMode;
    gameState.aiDifficulty = savedDiff;
    gameState.standardMapId = savedStandardMapId;
    configureSkirmishState({
        playerCount: savedThreePlayer ? 3 : 2,
        controllers: savedThreePlayer
            ? { player1: 'human', player2: 'human', player3: 'human' }
            : { player1: 'human', player2: 'ai' }
    });
    _applySavedFlagCustomizations(savedThreePlayer ? ['player1', 'player2', 'player3'] : ['player1']);
    gameState.aiOpponentCamp = savedThreePlayer ? null : campFromKey('player2', gameState);
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
    // 再来一局时不能让上一局的画布继续作为“已开局”信号留在选将层下方。
    document.getElementById('gameWrapper').style.display = 'none';
    _deploymentStarted = false;
    const savedFog = gameState.skirmishFog;
    const savedDoubleCommanderMode = gameState.doubleCommanderMode;
    const savedDiff = gameState.aiDifficulty;
    const savedStandardMapId = gameState.standardMapId;
    resetGameState();
    // 保持 PVE 模式状态（resetGameState 会清掉，重新设置）
    gameState.gameMode = 'pve';
    gameState.skirmishFog = savedFog;
    gameState.doubleCommanderMode = savedDoubleCommanderMode;
    gameState.aiDifficulty = savedDiff;
    gameState.standardMapId = savedStandardMapId;
    configureSkirmishState({ playerCount: 2, controllers: { player1: 'human', player2: 'ai' } });
    _applySavedFlagCustomizations(['player1']);
    gameState.aiOpponentCamp = campFromKey('player2', gameState);
    _commanderTransitioning = false;
    const pool = shuffleAndSplitPool(false, savedDoubleCommanderMode ? COMMANDER_DRAFT.dualCandidatesPerPlayer : COMMANDER_DRAFT.candidatesPerPlayer, gameState.rng);
    gameState.commanderPoolP1 = pool.p1;
    gameState.commanderPoolP2 = pool.p2;
    gameState.commanderPhase = 'selection';

    // 玩家身份固定为第一席位；阵营色与先后手分别在选将页和掷骰阶段决定。
    _pveHumanRole = 'player1';
    _showCommanderSelection('player1');
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
    const faction = gameState.factions?.[forPlayer] || campFromKey(forPlayer, gameState);
    const colors = getFlagColors(faction?.colorId || faction?.color);
    return { name: faction?.name || forPlayer, color: colors.main, faction };
}

let _commanderFlagPreview = null;
let _commanderFlagAnimationStarted = false;
let _commanderHeaderFactionKey = 'player1';

function _ensureCommanderFlagPreview() {
    if (_commanderFlagPreview) return _commanderFlagPreview;
    const canvas = document.getElementById('commanderFlagCanvas');
    try {
        _commanderFlagPreview = createFlagPreview(canvas);
        if (!_commanderFlagAnimationStarted) {
            _commanderFlagAnimationStarted = true;
            const animate = now => {
                if (document.getElementById('commanderOverlay')?.classList.contains('show')) {
                    _commanderFlagPreview?.render(now);
                }
                requestAnimationFrame(animate);
            };
            requestAnimationFrame(animate);
        }
    } catch (error) {
        console.warn('[commander] WebGL2 旗帜预览不可用:', error);
    }
    return _commanderFlagPreview;
}

// ── 顶部阵营信息卡旗帜预览 ──────────────────────────────

let _campFlagPreviews = { p1: null, p2: null, p3: null };
let _campFlagAnimationStarted = false;

function _ensureCampFlagPreviews() {
    const canvasIds = { p1: 'campFlagPreview1', p2: 'campFlagPreview2', p3: 'campFlagPreview3' };
    let anyNew = false;
    for (const [key, id] of Object.entries(canvasIds)) {
        if (_campFlagPreviews[key]) continue;
        const canvas = document.getElementById(id);
        if (!canvas) continue;
        try {
            _campFlagPreviews[key] = createFlagPreview(canvas);
            anyNew = true;
        } catch (error) {
            console.warn(`[campFlag] WebGL2 旗帜预览不可用 (${key}):`, error);
        }
    }
    if (anyNew && !_campFlagAnimationStarted) {
        _campFlagAnimationStarted = true;
    }
}

function _updateCampFlagPreviews() {
    if (!gameState) return;
    _ensureCampFlagPreviews();
    // 标准模式：player1/p2/p3 对应三张阵营卡
    // 战役模式：本地阵营数据映射到 campCard1（右卡替换为战役信息栏）
    const localKey = getViewingCampKey(gameState);
    const campKeys = gameState.campaignMode
        ? [[localKey, 'p1']]
        : [['player1', 'p1'], ['player2', 'p2'], ['player3', 'p3']];
    for (const [gameKey, previewKey] of campKeys) {
        const preview = _campFlagPreviews[previewKey];
        if (!preview) continue;
        const faction = campFromKey(gameKey, gameState);
        if (faction) preview.setFaction(faction);
    }
}

function _renderCampFlagPreviews(now) {
    for (const preview of Object.values(_campFlagPreviews)) {
        if (preview) preview.render(now);
    }
}

function _syncCampFlagVisibility() {
    const cards = [
        { cardId: 'campCard1', gameKey: 'player1' },
        { cardId: 'campCard2', gameKey: 'player2' },
        { cardId: 'campCard3', gameKey: 'player3' },
    ];
    for (const { cardId, gameKey } of cards) {
        const card = document.getElementById(cardId);
        const canvas = card?.querySelector('.camp-flag-preview');
        if (!canvas) continue;
        // 战役模式：campCard1 展示本地阵营旗帜，其余隐藏；
        // 标准对局（本地/联机/遭遇战/训练）：全部展示
        if (gameState.campaignMode) {
            canvas.style.display = cardId === 'campCard1' ? '' : 'none';
        } else {
            canvas.style.display = '';
        }
    }
}

function _canShowCampFlagCards() {
    if (!gameState) return false;
    const overlay = document.getElementById('commanderOverlay');
    if (overlay?.classList.contains('show')) return false;  // 选将界面由 commanderFlagCanvas 展示
    // 游戏进行中且地图已初始化
    return !!gameState.currentCamp;
}

function _canChooseFactionColor(forPlayer, locked = false) {
    if (locked) return false;
    if (isNetworkGame()) return getMyRole() === forPlayer;
    if (gameState.gameMode === 'pve') return _pveHumanRole === forPlayer;
    return true;
}

function _renderFactionColorPicker(forPlayer, locked = false) {
    const picker = document.getElementById('commanderColorPicker');
    const logo = document.getElementById('commanderLogo');
    const canChoose = _canChooseFactionColor(forPlayer, locked);
    const occupied = new Set(Object.entries(gameState.factionColorSelections || {})
        .filter(([key]) => {
            if (key === forPlayer || gameState.factions?.[key]?.active === false) return false;
            if (isNetworkGame()) return true;
            const slots = _commanderSlots[key];
            return slots ? gameState[slots.primaryConfirmed] === true : false;
        })
        .map(([, colorId]) => colorId));
    picker.innerHTML = '';
    const makeSection = (label, kind) => {
        const section = document.createElement('div');
        section.className = 'commander-picker-section';
        const heading = document.createElement('div');
        heading.className = 'commander-picker-label';
        heading.textContent = label;
        const options = document.createElement('div');
        options.className = `commander-picker-options ${kind}`;
        section.append(heading, options);
        picker.appendChild(section);
        return options;
    };
    const colorOptions = makeSection('旗帜颜色', 'colors');
    for (const entry of FACTION_PALETTE.filter(item => PLAYER_FACTION_COLOR_KEYS.includes(item.id))) {
        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.className = 'commander-color-swatch';
        swatch.dataset.colorId = entry.id;
        swatch.setAttribute('aria-label', `${entry.label}色阵营`);
        swatch.title = `${entry.label}色阵营`;
        swatch.style.background = `linear-gradient(135deg, ${entry.flag.light}, ${entry.flag.main} 52%, ${entry.flag.dark})`;
        swatch.classList.toggle('selected', gameState.factions?.[forPlayer]?.colorId === entry.id);
        swatch.disabled = !canChoose || occupied.has(entry.id);
        swatch.addEventListener('click', event => {
            event.stopPropagation();
            if (!setPlayerFactionColor(gameState, forPlayer, entry.id)) return;
            gameState.factionColorSelections[forPlayer] = entry.id;
            _saveFlagCustomization(forPlayer);
            if (isNetworkGame()) sendMessage({ type: 'factionColor', colorId: entry.id });
            _configureCommanderFactionHeader(forPlayer, { locked, keepPickerOpen: true });
        });
        colorOptions.appendChild(swatch);
    }
    const emojiOptions = makeSection('旗面徽记', 'emojis');
    for (const entry of STANDARD_FLAG_EMOJIS) {
        const emojiButton = document.createElement('button');
        emojiButton.type = 'button';
        emojiButton.className = 'commander-emoji-option';
        emojiButton.dataset.emoji = entry.emoji;
        emojiButton.textContent = entry.emoji;
        emojiButton.setAttribute('aria-label', `旗面徽记：${entry.label}`);
        emojiButton.title = entry.label;
        emojiButton.classList.toggle('selected', gameState.factions?.[forPlayer]?.flagEmoji === entry.emoji);
        emojiButton.disabled = !canChoose;
        emojiButton.addEventListener('click', event => {
            event.stopPropagation();
            if (!setPlayerFactionFlagEmoji(gameState, forPlayer, entry.emoji)) return;
            _saveFlagCustomization(forPlayer);
            if (isNetworkGame()) sendMessage({ type: 'factionColor', flagEmoji: entry.emoji });
            _configureCommanderFactionHeader(forPlayer, { locked, keepPickerOpen: true });
        });
        emojiOptions.appendChild(emojiButton);
    }
    logo.disabled = !canChoose;
}

function _configureCommanderFactionHeader(forPlayer, { locked = false, nameOverride = null, keepPickerOpen = false } = {}) {
    _commanderHeaderFactionKey = forPlayer;
    const ci = _forPlayerCampName(forPlayer);
    const campName = document.getElementById('commanderCampName');
    const logo = document.getElementById('commanderLogo');
    const picker = document.getElementById('commanderColorPicker');
    campName.textContent = nameOverride || ci.name;
    campName.style.color = ci.color;
    logo.style.setProperty('--camp-color', ci.color);
    _ensureCommanderFlagPreview()?.setFaction(ci.faction);
    picker.classList.toggle('open', keepPickerOpen);
    logo.setAttribute('aria-expanded', String(keepPickerOpen));
    logo.onclick = () => {
        if (logo.disabled) return;
        const open = !picker.classList.contains('open');
        picker.classList.toggle('open', open);
        logo.setAttribute('aria-expanded', String(open));
    };
    _renderFactionColorPicker(forPlayer, locked);
}

function _assignAutomaticFactionColors() {
    const used = new Set();
    for (const key of ['player1', 'player2', 'player3']) {
        const faction = gameState.factions?.[key];
        if (!faction || faction.active === false) continue;
        let colorId = faction.colorId;
        if (used.has(colorId)) colorId = FACTION_PALETTE.find(entry => PLAYER_FACTION_COLOR_KEYS.includes(entry.id) && !used.has(entry.id))?.id || colorId;
        setPlayerFactionColor(gameState, key, colorId);
        gameState.factionColorSelections[key] = colorId;
        used.add(colorId);
    }
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
    const wasColors = { ...(gameState.factionColorSelections || {}) };
    const wasFlagEmojis = _savedFlagEmojisFromState();
    const wasOrder = [...(gameState.turnOrder || [])];
    const wasRolls = { ...(gameState.turnOrderRolls || {}) };
    const wasAssignments = { ...(gameState.roleAssignments || {}) };
    const wasStandardMapId = gameState.standardMapId;
    resetGameState();
    gameState.isThreePlayer = wasThreePlayer;
    gameState.skirmishFog = wasSkirmish;
    gameState.doubleCommanderMode = wasDoubleCommanderMode;
    gameState.gameMode = wasMode;
    gameState.standardMapId = wasStandardMapId;
    // 联机对局所有玩家席位都是人类；缺省 controllers 会把 player2/player3 置为 'ai'，
    // 导致这些阵营的单位在任一模拟端升阶时被 AI 逻辑自动选择专精并随快照污染全场。
    configureSkirmishState({
        playerCount: wasThreePlayer ? 3 : 2,
        colors: wasColors,
        flagEmojis: wasFlagEmojis,
        controllers: { player1: 'human', player2: 'human', player3: 'human' }
    });
    if (wasOrder.length) gameState.turnOrder = wasOrder;
    gameState.turnOrderRolls = wasRolls;
    if (Object.keys(wasAssignments).length) gameState.roleAssignments = wasAssignments;
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
    const cardsDiv = document.getElementById('commanderCards');
    const subtitle = document.getElementById('commanderSubtitle');

    _commanderPending = null;
    _configureCommanderFactionHeader(forPlayer, { locked: true });
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

function _buildFactionSynergyCardMarker(commanderId) {
    const synergy = getCommanderFactionSynergy(commanderId);
    if (!synergy) return '';
    const marker = synergy.marker;
    const markerStyle = [
        `--synergy-marker-color:${marker.color}`,
        `--synergy-marker-border:${marker.borderColor}`,
        `--synergy-marker-background:${marker.background}`,
        `--synergy-marker-glow:${marker.glowColor}`
    ].join(';');
    return `<span class="cmdr-faction-synergy-marker" data-faction-synergy="${synergy.id}" `
        + `aria-label="${marker.label}" style="${markerStyle}">${marker.symbol}</span>`;
}

function _showTrainingCommanderSelection(forPlayer) {
    const overlay = document.getElementById('commanderOverlay');
    const cardsDiv = document.getElementById('commanderCards');
    const subtitle = document.getElementById('commanderSubtitle');
    const deckEl = document.getElementById('commanderDeck');
    const pool = Object.keys(COMMANDER_CONFIG);

    _commanderPending = null;
    const _trainRerollBtn = document.getElementById('commanderRerollBtn');
    if (_trainRerollBtn) _trainRerollBtn.classList.remove('visible');
    _configureCommanderFactionHeader(forPlayer, { nameOverride: '训练场' });
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
                        _buildFactionSynergyCardMarker(key) +
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
    // 多席位依次选将；席位颜色由当前页面上的旗帜选择器决定。
    let _trainPhase = 'player1'; // 'player1' | 'player2'
    subtitle.textContent = `请为${_forPlayerCampName(_trainPhase).name}选择将领`;
    subtitle.style.color = _forPlayerCampName(_trainPhase).color;
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
                const currentInfo = _forPlayerCampName(_trainPhase);
                const campLabel = currentInfo.name;
                const campHex = currentInfo.color;
                cardEl.style.setProperty('--camp-color', campHex);
                cardEl.style.setProperty('--camp-label', "'" + campLabel + "'");
                cardEl.classList.add('camp-selected');
                cardEl.style.pointerEvents = 'none';
                const nextName = _forPlayerCampName(nextPhase).name;
                subtitle.textContent = `${campLabel}已选 ${cfg.name}，请为${nextName}选择将领`;
                subtitle.style.color = '#4CAF50';
                _trainPhase = nextPhase;
                _configureCommanderFactionHeader(nextPhase, { nameOverride: '训练场' });
            } else {
                const selectedNames = [
                    `${_forPlayerCampName('player1').name}：${gameState.commanderP1}`,
                    `${_forPlayerCampName('player2').name}：${gameState.commanderP2}`
                ];
                if (gameState.isThreePlayer) selectedNames.push(`${_forPlayerCampName('player3').name}：${gameState.commanderP3}`);
                subtitle.textContent = selectedNames.join(' ／ ');
                subtitle.style.color = '#4CAF50';
                cardsDiv.querySelectorAll('.commander-card').forEach(c => c.style.pointerEvents = 'none');
                setTimeout(() => {
                    _revealTurnOrder(beginTrainingMatch);
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
    const cardsDiv = document.getElementById('commanderCards');
    const subtitle = document.getElementById('commanderSubtitle');
    const deckEl = document.getElementById('commanderDeck');
    const pool = _forPlayerPool(forPlayer);
    const rerollBtn = document.getElementById('commanderRerollBtn');
    if (rerollBtn) rerollBtn.classList.remove('visible', 'armed');

    _commanderPending = null;
    _configureCommanderFactionHeader(forPlayer);
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
                        _buildFactionSynergyCardMarker(key) +
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
        { id: 'emblemP1', cmdKey: gameState.commanderP1 || gameState.commanderP1Secondary, camp: campFromKey('player1', gameState) },
        { id: 'emblemP2', cmdKey: gameState.commanderP2 || gameState.commanderP2Secondary, camp: campFromKey('player2', gameState) },
        { id: 'emblemP3', cmdKey: gameState.commanderP3 || gameState.commanderP3Secondary, camp: campFromKey('player3', gameState) },
    ];
    const viewingCamp = gameState.skirmishFog ? getViewingCamp() : null;

    for (const { id, cmdKey, camp } of camps) {
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
        if (textEl) textEl.textContent = hidden ? '?' : (camp?.name?.[0] || '阵');
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
                _revealTurnOrder(beginTrainingMatch);
            } else {
                _revealTurnOrder(() => {
                    startGame();
                    // 下一任务再启动 AI，确保准备遮罩已完成移除，玩家不会错过先手行动。
                    window.setTimeout(() => {
                        _triggerInitialAITurn().catch(err => console.error('initialAI error:', err));
                    }, 0);
                });
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
                if (gameState.gameMode === 'training') _revealTurnOrder(beginTrainingMatch);
                else _revealTurnOrder(startGame);
                _commanderTransitioning = false;
            }, 800);
        }
    } else if (forPlayer === 'player1') {
        setTimeout(() => { _showCommanderSelection('player2'); _commanderTransitioning = false; }, 800);
    } else {
        setTimeout(() => {
            document.getElementById('commanderOverlay').classList.remove('show');
            gameState.commanderPhase = 'done';
            _revealTurnOrder(startGame);
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
            _revealTurnOrder(startGame);
        }, 800);
    }
}

function _roleToCampInfo(role) {
    const camp = getRoleCamp(gameState, role);
    if (!camp) return { name: '未知', color: '#888888' };
    return { name: camp.name, color: camp.color };
}

let _deploymentStarted = false;
let _opponentCount = 0;

// 三人模式：显示第三席位面板（开局与重连恢复共用）
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

    // 在准备遮罩移除前同步加载棋盘，避免玩家看到空棋盘。
    loadCommanderFx(gameState).catch(err => console.warn('[commanderFx] 加载失败:', err));

    preloadPortraits();
    initMap();
    initInput();
	rebindGameEvents();
    initKeyboard();
    initSettingsPanel();
    setOnFogUpdated(updateCampEmblems);
    updateCampEmblems();
    updateChatAvailability();
    initEmblemChatClicks();
    const firstCamp = campFromKey(gameState.turnOrder?.[0], gameState) || campFromKey('player1', gameState);
    gameState.currentCamp = firstCamp;
    grantTurnStartIncome(firstCamp);
    // UI 更新后同步阵营旗帜预览
    setOnUIUpdate(() => {
        _updateCampFlagPreviews();
        _syncCampFlagVisibility();
    });
    updateUI();
    _ensureCampFlagPreviews();
    _updateCampFlagPreviews();
    _syncCampFlagVisibility();
    updateButtonColors();
    renderGame();

    startBattleBGM();
    playSound('turnEnd');

    const limitRound = gameState.isThreePlayer ? 25 : 18;
    const factionName = gameState.isThreePlayer ? '三人' : '双人';
    showInfo(`${factionName}模式：${limitRound}回合内控制比其他势力更多的城市即可获得游戏胜利`);
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
	subtitle.textContent = config.campaignTitle + (config.chapterTitle ? '  ·  ' + config.chapterTitle : '');

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
        const mapName = r.standardMapId === 'uncharted-passage' ? '无主航路' : '王冠环岛';
        const rules = [mapName, r.skirmishFog ? '遭遇战' : '标准'];
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

        onStart: (role, isThreePlayer, skirmishFog, doubleCommanderMode, matchSeed, setup = {}) => {
            if (isThreePlayer !== undefined) gameState.isThreePlayer = isThreePlayer;
            if (skirmishFog !== undefined) gameState.skirmishFog = skirmishFog;
            if (doubleCommanderMode !== undefined) gameState.doubleCommanderMode = doubleCommanderMode;
            if (setup.standardMapId) gameState.standardMapId = setup.standardMapId;
            configureSkirmishState({
                playerCount: isThreePlayer ? 3 : 2,
                colors: setup.factionColors || {},
                flagEmojis: setup.factionEmojis || {},
                controllers: { player1: 'human', player2: 'human', player3: 'human' }
            });
            if (Array.isArray(setup.turnOrder) && setup.turnOrder.length) gameState.turnOrder = [...setup.turnOrder];
            gameState.turnOrderRolls = { ...(setup.turnOrderRolls || {}) };
            gameState.roleAssignments = { ...(setup.roleAssignments || gameState.roleAssignments) };
            if (_applySavedFlagCustomizations([role])) {
                const faction = gameState.factions?.[role];
                sendMessage({ type: 'factionColor', colorId: faction?.colorId, flagEmoji: faction?.flagEmoji });
            }
            showFactionReveal(role);
        },

        onFactionColors: (colors, flagEmojis) => {
            for (const [key, colorId] of Object.entries(colors || {})) {
                if (setPlayerFactionColor(gameState, key, colorId)) gameState.factionColorSelections[key] = colorId;
            }
            for (const [key, emoji] of Object.entries(flagEmojis || {})) {
                setPlayerFactionFlagEmoji(gameState, key, emoji);
            }
            if (document.getElementById('commanderOverlay')?.classList.contains('show')) {
                const pickerOpen = document.getElementById('commanderColorPicker')?.classList.contains('open');
                _configureCommanderFactionHeader(_commanderHeaderFactionKey, { keepPickerOpen: pickerOpen });
            }
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
                document.getElementById('networkRoleText').textContent = roleToCamp(role)?.name || role;
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
    if (gameState.gameOver || campToKey(gameState.currentCamp) !== 'neutral') return;
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
            _updateCampFlagPreviews();
            updateCampEmblems();
            renderGame();
            _checkSpectatorBanner();
            rebindGameEvents();
            rebindInputEvents();
            rebindKeyboardEvents();
            initSettingsPanel();
            initEmblemChatClicks();
        } else {
            // 服务端纠偏回滚正是投降被拒的主要路径：快照落地后立即重放未收录的本地投降。
            await reconcilePendingSurrender().catch(e => console.warn('Surrender reconcile error:', e));
            syncBoardActionBar();
            updateUI();
            _updateCampFlagPreviews();
            renderGame();
            updateCampEmblems();
            _checkSpectatorBanner();
        }
        // 重连/服务端纠偏后若正值中立回合，由驱动方客户端接手推进
        _maybeResumeNeutralTurn();
        return;
    }

    // 避免广播回显在 AI 处理期间覆盖 gameState（本端 endTurn 链已在处理，回显多余）。
    // 本地投降尚未被服务端收录时（_localSurrenderPendingKey），即使本地已因投降提前进入
    // gameOver 也要继续接收快照，否则无法完成投降重放收敛。
    if (!gameState.aiActing && (!gameState.gameOver || gameState._localSurrenderPendingKey)) {
        // 飞行类攻击（鱼雷/舰载机弹流）击杀：快照落地会立即移除阵亡单位，
        // 先捕获旧实例留作残影，延迟到弹着爆炸时刻才消失（与本地端时序一致）
        if (msg.actionType === 'attack' && msg.effects?.killed && !msg.effects.isCitySiege) {
            const _ke = msg.effects;
            const _kPres = classifyAttackPresentation(_ke);
            const _kMs = _kPres === ATTACK_PRESENTATION.FIRE_AIR_STRAFE
                ? CARRIER_STRAFE_IMPACT_MS
                : _kPres === ATTACK_PRESENTATION.FIRE_TORPEDO
                    ? getTorpedoFlightMs(_ke.fromX ?? _ke.x, _ke.fromY ?? _ke.y, _ke.x, _ke.y)
                    : 0;
            const _kUnit = _kMs > 0 ? gameState.tileMap?.get(`${_ke.q},${_ke.r}`)?.unit : null;
            if (_kUnit) (gameState.unitDeathGhosts ||= []).push({ unit: _kUnit, until: performance.now() + _kMs });
        }
        // 【神谕】神罚击杀同理：残影保留到指引光束弹着时刻
        for (const pulse of (msg.actionType === 'endTurn' && msg.effects?.oraclePulses) || []) {
            if (!pulse?.smite?.killed) continue;
            const dying = gameState.tileMap?.get(`${pulse.smite.q},${pulse.smite.r}`)?.unit;
            if (dying) {
                (gameState.unitDeathGhosts ||= []).push({
                    unit: dying,
                    until: performance.now() + CELESTINE_ORACLE_PULSE_TIMING.impactMs
                });
            }
        }
        applyRemoteState(msg.state, HexTile, Unit);
        await loadCommanderFx(gameState).catch(err => console.warn('[commanderFx] 状态同步加载失败:', err));
        // 远端快照落地后核对本地投降是否已被收录，未收录则幂等重放并重新广播。
        await reconcilePendingSurrender().catch(e => console.warn('Surrender reconcile error:', e));
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
    // 浮字统一走 payload 重放：与本地同一批条目、同一节奏（delayMs 照用）
    if (e?.floatTexts) replayFloatTexts(e.floatTexts);
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
                        forceDistrictFade(cityTile, campFromKey(cc.campKey, gameState) || cityTile.camp);
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
                    // 伤害数字由 e.floatTexts 统一重放
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
            // 重放殉道者爆炸等将领产生的伤害数字 —— 已由 e.floatTexts 统一重放
            // 重放牧师圣链治疗特效
            if (e && e.healingChains) {
                for (const hc of e.healingChains) {
                    spawnHealingChain(hc.fromX, hc.fromY, hc.toX, hc.toY);
                }
            }
            // 重放雨天环境落雷（伤害已随状态快照同步，伤害数字由 e.floatTexts 重放，此处只放特效）
            if (e && e.rainLightning) {
                for (const s of (e.rainLightning.strikes || [])) {
                    spawnLightningStrike(s.x, s.y);
                }
                for (const a of (e.rainLightning.ambient || [])) spawnLightningStrike(a.x, a.y);
                if ((e.rainLightning.strikes || []).length || (e.rainLightning.ambient || []).length) playSound('lightning');
            }
            // 重放塞莱斯廷圣国【神谕】脉冲（状态已随快照同步，此处只放特效与浮字）
            if (e && e.oraclePulses) {
                for (const pulse of e.oraclePulses) {
                    // 阶段跃迁时触发 Hero（stageChanged 由 resolveOraclePulse 检测）
                    if (pulse.stageChanged) {
                        emit('fx:celestineOracle', {
                            presentationEventId: 'celestine:' + pulse.campKey + ':' + pulse.stage,
                            stage: pulse.stage,
                            campKey: pulse.campKey,
                            activeRounds: pulse.activeRounds
                        });
                    }
                    // 脉冲表现事件
                    if (pulse.smite || pulse.shield) {
                        const statueAnchor = getOracleStatueAnchor(gameState, pulse.campKey);
                        emit('fx:celestineOraclePulse', {
                            ...pulse,
                            statueX: statueAnchor?.x,
                            statueY: statueAnchor?.y
                        });
                    }
                }
            }
            // 重放诺克提斯【血月·月蚀】放血浮字（血量已随快照同步，此处只放浮字/特效）
            if (e && e.bloodMoonBleeds) {
                for (const h of e.bloodMoonBleeds) {
                    if (h.x == null) continue;
                    gameState.damageTexts.push({
                        x: h.x, y: h.y, value: h.dmg, isTrueDmg: true,
                        timeLeft: 1000, lastUpdate: performance.now()
                    });
                }
                const remoteAnchor = e.bloodMoonAnchor || gameState._bloodMoonAnchor || null;
                const remoteRising = !!e.bloodMoonRising;
                if (remoteRising && remoteAnchor) {
                    gameState._bloodMoonAnchor = remoteAnchor;
                }
                emit('fx:noctisBloodMoonBleed', {
                    presentationEventId: `bloodMoon:remote:${gameState.turnCounter}`,
                    rising: remoteRising, hits: e.bloodMoonBleeds,
                    anchor: remoteAnchor,
                    campKey: remoteAnchor?.campKey || null
                });
            }
            break;
        case 'tacticalCard':
            if (e) {
                // 烧牌动画（观战者：中央淡入+燃烧）
                spawnCardUseEffect(e.cardId, LOGICAL_W / 2, LOGICAL_H / 2, false, 0, 0, e.burnDisplayName || null);
                // 天衡【借日】：无目标即时卡，远端确定性重放（全军回满/岁耗标记；无 RNG）。
                if (e.borrowDay && e.campKey) {
                    resolveBorrowDay(gameState, e.campKey);
                    // 与本地端一致：烧牌动画结束后再播 Hero 全屏动画
                    window.setTimeout(() => {
                        emit('fx:tianhengBorrowDay', {
                            presentationEventId: `borrowDay:remote:${gameState.turnCounter}`,
                            campKey: e.campKey, affectedIds: e.affectedIds || []
                        });
                    }, 2200);
                    break;
                }
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
                                // 统一伤害入口：真实伤害绕过护盾，击杀清理由 applyDamage 处理。
                                // 伤害数字由 e.floatTexts 重放；弹着派生跳字（临终迸发/殉道等）
                                // 两端各自推导（仅显示，不进广播捕获，避免漏进下次广播变幽灵跳字）
                                setFloatTextCaptureSuppressed(true);
                                try {
                                    const dc = lt.unit.camp;
                                    const killed = lt.unit.applyDamage(e.dmg, { source: 'true' });
                                    if (killed) {
                                        const dck = campToKey(dc);
                                        gameState.killCount[dck] = (gameState.killCount[dck] || 0) + 1;
                                    }
                                } finally {
                                    setFloatTextCaptureSuppressed(false);
                                }
                            }
                            playSound('lightning');
                            spawnLightningStrike(e.x, e.y);
                            triggerScreenShake(10, 350);
                            break;
                        }
                        case 'heal': {
                            const ht = e.q != null ? gameState.tileMap.get(`${e.q},${e.r}`) : gameState.tiles.find(t => t.x === e.x && t.y === e.y);
                            if (ht && ht.unit && e.healAmt) {
                                ht.unit.hp = Math.min(ht.unit.maxHp, ht.unit.hp + e.healAmt);
                                // 治疗数字由 e.floatTexts 统一重放
                                spawnHealParticles(e.x, e.y);
                                triggerHealFlash(e.x, e.y);
                            }
                            if (e.purifiedPoison) spawnCommanderSkillEffect(e.x, e.y, '✨', '净化中毒');
                            break;
                        }
                        case 'poison':
                            spawnCommanderSkillEffect(e.x, e.y, '☣️', '中毒');
                            spawnExplosionParticles(e.x, e.y, '#6ea52c', 14);
                            break;
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
                                // 伤害数字由 e.floatTexts 重放；弹着派生跳字（护盾吸收/灵光/临终迸发）
                                // 两端各自推导（仅显示，不进广播捕获，避免漏进下次广播变幽灵跳字）
                                setFloatTextCaptureSuppressed(true);
                                try {
                                    for (const r of airstrikeResults) {
                                        const tile = gameState.tileMap.get(`${r.q},${r.r}`);
                                        if (!tile) continue;
                                        if (tile.unit) {
                                            // 统一伤害入口：空袭为远程攻击
                                            const dc = tile.unit.camp;
                                            const killed = tile.unit.applyDamage(r.dmg, { source: 'ranged' });
                                            if (killed) {
                                                const dck = campToKey(dc);
                                                gameState.killCount[dck] = (gameState.killCount[dck] || 0) + 1;
                                            }
                                        }
                                        spawnExplosionParticles(tile.x, tile.y, '#ff8800', 10);
                                    }
                                } finally {
                                    setFloatTextCaptureSuppressed(false);
                                }
                                triggerScreenShake(6, 300);
                            }, 1200);
                            break;
                        }
                        case 'orbitalStrike': {
                            const oResults = e.orbitalStrikeResults || [];
                            // 与本地同一节拍：光束压制三段小额 + 光环落地引爆主伤害
                            spawnOrbitalBeam(e.x, e.y);
                            playSound('lightning');
                            const applyRemoteOrbitalTick = (tickIndex, isFinal) => {
                                // 分段伤害数字由 e.floatTexts 重放；弹着派生跳字两端各自推导（仅显示，不进广播捕获）
                                setFloatTextCaptureSuppressed(true);
                                try {
                                    for (const r of oResults) {
                                        const tile = gameState.tileMap.get(`${r.q},${r.r}`);
                                        if (!tile) continue;
                                        const tickDmg = r.ticks?.[tickIndex] || 0;
                                        if (tickDmg <= 0) continue;
                                        if (tile.unit) {
                                            const dc = tile.unit.camp;
                                            const killed = tile.unit.applyDamage(tickDmg, { source: 'ranged' });
                                            if (killed) {
                                                const dck = campToKey(dc);
                                                gameState.killCount[dck] = (gameState.killCount[dck] || 0) + 1;
                                            }
                                        }
                                        spawnExplosionParticles(tile.x, tile.y, isFinal ? '#7fd0ff' : '#9fe0ff', isFinal ? 18 : 5);
                                        if (isFinal) {
                                            spawnExplosionParticles(tile.x, tile.y, '#eaf7ff', 12);
                                            triggerAttackFlash(tile.x, tile.y, true);
                                        }
                                    }
                                } finally {
                                    setFloatTextCaptureSuppressed(false);
                                }
                                triggerScreenShake(isFinal ? 14 : 3, isFinal ? 500 : 180);
                            };
                            ORBITAL_STRIKE_TICK_DELAYS_MS.forEach((tickAt, tickIndex) => {
                                const isFinal = tickIndex === ORBITAL_STRIKE_TICK_DELAYS_MS.length - 1;
                                setTimeout(() => {
                                    if (isFinal) playSound('explosion');
                                    applyRemoteOrbitalTick(tickIndex, isFinal);
                                }, tickAt);
                            });
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
                                        const muzzle = getDiveStrafeMuzzlePosition(tx, ty, 600 + i * 20);
                                        spawnStrafeTracer(muzzle.x, muzzle.y, tx, ty);
                                    }, i * 20);
                                }
                            }, 600);
                            setTimeout(() => {
                                const dt = e.q != null ? gameState.tileMap.get(`${e.q},${e.r}`) : null;
                                // 伤害数字由 e.floatTexts 重放；弹着派生跳字两端各自推导（仅显示，不进广播捕获）
                                setFloatTextCaptureSuppressed(true);
                                try {
                                    if (dt && dt.unit && e.dmg) {
                                        const dc = dt.unit.camp;
                                        const _isCmdR = !!dt.unit.commander;
                                        // 鹰链：上校空军卡为延迟结算路径，出卡方即当前回合阵营
                                        const killed = dt.unit.applyDamage(e.dmg, { source: 'ranged', eagleAirForceCampKey: campToKey(gameState.currentCamp) });
                                        if (killed) {
                                            const dck = campToKey(dc);
                                            gameState.killCount[dck] = (gameState.killCount[dck] || 0) + 1;
                                            const _colR = gameState.tiles.reduce((f, t) => f || (t.unit && t.unit.commander === 'colonel' && t.unit.camp !== dc && campToKey(t.unit.camp) !== 'neutral' && t.unit.hp > 0 ? t.unit : null), null);
                                            if (_colR) reapColonelKill(_colR, _isCmdR);
                                        }
                                    }
                                } finally {
                                    setFloatTextCaptureSuppressed(false);
                                }
                                spawnExplosionParticles(e.x, e.y, '#ff8800', 15);
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
                                // 伤害数字由 e.floatTexts 重放；弹着派生跳字两端各自推导（仅显示，不进广播捕获）
                                setFloatTextCaptureSuppressed(true);
                                try {
                                    for (const r of cResults) {
                                        const tile = gameState.tileMap.get(`${r.q},${r.r}`);
                                        if (!tile) continue;
                                        spawnExplosionParticles(tile.x, tile.y, '#ff8800', 10);
                                        // 仅对有单位的地块结算伤害（空地不显示伤害数字）
                                        if (tile.unit && r.dmg) {
                                            const dc = tile.unit.camp;
                                            const _isCmdR = !!tile.unit.commander;
                                            // 鹰链：上校空军卡为延迟结算路径，出卡方即当前回合阵营
                                            const killed = tile.unit.applyDamage(r.dmg, { source: 'ranged', eagleAirForceCampKey: campToKey(gameState.currentCamp) });
                                            if (killed) {
                                                const dck = campToKey(dc);
                                                gameState.killCount[dck] = (gameState.killCount[dck] || 0) + 1;
                                                const _colR = gameState.tiles.reduce((f, t) => f || (t.unit && t.unit.commander === 'colonel' && t.unit.camp !== dc && campToKey(t.unit.camp) !== 'neutral' && t.unit.hp > 0 ? t.unit : null), null);
                                                if (_colR) reapColonelKill(_colR, _isCmdR);
                                            }
                                        }
                                    }
                                } finally {
                                    setFloatTextCaptureSuppressed(false);
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
            // 天鹰【鹰链红利】：同步结算路径的事件随广播 relay（含攻城分支）；
            // 金币已随快照同步，这里只负责表现层，presentationEventId 去重防双播。
            for (const eagleEvent of e?.eagleSynergyEvents || []) {
                emit('fx:eagleSynergy', eagleEvent);
            }
            // 地面/海军攻城：状态已随快照同步，这里只重放轻量的爆炸/伤害数字，不进普通单位对战的整套重放逻辑。
            if (e?.isCitySiege) {
                // 攻城开火动画需与攻击方本地表现一致（鱼雷/炮击/扫射/近战），此前只弹一个通用爆炸，
                // 导致观战端看到城市掉血却看不到对应的开火表现。伤害数字与城市HP由快照权威给出。
                const _sPres = classifyAttackPresentation(e);
                const _sCrit = !!e.isCrit;
                const _sFromX = e.fromX ?? e.x, _sFromY = e.fromY ?? e.y;
                if (_sPres === ATTACK_PRESENTATION.FIRE_AIR_STRAFE) {
                    // 航母扫射空城：与主机端一致的俯冲扫射表现，伤害数字延迟到子弹流抵达
                    playSound('airstrike');
                    spawnAirstrikeEffect(e.x, e.y, [{ q: e.q, r: e.r, dmg: e.damage }], 'diveStrafe', e.q, e.r);
                    setTimeout(() => {
                        playSound('machinegun');
                        for (let i = 0; i < 12; i++) {
                            setTimeout(() => {
                                const muzzle = getDiveStrafeMuzzlePosition(e.x, e.y, 500 + i * 24);
                                spawnStrafeTracer(muzzle.x, muzzle.y, e.x, e.y);
                            }, i * 24);
                        }
                    }, 500);
                    setTimeout(() => triggerScreenShake(_sCrit ? 6 : 3, _sCrit ? 200 : 120), CARRIER_STRAFE_IMPACT_MS);
                    // 伤害数字由 e.floatTexts 统一重放（含子弹流抵达延迟）
                    break;
                }
                if (_sPres !== ATTACK_PRESENTATION.FIRE_TORPEDO) {
                    playSound(_sPres === ATTACK_PRESENTATION.FIRE_TRACER ? 'machinegun'
                        : _sPres === ATTACK_PRESENTATION.FIRE_CANNON ? 'cannon'
                        : (_sCrit ? 'crit' : 'attack'));
                }
                if (_sPres === ATTACK_PRESENTATION.FIRE_TORPEDO) {
                    spawnTorpedo(_sFromX, _sFromY, e.x, e.y, _sCrit);
                } else if (_sPres === ATTACK_PRESENTATION.FIRE_CANNON) {
                    spawnProjectile(_sFromX, _sFromY, e.x, e.y, _sCrit, () => {
                        triggerAttackFlash(e.x, e.y, _sCrit);
                        triggerRecoil(_sFromX, _sFromY, e.x, e.y);
                        spawnDirectionalParticles(_sFromX, _sFromY, e.x, e.y, '#ff8844', _sCrit ? 8 : 4);
                        triggerScreenShake(_sCrit ? 6 : 3, _sCrit ? 200 : 120);
                    });
                } else if (_sPres === ATTACK_PRESENTATION.FIRE_TRACER) {
                    spawnDroneProjectile(_sFromX, _sFromY, e.x, e.y, _sCrit, () => {
                        triggerAttackFlash(e.x, e.y, _sCrit);
                        spawnDirectionalParticles(_sFromX, _sFromY, e.x, e.y, '#ff8844', _sCrit ? 4 : 2);
                    });
                } else {
                    triggerAttackFlash(e.x, e.y, _sCrit);
                    spawnSlashMarks(e.x, e.y, _sFromX, _sFromY, _sCrit);
                    triggerScreenShake(_sCrit ? 6 : 3, _sCrit ? 200 : 120);
                    if ((e.cityHpAfter ?? 1) > 0) triggerCharge(e.attackerUnitId ?? 0, _sFromX, _sFromY, e.x, e.y);
                }
                // 伤害数字由 e.floatTexts 统一重放
                break;
            }
            try {
                for (const oathEvent of e?.aureliaOathEvents || []) {
                    emit('fx:aureliaOath', oathEvent);
                }
                const _rmSmite = e?.smiteDmg > 0;
                const _rmSmiteLabel = e?.smiteLabel || '至圣斩';
                const _rmFromX = e?.fromX ?? e?.x;
                const _rmFromY = e?.fromY ?? e?.y;
                const _rmPresentation = classifyAttackPresentation(e);

                // 飞行类攻击（鱼雷/舰载机弹流）：伤害数字/击杀爆炸/士气特效延迟到弹体抵达
                const _rmTorpedoMs = _rmPresentation === ATTACK_PRESENTATION.FIRE_TORPEDO
                    ? getTorpedoFlightMs(e?.fromX ?? e?.x ?? 0, e?.fromY ?? e?.y ?? 0, e?.x ?? 0, e?.y ?? 0) : 0;
                const _rmImpactMs = _rmPresentation === ATTACK_PRESENTATION.FIRE_AIR_STRAFE
                    ? CARRIER_STRAFE_IMPACT_MS : _rmTorpedoMs;
                const _rmDeferImpact = (fn) => _rmImpactMs > 0 ? setTimeout(fn, _rmImpactMs) : fn();

                const _execAttackFx = () => {
                if (_rmSmite) {
                    setTimeout(() => playSound('lightning'), 500);
                } else if (_rmPresentation !== ATTACK_PRESENTATION.FIRE_TORPEDO) {
                    playSound(_rmPresentation === ATTACK_PRESENTATION.FIRE_AIR_STRAFE
                        ? 'airstrike'
                        : _rmPresentation === ATTACK_PRESENTATION.FIRE_TRACER
                        ? 'machinegun'
                        : _rmPresentation === ATTACK_PRESENTATION.FIRE_CANNON
                            ? 'cannon'
                            : (e?.isCrit ? 'crit' : 'attack'));
                }
                if (e) {
                    if (_rmPresentation === ATTACK_PRESENTATION.FIRE_TORPEDO) {
                        spawnTorpedo(e.fromX ?? e.x, e.fromY ?? e.y, e.x, e.y, e.isCrit);
                    } else if (_rmPresentation === ATTACK_PRESENTATION.FIRE_AIR_STRAFE) {
                        spawnAirstrikeEffect(e.x, e.y, [{ q: e.q, r: e.r, dmg: e.attackDmg }], 'diveStrafe', e.q, e.r);
                        setTimeout(() => {
                            playSound('machinegun');
                            for (let i = 0; i < 12; i++) {
                                setTimeout(() => {
                                    const muzzle = getDiveStrafeMuzzlePosition(e.x, e.y, 500 + i * 24);
                                    spawnStrafeTracer(muzzle.x, muzzle.y, e.x, e.y);
                                }, i * 24);
                            }
                        }, 500);
                        setTimeout(() => {
                            triggerScreenShake(e.isCrit ? 6 : 3, e.isCrit ? 200 : 120);
                        }, 780);
                    } else if (_rmPresentation === ATTACK_PRESENTATION.FIRE_TRACER) {
                        triggerAttackFlash(e.x, e.y, e.isCrit);
                        spawnDroneProjectile(e.fromX ?? e.x, e.fromY ?? e.y, e.x, e.y, e.isCrit);
                        spawnDirectionalParticles(e.fromX ?? e.x, e.fromY ?? e.y, e.x, e.y, '#ff8844', e.isCrit ? 8 : 4);
                    } else if (_rmPresentation === ATTACK_PRESENTATION.FIRE_CANNON) {
                        triggerAttackFlash(e.x, e.y, e.isCrit);
                        spawnProjectile(e.fromX ?? e.x, e.fromY ?? e.y, e.x, e.y, e.isCrit);
                        triggerRecoil(e.fromX ?? e.x, e.fromY ?? e.y, e.x, e.y);
                        spawnDirectionalParticles(e.fromX ?? e.x, e.fromY ?? e.y, e.x, e.y, '#ff8844', e.isCrit ? 8 : 4);
                    } else {
                        triggerAttackFlash(e.x, e.y, e.isCrit);
                        spawnDirectionalParticles(e.fromX ?? e.x, e.fromY ?? e.y, e.x, e.y, '#ff8844', e.isCrit ? 22 : 10);
                        spawnSlashMarks(e.x, e.y, e.fromX ?? e.x, e.fromY ?? e.y, e.isCrit);
                        if (!e.killed && e.attackerType !== 'mgNest') triggerCharge(e.attackerUnitId ?? 0, e.fromX ?? e.x, e.fromY ?? e.y, e.x, e.y);
                    }
                    if (_rmPresentation !== ATTACK_PRESENTATION.FIRE_TORPEDO
                        && _rmPresentation !== ATTACK_PRESENTATION.FIRE_AIR_STRAFE) {
                        triggerScreenShake(e.isCrit ? 6 : 3, e.isCrit ? 200 : 120);
                    }
                    if (e.extraSalvoResult) {
                        setTimeout(() => {
                            playSound('cannon');
                            spawnProjectile(_rmFromX, _rmFromY, e.x, e.y, false);
                        }, 140);
                    }
                    // 支援型巡洋舰溅射触发 → 第二发炮弹 + 第二声开炮（火箭炮溅射不补）
                    if (e.attackerType === 'warship' && e.specializationSplashResults?.length) {
                        setTimeout(() => {
                            playSound('cannon');
                            spawnProjectile(_rmFromX, _rmFromY, e.x, e.y, false);
                        }, 140);
                    }
                    for (const splash of e.specializationSplashResults || []) {
                        spawnDirectionalParticles(e.x, e.y, splash.x, splash.y, '#ffb35c', 8);
                        spawnExplosionParticles(splash.x, splash.y, '#ff8a3d', 8);
                    }
                    if (e.killed) {
                        _rmDeferImpact(() => {
                            spawnExplosionParticles(e.x, e.y, '#ff2200', 30);
                            spawnExplosionParticles(e.x, e.y, '#ffaa00', 15);
                            triggerScreenShake(4, 150);
                        });
                    }
                    if (e.berserkerQixue) {
                        spawnCommanderSkillEffect(e.fromX ?? e.x, e.fromY ?? e.y, '🩸', '泣血');
                        spawnExplosionParticles(e.x, e.y, '#b71c1c', 24);
                        spawnExplosionParticles(e.x, e.y, '#ff6b4a', 14);
                        for (const splash of e.berserkerSplash || []) {
                            spawnDirectionalParticles(e.x, e.y, splash.x, splash.y, '#d63c3c', splash.isCrit ? 12 : 8);
                            spawnExplosionParticles(splash.x, splash.y, '#b71c1c', splash.isCrit ? 16 : 10);
                            spawnExplosionParticles(splash.x, splash.y, '#ff8a65', splash.isCrit ? 8 : 5);
                            // 溅射伤害数字由 e.floatTexts 统一重放
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
                        // 击杀方士气上升特效与弹着爆炸同刻（查找也延迟，快照重建后按新实例定位）
                        _rmDeferImpact(() => {
                            const moraleUnit = gameState.tiles.reduce((f, t) => f || (t.unit?.id === e.moraleFxUnitId ? t.unit : null), null);
                            if (moraleUnit) spawnMoraleEffect(moraleUnit);
                        });
                    }
                    if (e.ctrMoraleFxUnitId) {
                        const ctrMoraleUnit = gameState.tiles.reduce((f, t) => f || (t.unit?.id === e.ctrMoraleFxUnitId ? t.unit : null), null);
                        if (ctrMoraleUnit) spawnMoraleEffect(ctrMoraleUnit);
                    }
                    // 伤害数字（攻击/攻城连带/反击/至圣斩/治疗）统一由 e.floatTexts 重放，
                    // 时序与本地一致（飞行类攻击的条目自带弹着延迟）
                    if (e.counterDmg > 0) {
                        if (e.counterIsRanged) {
                            const counterPresentation = classifyAttackPresentation({
                                attackerType: e.counterType,
                                attackerIsDrone: e.counterIsDrone
                            });
                            if (counterPresentation === ATTACK_PRESENTATION.FIRE_TORPEDO) {
                                spawnTorpedo(e.x, e.y, e.counterX, e.counterY, e.counterIsCrit);
                            } else if (e.counterUsesDroneProjectile || e.counterIsDrone) {
                                playSound('machinegun');
                                triggerAttackFlash(e.counterX, e.counterY, e.counterIsCrit);
                                spawnDroneProjectile(e.x, e.y, e.counterX, e.counterY, e.counterIsCrit);
                            } else {
                                playSound('cannon');
                                triggerAttackFlash(e.counterX, e.counterY, e.counterIsCrit);
                                spawnProjectile(e.x, e.y, e.counterX, e.counterY, e.counterIsCrit);
                                triggerRecoil(e.x, e.y, e.counterX, e.counterY);
                            }
                            if (counterPresentation !== ATTACK_PRESENTATION.FIRE_TORPEDO) {
                                spawnDirectionalParticles(e.x, e.y, e.counterX, e.counterY, '#ff8844', e.counterIsCrit ? 8 : 4);
                                triggerScreenShake(e.counterIsCrit ? 6 : 3, e.counterIsCrit ? 200 : 120);
                            }
                        }
                    }
                    // 至圣斩真伤数字由 e.floatTexts 重放；此处只放光束/特效/震屏
                    if (e.smiteDmg > 0) {
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
        case 'airCommand': {
            if (!e) break;
            const target = gameState.tileMap.get(`${e.targetQ},${e.targetR}`);
            if (!target) break;
            if (e.kind === 'strafe') {
                // 复用上校扫射动画：战机俯冲 + 机炮扫射曳光弹（除烧牌部分外）
                spawnAirstrikeEffect(target.x, target.y, e.results || [], 'diveStrafe', target.q, target.r);
                playSound('airstrike');
                setTimeout(() => {
                    playSound('machinegun');
                    const tx = target.x, ty = target.y;
                    for (let i = 0; i < 20; i++) {
                        setTimeout(() => {
                            const muzzle = getDiveStrafeMuzzlePosition(tx, ty, 600 + i * 20);
                            spawnStrafeTracer(muzzle.x, muzzle.y, tx, ty);
                        }, i * 20);
                    }
                }, 600);
            } else if (e.kind === 'bombing') {
                spawnAirstrikeEffect(target.x, target.y, e.results || [], 'carpetBomb', target.q, target.r);
                playSound('airstrike');
            } else if (e.kind === 'airdrop') {
                spawnAirstrikeEffect(target.x, target.y, [], 'airdrop', target.q, target.r);
                playSound('airstrike');
            } else if (e.kind === 'recon') {
                spawnCommanderSkillEffect(target.x, target.y, '🔭', '侦察机');
            }
            const impactDelay = AIR_COMMAND_IMPACT_DELAY_MS[e.kind];
            // 天鹰【鹰链红利】：空军指令为延迟结算路径，远端与主机端各自确定性重算；
            // 记账阵营取机场地块（快照已落地，即发起方阵营）。
            const airLauncherTile = gameState.tileMap.get(`${e.launcherQ},${e.launcherR}`);
            const airCampKey = airLauncherTile?.camp ? campToKey(airLauncherTile.camp) : null;
            if (Number.isFinite(impactDelay)) {
                setTimeout(() => {
                    // 伤害数字由 e.floatTexts 重放；落弹派生跳字（护盾吸收/灵光/临终迸发）
                    // 两端各自推导（仅显示，不进广播捕获，避免漏进下次广播变幽灵跳字）
                    setFloatTextCaptureSuppressed(true);
                    try {
                    if (e.kind === 'strafe') {
                        // 延迟扣血：爆炸时刻才结算伤害
                        for (const r of (e.results || [])) {
                            const tile = gameState.tileMap.get(`${r.q},${r.r}`);
                            if (tile && r.isCitySiege) {
                                // 共享血池：与主机端一致走 damageCityPool（镜像同步到全城）
                                const poolHpBefore = Math.max(0, (getCityPoolTile(tile, gameState.tileMap) || tile).hp || 0);
                                damageCityPool(tile, r.damage, gameState.tileMap);
                                creditEagleSynergyDamage(airCampKey, Math.min(r.damage, poolHpBefore), { deferred: true });
                            } else if (tile && tile.unit) {
                                tile.unit.applyDamage(r.damage, { source: 'ranged', attacker: null, eagleAirForceCampKey: airCampKey });
                            }
                        }
                        // 扫射只有空袭+机枪音效，命中仅保留视觉反馈；explosion 专属轰炸
                        for (const r of (e.results || [])) {
                            const tile = gameState.tileMap.get(`${r.q},${r.r}`);
                            if (tile) spawnExplosionParticles(tile.x, tile.y, '#ff8800', 15);
                        }
                        triggerScreenShake(6, 300);
                    } else if (e.kind === 'bombing') {
                        // 延迟扣血：爆炸时刻才结算伤害
                        for (const r of (e.results || [])) {
                            const tile = gameState.tileMap.get(`${r.q},${r.r}`);
                            if (tile && r.isCitySiege) {
                                // 共享血池：与主机端一致走 damageCityPool（镜像同步到全城）
                                const poolHpBefore = Math.max(0, (getCityPoolTile(tile, gameState.tileMap) || tile).hp || 0);
                                damageCityPool(tile, r.damage, gameState.tileMap);
                                creditEagleSynergyDamage(airCampKey, Math.min(r.damage, poolHpBefore), { deferred: true });
                            } else if (tile && tile.unit) {
                                tile.unit.applyDamage(r.damage, { source: 'ranged', attacker: null, eagleAirForceCampKey: airCampKey });
                            }
                        }
                        playSound('explosion');
                        for (const r of (e.results || [])) {
                            const tile = gameState.tileMap.get(`${r.q},${r.r}`);
                            if (tile) spawnExplosionParticles(tile.x, tile.y, '#ff8800', 10);
                        }
                        triggerScreenShake(8, 400);
                    }
                    } finally {
                        setFloatTextCaptureSuppressed(false);
                    }
                }, impactDelay);
            }
            break;
        }
        case 'buildFortification':
        case 'buildBunker':
        case 'buildAirfield':
        case 'fieldRepair': {
            if (!e) break;
            const target = e.targetId
                ? gameState.tiles.find(tile => tile.unit?.id === e.targetId)
                : gameState.tileMap.get(`${e.q},${e.r}`);
            if (target) spawnCommanderSkillEffect(target.x, target.y, msg.actionType === 'fieldRepair' ? '🛠️' : '🏗️', msg.actionType === 'fieldRepair' ? '战地抢修' : '建设');
            break;
        }
        case 'chooseSpecialization': {
            const unit = e?.unitId ? gameState.tiles.find(tile => tile.unit?.id === e.unitId)?.unit : null;
            if (unit?.tile) spawnCommanderSkillEffect(unit.tile.x, unit.tile.y, '✦', '专精');
            break;
        }
        case 'droneDeploy':
            if (e) {
                emit('tianyan:droneDeploy', e);
            }
            break;
        case 'droneSuicide':
            if (e) {
                spawnDroneDive(e.fromX, e.fromY, e.x, e.y, e.campKey || 'p1');
                // 自爆伤害数字由 e.floatTexts 统一重放
                // 天鹰【鹰链红利】：自爆为同步结算路径，事件随广播 relay
                for (const eagleEvent of e.eagleSynergyEvents || []) {
                    emit('fx:eagleSynergy', eagleEvent);
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
                    // 治疗浮字已由 e.floatTexts 重放；heal 仅用于触发治疗特效/事件，抑制浮字产出
                    setFloatTextsSuppressed(true);
                    try {
                        rUnit.heal(e.healAmt);
                    } finally {
                        setFloatTextsSuppressed(false);
                    }
                    rUnit.tile._reinforcedThisTurn = true;
                    spawnReinforceEffect(e.x, e.y, e.healAmt);
                }
            }
            break;
        case 'repairShip':
            // 权威血量/金币已随快照落地，这里只补视觉（与 move/attack 等一致，不二次治疗）。
            if (e && e.x != null) spawnReinforceEffect(e.x, e.y, e.healAmt);
            break;
        case 'activateSkill': {
            if (e && e.unitId) {
                const skillUnit = gameState.tiles.reduce((f, t) => f || (t.unit?.id === e.unitId ? t.unit : null), null);
                if (skillUnit && skillUnit.commander) {
                    const cmdCfg = getCommander(skillUnit.commander);
                    if (cmdCfg && cmdCfg.activeSkill) {
                        // 技能结算可能产生治疗/护盾浮字：已由 e.floatTexts 重放，抑制本地产出
                        setFloatTextsSuppressed(true);
                        try {
                            cmdCfg.activeSkill.onActivate(skillUnit, {
                                gameState, logMessage,
                                spawnFx: spawnCommanderSkillEffect,
                                spawnOrbitBeams: spawnPaladinOrbitBeams,
                                isReplay: true
                            });
                        } finally {
                            setFloatTextsSuppressed(false);
                        }
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
