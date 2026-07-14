import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sourcePath = resolve('js/operationPreviewRenderer.js');
const sourceCode = readFileSync(sourcePath, 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(sourceCode).toString('base64')}`;
const renderer = await import(moduleUrl);

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
    arc(...args) { this.record('arc', ...args); }
    stroke() { this.record('stroke'); }
    fill() { this.record('fill'); }
    clip() { this.record('clip'); }
    translate(...args) { this.record('translate', ...args); }
    rotate(...args) { this.record('rotate', ...args); }
    setLineDash(...args) { this.record('setLineDash', ...args); }
}

function draw(action, overrides = {}) {
    const ctx = new RecordingContext();
    const result = renderer.drawOperationPreview(ctx, {
        action,
        source: { x: 20, y: 90 },
        target: { x: 260, y: 70 },
        bfsPath: [
            { x: 20, y: 90 },
            { x: 85, y: 110 },
            { x: 150, y: 55 },
            { x: 215, y: 82 },
            { x: 260, y: 70 }
        ],
        unitRadius: 15,
        color: '#58c9b3',
        time: 0.75,
        ...overrides
    });
    assert.equal(ctx.depth, 0, `${action} must restore every saved canvas state`);
    return { ctx, result };
}

assert.deepEqual(Object.values(renderer.OPERATION_PREVIEW_ACTIONS), ['move', 'melee', 'ranged']);
assert.doesNotMatch(sourceCode, /\b(?:document|window|performance|requestAnimationFrame)\b/);

const source = { x: 0, y: 0 };
const target = { x: 100, y: 20 };
const anchors = renderer.buildMoveOperationAnchors(source, target, [
    source,
    { x: 30, y: 40 },
    { x: 70, y: -10 },
    target
]);
assert.deepEqual(anchors[0], source);
assert.deepEqual(anchors.at(-1), target);
assert.equal(anchors.length, 4, 'duplicate BFS endpoints should be removed');

const smooth = renderer.buildSmoothOperationRoute(anchors);
assert.ok(smooth.points.length > anchors.length, 'BFS anchors should be densely sampled');
assert.ok(smooth.totalLength > 100, 'curve should expose an arc-length metric');
assert.deepEqual(
    renderer.sampleOperationRoute(smooth, 0),
    { x: source.x, y: source.y, angle: renderer.sampleOperationRoute(smooth, 0).angle }
);
assert.equal(renderer.sampleOperationRoute(smooth, 1).x, target.x);
assert.equal(renderer.sampleOperationRoute(smooth, 1).y, target.y);

const move = draw('move');
assert.equal(move.result.route.anchors.length, 5, 'movement should consume the de-duplicated BFS route');
assert.ok(Number.isFinite(move.result.destinationPulseProgress));
assert.ok(move.ctx.calls.some(call => call.name === 'setLineDash' && call.args[0].length === 2));
assert.ok(move.ctx.calls.filter(call => call.name === 'arc').length >= 4, 'move should draw destination and origin rings');

const melee = draw('melee');
assert.equal(melee.result.route.anchors.length, 2, 'melee should directly connect source and target');
assert.ok(melee.result.targetContactFraction < 1, 'melee arrow should stop at the target sphere contact');
assert.ok(melee.ctx.calls.some(call => call.name === 'fill'), 'melee should draw a filled tapered band/head');

const ranged = draw('ranged', { time: 0.5 });
assert.equal(ranged.result.route.anchors.length, 2, 'ranged preview must ignore the movement BFS path');
assert.equal(ranged.result.timing.carrierVisible, true);
assert.equal(ranged.result.timing.impactVisible, false);
assert.ok(ranged.ctx.calls.some(call => call.name === 'arc'), 'ranged flight should draw the abstract carrier');

const justBeforeImpact = renderer.getRangedPreviewTiming(1.55 - 0.0001);
const atImpact = renderer.getRangedPreviewTiming(1.55);
assert.equal(justBeforeImpact.impactVisible, false);
assert.equal(atImpact.carrierVisible, true);
assert.equal(atImpact.impactVisible, true, 'impact pulse must start on the arrival frame');
assert.equal(atImpact.impactProgress, 0);

const impact = draw('ranged', { time: 1.55 });
assert.equal(impact.result.timing.impactVisible, true);
assert.ok(impact.ctx.calls.filter(call => call.name === 'arc').length >= 4, 'arrival should draw carrier, pulse and origin rings');

const straight = renderer.buildRangedOperationRoute(source, target, 15, 'straight');
assert.equal(straight.points[0].x, source.x);
assert.equal(straight.points.at(-1).x, target.x);
assert.ok(straight.points.every((point, index) => {
    const t = index / (straight.points.length - 1);
    return Math.abs(point.y - (source.y + (target.y - source.y) * t)) < 0.0001;
}));

assert.throws(() => draw('retreat'), /unknown operation preview action/);
assert.throws(() => renderer.drawOperationPreview(new RecordingContext(), {
    action: 'move',
    source: { x: Number.NaN, y: 0 },
    target,
    unitRadius: 15
}), /source must contain finite x and y/);

console.log('operationPreviewRenderer: all assertions passed');
