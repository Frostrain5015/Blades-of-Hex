// 微观行为树（Micro Behavior Trees）—— 规范化管理多步骤强顺序依赖微操链：
// 专精选择、港口修船、空城占领兑现、尚书/重炮腾位招募返城、天眼无人机部署与自爆、
// 联合推进先走位后攻击序列，以及工程师野战工事/碉堡施工决策。
//
// 严格保持纯前端浏览器可打包（仅依赖 rules/* 与 commander/*）。

import { campToKey } from '../../rules/camps.js';
import { canAttack } from '../../rules/diplomacy.js';
import { CONSTRUCTION_CONFIG, hasSameTypeBuildingWithin } from '../../rules/construction.js';
import { canBuildEngineerBunkerAt, ENGINEER_BUNKER_GOLD_COST, ENGINEER_FLAK_GOLD_COST, ENGINEER_TRENCH_GOLD_COST } from '../../commander/engineer.js';
import { getActiveCultureId } from '../../rules/cultures.js';
import { getRound } from '../../rules/turns.js';
import { getUnitBaseType } from '../../rules/units.js';
import { isFieldCapturer, shouldHoldCityPosition } from './roster.js';
import { isHeavyCannonDeployed } from '../../rules/cultures.js';

export const BT_STATUS = Object.freeze({
    SUCCESS: 'SUCCESS',
    FAILURE: 'FAILURE',
    RUNNING: 'RUNNING'
});

export function Condition(name, predicate) {
    return {
        kind: 'condition',
        name,
        tick(ctx) {
            return predicate(ctx) ? BT_STATUS.SUCCESS : BT_STATUS.FAILURE;
        }
    };
}

export function Action(name, runner) {
    return {
        kind: 'action',
        name,
        tick(ctx) {
            return runner(ctx) || BT_STATUS.FAILURE;
        }
    };
}

export function Sequence(name, children) {
    return {
        kind: 'sequence',
        name,
        children,
        tick(ctx) {
            for (const child of children) {
                const status = child.tick(ctx);
                if (status !== BT_STATUS.SUCCESS) return status;
            }
            return BT_STATUS.SUCCESS;
        }
    };
}

export function Selector(name, children) {
    return {
        kind: 'selector',
        name,
        children,
        tick(ctx) {
            for (const child of children) {
                const status = child.tick(ctx);
                if (status !== BT_STATUS.FAILURE) return status;
            }
            return BT_STATUS.FAILURE;
        }
    };
}

function plannedActionKey(action, state) {
    if (!action) return null;
    if (action.type === 'move') return `move:${action.unitId}:${action.tileQ},${action.tileR}`;
    if (action.type === 'attack') return `attack:${action.unitId}:${action.targetId}`;
    if (action.type === 'siegeCityAttack') return `attackCity:${action.unitId}:${action.tileQ},${action.tileR}`;
    if (action.type === 'recruit') return `recruit:${action.unitType}:${action.tileQ},${action.tileR}`;
    if (action.type === 'reinforce') return `reinforce:${action.unitId}`;
    if (action.type === 'repairShip') return `repairShip:${action.unitId}`;
    if (action.type === 'heavyCannonStance') return `heavyCannonStance:${action.unitId}`;
    if (action.type === 'guerrillaConcealment') return `conceal:${action.unitId}`;
    if (action.type === 'activateSkill') return `skill:${action.unitId}:${action.skillId || ''}`;
    if (action.type === 'banzaiCharge') return `banzaiCharge:${action.unitId}:${action.targetQ},${action.targetR}`;
    if (action.type === 'droneDeploy') return `droneDeploy:${action.unitId}:${action.tileQ},${action.tileR}`;
    if (action.type === 'droneSuicide') {
        const target = state.tiles?.find(t => t.unit?.id === action.targetId);
        return target ? `droneSuicide:${action.unitId}:${target.q},${target.r}` : null;
    }
    if (action.type === 'tacticalCard') {
        let q = action.tileQ;
        let r = action.tileR;
        if (q === undefined && action.targetId) {
            const tile = state.tiles?.find(t => t.unit?.id === action.targetId || t.id === action.targetId);
            q = tile?.q;
            r = tile?.r;
        }
        return (q !== undefined && r !== undefined)
            ? `card:${action.cardId}:${action.commanderId || ''}:${q},${r}`
            : null;
    }
    if (action.type === 'drawCard') return 'drawCard';
    return null;
}

function pickPlannedStep(ctx, predicate) {
    for (const act of ctx.imperatorPlan || []) {
        if (!predicate(act)) continue;
        const key = plannedActionKey(act, ctx.state);
        if (key && ctx.candidateByKey.has(key)) {
            ctx.result = {
                candidate: ctx.candidateByKey.get(key),
                plannedAct: act
            };
            return BT_STATUS.SUCCESS;
        }
    }
    return BT_STATUS.FAILURE;
}

/**
 * 构建并缓存微观行为树：将强依赖原子序列封装为可测试、可扩展的标准节点树。
 */
export const SPECIALIST_MICRO_TREE = Selector('SpecialistMicroRoot', [
    Action('SpecializationUpgrade', ctx => pickPlannedStep(ctx, act => act.type === 'chooseSpecialization')),

    Action('PortShipRepair', ctx => pickPlannedStep(ctx, act => act.type === 'repairShip')),

    // 空城即时兑现：只要存在 0HP 敌方/中立空城，非死守突击单位必须优先踏入，不被旁路换血打断。
    Action('OpenCityCapture', ctx => {
        for (const cand of ctx.candidates || []) {
            if (cand.actionType !== 'move') continue;
            const tile = ctx.state.tileMap?.get(`${cand.q},${cand.r}`);
            if (!tile || !tile.isCity || tile.unit || Number(tile.hp || 0) > 0) continue;
            if (!canAttack(ctx.state, ctx.camp, tile.camp)) continue;
            const unit = ctx.unitById.get(cand.unitId);
            if (!unit || !ctx.world || !isFieldCapturer(ctx.world, unit)) continue;
            if (shouldHoldCityPosition(ctx.world, unit, ctx.assignment?.get?.(unit.id))) continue;
            ctx.result = {
                candidate: cand,
                plannedAct: { type: 'move', unitId: unit.id, tileQ: tile.q, tileR: tile.r, captureCity: true, autoAttack: false }
            };
            return BT_STATUS.SUCCESS;
        }
        return BT_STATUS.FAILURE;
    }),

    // 城池腾位原子链：收起架设巨炮 -> 腾出堵城单位 -> 立即招募（含尚书返城）。
    Selector('CityVacateRecruitChain', [
        Action('UnpackBlockingCannon', ctx => pickPlannedStep(ctx, act => act.type === 'heavyCannonStance')),
        Action('VacateCityForRecruit', ctx => pickPlannedStep(ctx, act => {
            if (act.type !== 'move') return false;
            if (act.returnToCity) return true;
            const unit = ctx.unitById.get(act.unitId);
            const curTile = unit?.tile;
            if (!curTile?.isCity || curTile.camp !== ctx.camp) return false;
            return (ctx.imperatorPlan || []).some(other =>
                other.type === 'recruit' && other.tileQ === curTile.q && other.tileR === curTile.r);
        })),
        Action('RecruitInVacatedOrMinisterCity', ctx => pickPlannedStep(ctx, act => {
            if (act.type !== 'recruit') return false;
            const mr = ctx.ministerReturn;
            if (mr && mr.vacatedRound === ctx.round && act.tileQ === mr.cityQ && act.tileR === mr.cityR) return true;
            return false;
        })),
        Action('ReturnMinisterToCity', ctx => pickPlannedStep(ctx, act => {
            const mr = ctx.ministerReturn;
            if (!mr || mr.vacatedRound >= ctx.round || act.type !== 'move') return false;
            return (act.unitId === mr.unitId && act.tileQ === mr.cityQ && act.tileR === mr.cityR)
                || ctx.state.tileMap?.get(`${mr.cityQ},${mr.cityR}`)?.unit?.id === act.unitId;
        }))
    ]),

    // 天眼无人机链：先兑现自爆斩杀/高价损毁，再按预算安全部署前哨机。
    Selector('TianyanDroneChain', [
        Action('DroneDeploy', ctx => pickPlannedStep(ctx, act => act.type === 'droneDeploy'))
    ]),

    // 联合推进序列：Imperator 首步为先跑位后攻击/破门的协调移动时，锁定先移动避免就地乱砍。
    Action('CombinedArmsMoveFirst', ctx => {
        const first = ctx.imperatorPlan?.[0];
        if (first?.type !== 'move') return BT_STATUS.FAILURE;
        const k0 = plannedActionKey(first, ctx.state);
        const match0 = k0 ? ctx.candidateByKey.get(k0) : null;
        if (match0 && (ctx.imperatorPlan || []).some(a => a.type === 'attack')
            && (ctx.candidates || []).some(c => c.actionType === 'attack' && c.unitId === first.unitId)) {
            ctx.result = { candidate: match0, plannedAct: first };
            return BT_STATUS.SUCCESS;
        }
        return BT_STATUS.FAILURE;
    })
]);

/**
 * 在混合决策器前评估微观行为树，返回命中的原子动作及命中节点名。
 */
export function evaluateMicroBehaviorTree({
    state,
    camp,
    world = null,
    imperatorPlan = [],
    candidates = [],
    assignment = null
}) {
    const campKey = campToKey(camp);
    const ministerReturn = state?._aiCoreMemory?.[campKey]?.ministerReturn || null;
    const candidateByKey = new Map(candidates.map(c => [c.key, c]));
    const unitById = new Map();
    for (const tile of state?.tiles || []) {
        if (tile?.unit && tile.unit.camp === camp && tile.unit.hp > 0) {
            unitById.set(tile.unit.id, tile.unit);
        }
    }
    const ctx = {
        state,
        camp,
        campKey,
        round: getRound(state),
        world,
        imperatorPlan,
        candidates,
        candidateByKey,
        unitById,
        assignment,
        ministerReturn,
        result: null,
        matchedNode: null
    };

    for (const child of SPECIALIST_MICRO_TREE.children) {
        const status = child.tick(ctx);
        if (status === BT_STATUS.SUCCESS && ctx.result) {
            ctx.matchedNode = child.name;
            return {
                node: child.name,
                candidate: ctx.result.candidate,
                plannedAct: ctx.result.plannedAct
            };
        }
    }
    return null;
}

/**
 * 工程师微操行为树（后地面阶段调用）：在工程师未投入致命夺城且仍有行动点时，
 * 按「威胁防空/战壕 -> 关键据点筑堑 -> 安全前沿建造碉堡」决策工事建造，避免白白闲置。
 */
export function selectEngineerFortificationAction(gameState, aiCamp, {
    reserveGold = 0,
    isKnownTile = () => true,
    isVisibleUnit = () => true,
    hexDistance
}) {
    if (!gameState || !aiCamp || typeof hexDistance !== 'function') return null;
    const campKey = campToKey(aiCamp);
    const engineer = (gameState.tiles || [])
        .map(t => t?.unit)
        .find(u => u && u.camp === aiCamp && u.commander === 'engineer' && u.hp > 0
            && u.canAct && !u.isNewRecruit && !u._engineerConstruction
            && !isHeavyCannonDeployed(u) && u.tile && !String(u.tile.surface || '').includes('Water'));
    if (!engineer) return null;

    const gold = Number(gameState.playerGold?.[campKey] || 0);
    const hostiles = (gameState.tiles || [])
        .filter(t => t?.unit && t.unit.hp > 0 && canAttack(gameState, aiCamp, t.unit.camp)
            && t.unit.camp?.id !== 'neutral' && isKnownTile(t) && isVisibleUnit(t.unit));

    const rangedOrAirThreat = hostiles.some(t =>
        (hexDistance(engineer.tile, t) <= 3 && ['archer', 'mgNest', 'shoreBattery'].includes(getUnitBaseType(t.unit)))
        || t.unit.commander === 'colonel' || t.unit._isDrone)
        || (gameState.tiles || []).some(t => t.isCity && t.camp?.id !== campKey && t.camp?.id !== 'neutral'
            && t.installation?.status === 'ready' && isKnownTile(t));

    // 1. 先检查身处重要地块或前沿阵地且尚未修筑野战工事
    if (!engineer.tile.fortification && (engineer.tile.isCity || engineer.tile.isVillage
        || hostiles.some(t => hexDistance(engineer.tile, t) <= 3))) {
        if (rangedOrAirThreat && gold >= ENGINEER_FLAK_GOLD_COST && (gold - ENGINEER_FLAK_GOLD_COST >= reserveGold * 0.5 || engineer.tile.isCity)) {
            return { type: 'engineerFlak', unitId: engineer.id };
        }
        if (gold >= ENGINEER_TRENCH_GOLD_COST && (gold - ENGINEER_TRENCH_GOLD_COST >= reserveGold * 0.5 || engineer.tile.isCity)) {
            return { type: 'engineerTrench', unitId: engineer.id };
        }
    }

    // 2. 前线碉堡脚手架：金币充足且不挤占紧急招兵/文化特种兵底线时，优先在贴近敌军的前沿格立碉堡
    if ((engineer._engineerBunkerCD || 0) <= 0
        && gold - ENGINEER_BUNKER_GOLD_COST >= Math.max(2, reserveGold)
        && hostiles.length > 0) {
        const candidates = (gameState.tiles || []).filter(tile =>
            tile && canBuildEngineerBunkerAt(tile, gameState)
            && !String(tile.surface || '').includes('Water')
            && tile.terrain !== 'mountain'
            && hexDistance(engineer.tile, tile) === 1
            && isKnownTile(tile)
            && !hasSameTypeBuildingWithin(gameState, tile, 'mgNest', engineer.camp));
        if (candidates.length > 0) {
            candidates.sort((a, b) => {
                const da = Math.min(...hostiles.map(h => hexDistance(a, h)));
                const db = Math.min(...hostiles.map(h => hexDistance(b, h)));
                return da - db;
            });
            const best = candidates[0];
            const minEnemyDist = Math.min(...hostiles.map(h => hexDistance(best, h)));
            if (minEnemyDist <= 5) {
                return { type: 'engineerBunker', unitId: engineer.id, tileQ: best.q, tileR: best.r };
            }
        }
    }

    return null;
}

/**
 * 统计候选动作周围的多单位协同与交叉火力特征（供行为树/评分器/策略网络复用）。
 */
export function evaluateTacticalGeometry(tile, unit, world) {
    if (!tile || !world) return { flankAllies: 0, coverScore: 0, threatenedBy: 0 };
    let flankAllies = 0;
    for (const ally of world.myUnits || []) {
        if (!ally?.tile || ally.id === unit?.id) continue;
        if (world.helpers.hexDistance(ally.tile, tile) === 1) flankAllies++;
    }
    const fort = tile.fortification === 'trench' ? 1 : tile.fortification === 'flak' ? 0.8 : 0;
    const terrain = tile.terrain === 'forest' ? 0.7 : tile.terrain === 'mountain' ? 0.9 : tile.isCity ? 1.0 : 0;
    return {
        flankAllies,
        coverScore: fort + terrain,
        threatenedBy: world.threatAt ? world.threatAt(tile, unit) : 0
    };
}
