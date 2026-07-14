import test from 'node:test';
import assert from 'node:assert/strict';

import {
    ANTI_AIR_MAX_LAYERS,
    ANTI_AIR_RADIUS,
    getAntiAirLayers,
    isAntiAirUnit,
    resolveAntiAirCoverage
} from '../rules/antiAir.js';

const P1 = { id: 'player1' };
const P2 = { id: 'player2' };
const P3 = { id: 'player3' };

function makeTile(q, r, { fortification = null, unit = null } = {}) {
    return { q, r, s: -q - r, fortification, unit };
}

function makeUnit(type, camp, extra = {}) {
    return { id: `${type}-${camp.id}`, type, camp, ...extra };
}

function makeMap(...tiles) {
    return new Map(tiles.map(tile => [`${tile.q},${tile.r}`, tile]));
}

test('识别 archer、mgNest 和 staller，普通单位不提供防空', () => {
    assert.equal(isAntiAirUnit(makeUnit('archer', P2)), true);
    assert.equal(isAntiAirUnit(makeUnit('mgNest', P2)), true);
    assert.equal(isAntiAirUnit(makeUnit('infantry', P2, { commander: 'staller' })), true);
    assert.equal(isAntiAirUnit(makeUnit('infantry', P2)), false);
});

test('空 flak 是无 owner 的本格一层防空来源', () => {
    const target = makeTile(0, 0, { fortification: 'flak' });
    const result = resolveAntiAirCoverage(target, P1, makeMap(target), { includeSources: true });

    assert.equal(result.layers, 1);
    assert.deepEqual(result.sources, [{
        kind: 'flak', tileKey: '0,0', q: 0, r: 0, campKey: null, ownerKnown: false
    }]);
});

test('驻军不会被当作 flak owner，普通驻军不额外增加层数', () => {
    const target = makeTile(0, 0, {
        fortification: 'flak',
        unit: makeUnit('infantry', P2)
    });
    const result = resolveAntiAirCoverage(target, P1, makeMap(target), { includeSources: true });

    assert.equal(result.layers, 1);
    assert.equal(result.sources[0].kind, 'flak');
    assert.equal(result.sources[0].campKey, null);
});

test('flak 与驻军防空单位可各贡献一层', () => {
    const target = makeTile(0, 0, {
        fortification: 'flak',
        unit: makeUnit('archer', P2)
    });
    const result = resolveAntiAirCoverage(target, P1, makeMap(target), { includeSources: true });

    assert.equal(result.layers, 2);
    assert.deepEqual(result.sources.map(source => source.kind), ['flak', 'unit']);
    assert.deepEqual(result.sources[1].providers, ['archer']);
});

test('攻击方单位不计入，其他阵营的三类单位来源均计入', () => {
    const target = makeTile(0, 0);
    const ownArcher = makeTile(1, 0, { unit: makeUnit('archer', P1) });
    const enemyNest = makeTile(0, 1, { unit: makeUnit('mgNest', P2) });
    const thirdPartyStaller = makeTile(-1, 0, {
        unit: makeUnit('infantry', P3, { commander: 'staller' })
    });
    const result = resolveAntiAirCoverage(
        target,
        P1,
        makeMap(target, ownArcher, enemyNest, thirdPartyStaller),
        { includeSources: true }
    );

    assert.equal(result.layers, 2);
    assert.deepEqual(result.sources.map(source => source.campKey).sort(), ['player2', 'player3']);
    assert.deepEqual(result.sources.flatMap(source => source.providers).sort(), ['mgNest', 'staller']);
});

test('半径外来源忽略，层数封顶但可选来源保留完整命中列表', () => {
    const target = makeTile(0, 0, { fortification: 'flak' });
    const archer = makeTile(2, 0, { unit: makeUnit('archer', P2) });
    const nest = makeTile(0, 2, { unit: makeUnit('mgNest', P2) });
    const staller = makeTile(-2, 0, {
        unit: makeUnit('cavalry', P2, { commander: 'staller' })
    });
    const tooFar = makeTile(ANTI_AIR_RADIUS + 1, 0, { unit: makeUnit('archer', P2, { id: 'far' }) });
    const result = resolveAntiAirCoverage(
        target,
        P1,
        makeMap(target, archer, nest, staller, tooFar),
        { includeSources: true }
    );

    assert.equal(ANTI_AIR_MAX_LAYERS, 2);
    assert.equal(result.layers, 2);
    assert.equal(result.sources.length, 4);
    assert.equal(result.sources.some(source => source.unitId === 'far'), false);
});

test('fortifications 规则关闭时 flak 不生效，单位防空仍生效', () => {
    const target = makeTile(0, 0, { fortification: 'flak' });
    const archer = makeTile(1, 0, { unit: makeUnit('archer', P2) });
    const state = { mechanics: { fortifications: false } };
    const result = resolveAntiAirCoverage(target, P1, makeMap(target, archer), {
        state,
        includeSources: true
    });

    assert.equal(result.layers, 1);
    assert.equal(result.sources.length, 1);
    assert.equal(result.sources[0].kind, 'unit');
});

test('默认省略来源，数值便捷入口返回 0/1/2 层', () => {
    const empty = makeTile(0, 0);
    const flak = makeTile(1, 0, { fortification: 'flak' });
    const archer = makeTile(2, 0, { unit: makeUnit('archer', P2) });
    const map = makeMap(empty, flak, archer);

    const withoutSources = resolveAntiAirCoverage(empty, P1, map);
    assert.deepEqual(withoutSources, { layers: 1 });
    assert.equal(getAntiAirLayers(flak, P1, map), 2);
});
