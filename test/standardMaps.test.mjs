import test from 'node:test';
import assert from 'node:assert/strict';
import { GAME_RULES } from '../rules/constants.js';
import { HEX_NEIGHBORS } from '../rules/hex.js';
import { getPlayableBoardCoordinates } from '../rules/boardLayout.js';
import { STANDARD_MAP_FAMILIES, STANDARD_MAP_POOL, getStandardMap } from '../rules/standardMaps.js';
import { applyStandardMapCaptureReward } from '../rules/standardMapEvents.js';
import { UNIT_CONFIG } from '../rules/units.js';

const key = ({ q, r }) => `${q},${r}`;
const distance = (a, b) => Math.max(
    Math.abs(a.q - b.q),
    Math.abs(a.r - b.r),
    Math.abs((-a.q - a.r) - (-b.q - b.r))
);
const radius = point => distance(point, { q: 0, r: 0 });
const rotate180 = ({ q, r }) => ({ q: -q, r: -r });
const rotate120 = ({ q, r }) => ({ q: -q - r, r: q });

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

        assert.equal(STANDARD_MAP_POOL[playerCount].length, 2);
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
    test(`${playerCount}P Uncharted Passage is ocean-dominant and player-symmetric`, () => {
        const map = getStandardMap(playerCount, 'uncharted-passage');
        const board = map.board;
        const playable = getPlayableBoardCoordinates(board);
        const playableKeys = new Set(playable.map(key));
        const water = new Map(board.surface.map(tile => [key(tile), tile.kind]));
        const players = Array.from({ length: playerCount }, (_, index) => `player${index + 1}`);

        assert.equal(map.familyId, 'uncharted-passage');
        assert.ok(board.surface.length > playable.length / 2, 'ocean must cover most of the battlefield');
        assert.deepEqual(map.captureReward, {
            type: 'neutralForcesTransfer', cityQ: 0, cityR: 0, sourceCamp: 'neutral'
        });
        assert.ok(board.cities.some(city => city.q === 0 && city.r === 0 && city.camp === 'neutral'));

        for (const camp of players) {
            const cities = board.cities.filter(city => city.camp === camp);
            const airfields = board.installations.filter(installation => installation.camp === camp && installation.type === 'airfield');
            assert.equal(cities.length, 2, `${camp} must own exactly two cities`);
            assert.equal(airfields.length, 1, `${camp} must own exactly one airport city`);
            assert.ok(cities.some(city => city.q === airfields[0].q && city.r === airfields[0].r));
        }

        const carriers = map.initialUnits.filter(unit => unit.type === 'carrier');
        assert.deepEqual(carriers, [{ type: 'carrier', camp: 'neutral', q: 2, r: -1 }]);
        assert.ok(board.ports.some(port => port.q === carriers[0].q && port.r === carriers[0].r && port.districtId === 99));

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

        const unitProfiles = players.map(camp => {
            const counts = new Map();
            for (const unit of map.initialUnits.filter(entry => entry.camp === camp)) {
                counts.set(unit.type, (counts.get(unit.type) || 0) + 1);
            }
            return [...counts].sort(([a], [b]) => a.localeCompare(b));
        });
        for (const profile of unitProfiles.slice(1)) assert.deepEqual(profile, unitProfiles[0]);

        const transform = playerCount === 3 ? rotate120 : rotate180;
        assertCoordinateSymmetry(
            board.cities.filter(city => city.camp !== 'neutral'),
            transform,
            `${playerCount}P player cities`
        );
        assertCoordinateSymmetry(
            map.initialUnits.filter(unit => unit.camp !== 'neutral'),
            transform,
            `${playerCount}P player units`,
            unit => unit.type
        );
    });
}

test('capturing the central neutral city transfers every surviving neutral force', () => {
    const player1 = { id: 'player1', name: '玩家一' };
    const neutral = { id: 'neutral', name: '中立' };
    const neutralCarrier = { type: 'carrier', camp: neutral, hp: 200 };
    const neutralInfantry = { type: 'infantry', camp: neutral, hp: 80 };
    const defeatedNeutral = { type: 'archer', camp: neutral, hp: 0 };
    const enemy = { type: 'warship', camp: { id: 'player2' }, hp: 100 };
    const state = { tiles: [neutralCarrier, neutralInfantry, defeatedNeutral, enemy].map(unit => ({ unit })) };
    const map = getStandardMap(2, 'uncharted-passage');

    const transferred = applyStandardMapCaptureReward(state, map, { q: 0, r: 0 }, neutral, player1);

    assert.deepEqual(transferred, [neutralCarrier, neutralInfantry]);
    assert.equal(neutralCarrier.camp, player1);
    assert.equal(neutralInfantry.camp, player1);
    assert.equal(defeatedNeutral.camp, neutral);
    assert.equal(enemy.camp.id, 'player2');
});

test('the preparation catalog exposes both named map families', () => {
    assert.deepEqual(STANDARD_MAP_FAMILIES.map(map => map.name), ['王冠环岛', '无主航路']);
});

test('every controlled village has the same fixed one-dollar income', () => {
    assert.equal(GAME_RULES.villageGold, 1);
});
