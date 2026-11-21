import test from 'node:test';
import assert from 'node:assert/strict';
import '../core/dom-shim.js';
import { resizeCanvasBackingStore } from '../js/canvasRuntime.js';

test('Fractional pixel ratios resize a Canvas backing store only once per actual size change', () => {
    let writes = 0;
    const surface = {
        get width() { return this.w; },
        set width(value) { this.w = Math.trunc(value); writes++; },
        get height() { return this.h; },
        set height(value) { this.h = Math.trunc(value); writes++; }
    };
    for (let frame = 0; frame < 120; frame++) resizeCanvasBackingStore(surface, 359, 605, 1.25);
    assert.equal(writes, 2);
    assert.equal(surface.width, 449);
    assert.equal(surface.height, 756);
    assert.equal(resizeCanvasBackingStore(surface, 359, 605, 2), true);
    assert.equal(writes, 4);
    assert.equal(resizeCanvasBackingStore(surface, 360, 605, 2), true);
    assert.equal(writes, 5);
    assert.equal(resizeCanvasBackingStore(surface, 360, 605, 2), false);
});
