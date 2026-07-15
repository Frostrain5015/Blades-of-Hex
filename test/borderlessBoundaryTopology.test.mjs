import test from 'node:test';
import assert from 'node:assert/strict';

const canvasContext = { setTransform() {} };
globalThis.document = {
    getElementById() {
        return { getContext: () => canvasContext, style: {} };
    }
};

const { getBorderlessBoundaryTopology } = await import('../js/militaryMap.js');

const campA = { id: 'a' };
const campB = { id: 'b' };

function pair(rightOverrides = {}) {
    const left = {
        id: 1, q: 0, r: 0, x: 0, y: 0,
        surface: 'land', camp: campA, districtId: 1
    };
    const source = {
        id: 2, q: 2, r: 0, x: 104, y: 0,
        surface: rightOverrides.surface || 'land',
        camp: rightOverrides.camp || campA,
        districtId: rightOverrides.districtId ?? 1
    };
    const right = {
        id: -1, q: 1, r: 0, x: 52, y: 0,
        renderOnly: true, playable: false, isVisualFiller: true,
        sourceTile: source,
        get surface() { return source.surface; },
        get camp() { return source.camp; },
        get districtId() { return source.districtId; }
    };
    return {
        fillers: [right],
        tiles: [left, right],
        tileMap: new Map([['0,0', left], ['1,0', right]]),
        realTileMap: new Map([['0,0', left], ['2,0', source]])
    };
}

test('borderless shared edges have one exclusive visual classification', () => {
    const coast = getBorderlessBoundaryTopology(pair({ surface: 'shallowWater', camp: campB, districtId: 2 }));
    assert.equal(coast.coastEdges.length, 1);
    assert.equal(coast.coastEdges[0].visualOnly, true);
    assert.equal(coast.campEdges.length, 0, 'coast must suppress inherited ownership mismatch');
    assert.equal(coast.districtEdges.length, 0, 'coast must suppress inherited district mismatch');

    const camp = getBorderlessBoundaryTopology(pair({ camp: campB, districtId: 2 }));
    assert.equal(camp.campEdges.length, 1);
    assert.equal(camp.districtEdges.length, 0, 'faction border must own the edge before district style');
    assert.equal(camp.coastEdges.length, 0);

    const district = getBorderlessBoundaryTopology(pair({ camp: campA, districtId: 2 }));
    assert.equal(district.districtEdges.length, 1);
    assert.equal(district.campEdges.length, 0);
    assert.equal(district.coastEdges.length, 0);
});
