import test from 'node:test';
import assert from 'node:assert/strict';

const canvasContext = { setTransform() {} };
globalThis.document = {
    getElementById() {
        return { getContext: () => canvasContext, style: {} };
    }
};

const {
    HexTile,
    computeCampBorders,
    computeDistrictBorders
} = await import('../js/HexTile.js');

function pair() {
    const left = new HexTile(0, 0);
    const right = new HexTile(1, 0);
    const map = new Map([['0,0', left], ['1,0', right]]);
    return { left, right, map };
}

test('camp and district borders consume only real land-to-land adjacency', () => {
    const campA = { id: 'a', color: '#aaa' };
    const campB = { id: 'b', color: '#bbb' };

    const land = pair();
    land.left.camp = campA;
    land.right.camp = campB;
    assert.equal(computeCampBorders([land.left, land.right], land.map).length, 1);

    land.right.surface = 'shallowWater';
    land.right.camp = null;
    assert.equal(computeCampBorders([land.left, land.right], land.map).length, 0,
        'a coast must not also become a faction boundary');

    const fake = pair();
    fake.left.camp = campA;
    fake.right.camp = campB;
    fake.right.renderOnly = true;
    fake.right.playable = false;
    assert.equal(computeCampBorders([fake.left, fake.right], fake.map).length, 0,
        'borderless filler cannot extend ownership topology');

    const districts = pair();
    districts.left.camp = campA;
    districts.right.camp = campA;
    districts.left.districtId = 1;
    districts.right.districtId = 2;
    assert.equal(computeDistrictBorders([districts.left, districts.right], districts.map).length, 1);
    districts.right.surface = 'deepWater';
    districts.right.districtId = null;
    assert.equal(computeDistrictBorders([districts.left, districts.right], districts.map).length, 0);
});
