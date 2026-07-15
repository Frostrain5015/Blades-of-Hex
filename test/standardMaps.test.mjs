import test from 'node:test';
import assert from 'node:assert/strict';
import { GAME_RULES } from '../rules/constants.js';
import { HEX_NEIGHBORS } from '../rules/hex.js';
import { getPlayableBoardCoordinates } from '../rules/boardLayout.js';
import { STANDARD_MAP_POOL, getStandardMap } from '../rules/standardMaps.js';
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
    test(`${playerCount}P standard map pool exposes a fixed large-island competitive map`, () => {
        const map = getStandardMap(playerCount);
        const board = map.board;
        const water = new Map(board.surface.map(tile => [key(tile), tile.kind]));
        const cityDistricts = new Set(board.cities.map(city => city.districtId));

        assert.equal(STANDARD_MAP_POOL[playerCount].length, 1);
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

test('every controlled village has the same fixed one-dollar income', () => {
    assert.equal(GAME_RULES.villageGold, 1);
});
