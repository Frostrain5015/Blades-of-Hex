import { readFile, writeFile } from 'node:fs/promises';

const round = typeof process.argv[2] === 'string' && process.argv[2].startsWith('--round=')
    ? process.argv[2].slice('--round='.length)
    : 'baseline';
const dir = `artifacts/selfplay/${round}`;

const summary = JSON.parse(await readFile(`${dir}/benchmark-summary.json`, 'utf8'));

const difficultyMeta = {
    easy: { name: 'Optio' },
    medium: { name: 'Legatus' },
    hard: { name: 'Imperator' }
};

function makeStats() {
    return { wins: 0, draws: 0, losses: 0, games: 0, cities: 0, captures: 0, lossesUnits: 0, kills: 0, actions: 0, cards: 0, recruits: 0 };
}

const diffStats = { easy: makeStats(), medium: makeStats(), hard: makeStats() };
const perGame = [];
const headToHead = {};

for (const game of summary) {
    const diffByCamp = Object.fromEntries(game.difficulties.map((d, i) => [`player${i + 1}`, d]));
    const winner = game.winner;
    const isDraw = winner === 'draw';
    const resultByCamp = {};

    for (const [camp, diff] of Object.entries(diffByCamp)) {
        let outcome;
        if (isDraw) outcome = 'draw';
        else if (winner === camp) outcome = 'win';
        else outcome = 'loss';
        resultByCamp[camp] = outcome;

        const s = diffStats[diff];
        s.games++;
        if (outcome === 'win') s.wins++;
        else if (outcome === 'draw') s.draws++;
        else s.losses++;
        s.cities += (game.byCamp[camp].citiesCaptured || 0);
        s.captures += (game.byCamp[camp].citiesCaptured || 0);
        s.lossesUnits += (game.byCamp[camp].unitsLost || 0);
        s.kills += (game.byCamp[camp].kills || 0);
        s.actions += (game.byCamp[camp].actions || 0);
        s.cards += (game.byCamp[camp].cards || 0);
        s.recruits += (game.byCamp[camp].recruits || 0);
    }

    perGame.push({
        id: game.id,
        players: game.players,
        map: game.map,
        fog: game.fog,
        doubleCommander: game.doubleCommander,
        difficulties: game.difficulties,
        winner: game.winner,
        rounds: game.rounds,
        resultByCamp
    });

    const camps = Object.keys(diffByCamp).filter(c => c !== 'neutral');
    for (let i = 0; i < camps.length; i++) {
        for (let j = i + 1; j < camps.length; j++) {
            const c1 = camps[i], c2 = camps[j];
            const d1 = diffByCamp[c1], d2 = diffByCamp[c2];
            const key = `${d1}-vs-${d2}`;
            if (!headToHead[key]) headToHead[key] = { pair: [d1, d2], games: 0, firstWins: 0, secondWins: 0, draws: 0 };
            headToHead[key].games++;
            if (isDraw) headToHead[key].draws++;
            else if (winner === c1) headToHead[key].firstWins++;
            else if (winner === c2) headToHead[key].secondWins++;
        }
    }
}

const report = {
    difficultySummary: Object.fromEntries(Object.entries(diffStats).map(([diff, s]) => [diff, {
        name: difficultyMeta[diff].name,
        games: s.games,
        wins: s.wins,
        draws: s.draws,
        losses: s.losses,
        winRate: s.games ? +(s.wins / s.games).toFixed(3) : 0,
        drawRate: s.games ? +(s.draws / s.games).toFixed(3) : 0,
        avgCities: s.games ? +(s.cities / s.games).toFixed(2) : 0,
        avgKills: s.games ? +(s.kills / s.games).toFixed(2) : 0,
        avgLosses: s.games ? +(s.lossesUnits / s.games).toFixed(2) : 0,
        avgActions: s.games ? +(s.actions / s.games).toFixed(1) : 0,
        avgCards: s.games ? +(s.cards / s.games).toFixed(2) : 0,
        avgRecruits: s.games ? +(s.recruits / s.games).toFixed(2) : 0,
        kdRatio: s.lossesUnits ? +(s.kills / s.lossesUnits).toFixed(3) : s.kills
    }])),
    perGame,
    headToHead
};

await writeFile(`${dir}/benchmark-analysis.json`, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify(report, null, 2));
