// 通用战役控制器（内容无关引擎）。
// 具体关卡的剧本、目标、流程、结算文案全部来自 scenario 模块（见 campaign/content/**）。
// 本文件只负责：渲染步骤对白、目标 HUD、目标环/提示、结算面板、事件订阅与输入校验的分发。
import { canvas, LOGICAL_W, LOGICAL_H, CAMP, invalidateBoard } from './config.js';
import { gameState, logMessage, updateUI } from './state.js';
import { emit, on } from './eventBus.js';
import { saveVictory } from '../campaign/progress.js';
import { campFromKey, getFaction } from '../rules/diplomacy.js';

let sharedController = null;

export function createCampaignController({ onRetry, onReturn }) {
    const overlay = document.getElementById('tutorialOverlay');
    const coach = document.getElementById('tutorialCoach');
    const title = document.getElementById('tutorialTitle');
    const text = document.getElementById('tutorialText');
    const button = document.getElementById('tutorialNextBtn');
    const progress = document.getElementById('tutorialProgress');
    const ring = document.getElementById('tutorialTargetRing');
    const hint = document.getElementById('tutorialHint');
    const panes = ['tutorialPaneTop', 'tutorialPaneBottom', 'tutorialPaneLeft', 'tutorialPaneRight']
        .map(id => document.getElementById(id));
    const holeBorder = document.getElementById('tutorialHoleBorder');
    const objectiveHud = document.getElementById('campaignObjectiveHud');
    const objectiveTitle = document.getElementById('campaignObjectiveTitle');
    const objectiveDetail = document.getElementById('campaignObjectiveDetail');
    const optionalList = document.getElementById('campaignOptionalObjectives');
    const objPopup = document.getElementById('objectivePopupOverlay');
    const objPopupBody = document.getElementById('objectivePopupBody');
    const objToast = document.getElementById('objectiveToast');
    const objToastBody = document.getElementById('objectiveToastBody');
    const resultOverlay = document.getElementById('campaignResultOverlay');
    const speakerCard = document.getElementById('campaignSpeakerCard');
    const speakerPortrait = document.getElementById('campaignSpeakerPortrait');
    const speakerName = document.getElementById('campaignSpeakerName');

    let active = false;
    let stepId = '';
    let activeObjectiveId = '';
    let resultShown = false;
    let transitionToken = 0;
    let transitionTimer = null;
    let transitionCleanupTimer = null;

    let activeScenario = null;
    let activeFlow = null;

    function tileForTarget(target) {
        return activeScenario?.tileForTarget?.(target) || null;
    }

    function findUnit(id) {
        return gameState.tiles.find(tile => tile.unit?.id === id)?.unit || null;
    }

    function setModalBlock(_blocked) {
        // 战役对白不使用全屏遮层：棋盘演出与 HUD 始终保持原亮度。
        // 前半段误操作仍由 InputPolicy（tutorialMode）拦截，对话框自身保留点击能力。
        for (const pane of panes) {
            if (!pane) continue;
            pane.style.display = 'none';
            pane.style.background = '';
            pane.style.backdropFilter = '';
            pane.style.webkitBackdropFilter = '';
        }
        holeBorder?.classList.remove('visible');
    }

    function syncRing() {
        const step = activeScenario?.steps?.[stepId];
        const tile = step ? tileForTarget(step.target) : null;
        if (!active || !tile || step?.phase === 'dialog' || step?.phase === 'card' || step?.phase === 'action') {
            ring?.classList.remove('visible');
            return;
        }
        const rect = canvas.getBoundingClientRect();
        const scaleX = rect.width / LOGICAL_W;
        const scaleY = rect.height / LOGICAL_H;
        const size = Math.max(56, Math.min(rect.width, rect.height) * 0.09);
        ring.style.width = `${size}px`;
        ring.style.height = `${size}px`;
        ring.style.left = `${rect.left + tile.x * scaleX - size / 2}px`;
        ring.style.top = `${rect.top + tile.y * scaleY - size / 2}px`;
        ring.classList.add('visible');
    }

    function showHint(message) {
        if (!hint) return;
        hint.textContent = message;
        hint.classList.add('visible');
        clearTimeout(hint._campaignTimer);
        hint._campaignTimer = setTimeout(() => hint.classList.remove('visible'), 1700);
    }

    function updateObjectives(key) {
        const objective = activeScenario?.objectives?.[key];
        if (!objectiveHud || !objective) return;
        activeObjectiveId = key;
        objectiveTitle.textContent = objective.title;
        objectiveDetail.textContent = objective.detail;
        // 显示当前目标之外的其他目标（含支线）
        const allObj = activeScenario?.objectives || {};
        const statuses = gameState.objectiveStates || {};
        optionalList.innerHTML = Object.keys(allObj).filter(id => id !== key && (statuses[id] || 'hidden') !== 'hidden').map(id => {
            const o = allObj[id];
            return `<span data-objective="${id}">${o.main ? '★' : '◇'} ${o.title || o.detail || id}</span>`;
        }).join('');
        optionalList.querySelectorAll('[data-objective]').forEach(item => {
            const status = statuses[item.dataset.objective] || 'active';
            const icon = status === 'completed' ? '✓' : status === 'failed' ? '✕' : '○';
            item.classList.toggle('complete', status === 'completed');
            item.classList.toggle('failed', status === 'failed');
            item.textContent = `${icon} ${item.textContent.replace(/^[^\s]+\s*/, '')}`;
        });
        objectiveHud.classList.add('show');
    }

    function setObjectiveStatus(id, status) {
        if (!id) return;
        const previous = gameState.objectiveStates?.[id] || 'hidden';
        if (!gameState.objectiveStates) gameState.objectiveStates = {};
        gameState.objectiveStates[id] = status;
        const allObj = activeScenario?.objectives || {};
        if (status === 'active') {
            updateObjectives(id);
        } else if (activeObjectiveId === id) {
            const nextActive = Object.keys(allObj).find(key => gameState.objectiveStates[key] === 'active') || '';
            if (nextActive) updateObjectives(nextActive);
            else objectiveHud?.classList.remove('show');
        } else if (activeObjectiveId) {
            updateObjectives(activeObjectiveId);
        }
        const el = optionalList?.querySelector(`[data-objective="${CSS.escape(id)}"]`);
        if (el) {
            el.classList.toggle('complete', status === 'completed');
            el.textContent = `${status === 'completed' ? '✓' : status === 'failed' ? '✕' : '◇'} ${el.textContent.replace(/^[◇✓✕]\s*/, '')}`;
        }
        // 弹出任务通知卡片
        if (status === 'completed' || status === 'failed') {
            const obj = allObj[id];
            const label = obj?.title || obj?.detail || id;
            const icon = status === 'completed' ? '✓' : '✗';
            const prefix = obj?.main ? '★' : '◇';
            window._showObjectiveToast?.(`<div class="objective-toast-item">${prefix} ${label} — ${status === 'completed' ? '已完成' : '已失败'}</div>`);
        }
        emit('campaign:objectiveChanged', { objectiveId: id, previous, status });
    }

    function renderStep(step) {
        title.textContent = '';
        progress.textContent = '';
        text.textContent = step.text;
        const hasSpeaker = step.mode === 'character' && step.speaker;
        speakerCard.classList.toggle('show', !!hasSpeaker);
        speakerCard.setAttribute('aria-hidden', hasSpeaker ? 'false' : 'true');
        coach.classList.toggle('has-speaker', !!hasSpeaker);
        if (hasSpeaker) {
            speakerPortrait.src = `img/commander/${step.speaker.portrait}.webp`;
            speakerPortrait.alt = `${step.speaker.name}立绘`;
            speakerName.textContent = step.speaker.name;
            coach.setAttribute('aria-label', `${step.speaker.name}对话`);
        } else {
            speakerPortrait.removeAttribute('src');
            speakerPortrait.alt = '';
            speakerName.textContent = '';
            coach.setAttribute('aria-label', '剧情旁白');
        }
        button.hidden = !step.button;
        button.disabled = false;
        button.textContent = step.button || '';
        button.dataset.campaignNext = step.next || '';
        coach.dataset.campaign = activeScenario?.id || '';
        coach.dataset.campaignPhase = step.phase;
        setModalBlock(step.phase === 'dialog');
        overlay.classList.add('show');
        coach.classList.remove('campaign-dialog-out');
        coach.classList.add('campaign-dialog-in');
        clearTimeout(transitionCleanupTimer);
        transitionCleanupTimer = setTimeout(() => coach.classList.remove('campaign-dialog-in'), 420);
        requestAnimationFrame(syncRing);
    }

    function showStep(nextId, { immediate = false } = {}) {
        const step = activeScenario?.steps?.[nextId];
        if (!active || !step) return;
        stepId = nextId;
        // 步骤名 → 规则层名（默认同名；个别步骤用 ruleStep 声明规则别名，如 approach→move）。
        gameState.tutorialStep = step.ruleStep ?? nextId;
        gameState.campaignPhase = nextId;
        const token = ++transitionToken;
        clearTimeout(transitionTimer);
        button.disabled = true;
        if (immediate || !overlay.classList.contains('show')) {
            renderStep(step);
            return;
        }
        coach.classList.remove('campaign-dialog-in');
        coach.classList.add('campaign-dialog-out');
        transitionTimer = setTimeout(() => {
            if (!active || token !== transitionToken) return;
            renderStep(step);
        }, 190);
    }

    function hideGuidance() {
        transitionToken++;
        clearTimeout(transitionTimer);
        clearTimeout(transitionCleanupTimer);
        coach.classList.remove('campaign-dialog-in', 'campaign-dialog-out');
        setModalBlock(false);
        overlay.classList.remove('show');
        ring?.classList.remove('visible');
        hint?.classList.remove('visible');
    }

    function showResult(victory, reason = '') {
        if (resultShown) return;
        resultShown = true;
        gameState.gameOver = true;
        gameState.tutorialMode = false;
        hideGuidance();
        objectiveHud?.classList.remove('show');
        const res = activeScenario.calculateResult(victory, api);
        // 编辑器测试（storageKey 为空）不写通关进度。
        if (victory && activeScenario.storageKey) saveVictory(activeScenario.storageKey, activeScenario.id, res.stars, {
            variables: res.variables,
            completedOptionalObjectives: res.completedOptionalObjectives
        });
        const playerCamp = gameState.localPlayerCampKey || 'player1';
        const playerFaction = getFaction(gameState, playerCamp);
        const playerColor = playerFaction?.color || '#e05050';
        document.getElementById('campaignResultKicker').textContent = victory ? '任务完成' : '任务失败';
        document.getElementById('campaignResultKicker').style.color = victory ? playerColor : '';
        document.getElementById('campaignResultKicker').classList.toggle('defeat', !victory);
        document.getElementById('campaignResultStars').textContent = victory
            ? `${'★'.repeat(res.stars)}${'☆'.repeat(3 - res.stars)}` : '———';
        document.getElementById('campaignResultText').textContent = activeScenario.resultText(victory, res, reason);
        document.getElementById('campaignResultObjectives').innerHTML = activeScenario.resultObjectivesHtml(victory, res);
        resultOverlay.classList.add('show');
        resultOverlay.setAttribute('aria-hidden', 'false');
    }

    function win() { showResult(true); }
    function fail(reason) { showResult(false, reason); }

    // 传给 scenario.createFlow 的能力面：只暴露控制器内部机制，不含关卡知识。
    const api = {
        isActive: () => active,
        isResultShown: () => resultShown,
        getStepId: () => stepId,
        setStepId: (id) => { stepId = id; },
        showStep,
        updateObjectives,
        setActiveObjective: updateObjectives,
        setObjectiveStatus,
        hideGuidance,
        showHint,
        findUnit,
        win,
        fail
    };

    function loadScenarioRuntime(scenario) {
        activeScenario = scenario;
        activeFlow = scenario?.createFlow ? scenario.createFlow(api) : null;
    }

    function start() {
        if (!activeScenario) return;
        const firstTurnKey = gameState.turnOrder?.[0];
        if (gameState.campaignMode && firstTurnKey) {
            gameState.currentCamp = campFromKey(firstTurnKey, gameState);
            // 战役中的 AI 由阵营控制方式决定；忽略旧 PVE 启动流程遗留的固定对手槽位。
            gameState.aiOpponentCamp = null;
            updateUI();
        }
        active = true;
        resultShown = false;
        resultOverlay.classList.remove('show');
        resultOverlay.setAttribute('aria-hidden', 'true');
        const firstActive = Object.keys(activeScenario?.objectives || {}).find(id => activeScenario.objectives[id].active !== false) || '';
        updateObjectives(firstActive);
        showStep(activeScenario.initialStep, { immediate: true });
        activeFlow?.onLevelStarted?.();
        if (gameState.campaignMode && firstTurnKey) {
            emit('turn:started', { camp: gameState.currentCamp, campKey: firstTurnKey, turnCounter: gameState.turnCounter });
            const firstFaction = gameState.factions?.[firstTurnKey];
            if (firstFaction?.controller && firstFaction.controller !== 'human') {
                queueMicrotask(() => import('./gameLogic.js').then(({ runCampaignOpeningTurn }) => runCampaignOpeningTurn()));
            }
        }
    }

    function stop() {
        active = false;
        stepId = '';
        activeObjectiveId = '';
        activeFlow?.dispose?.();
        hideGuidance();
        objectiveHud?.classList.remove('show');
        resultOverlay.classList.remove('show');
        resultOverlay.setAttribute('aria-hidden', 'true');
        coach?.removeAttribute('data-campaign');
        coach?.removeAttribute('data-campaign-phase');
        speakerCard?.classList.remove('show');
        speakerCard?.setAttribute('aria-hidden', 'true');
    }

    button.addEventListener('click', () => {
        if (!active || !coach.dataset.campaign || button.disabled) return;
        const next = button.dataset.campaignNext;
        if (next && next.startsWith('__')) activeFlow?.onAdvance?.(next);
        else if (next) showStep(next);
    });
    document.getElementById('campaignRetryBtn').addEventListener('click', () => { stop(); onRetry(); });
    document.getElementById('campaignReturnBtn').addEventListener('click', () => { stop(); onReturn(); });
    window.addEventListener('resize', () => { if (active) requestAnimationFrame(syncRing); });

    // 领域事件 → 委托当前关卡流程（未加载关卡或非激活时由 flow 内部守卫短路）。
    on('input:tileSelected', (p) => {
        activeFlow?.onTileSelected?.(p);
        const item = activeScenario?._config?.interactables?.find(candidate => candidate.q === p.tile?.q && candidate.r === p.tile?.r);
        if (!item || gameState.interactionStates?.[item.id] !== 'available') return;
        gameState.interactionStates[item.id] = 'completed';
        showHint(`已完成：${item.label || '调查'}`);
        emit('campaign:interactionCompleted', {
            interactableId: item.id,
            unitId: p.unit?.id || null,
            camp: p.unit?.camp || gameState.localPlayerCampKey,
            q: item.q,
            r: item.r
        });
    });
    on('input:cardUsed', (p) => activeFlow?.onCardUsed?.(p));
    on('match:unitMoved', (p) => activeFlow?.onUnitMoved?.(p));
    on('input:commanderSkillUsed', (p) => activeFlow?.onSkillUsed?.(p));
    on('match:cityCaptured', (p) => activeFlow?.onCityCaptured?.(p));
    on('turn:started', (p) => activeFlow?.onTurnStarted?.(p));
    on('turn:ended', (p) => activeFlow?.onTurnEnded?.(p));
    on('match:combatStarted', (p) => activeFlow?.onCombatStarted?.(p));
    on('match:combatResolved', (p) => activeFlow?.onCombatResolved?.(p));
    on('match:unitHpChanged', (p) => activeFlow?.onUnitHpChanged?.(p));
    on('match:unitKilled', (p) => activeFlow?.onUnitKilled?.(p));
    on('match:diplomacyChanged', (p) => activeFlow?.onDiplomacyChanged?.(p));
    on('campaign:objectiveChanged', (p) => activeFlow?.onObjectiveChanged?.(p));
    on('campaign:interactionCompleted', (p) => activeFlow?.onInteractionCompleted?.(p));

    // 任务目标弹窗
    document.getElementById('objectivePopupBtn')?.addEventListener('click', () => {
        if (!activeScenario?.objectives) return;
        const allObj = activeScenario.objectives;
        const statuses = gameState.objectiveStates || {};
        objPopupBody.innerHTML = Object.keys(allObj).map(id => {
            const o = allObj[id];
            const st = statuses[id] || 'hidden';
            const icon = st === 'completed' ? '✓' : st === 'failed' ? '✗' : o.main ? '★' : '◇';
            const cls = st === 'completed' ? 'complete' : st === 'failed' ? 'failed' : '';
            return `<div class="faction-list-row ${cls}" style="border-left-color:${o.main ? '#ffd866' : '#777'}"><span class="faction-list-swatch"></span><span class="faction-list-name">${icon} ${o.title || id}</span><span class="faction-list-meta">${st}</span></div>`;
        }).join('');
        objPopup.classList.add('show');
    });
    document.getElementById('objectivePopupClose')?.addEventListener('click', () => objPopup.classList.remove('show'));
    objPopup?.addEventListener('click', (e) => { if (e.target === objPopup) objPopup.classList.remove('show'); });

    // 任务通知卡片（弹出式 toast）
    window._showObjectiveToast = (text) => {
        if (!objToast || !objToastBody) return;
        objToastBody.innerHTML = text;
        objToast.classList.add('show');
        clearTimeout(objToast._timer);
        objToast._timer = setTimeout(() => objToast.classList.remove('show'), 4000);
    };

    function validateCanvasClick(tile) { return activeFlow?.validateCanvasClick?.(tile) ?? true; }
    function validateCardClick(cardId) { return activeFlow?.validateCardClick?.(cardId) ?? true; }
    function validateAction(actionKey) { return activeFlow?.validateAction?.(actionKey) ?? true; }

    return { start, stop, loadScenarioRuntime, validateCanvasClick, validateCardClick, validateAction };
}

export function setCampaignControllerRef(controller) { sharedController = controller; }
export function campaignValidateCanvasClick(tile) { return sharedController?.validateCanvasClick(tile) ?? true; }
export function campaignValidateCardClick(cardId) { return sharedController?.validateCardClick(cardId) ?? true; }
export function campaignValidateAction(actionKey) { return sharedController?.validateAction(actionKey) ?? true; }
