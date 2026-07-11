// 触发器引擎 —— 把声明式的「事件-条件-动作」解释为关卡运行时行为。
// 这是配置关卡代替手写 createFlow 的核心：帝国时代2编辑器同款模型。
// createTriggerFlow(config, api) 返回通用控制器认识的 flow 接口。
import { CAMP } from '../../rules/camps.js';
import { Unit } from '../../js/Unit.js';
import { computeCampBorders } from '../../js/HexTile.js';
import { invalidateBoard } from '../../js/config.js';
import { gameState, logMessage, updateUI } from '../../js/state.js';
import { getRound } from '../../rules/turns.js';

function campFromKey(key) {
    if (key === 'player1') return CAMP.player1;
    if (key === 'player2') return CAMP.player2;
    if (key === 'player3') return CAMP.player3;
    return CAMP.neutral;
}
function campKeyOf(camp) {
    if (camp === CAMP.player1) return 'player1';
    if (camp === CAMP.player2) return 'player2';
    if (camp === CAMP.player3) return 'player3';
    return 'neutral';
}

// ── 生成单位（供 spawnUnits 动作复用；亦可被脚本关调用）──────────────
export function spawnUnitsInto(state, specs) {
    const created = [];
    for (const spec of (specs || [])) {
        const tile = state.tileMap.get(`${spec.q},${spec.r}`);
        if (!tile || tile.unit) continue;
        const camp = campFromKey(spec.camp);
        // 让地块底色与来袭单位一致（旗帜/边界正确）。
        tile.camp = camp;
        tile.startColor = camp.color;
        tile.targetColor = camp.color;
        tile.currentColor = camp.color;
        tile.fadeStartTime = null;
        const unit = new Unit(spec.type, camp, tile, false, spec.id || null, spec.commander || null);
        if (typeof spec.hp === 'number') unit.hp = Math.max(1, Math.min(unit.maxHp, Math.round(spec.hp)));
        else if (typeof spec.hpPct === 'number') unit.hp = Math.max(1, Math.min(unit.maxHp, Math.round(unit.maxHp * spec.hpPct / 100)));
        unit.displayHp = unit.hp;
        unit.morale = typeof spec.morale === 'number' ? spec.morale : 2;
        unit.canAct = spec.canAct !== false;
        created.push(unit);
    }
    if (created.length) {
        state.campBorderEdges = computeCampBorders(state.tiles, state.tileMap);
        invalidateBoard();
    }
    return created;
}

// ── 条件求值 ─────────────────────────────────────────────────
function evalCondition(cond, ctx) {
    if (!cond || typeof cond !== 'object') return true;
    const { api, event, flags } = ctx;
    switch (cond.kind) {
        case 'stepIs':      return api.getStepId() === cond.value;
        case 'phaseIs':     return gameState.campaignPhase === cond.value;
        case 'eventUnitIs': return event?.unitId != null && event.unitId === cond.unit;
        case 'eventCardIs': return event?.cardId === cond.value;
        case 'eventCampIs': return event?.camp === cond.value;
        case 'eventNextIs': return event?.next === cond.value;
        case 'unitAlive':   return !!api.findUnit(cond.unit);
        case 'unitDead':    return !api.findUnit(cond.unit);
        case 'cityOwnedBy': {
            const tile = gameState.tileMap.get(`${cond.q},${cond.r}`);
            return !!tile && campKeyOf(tile.camp) === cond.camp;
        }
        case 'turnAtLeast': return getRound(gameState) >= (cond.value || 0);
        case 'flagSet':     return flags.has(cond.value);
        case 'flagUnset':   return !flags.has(cond.value);
        case 'all':         return (cond.conditions || []).every(c => evalCondition(c, ctx));
        case 'any':         return (cond.conditions || []).some(c => evalCondition(c, ctx));
        case 'not':         return !evalCondition(cond.condition, ctx);
        default:            return true;   // 未知条件不阻断（容错）
    }
}
function evalAll(conds, ctx) {
    return (conds || []).every(c => evalCondition(c, ctx));
}

// 供结算/星级规则复用：在无事件上下文下判定一组条件是否全部成立。
export function evaluateConditions(conds, api, flags) {
    return evalAll(conds, { api, event: {}, flags: flags || new Set(), state: null });
}

// ── 动作执行 ─────────────────────────────────────────────────
function runActions(actions, ctx) {
    for (const action of (actions || [])) runAction(action, ctx);
}
function runAction(action, ctx) {
    if (!action || typeof action !== 'object') return;
    const { api, flags, state } = ctx;
    switch (action.kind) {
        case 'showStep':
            api.showStep(action.step, { immediate: !!action.immediate });
            break;
        case 'setObjective':
            api.updateObjectives(action.objective);
            break;
        case 'setOptional': {
            flags.add(`optional:${action.id}`);   // 结算面板据此判定支线完成
            const el = document.querySelector(`#campaignOptionalObjectives [data-objective="${action.id}"]`);
            if (el) { el.classList.add('complete'); el.textContent = '✓ ' + el.textContent.replace(/^[◇✓]\s*/, ''); }
            break;
        }
        case 'spawnUnits':
            spawnUnitsInto(gameState, action.units);
            updateUI();
            break;
        case 'setFlag':    flags.add(action.value); break;
        case 'clearFlag':  flags.delete(action.value); break;
        case 'setPhase':   gameState.campaignPhase = action.value; break;
        case 'hideGuidance': api.hideGuidance(); break;
        case 'unlockInput':
            gameState.tutorialMode = false;
            gameState.tutorialStep = '';
            api.hideGuidance();
            break;
        case 'log':        if (action.text) logMessage(action.text); break;
        case 'win':        api.win(); break;
        case 'fail':       api.fail(action.text || ''); break;
        case 'delay': {
            const timer = setTimeout(() => {
                if (api.isActive() && !api.isResultShown()) runActions(action.then, ctx);
            }, action.ms || 0);
            state.timers.push(timer);
            break;
        }
        default: break;    // 未知动作忽略
    }
}

// ── flow 工厂 ────────────────────────────────────────────────
export function createTriggerFlow(config, api) {
    // 标记集挂在 gameState 上，供结算/星级规则跨越 flow 边界读取。
    if (!(gameState._campaignFlags instanceof Set)) gameState._campaignFlags = new Set();
    const state = { flags: gameState._campaignFlags, fired: new Set(), timers: [] };
    const triggers = (config.triggers || []).map((t, i) => ({ ...t, _id: t.id || `trigger_${i}` }));
    const result = config.result || {};
    const enemyKey = config.aiOpponentCamp || 'player2';
    let levelStarted = false;

    function ctxFor(event) {
        return { api, event: event || {}, flags: state.flags, state };
    }

    // 派发某事件的全部匹配触发器。
    function dispatch(eventId, event) {
        if (!api.isActive() || api.isResultShown()) return;
        const ctx = ctxFor(event);
        for (const trig of triggers) {
            if (trig.on !== eventId) continue;
            if (trig.once && state.fired.has(trig._id)) continue;
            if (!evalAll(trig.when, ctx)) continue;
            state.fired.add(trig._id);
            runActions(trig.do, ctx);
            if (api.isResultShown()) return;   // 已判定胜负，停止后续触发
        }
    }

    // 内置便捷结算（可被显式 win/fail 触发器抢先；全部可关）。
    function autoResolve() {
        if (!api.isActive() || api.isResultShown()) return;
        // 保护单位阵亡 → 失败。
        for (const uid of (result.protectUnits || [])) {
            if (!api.findUnit(uid)) { api.fail(result.protectFailText || result.loseText || ''); return; }
        }
        // 消灭敌方全部单位 → 胜利。
        if (result.eliminateEnemy) {
            const enemyCamp = campFromKey(enemyKey);
            const enemyAlive = gameState.tiles.some(t => t.unit && t.unit.camp === enemyCamp && t.unit.hp > 0);
            if (!enemyAlive) { api.win(); return; }
        }
        // 撑到指定回合 → 胜利。
        if (result.surviveToTurn && getRound(gameState) >= result.surviveToTurn) { api.win(); return; }
    }

    function afterEvent(eventId, event) {
        dispatch(eventId, event);
        autoResolve();
    }

    // 单位允许点击的引导锁：读当前步骤的 allow 白名单。
    function currentAllow() {
        const step = config.steps?.[api.getStepId()];
        return step?.allow || null;
    }

    return {
        onTileSelected({ unit }) {
            if (!levelStarted) { levelStarted = true; afterEvent('levelStart', {}); }
            afterEvent('tileSelected', { unitId: unit?.id });
        },
        onCardUsed({ cardId }) { afterEvent('cardUsed', { cardId }); },
        onUnitMoved({ unit, targetTile }) {
            afterEvent('unitMoved', { unitId: unit?.id, q: targetTile?.q, r: targetTile?.r });
        },
        onSkillUsed({ unit }) { afterEvent('skillUsed', { unitId: unit?.id }); },
        onCityCaptured({ campKey }) { afterEvent('cityCaptured', { camp: campKey }); },
        onTurnStarted({ camp }) {
            if (!levelStarted) { levelStarted = true; afterEvent('levelStart', {}); }
            afterEvent('turnStarted', { camp: campKeyOf(camp) });
        },
        onAdvance(next) { afterEvent('advance', { next }); },

        // ── 输入策略（严格引导期按 step.allow 白名单校验）──
        validateCanvasClick(tile) {
            if (!api.isActive() || !gameState.tutorialMode) return true;
            const allow = currentAllow();
            if (!allow || (!allow.units && !allow.tiles)) return true;
            const uid = tile?.unit?.id;
            if (allow.units && uid && allow.units.includes(uid)) return true;
            if (allow.tiles && allow.tiles.some(p => p.q === tile?.q && p.r === tile?.r)) return true;
            api.showHint(allow.hint || '请按剧情指引操作');
            return false;
        },
        validateCardClick(cardId) {
            if (!api.isActive() || !gameState.tutorialMode) return true;
            const allow = currentAllow();
            if (!allow || !allow.cards) return true;
            if (allow.cards.includes(cardId)) return true;
            api.showHint(allow.hint || '当前无法使用该对策卡');
            return false;
        },
        validateAction(actionKey) {
            if (!api.isActive() || !gameState.tutorialMode) return true;
            const allow = currentAllow();
            if (!allow || !allow.actions) return true;
            if (allow.actions.some(a => actionKey?.startsWith(a))) return true;
            api.showHint(allow.hint || '当前无法发动该技能');
            return false;
        },

        dispose() {
            for (const t of state.timers) clearTimeout(t);
            state.timers.length = 0;
        },

        // 供结算读取运行时标记（星级规则可查 flag）。
        _flags: state.flags
    };
}
