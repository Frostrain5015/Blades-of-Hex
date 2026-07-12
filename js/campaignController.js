// 通用战役控制器（内容无关引擎）。
// 具体关卡的剧本、目标、流程、结算文案全部来自 scenario 模块（见 campaign/content/**）。
// 本文件只负责：渲染步骤对白、目标 HUD、目标环/提示、结算面板、事件订阅与输入校验的分发。
import { canvas, HEX_SIZE, LOGICAL_W, LOGICAL_H, CAMP, invalidateBoard, hexPath } from './config.js';
import { gameState, logMessage, updateUI, notify } from './state.js';
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
    let _inlineStepCounter = 0;

    let activeScenario = null;
    let activeFlow = null;

    // 将触发器动作中的内联字段归一化为步骤对象
    function _inlineStepFromAction(action) {
        const hasNext = action.next != null && action.next !== '';
        const hasSpeaker = action.speaker?.name || action.speaker?.portrait;
        return {
            phase: hasNext ? 'dialog' : 'wait',
            mode: hasSpeaker ? 'character' : (action.mode || 'narrator'),
            text: action.text || '',
            speaker: hasSpeaker ? { name: action.speaker.name || '', portrait: action.speaker.portrait || '' } : undefined,
            next: action.next || undefined,
            highlight: action.highlight,
            dialogLock: action.dialogLock === true,
            ruleStep: action.ruleStep
        };
    }

    function dismissUnresolvedStep(next) {
        const unresolvedStep = gameState._inlineStepData;
        const label = next || '__chain_end__';
        console.warn(`[campaign] 剧情跳转「${label}」没有被接收，已淡出对白并解除操作锁。`);
        const token = ++transitionToken;
        clearTimeout(transitionTimer);
        clearTimeout(transitionCleanupTimer);
        coach.classList.remove('campaign-dialog-in');
        coach.classList.add('campaign-dialog-out');
        transitionTimer = setTimeout(() => {
            if (!active || token !== transitionToken || gameState._inlineStepData !== unresolvedStep) return;
            gameState.tutorialMode = false;
            delete gameState._campaignInputLock;
            delete gameState._inlineStepData;
            hideGuidance();
        }, 190);
    }

    // 对话框点击推进（受 dialogLock 控制）。显式跳转由触发器接收；
    // 找不到内联下一页或没有触发器接收时，淡出当前对白，避免作者配置失误软锁玩家。
    function _advanceFromClick() {
        if (!active) return;
        const step = gameState._inlineStepData;
        if (!step || step.dialogLock) return;
        if (step.next) {
            if (step.next.startsWith('__')) {
                const handled = activeFlow?.onAdvance?.(step.next) === true;
                if (!handled) dismissUnresolvedStep(step.next);
            } else if (gameState._inlineStepMap?.[step.next]) {
                showStep(gameState._inlineStepMap[step.next]);
            } else {
                dismissUnresolvedStep(step.next);
            }
        } else {
            // 没有 next = 链尾；如无收尾触发器，淡出而不是把对白和操作锁留在画面上。
            const handled = activeFlow?.onAdvance?.('__chain_end__') === true;
            if (!handled) dismissUnresolvedStep('__chain_end__');
        }
    }

    function tileForTarget(target) {
        return activeScenario?.tileForTarget?.(target) || null;
    }

    // 从 step.target 或 step.target.tiles 获取当前高亮的地块列表
    function _targetTiles(step) {
        if (!step || !step.target) return null;
        const t = step.target;
        if (t.tiles) return t.tiles.map(tile => gameState.tileMap.get(`${tile.q},${tile.r}`)).filter(Boolean);
        const single = tileForTarget(t);
        return single ? [single] : null;
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
        const step = gameState._inlineStepData;
        if (!active || !step || step?.phase === 'dialog' || step?.phase === 'card' || step?.phase === 'action') {
            ring?.classList.remove('visible');
            _clearAreaHighlights();
            return;
        }
        const hl = step.highlight;
        if (!hl) { ring?.classList.remove('visible'); _clearAreaHighlights(); return; }

        // 地块高亮 → 正旋脉冲边框
        if (hl.tiles) _drawAreaHighlights(hl.tiles);
        else _clearAreaHighlights();

        // 单位高亮 → 单格圆环（与地块高亮可并存）
        if (hl.unit) {
            const tile = tileForTarget(hl.unit);
            if (tile) {
                const rect = canvas.getBoundingClientRect();
                const scaleX = rect.width / LOGICAL_W;
                const scaleY = rect.height / LOGICAL_H;
                const size = Math.max(56, Math.min(rect.width, rect.height) * 0.09);
                ring.style.width = `${size}px`;
                ring.style.height = `${size}px`;
                ring.style.left = `${rect.left + tile.x * scaleX - size / 2}px`;
                ring.style.top = `${rect.top + tile.y * scaleY - size / 2}px`;
                ring.classList.add('visible');
                return;
            }
        }
        ring?.classList.remove('visible');
    }

    // 区域高亮：在画布上为每个地块绘制正旋脉冲边框
    let _areaHighlightTiles = [];
    let _areaHighlightFrame = 0;
    function _drawAreaHighlights(tiles) {
        const renderFn = () => {
            if (!active) return;
            const c = canvas.getContext('2d');
            _areaHighlightTiles = tiles;
            const now = performance.now();
            const pulse = (Math.sin(now / 350) + 1) / 2;
            const alpha = 0.5 + pulse * 0.4;
            c.save();
            for (const t of tiles) {
                const tile = gameState.tileMap.get(`${t.q},${t.r}`);
                if (!tile) continue;
                const cx = tile.x, cy = tile.y;
                hexPath(c, cx, cy, HEX_SIZE + 2);
                c.strokeStyle = `rgba(255,215,0,${alpha})`;
                c.lineWidth = 2.5 + pulse * 1.5;
                c.shadowColor = `rgba(255,215,0,${0.5 + pulse * 0.3})`;
                c.shadowBlur = 8 + pulse * 6;
                c.stroke();
            }
            c.restore();
            _areaHighlightFrame = requestAnimationFrame(renderFn);
        };
        if (_areaHighlightFrame) cancelAnimationFrame(_areaHighlightFrame);
        _areaHighlightFrame = requestAnimationFrame(renderFn);
    }
    function _clearAreaHighlights() {
        if (_areaHighlightFrame) { cancelAnimationFrame(_areaHighlightFrame); _areaHighlightFrame = 0; }
        _areaHighlightTiles = [];
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
        optionalList.replaceChildren(...Object.keys(allObj).filter(id => id !== key && (statuses[id] || 'hidden') !== 'hidden').map(id => {
            const o = allObj[id];
            const item = document.createElement('span');
            item.dataset.objective = id;
            item.textContent = `${o.main ? '★' : '◇'} ${o.title || o.detail || id}`;
            return item;
        }));
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
            window._showObjectiveToast?.(`${prefix} ${label} — ${status === 'completed' ? '已完成' : '已失败'}`);
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
        // 不再使用"下一步"按钮，点击对话框任意处推进
        button.hidden = true;
        coach.dataset.campaign = activeScenario?.id || '';
        coach.dataset.campaignPhase = step.phase;
        // 有 next 时对话框可点击推进，无 next 时等待触发器
        coach.style.cursor = step.next ? 'pointer' : '';
        setModalBlock(step.phase === 'dialog');
        overlay.classList.add('show');
        coach.classList.remove('campaign-dialog-out');
        coach.classList.add('campaign-dialog-in');
        clearTimeout(transitionCleanupTimer);
        transitionCleanupTimer = setTimeout(() => coach.classList.remove('campaign-dialog-in'), 420);
        requestAnimationFrame(syncRing);
    }

    function showStep(nextOrStep, { immediate = false } = {}) {
        if (!active || !nextOrStep) return;
        // 内联步骤：触发器动作直接携带所有字段
        const step = _inlineStepFromAction(nextOrStep);
        const id = nextOrStep._id || `__inline_${++_inlineStepCounter}`;
        stepId = id;
        gameState.tutorialStep = nextOrStep.ruleStep ?? id;
        gameState.campaignPhase = id;
        // boardLock: true → 棋盘操作锁；dialogLock: true → 对话框点击锁
        if (nextOrStep.boardLock === true) gameState.tutorialMode = true;
        // 存到 gameState 供 trigger 的 currentAllow/validateCanvasClick 查找
        gameState._inlineStepData = step;
        // 注册到内联步骤映射（供 next 链查找）
        if (nextOrStep._id) {
            if (!gameState._inlineStepMap) gameState._inlineStepMap = {};
            gameState._inlineStepMap[nextOrStep._id] = step;
        }
        if (!active || !step) return;
        const token = ++transitionToken;
        clearTimeout(transitionTimer);
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
        document.getElementById('campaignResultKicker').textContent = victory ? '任务成功' : '任务失败';
        document.getElementById('campaignResultKicker').style.color = victory ? playerColor : '';
        document.getElementById('campaignResultKicker').classList.toggle('defeat', !victory);
        document.getElementById('campaignResultTitle').textContent = activeScenario.title || '';
        document.getElementById('campaignResultStars').textContent = victory
            ? `${'★'.repeat(res.stars)}${'☆'.repeat(3 - res.stars)}` : '———';
        document.getElementById('campaignResultText').textContent = activeScenario.resultText(victory, res, reason);
        document.getElementById('campaignResultObjectives').innerHTML = activeScenario.resultObjectivesHtml(victory, res);
        resultOverlay.classList.add('show');
        resultOverlay.setAttribute('aria-hidden', 'false');
    }

    function win(reason = '') { showResult(true, reason); }
    function fail(reason) { showResult(false, reason); }

    // 传给 scenario.createFlow 的能力面：只暴露控制器内部机制，不含关卡知识。
    const api = {
        isActive: () => active,
        isResultShown: () => resultShown,
        getStepId: () => stepId,
        setStepId: (id) => { stepId = id; },
        showStep,
        showInlineStep: (action, opts) => showStep(action, opts),
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
        // initialStep 已废弃，开场由触发器 levelStarted → showStep 驱动
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
        activeFlow = null;
        activeScenario = null;
        delete gameState._inlineStepData;
        delete gameState._campaignInputLock;
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
    // 点击对话框任意处推进（替代"下一步"按钮）
    coach.addEventListener('click', _advanceFromClick);
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
    on('match:diplomacyChanged', (p) => {
        // 右上角胶囊提示：外交关系变更
        const playerCamp = gameState.localPlayerCampKey;
        const isPlayerInvolved = p.camp === playerCamp || p.targetCamp === playerCamp;
        if (isPlayerInvolved) {
            const other = p.camp === playerCamp ? p.targetCamp : p.camp;
            const faction = getFaction(gameState, other);
            const name = faction?.name || other;
            const labels = { ally: '联盟🤝', neutral: '中立😑', enemy: '敌对👊' };
            notify(`${name} 与你的关系已变更为${labels[p.relation] || p.relation}`, 'info');
        }
        activeFlow?.onDiplomacyChanged?.(p);
    });
    on('campaign:objectiveChanged', (p) => activeFlow?.onObjectiveChanged?.(p));
    on('campaign:interactionCompleted', (p) => activeFlow?.onInteractionCompleted?.(p));

    // 任务通知卡片（弹出式 toast）
    window._showObjectiveToast = (text) => {
        if (!objToast || !objToastBody) return;
        objToastBody.textContent = text;
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
export function stopCampaignRuntime() { sharedController?.stop(); }
export function campaignValidateCanvasClick(tile) { return sharedController?.validateCanvasClick(tile) ?? true; }
export function campaignValidateCardClick(cardId) { return sharedController?.validateCardClick(cardId) ?? true; }
export function campaignValidateAction(actionKey) { return sharedController?.validateAction(actionKey) ?? true; }
