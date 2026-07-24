import { readFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const rounds = args.length > 0 ? args : ['baseline', 'round1', 'round2'];

const reports = {};
for (const round of rounds) {
    const path = `artifacts/selfplay/${round}/benchmark-analysis.json`;
    try {
        reports[round] = JSON.parse(await readFile(path, 'utf8'));
    } catch (e) {
        console.error(`Missing or invalid: ${path}`);
        process.exit(1);
    }
}

const difficultyMeta = {
    easy: 'Optio',
    medium: 'Legatus',
    hard: 'Imperator'
};

const metrics = [
    { key: 'winRate', label: '胜率', fmt: v => (v * 100).toFixed(1) + '%' },
    { key: 'drawRate', label: '平局率', fmt: v => (v * 100).toFixed(1) + '%' },
    { key: 'avgCities', label: '平均占城', fmt: v => v.toFixed(2) },
    { key: 'avgKills', label: '平均击杀', fmt: v => v.toFixed(2) },
    { key: 'avgLosses', label: '平均战损', fmt: v => v.toFixed(2) },
    { key: 'kdRatio', label: 'K/D', fmt: v => v.toFixed(3) },
    { key: 'avgRecruits', label: '平均招募', fmt: v => v.toFixed(2) },
    { key: 'avgActions', label: '平均行动', fmt: v => v.toFixed(1) },
    { key: 'avgCards', label: '平均用卡', fmt: v => v.toFixed(2) }
];

for (const diff of ['easy', 'medium', 'hard']) {
    console.log(`\n## ${difficultyMeta[diff]} (${diff})\n`);
    console.log('| 指标 | ' + rounds.join(' | ') + ' |');
    console.log('|------|' + rounds.map(() => '------').join('|') + '|');
    for (const m of metrics) {
        const cells = rounds.map(r => m.fmt(reports[r].difficultySummary[diff][m.key]));
        console.log(`| ${m.label} | ${cells.join(' | ')} |`);
    }
}

console.log('\n## 直接交锋（Head-to-Head）\n');
const pairs = ['easy-vs-medium', 'easy-vs-hard', 'medium-vs-hard'];
for (const pair of pairs) {
    console.log(`\n### ${pair}\n`);
    console.log('| 维度 | ' + rounds.join(' | ') + ' |');
    console.log('|------|' + rounds.map(() => '------').join('|') + '|');
    const dims = ['games', 'firstWins', 'secondWins', 'draws'];
    const dimLabels = { games: '总局数', firstWins: '先手胜', secondWins: '后手胜', draws: '平局' };
    for (const d of dims) {
        const cells = rounds.map(r => {
            const h2h = reports[r].headToHead[pair];
            return h2h ? h2h[d] : '-';
        });
        console.log(`| ${dimLabels[d]} | ${cells.join(' | ')} |`);
    }
}
