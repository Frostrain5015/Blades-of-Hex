// 整回合联合束搜索 + 对抗叶子评估（Turn-Level Joint Search）——
// 弥补单步评分“各模块互抢同一笔金币/看不到多步协同终局”的缺陷：
// 在当前回合内对（招募 + 战术卡 + 空降 + 攻击 + 占城机动）做 depth=4、width=5 的联合束展开，
// 严格追踪剩余金币与卡牌次数，并在整回合序列叶子上调用 2-Ply 对抗式 MiniMax 评估敌方最强反扑，
// 输出 <candidateKey, jointBonus> 注入 Hybrid 评分管线。
//
// 严格保持纯前端浏览器可打包（仅依赖 ai/core/* 与 rules/*）。

import { TACTICAL_CARD_DATA } from '../../rules/cards.js';
import { getHistoricalRecruitCost } from '../../rules/cultures.js';
import {
    applyMaxCandidateToSim,
    evaluateMinimaxBoard,
    searchMinReplyWithAlphaBeta,
    snapshotAdversarialState
} from './minimaxSearch.js';

const nowMs = () => globalThis.performance?.now?.() ?? Date.now();

function estimateCandidateCost(state, world, cand) {
    if (!cand) return 0;
    if (cand.actionType === 'recruit') {
        return Number(getHistoricalRecruitCost(state, world.myCamp, cand.unitType) || 8);
    }
    if (cand.actionType === 'tacticalCard') {
        return Number(TACTICAL_CARD_DATA[cand.cardId]?.cost || 0);
    }
    if (cand.actionType === 'drawCard') return Number(cand.drawCost || 4);
    if (cand.actionType === 'airCommand') return Number(cand.cost || 5);
    return 0;
}

export function computeTurnJointRolloutBonuses(state, world, strategy, candidates, {
    preScores = null,
    vetoFlags = null,
    beamWidth = 5,
    maxDepth = 4,
    maxRootBranches = 10,
    timeBudgetMs = 24
} = {}) {
    const bonuses = new Map();
    if (!world || !candidates || candidates.length < 3 || !world.rivalUnits?.length) {
        return bonuses;
    }

    const tStart = nowMs();
    const rootSim = snapshotAdversarialState(state, world);
    const rootGold = Number(world.gold || 0);
    const rootCardUses = Number(world.cardUsesLeft ?? 2);

    const pool = [];
    for (let i = 0; i < candidates.length; i++) {
        if (vetoFlags && vetoFlags[i]) continue;
        const c = candidates[i];
        if (!['attack', 'move', 'recruit', 'tacticalCard', 'droneSuicide', 'banzaiCharge'].includes(c.actionType)) continue;
        const cost = estimateCandidateCost(state, world, c);
        if (cost > rootGold) continue;
        if (c.actionType === 'tacticalCard' && c.cardId !== 'commanderDeploy' && rootCardUses <= 0) continue;
        pool.push({ idx: i, cand: c, cost, pre: preScores ? Number(preScores[i] || 0) : 0 });
    }
    if (pool.length < 2) return bonuses;

    pool.sort((a, b) => b.pre - a.pre);
    const rootPool = pool.slice(0, maxRootBranches);
    const expandPool = pool.slice(0, 14);

    const dummyStats = { nodes: 0, cutoffs: 0 };
    const { val: baselineVal } = searchMinReplyWithAlphaBeta(rootSim, world, strategy, -Infinity, dummyStats);

    let beam = [];
    const bestLeafByRoot = new Map();
    for (const item of rootPool) {
        if (nowMs() - tStart >= timeBudgetMs) break;
        const nextSim = applyMaxCandidateToSim(rootSim, item.cand, world);
        if (!nextSim) continue;
        const boardVal = evaluateMinimaxBoard(nextSim, world, strategy);
        const usedKeys = new Set([item.cand.key]);
        const nextUses = item.cand.actionType === 'tacticalCard' && item.cand.cardId !== 'commanderDeploy'
            ? rootCardUses - 1 : rootCardUses;
        beam.push({
            rootKey: item.cand.key,
            sim: nextSim,
            gold: rootGold - item.cost,
            cardUses: nextUses,
            usedKeys,
            boardVal
        });
        bestLeafByRoot.set(item.cand.key, { sim: nextSim, boardVal });
    }
    if (beam.length === 0) return bonuses;

    for (let depth = 2; depth <= maxDepth; depth++) {
        if (nowMs() - tStart >= timeBudgetMs * 0.65) break;
        beam.sort((a, b) => b.boardVal - a.boardVal);
        const frontier = beam.slice(0, beamWidth);
        const nextBeam = [];
        for (const node of frontier) {
            if (nowMs() - tStart >= timeBudgetMs * 0.65) break;
            let expanded = 0;
            for (const item of expandPool) {
                if (expanded >= 5) break;
                if (node.usedKeys.has(item.cand.key)) continue;
                if (item.cost > node.gold) continue;
                if (item.cand.actionType === 'tacticalCard' && item.cand.cardId !== 'commanderDeploy' && node.cardUses <= 0) continue;
                const nextSim = applyMaxCandidateToSim(node.sim, item.cand, world);
                if (!nextSim) continue;
                expanded++;
                const boardVal = evaluateMinimaxBoard(nextSim, world, strategy);
                const nextUsed = new Set(node.usedKeys);
                nextUsed.add(item.cand.key);
                const nextUses = item.cand.actionType === 'tacticalCard' && item.cand.cardId !== 'commanderDeploy'
                    ? node.cardUses - 1 : node.cardUses;
                nextBeam.push({
                    rootKey: node.rootKey,
                    sim: nextSim,
                    gold: node.gold - item.cost,
                    cardUses: nextUses,
                    usedKeys: nextUsed,
                    boardVal
                });
                const prev = bestLeafByRoot.get(node.rootKey);
                if (!prev || boardVal > prev.boardVal) {
                    bestLeafByRoot.set(node.rootKey, { sim: nextSim, boardVal });
                }
            }
        }
        if (nextBeam.length === 0) break;
        beam = nextBeam;
    }

    // 对每条根分支的最佳整回合叶子运行对抗式 2-Ply 反扑复检
    for (const [rootKey, leaf] of bestLeafByRoot.entries()) {
        if (nowMs() - tStart >= timeBudgetMs) break;
        const { val: advLeafVal } = searchMinReplyWithAlphaBeta(leaf.sim, world, strategy, -Infinity, dummyStats);
        const gain = advLeafVal - baselineVal;
        const bonus = Math.max(-18, Math.min(28, gain * 0.18));
        if (Number.isFinite(bonus) && Math.abs(bonus) >= 1.5) {
            bonuses.set(rootKey, bonus);
        }
    }

    return bonuses;
}
