import assert from 'node:assert/strict';
import {
    MOVEMENT_REGION_REVEAL,
    axialDistance,
    resolveMovementTileReveal
} from '../js/movementRegionAnimation.js';

const origin = { q: 0, r: 0 };
assert.equal(axialDistance(origin, { q: 2, r: -1 }), 2);
assert.equal(axialDistance(origin, { q: -2, r: 1 }), 2);

const selectionTime = 1000;
const near = resolveMovementTileReveal(origin, { q: 1, r: 0 }, 1150, selectionTime);
const far = resolveMovementTileReveal(origin, { q: 4, r: -2 }, 1150, selectionTime);
assert.ok(near.progress > far.progress, 'distance wave must reveal nearby legal tiles first');
assert.ok(near.alpha > far.alpha, 'distance wave must fade nearby legal tiles first');

const settled = resolveMovementTileReveal(origin, { q: 6, r: -3 }, 5000, selectionTime);
assert.equal(settled.progress, 1);
assert.equal(settled.scale, MOVEMENT_REGION_REVEAL.settledScale);
assert.equal(settled.alpha, MOVEMENT_REGION_REVEAL.settledAlpha);

const reduced = resolveMovementTileReveal(origin, { q: 6, r: -3 }, 1000, selectionTime, { reducedMotion: true });
assert.equal(reduced.progress, 1, 'reduced motion must immediately show the complete legal set');
assert.equal(reduced.alpha, MOVEMENT_REGION_REVEAL.settledAlpha);

console.log('movementRegionAnimation: all assertions passed');
