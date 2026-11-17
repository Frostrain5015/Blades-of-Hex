import assert from 'node:assert/strict';
import {
    AIRSTRIKE_DAMAGED_AA_THRESHOLD,
    AIRSTRIKE_DAMAGED_START_PROGRESS,
    ATTACK_PRESENTATION,
    classifyAttackPresentation,
    getAirstrikePassPlanePosition,
    getDiveStrafeMuzzlePosition,
    getDiveStrafePlanePosition,
    getStukaFlightPosition,
    isAirstrikeDamagedByAntiAir,
    isRangedAttackPresentation,
    isRangedCombatAttack,
    operationArrowStyleForAttacker,
    shouldRenderAirstrikeEngineFire
} from '../rules/attackPresentation.js';

assert.equal(classifyAttackPresentation({ type: 'infantry' }), ATTACK_PRESENTATION.ASSAULT);
assert.equal(classifyAttackPresentation({ type: 'cavalry' }), ATTACK_PRESENTATION.ASSAULT);
assert.equal(classifyAttackPresentation({ type: 'archer' }), ATTACK_PRESENTATION.FIRE_CANNON);
assert.equal(classifyAttackPresentation({ type: 'warship' }), ATTACK_PRESENTATION.FIRE_CANNON);
assert.equal(classifyAttackPresentation({ type: 'mgNest' }), ATTACK_PRESENTATION.FIRE_TRACER);
assert.equal(classifyAttackPresentation({ type: 'us_marine' }), ATTACK_PRESENTATION.FIRE_TRACER);
assert.equal(classifyAttackPresentation({ attackerType: 'us_marine' }), ATTACK_PRESENTATION.FIRE_TRACER);
assert.equal(isRangedCombatAttack('us_marine'), false);
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

const stukaEntry = getStukaFlightPosition(500, 360, 1000, 0);
const stukaDive = getStukaFlightPosition(500, 360, 1000, 0.5);
const stukaLow = getStukaFlightPosition(500, 360, 1000, 0.65);
const stukaClimb = getStukaFlightPosition(500, 360, 1000, 0.8);
const stukaExit = getStukaFlightPosition(500, 360, 1000, 1);
assert.ok(stukaEntry.x < 0 && stukaEntry.y < 0);
assert.ok(stukaExit.x > 1000 && stukaExit.y < 0);
assert.ok(stukaDive.angle > 0 && stukaClimb.angle < 0);
assert.ok(stukaDive.y < stukaLow.y && stukaClimb.y < stukaLow.y);
assert.equal(stukaLow.angle, 0);

// >50% (strictly greater, excludes 50%) anti-air engine fire & black smoke rules
assert.equal(AIRSTRIKE_DAMAGED_AA_THRESHOLD, 0.5);
assert.equal(AIRSTRIKE_DAMAGED_START_PROGRESS, 0.5);
assert.equal(isAirstrikeDamagedByAntiAir(0), false);
assert.equal(isAirstrikeDamagedByAntiAir(0.5), false);
assert.equal(isAirstrikeDamagedByAntiAir(0.65 - 0.15), false, 'IEEE754 65%-15%=50% must not falsely trigger');
assert.equal(isAirstrikeDamagedByAntiAir(0.51), true);
assert.equal(isAirstrikeDamagedByAntiAir(0.85), true);

assert.equal(shouldRenderAirstrikeEngineFire({ type: 'carpetBomb', antiAir: 0.5 }, 0.75), false);
assert.equal(shouldRenderAirstrikeEngineFire({ type: 'carpetBomb', antiAir: 0.65 }, 0.49), false);
assert.equal(shouldRenderAirstrikeEngineFire({ type: 'carpetBomb', antiAir: 0.65 }, 0.5), true);
assert.equal(shouldRenderAirstrikeEngineFire({ type: 'diveStrafe', antiAir: 0.55 }, 0.8), true);
assert.equal(shouldRenderAirstrikeEngineFire({ type: 'stukaStrafe', antiAir: 0.7 }, 0.6), true);
assert.equal(shouldRenderAirstrikeEngineFire({ type: 'carpetBomb', antiAir: 0.85 }, 1), false);
assert.equal(shouldRenderAirstrikeEngineFire({ type: 'airdrop', antiAir: 0.85 }, 0.6), false);

const passMid = getAirstrikePassPlanePosition(500, 360, 0.5);
const passEnd = getAirstrikePassPlanePosition(500, 360, 1);
assert.equal(passMid.y, 280);
assert.equal(passEnd.y, 280);
assert.equal(passMid.angle, 0);
assert.ok(passEnd.x > passMid.x);

console.log('attackPresentation tests passed');
