import assert from 'node:assert/strict';
import test from 'node:test';

import { config } from '../campaign/content/bloodIris/bi-t1-sheath.js';
import { normalizeLevel, validateLevel } from '../campaign/runtime/schema.js';

const level = normalizeLevel(config);
const triggerById = new Map(level.triggers.map(trigger => [trigger.id, trigger]));

function hexDistance(from, to) {
    const dq = to.q - from.q;
    const dr = to.r - from.r;
    return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

function actions(kind) {
    return level.triggers.flatMap(trigger => trigger.do || []).filter(action => action.kind === kind);
}

test('《花与剑》直接使用当前 schema 并通过完整校验', () => {
    const validation = validateLevel(level);

    assert.equal(config.schemaVersion, 4);
    assert.deepEqual(validation.errors, []);
    assert.deepEqual(validation.warnings, []);
});

test('《花与剑》只开放选择、移动与攻击所需的基础棋盘操作', () => {
    assert.deepEqual(level.mechanics, {
        tacticalCards: false,
        recruitment: false,
        reinforcement: false,
        commanderSkills: false,
        airCommands: false,
        weatherEffects: false,
        morale: false,
        fortifications: false,
        fogOfWar: false,
        alliedVision: false
    });
});

test('《花与剑》的阶段门控没有悬空跳转或提前监听器', () => {
    const emittedNextValues = new Set(actions('showStep').map(action => action.next).filter(Boolean));
    const receivedNextValues = new Set(level.triggers.flatMap(trigger => trigger.when || [])
        .filter(condition => condition.kind === 'eventNextIs')
        .map(condition => condition.value));

    assert.deepEqual(receivedNextValues, emittedNextValues);
    assert.deepEqual(level.triggers.filter(trigger => trigger.enabled).map(trigger => trigger.id),
        ['start_story', 'sword_joins_line', 'flower_joins_line', 'banner_joins_line',
            'assembly_after_sword', 'assembly_after_flower', 'assembly_after_banner']);

    for (const action of actions('setTriggerEnabled')) {
        assert.ok(triggerById.has(action.trigger), `触发器 ${action.trigger} 必须存在`);
    }

    for (const action of actions('showStep').filter(action => action.boardLock)) {
        assert.ok(action.highlight?.unit || action.highlight?.tiles?.length,
            '每个棋盘操作锁必须提供真实高亮目标');
    }
});

test('《花与剑》先激活授章目标，再完成基础训练目标', () => {
    const strike = triggerById.get('training_strike');
    const objectiveActions = strike.do.filter(action => action.kind === 'setObjectiveStatus');

    assert.deepEqual(objectiveActions, [
        { kind: 'setObjectiveStatus', objective: 'take_oath', status: 'active' },
        { kind: 'setObjectiveStatus', objective: 'learn_basics', status: 'completed' }
    ]);
});

test('《花与剑》只有三名新兵全部列队后才能完成授章', () => {
    for (const triggerId of ['sword_joins_line', 'flower_joins_line', 'banner_joins_line']) {
        const tracker = triggerById.get(triggerId);
        assert.ok(tracker.do.some(action => action.kind === 'setUnitState'
            && action.state === 'canMove' && action.value === false));
    }
    for (const triggerId of ['assembly_after_sword', 'assembly_after_flower', 'assembly_after_banner']) {
        const gate = triggerById.get(triggerId);
        assert.equal(gate.when.filter(condition => condition.kind === 'variableCompare').length, 2);
        assert.ok(gate.do.some(action => action.kind === 'setTriggerEnabled'
            && action.trigger === 'assembly_complete' && action.enabled === true));
        assert.ok(gate.do.some(action => action.kind === 'showStep'
            && action.next === '__begin_oath'));
    }
    assert.deepEqual(triggerById.get('assembly_complete').when,
        [{ kind: 'eventNextIs', value: '__begin_oath' }]);
    assert.equal(triggerById.get('assembly_complete').enabled, false);
    assert.equal(level.unitGroups.find(group => group.id === 'new_recruits')?.unitIds.length, 3);
});

test('《花与剑》的主路线跨越大校场且环境装饰保持成簇', () => {
    const recruits = level.units.filter(unit => level.unitGroups
        .find(group => group.id === 'new_recruits')?.unitIds.includes(unit.id));
    const oathTiles = level.areas.find(area => area.id === 'oath_line').tiles;
    const minimumRouteLengths = recruits.map(unit => Math.min(...oathTiles.map(tile => hexDistance(unit, tile))));

    assert.equal(level.board.radius, 4);
    assert.ok(minimumRouteLengths.every(distance => distance >= 4));
    assert.ok(level.board.terrain.filter(tile => tile.type === 'forest').length >= 10);
    assert.ok(level.board.terrain.filter(tile => tile.type === 'mountain').length >= 6);
    assert.ok(level.board.villages.length >= 2);
    assert.ok(level.turnLimit >= 4);
});
