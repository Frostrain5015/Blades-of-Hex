// 关卡《雨幕下的孤城》运行时内容 —— 剧本步骤、目标、局内流程、结算与建图入口。
// 通用控制器(js/campaignController.js)通过本模块的 default 导出驱动一切，自身不含任何雨幕关知识。
import { CAMP, invalidateBoard } from '../../../../js/config.js';
import { gameState, logMessage, updateUI } from '../../../../js/state.js';
import CHRONICLE from '../chronicle.js';
import { setupRainCityBattlefield, spawnRainCityCounterattack } from './battlefield.js';

// 剧本步骤图（旧 campaignController.STEPS 原样迁入）。
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
        // ruleStep：旧规则层仍将受限移动识别为固定的 'move'；步骤名更语义化，规则名单独声明。
        phase: 'tile', mode: 'narrator', ruleStep: 'move',
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

const OBJECTIVES = Object.freeze({
    assault: { title: '突破城门', detail: '穿过森林，击败百夫长并占领中央城市。' },
    counterattack: { title: '迎击反扑', detail: '结束回合，让敌军反扑；狂战士必须活下来。' },
    hold: { title: '守到天明', detail: '在本回合结束时仍控制中央城市。' }
});

const OPTIONAL_OBJECTIVES = Object.freeze([
    { id: 'archer-survives', text: '无人掉队：弩手存活' },
    { id: 'destroy-cavalry', text: '雷霆反击：消灭反扑骑兵' }
]);

// 把 step.target 语义映射为棋盘 tile（供控制器绘制目标环）。
function tileForTarget(target) {
    const targets = gameState.tutorialTargets;
    if (!targets) return null;
    if (target === 'hero') return gameState.tiles.find(tile => tile.unit?.id === targets.berserkerUnitId) || null;
    if (target === 'centurion') return gameState.tiles.find(tile => tile.unit?.id === targets.centurionUnitId) || null;
    if (target === 'move') return gameState.tileMap.get(`${targets.move.q},${targets.move.r}`) || null;
    return null;
}

function cityTile() {
    const target = gameState.tutorialTargets?.attack;
    return target ? gameState.tileMap.get(`${target.q},${target.r}`) || null : null;
}

// 局内流程：事件驱动的阶段推进、输入校验、胜负判定。api 由控制器提供。
function createFlow(api) {
    let sawEnemyTurn = false;
    let captureDialogueTimer = null;

    const targets = () => gameState.tutorialTargets;

    function beginCounterattack() {
        spawnRainCityCounterattack();
        gameState.tutorialMode = false;
        gameState.tutorialStep = '';
        gameState.campaignPhase = 'counterattack';
        sawEnemyTurn = false;
        api.updateObjectives('counterattack');
        api.hideGuidance();
        logMessage('主目标更新：迎击东路反扑，狂战士必须存活。');
        updateUI();
        invalidateBoard();
    }

    function beginHold() {
        gameState.campaignPhase = 'hold';
        api.updateObjectives('hold');
        api.showStep('lastStand');
    }

    return {
        // ── 事件驱动阶段推进 ──
        onTileSelected({ unit }) {
            if (api.isActive() && api.getStepId() === 'selectHero' && unit?.id === targets()?.berserkerUnitId) api.showStep('fieldAid');
        },
        onCardUsed({ cardId }) {
            if (api.isActive() && api.getStepId() === 'cardTarget' && cardId === 'heal') api.showStep('approach');
        },
        onUnitMoved({ unit, targetTile }) {
            const move = targets()?.move;
            if (api.isActive() && api.getStepId() === 'approach' && unit?.id === targets()?.berserkerUnitId
                && targetTile?.q === move?.q && targetTile?.r === move?.r) api.showStep('skill');
        },
        onSkillUsed({ unit }) {
            if (api.isActive() && api.getStepId() === 'skill' && unit?.id === targets()?.berserkerUnitId) api.showStep('duelCenturion');
        },
        onCityCaptured({ campKey: capturedBy }) {
            if (!api.isActive()) return;
            if (api.getStepId() === 'attack' && capturedBy === 'player1') {
                api.setStepId('cinematic');
                gameState.tutorialStep = 'cinematic';
                gameState.campaignPhase = 'cinematic';
                api.hideGuidance();
                clearTimeout(captureDialogueTimer);
                captureDialogueTimer = setTimeout(() => {
                    if (api.isActive() && !api.isResultShown()) api.showStep('captured', { immediate: true });
                }, 2600);
            } else if ((gameState.campaignPhase === 'counterattack' || gameState.campaignPhase === 'hold') && capturedBy !== 'player1') {
                api.fail('中央城市失守，石桥重新落入蓝军手中。');
            }
        },
        onTurnStarted({ camp }) {
            if (!api.isActive() || api.isResultShown()) return;
            const heroAlive = !!api.findUnit(targets()?.berserkerUnitId);
            if (!heroAlive) { api.fail('狂战士倒在了黎明之前，伤兵失去了最后的退路。'); return; }
            if (gameState.campaignPhase === 'hold' && cityTile()?.camp !== CAMP.player1) {
                api.fail('中央城市失守，石桥重新落入蓝军手中。'); return;
            }
            if (gameState.campaignPhase === 'counterattack') {
                if (camp === CAMP.player2) sawEnemyTurn = true;
                if (camp === CAMP.player1 && sawEnemyTurn) beginHold();
            } else if (gameState.campaignPhase === 'hold' && camp === CAMP.player2) {
                if (cityTile()?.camp === CAMP.player1) api.win();
                else api.fail('最后一刻，中央城市失守。');
            }
        },
        // ── 特殊按钮跳转 ──
        onAdvance(next) {
            if (next === '__counterattack__') beginCounterattack();
            else if (next === '__hold__') { gameState.campaignPhase = 'hold'; api.hideGuidance(); }
        },
        // ── 输入策略（严格引导期的点击校验）──
        validateCanvasClick(tile) {
            if (!api.isActive() || !gameState.tutorialMode) return true;
            const t = targets();
            const stepId = api.getStepId();
            if (stepId === 'selectHero' || stepId === 'cardTarget') {
                if (tile?.unit?.id === t?.berserkerUnitId) return true;
                api.showHint('请点击高亮的狂战士'); return false;
            }
            if (stepId === 'approach') {
                if (tile?.unit?.id === t?.berserkerUnitId) return true;
                if (tile?.q === t?.move?.q && tile?.r === t?.move?.r) return true;
                api.showHint('先选择狂战士，再移动到高亮森林'); return false;
            }
            if (stepId === 'attack') {
                if (tile?.unit?.id === t?.berserkerUnitId || tile?.unit?.id === t?.centurionUnitId) return true;
                api.showHint('请攻击城中的百夫长'); return false;
            }
            api.showHint('请先完成当前剧情指引'); return false;
        },
        validateCardClick(cardId) {
            if (!api.isActive() || !gameState.tutorialMode) return true;
            if (api.getStepId() === 'useCard' && cardId === 'heal') {
                setTimeout(() => { if (api.isActive() && api.getStepId() === 'useCard') api.showStep('cardTarget'); }, 0);
                return true;
            }
            api.showHint('请使用【疗愈】'); return false;
        },
        validateAction(actionKey) {
            if (!api.isActive() || !gameState.tutorialMode) return true;
            if (api.getStepId() === 'skill' && actionKey?.startsWith('commander:')) return true;
            api.showHint('请发动狂战士的【泣血】'); return false;
        },
        // 关卡停止时清理挂起的演出定时器。
        dispose() {
            clearTimeout(captureDialogueTimer);
            captureDialogueTimer = null;
        }
    };
}

// 结算：星级/文案（旧 showResult 内联逻辑迁入）。
function calculateResult(victory, api) {
    const archerAlive = !!api.findUnit(gameState.tutorialTargets?.archerUnitId);
    if (!victory) return { stars: 0, archerAlive, cavalryDestroyed: false };
    const cavalryAlive = !!api.findUnit(gameState.tutorialTargets?.enemyCavUnitId);
    return { stars: 1 + Number(archerAlive) + Number(!cavalryAlive), archerAlive, cavalryDestroyed: !cavalryAlive };
}

function resultText(victory, res, reason) {
    return victory
        ? '石桥守住了。第一批伤兵在晨雾中穿过城门，而一个尚未被世人记住的名字，开始在军中流传。'
        : reason;
}

function resultObjectivesHtml(victory, res) {
    return victory
        ? `<span class="complete">✓ 守住中央城市</span><span class="${res.archerAlive ? 'complete' : ''}">${res.archerAlive ? '✓' : '×'} 无人掉队</span><span class="${res.cavalryDestroyed ? 'complete' : ''}">${res.cavalryDestroyed ? '✓' : '◇'} 雷霆反击</span>`
        : '<span>重新整顿部队，再次尝试。</span>';
}

export default {
    id: 'rain-city',
    title: '雨幕下的孤城',
    seed: 0x5241494E,
    turnLimit: 4,
    storageKey: CHRONICLE.storageKey,
    initialStep: 'briefing',
    initialObjective: 'assault',
    intro: { campaignTitle: '将星列传 · 我心如火', scenarioSubtitle: '序 雨幕下的孤城' },
    steps: STEPS,
    objectives: OBJECTIVES,
    optionalObjectives: OPTIONAL_OBJECTIVES,
    buildBattlefield: setupRainCityBattlefield,
    tileForTarget,
    createFlow,
    calculateResult,
    resultText,
    resultObjectivesHtml
};
