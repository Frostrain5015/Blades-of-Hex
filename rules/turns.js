// rules/turns.js — 回合计数公共工具（纯函数）。
// turnCounter 每切换一个阵营 +1（步）。1 回合 = 所有阵营各行动一次。
// factionCount 含中立：双人 3、三人 4。

/** 一回合包含的阵营数（步数）。 */
export function getFactionCount(gameState) {
    if (gameState?.campaignMode && Array.isArray(gameState.turnOrder) && gameState.turnOrder.length) {
        return gameState.turnOrder.length;
    }
    return gameState.isThreePlayer ? 4 : 3;
}

/** 当前回合数，0-indexed（用于内部到期比较）。 */
export function getRoundIndex(gameState) {
    return Math.floor(gameState.turnCounter / getFactionCount(gameState));
}

/** 当前回合数，1-indexed（用于 UI/文案/尚书产出等）。 */
export function getRound(gameState) {
    return getRoundIndex(gameState) + 1;
}
