import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    RECRUITMENT_OPTIONS,
    canRecruitTypeAtSelectedSite,
    getRecruitmentOptionsForTile,
    getRecruitmentSiteKind,
    shouldShowRecruitmentOption
} from '../js/recruitmentUi.js';
import { createDefaultFactions } from '../rules/diplomacy.js';

const player1 = { id: 'player1', name: 'P1' };
const player2 = { id: 'player2', name: 'P2' };
const state = { currentCamp: player1, portTiles: new Map(), turnCounter: 0, turnOrder: ['player1', 'player2'] };
const shipOption = RECRUITMENT_OPTIONS.find(option => option.type === 'warship');

function city(extra = {}) {
    return {
        q: 0,
        r: 0,
        surface: 'land',
        playable: true,
        isCity: true,
        isVillage: false,
        camp: player1,
        unit: null,
        ...extra
    };
}

test('warship recruitment is structurally legal only at an own empty independent water port', () => {
    const port = city({ surface: 'shallowWater', isCity: false, isPort: true });
    assert.equal(canRecruitTypeAtSelectedSite('warship', port, state), true);
    assert.equal(canRecruitTypeAtSelectedSite('warship', city(), state), false);
    assert.equal(canRecruitTypeAtSelectedSite('warship', { ...port, camp: player2 }, state), false);
    assert.equal(canRecruitTypeAtSelectedSite('warship', { ...port, unit: {} }, state), false);
    assert.equal(canRecruitTypeAtSelectedSite('warship', city({ isPort: true }), state), false);
});

test('port-only option stays hidden until the selected city is a legal warship origin', () => {
    assert.equal(shouldShowRecruitmentOption(shipOption, null, state), false);
    assert.equal(shouldShowRecruitmentOption(shipOption, city(), state), false);
    assert.equal(shouldShowRecruitmentOption(shipOption, city({ surface: 'shallowWater', isCity: false, isPort: true }), state), true);
});

test('a water tile without the port flag is not a recruitment site', () => {
    const water = city({ q: 4, r: -2, surface: 'shallowWater', isCity: false });
    assert.equal(canRecruitTypeAtSelectedSite('warship', water, state), false);
});

test('land recruitment remains available at ordinary own empty cities', () => {
    const ordinaryCity = city();
    assert.equal(canRecruitTypeAtSelectedSite('infantry', ordinaryCity, state), true);
    assert.equal(shouldShowRecruitmentOption(RECRUITMENT_OPTIONS[0], ordinaryCity, state), true);
    assert.equal(shouldShowRecruitmentOption(RECRUITMENT_OPTIONS[0], city({ isCity: false, isVillage: true }), state), false);
});

test('a faction-level recruitment ban blocks every city even when the global mechanic is enabled', () => {
    const blockedCamp = createDefaultFactions([
        { id: 'player1', name: 'P1', color: 'red', canRecruit: false }
    ]).player1;
    const blockedCity = city({ camp: blockedCamp });
    assert.equal(blockedCamp.canRecruit, false);
    assert.equal(canRecruitTypeAtSelectedSite('infantry', blockedCity, state, blockedCamp), false);
    assert.equal(canRecruitTypeAtSelectedSite('cavalry', blockedCity, state, blockedCamp), false);
    assert.equal(canRecruitTypeAtSelectedSite('archer', blockedCity, state, blockedCamp), false);
});

test('recruitment interface only exposes units at cities and ports; coastal defense uses construction', () => {
    const ordinaryCity = city();
    const port = city({ q: 1, surface: 'shallowWater', isCity: false, isPort: true });
    const coast = city({ q: 2, isCity: false });
    const adjacentWater = city({ q: 3, isCity: false, surface: 'shallowWater' });
    const siteState = {
        ...state,
        tiles: [ordinaryCity, port, coast, adjacentWater],
        tileMap: new Map([
            ['0,0', ordinaryCity], ['1,0', port], ['2,0', coast], ['3,0', adjacentWater]
        ])
    };

    assert.equal(getRecruitmentSiteKind(ordinaryCity, siteState), 'city');
    assert.equal(getRecruitmentSiteKind(port, siteState), 'port');
    assert.equal(getRecruitmentSiteKind(coast, siteState), null);
    assert.deepEqual(getRecruitmentOptionsForTile(ordinaryCity, siteState).map(option => option.type), ['infantry', 'cavalry', 'archer']);
    assert.deepEqual(getRecruitmentOptionsForTile(port, siteState).map(option => option.type), ['destroyer', 'warship', 'submarine']);
    assert.equal(canRecruitTypeAtSelectedSite('carrier', port, siteState), false);
    assert.deepEqual(getRecruitmentOptionsForTile(coast, siteState), []);
    assert.equal(canRecruitTypeAtSelectedSite('shoreBattery', coast, siteState), false);
    assert.equal(canRecruitTypeAtSelectedSite('infantry', coast, siteState), false);
});
