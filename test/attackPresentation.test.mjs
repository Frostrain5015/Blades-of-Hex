import assert from 'node:assert/strict';
import {
    ATTACK_PRESENTATION,
    classifyAttackPresentation,
    isRangedAttackPresentation,
    operationArrowStyleForAttacker
} from '../rules/attackPresentation.js';

assert.equal(classifyAttackPresentation({ type: 'infantry' }), ATTACK_PRESENTATION.ASSAULT);
assert.equal(classifyAttackPresentation({ type: 'cavalry' }), ATTACK_PRESENTATION.ASSAULT);
assert.equal(classifyAttackPresentation({ type: 'archer' }), ATTACK_PRESENTATION.FIRE_CANNON);
assert.equal(classifyAttackPresentation({ type: 'warship' }), ATTACK_PRESENTATION.FIRE_CANNON);
assert.equal(classifyAttackPresentation({ type: 'mgNest' }), ATTACK_PRESENTATION.FIRE_TRACER);
assert.equal(classifyAttackPresentation({ type: 'infantry', _isDrone: true }), ATTACK_PRESENTATION.FIRE_TRACER);
assert.equal(classifyAttackPresentation({ attackerType: 'archer', attackerIsDrone: false }), ATTACK_PRESENTATION.FIRE_CANNON);
assert.equal(classifyAttackPresentation({ attackerType: 'infantry', attackerIsDrone: true }), ATTACK_PRESENTATION.FIRE_TRACER);
assert.equal(isRangedAttackPresentation('drone'), true);
assert.equal(operationArrowStyleForAttacker({ type: 'cavalry' }), 'assault');
assert.equal(operationArrowStyleForAttacker({ type: 'archer' }), 'fire');
assert.equal(operationArrowStyleForAttacker({ type: 'warship' }), 'fire');

console.log('attackPresentation tests passed');
