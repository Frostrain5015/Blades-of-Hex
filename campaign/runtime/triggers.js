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

function campKeyOf(camp) { return normalizeCampKey(camp); }
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
        const camp = campFromKey(spec.camp);
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
    const { api, event, flags, config, enabled } = ctx;
    switch (cond.kind) {
        case 'all': return Array.isArray(cond.conditions) && cond.conditions.length > 0 && cond.conditions.every(child => evalCondition(child, ctx));
        case 'any': return Array.isArray(cond.conditions) && cond.conditions.length > 0 && cond.conditions.some(child => evalCondition(child, ctx));
        case 'not': return !!cond.condition && !evalCondition(cond.condition, ctx);
        case 'compare': return compareValues(readOperand(cond.left, ctx), cond.op || '==', readOperand(cond.right, ctx));
        case 'stepIs': return api.getStepId() === cond.value;
        case 'phaseIs': return gameState.campaignPhase === cond.value;
        case 'eventUnitIs': return [event?.unitId, event?.attackerId, event?.defenderId, event?.killerId, event?.sourceUnitId].includes(cond.unit);
        case 'eventCardIs': return event?.cardId === cond.value;
        case 'eventCampIs': return [event?.camp, event?.attackerCamp, event?.defenderCamp, event?.killerCamp, event?.newCamp, event?.oldCamp].map(campKeyOf).includes(cond.value);
        case 'eventNextIs': case 'eventChoiceIs': return event?.next === cond.value || event?.choiceId === cond.value;
        case 'eventTileIs': return event?.q === cond.q && event?.r === cond.r;
        case 'eventInteractionIs': return event?.interactableId === cond.interactable;
        case 'eventSignalIs': return event?.signal === cond.value;
        case 'unitAlive': return !!resolveUnit(cond.unit);
        case 'unitDead': return !resolveUnit(cond.unit);
        case 'unitExists': return cond.alive === false ? !resolveUnit(cond.unit) : !!resolveUnit(cond.unit);
        case 'unitHpCompare': {
            const unit = resolveUnit(cond.unit);
            if (!unit) return false;
            const value = cond.mode === 'percent' ? unit.hp / unit.maxHp * 100 : unit.hp;
            return compareValues(value, cond.op || '<=', Number(cond.value));
        }
        case 'cityOwnedBy': case 'tileOwnedBy': {
            const tile = gameState.tileMap.get(coordKey(cond.q, cond.r));
            return !!tile && campKeyOf(tile.camp) === cond.camp;
        }
        case 'turnAtLeast': return getRound(gameState) >= (cond.value || 0);
        case 'flagSet': return flags.has(cond.value);
        case 'flagUnset': return !flags.has(cond.value);
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
        case 'triggerEnabled': return enabled.get(cond.trigger) !== false;
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
    return evalAll(conditions, { api, event: {}, flags: flags || new Set(), config, enabled: new Map() });
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
        case 'showStep': api.showStep(action.step, { immediate: !!action.immediate }); break;
        case 'setObjective': api.setActiveObjective?.(action.objective); break;
        case 'setOptional': api.setObjectiveStatus?.(action.id, 'completed'); flags.add(`optional:${action.id}`); break;
        case 'setObjectiveStatus': api.setObjectiveStatus?.(action.objective, action.status); break;
        case 'spawnUnits': spawnUnitsInto(gameState, action.units); updateUI(); break;
        case 'setFlag': flags.add(action.value); break;
        case 'clearFlag': flags.delete(action.value); break;
        case 'setPhase': gameState.campaignPhase = action.value; break;
        case 'setVariable': {
            const variable = (config.variables || []).find(item => item.id === action.variable);
            const target = variable?.scope === 'campaign' ? gameState.campaignVariables : gameState.levelVariables;
            target[action.variable] = applyOperation(target[action.variable], action.operation || 'set', action.value);
            break;
        }
        case 'setTriggerEnabled': enabled.set(action.trigger, action.enabled !== false); break;
        case 'emitSignal': dispatch('triggerSignal', { signal: action.value, payload: action.payload }); break;
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
            const nextCamp = campFromKey(action.camp);
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
        } break;
        case 'setUnitDefeatRule': for (const unit of unitsForTarget(config, action.target || { unit: action.unit })) {
            unit._campaignMinHp = Math.max(0, Number(action.minHp) || 0);
            unit._campaignNonLethal = !!action.nonLethal;
            unit._campaignFailOnDeath = !!action.failOnDeath;
        } break;
        case 'setDiplomacy': {
            const change = setRelation(gameState, action.camp, action.targetCamp, action.relation);
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
        } invalidateBoard(); break;
        case 'hideGuidance': api.hideGuidance(); break;
        case 'unlockInput': gameState.tutorialMode = false; gameState.tutorialStep = ''; api.hideGuidance(); break;
        case 'log': if (action.text) logMessage(action.text); break;
        case 'win': api.win(); break;
        case 'fail': api.fail(action.text || ''); break;
        case 'endScenario': action.result === 'lose' ? api.fail(action.reason || '') : api.win(action.ending || ''); break;
        case 'delay': {
            const timer = setTimeout(() => {
                if (api.isActive() && !api.isResultShown() && (!ctx.triggerId || enabled.get(ctx.triggerId) !== false)) runActions(action.then, ctx);
            }, Math.max(0, action.ms || 0));
            state.timers.add(timer); break;
        }
        default: console.warn(`[campaign] 未知效果「${action.kind}」，已跳过。`);
    }
}
function runActions(actions, ctx) { for (const action of (actions || [])) runAction(action, ctx); }

export function createTriggerFlow(config, api) {
    if (!(gameState._campaignFlags instanceof Set)) gameState._campaignFlags = new Set();
    if (!gameState.diplomacy) gameState.diplomacy = createDefaultDiplomacy(config.diplomacy);
    const state = { flags: gameState._campaignFlags, fired: new Set(), timers: new Set(), dispatching: [] };
    const triggers = (config.triggers || []).map((trigger, index) => ({ ...trigger, _id: trigger.id || `trigger_${index}` }));
    const enabled = new Map(triggers.map(trigger => [trigger._id, trigger.enabled !== false]));
    const result = config.result || {};

    function ctxFor(event, triggerId = '') { return { api, event: event || {}, flags: state.flags, state, config, dispatch, enabled, triggerId }; }
    function dispatch(eventId, event = {}) {
        if (!api.isActive() || api.isResultShown()) return;
        if (state.dispatching.length > 32) { console.error('[campaign] 触发器递归超过 32 层，已中止。'); return; }
        state.dispatching.push(eventId);
        try {
            for (const trigger of triggers) {
                if (enabled.get(trigger._id) === false) continue;
                if (trigger.once && state.fired.has(trigger._id)) continue;
                const ctx = ctxFor(event, trigger._id);
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
            const mainIds = Object.keys(objConfig).filter(id => objConfig[id].main);
            if (mainIds.length > 0) {
                const states = gameState.objectiveStates || {};
                if (mainIds.every(id => states[id] === 'completed')) { api.win(); return; }
                if (mainIds.some(id => states[id] === 'failed')) { api.fail(result.loseText); return; }
            }
        }
    }

    function currentAllow() { return config.steps?.[api.getStepId()]?.allow || null; }
    return {
        dispatch,
        onLevelStarted() { dispatch('levelStarted', {}); dispatch('levelStart', {}); },
        onTileSelected({ tile, unit }) { dispatch('tileSelected', { q: tile?.q, r: tile?.r, unitId: unit?.id, camp: campKeyOf(unit?.camp) }); if (unit) dispatch('unitSelected', { unitId: unit.id, camp: campKeyOf(unit.camp) }); },
        onCardUsed({ cardId, targetUnitId, targetTile }) { dispatch('cardUsed', { cardId, targetUnitId, q: targetTile?.q, r: targetTile?.r }); },
        onUnitMoved({ unit, targetTile, fromQ, fromR }) { dispatch('unitMoved', { unitId: unit?.id, camp: campKeyOf(unit?.camp), fromQ, fromR, q: targetTile?.q, r: targetTile?.r }); },
        onSkillUsed({ unit, skillId }) { dispatch('skillUsed', { unitId: unit?.id, skillId, camp: campKeyOf(unit?.camp) }); },
        onCityCaptured({ cityTile, campKey }) { dispatch('tileCaptured', { q: cityTile?.q, r: cityTile?.r, newCamp: campKey }); },
        onTurnStarted({ camp, campKey }) { dispatch('turnStarted', { camp: campKey || campKeyOf(camp), round: getRound(gameState) }); },
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
            if (!allow || (!allow.units && !allow.tiles)) return true;
            if (allow.units?.includes(tile?.unit?.id) || allow.tiles?.some(point => point.q === tile?.q && point.r === tile?.r)) return true;
            api.showHint(allow.hint || '请按剧情指引操作'); return false;
        },
        validateCardClick(cardId) { const allow = currentAllow(); if (!api.isActive() || !gameState.tutorialMode || !allow?.cards || allow.cards.includes(cardId)) return true; api.showHint(allow.hint || '当前无法使用这张对策卡'); return false; },
        validateAction(actionKey) { const allow = currentAllow(); if (!api.isActive() || !gameState.tutorialMode || !allow?.actions || allow.actions.some(value => actionKey?.startsWith(value))) return true; api.showHint(allow.hint || '当前无法发动该技能'); return false; },
        dispose() { for (const timer of state.timers) clearTimeout(timer); state.timers.clear(); },
        _flags: state.flags
    };
}

export { canAttack };
