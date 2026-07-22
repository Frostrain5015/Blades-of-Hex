import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../campaign/content/bloodIris/bi-04-gate.js';
import { normalizeLevel, validateLevel } from '../campaign/runtime/schema.js';
import { getPlayableBoardCoordinates } from '../rules/boardLayout.js';

const level = normalizeLevel(config);
const triggerById = new Map(level.triggers.map(trigger => [trigger.id, trigger]));

test('《不归城》使用当前 schema 并通过完整校验', () => {
    assert.equal(config.schemaVersion, 4);
    assert.deepEqual(validateLevel(level), { errors: [], warnings: [] });
});

test('《不归城》使用 277 格无边地图与十九格大型城市', () => {
    const playable = getPlayableBoardCoordinates(level.board);
    const petra = level.board.cities.find(city => city.camp === 'petra');

    assert.equal(level.board.layout, 'borderless');
    assert.equal(playable.length, 277);
    assert.equal(petra.radius, 2);
    assert.equal(1 + 3 * petra.radius * (petra.radius + 1), 19);
    assert.ok(level.board.cities.some(city => city.camp === 'expedition'));
});

test('四条任务线覆盖地图东西与南北边缘', () => {
    const importantTiles = [
        ...level.objectives.signal_evacuation.highlight.tiles,
        ...level.objectives.burn_archives.highlight.tiles,
        ...level.areas.find(area => area.id === 'secret_tunnel').tiles,
        ...level.objectives.hold_west_gate.highlight.tiles,
        ...level.units.filter(unit => unit.camp === 'expedition').map(({ q, r }) => ({ q, r }))
    ];
    const qs = importantTiles.map(tile => tile.q);
    const rs = importantTiles.map(tile => tile.r);

    assert.ok(Math.max(...qs) - Math.min(...qs) >= 17);
    assert.ok(Math.max(...rs) - Math.min(...rs) >= 12);
    assert.equal(level.interactables.length, 5);
});

test('标准流程至少包含六轮防守压力并禁止原地等待通关', () => {
    const waves = level.triggers.filter(trigger => trigger.id.startsWith('expedition_wave_'));
    const holdGate = triggerById.get('west_gate_held');
    const mandatoryInteractions = ['tax_register', 'garrison_roll', 'family_letters', 'north_beacon', 'south_beacon'];

    assert.ok(level.turnLimit >= 8);
    assert.equal(waves.length, 6);
    assert.deepEqual(waves.map(trigger => trigger.when[0].turn || 0), [0, 1, 2, 3, 4, 5]);
    assert.equal(holdGate.when[0].turn, 6);
    assert.ok(mandatoryInteractions.every(id => level.interactables.some(item => item.id === id)));
    assert.ok(Object.values(level.objectives).filter(objective => objective.main).length >= 4);
});

test('伊蕾妮只有在全城准备完成后才能进入东侧密道', () => {
    const ready = triggerById.get('evacuation_ready');
    const reachesTunnel = triggerById.get('irene_reaches_tunnel');

    assert.equal(reachesTunnel.enabled, false);
    assert.ok(ready.when.some(condition => condition.variable === 'archives_burned' && condition.value === 3));
    assert.ok(ready.when.some(condition => condition.variable === 'beacons_lit' && condition.value === 2));
    assert.ok(ready.do.some(action => action.kind === 'setTriggerEnabled'
        && action.trigger === 'irene_reaches_tunnel' && action.enabled === true));
    assert.deepEqual(reachesTunnel.when[0].tiles, [{ q: 9, r: -2 }]);
});

test('战前压力通过逐轮增援和递进对白共同表达', () => {
    const waveText = level.triggers
        .filter(trigger => trigger.id.startsWith('expedition_wave_'))
        .flatMap(trigger => trigger.do)
        .filter(action => action.kind === 'showStep')
        .map(action => action.text)
        .join('\n');

    assert.match(waveText, /试探/);
    assert.match(waveText, /攻城锤/);
    assert.match(waveText, /主旗/);
    assert.ok(level.board.terrain.length >= 28);
    assert.ok(level.board.fortifications.length >= 7);
});
