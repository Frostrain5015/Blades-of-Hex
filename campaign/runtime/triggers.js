import { Unit } from '../../js/Unit.js';
import { computeCampBorders } from '../../js/HexTile.js';
import { invalidateBoard } from '../../js/config.js';
import { emit } from '../../js/eventBus.js';
import { gameState, logMessage, updateUI, clearselection } from '../../js/state.js';
import { getRound } from '../../rules/turns.js';
import {
    campFromKey, canAttack, createDefaultDiplomacy, getRelation, normalizeCampKey, setRelation
} from '../../rules/diplomacy.js';
import { isMechanicEnabled, setMechanicEnabled } from '../../rules/mechanics.js';

function campKeyOf(camp) { return normalizeCampKey(camp, gameState); }
function coordKey(q, r) { return `${q},${r}`; }
function compareValues(left, op, right) {
    if (op === '==') return left === right;
    if (op === '!=') return left !== right;
    if (op === '<') return Number(left) < Number(right);
    if (op === '<=') return Number(left) <= Number(right);
    if (op === '>') return Number(left) > Number(right);
    if (op === '>=') return Number(left) >= Number(right);
    return false;
}

function resolveUnit(id) {
    if (!id) return null;
    return gameState.tiles.find(tile => tile.unit?.id === id)?.unit || null;
}

function groupById(config, id) { return (config.unitGroups || []).find(group => group.id === id) || null; }
function areaById(config, id) { return (config.areas || []).find(area => area.id === id) || null; }
function targetIncludesUnit(config, target, unitId) {
    if (!target || !unitId) return false;
    if (typeof target === 'string') return target === unitId;
    if (target.unit) return target.unit === unitId;
    return !!target.group && (groupById(config, target.group)?.unitIds || []).includes(unitId);
}
function unitsForTarget(config, target) {
    if (!target) return [];
    if (typeof target === 'string') return [resolveUnit(target)].filter(Boolean);
    if (target.unit) return [resolveUnit(target.unit)].filter(Boolean);
    if (target.group) return (groupById(config, target.group)?.unitIds || []).map(resolveUnit).filter(Boolean);
    return [];
}

function readOperand(operand, ctx) {
    if (operand == null || typeof operand !== 'object') return operand;
    const source = operand.source || 'constant';
    if (source === 'constant') return operand.value;
    if (source === 'round') return getRound(gameState);
    if (source === 'gold') return gameState.playerGold[operand.camp] || 0;
    if (source === 'levelVariable') return gameState.levelVariables?.[operand.variable];
    if (source === 'campaignVariable') return gameState.campaignVariables?.[operand.variable];
    if (source === 'event') return ctx.event?.[operand.field];
    if (source === 'unitHp') {
        const unit = resolveUnit(operand.unit);
        if (!unit) return undefined;
        return operand.mode === 'percent' ? unit.hp / unit.maxHp * 100 : unit.hp;
    }
    return undefined;
}

export function spawnUnitsInto(state, specs) {
    const created = [];
    for (const spec of (specs || [])) {
        const tile = state.tileMap.get(coordKey(spec.q, spec.r));
        if (!tile || tile.unit) continue;
        const camp = campFromKey(spec.camp, state);
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

function evalCondition(cond, ctx) {
    if (!cond || typeof cond !== 'object') return false;
    const { api, event, eventId, flags, config, enabled } = ctx;
    switch (cond.kind) {
        case 'all': return Array.isArray(cond.conditions) && cond.conditions.length > 0 && cond.conditions.every(child => evalCondition(child, ctx));
        case 'any': return Array.isArray(cond.conditions) && cond.conditions.length > 0 && cond.conditions.some(child => evalCondition(child, ctx));
        case 'not': return !!cond.condition && !evalCondition(cond.condition, ctx);
        case 'levelStarted': return eventId === 'levelStarted';
        case 'unitSelected': {
            if (eventId !== 'unitSelected') return false;
            if (!targetIncludesUnit(config, cond.target, event?.unitId)) return false;
            if (cond.camp && event?.camp !== cond.camp) return false;
            return true;
        }
        case 'unitMovesToTile':
        case 'unitMovesToArea': {
            if (eventId !== 'unitMoved') return false;
            if (cond.target && !targetIncludesUnit(config, cond.target, event?.unitId)) return false;
            if (cond.camp && event?.camp !== cond.camp) return false;
            // 区域匹配：传入 tiles 数组
            if (cond.tiles) return cond.tiles.some(tile => tile.q === event?.q && tile.r === event?.r);
            // 单格匹配：传入 q, r
            return event?.q === cond.q && event?.r === cond.r;
        }
        case 'unitAttacksUnit': {
            if (eventId !== 'combatStarted') return false;
            if (cond.attacker && !targetIncludesUnit(config, cond.attacker, event?.attackerId)) return false;
            if (cond.attackerCamp && event?.attackerCamp !== cond.attackerCamp) return false;
            if (cond.defender && !targetIncludesUnit(config, cond.defender, event?.defenderId)) return false;
            if (cond.defenderCamp && event?.defenderCamp !== cond.defenderCamp) return false;
            return true;
        }
        case 'unitKilled': {
            if (eventId !== 'unitKilled') return false;
            if (!targetIncludesUnit(config, cond.target, event?.unitId)) return false;
            if (cond.camp && event?.camp !== cond.camp) return false;
            return true;
        }
        case 'cityCaptured': return eventId === 'tileCaptured'
            && event?.q === cond.q && event?.r === cond.r
            && (!cond.camp || event?.newCamp === cond.camp);
        case 'turnStarted': {
            if (eventId !== 'turnStarted') return false;
            // 留空 = 每轮首个阵营回合开始时（新的一轮）
            if (!cond.camp) {
                if (event?.camp !== gameState.turnOrder?.[0]) return false;
            } else if (event?.camp !== cond.camp) return false;
            if (cond.turn != null && cond.turn > 0) {
                const timerId = `turn:${ctx.triggerId}`;
                if (!state._timerStarts) state._timerStarts = {};
                if (!state._timerStarts[timerId]) state._timerStarts[timerId] = getRound(gameState);
                if (state._timerStarts[timerId] === -1) return false;
                if (getRound(gameState) - state._timerStarts[timerId] < Number(cond.turn)) return false;
                state._timerStarts[timerId] = -1;
            }
            return true;
        }
        case 'cardUsed': {
            if (eventId !== 'cardUsed') return false;
            if (event?.cardId !== cond.value) return false;
            if (cond.camp && event?.camp !== cond.camp) return false;
            return true;
        }
        case 'skillUsed': {
            if (eventId !== 'skillUsed') return false;
            if (cond.target && !targetIncludesUnit(config, cond.target, event?.unitId)) return false;
            if (cond.camp && event?.camp !== cond.camp) return false;
            if (cond.skill && event?.skillId !== cond.skill) return false;
            if (cond.skillType && event?.skillType !== cond.skillType) return false;
            if (cond.stacks != null && event?.stacks != null) {
                return compareValues(event.stacks, cond.stackOp || '>=', Number(cond.stacks));
            }
            return true;
        }
        case 'goldCompare': return compareValues(gameState.playerGold[cond.camp] || 0, cond.op || '>=', Number(cond.value));
        case 'variableCompare': {
            const vars = cond.scope === 'campaign' ? gameState.campaignVariables : gameState.levelVariables;
            return compareValues(vars?.[cond.variable], cond.op || '==', cond.value);
        }
        case 'eventNextIs': case 'eventChoiceIs': return eventId === 'advance' && (event?.next === cond.value || event?.choiceId === cond.value);
        case 'eventInteractionIs': return eventId === 'interactionCompleted' && event?.interactableId === cond.interactable;
        case 'timer': {
            const timerId = ctx.triggerId;
            if (!timerId || !cond.value || cond.value <= 0) return false;
            if (!state._timerStarts) state._timerStarts = {};
            if (!state._timerStarts[timerId]) state._timerStarts[timerId] = Date.now();
            // 已触发的计时器不再重复满足
            if (state._timerStarts[timerId] === -1) return false;
            if (Date.now() - state._timerStarts[timerId] >= Number(cond.value)) {
                state._timerStarts[timerId] = -1;  // 标记为已触发
                return true;
            }
            return false;
        }
        case 'unitExists': {
            const u = resolveUnit(cond.unit);
            return cond.alive === false ? !u : !!u;
        }
        case 'unitHpCompare': {
            const unit = resolveUnit(cond.unit);
            if (!unit) return false;
            const value = cond.mode === 'percent' ? unit.hp / unit.maxHp * 100 : unit.hp;
            return compareValues(value, cond.op || '<=', Number(cond.value));
        }
        case 'weatherIs': return gameState.weather === cond.weather;
        case 'relationIs': return getRelation(gameState, cond.camp, cond.targetCamp) === cond.relation;
        case 'objectiveStatusIs': return gameState.objectiveStates?.[cond.objective] === cond.status;
        case 'interactionStateIs': return gameState.interactionStates?.[cond.interactable] === cond.state;
        case 'factionUnitCount': {
            const count = gameState.tiles.filter(tile => tile.unit && campKeyOf(tile.unit.camp) === cond.camp && tile.unit.hp > 0).length;
            return compareValues(count, cond.op || '>=', Number(cond.value));
        }
        case 'groupState': {
            const ids = groupById(config, cond.group)?.unitIds || [];
            const alive = ids.filter(id => resolveUnit(id));
            if (cond.state === 'allDead') return ids.length > 0 && alive.length === 0;
            if (cond.state === 'anyAlive') return alive.length > 0;
            if (cond.state === 'allAlive') return ids.length > 0 && alive.length === ids.length;
            if (cond.state === 'casualty') return ids.length > 0 && alive.length > 0 && alive.length < ids.length;
            return false;
        }
        case 'unitsInArea': {
            const area = areaById(config, cond.area);
            if (!area) return false;
            const keys = new Set((area.tiles || []).map(tile => coordKey(tile.q, tile.r)));
            const count = gameState.tiles.filter(tile => keys.has(coordKey(tile.q, tile.r)) && tile.unit
                && (!cond.camp || campKeyOf(tile.unit.camp) === cond.camp)).length;
            return compareValues(count, cond.op || '>=', Number(cond.value));
        }
        case 'triggerEnabled': return (enabled.get(cond.trigger) !== false) === (cond.enabled !== false);
        case 'mechanicEnabled': return isMechanicEnabled(gameState, cond.mechanic) === (cond.enabled !== false);
        default:
            console.warn(`[campaign] 未知条件「${cond.kind}」，按不满足处理。`);
            return false;
    }
}

function evalAll(conditions, ctx) {
    return !conditions?.length || conditions.every(condition => evalCondition(condition, ctx));
}

export function evaluateConditions(conditions, api, flags, config = {}) {
    return evalAll(conditions, { api, event: {}, eventId: '', flags: flags || new Set(), config, enabled: new Map() });
}

function applyOperation(current, operation, value) {
    if (operation === 'set') return value;
    if (operation === 'add') return Number(current || 0) + Number(value || 0);
    if (operation === 'subtract') return Number(current || 0) - Number(value || 0);
    if (operation === 'multiply') return Number(current || 0) * Number(value || 0);
    if (operation === 'divide') return Number(value) === 0 ? current : Number(current || 0) / Number(value);
    if (operation === 'min') return Math.min(Number(current), Number(value));
    if (operation === 'max') return Math.max(Number(current), Number(value));
    return current;
}

function runAction(action, ctx) {
    if (!action || typeof action !== 'object') return;
    const { api, flags, state, config, dispatch, enabled } = ctx;
    switch (action.kind) {
        case 'showStep':
            if (action.step) api.showStep(action.step, { immediate: !!action.immediate });
            else api.showInlineStep?.(action, { immediate: !!action.immediate });
            break;
        case 'setObjectiveStatus': api.setObjectiveStatus?.(action.objective, action.status); break;
        case 'spawnUnits': spawnUnitsInto(gameState, action.units); updateUI(); break;
        case 'setPhase': gameState.campaignPhase = action.value; break;
        case 'setVariable': {
            const variable = (config.variables || []).find(item => item.id === action.variable);
            const target = variable?.scope === 'campaign' ? gameState.campaignVariables : gameState.levelVariables;
            target[action.variable] = applyOperation(target[action.variable], action.operation || 'set', action.value);
            break;
        }
        case 'setTriggerEnabled': enabled.set(action.trigger, action.enabled !== false); break;
        case 'changeGold': {
            gameState.playerGold[action.camp] = Math.max(0, applyOperation(gameState.playerGold[action.camp] || 0, action.operation || 'add', action.value));
            updateUI(); break;
        }
        case 'changeUnitHp': {
            for (const unit of unitsForTarget(config, action.target || { unit: action.unit })) {
                const amount = action.mode === 'percent' ? unit.maxHp * Number(action.value || 0) / 100 : Number(action.value || 0);
                if (action.operation === 'set') {
                    const delta = amount - unit.hp;
                    if (delta >= 0) unit.heal(delta); else unit.applyDamage(-delta, { source: 'true', minHp: unit._campaignMinHp || 0 });
                } else if (action.operation === 'add') unit.heal(amount);
                else unit.applyDamage(amount, { source: 'true', minHp: unit._campaignMinHp || 0 });
            }
            break;
        }
        case 'changeUnitFaction': {
            const nextCamp = campFromKey(action.camp, gameState);
            for (const unit of unitsForTarget(config, action.target || { unit: action.unit })) unit.camp = nextCamp;
            gameState.campBorderEdges = computeCampBorders(gameState.tiles, gameState.tileMap);
            clearselection(); invalidateBoard(); updateUI(); break;
        }
        case 'setUnitState': for (const unit of unitsForTarget(config, action.target || { unit: action.unit })) {
            if (action.state === 'canAct') unit.canAct = action.value !== false;
            else if (action.state === 'canMove') unit._campaignCanMove = action.value !== false;
            else if (action.state === 'canAttack') unit._campaignCanAttack = action.value !== false;
            else if (action.state === 'selectable') unit._campaignSelectable = action.value !== false;
            else if (action.state === 'targetable') unit._campaignTargetable = action.value !== false;
            else if (action.state === 'invulnerable') unit.godMode = action.value !== false;
            else if (action.state === 'canCounterattack') unit._campaignNoCounter = action.value === false;
        } break;
        case 'applyEffect': for (const unit of unitsForTarget(config, action.target || { unit: action.unit })) {
            if (!Array.isArray(unit._campaignEffects)) unit._campaignEffects = [];
            // 特殊规则（minHp/maxHp/godMode）直接写 unit 属性
            if (action.rule === 'minHp') {
                unit._campaignMinHp = Math.max(0, Math.min(100, Number(action.rulePercent) || 0)) / 100 * unit.maxHp;
            } else if (action.rule === 'maxHp') {
                unit._campaignMaxHp = Math.max(0, Math.min(100, Number(action.rulePercent) || 0)) / 100 * unit.maxHp;
            } else if (action.rule === 'godMode') {
                unit.godMode = true;
            }
            // 常规 statMods 效果存入 effects 数组（用于显示徽章 + 修正面板）
            const mods = action.statMods || {};
            if (Object.keys(mods).length || action.name) {
                const existing = Array.isArray(unit._campaignEffects) ? unit._campaignEffects.find(e => e.id === action.effectId) : null;
                const effect = {
                    id: action.effectId || `effect_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                    name: action.name || '',
                    emoji: action.emoji || '✨',
                    duration: action.duration || 0,
                    statMods: { ...mods }
                };
                if (existing) Object.assign(existing, effect);
                else unit._campaignEffects.push(effect);
            }
            updateUI();
            break;
        }
        case 'setUnitDefeatRule': for (const unit of unitsForTarget(config, action.target || { unit: action.unit })) {
            if (change && change.previous !== change.relation) {
                clearselection(); invalidateBoard(); updateUI();
                emit('match:diplomacyChanged', { ...change, reason: 'trigger' });
            }
            break;
        }
        case 'setWeather':
            if (action.weather === 'cycle') { gameState.weather = 'clear'; gameState.lastWeather = null; }
            else { gameState.lastWeather = gameState.weather; gameState.weather = action.weather; }
            invalidateBoard(); updateUI(); break;
        case 'setInteractionState': gameState.interactionStates[action.interactable] = action.state; break;
        case 'setMechanicEnabled':
            if (setMechanicEnabled(gameState, action.mechanic, action.enabled)) {
                clearselection(); invalidateBoard(); updateUI(); emit('campaign:mechanicsChanged', { mechanic: action.mechanic, enabled: action.enabled !== false });
            }
            break;
        case 'removeUnits': for (const unit of unitsForTarget(config, action.target || { unit: action.unit })) {
            if (action.mode === 'kill') unit.destroy(null); else if (unit.tile) unit.tile.unit = null;
        }
        default: console.warn(`[campaign] 未知效果「${action.kind}」，已跳过。`);
    }
}
function runActions(actions, ctx) {
    let shownFirstStep = false;
    for (const action of (actions || [])) {
        // 同一触发器内有多个内联 showStep 时，只执行第一个（其余由 next 链驱动）
        if (action.kind === 'showStep' && !action.step) {
            if (shownFirstStep) continue;
            shownFirstStep = true;
        }
        runAction(action, ctx);
    }
}

export function createTriggerFlow(config, api) {
    if (!(gameState._campaignFlags instanceof Set)) gameState._campaignFlags = new Set();
    if (!gameState.diplomacy) gameState.diplomacy = createDefaultDiplomacy(config.diplomacy);
    const state = { flags: gameState._campaignFlags, fired: new Set(), timers: new Set(), dispatching: [] };
    const triggers = (config.triggers || []).map((trigger, index) => ({ ...trigger, _id: trigger.id || `trigger_${index}` }));
    const enabled = new Map(triggers.map(trigger => [trigger._id, trigger.enabled !== false]));
    const result = config.result || {};

    // 预注册所有内联 showStep 的 _id，供 next 链查找
    if (!gameState._inlineStepMap) gameState._inlineStepMap = {};
    for (const trigger of triggers) {
        for (const action of (trigger.do || [])) {
            if (action.kind === 'showStep' && action._id) {
                const hasNext = action.next != null && action.next !== '';
                gameState._inlineStepMap[action._id] = {
                    phase: hasNext ? 'dialog' : 'wait',
                    mode: action.mode || 'narrator',
                    text: action.text || '',
                    speaker: action.mode === 'character' && action.speaker ? { name: action.speaker.name, portrait: action.speaker.portrait } : undefined,
                    next: action.next || undefined,
                    highlight: action.highlight,
                    lock: action.lock
                };
            }
        }
    }

    function ctxFor(eventId, event, triggerId = '') {
        return { api, event: event || {}, eventId, flags: state.flags, state, config, dispatch, enabled, triggerId };
    }
    function dispatch(eventId, event = {}) {
        if (!api.isActive() || api.isResultShown()) return;
        if (state.dispatching.length > 32) { console.error('[campaign] 触发器递归超过 32 层，已中止。'); return; }
        state.dispatching.push(eventId);
        try {
            for (const trigger of triggers) {
                if (enabled.get(trigger._id) === false) continue;
                if (trigger.once && state.fired.has(trigger._id)) continue;
                const ctx = ctxFor(eventId, event, trigger._id);
                if (!evalAll(trigger.when, ctx)) continue;
                if (trigger.once) state.fired.add(trigger._id);
                runActions(trigger.do, ctx);
                if (api.isResultShown()) return;
            }
            autoResolve();
        } finally { state.dispatching.pop(); }
    }

    function autoResolve() {
        if (!api.isActive() || api.isResultShown()) return;
        const localPlayerKey = gameState.localPlayerCampKey || 'player1';
        // 玩家被消灭 → 失败
        const hasPlayerUnit = gameState.tiles.some(t => t.unit && campKeyOf(t.unit.camp) === localPlayerKey && t.unit.hp > 0);
        const hasPlayerTile = gameState.tiles.some(t => campKeyOf(t.camp) === localPlayerKey);
        if (!hasPlayerUnit && !hasPlayerTile) { api.fail(result.loseText); return; }
        // 目标状态自动判定（主要目标全部完成→胜利，任一失败→失败）
        const objConfig = config.objectives;
        if (objConfig && typeof objConfig === 'object') {
            const states = gameState.objectiveStates || {};
            const mainIds = Object.keys(objConfig).filter(id => objConfig[id].main && states[id] !== 'hidden');
            if (mainIds.length > 0) {
                if (mainIds.every(id => states[id] === 'completed')) { api.win(); return; }
                if (mainIds.some(id => states[id] === 'failed')) { api.fail(result.loseText); return; }
            }
        }
    }

    function currentAllow() {
        const hl = gameState._inlineStepData?.highlight;
        if (hl) {
            // "all" 后门：允许所有操作
            if (hl.unit === 'all' || hl.tiles === 'all') return { units: ['all'], tiles: ['all'], hint: hl.hint };
            const allow = {};
            if (hl.unit) allow.units = [hl.unit];
            if (hl.tiles) allow.tiles = hl.tiles;
            if (hl.hint) allow.hint = hl.hint;
            return Object.keys(allow).length ? allow : null;
        }
        return null;
    }
    return {
        dispatch,
        onLevelStarted() { dispatch('levelStarted', {}); dispatch('levelStart', {}); },
        onTileSelected({ tile, unit }) { dispatch('tileSelected', { q: tile?.q, r: tile?.r, unitId: unit?.id, camp: campKeyOf(unit?.camp) }); if (unit) dispatch('unitSelected', { unitId: unit.id, camp: campKeyOf(unit.camp) }); },
        onCardUsed({ cardId, targetUnitId, targetTile }) { dispatch('cardUsed', { cardId, targetUnitId, q: targetTile?.q, r: targetTile?.r, camp: campKeyOf(gameState.currentCamp) }); },
        onUnitMoved({ unit, targetTile, fromQ, fromR }) { dispatch('unitMoved', { unitId: unit?.id, camp: campKeyOf(unit?.camp), fromQ, fromR, q: targetTile?.q, r: targetTile?.r }); },
        onSkillUsed({ unit, skillId, skillType, stacks }) { dispatch('skillUsed', { unitId: unit?.id, skillId, skillType, stacks, camp: campKeyOf(unit?.camp) }); },
        onCityCaptured({ cityTile, campKey }) { dispatch('tileCaptured', { q: cityTile?.q, r: cityTile?.r, newCamp: campKey }); },
        onTurnStarted({ camp, campKey }) {
            const key = campKey || campKeyOf(camp);
            if (gameState.campaignMode && key !== campKeyOf(gameState.currentCamp)) return;
            dispatch('turnStarted', { camp: key, round: getRound(gameState) });
        },
        onTurnEnded(event) { dispatch('turnEnded', event); },
        onCombatStarted(event) { dispatch('combatStarted', event); },
        onCombatResolved(event) { dispatch('combatResolved', event); },
        onUnitHpChanged(event) { dispatch('unitHpChanged', event); },
        onUnitKilled(event) {
            dispatch('unitKilled', { ...event, camp: campKeyOf(event.camp), killerCamp: campKeyOf(event.killerCamp) });
        },
        onDiplomacyChanged(event) { dispatch('diplomacyChanged', event); },
        onObjectiveChanged(event) { dispatch('objectiveChanged', event); },
        onInteractionCompleted(event) { dispatch('interactionCompleted', event); },
        onAdvance(next) { dispatch('advance', { next, choiceId: next }); },
        validateCanvasClick(tile) {
            if (!api.isActive() || !gameState.tutorialMode) return true;
            if (tile?.unit?._campaignSelectable === false) { api.showHint('当前单位不可选择'); return false; }
            const allow = currentAllow();
            // 没有选中单位 = 查看信息，始终放行
            if (!gameState.selectedUnit) return true;
            const isAction = gameState.movableTiles?.includes(tile) || gameState.attackableTiles?.includes(tile);
            if (!isAction) return true; // 点击非操作目标 → 放行
            // 有操作点击时：无白名单 = 全部锁定；有白名单 = 只放行白名单内
            if (!allow || (!allow.units && !allow.tiles)) { api.showHint('当前操作已被锁定'); return false; }
            const ok = allow.tiles?.some(p => p.q === tile?.q && p.r === tile?.r)
                || (tile?.unit && allow.units?.includes(tile.unit.id));
            if (!ok) { api.showHint(allow.hint || '请按剧情指引操作'); return false; }
            return true;
        },
        validateCardClick(cardId) {
            if (!api.isActive() || !gameState.tutorialMode) return true;
            const allow = currentAllow();
            if (!allow?.cards) { api.showHint('当前无法使用对策卡'); return false; }
            if (allow.cards.includes(cardId)) return true;
            api.showHint(allow.hint || '当前无法使用这张对策卡'); return false;
        },
        validateAction(actionKey) {
            if (!api.isActive() || !gameState.tutorialMode) return true;
            const allow = currentAllow();
            if (!allow?.actions) { api.showHint('当前操作已被锁定'); return false; }
            if (allow.actions.some(value => actionKey?.startsWith(value))) return true;
            api.showHint(allow.hint || '当前无法发动该技能'); return false;
        },
        dispose() { for (const timer of state.timers) clearTimeout(timer); state.timers.clear(); if (_tickTimer) { clearInterval(_tickTimer); _tickTimer = null; } },
        _flags: state.flags
    };

    // 计时器条件轮询（每 100ms 检查一次，确保 timer 条件及时触发）
    let _tickTimer = setInterval(() => {
        if (!gameState.campaignMode || !api.isActive() || api.isResultShown()) return;
        const now = Date.now();
        const needsTick = triggers.some(t => {
            if (enabled.get(t._id) === false) return false;
            if (t.once && state.fired.has(t._id)) return false;
            return (t.when || []).some(c => c.kind === 'timer');
        });
        if (needsTick) dispatch('_timerTick', {});
    }, 100);
}

export { canAttack };
