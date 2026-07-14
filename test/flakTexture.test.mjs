import assert from 'node:assert/strict';

const canvasContext = {
    setTransform() {}
};
globalThis.document = {
    getElementById() {
        return { getContext: () => canvasContext, style: {} };
    }
};

const [{ HexTile }, { FORTIFICATION_CONFIG }] = await Promise.all([
    import('../js/HexTile.js'),
    import('../rules/terrain.js')
]);

class RecordingContext {
    constructor() {
        this.calls = [];
        this.depth = 0;
    }

    record(name, ...args) { this.calls.push({ name, args }); }
    save() { this.depth++; this.record('save'); }
    restore() { this.depth--; this.record('restore'); }
    beginPath() { this.record('beginPath'); }
    closePath() { this.record('closePath'); }
    moveTo(...args) { this.record('moveTo', ...args); }
    lineTo(...args) { this.record('lineTo', ...args); }
    ellipse(...args) { this.record('ellipse', ...args); }
    arc(...args) { this.record('arc', ...args); }
    translate(...args) { this.record('translate', ...args); }
    rotate(...args) { this.record('rotate', ...args); }
    setLineDash(...args) { this.record('setLineDash', ...args); }
    fillText(...args) { this.record('fillText', ...args); }
    fill() { this.record('fill'); }
    stroke() { this.record('stroke'); }
    measureText() { return { width: 12 }; }
}

const flakContext = new RecordingContext();
const flakTile = new HexTile(0, 0);
flakTile.fortification = 'flak';
flakTile.drawBase(flakContext, { drawShadow: false });

assert.equal(flakContext.depth, 0, 'flak texture must restore every saved canvas state');
assert.equal(
    flakContext.calls.some(call => call.name === 'fillText' && call.args[0] === FORTIFICATION_CONFIG.flak.icon),
    false,
    'flak fortification must not fall back to an emoji glyph'
);

const barrelRotation = flakContext.calls.find(call => call.name === 'rotate')?.args[0];
assert.ok(barrelRotation > 0, 'an upward barrel must rotate toward the upper-right');

const muzzle = flakContext.calls
    .filter(call => call.name === 'lineTo' && call.args[1] < -20)
    .sort((left, right) => left.args[1] - right.args[1])[0];
assert.ok(muzzle, 'flak texture must draw a barrel that clears the unit badge');
const rotatedMuzzleX = muzzle.args[0] * Math.cos(barrelRotation) - muzzle.args[1] * Math.sin(barrelRotation);
const rotatedMuzzleY = muzzle.args[0] * Math.sin(barrelRotation) + muzzle.args[1] * Math.cos(barrelRotation);
assert.ok(rotatedMuzzleX > 5 && rotatedMuzzleY < -24, 'the longest barrel must extend visibly into the upper-right quadrant');

const trenchContext = new RecordingContext();
const trenchTile = new HexTile(1, 0);
trenchTile.fortification = 'trench';
trenchTile.drawBase(trenchContext, { drawShadow: false });
assert.ok(
    trenchContext.calls.some(call => call.name === 'fillText' && call.args[0] === FORTIFICATION_CONFIG.trench.icon),
    'non-flak fortification glyph rendering must remain unchanged'
);

console.log('flakTexture: all assertions passed');
