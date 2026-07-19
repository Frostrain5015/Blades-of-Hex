import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { createDefaultLevel, normalizeLevel, validateLevel } from '../campaign/runtime/schema.js';
import { getStandardMap } from '../rules/standardMaps.js';

const OUTPUT_DIRECTORY = new URL('../docs/map-drafts/', import.meta.url);
const PLAYER_COLORS = ['red', 'blue', 'green'];

function relationMatrix(factionIds) {
    return Object.fromEntries(factionIds.map(left => [
        left,
        Object.fromEntries(factionIds
            .filter(right => right !== left)
            .map(right => [right, 'enemy']))
    ]));
}

function editorCamp(camp) {
    return camp === 'neutral' ? 'freeport' : camp;
}

function createEditorLevel(playerCount) {
    const standardMap = getStandardMap(playerCount, 'uncharted-passage');
    const playerIds = Array.from({ length: playerCount }, (_, index) => `player${index + 1}`);
    const factionIds = [...playerIds, 'freeport'];
    const factions = [
        ...playerIds.map((id, index) => ({
            id,
            name: `第${index + 1}阵营`,
            note: '标准对局玩家出生阵营',
            color: PLAYER_COLORS[index],
            controller: index === 0 ? 'human' : 'scripted',
            participatesInTurns: true,
            active: true
        })),
        {
            id: 'freeport',
            name: '中央自由港',
            note: '编辑器占位阵营；接回标准对局时映射为系统 neutral，并恢复占城后中立残军与航母转移规则。',
            color: 'gray',
            controller: 'scripted',
            participatesInTurns: false,
            active: true
        }
    ];
    const base = createDefaultLevel();
    const level = {
        ...base,
        id: `uncharted-passage-v2-${playerCount}p`,
        title: `无主航路 v2（${playerCount === 2 ? '双人' : '三人'}）`,
        chronicleId: 'standard-match',
        intro: {
            campaignTitle: '标准对局地图',
            chapterTitle: '无主航路',
            scenarioSubtitle: `${playerCount}人编辑稿 v2`
        },
        localPlayerCamp: 'player1',
        factions,
        turnOrder: playerIds,
        diplomacy: relationMatrix(factionIds),
        aiOpponentCamp: 'player2',
        gold: Object.fromEntries(factionIds.map(id => [id, id === 'freeport' ? 0 : 13])),
        hands: Object.fromEntries(factionIds.map(id => [id, []])),
        board: {
            ...standardMap.board,
            cities: standardMap.board.cities.map(city => ({ ...city, camp: editorCamp(city.camp) })),
            installations: standardMap.board.installations.map(installation => ({
                ...installation,
                camp: editorCamp(installation.camp)
            })),
            rivers: [],
            crossings: []
        },
        units: standardMap.initialUnits.map((unit, index) => ({
            id: `v2_${String(index + 1).padStart(2, '0')}_${unit.type}`,
            ...unit,
            camp: editorCamp(unit.camp),
            hpPct: 100,
            morale: 2,
            canAct: true
        })),
        standardMapMetadata: {
            familyId: 'uncharted-passage',
            revision: 'v2',
            playerCount,
            neutralEditorCamp: 'freeport',
            neutralRuntimeCamp: 'neutral',
            captureReward: standardMap.captureReward
        }
    };
    return normalizeLevel(level);
}

for (const playerCount of [2, 3]) {
    const level = createEditorLevel(playerCount);
    const validation = validateLevel(level);
    if (validation.errors.length) {
        throw new Error(`${playerCount}P export validation failed:\n${validation.errors.join('\n')}`);
    }
    const filename = `uncharted-passage-v2-${playerCount}p.level.json`;
    await writeFile(new URL(filename, OUTPUT_DIRECTORY), `${JSON.stringify(level, null, 2)}\n`, 'utf8');
    console.log(`${filename}: ${level.board.surface.length} water tiles, ${level.board.cities.length} cities, ${level.units.length} units, ${validation.warnings.length} warnings`);
}

console.log(`Exported to ${fileURLToPath(OUTPUT_DIRECTORY)}`);
