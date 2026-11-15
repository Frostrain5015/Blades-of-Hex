import assert from 'node:assert/strict';
import test from 'node:test';
import { FIRE_SEA_FADE_IN_MS, FIRE_SEA_FADE_OUT_MS, resolveFireSeaVisual } from '../js/fireSeaPresentation.js';

const fire = () => ({ roundsRemaining: 2 });

test('火海从弹着时淡入，规则过期后逐渐熄灭', () => {
    const impact = 1200;
    const tile = { fireSea: fire(), _fireSeaVisualDelayUntil: impact };
    assert.equal(resolveFireSeaVisual(tile, impact - 10), null);
    assert.equal(resolveFireSeaVisual(tile, impact + FIRE_SEA_FADE_IN_MS / 2).alpha, 0.5);
    const expires = impact + FIRE_SEA_FADE_IN_MS;
    assert.equal(resolveFireSeaVisual(tile, expires).alpha, 1);
    tile.fireSea = null;
    assert.equal(resolveFireSeaVisual(tile, expires).alpha, 1);
    assert.equal(resolveFireSeaVisual(tile, expires + FIRE_SEA_FADE_OUT_MS / 2).alpha, 0.5);
    assert.equal(resolveFireSeaVisual(tile, expires + FIRE_SEA_FADE_OUT_MS), null);
    assert.equal(tile._fireSeaVisual, null);
});

test('二次空袭在弹着前维持原火势，熄灭途中再点燃时透明度连续', () => {
    const tile = { fireSea: fire() };
    resolveFireSeaVisual(tile, 0);
    tile.fireSea = fire();
    tile._fireSeaVisualDelayUntil = 900;
    assert.deepEqual(resolveFireSeaVisual(tile, 800), { alpha: 1, layers: 1 });
    assert.deepEqual(resolveFireSeaVisual(tile, 900), { alpha: 1, layers: 1 });
    tile.fireSea = null;
    resolveFireSeaVisual(tile, 900);
    tile.fireSea = fire();
    const restart = 900 + FIRE_SEA_FADE_OUT_MS / 2;
    assert.deepEqual(resolveFireSeaVisual(tile, restart), { alpha: 0.5, layers: 1 });
    assert.deepEqual(resolveFireSeaVisual(tile, restart + FIRE_SEA_FADE_IN_MS), { alpha: 1, layers: 1 });
});
