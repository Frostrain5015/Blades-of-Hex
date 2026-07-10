import { CAMP } from '../js/config.js';

export const ENGINEER_TRENCH_GOLD_COST = 2;
export const ENGINEER_FLAK_GOLD_COST = 2;
export const ENGINEER_BUNKER_GOLD_COST = 5;
// 碉堡施工需要 1 个己方回合（起始回合工程师锁定），下个己方回合开始时脚手架变为碉堡。
export const ENGINEER_BUNKER_BUILD_TURNS = 1;
// 碉堡建成后进入冷却，冷却期内无法再次建造（不影响挖战壕/架机枪/移动/战斗）。
export const ENGINEER_BUNKER_CD_TURNS = 2;

// 六角距离（仅依赖 q/r，避免依赖 tile.s，测试用桩对象也可复用）。
function hexDistanceQR(a, b) {
    const dq = a.q - b.q;
    const dr = a.r - b.r;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

// 目标是否位于工程师身旁 1 格。
export function isEngineerBunkerAdjacent(engineerUnit, tile) {
    return !!engineerUnit && !!engineerUnit.tile && !!tile
        && hexDistanceQR(engineerUnit.tile, tile) === 1;
}

function campToKey(camp) {
    if (camp === CAMP.player1) return 'player1';
    if (camp === CAMP.player2) return 'player2';
    if (camp === CAMP.player3) return 'player3';
    return 'neutral';
}

function consumeEngineerAction(unit) {
    unit.remainingMP = 0;
    unit.canAct = false;
}

function fail(message) {
    return { ok: false, message };
}

function canActAsEngineer(unit, gameState) {
    return !!unit
        && unit.commander === 'engineer'
        && unit.hp > 0
        && unit.tile
        && unit.camp === gameState.currentCamp
        && unit.canAct
        && !unit.isNewRecruit
        && !unit._engineerConstruction;
}

export function canBuildEngineerBunkerAt(tile) {
    return !!tile && !tile.unit && !tile.isCity && !tile.isVillage;
}

// 目标格综合门禁：原有门禁（空地、非城市、非村庄）+ 身旁 1 格。
export function isEngineerBunkerTargetTile(tile, engineerUnit) {
    return canBuildEngineerBunkerAt(tile) && isEngineerBunkerAdjacent(engineerUnit, tile);
}

export function digEngineerTrench(unit, helpers) {
    const gameState = helpers.gameState;
    if (!canActAsEngineer(unit, gameState)) return fail('工程师当前无法挖掘战壕');

    const tile = unit.tile;
    if (tile.fortification) return fail('该地块已有工事');

    const campKey = campToKey(unit.camp);
    if ((gameState.playerGold[campKey] || 0) < ENGINEER_TRENCH_GOLD_COST) {
        return fail(`金币不足，需要$${ENGINEER_TRENCH_GOLD_COST}`);
    }

    gameState.playerGold[campKey] -= ENGINEER_TRENCH_GOLD_COST;
    tile.fortification = 'trench';
    consumeEngineerAction(unit);
    helpers.logMessage(`${unit.camp.name}工程师在(${tile.q},${tile.r})挖掘了【战壕】（近战防御+25%）`);
    return { ok: true, tile };
}

export function digEngineerFlak(unit, helpers) {
    const gameState = helpers.gameState;
    if (!canActAsEngineer(unit, gameState)) return fail('工程师当前无法架设高射机枪');

    const tile = unit.tile;
    // 与战壕互斥：一格只能存在一种工事
    if (tile.fortification) return fail('该地块已有工事');

    const campKey = campToKey(unit.camp);
    if ((gameState.playerGold[campKey] || 0) < ENGINEER_FLAK_GOLD_COST) {
        return fail(`金币不足，需要$${ENGINEER_FLAK_GOLD_COST}`);
    }

    gameState.playerGold[campKey] -= ENGINEER_FLAK_GOLD_COST;
    tile.fortification = 'flak';
    consumeEngineerAction(unit);
    helpers.logMessage(`${unit.camp.name}工程师在(${tile.q},${tile.r})架设了【高射机枪】（远程防御+25%，自身1层防空）`);
    return { ok: true, tile };
}

// 碉堡满血值（脚手架与建成碉堡共用；脚手架剩余 HP 会被建成碉堡继承）。
export const ENGINEER_BUNKER_HP = 200;

function findUnitById(gameState, id) {
    if (id == null) return null;
    for (const tile of gameState.tiles) {
        if (tile.unit && tile.unit.id === id) return tile.unit;
    }
    return null;
}

function lockEngineer(engineer) {
    if (!engineer) return;
    engineer.remainingMP = 0;
    engineer.canAct = false;
}

export function beginEngineerBunkerConstruction(unit, targetTile, helpers) {
    const gameState = helpers.gameState;
    // canActAsEngineer 已含 !unit._engineerConstruction，保证同时只能修建 1 个碉堡。
    if (!canActAsEngineer(unit, gameState)) return fail('工程师当前无法建造碉堡');
    if ((unit._engineerBunkerCD || 0) > 0) return fail(`建造碉堡冷却中，还需${unit._engineerBunkerCD}回合`);
    if (!canBuildEngineerBunkerAt(targetTile)) return fail('碉堡不能建造在单位、城市或村庄上');
    if (!isEngineerBunkerAdjacent(unit, targetTile)) return fail('只能在工程师身旁1格的地块施工');
    if (typeof helpers.Unit !== 'function') return fail('无法创建施工脚手架');

    const campKey = campToKey(unit.camp);
    if ((gameState.playerGold[campKey] || 0) < ENGINEER_BUNKER_GOLD_COST) {
        return fail(`金币不足，需要$${ENGINEER_BUNKER_GOLD_COST}`);
    }

    gameState.playerGold[campKey] -= ENGINEER_BUNKER_GOLD_COST;

    // 立即在目标格放置一个【脚手架】：建造中，不能攻击，但拥有 HP、可被攻击甚至摧毁。
    const scaffold = new helpers.Unit('mgNest', unit.camp, targetTile, false);
    scaffold.hp = ENGINEER_BUNKER_HP;
    scaffold.maxHp = ENGINEER_BUNKER_HP;
    scaffold.displayHp = ENGINEER_BUNKER_HP;
    scaffold._isImmobile = true;
    scaffold.remainingMP = 0;
    scaffold.canAct = false;
    scaffold._engineerScaffold = {
        builderId: unit.id,
        // 剩余需要跨越的己方回合数；每个己方回合开始时递减，归零时脚手架变为碉堡。
        turnsRemaining: ENGINEER_BUNKER_BUILD_TURNS
    };

    unit._engineerConstruction = {
        scaffoldId: scaffold.id,
        targetQ: targetTile.q,
        targetR: targetTile.r,
        turnsRemaining: ENGINEER_BUNKER_BUILD_TURNS
    };
    consumeEngineerAction(unit);
    helpers.logMessage(`${unit.camp.name}工程师在(${targetTile.q},${targetTile.r})搭起【脚手架】，${ENGINEER_BUNKER_BUILD_TURNS}回合后建成碉堡；施工期间工程师无法行动`);
    return { ok: true, targetTile, scaffold };
}

// 每个己方回合开始时结算施工中的脚手架：递减倒计时，归零则转为可用碉堡（继承剩余 HP）。
// 脚手架若已被摧毁则不在场，其对应工程师的锁定已在 Unit.destroy() 中立即解除。
export function completeEngineerBunkerConstructions(gameState, camp, helpers) {
    const results = [];

    // 先递减本方工程师的建造冷却（先于本回合可能新产生的冷却，避免同回合被扣掉）。
    for (const tile of gameState.tiles) {
        const engineer = tile.unit;
        if (engineer && engineer.commander === 'engineer' && engineer.camp === camp && (engineer._engineerBunkerCD || 0) > 0) {
            engineer._engineerBunkerCD -= 1;
        }
    }

    for (const tile of gameState.tiles) {
        const scaffold = tile.unit;
        if (!scaffold || !scaffold._engineerScaffold || scaffold.camp !== camp) continue;

        const data = scaffold._engineerScaffold;
        const builder = findUnitById(gameState, data.builderId);
        const remainingTurns = (data.turnsRemaining || 1) - 1;

        // 单位回合刷新已把脚手架/工程师的 canAct 复位，这里重新清空确保施工期间都不能行动。
        scaffold.canAct = false;
        scaffold.remainingMP = 0;

        if (remainingTurns > 0) {
            data.turnsRemaining = remainingTurns;
            if (builder && builder._engineerConstruction) {
                builder._engineerConstruction.turnsRemaining = remainingTurns;
                lockEngineer(builder);
            }
            helpers.logMessage(`${camp.name}碉堡仍在施工，还需${remainingTurns}回合建成`);
            results.push({ ok: false, pending: true, scaffold, engineer: builder || null, targetTile: tile });
            continue;
        }

        // 施工完成：脚手架原地转为可用碉堡，继承当前剩余 HP。
        scaffold._engineerScaffold = null;
        scaffold._isImmobile = true;
        scaffold.canAct = false;
        scaffold.remainingMP = 0;
        if (builder && builder._engineerConstruction) builder._engineerConstruction = null;
        // 以建成为起点进入冷却：本回合刚设置，不会被上方递减扣掉。
        if (builder) builder._engineerBunkerCD = ENGINEER_BUNKER_CD_TURNS;
        helpers.logMessage(`${camp.name}工程师在(${tile.q},${tile.r})建成了【碉堡】（继承HP ${Math.max(0, Math.round(scaffold.hp))}/${scaffold.maxHp}）；建造进入${ENGINEER_BUNKER_CD_TURNS}回合冷却`);
        results.push({ ok: true, engineer: builder || null, bunker: scaffold, targetTile: tile });
    }

    // 防御性清理：若脚手架已被以绕过 Unit.destroy 的方式移除（未触发解锁），
    // 则在此解除仍指向不存在脚手架的工程师锁定，避免其被永久锁死。
    for (const tile of gameState.tiles) {
        const engineer = tile.unit;
        if (!engineer || engineer.commander !== 'engineer' || engineer.camp !== camp || !engineer._engineerConstruction) continue;
        const scaffoldId = engineer._engineerConstruction.scaffoldId;
        const scaffold = findUnitById(gameState, scaffoldId);
        if (!scaffold || !scaffold._engineerScaffold) {
            engineer._engineerConstruction = null;
            helpers.logMessage(`${camp.name}工程师的碉堡施工已中断，解除锁定`);
        }
    }
    return results;
}

// 脚手架被摧毁时调用（Unit.destroy）：立即解除对应工程师的施工锁定，不返还金币。
export function releaseEngineerOnScaffoldLost(scaffold, gameState) {
    if (!scaffold || !scaffold._engineerScaffold || !gameState) return null;
    const builder = findUnitById(gameState, scaffold._engineerScaffold.builderId);
    if (builder && builder._engineerConstruction && builder._engineerConstruction.scaffoldId === scaffold.id) {
        builder._engineerConstruction = null;
    }
    return builder;
}

export default {
    id: 'engineer',
    name: '工程师',
    skill: '工事构筑',
    hpBonusPct: 0.30,
    atkBonusPct: 0.15,
    spdBonus: 0,
    desc: '以定向工事（战壕/高射机枪）与延迟碉堡巩固后方防线的防御型将领。',
    skills: [
        {
            name: '挖掘战壕',
            desc: `$${ENGINEER_TRENCH_GOLD_COST} 在自身所在格挖掘永久【战壕】：处于其中的任何单位对**近战**攻击防御+25%。与地形叠加、与高射机枪互斥（一格一种工事）；使用后清空行动力。`,
            type: 'active'
        },
        {
            name: '高射机枪',
            desc: `$${ENGINEER_FLAK_GOLD_COST} 在自身所在格架设永久【高射机枪】：处于其中的任何单位对**远程**攻击防御+25%，遭空军攻击时视为拥有1层防空（仅覆盖自身1格）。与地形叠加、与战壕互斥；使用后清空行动力。`,
            type: 'active'
        },
        {
            name: '建造碉堡',
            desc: `$${ENGINEER_BUNKER_GOLD_COST} 选择身旁1格的空地（非城市、非村庄）施工，立即在该格放置一座🧱【脚手架】：建造中无法攻击，但有${ENGINEER_BUNKER_HP}HP、可被攻击甚至摧毁。施工需${ENGINEER_BUNKER_BUILD_TURNS}个己方回合（期间工程师无法行动、同时只能修建1座），之后脚手架变为【碉堡】并继承剩余HP；建成后进入${ENGINEER_BUNKER_CD_TURNS}回合冷却，冷却期不影响挖战壕/架机枪/移动/战斗。施工中若脚手架被摧毁则金币不返还、工程师立即解锁。`,
            type: 'active'
        }
    ],
    activeSkills: [
        { id: 'trench', name: '挖掘战壕', goldCost: ENGINEER_TRENCH_GOLD_COST },
        { id: 'flak', name: '高射机枪', goldCost: ENGINEER_FLAK_GOLD_COST },
        { id: 'bunker', name: '建造碉堡', goldCost: ENGINEER_BUNKER_GOLD_COST }
    ]
};
