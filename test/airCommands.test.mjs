import test from 'node:test';
import assert from 'node:assert/strict';

import {
    AIR_COMMAND_IMPACT_DELAY_MS,
    AIRFIELD_BASE_POWER,
    AIRFIELD_BASE_RANGE,
    COLONEL_AIR_RANGE_BONUS,
    buildAirCommandDamageTexts,
    getAirfieldColonel,
    getAirfieldCommander,
    getAirCommandRange,
    getMountedCommanderAirAttackBonus
} from '../rules/airCommands.js';

const CAMP = { id: 'player1' };

function commanderUnit(commander, extra = {}) {
    return { commander, camp: CAMP, hp: 100, ...extra };
}

test('机场与航母按航空基础火力读取挂载将领自身的攻击修正', () => {
    // 当前基准火力 AIRFIELD_BASE_POWER=50：colonel 0.30→15、centurion 0.40→20
    const colonel = commanderUnit('colonel');
    assert.equal(getMountedCommanderAirAttackBonus(colonel, AIRFIELD_BASE_POWER), 15);
    assert.equal(getMountedCommanderAirAttackBonus(colonel, 45), 14);

    const centurion = commanderUnit('centurion');
    assert.equal(getMountedCommanderAirAttackBonus(centurion, AIRFIELD_BASE_POWER), 20);
});

test('将领航空攻击修正不依赖宿主兵种攻击力，失效将领不提供加成', () => {
    const lowAttackHost = commanderUnit('colonel', { config: { attack: 20 } });
    const highAttackHost = commanderUnit('colonel', { config: { attack: 100 } });
    assert.equal(
        getMountedCommanderAirAttackBonus(lowAttackHost, AIRFIELD_BASE_POWER),
        getMountedCommanderAirAttackBonus(highAttackHost, AIRFIELD_BASE_POWER)
    );
    assert.equal(getMountedCommanderAirAttackBonus(commanderUnit('colonel', {
        type: 'infantry', config: { movementDomain: 'land', speed: 4 }, isEmbarked: true
    }), AIRFIELD_BASE_POWER), 0);
    assert.equal(getMountedCommanderAirAttackBonus(commanderUnit(null), AIRFIELD_BASE_POWER), 0);
});

test('机场识别驻城将领，并仅把空军上校视为航空专属强化来源', () => {
    const colonel = commanderUnit('colonel');
    const colonelCity = { camp: CAMP, unit: colonel };
    assert.equal(getAirfieldCommander(colonelCity), colonel);
    assert.equal(getAirfieldColonel(colonelCity), colonel);

    const other = commanderUnit('centurion');
    assert.equal(getAirfieldCommander({ camp: CAMP, unit: other }), other);
    assert.equal(getAirfieldColonel({ camp: CAMP, unit: other }), null);
    assert.equal(getAirfieldCommander({ camp: { id: 'player2' }, unit: colonel }), null);
    assert.equal(AIRFIELD_BASE_RANGE, 6);
    assert.equal(COLONEL_AIR_RANGE_BONUS, 2);
    assert.equal(getAirCommandRange({ camp: CAMP, unit: null }), 6);
    assert.equal(getAirCommandRange(colonelCity), 8);
});

test('机场扫射与轰炸结果会在命中时刻生成前端伤害数字', () => {
    const tileMap = new Map([
        ['1,2', { x: 320, y: 240 }],
        ['2,2', { x: 390, y: 240 }]
    ]);
    const texts = buildAirCommandDamageTexts([
        { q: 1, r: 2, damage: 37, isCrit: true },
        { q: 2, r: 2, damage: 18, isCrit: false },
        { q: 9, r: 9, damage: 99 }
    ], tileMap, 1234);

    assert.deepEqual(texts, [
        { x: 320, y: 240, value: 37, isCrit: true, isAirDamage: true, timeLeft: 900, lastUpdate: 1234 },
        { x: 390, y: 240, value: 18, isCrit: false, isAirDamage: true, timeLeft: 900, lastUpdate: 1234 }
    ]);
    // 与 c2c6519 对齐：扫射/轰炸扣血均延迟到爆炸时刻（1200ms）
    assert.equal(AIR_COMMAND_IMPACT_DELAY_MS.strafe, 1200);
    assert.equal(AIR_COMMAND_IMPACT_DELAY_MS.bombing, 1200);
});
