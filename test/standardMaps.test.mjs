import test from 'node:test';
import assert from 'node:assert/strict';
import { GAME_RULES } from '../rules/constants.js';
import { HEX_NEIGHBORS } from '../rules/hex.js';
import { getPlayableBoardCoordinates } from '../rules/boardLayout.js';
import {
    STANDARD_MAP_FAMILIES,
    STANDARD_MAP_POOL,
    getStandardMap,
    normalizeStandardMapFamilyId
} from '../rules/standardMaps.js';
import {
    syncCityLinkedGarrisons,
    syncStandardMapCarrierControl
} from '../rules/standardMapEvents.js';
import { UNIT_CONFIG } from '../rules/units.js';
import { getFlagColors, getTileColor, PLAYER_FACTION_COLOR_KEYS } from '../rules/camps.js';
import {
    createDefaultFactions, createStandardFactions, normalizeFactionName,
    setPlayerFactionColor, setPlayerFactionFlagEmoji, setPlayerFactionFlagPreset, setPlayerFactionName
} from '../rules/diplomacy.js';
import { normalizeLevel, validateLevel } from '../campaign/runtime/schema.js';
import UNCHARTED_PASSAGE_2P_LEVEL from '../rules/maps/uncharted-passage-2p.level.json' with { type: 'json' };
import UNCHARTED_PASSAGE_3P_LEVEL from '../rules/maps/uncharted-passage-3p.level.json' with { type: 'json' };
import { buildRiverTopology } from '../rules/hydrography.js';
import { resolveRiverMovement } from '../rules/movement.js';
import { canSwitchRiverGate, chooseRiverGateLane, getRiverGate, switchRiverGate } from '../rules/riverGate.js';
import { buildWorld } from '../ai/core/perceive.js';
import { TIER_CAPABILITIES } from '../ai/core/weights.js';

const key = ({ q, r }) => `${q},${r}`;
const distance = (a, b) => Math.max(
    Math.abs(a.q - b.q),
    Math.abs(a.r - b.r),
    Math.abs((-a.q - a.r) - (-b.q - b.r))
);
const radius = point => distance(point, { q: 0, r: 0 });
const rotate180 = ({ q, r }) => ({ q: -q, r: -r });
const rotate120 = ({ q, r }) => ({ q: -q - r, r: q });

test('二战阵营预设旗帜使用对应预设名称、独立保留色及战役自定义名称保留', () => {
    const cases = [
        ['img/flags/soviet-union.svg', '苏联', 'red'],
        ['img/flags/svg/us.svg', '美国', 'usaTeal'],
        ['img/flags/svg/fr.svg', '法国', 'franceSky'],
        ['img/flags/svg/jp.svg', '日本', 'japanOlive'],
        ['img/flags/germany-iron-cross.svg', '德国', 'germanyGray']
    ];
    for (const [preset, expectedName, expectedColor] of cases) {
        const state = { factions: createStandardFactions({ flagPresets: { player1: preset } }) };
        const { player1 } = state.factions;
        assert.equal(player1.name, expectedName);
        assert.equal(player1.colorId, expectedColor);
        assert.equal(player1.color, getTileColor(expectedColor));
        const badge = getFlagColors(player1.colorId).main;
        assert.notEqual(player1.color, badge);
    }
    for (const reservedColor of ['snow', 'usaTeal', 'franceSky', 'japanOlive', 'germanyGray']) {
        assert.equal(PLAYER_FACTION_COLOR_KEYS.includes(reservedColor), false);
    }
    const campaign = createDefaultFactions([{ id: 'guard', name: '守备队', color: 'gray', flagConfig: { preset: 'img/flags/svg/us.svg' } }]);
    assert.equal(campaign.guard.colorId, 'usaTeal');
    assert.equal(campaign.guard.name, '守备队');
});

test('阵营名称独立于颜色与旗帜，清空恢复席位或预设名称', () => {
    const state = { factions: createStandardFactions() };
    const faction = state.factions.player1;
    assert.equal(normalizeFactionName('  雪原守备  '), '雪原守备');
    assert.equal(normalizeFactionName('雪原守备队远征军'), null);
    assert.equal(normalizeFactionName('东海\n守备'), null);
    assert.equal(normalizeFactionName('雪原🛡ABC'), '雪原🛡ABC');
    assert.equal(normalizeFactionName('雪原🇷🇺ABCD'), '雪原🇷🇺ABCD');
    assert.equal(faction.name, '第一阵营');
    assert.equal(setPlayerFactionName(state, 'player1', '雪原守备'), true);
    assert.equal(setPlayerFactionColor(state, 'player1', 'purple'), true);
    assert.equal(faction.name, '雪原守备');
    assert.equal(setPlayerFactionFlagPreset(state, 'player1', 'img/flags/soviet-union.svg'), true);
    assert.equal(faction.name, '雪原守备');
    assert.equal(setPlayerFactionName(state, 'player1', ''), true);
    assert.equal(faction.name, '苏联');
    assert.equal(setPlayerFactionFlagEmoji(state, 'player1', '🐉'), true);
    assert.equal(faction.name, '第一阵营');
    assert.ok(PLAYER_FACTION_COLOR_KEYS.includes(faction.colorId));
});

for (const [playerCount, source] of [[2, UNCHARTED_PASSAGE_2P_LEVEL], [3, UNCHARTED_PASSAGE_3P_LEVEL]]) {
    test(`the authored ${playerCount}P Uncharted Passage source remains editor-valid`, () => {
        const validation = validateLevel(normalizeLevel(source));
        assert.deepEqual(validation.errors, []);
        assert.deepEqual(validation.warnings, []);
    });
}

function assertCoordinateSymmetry(entries, transform, label, classifier = () => '') {
    const values = new Set(entries.map(entry => `${key(entry)}|${classifier(entry)}`));
    for (const entry of entries) {
        const transformed = transform(entry);
        assert.ok(values.has(`${key(transformed)}|${classifier(entry)}`),
            `${label} is missing symmetric counterpart for ${key(entry)}`);
    }
}

function nearestDistrict(point, cities) {
    let best = cities[0];
    let bestDistance = distance(point, best);
    for (const city of cities.slice(1)) {
        const candidateDistance = distance(point, city);
        if (candidateDistance < bestDistance) {
            best = city;
            bestDistance = candidateDistance;
        }
    }
    return best.districtId;
}

for (const playerCount of [2, 3]) {
    test(`${playerCount}P default standard map remains the large-island competitive map`, () => {
        const map = getStandardMap(playerCount);
        const board = map.board;
        const water = new Map(board.surface.map(tile => [key(tile), tile.kind]));
        const cityDistricts = new Set(board.cities.map(city => city.districtId));

        assert.equal(STANDARD_MAP_POOL[playerCount].length, playerCount === 2 ? 3 : 2);
        assert.equal(board.layout, 'borderless');
        assert.equal(board.radius, 7);
        assert.equal(getPlayableBoardCoordinates(board).length, 277);
        assert.equal(board.surface.length, 186);
        assert.equal(board.surface.filter(tile => tile.kind === 'shallowWater').length, 36);
        assert.equal(board.surface.filter(tile => tile.kind === 'deepWater').length, 150);
        assert.ok(board.surface.every(tile => radius(tile) > 5));
        assert.ok(getPlayableBoardCoordinates(board)
            .filter(tile => radius(tile) <= 5)
            .every(tile => !water.has(key(tile))), 'the radius-5 economic core must remain land');

        assert.equal(new Set(board.ports.map(key)).size, board.ports.length);
        for (const port of board.ports) {
            assert.equal(water.get(key(port)), 'shallowWater', `port ${key(port)} must be its own shallow-water tile`);
            assert.ok(HEX_NEIGHBORS.some(([dq, dr]) => !water.has(`${port.q + dq},${port.r + dr}`)),
                `port ${key(port)} must connect visually to adjacent land`);
            assert.ok(cityDistricts.has(port.districtId), `port ${key(port)} must belong to a city district`);
            assert.ok(HEX_NEIGHBORS.some(([dq, dr]) => port.q + dq === port.landQ && port.r + dr === port.landR),
                `port ${key(port)} must persist its adjacent gangway anchor`);
            assert.equal(water.has(`${port.landQ},${port.landR}`), false, `port ${key(port)} gangway must end on land`);
        }

        assert.equal(new Set(board.villages.map(key)).size, board.villages.length);
        for (const village of board.villages) {
            assert.equal(water.has(key(village)), false, `village ${key(village)} must be on land`);
            assert.equal(nearestDistrict(village, board.cities), village.districtId,
                `village ${key(village)} must belong to its nearest city`);
        }
        for (let i = 0; i < board.villages.length; i++) {
            for (let j = i + 1; j < board.villages.length; j++) {
                assert.ok(distance(board.villages[i], board.villages[j]) >= 3,
                    `villages ${key(board.villages[i])} and ${key(board.villages[j])} are too close`);
            }
        }

        const villageCountByDistrict = new Map();
        for (const village of board.villages) {
            villageCountByDistrict.set(village.districtId, (villageCountByDistrict.get(village.districtId) || 0) + 1);
        }
        for (const city of board.cities.filter(city => city.camp !== 'neutral')) {
            assert.ok(villageCountByDistrict.get(city.districtId) >= 1);
            assert.ok(villageCountByDistrict.get(city.districtId) <= 2);
        }

        const occupied = new Set();
        for (const unit of map.initialUnits) {
            const naval = UNIT_CONFIG[unit.type]?.movementDomain === 'naval';
            assert.equal(water.has(key(unit)), naval, `initial unit ${unit.type}@${key(unit)} must match its movement domain`);
            if (naval) {
                const guardsPort = board.ports.some(port => key(port) === key(unit)
                    || HEX_NEIGHBORS.some(([dq, dr]) => port.q + dq === unit.q && port.r + dr === unit.r));
                assert.ok(guardsPort, `initial naval unit ${key(unit)} must guard a port or its adjacent waters`);
            }
            assert.equal(occupied.has(key(unit)), false, `initial unit coordinate ${key(unit)} must be unique`);
            occupied.add(key(unit));
        }

        const cityCampByDistrict = new Map(board.cities.map(city => [city.districtId, city.camp]));
        for (const port of board.ports) {
            const owner = cityCampByDistrict.get(port.districtId);
            const occupants = map.initialUnits.filter(unit => key(unit) === key(port));
            assert.equal(occupants.length, 1, `port ${key(port)} must start with exactly one ship`);
            assert.equal(occupants[0].camp, owner, `port ${key(port)} ship must match its administrative owner`);
            assert.equal(occupants[0].type, owner === 'neutral' ? 'destroyer' : 'warship',
                `port ${key(port)} must receive the correct initial ship class`);
            if (owner !== 'neutral') {
                const adjacentUnits = map.initialUnits.filter(unit => unit.camp === owner
                    && UNIT_CONFIG[unit.type]?.movementDomain === 'naval'
                    && HEX_NEIGHBORS.some(([dq, dr]) => port.q + dq === unit.q && port.r + dr === unit.r));
                assert.deepEqual(adjacentUnits.map(unit => unit.type).sort(), ['destroyer', 'submarine'],
                    `player port ${key(port)} must have one destroyer and one submarine outside`);
                assert.ok(adjacentUnits.every(unit => water.has(key(unit))),
                    `player port ${key(port)} escorts must stay on water`);
            }
        }

        const transform = playerCount === 3 ? rotate120 : rotate180;
        assertCoordinateSymmetry(board.cities, transform, `${playerCount}P cities`);
        assertCoordinateSymmetry(board.villages, transform, `${playerCount}P villages`);
        assertCoordinateSymmetry(board.ports, transform, `${playerCount}P ports`);
        assertCoordinateSymmetry(map.initialUnits, transform, `${playerCount}P initial units`, unit => unit.type);
    });
}

for (const playerCount of [2, 3]) {
    test(`${playerCount}P Uncharted Passage is ocean-dominant and structurally valid`, () => {
        const map = getStandardMap(playerCount, 'uncharted-passage');
        const board = map.board;
        const playable = getPlayableBoardCoordinates(board);
        const playableKeys = new Set(playable.map(key));
        const water = new Map(board.surface.map(tile => [key(tile), tile.kind]));
        const players = Array.from({ length: playerCount }, (_, index) => `player${index + 1}`);

        assert.equal(map.familyId, 'uncharted-passage');
        assert.ok(board.surface.length > playable.length / 2, 'ocean must cover most of the battlefield');
        assert.equal(map.captureReward, undefined);
        const centralCity = board.cities.find(city => city.districtId === map.carrierControl.districtId
            && city.camp === 'neutral');
        assert.ok(centralCity);

        for (const camp of players) {
            const cities = board.cities.filter(city => city.camp === camp);
            const airfields = board.installations.filter(installation => installation.camp === camp && installation.type === 'airfield');
            assert.equal(cities.length, 1, `${camp} must own exactly one home city`);
            assert.equal(airfields.length, 1, `${camp} must own exactly one airport city`);
            assert.ok(cities.some(city => city.q === airfields[0].q && city.r === airfields[0].r));
        }

        const carriers = map.initialUnits.filter(unit => unit.type === 'carrier');
        assert.equal(carriers.length, 1);
        assert.equal(carriers[0].camp, 'neutral');
        assert.ok(board.ports.some(port => port.q === carriers[0].q && port.r === carriers[0].r));

        const occupied = new Set();
        for (const unit of map.initialUnits) {
            const naval = UNIT_CONFIG[unit.type]?.movementDomain === 'naval';
            assert.ok(playableKeys.has(key(unit)), `${unit.type}@${key(unit)} must be playable`);
            assert.equal(water.has(key(unit)), naval, `${unit.type}@${key(unit)} must match its movement domain`);
            assert.equal(occupied.has(key(unit)), false, `unit coordinate ${key(unit)} must be unique`);
            occupied.add(key(unit));
        }

        for (const port of board.ports) {
            assert.equal(water.get(key(port)), 'shallowWater', `port ${key(port)} must be shallow water`);
            assert.equal(water.has(`${port.landQ},${port.landR}`), false, `port ${key(port)} must have a land gangway`);
            assert.ok(HEX_NEIGHBORS.some(([dq, dr]) => port.q + dq === port.landQ && port.r + dr === port.landR));
        }

        const expected = playerCount === 2
            ? { mountains: 9, forests: 26, cities: 6, neutralCities: 4, airfields: 3, ports: 5, units: 44, carrier: { q: 1, r: -1 }, districtId: 5 }
            : { mountains: 11, forests: 36, cities: 9, neutralCities: 6, airfields: 7, ports: 9, units: 61, carrier: { q: 0, r: 0 }, districtId: 7 };
        assert.equal(map.randomTerrain, false);
        assert.equal(board.terrain.filter(tile => tile.type === 'mountain').length, expected.mountains);
        assert.equal(board.terrain.filter(tile => tile.type === 'forest').length, expected.forests);
        assert.equal(board.cities.length, expected.cities);
        assert.equal(board.cities.filter(city => city.camp === 'neutral').length, expected.neutralCities);
        assert.equal(board.installations.length, expected.airfields);
        assert.equal(board.ports.length, expected.ports);
        assert.equal(map.initialUnits.length, expected.units);
        assert.deepEqual(carriers[0], { type: 'carrier', camp: 'neutral', ...expected.carrier });
        assert.deepEqual(map.carrierControl, {
            portQ: expected.carrier.q,
            portR: expected.carrier.r,
            districtId: expected.districtId
        });
    });
}

test('capturing the central city transfers only its carrier, not neutral armies', () => {
    const player1 = { id: 'player1', name: '玩家一' };
    const neutral = { id: 'neutral', name: '中立' };
    const neutralCarrier = { type: 'carrier', camp: neutral, hp: 200 };
    const neutralInfantry = { type: 'infantry', camp: neutral, hp: 80 };
    const defeatedNeutral = { type: 'archer', camp: neutral, hp: 0 };
    const enemy = { type: 'warship', camp: { id: 'player2' }, hp: 100 };
    const state = { tiles: [neutralCarrier, neutralInfantry, defeatedNeutral, enemy].map(unit => ({ unit })) };
    const map = getStandardMap(2, 'uncharted-passage');

    const transferred = syncStandardMapCarrierControl(state, map, map.carrierControl.districtId, player1);

    assert.deepEqual(transferred, [neutralCarrier]);
    assert.equal(neutralCarrier.camp, player1);
    assert.equal(neutralInfantry.camp, neutral);
    assert.equal(defeatedNeutral.camp, neutral);
    assert.equal(enemy.camp.id, 'player2');
});

test('island batteries follow their own city instead of the central prize', () => {
    const player1 = { id: 'player1', name: '玩家一' };
    const player2 = { id: 'player2', name: '玩家二' };
    const neutral = { id: 'neutral', name: '中立' };
    const map = getStandardMap(2, 'uncharted-passage');

    // 2P：南岛（district 8，城市 (-3,6)）的两门中立岸防炮被识别为城防联动；
    // 3P 的南岛属于 player3，中立岸防炮都不在任何中立城市行政区内，无联动。
    assert.deepEqual(map.cityLinkedUnits, [
        { q: -6, r: 6, cityQ: -3, cityR: 6 },
        { q: 0, r: 6, cityQ: -3, cityR: 6 }
    ]);
    assert.deepEqual(getStandardMap(3, 'uncharted-passage').cityLinkedUnits, []);

    const battery = { type: 'shoreBattery', camp: neutral, hp: 150, _followsCity: { q: -3, r: 6 } };
    const infantry = { type: 'infantry', camp: neutral, hp: 80 };
    const state = { tiles: [{ unit: battery }, { unit: infantry }] };

    assert.deepEqual(syncStandardMapCarrierControl(state, map, map.carrierControl.districtId, player1), []);
    assert.equal(battery.camp, neutral);
    assert.equal(infantry.camp, neutral);

    // 南岛城市易主：联动岸防炮随城转换，可反复易主，其他城市易主不影响
    assert.deepEqual(syncCityLinkedGarrisons(state, { q: -3, r: 6 }, player1), [battery]);
    assert.equal(battery.camp, player1);
    assert.deepEqual(syncCityLinkedGarrisons(state, { q: -3, r: 6 }, player1), []);
    assert.deepEqual(syncCityLinkedGarrisons(state, { q: 1, r: -2 }, player2), []);
    assert.equal(battery.camp, player1);
    assert.deepEqual(syncCityLinkedGarrisons(state, { q: -3, r: 6 }, player2), [battery]);
    assert.equal(battery.camp, player2);
});

test('the prize carrier follows the central port district on every recapture', () => {
    const player1 = { id: 'player1' };
    const player2 = { id: 'player2' };
    const carrier = { type: 'carrier', camp: player1, hp: 200 };
    const escort = { type: 'destroyer', camp: player1, hp: 100 };
    const state = { tiles: [{ unit: carrier }, { unit: escort }] };
    const map = getStandardMap(3, 'uncharted-passage');

    assert.deepEqual(syncStandardMapCarrierControl(state, map, 999, player2), []);
    assert.equal(carrier.camp, player1);
    assert.deepEqual(syncStandardMapCarrierControl(state, map, map.carrierControl.districtId, player2), [carrier]);
    assert.equal(carrier.camp, player2);
    assert.equal(escort.camp, player1);
});

test('the preparation catalog exposes all three named map families without prototype flags', () => {
    assert.deepEqual(STANDARD_MAP_FAMILIES.map(map => map.name), ['王冠环岛', '无主航路', '河谷防线']);
    assert.equal(STANDARD_MAP_FAMILIES.every(map => !map.prototype), true);
    assert.equal(getStandardMap(3, 'river-valley').familyId, 'crown-ring');
});

test('river-valley 2P board layout is playable, balanced, and non-naval', () => {
    const map = getStandardMap(2, 'river-valley');
    assert.equal(map.id, 'river-valley-2p');
    assert.equal(map.board.cities.length, 5);
    assert.equal(map.board.villages.length, 2);
    assert.equal(map.board.districts.length, 169);
    const gate = map.board.cities.find(c => c.q === 1 && c.r === -1);
    assert.equal(gate.camp, 'neutral');
    assert.equal(gate.hpPct, 60);
    assert.equal(distance(map.board.cities[0], gate), distance(map.board.cities[1], gate));
    assert.equal(
        map.initialUnits.filter(u => u.camp === 'player1').length,
        map.initialUnits.filter(u => u.camp === 'player2').length
    );
});

test('河谷双人原型的水闸每轮切换一次，封住相应河段并保留中桥', () => {
    const map = getStandardMap(2, 'river-valley');
    const player1 = { id: 'player1' };
    const player2 = { id: 'player2' };
    const state = {
        standardMapId: map.familyId, turnCounter: 0, turnOrder: ['player1', 'player2', 'neutral'],
        currentCamp: player1, riverTopology: buildRiverTopology(map.board.rivers, map.board.crossings)
    };
    const gate = { ...getRiverGate(state), isCity: true, camp: player2 };
    const cross = r => {
        const q = -Math.ceil(r / 2);
        return resolveRiverMovement({ q, r }, { q: q + 1, r }, state);
    };
    assert.equal(map.board.districts.find(tile => tile.q === gate.q && tile.r === gate.r).districtId, 5);
    assert.equal(cross(-5).kind, 'flooded');
    assert.equal(cross(-4).blocked, true, '封渡须覆盖邻近的绕行河段');
    assert.equal(cross(-1).kind, 'bridge');
    assert.equal(cross(5).kind, 'ford');
    assert.equal(canSwitchRiverGate(state, gate), false);
    gate.camp = player1;
    assert.equal(switchRiverGate(state, gate), true);
    assert.equal(switchRiverGate(state, gate), false);
    assert.equal(cross(-5).kind, 'bridge');
    assert.equal(cross(-1).kind, 'bridge');
    assert.equal(cross(5).blocked, true);
    state.turnCounter = 3;
    assert.equal(switchRiverGate(state, gate), true);
    assert.equal(cross(5).kind, 'ford');
});

test('river-valley AI chooses river gate lane tactically and navigates around flooded banks', () => {
    const factions = createDefaultFactions();
    const { player1, player2, neutral } = factions;
    const state = {
        standardMapId: 'river-valley',
        isThreePlayer: false,
        turnCounter: 3,
        turnOrder: ['player1', 'player2', 'neutral'],
        currentCamp: player2,
        factions,
        tiles: [],
        tileMap: new Map(),
        playerGold: { player1: 20, player2: 20, neutral: 10 },
        playerHands: { player1: [], player2: [], neutral: [] },
        playerDrawsThisTurn: { player1: 0, player2: 0, neutral: 0 },
        playerUsesThisTurn: { player1: 0, player2: 0, neutral: 0 },
        riverGate: { openLane: 'south', changedRound: -1 }
    };
    const map = getStandardMap(2, 'river-valley');
    state.rivers = map.board.rivers;
    state.riverCrossings = map.board.crossings;
    state.riverTopology = buildRiverTopology(map.board.rivers, map.board.crossings);
    for (const coord of getPlayableBoardCoordinates({ radius: map.board.radius, layout: map.board.layout })) {
        const tile = {
            q: coord.q,
            r: coord.r,
            s: -coord.q - coord.r,
            surface: 'land',
            terrain: 'plains',
            camp: neutral,
            isCity: false,
            hp: 0,
            maxHp: 0,
            districtId: null,
            unit: null
        };
        state.tiles.push(tile);
        state.tileMap.set(`${tile.q},${tile.r}`, tile);
    }
    for (const city of map.board.cities) {
        const tile = state.tileMap.get(`${city.q},${city.r}`);
        tile.isCity = true;
        tile.districtId = city.districtId;
        tile.hp = city.hpPct ? Math.round(100 * city.hpPct / 100) : 100;
        tile.maxHp = 100;
        tile.camp = city.camp === 'player1' ? player1 : city.camp === 'player2' ? player2 : neutral;
    }

    // 2) Pathing around flooded north river segment: east bank (2,-3) -> west bank (0,-3) detours via open crossings.
    const world = buildWorld(state, {
        HEX_NEIGHBORS,
        hexDistance: distance,
        isHostileFaction: (a, b) => a !== b,
        isTileVisible: () => true
    }, player2, TIER_CAPABILITIES.hard);
    assert.equal(world.hasRivers, true);
    const eastBankNorth = state.tileMap.get('2,-3');
    const westNorthCity = state.tileMap.get('0,-3');
    assert.equal(distance(eastBankNorth, westNorthCity), 2);
    assert.ok(world.navDistance(eastBankNorth, westNorthCity) > 2, 'navDistance routes around flooded north bank');

    // 3) Gate decision: no units at flanks -> keep current lane ('south').
    assert.equal(chooseRiverGateLane(state, player2), 'south');

    // East-bank friendly unit poised near north bridge facing west-bank target -> open north bridge.
    state.tileMap.get('3,-5').unit = { camp: player2, hp: 100, config: UNIT_CONFIG.infantry };
    assert.equal(chooseRiverGateLane(state, player2), 'north');

    // Defensive flip: enemy threatening open south ford against our east-bank south city -> flood south by switching to 'north'.
    state.tileMap.get('3,-5').unit = null;
    state.tileMap.get('1,3').camp = player2;
    state.tileMap.get('-3,5').unit = { camp: player1, hp: 100, config: UNIT_CONFIG.infantry };
    assert.equal(chooseRiverGateLane(state, player2), 'north');
});

test('self-play legacy concrete map ids normalize to the intended map family', () => {
    assert.equal(normalizeStandardMapFamilyId('grand-island-2p'), 'crown-ring');
    assert.equal(normalizeStandardMapFamilyId('grand-island-3p'), 'crown-ring');
    assert.equal(normalizeStandardMapFamilyId('uncharted-passage-2p'), 'uncharted-passage');
    assert.equal(normalizeStandardMapFamilyId('uncharted-passage-3p'), 'uncharted-passage');
    assert.equal(getStandardMap(2, 'uncharted-passage-2p').familyId, 'uncharted-passage');
    assert.equal(getStandardMap(3, 'uncharted-passage-3p').familyId, 'uncharted-passage');
});

test('every controlled village has the same fixed one-dollar income', () => {
    assert.equal(GAME_RULES.villageGold, 1);
});
