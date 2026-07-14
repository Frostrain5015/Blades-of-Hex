import assert from 'node:assert/strict';
import {
    TARGETING_PREVIEW_KINDS,
    clipToBoard,
    drawAntiAirCoveragePreview,
    drawUnitTargetPreview,
    renderTargetingPreview
} from '../js/targetingPreviewRenderer.js';

function createContext() {
    const calls = [];
    const stack = [];
    const stateKeys = [
        'fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin',
        'globalAlpha', 'globalCompositeOperation', 'shadowColor', 'shadowBlur',
        'lineDashOffset'
    ];
    const ctx = { calls, globalAlpha: 1 };
    ctx.save = () => {
        stack.push(Object.fromEntries(stateKeys.map(key => [key, ctx[key]])));
        calls.push(['save']);
    };
    ctx.restore = () => {
        Object.assign(ctx, stack.pop() || {});
        calls.push(['restore']);
    };
    for (const method of [
        'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'rect',
        'bezierCurveTo', 'quadraticCurveTo', 'fill', 'clip',
        'fillRect', 'translate', 'scale'
    ]) {
        ctx[method] = (...args) => calls.push([method, ...args]);
    }
    ctx.stroke = (...args) => calls.push(['stroke', ...args, {
        strokeStyle: ctx.strokeStyle,
        shadowColor: ctx.shadowColor,
        globalCompositeOperation: ctx.globalCompositeOperation
    }]);
    ctx.setLineDash = (...args) => calls.push(['setLineDash', ...args]);
    return ctx;
}

function freeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const item of Object.values(value)) freeze(item);
    return Object.freeze(value);
}

const center = freeze({ x: 120, y: 90 });
for (const kind of TARGETING_PREVIEW_KINDS) {
    const ctx = createContext();
    const descriptor = freeze({ center, size: 30, kind, active: true, time: 1.25, phase: 0.5 });
    assert.equal(drawUnitTargetPreview(ctx, descriptor), true);
    assert.ok(ctx.calls.some(call => call[0] === 'stroke'), `${kind} should draw strokes`);
}

{
    const ctx = createContext();
    drawUnitTargetPreview(ctx, freeze({ center, size: 30, kind: 'attack', active: true, time: 1.25 }));
    const attackStrokes = ctx.calls.filter(call => call[0] === 'stroke');
    assert.ok(attackStrokes.length > 4);
    assert.ok(attackStrokes.every(call => call.at(-1).strokeStyle === '#f03b32'));
    assert.ok(attackStrokes.every(call => call.at(-1).shadowColor === '#f03b32'));
    assert.ok(attackStrokes.every(call => call.at(-1).globalCompositeOperation !== 'screen'));
}

{
    const ctx = createContext();
    const board = freeze({ shapes: [{ center, size: 30 }] });
    assert.equal(clipToBoard(ctx, board), true);
    assert.equal(ctx.calls.filter(call => call[0] === 'clip').length, 1);
    assert.equal(clipToBoard(ctx, freeze({ shapes: [] })), false);
}

{
    const levelOne = createContext();
    const levelTwo = createContext();
    const base = { center, size: 30 };
    drawAntiAirCoveragePreview(levelOne, freeze({ cells: [{ ...base, level: 1 }] }));
    drawAntiAirCoveragePreview(levelTwo, freeze({ cells: [{ ...base, level: 2 }] }));
    const oneStrokes = levelOne.calls.filter(call => call[0] === 'stroke').length;
    const twoStrokes = levelTwo.calls.filter(call => call[0] === 'stroke').length;
    assert.ok(twoStrokes > oneStrokes * 1.8, 'level 2 AA should add the crossing hatch pass');
}

{
    const ctx = createContext();
    const shape = { center, size: 30 };
    const scene = freeze({
        boardClip: { shapes: [shape] },
        antiAir: { cells: [{ ...shape, level: 2 }] },
        origins: [{ ...shape, time: 1 }],
        tileDeployments: [{ ...shape, active: true }],
        areaCenters: [{ ...shape, active: true }],
        unitTargets: TARGETING_PREVIEW_KINDS.map(kind => ({ ...shape, kind }))
    });
    assert.equal(renderTargetingPreview(ctx, scene), 11);
    assert.equal(ctx.globalAlpha, 1, 'renderer should restore the caller context state');
}

console.log('targetingPreviewRenderer: ok');
