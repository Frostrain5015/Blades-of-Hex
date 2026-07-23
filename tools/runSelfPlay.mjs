// AI 自对局。逻辑层复用浏览器同一套 gameLogic / Unit 与按难度分档的人格脚本
// （Optio / Legatus / Imperator），仅按比例压缩表现计时；
// 同时输出轻量复盘索引与完整审计日志。

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { getAiDifficultyProfile } from '../ai/difficulty.js';
import { normalizeStandardMapFamilyId } from '../rules/standardMaps.js';

function readArgs(argv) {
    const values = {};
    for (const token of argv) {
        if (!token.startsWith('--')) continue;
        const [key, ...rest] = token.slice(2).split('=');
        values[key] = rest.length ? rest.join('=') : true;
    }
    return values;
}

function numberArg(value, fallback, { min = -Infinity, max = Infinity } = {}) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

const args = readArgs(process.argv.slice(2));
const seed = args.seed || `selfplay-${new Date().toISOString().slice(0, 10)}`;
const maxRounds = Math.round(numberArg(args['max-rounds'], 25, { min: 1, max: 100 }));
const timeScale = numberArg(args['time-scale'], 0.02, { min: 0.001, max: 1 });
const requestedDifficulties = typeof args.difficulties === 'string'
    ? args.difficulties.split(',').map(value => value.trim()).filter(Boolean)
    : [];
const defaultDifficulty = getAiDifficultyProfile(args.difficulty ?? 'easy');
const requestedStandardMapId = typeof args.map === 'string' ? args.map : 'crown-ring';
const standardMapId = normalizeStandardMapFamilyId(requestedStandardMapId);
const fogOfWar = args.fog === true || args.fog === 'true' || args.fog === '1';
const playerCount = Math.round(numberArg(args.players, /-3p$/i.test(requestedStandardMapId) ? 3 : 2, { min: 2, max: 3 }));
const doubleCommander = args['double-commander'] === true
    || args['double-commander'] === 'true'
    || args['double-commander'] === '1';

// 必须在加载引擎前安装，确保 AI 展示等待与卡牌延迟结算按相同比例缩放。
const nativeSetTimeout = globalThis.setTimeout.bind(globalThis);
globalThis.setTimeout = (callback, ms = 0, ...rest) => nativeSetTimeout(
    callback,
    Math.max(0, Math.round(Number(ms || 0) * timeScale)),
    ...rest
);

const [{ engine }, ai, commanders, recorder, camps, turns] = await Promise.all([
    import('../core/headless.js'),
    import('../js/ai.js'),
    import('../commander/index.js'),
    import('../js/matchRecorder.js'),
    import('../rules/camps.js'),
    import('../rules/turns.js')
]);

engine.resetGameState();
engine.seedMatchRng(seed);
const playerKeys = Array.from({ length: playerCount }, (_, index) => `player${index + 1}`);
const difficultyProfiles = Object.fromEntries(playerKeys.map((key, index) => [
    key,
    getAiDifficultyProfile(requestedDifficulties[index] ?? defaultDifficulty.id)
]));
engine.configureSkirmishState({
    playerCount,
    controllers: Object.fromEntries(playerKeys.map(key => [key, 'ai']))
});

const state = engine.gameState;
state.gameMode = 'selfplay';
state.standardMapId = standardMapId;
state.skirmishFog = fogOfWar;
state.aiDifficulty = defaultDifficulty.numericValue;
state.aiDifficultyId = defaultDifficulty.id;
state.aiDifficultyByCamp = Object.fromEntries(
    Object.entries(difficultyProfiles).map(([key, profile]) => [key, profile.id])
);
state.aiOpponentCamp = null;
state.commanderPhase = 'done';
state.doubleCommanderMode = doubleCommander;

const candidatesPerPlayer = doubleCommander ? 5 : 3;
const pools = commanders.shuffleAndSplitPool(playerCount === 3, candidatesPerPlayer, state.rng);
const selectedCommanders = {};
for (let index = 0; index < playerCount; index++) {
    const seat = index + 1;
    const campKey = `player${seat}`;
    const suffix = `P${seat}`;
    const pool = pools[`p${seat}`] || [];
    state[`commanderPool${suffix}`] = pool;
    const suggestedPair = doubleCommander ? ai.aiSelectCommanderPair(pool) : [ai.aiSelectCommander(pool)];
    const primaryArg = args[`commander-p${seat}`];
    const primary = typeof primaryArg === 'string' ? primaryArg : suggestedPair[0];
    const incompatible = primary === 'colonel' ? 'diplomat' : primary === 'diplomat' ? 'colonel' : null;
    const secondaryPool = pool.filter(id => id !== primary && id !== incompatible);
    const secondaryArg = args[`commander-p${seat}-secondary`];
    const secondary = doubleCommander
        ? (typeof secondaryArg === 'string'
            ? secondaryArg
            : (suggestedPair.find(id => id !== primary && id !== incompatible) || ai.aiSelectCommander(secondaryPool)))
        : null;
    for (const commanderId of [primary, secondary].filter(Boolean)) {
        if (!commanders.allCommanders[commanderId]) throw new Error(`未知将领: ${commanderId}`);
    }
    if (secondary && secondary === primary) throw new Error(`${campKey} 的两名将领不能重复`);
    state[`commander${suffix}`] = primary;
    state[`commander${suffix}Secondary`] = secondary;
    state[`commander${suffix}Confirmed`] = true;
    state[`commander${suffix}SecondaryConfirmed`] = !!secondary;
    selectedCommanders[campKey] = [primary, secondary].filter(Boolean);
}

engine.initMap();
const matchId = `selfplay-${String(seed).replace(/[^a-z0-9_-]+/gi, '-').slice(0, 48)}-${Date.now().toString(36)}`;
recorder.startMatchRecording(state, {
    matchId,
    automation: {
        runner: 'tools/runSelfPlay.mjs',
        playerPersonalities: Object.fromEntries(
            Object.entries(difficultyProfiles).map(([key, profile]) => [
                key,
                ai.resolveAiPersonality(profile).meta.name
            ])
        ),
        playerDifficulties: Object.fromEntries(
            Object.entries(difficultyProfiles).map(([key, profile]) => [key, profile.id])
        ),
        neutralPersonality: 'Claude',
        seed: String(seed),
        timeScale,
        maxRounds,
        playerCount,
        doubleCommander
    }
});

const restoreAiRuntime = ai.configureAiRuntime({
    delayScale: 1,
    actionTimeoutMs: 30000
});

let turnsProcessed = 0;
try {
    while (!state.gameOver && turns.getRound(state) <= maxRounds) {
        const campKey = camps.campToKey(state.currentCamp);
        if (campKey === 'neutral') await ai.processNeutralTurn();
        else {
            const profile = difficultyProfiles[campKey] || defaultDifficulty;
            state.aiDifficulty = profile.numericValue;
            state.aiDifficultyId = profile.id;
            await ai.processOpponentTurn(state.currentCamp);
        }
        turnsProcessed++;
        if (!state.gameOver) await engine.advanceAutomatedTurn();
    }
} finally {
    restoreAiRuntime();
}

// 卡牌烧牌、空袭弹着与轨道打击均为真实延迟结算；输出前留出完整表现窗口，
// 让这些变化回填原动作，而不是在文件写出后丢失。
await new Promise(resolveDelay => setTimeout(resolveDelay, 8000));

const winnerCampKey = state.victoryCamp === 'draw' ? 'draw' : camps.campToKey(state.victoryCamp);
const lastEngineMessage = [...(state.logHistory || [])].reverse().find(message => typeof message === 'string') || '';
const resultReason = !state.gameOver ? 'automationRoundLimit'
    : lastEngineMessage.includes('回合限制') ? 'turnLimit'
        : lastEngineMessage.includes('投降') ? 'surrender'
            : 'districtElimination';
recorder.finalizeMatchRecording(state, {
    winnerCampKey: state.gameOver ? winnerCampKey : null,
    victory: state.gameOver,
    reason: resultReason
});

const log = recorder.getCurrentMatchLog();
log.automation.turnsProcessed = turnsProcessed;
const fullOutputPath = resolve(
    typeof args.output === 'string'
        ? args.output
        : `artifacts/selfplay/${matchId}.match-full.json`
);
const reviewOutputPath = resolve(
    typeof args['review-output'] === 'string'
        ? args['review-output']
        : fullOutputPath.replace(/(?:\.match-(?:full|log))?\.json$/i, '.match-review.json')
);
await Promise.all([
    mkdir(dirname(fullOutputPath), { recursive: true }),
    mkdir(dirname(reviewOutputPath), { recursive: true })
]);
await Promise.all([
    writeFile(fullOutputPath, recorder.serializeCurrentMatchLog(), 'utf8'),
    writeFile(reviewOutputPath, recorder.serializeCurrentMatchReview(), 'utf8')
]);

const report = {
    outputPaths: {
        review: reviewOutputPath,
        full: fullOutputPath
    },
    matchId,
    complete: log.complete,
    winnerCampKey: log.result.winnerCampKey,
    reason: log.result.reason,
    rounds: log.summary.rounds,
    turnsProcessed,
    playerDifficulties: Object.fromEntries(
        Object.entries(difficultyProfiles).map(([key, profile]) => [key, profile.id])
    ),
    totalActions: log.summary.totalActions,
    commanders: selectedCommanders,
    byCamp: log.summary.byCamp
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
