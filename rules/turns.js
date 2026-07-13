// rules/turns.js — 回合计数公共工具（纯函数）。
// turnCounter 每切换一个阵营 +1（步）。1 回合 = 所有阵营各行动一次。
// factionCount 直接来自 turnOrder；颜色和 playerN 席位都不参与推导。

/** 一回合包含的阵营数（步数）。 */
export function getFactionCount(gameState) {
    if (Array.isArray(gameState?.turnOrder) && gameState.turnOrder.length) {
        return gameState.turnOrder.length;
    }
    const factions = gameState?.factions || {};
    const activeCount = Object.values(factions).filter(faction =>
        faction?.active !== false && faction?.participatesInTurns !== false
    ).length;
    return activeCount || 1;
}

/** Runtime turn participants in configured order. Neutral/scripted participants are optional. */
export function getActiveTurnFactionKeys(gameState, { includeNeutral = true } = {}) {
    const factions = gameState?.factions || {};
    const source = Array.isArray(gameState?.turnOrder) && gameState.turnOrder.length
        ? gameState.turnOrder
        : Object.keys(factions);
    return [...new Set(source)].filter(key => {
        const faction = factions[key];
        if (!faction || faction.active === false || faction.participatesInTurns === false) return false;
        return includeNeutral || key !== 'neutral';
    });
}

/**
 * Roll action order independently from seat and faction color. Ties reroll only within
 * the tied group; histories are retained so the reveal UI can show the actual dice.
 */
export function rollFactionTurnOrder(gameState, rng = gameState?.rng) {
    if (!rng?.between) throw new Error('rollFactionTurnOrder requires a deterministic RNG');
    const players = Object.keys(gameState?.factions || {}).filter(key => {
        const faction = gameState.factions[key];
        return key !== 'neutral' && faction?.active !== false && faction?.participatesInTurns !== false;
    });
    const histories = Object.fromEntries(players.map(key => [key, []]));
    let groups = [players];
    for (let round = 0; round < 12 && groups.some(group => group.length > 1); round++) {
        const nextGroups = [];
        for (const group of groups) {
            if (group.length <= 1) {
                nextGroups.push(group);
                continue;
            }
            const byRoll = new Map();
            for (const key of group) {
                const roll = rng.between(1, 6);
                histories[key].push(roll);
                if (!byRoll.has(roll)) byRoll.set(roll, []);
                byRoll.get(roll).push(key);
            }
            for (const roll of [...byRoll.keys()].sort((a, b) => b - a)) nextGroups.push(byRoll.get(roll));
        }
        groups = nextGroups;
    }
    const breakPersistentTie = (group) => {
        const shuffled = [...group];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = rng.between(0, i);
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    };
    const orderedPlayers = groups.flatMap(group => group.length <= 1
        ? group
        : breakPersistentTie(group));
    const scriptedTail = Object.keys(gameState?.factions || {}).filter(key => {
        const faction = gameState.factions[key];
        return key === 'neutral' && faction?.active !== false && faction?.participatesInTurns !== false;
    });
    gameState.turnOrder = [...orderedPlayers, ...scriptedTail];
    gameState.turnOrderRolls = histories;
    return { turnOrder: [...gameState.turnOrder], rolls: histories };
}

/** 当前回合数，0-indexed（用于内部到期比较）。 */
export function getRoundIndex(gameState) {
    return Math.floor(gameState.turnCounter / getFactionCount(gameState));
}

/** 当前回合数，1-indexed（用于 UI/文案/尚书产出等）。 */
export function getRound(gameState) {
    return getRoundIndex(gameState) + 1;
}
