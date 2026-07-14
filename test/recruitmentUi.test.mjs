import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    RECRUITMENT_OPTIONS,
    canRecruitTypeAtSelectedCity,
    shouldShowRecruitmentOption
} from '../js/recruitmentUi.js';

const player1 = { id: 'player1', name: 'P1' };
const player2 = { id: 'player2', name: 'P2' };
const state = { currentCamp: player1, portTiles: new Map() };
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

test('warship recruitment is structurally legal only at an own empty port city', () => {
    const port = city({ isPort: true });
    assert.equal(canRecruitTypeAtSelectedCity('warship', port, state), true);
    assert.equal(canRecruitTypeAtSelectedCity('warship', city(), state), false);
    assert.equal(canRecruitTypeAtSelectedCity('warship', city({ camp: player2, isPort: true }), state), false);
    assert.equal(canRecruitTypeAtSelectedCity('warship', city({ unit: {}, isPort: true }), state), false);
    assert.equal(canRecruitTypeAtSelectedCity('warship', city({ isCity: false, isPort: true }), state), false);
});

test('port-only option stays hidden until the selected city is a legal warship origin', () => {
    assert.equal(shouldShowRecruitmentOption(shipOption, null, state), false);
    assert.equal(shouldShowRecruitmentOption(shipOption, city(), state), false);
    assert.equal(shouldShowRecruitmentOption(shipOption, city({ isPort: true }), state), true);
});

test('authored port map is honored even before the tile flag is materialized', () => {
    const authoredPort = city({ q: 4, r: -2 });
    const authoredState = {
        currentCamp: player1,
        portTiles: new Map([['4,-2', authoredPort]])
    };
    assert.equal(canRecruitTypeAtSelectedCity('warship', authoredPort, authoredState), true);
});

test('land recruitment remains available at ordinary own empty cities', () => {
    const ordinaryCity = city();
    assert.equal(canRecruitTypeAtSelectedCity('infantry', ordinaryCity, state), true);
    assert.equal(shouldShowRecruitmentOption(RECRUITMENT_OPTIONS[0], ordinaryCity, state), true);
    assert.equal(shouldShowRecruitmentOption(RECRUITMENT_OPTIONS[0], city({ isVillage: true }), state), false);
});

test('the fourth recruitment shortcut is reserved for warships', () => {
    assert.equal(RECRUITMENT_OPTIONS.find(option => option.shortcut === '4')?.type, 'warship');
});
