// 双 Grok 自动化对局。逻辑层复用浏览器同一套 gameLogic / Unit / Grok 人格，
// 仅按比例压缩表现计时；同时输出轻量复盘索引与完整审计日志。

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

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
const seed = args.seed || `grok-selfplay-${new Date().toISOString().slice(0, 10)}`;
const maxRounds = Math.round(numberArg(args['max-rounds'], 25, { min: 1, max: 100 }));
const timeScale = numberArg(args['time-scale'], 0.02, { min: 0.001, max: 1 });
const difficulty = numberArg(args.difficulty, 1, { min: 0.5, max: 2 });
const standardMapId = typeof args.map === 'string' ? args.map : 'grand-island-2p';
const fogOfWar = args.fog === true || args.fog === 'true' || args.fog === '1';

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
engine.configureSkirmishState({
    playerCount: 2,
    controllers: { player1: 'ai', player2: 'ai' }
});

const state = engine.gameState;
state.gameMode = 'selfplay';
state.standardMapId = standardMapId;
state.skirmishFog = fogOfWar;
state.aiDifficulty = difficulty;
state.aiOpponentCamp = null;
state.commanderPhase = 'done';

const pools = commanders.shuffleAndSplitPool(false, 4, state.rng);
state.commanderPoolP1 = pools.p1;
state.commanderPoolP2 = pools.p2;
state.commanderP1 = typeof args['commander-p1'] === 'string'
    ? args['commander-p1']
    : ai.aiSelectCommander(pools.p1);
state.commanderP2 = typeof args['commander-p2'] === 'string'
    ? args['commander-p2']
    : ai.aiSelectCommander(pools.p2);
for (const commanderId of [state.commanderP1, state.commanderP2]) {
    if (!commanders.allCommanders[commanderId]) throw new Error(`未知将领: ${commanderId}`);
}
state.commanderP1Confirmed = true;
state.commanderP2Confirmed = true;
const selectedCommanders = { player1: state.commanderP1, player2: state.commanderP2 };

engine.initMap();
const matchId = `grok-vs-grok-${String(seed).replace(/[^a-z0-9_-]+/gi, '-').slice(0, 48)}-${Date.now().toString(36)}`;
recorder.startMatchRecording(state, {
    matchId,
    automation: {
        runner: 'tools/runGrokSelfPlay.mjs',
        player1Personality: 'Grok',
        player2Personality: 'Grok',
        neutralPersonality: 'Claude',
        seed: String(seed),
        timeScale,
        maxRounds
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
        else await ai.processOpponentTurn(state.currentCamp);
        turnsProcessed++;
        if (!state.gameOver) await engine.advanceAutomatedTurn();
    }
} finally {
    restoreAiRuntime();
}

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
    totalActions: log.summary.totalActions,
    commanders: selectedCommanders,
    byCamp: log.summary.byCamp
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
