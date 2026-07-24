import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const execFileAsync = promisify(execFile);

const configs = [
    { id: 'S01', players: 2, map: 'crown-ring', fog: false, doubleCommander: false, difficulties: ['easy', 'medium'] },
    { id: 'S02', players: 2, map: 'crown-ring', fog: true,  doubleCommander: false, difficulties: ['easy', 'hard'] },
    { id: 'S03', players: 2, map: 'uncharted-passage', fog: false, doubleCommander: false, difficulties: ['medium', 'hard'] },
    { id: 'S04', players: 2, map: 'uncharted-passage', fog: true,  doubleCommander: false, difficulties: ['easy', 'hard'] },
    { id: 'S05', players: 2, map: 'crown-ring', fog: true,  doubleCommander: true,  difficulties: ['medium', 'hard'] },
    { id: 'S06', players: 2, map: 'uncharted-passage', fog: false, doubleCommander: true,  difficulties: ['easy', 'medium'] },
    { id: 'S07', players: 3, map: 'crown-ring', fog: false, doubleCommander: false, difficulties: ['easy', 'medium', 'hard'] },
    { id: 'S08', players: 3, map: 'crown-ring', fog: true,  doubleCommander: false, difficulties: ['easy', 'medium', 'hard'] },
    { id: 'S09', players: 3, map: 'uncharted-passage', fog: false, doubleCommander: false, difficulties: ['easy', 'medium', 'hard'] },
    { id: 'S10', players: 3, map: 'uncharted-passage', fog: true,  doubleCommander: true,  difficulties: ['easy', 'medium', 'hard'] }
];

const round = typeof process.argv[2] === 'string' && process.argv[2].startsWith('--round=')
    ? process.argv[2].slice('--round='.length)
    : 'baseline';
const outDir = `artifacts/selfplay/${round}`;

async function runGame(config) {
    const seed = `${config.id}-${config.map}-${config.players}p-${config.fog ? 'fog' : 'clear'}-${config.doubleCommander ? 'dc' : 'sc'}-${Date.now()}`;
    const args = [
        'tools/runSelfPlay.mjs',
        `--difficulties=${config.difficulties.join(',')}`,
        `--map=${config.map}`,
        `--players=${config.players}`,
        `--fog=${config.fog ? 'true' : 'false'}`,
        `--double-commander=${config.doubleCommander ? 'true' : 'false'}`,
        `--seed=${seed}`,
        `--max-rounds=25`,
        `--time-scale=0.005`,
        `--output=${outDir}/benchmark-${config.id}.match-full.json`,
        `--review-output=${outDir}/benchmark-${config.id}.match-review.json`
    ];
    const start = Date.now();
    const { stdout, stderr } = await execFileAsync('node', args, { cwd: projectRoot, timeout: 300000 });
    const duration = Date.now() - start;
    const result = JSON.parse(stdout);
    return { config, result, duration, stderr };
}

async function main() {
    await mkdir(resolve(projectRoot, outDir), { recursive: true });
    console.log(`Starting 10 benchmark games sequentially (round=${round})...`);
    const results = [];
    for (const config of configs) {
        process.stdout.write(`Running ${config.id}... `);
        const run = await runGame(config);
        results.push(run);
        console.log(`done (${run.duration}ms)`);
    }
    const summary = results.map(({ config, result, duration }) => ({
        id: config.id,
        players: config.players,
        map: config.map,
        fog: config.fog,
        doubleCommander: config.doubleCommander,
        difficulties: config.difficulties,
        winner: result.winnerCampKey,
        reason: result.reason,
        rounds: result.rounds,
        turnsProcessed: result.turnsProcessed,
        duration,
        byCamp: result.byCamp,
        commanders: result.commanders
    }));
    await writeFile(
        resolve(projectRoot, `${outDir}/benchmark-summary.json`),
        JSON.stringify(summary, null, 2),
        'utf8'
    );
    console.log(JSON.stringify(summary, null, 2));
}

main().catch(err => { console.error(err); process.exit(1); });
