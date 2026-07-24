import { readFile, writeFile } from 'node:fs/promises';
import { buildMatchStats } from '../js/matchStats.js';

const round = typeof process.argv[2] === 'string' && process.argv[2].startsWith('--round=')
    ? process.argv[2].slice('--round='.length)
    : 'baseline';
const dir = `artifacts/selfplay/${round}`;

const ids = ['S01','S02','S03','S04','S05','S06','S07','S08','S09','S10'];
const results = [];

for (const id of ids) {
    const text = await readFile(`${dir}/benchmark-${id}.match-full.json`, 'utf8');
    const log = JSON.parse(text);
    const stats = buildMatchStats(log);
    const diffByCamp = Object.fromEntries(log.mode.aiDifficultyByCamp ? Object.entries(log.mode.aiDifficultyByCamp) : []);
    const winner = log.result?.winnerCampKey || 'draw';
    const cityTimeline = stats.controlTimeline.map(snapshot => ({
        round: snapshot.round,
        byDiff: Object.fromEntries(
            Object.entries(snapshot.byCamp)
                .filter(([camp]) => camp !== 'neutral' && diffByCamp[camp])
                .map(([camp, data]) => [diffByCamp[camp], data.cities])
        )
    }));

    const commanderDeaths = stats.commanderDeathEvents.map(e => ({
        round: e.round,
        camp: e.campKey,
        diff: diffByCamp[e.campKey],
        commander: e.commanderName
    }));

    const captures = stats.keyEvents.filter(e => e.type === 'cityCaptured').map(e => ({
        round: e.round,
        camp: e.campKey,
        diff: diffByCamp[e.campKey],
        label: e.label
    }));

    const actionDist = Object.fromEntries(
        Object.entries(diffByCamp).map(([camp, diff]) => {
            const campStats = stats.camps.find(c => c.campKey === camp) || {};
            return [diff, {
                moves: campStats.moves || 0,
                attacks: campStats.attacks || 0,
                recruits: campStats.recruits || 0,
                reinforcements: campStats.reinforcements || 0,
                cards: campStats.cards || 0,
                constructions: campStats.constructions || 0,
                actions: campStats.actions || 0
            }];
        })
    );

    results.push({
        id,
        mode: log.mode,
        winner,
        rounds: stats.rounds.at(-1)?.round || log.finalState?.round,
        cityTimeline,
        captures,
        commanderDeaths,
        actionDist,
        camps: stats.camps.map(c => ({
            campKey: c.campKey,
            diff: diffByCamp[c.campKey],
            initialCities: c.initialCities,
            finalCities: c.finalCities,
            kills: c.kills,
            losses: c.losses,
            captures: c.captures,
            damageDealt: c.damageDealt,
            damageTaken: c.damageTaken
        }))
    });
}

await writeFile(`${dir}/benchmark-deep-analysis.json`, JSON.stringify(results, null, 2), 'utf8');
console.log(JSON.stringify(results, null, 2));
