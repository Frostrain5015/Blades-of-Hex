import assert from 'node:assert/strict';
import {
    ATTACK_PRESENTATION,
    classifyAttackPresentation,
    getDiveStrafeMuzzlePosition,
    getDiveStrafePlanePosition,
    isRangedAttackPresentation,
    operationArrowStyleForAttacker
} from '../rules/attackPresentation.js';

assert.equal(classifyAttackPresentation({ type: 'infantry' }), ATTACK_PRESENTATION.ASSAULT);
assert.equal(classifyAttackPresentation({ type: 'cavalry' }), ATTACK_PRESENTATION.ASSAULT);
assert.equal(classifyAttackPresentation({ type: 'archer' }), ATTACK_PRESENTATION.FIRE_CANNON);
assert.equal(classifyAttackPresentation({ type: 'warship' }), ATTACK_PRESENTATION.FIRE_CANNON);
assert.equal(classifyAttackPresentation({ type: 'mgNest' }), ATTACK_PRESENTATION.FIRE_TRACER);
assert.equal(classifyAttackPresentation({ type: 'submarine' }), ATTACK_PRESENTATION.FIRE_TORPEDO);
assert.equal(classifyAttackPresentation({ type: 'carrier' }), ATTACK_PRESENTATION.FIRE_AIR_STRAFE);
assert.equal(classifyAttackPresentation({ type: 'infantry', _isDrone: true }), ATTACK_PRESENTATION.FIRE_TRACER);
assert.equal(classifyAttackPresentation({ attackerType: 'archer', attackerIsDrone: false }), ATTACK_PRESENTATION.FIRE_CANNON);
assert.equal(classifyAttackPresentation({ attackerType: 'infantry', attackerIsDrone: true }), ATTACK_PRESENTATION.FIRE_TRACER);
assert.equal(classifyAttackPresentation({ attackerType: 'submarine', attackerIsDrone: false }), ATTACK_PRESENTATION.FIRE_TORPEDO);
assert.equal(isRangedAttackPresentation('drone'), true);
assert.equal(isRangedAttackPresentation('submarine'), true);
assert.equal(operationArrowStyleForAttacker({ type: 'cavalry' }), 'assault');
assert.equal(operationArrowStyleForAttacker({ type: 'archer' }), 'fire');
assert.equal(operationArrowStyleForAttacker({ type: 'warship' }), 'fire');
assert.equal(operationArrowStyleForAttacker({ type: 'submarine' }), 'fire');

const target = { x: 500, y: 360 };
const plane = getDiveStrafePlanePosition(target.x, target.y, 600);
const muzzle = getDiveStrafeMuzzlePosition(target.x, target.y, 600);
assert.ok(plane.x < target.x && plane.y < target.y, 'strafe aircraft must still be inbound while firing');
assert.ok(muzzle.x > plane.x && muzzle.y > plane.y, 'tracers must start at the aircraft nose');
assert.notDeepEqual(muzzle, target, 'tracers must never originate at the target or carrier tile');

console.log('attackPresentation tests passed');
