// 生成并导出自对局 DAgger + 长期胜率价值头（Value Head）训练数据集。
// 用法：
//   node tools/collectSelfPlayTrainingData.mjs [--games=12] [--concurrency=4] [--extra-dir=artifacts/benchmark/v2-iter1] [--out=artifacts/datasets/selfplay-dagger.jsonl]

import '../core/dom-shim.js';
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { engine } from '../core/headless.js';
import { buildAiHelpers } from '../js/ai.js';
import { getAiDifficultyProfile } from '../ai/difficulty.js';
import { enumerateHybridCandidates } from '../ai/core/hybridScorer.js';
import { buildObservation } from './agentSdk.mjs';
import {
    hydrateMatchInitialState,
    applyChanges,
    matchHumanActionToCandidate
} from './exportHumanDataset.mjs';

const args = Object.fromEntries(process.argv.slice(2)
    .filter(t => t.startsWith('--'))
    .map(t => {
        const [k, ...rest] = t.slice(2).split('=');
        return [k, rest.length ? rest.join('=') : true];
    }));

const gamesCount = Math.max(0, Number(args.games ?? 12));
const concurrency = Math.max(1, Number(args.concurrency || 4));
const rawDir = resolve(String(args['raw-dir'] || 'artifacts/selfplay-dagger-raw'));
const extraDirs = String(args['extra-dir'] || 'artifacts/benchmark/v2-iter1')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
const outputPath = resolve(String(args.out || 'artifacts/datasets/selfplay-dagger.jsonl'));

const MATCH_SPECS = [
    { id: 'sp1', map: 'crown-ring', players: 2, fog: false, doubleCommander: true, cultures: ['fr', 'kmt'], difficulties: ['hard', 'hard'] },
    { id: 'sp2', map: 'crown-ring', players: 2, fog: true, doubleCommander: false, cultures: ['cpc', 'de'], difficulties: ['hard', 'medium'] },
    { id: 'sp3', map: 'uncharted-passage', players: 2, fog: false, doubleCommander: true, cultures: ['us', 'gb'], difficulties: ['hard', 'hard'] },
    { id: 'sp4', map: 'uncharted-passage', players: 2, fog: true, doubleCommander: false, cultures: ['jp', 'fr'], difficulties: ['hard', 'medium'] },
    { id: 'sp5', map: 'crown-ring', players: 3, fog: false, doubleCommander: true, cultures: ['de', 'fr', 'kmt'], difficulties: ['hard', 'hard', 'medium'] },
    { id: 'sp6', map: 'uncharted-passage', players: 3, fog: true, doubleCommander: true, cultures: ['gb', 'us', 'jp'], difficulties: ['hard', 'hard', 'medium'] },
    { id: 'sp7', map: 'river-valley', players: 2, fog: false, doubleCommander: true, cultures: ['cpc', 'kmt'], difficulties: ['hard', 'hard'] },
    { id: 'sp8', map: 'river-valley', players: 2, fog: true, doubleCommander: false, cultures: ['fr', 'de'], difficulties: ['hard', 'medium'] },
    { id: 'sp9', map: 'crown-ring', players: 2, fog: false, doubleCommander: false, cultures: ['jp', 'us'], difficulties: ['hard', 'hard'] },
    { id: 'sp10', map: 'uncharted-passage', players: 2, fog: false, doubleCommander: false, cultures: ['gb', 'de'], difficulties: ['hard', 'medium'] },
    { id: 'sp11', map: 'crown-ring', players: 3, fog: true, doubleCommander: false, cultures: ['fr', 'cpc', 'us'], difficulties: ['hard', 'medium', 'hard'] },
    { id: 'sp12', map: 'uncharted-passage', players: 3, fog: false, doubleCommander: true, cultures: ['kmt', 'fr', 'gb'], difficulties: ['hard', 'hard', 'medium'] }
];

const RARE_TYPES = new Set([
    'droneDeploy',
    'droneSuicide',
    'heavyCannonStance',
    'airCommand',
    'buildFortification',
    'buildAirfield',
    'repairShip',
    'banzaiCharge',
    'guerrillaConcealment',
    'drawCard',
    'activateSkill',
    'chooseSpecialization'
]);

function runSelfPlayGame(spec) {
    return new Promise((resolvePromise) => {
        const base = `${rawDir}/${spec.id}`;
        const childArgs = [
            'tools/runSelfPlay.mjs',
            `--seed=dagger-${spec.id}`,
            `--map=${spec.map}`,
            `--players=${spec.players}`,
            `--fog=${spec.fog}`,
            `--double-commander=${spec.doubleCommander}`,
            `--cultures=${spec.cultures.join(',')}`,
            `--difficulties=${spec.difficulties.join(',')}`,
            '--time-scale=0.01',
            `--output=${base}.match-full.json`,
            `--review-output=${base}.match-review.json`
        ];
        const child = spawn(process.execPath, childArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        child.stderr.on('data', c => { stderr += c; });
        child.on('close', code => resolvePromise({ id: spec.id, code, stderr: stderr.slice(-300) }));
    });
}

async function generateBatch() {
    if (gamesCount <= 0) return;
    await mkdir(rawDir, { recursive: true });
    const specs = MATCH_SPECS.slice(0, gamesCount);
    let cursor = 0;
    async function worker() {
        while (cursor < specs.length) {
            const spec = specs[cursor++];
            const t0 = Date.now();
            const res = await runSelfPlayGame(spec);
            console.log(`[dagger-gen] ${spec.id} (${spec.map}, ${spec.cultures.join('/')}) done in ${Math.round((Date.now() - t0) / 1000)}s exit=${res.code}`);
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, specs.length) }, worker));
}

function collectJsonFiles(dirs) {
    const out = [];
    for (const dir of dirs) {
        try {
            const abs = resolve(dir);
            if (!statSync(abs).isDirectory()) continue;
            for (const name of readdirSync(abs).sort()) {
                if (name.endsWith('.match-full.json')) out.push(join(abs, name));
            }
        } catch {
            // 忽略不存在目录
        }
    }
    return out;
}

function matchSelfPlayCandidate(entry, candidates, state) {
    if (entry.actionType === 'droneDeploy') {
        const p = entry.payload || {};
        const q = p.q ?? p.tileQ;
        const r = p.r ?? p.tileR;
        return candidates.find(c => c.actionType === 'droneDeploy' && c.unitId === p.unitId && c.q === q && c.r === r) || null;
    }
    return matchHumanActionToCandidate(entry, candidates, state);
}

function computeTerminalReturnMap(log, reviewLog) {
    const winner = log.result?.winnerCampKey || null;
    const campCities = new Map();
    const overviewCamps = Array.isArray(reviewLog?.overview?.camps) ? reviewLog.overview.camps : null;
    if (overviewCamps) {
        for (const c of overviewCamps) {
            if (c?.campKey && c.campKey !== 'neutral') {
                campCities.set(c.campKey, Number(c.finalCities ?? 1));
            }
        }
    } else if (log.summary?.byCamp && typeof log.summary.byCamp === 'object') {
        for (const [ck, stats] of Object.entries(log.summary.byCamp)) {
            if (ck !== 'neutral') {
                campCities.set(ck, 1 + Number(stats?.citiesCaptured ?? 0));
            }
        }
    }
    const returns = new Map();
    for (const p of (log.participants || [])) {
        if (!p?.campKey || p.campKey === 'neutral') continue;
        const ck = p.campKey;
        const winBase = winner === ck ? 1.0 : (winner === 'draw' || !winner ? 0.0 : -1.0);
        const myCities = campCities.get(ck) ?? 1;
        let bestOther = 0;
        for (const [ok, oc] of campCities.entries()) {
            if (ok !== ck) bestOther = Math.max(bestOther, oc);
        }
        const cityMargin = Math.max(-0.5, Math.min(0.5, (myCities - bestOther) / 3.0));
        const terminal = Math.max(-1.0, Math.min(1.0, 0.80 * winBase + 0.40 * cityMargin));
        returns.set(ck, terminal);
    }
    return returns;
}

await generateBatch();

const sourceDirs = [
    ...(gamesCount > 0 ? [rawDir] : []),
    ...extraDirs
];
const files = collectJsonFiles(sourceDirs);
const lines = [];
const actionTypeCounts = {};
let matchedTotal = 0;

for (const filePath of files) {
    const log = JSON.parse(readFileSync(filePath, 'utf8'));
    let reviewLog = null;
    try {
        reviewLog = JSON.parse(readFileSync(filePath.replace(/\.match-full\.json$/, '.match-review.json'), 'utf8'));
    } catch {
        reviewLog = null;
    }
    const aiCamps = new Set(
        (log.participants || [])
            .filter(p => p.campKey !== 'neutral' && p.controller === 'ai')
            .map(p => p.campKey)
    );
    const diffByCamp = log.mode?.aiDifficultyByCamp || {};
    const terminalReturns = computeTerminalReturnMap(log, reviewLog);
    const totalRounds = Math.max(1, Number(log.summary?.rounds || log.result?.rounds || 19));
    const state = hydrateMatchInitialState(log);
    const timeline = log.timeline || [];

    const pendingDeferred = [];
    for (const item of timeline) {
        for (const def of item.outcome?.deferredEffects || []) pendingDeferred.push(def);
    }
    pendingDeferred.sort((a, b) => Number(a.resolvedAtSequence || 0) - Number(b.resolvedAtSequence || 0));
    let defCursor = 0;

    for (const item of timeline) {
        while (defCursor < pendingDeferred.length && Number(pendingDeferred[defCursor].resolvedAtSequence || 0) <= item.sequence) {
            applyChanges(state, pendingDeferred[defCursor].changes, null);
            defCursor++;
        }
        if (item.kind !== 'action') continue;

        const ck = item.actorCampKey;
        const diff = diffByCamp[ck] || 'hard';
        if (aiCamps.has(ck) && (diff === 'hard' || diff === 'medium')
            && !['stateCorrection', 'surrender', 'endTurn'].includes(item.actionType)) {
            const camp = state.factions[ck];
            if (camp && state.currentCamp !== camp) state.currentCamp = camp;
            const helpers = buildAiHelpers(camp, getAiDifficultyProfile('hard'));
            const candidates = enumerateHybridCandidates(state, camp, helpers);
            const matched = matchSelfPlayCandidate(item, candidates, state);
            if (matched) {
                matchedTotal++;
                const rTerminal = terminalReturns.get(ck) ?? 0.0;
                const round = Number(item.round || 1);
                const discount = Math.max(0.35, Math.pow(0.94, Math.max(0, totalRounds - round)));
                const outcomeValue = Number((rTerminal * discount).toFixed(4));
                const isRare = RARE_TYPES.has(matched.actionType);
                const keepCommon = (rTerminal > 0.15 && (item.sequence % 2 === 0)) || (rTerminal < -0.25 && (item.sequence % 4 === 0));
                if (isRare || keepCommon) {
                    const policyWeight = isRare
                        ? (rTerminal >= 0 ? 0.85 : 0.12)
                        : (rTerminal > 0.15 ? 0.30 : 0.0);
                    const valueWeight = 1.0;
                    const doctrine = item.decisionContext?.strategicIntent?.doctrine || 'grandmaster';
                    const rec = {
                        matchId: log.matchId,
                        source: 'selfplay-dagger',
                        map: log.mode?.standardMapId || state.standardMapId,
                        mode: log.mode?.factionRuleMode || 'none',
                        round,
                        turnCounter: item.turnCounter,
                        sequence: item.sequence,
                        campKey: ck,
                        doctrine,
                        outcomeValue,
                        policyWeight,
                        valueWeight,
                        observation: buildObservation(camp),
                        legalCandidates: candidates.map(({ id, actionType, unitId, unitType, targetId, q, r, cardId, commandKind, fromQ, fromR, specializationKey, fortKind, skillId }) => ({
                            id,
                            actionType,
                            ...(unitId != null ? { unitId } : {}),
                            ...(unitType ? { unitType } : {}),
                            ...(targetId != null ? { targetId } : {}),
                            ...(q != null ? { q, r } : {}),
                            ...(cardId ? { cardId } : {}),
                            ...(commandKind ? { commandKind, fromQ, fromR } : {}),
                            ...(specializationKey ? { specializationKey } : {}),
                            ...(fortKind ? { fortKind } : {}),
                            ...(skillId != null ? { skillId } : {})
                        })),
                        humanChosenId: matched.id
                    };
                    lines.push(JSON.stringify(rec));
                    actionTypeCounts[matched.actionType] = (actionTypeCounts[matched.actionType] || 0) + 1;
                }
            }
        }

        applyChanges(state, item.outcome?.changes, item);
    }
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
console.log(JSON.stringify({
    outputPath,
    filesProcessed: files.length,
    matchedTotal,
    keptSamples: lines.length,
    actionTypeCounts
}, null, 2));
