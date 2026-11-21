// 10 局基准矩阵：衡量困难档（Imperator）对中/低档的胜率与行为健康度。
// 用法：node tools/runBenchmark.mjs --label=my-run [--concurrency=3] [--only=1,3]
// 产物：artifacts/benchmark/<label>/gN.{match-review,match-full}.json 与 summary.json。

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2)
    .filter(token => token.startsWith('--'))
    .map(token => {
        const [key, ...rest] = token.slice(2).split('=');
        return [key, rest.length ? rest.join('=') : true];
    }));
const label = String(args.label || `bench-${Date.now().toString(36)}`);
const concurrency = Math.max(1, Number(args.concurrency) || 3);
const requestedGames = Math.max(1, Number(args.games) || 10);
const only = typeof args.only === 'string' ? new Set(args.only.split(',').map(Number)) : null;
// 固定种子前缀：迭代间用同一批种子才能对比改动效果；产出目录仍按 label 区分。
const seedPrefix = typeof args['seed-prefix'] === 'string' ? args['seed-prefix'] : label;

const CULTURE_IDS = ['us', 'gb', 'fr', 'ru', 'kmt', 'cpc', 'de', 'jp'];

function buildMatrix(targetCount) {
    if (targetCount <= MATRIX.length) return MATRIX.slice(0, targetCount);
    const list = [...MATRIX];
    const mapPool = [
        { map: 'crown-ring', players: 2 },
        { map: 'uncharted-passage', players: 2 },
        { map: 'crown-ring', players: 3 },
        { map: 'uncharted-passage', players: 3 }
    ];
    for (let idx = MATRIX.length; idx < targetCount; idx++) {
        const slot = mapPool[(idx - MATRIX.length) % mapPool.length];
        const cycle = Math.floor((idx - MATRIX.length) / mapPool.length);
        const fog = (idx % 2) === 1;
        const doubleCommander = (Math.floor(idx / 2) % 2) === 1;
        const hardSeat = idx % slot.players;
        const difficulties = Array.from({ length: slot.players }, (_, seat) => {
            if (seat === hardSeat) return 'hard';
            if (slot.players === 3 && ((seat - hardSeat + 3) % 3) === 2) return 'easy';
            return 'medium';
        });
        const useCulture = (cycle % 2) === 1;
        const cultures = useCulture
            ? Array.from({ length: slot.players }, (_, seat) => CULTURE_IDS[(idx * 3 + seat * 2) % CULTURE_IDS.length])
            : null;
        list.push({
            id: `g${idx + 1}`,
            map: slot.map,
            players: slot.players,
            fog,
            doubleCommander,
            difficulties,
            hardCamp: `player${hardSeat + 1}`,
            cultures
        });
    }
    return list;
}

// 矩阵对齐迭代笔记的风格：地图/模式/将领数/人数全部打散，困难档轮换座位以抵消先手与岛位偏差。
// hardCamp 记录本局困难档所在阵营键，胜率按它统计。
const MATRIX = [
    { id: 'g1', map: 'crown-ring', players: 2, fog: false, doubleCommander: false, difficulties: ['hard', 'medium'], hardCamp: 'player1' },
    { id: 'g2', map: 'crown-ring', players: 2, fog: true, doubleCommander: true, difficulties: ['medium', 'hard'], hardCamp: 'player2' },
    { id: 'g3', map: 'uncharted-passage', players: 2, fog: false, doubleCommander: true, difficulties: ['hard', 'medium'], hardCamp: 'player1' },
    { id: 'g4', map: 'uncharted-passage', players: 2, fog: true, doubleCommander: false, difficulties: ['medium', 'hard'], hardCamp: 'player2' },
    { id: 'g5', map: 'crown-ring', players: 3, fog: true, doubleCommander: true, difficulties: ['hard', 'medium', 'easy'], hardCamp: 'player1' },
    { id: 'g6', map: 'uncharted-passage', players: 3, fog: true, doubleCommander: true, difficulties: ['medium', 'easy', 'hard'], hardCamp: 'player3' },
    { id: 'g7', map: 'crown-ring', players: 3, fog: false, doubleCommander: false, difficulties: ['easy', 'hard', 'medium'], hardCamp: 'player2' },
    { id: 'g8', map: 'uncharted-passage', players: 3, fog: true, doubleCommander: false, difficulties: ['hard', 'medium', 'easy'], hardCamp: 'player1' },
    { id: 'g9', map: 'uncharted-passage', players: 2, fog: true, doubleCommander: true, difficulties: ['hard', 'medium'], hardCamp: 'player1' },
    { id: 'g10', map: 'crown-ring', players: 2, fog: false, doubleCommander: true, difficulties: ['medium', 'hard'], hardCamp: 'player2' }
];

const outDir = resolve(`artifacts/benchmark/${label}`);

function runGame(game) {
    return new Promise((resolvePromise) => {
        const base = `${outDir}/${game.id}`;
        const childArgs = [
            'tools/runSelfPlay.mjs',
            `--seed=${seedPrefix}-${game.id}`,
            `--map=${game.map}`,
            `--players=${game.players}`,
            `--fog=${game.fog}`,
            `--double-commander=${game.doubleCommander}`,
            `--difficulties=${game.difficulties.join(',')}`,
            ...(game.cultures?.length ? [`--cultures=${game.cultures.join(',')}`] : []),
            `--output=${base}.match-full.json`,
            `--review-output=${base}.match-review.json`
        ];
        const child = spawn(process.execPath, childArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        child.stderr.on('data', chunk => { stderr += chunk; });
        child.on('close', code => resolvePromise({ game, code, stderr: stderr.trim().slice(-400) }));
    });
}

async function runPool(games) {
    const results = [];
    let cursor = 0;
    let rw = 0, rd = 0, rl = 0;
    async function worker() {
        while (cursor < games.length) {
            const game = games[cursor++];
            const startedAt = Date.now();
            const result = await runGame(game);
            result.elapsedMs = Date.now() - startedAt;
            results.push(result);
            let detail = `exit=${result.code}`;
            try {
                const rev = JSON.parse(await readFile(`${outDir}/${game.id}.match-review.json`, 'utf8'));
                const winner = rev.result?.winnerCampKey || null;
                const won = winner === game.hardCamp;
                const isDraw = !winner || winner === 'draw';
                if (won) rw++; else if (isDraw) rd++; else rl++;
                const hard = (rev.overview?.camps || []).find(c => c.campKey === game.hardCamp) || {};
                const tag = won ? '✅胜' : (isDraw ? '➖平' : '❌负');
                const modeTag = `${game.map}${game.players === 3 ? ' 3P' : ''}${game.fog ? ' 迷雾' : ''}`;
                detail = `${tag} | ${modeTag} | 伤${hard.damageDealt || 0} 杀${hard.kills || 0}/死${hard.losses || 0} 城${hard.captures || 0}→${hard.finalCities || 0} R${rev.overview?.rounds || '?'} | 累计 ${rw}W-${rd}D-${rl}L`;
            } catch { /* 缺文件按失败处理 */ }
            console.log(`[${label}] ${game.id}（${Math.round(result.elapsedMs / 1000)}s）${detail}`);
            if (result.code !== 0) console.log(result.stderr);
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, games.length) }, worker));
    return results;
}

async function summarize(results) {
    const rows = [];
    let wins = 0, draws = 0, losses = 0;
    const totals = { kills: 0, losses: 0, damage: 0, captures: 0, attacks: 0 };
    for (const { game, code } of results.sort((a, b) => a.game.id.localeCompare(b.game.id))) {
        let review = null;
        try {
            review = JSON.parse(await readFile(`${outDir}/${game.id}.match-review.json`, 'utf8'));
        } catch { /* 缺文件按失败局处理 */ }
        if (!review) {
            rows.push({ game: game.id, error: `exit=${code}` });
            continue;
        }
        const winner = review.result?.winnerCampKey || null;
        const hardWon = winner === game.hardCamp;
        const isDraw = !winner || winner === 'draw';
        if (hardWon) wins++; else if (isDraw) draws++; else losses++;
        const campStats = Object.fromEntries((review.overview?.camps || []).map(camp => [camp.campKey, camp]));
        const hard = campStats[game.hardCamp] || {};
        totals.kills += hard.kills || 0;
        totals.losses += hard.losses || 0;
        totals.damage += hard.damageDealt || 0;
        totals.captures += hard.captures || 0;
        totals.attacks += hard.attacks || 0;
        rows.push({
            game: game.id, map: game.map, players: game.players, fog: game.fog,
            doubleCommander: game.doubleCommander,
            cultures: game.cultures || null,
            hardCamp: game.hardCamp,
            winner, hardWon, rounds: review.overview?.rounds,
            reason: review.result?.reason || null,
            hardKills: hard.kills, hardLosses: hard.losses,
            hardDamage: hard.damageDealt, hardCaptures: hard.captures,
            hardFinalCities: hard.finalCities,
            hardRating: hard.rating?.score ?? null,
            hardGrade: hard.rating?.grade ?? null
        });
    }
    const games = rows.length;
    const rated = rows.filter(r => Number.isFinite(r.hardRating));
    const avgRating = rated.length ? rated.reduce((s, r) => s + r.hardRating, 0) / rated.length : null;
    const avgDamage = games ? totals.damage / games : 0;
    const summary = {
        label, games, wins, draws, losses,
        winRate: games ? wins / games : 0,
        drawRate: games ? draws / games : 0,
        lossRate: games ? losses / games : 0,
        nonLossRate: games ? (wins + draws) / games : 0,
        scoreRate: games ? (wins + 0.5 * draws) / games : 0,
        avgDamage,
        avgRating,
        hardTotals: totals,
        rows
    };
    await writeFile(`${outDir}/summary.json`, JSON.stringify(summary, null, 2));
    console.log(`\n===== ${label} 汇总 =====`);
    for (const row of rows) {
        console.log(row.error
            ? `${row.game} 错误 ${row.error}`
            : `${row.game} ${row.map}${row.players === 3 ? ' 3P' : ''}${row.fog ? ' 迷雾' : ''} → ${row.winner || '平局'}`
                + `${row.hardWon ? ' ✅' : ' ❌'} 击杀${row.hardKills} 阵亡${row.hardLosses} 占城${row.hardCaptures} 终局城${row.hardFinalCities} R${row.rounds}`);
    }
    console.log(`\n困难档战绩 ${wins}胜 ${draws}平 ${losses}负（胜率 ${(summary.winRate * 100).toFixed(1)}% / 平局率 ${(summary.drawRate * 100).toFixed(1)}% / 负率 ${(summary.lossRate * 100).toFixed(1)}% / 得分率 ${(summary.scoreRate * 100).toFixed(1)}%）`);
    console.log(`困难档合计：击杀${totals.kills} 阵亡${totals.losses} 伤害${totals.damage} 攻击${totals.attacks} 占城${totals.captures}`);
}

await mkdir(outDir, { recursive: true });
const games = buildMatrix(requestedGames).filter(game => !only || only.has(Number(game.id.slice(1))));
const results = await runPool(games);
await summarize(results);
