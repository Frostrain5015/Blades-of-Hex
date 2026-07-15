import assert from 'node:assert/strict';
import { getActivePlayerKeys, getSurvivingPlayerKeys, hasFactionSurrendered } from '../rules/matchOutcome.js';

function state(playerCount, surrendered = []) {
    const factions = {
        player1: { id: 'player1', active: true },
        player2: { id: 'player2', active: true },
        player3: { id: 'player3', active: playerCount === 3 },
        neutral: { id: 'neutral', active: true }
    };
    return {
        factions,
        turnOrder: playerCount === 3
            ? ['player1', 'neutral', 'player2', 'player3']
            : ['neutral', 'player1', 'player2'],
        surrenderedCamps: surrendered.map(key => factions[key])
    };
}

{
    const match = state(2);
    assert.deepEqual(getActivePlayerKeys(match), ['player1', 'player2']);
    assert.deepEqual(getSurvivingPlayerKeys(match, match.factions.player1), ['player2']);
}

{
    const match = state(3, ['player1']);
    assert.equal(hasFactionSurrendered(match, 'player1'), true);
    assert.deepEqual(getSurvivingPlayerKeys(match, match.factions.player2), ['player3']);
}

console.log('matchOutcome: ok');
