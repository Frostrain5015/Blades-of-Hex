import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    canBuildShoreBattery,
    canUnitTargetUnit,
    capturePort,
    clearPortDepartureState,
    getCrossDomainDamageBonus,
    isPortGuarded,
    isPortOperationalFor,
    isSubmarineTargetableBy,
    recordShoreBatteryBuilt,
    repairShipsAtTurnStart,
    restoreSurrenderedPorts
} from '../rules/naval.js';

const p1 = { id: 'player1', name: 'P1' };
const p2 = { id: 'player2', name: 'P2' };

function tile(q, r, surface = 'land', extra = {}) {
    return { q, r, s: -q - r, surface, playable: true, unit: null, ...extra };
}

function state(tiles, turnCounter = 0) {
    return {
        tiles,
        tileMap: new Map(tiles.map(value => [`${value.q},${value.r}`, value])),
        turnCounter,
        turnOrder: ['player1', 'player2'],
        factions: { player1: p1, player2: p2, neutral: { id: 'neutral' } }
    };
}

test('cross-domain damage bonuses share the additive damage-up bucket', () => {
    const land = tile(0, 0);
    const sea = tile(1, 0, 'deepWater');
    const infantry = { type: 'infantry', tile: land };
    const battery = { type: 'shoreBattery', tile: land };
    const destroyer = { type: 'destroyer', tile: sea };
    const cruiser = { type: 'warship', tile: sea };
    const transport = { type: 'infantry', tile: sea, isEmbarked: true };

    assert.equal(getCrossDomainDamageBonus(destroyer, infantry), -0.5);
    assert.equal(getCrossDomainDamageBonus(cruiser, infantry), -0.5);
    assert.equal(getCrossDomainDamageBonus(infantry, destroyer), -0.5);
    assert.equal(getCrossDomainDamageBonus(battery, destroyer), 0.3);
    assert.equal(getCrossDomainDamageBonus(battery, transport), 0.3);
    assert.equal(getCrossDomainDamageBonus(battery, infantry), -0.6);
});

test('submarines stay visible but cannot be primary targets until exposed or detected', () => {
    const subTile = tile(0, 0, 'deepWater');
    const attackerTile = tile(3, 0, 'deepWater');
    const sub = { id: 9, type: 'submarine', camp: p2, tile: subTile, hp: 100, _rank: 0 };
    const attacker = { type: 'warship', camp: p1, tile: attackerTile, hp: 200 };
    subTile.unit = sub;
    attackerTile.unit = attacker;
    const match = state([subTile, attackerTile]);

    assert.equal(isSubmarineTargetableBy(sub, p1, match), true);
    assert.equal(canUnitTargetUnit(attacker, sub, match), true);
    sub._rank = 1;
    assert.equal(isSubmarineTargetableBy(sub, p1, match), false);
    assert.equal(canUnitTargetUnit(attacker, sub, match), false);
    sub._submarineAttackExposed = true;
    assert.equal(canUnitTargetUnit(attacker, sub, match), true);
    sub._submarineAttackExposed = false;
    attacker.type = 'destroyer';
    attacker.specializationKey = 'antiSubDestroyer';
    attacker.getSpecializationAbility = key => key === 'submarineDetectionRadius' ? 2 : null;
    attackerTile.q = 2;
    attackerTile.s = -2;
    match.tileMap = new Map(match.tiles.map(value => [`${value.q},${value.r}`, value]));
    assert.equal(isSubmarineTargetableBy(sub, p1, match), true);
});

test('port capture drains movement, guards one round and preserves control after departure', () => {
    const city = tile(0, 0, 'land', { isCity: true, districtId: 4, camp: p2 });
    const port = tile(1, 0, 'shallowWater', { isPort: true, districtId: 4, camp: p2 });
    const sea = tile(2, 0, 'shallowWater');
    const ship = { type: 'destroyer', camp: p1, tile: port, remainingMP: 4 };
    port.unit = ship;
    const match = state([city, port, sea]);

    assert.equal(capturePort(match, port, ship), true);
    assert.equal(ship.remainingMP, 0);
    assert.equal(isPortGuarded(ship, match), true);
    assert.equal(isPortOperationalFor(port, p1, match), false);
    match.turnCounter = 2;
    assert.equal(isPortGuarded(ship, match), false);
    assert.equal(isPortOperationalFor(port, p1, match), true);
    clearPortDepartureState(ship, port, sea);
    assert.equal(port.camp, p1);
    restoreSurrenderedPorts(match, p1);
    assert.equal(port.camp, p2);
});

test('leaving a captured port clears submarine port exposure even when entering another port', () => {
    const from = tile(0, 0, 'shallowWater', { isPort: true, camp: p1 });
    const to = tile(1, 0, 'shallowWater', { isPort: true, camp: p1 });
    const sub = {
        type: 'submarine', camp: p1, tile: from,
        _portGuardUntilRound: 3, _submarinePortRevealUntilRound: 4
    };
    clearPortDepartureState(sub, from, to);
    assert.equal(sub._portGuardUntilRound, 0);
    assert.equal(sub._submarinePortRevealUntilRound, 0);
});

test('friendly operational ports repair regular ships and shore batteries share a faction cooldown', () => {
    const port = tile(0, 0, 'shallowWater', { isPort: true, camp: p1 });
    const ship = {
        type: 'warship', camp: p1, tile: port, hp: 150, maxHp: 200,
        heal(amount) { this.hp += amount; }
    };
    port.unit = ship;
    const match = state([port]);
    assert.equal(repairShipsAtTurnStart(match, p1)[0].amount, 20);
    assert.equal(ship.hp, 170);

    assert.equal(canBuildShoreBattery(match, p1), true);
    recordShoreBatteryBuilt(match, p1);
    assert.equal(canBuildShoreBattery(match, p1), false);
    match.turnCounter = 4;
    assert.equal(canBuildShoreBattery(match, p1), true);
});
