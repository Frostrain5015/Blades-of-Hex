import { canvas, LOGICAL_W, LOGICAL_H, CAMP, invalidateBoard } from './config.js';
import { gameState, logMessage, updateUI } from './state.js';
import { on } from './eventBus.js';
import { spawnRainCityCounterattack } from './tutorialScenario.js';
import { HEART_AS_FIRE_CAMPAIGN, RAIN_CITY_SCENARIO, CAMPAIGN_STORAGE_KEY } from '../campaign/content/heartAsFire.js';

const STEPS = Object.freeze({
    briefing: {
        phase: 'dialog', mode: 'narrator',
        text: '【雨幕下的孤城】\n雨水淹没了东侧道路，百夫长封锁中央石桥。桥后还有三十名伤兵——天亮之前，必须夺下这座城。',
        button: '进入雨幕', next: 'battlefield'
    },
    battlefield: {
        phase: 'dialog', mode: 'narrator',
        text: '雨天会拖慢骑兵。山地上的弩手已经完成掩护射击，本回合无法行动。先查看前线的狂战士，再决定如何突破。',
        button: '查看主将', next: 'selectHero'
    },
    selectHero: {
        phase: 'unit', mode: 'narrator',
        text: '点击地图上的【狂战士】，查看他的生命、兵种与将领能力。', target: 'hero'
    },
    fieldAid: {
        phase: 'dialog', mode: 'character', speaker: { name: '狂战士', portrait: '狂战士' },
        text: '“把绷带系紧。桥后的人，比我更需要一条退路。”\n\n使用右侧手牌中的【疗愈】，先稳定伤势。',
        button: '使用疗愈', next: 'useCard'
    },
    useCard: {
        phase: 'card', mode: 'narrator',
        text: '点击右侧手牌中的【疗愈】，再选择狂战士作为目标。', target: 'heal'
    },
    cardTarget: {
        phase: 'unit', mode: 'narrator',
        text: '点击狂战士，为其恢复生命。', target: 'hero'
    },
    approach: {
        phase: 'tile', mode: 'narrator',
        text: '先点击狂战士，再点击高亮森林。森林能提供防御，但在雨中会消耗更多行动力。', target: 'move'
    },
    skill: {
        phase: 'action', mode: 'narrator',
        text: '双击右下角的【泣血】：以当前生命为代价，强化下一次攻击并造成溅射伤害。', target: 'commander'
    },
    duelCenturion: {
        phase: 'dialog', mode: 'character', speaker: { name: '百夫长', portrait: '百夫长' },
        text: '“雨会拖住你的马，也会洗掉你留下的血。”',
        button: '回应', next: 'duelBerserker'
    },
    duelBerserker: {
        phase: 'dialog', mode: 'character', speaker: { name: '狂战士', portrait: '狂战士' },
        text: '“那就趁它还没洗净，记住我。”',
        button: '攻城', next: 'attack'
    },
    attack: {
        phase: 'unit', mode: 'narrator',
        text: '点击城中的百夫长，发动攻击。', target: 'centurion'
    },
    captured: {
        phase: 'dialog', mode: 'character', speaker: { name: '百夫长', portrait: '百夫长' },
        text: '城门陷落，东塔的信号火却已经燃起。\n\n“夺城容易。守住它，才算你赢。”',
        button: '迎击反扑', next: '__counterattack__'
    },
    lastStand: {
        phase: 'dialog', mode: 'narrator',
        text: '反扑没有夺回石桥。远处已出现友军火把——再守住这一轮，伤兵就能全部过桥。\n\n你可以消灭骑兵争取额外评价，也可以直接结束回合。',
        button: '守到天明', next: '__hold__'
    }
});

let sharedController = null;

function readProgress() {
    try {
        const parsed = JSON.parse(localStorage.getItem(CAMPAIGN_STORAGE_KEY) || '{}');
        const completedScenarioIds = Array.isArray(parsed.completedScenarioIds)
            ? parsed.completedScenarioIds.filter(id => typeof id === 'string')
            : (parsed.completed ? [RAIN_CITY_SCENARIO.id] : []);
        return {
            completedScenarioIds,
            completed: completedScenarioIds.includes(RAIN_CITY_SCENARIO.id),
            bestStars: Math.max(0, Math.min(3, Number(parsed.bestStars) || 0))
        };
    } catch (_) {
        return { completedScenarioIds: [], completed: false, bestStars: 0 };
    }
}

export function refreshCampaignLobbyProgress() {
    const progress = readProgress();
    const rating = document.getElementById('rainCityRating');
    const mark = document.getElementById('campaignProgressMark');
    if (rating) {
        rating.textContent = '★'.repeat(progress.bestStars) + '☆'.repeat(3 - progress.bestStars);
        rating.setAttribute('aria-label', progress.completed ? `最佳评价 ${progress.bestStars} 星` : '尚未完成');
    }
    const completedScenarios = HEART_AS_FIRE_CAMPAIGN.scenarioIds
        .filter(id => progress.completedScenarioIds.includes(id)).length;
    const totalScenarios = HEART_AS_FIRE_CAMPAIGN.scenarioIds.length;
    if (mark) mark.textContent = `当前进度 ${Math.round((completedScenarios / totalScenarios) * 100)}%`;
}

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
    const resultOverlay = document.getElementById('campaignResultOverlay');
    const speakerCard = document.getElementById('campaignSpeakerCard');
    const speakerPortrait = document.getElementById('campaignSpeakerPortrait');
    const speakerName = document.getElementById('campaignSpeakerName');

    let active = false;
    let stepId = '';
    let sawEnemyTurn = false;
    let resultShown = false;
    let transitionToken = 0;
    let transitionTimer = null;
    let transitionCleanupTimer = null;
    let captureDialogueTimer = null;

    function tileForTarget(target) {
        const targets = gameState.tutorialTargets;
        if (!targets) return null;
        if (target === 'hero') return gameState.tiles.find(tile => tile.unit?.id === targets.berserkerUnitId) || null;
        if (target === 'centurion') return gameState.tiles.find(tile => tile.unit?.id === targets.centurionUnitId) || null;
        if (target === 'move') return gameState.tileMap.get(`${targets.move.q},${targets.move.r}`) || null;
        return null;
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
        const step = STEPS[stepId];
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
        const objective = RAIN_CITY_SCENARIO.objectives[key];
        if (!objectiveHud || !objective) return;
        objectiveTitle.textContent = objective.title;
        objectiveDetail.textContent = objective.detail;
        optionalList.innerHTML = RAIN_CITY_SCENARIO.optionalObjectives
            .map(item => `<span data-objective="${item.id}">◇ ${item.text}</span>`).join('');
        objectiveHud.classList.add('show');
    }

    function renderStep(step, nextId) {
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
        coach.dataset.campaign = 'heart-as-fire';
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
        const step = STEPS[nextId];
        if (!active || !step) return;
        stepId = nextId;
        // 旧规则层仍将受限移动识别为固定的 `move`；控制器内部保留更语义化的阶段名。
        gameState.tutorialStep = nextId === 'approach' ? 'move' : nextId;
        gameState.campaignPhase = nextId;
        const token = ++transitionToken;
        clearTimeout(transitionTimer);
        button.disabled = true;
        if (immediate || !overlay.classList.contains('show')) {
            renderStep(step, nextId);
            return;
        }
        coach.classList.remove('campaign-dialog-in');
        coach.classList.add('campaign-dialog-out');
        transitionTimer = setTimeout(() => {
            if (!active || token !== transitionToken) return;
            renderStep(step, nextId);
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

    function beginCounterattack() {
        spawnRainCityCounterattack();
        gameState.tutorialMode = false;
        gameState.tutorialStep = '';
        gameState.campaignPhase = 'counterattack';
        sawEnemyTurn = false;
        updateObjectives('counterattack');
        hideGuidance();
        logMessage('主目标更新：迎击东路反扑，狂战士必须存活。');
        updateUI();
        invalidateBoard();
    }

    function beginHold() {
        gameState.campaignPhase = 'hold';
        updateObjectives('hold');
        showStep('lastStand');
    }

    function findUnit(id) {
        return gameState.tiles.find(tile => tile.unit?.id === id)?.unit || null;
    }

    function cityTile() {
        const target = gameState.tutorialTargets?.attack;
        return target ? gameState.tileMap.get(`${target.q},${target.r}`) || null : null;
    }

    function calculateStars() {
        const archerAlive = !!findUnit(gameState.tutorialTargets?.archerUnitId);
        const cavalryAlive = !!findUnit(gameState.tutorialTargets?.enemyCavUnitId);
        return { stars: 1 + Number(archerAlive) + Number(!cavalryAlive), archerAlive, cavalryDestroyed: !cavalryAlive };
    }

    function saveVictory(stars) {
        const previous = readProgress();
        const completedScenarioIds = [...new Set([...previous.completedScenarioIds, RAIN_CITY_SCENARIO.id])];
        localStorage.setItem(CAMPAIGN_STORAGE_KEY, JSON.stringify({
            completed: true,
            completedScenarioIds,
            bestStars: Math.max(previous.bestStars, stars),
            completedAt: new Date().toISOString()
        }));
    }

    function showResult(victory, reason = '') {
        if (resultShown) return;
        resultShown = true;
        gameState.gameOver = true;
        gameState.tutorialMode = false;
        hideGuidance();
        objectiveHud?.classList.remove('show');
        const result = victory ? calculateStars() : { stars: 0, archerAlive: !!findUnit(gameState.tutorialTargets?.archerUnitId), cavalryDestroyed: false };
        if (victory) saveVictory(result.stars);
        document.getElementById('campaignResultKicker').textContent = victory ? '战役完成' : '任务失败';
        document.getElementById('campaignResultKicker').classList.toggle('defeat', !victory);
        document.getElementById('campaignResultStars').textContent = victory ? `${'★'.repeat(result.stars)}${'☆'.repeat(3 - result.stars)}` : '———';
        document.getElementById('campaignResultText').textContent = victory
            ? '石桥守住了。第一批伤兵在晨雾中穿过城门，而一个尚未被世人记住的名字，开始在军中流传。'
            : reason;
        document.getElementById('campaignResultObjectives').innerHTML = victory
            ? `<span class="complete">✓ 守住中央城市</span><span class="${result.archerAlive ? 'complete' : ''}">${result.archerAlive ? '✓' : '×'} 无人掉队</span><span class="${result.cavalryDestroyed ? 'complete' : ''}">${result.cavalryDestroyed ? '✓' : '◇'} 雷霆反击</span>`
            : '<span>重新整顿部队，再次尝试。</span>';
        resultOverlay.classList.add('show');
        resultOverlay.setAttribute('aria-hidden', 'false');
    }

    function win() { showResult(true); }
    function fail(reason) { showResult(false, reason); }

    function validateCanvasClick(tile) {
        if (!active || !gameState.tutorialMode) return true;
        const targets = gameState.tutorialTargets;
        if (stepId === 'selectHero' || stepId === 'cardTarget') {
            if (tile?.unit?.id === targets?.berserkerUnitId) return true;
            showHint('请点击高亮的狂战士'); return false;
        }
        if (stepId === 'approach') {
            if (tile?.unit?.id === targets?.berserkerUnitId) return true;
            if (tile?.q === targets?.move?.q && tile?.r === targets?.move?.r) return true;
            showHint('先选择狂战士，再移动到高亮森林'); return false;
        }
        if (stepId === 'attack') {
            if (tile?.unit?.id === targets?.berserkerUnitId || tile?.unit?.id === targets?.centurionUnitId) return true;
            showHint('请攻击城中的百夫长'); return false;
        }
        showHint('请先完成当前剧情指引'); return false;
    }

    function validateCardClick(cardId) {
        if (!active || !gameState.tutorialMode) return true;
        if (stepId === 'useCard' && cardId === 'heal') {
            setTimeout(() => { if (active && stepId === 'useCard') showStep('cardTarget'); }, 0);
            return true;
        }
        showHint('请使用【疗愈】'); return false;
    }

    function validateAction(actionKey) {
        if (!active || !gameState.tutorialMode) return true;
        if (stepId === 'skill' && actionKey?.startsWith('commander:')) return true;
        showHint('请发动狂战士的【泣血】'); return false;
    }

    function start() {
        active = true;
        resultShown = false;
        sawEnemyTurn = false;
        resultOverlay.classList.remove('show');
        resultOverlay.setAttribute('aria-hidden', 'true');
        updateObjectives('assault');
        showStep('briefing', { immediate: true });
    }

    function stop() {
        active = false;
        stepId = '';
        sawEnemyTurn = false;
        clearTimeout(captureDialogueTimer);
        captureDialogueTimer = null;
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
        if (next === '__counterattack__') beginCounterattack();
        else if (next === '__hold__') { gameState.campaignPhase = 'hold'; hideGuidance(); }
        else if (next) showStep(next);
    });
    document.getElementById('campaignRetryBtn').addEventListener('click', () => { stop(); onRetry(); });
    document.getElementById('campaignReturnBtn').addEventListener('click', () => { stop(); onReturn(); });
    window.addEventListener('resize', () => { if (active) requestAnimationFrame(syncRing); });

    on('input:tileSelected', ({ unit }) => {
        if (active && stepId === 'selectHero' && unit?.id === gameState.tutorialTargets?.berserkerUnitId) showStep('fieldAid');
    });
    on('input:cardUsed', ({ cardId }) => {
        if (active && stepId === 'cardTarget' && cardId === 'heal') showStep('approach');
    });
    on('match:unitMoved', ({ unit, targetTile }) => {
        const target = gameState.tutorialTargets?.move;
        if (active && stepId === 'approach' && unit?.id === gameState.tutorialTargets?.berserkerUnitId
            && targetTile?.q === target?.q && targetTile?.r === target?.r) showStep('skill');
    });
    on('input:commanderSkillUsed', ({ unit }) => {
        if (active && stepId === 'skill' && unit?.id === gameState.tutorialTargets?.berserkerUnitId) showStep('duelCenturion');
    });
    on('match:cityCaptured', ({ campKey: capturedBy }) => {
        if (!active) return;
        if (stepId === 'attack' && capturedBy === 'player1') {
            stepId = 'cinematic';
            gameState.tutorialStep = 'cinematic';
            gameState.campaignPhase = 'cinematic';
            hideGuidance();
            clearTimeout(captureDialogueTimer);
            captureDialogueTimer = setTimeout(() => {
                if (active && !resultShown) showStep('captured', { immediate: true });
            }, 2600);
        }
        else if ((gameState.campaignPhase === 'counterattack' || gameState.campaignPhase === 'hold') && capturedBy !== 'player1') {
            fail('中央城市失守，石桥重新落入蓝军手中。');
        }
    });
    on('turn:started', ({ camp }) => {
        if (!active || resultShown) return;
        const heroAlive = !!findUnit(gameState.tutorialTargets?.berserkerUnitId);
        if (!heroAlive) { fail('狂战士倒在了黎明之前，伤兵失去了最后的退路。'); return; }
        if (gameState.campaignPhase === 'hold' && cityTile()?.camp !== CAMP.player1) {
            fail('中央城市失守，石桥重新落入蓝军手中。'); return;
        }
        if (gameState.campaignPhase === 'counterattack') {
            if (camp === CAMP.player2) sawEnemyTurn = true;
            if (camp === CAMP.player1 && sawEnemyTurn) beginHold();
        } else if (gameState.campaignPhase === 'hold' && camp === CAMP.player2) {
            if (cityTile()?.camp === CAMP.player1) win();
            else fail('最后一刻，中央城市失守。');
        }
    });

    return { start, stop, validateCanvasClick, validateCardClick, validateAction };
}

export function setCampaignControllerRef(controller) { sharedController = controller; }
export function campaignValidateCanvasClick(tile) { return sharedController?.validateCanvasClick(tile) ?? true; }
export function campaignValidateCardClick(cardId) { return sharedController?.validateCardClick(cardId) ?? true; }
export function campaignValidateAction(actionKey) { return sharedController?.validateAction(actionKey) ?? true; }
