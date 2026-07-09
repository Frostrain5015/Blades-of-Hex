import { CAMP } from '../js/config.js';

export const ENGINEER_TRENCH_GOLD_COST = 3;
export const ENGINEER_BUNKER_GOLD_COST = 6;

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
    helpers.logMessage(`${unit.camp.name}工程师在(${tile.q},${tile.r})挖掘了【战壕】`);
    return { ok: true, tile };
}

export function beginEngineerBunkerConstruction(unit, targetTile, helpers) {
    const gameState = helpers.gameState;
    if (!canActAsEngineer(unit, gameState)) return fail('工程师当前无法建造碉堡');
    if (!canBuildEngineerBunkerAt(targetTile)) return fail('碉堡不能建造在单位、城市或村庄上');

    const campKey = campToKey(unit.camp);
    if ((gameState.playerGold[campKey] || 0) < ENGINEER_BUNKER_GOLD_COST) {
        return fail(`金币不足，需要$${ENGINEER_BUNKER_GOLD_COST}`);
    }

    gameState.playerGold[campKey] -= ENGINEER_BUNKER_GOLD_COST;
    unit._engineerConstruction = {
        targetQ: targetTile.q,
        targetR: targetTile.r
    };
    consumeEngineerAction(unit);
    helpers.logMessage(`${unit.camp.name}工程师开始施工，碉堡将在下个己方回合建成`);
    return { ok: true, targetTile };
}

export function completeEngineerBunkerConstructions(gameState, camp, helpers) {
    const results = [];
    for (const tile of gameState.tiles) {
        const engineer = tile.unit;
        if (!engineer || engineer.commander !== 'engineer' || engineer.camp !== camp || !engineer._engineerConstruction) continue;

        const construction = engineer._engineerConstruction;
        engineer._engineerConstruction = null;
        const targetTile = gameState.tileMap.get(`${construction.targetQ},${construction.targetR}`);
        if (!canBuildEngineerBunkerAt(targetTile)) {
            helpers.logMessage(`${camp.name}工程师施工失败：目标已不可建造，金币不返还`);
            results.push({ ok: false, engineer, targetTile: targetTile || null });
            continue;
        }

        const bunker = new helpers.Unit('mgNest', camp, targetTile, false);
        bunker.hp = 200;
        bunker.maxHp = 200;
        bunker.displayHp = 200;
        bunker._isImmobile = true;
        bunker.remainingMP = 0;
        bunker.canAct = false;
        helpers.logMessage(`${camp.name}工程师在(${targetTile.q},${targetTile.r})建成了【碉堡】`);
        results.push({ ok: true, engineer, bunker, targetTile });
    }
    return results;
}

export default {
    id: 'engineer',
    name: '工程师',
    skill: '工事构筑',
    hpBonusPct: 0.30,
    atkBonusPct: 0.15,
    spdBonus: 0,
    desc: '以永久战壕和延迟碉堡封锁关键地块的防御型将领。',
    skills: [
        {
            name: '挖掘战壕',
            desc: `$${ENGINEER_TRENCH_GOLD_COST} 在自身所在格挖掘永久【战壕】。战壕与原有地形叠加，处于其中的任何单位防御+30%；使用后清空行动力。`,
            type: 'active'
        },
        {
            name: '建造碉堡',
            desc: `$${ENGINEER_BUNKER_GOLD_COST} 选择任意空的非城市、非村庄地块施工。工程师立即耗尽行动力，并于下个己方回合开始时生成一座【碉堡】；若目标失效则施工失败且不退款。`,
            type: 'active'
        }
    ],
    activeSkills: [
        { id: 'trench', name: '挖掘战壕', goldCost: ENGINEER_TRENCH_GOLD_COST },
        { id: 'bunker', name: '建造碉堡', goldCost: ENGINEER_BUNKER_GOLD_COST }
    ]
};
