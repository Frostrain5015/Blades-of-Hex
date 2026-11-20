import assert from 'node:assert/strict';
import { buildHexRegionContours } from '../js/rendering/hexRegionContours.js';
import { axialToBoardPixel, isPointInBoardHex } from '../rules/boardLayout.js';
import { BOARD_RULES } from '../rules/constants.js';
import { HEX_NEIGHBORS } from '../rules/hex.js';
import {
    TARGETING_PREVIEW_KINDS,
    clipToBoard,
    drawAirViewAaSourceBadge,
    drawAirViewAirfieldMarker,
    drawAirViewOverlapHatches,
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
        'lineDashOffset', 'font', 'textAlign', 'textBaseline'
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
        'fillRect', 'translate', 'scale', 'rotate', 'fillText', 'strokeText'
    ]) {
        ctx[method] = (...args) => calls.push([method, ...args]);
    }
    ctx.stroke = (...args) => calls.push(['stroke', ...args, {
        strokeStyle: ctx.strokeStyle,
        lineWidth: ctx.lineWidth,
        lineDashOffset: ctx.lineDashOffset,
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
    const base = { center, size: 30, q: 0, r: 0 };
    drawAntiAirCoveragePreview(levelOne, freeze({ cells: [{ ...base, level: 1 }], time: 1 }));
    drawAntiAirCoveragePreview(levelTwo, freeze({ cells: [{ ...base, level: 2 }], time: 2 }));
    const oneStrokes = levelOne.calls.filter(call => call[0] === 'stroke').length;
    const twoStrokes = levelTwo.calls.filter(call => call[0] === 'stroke').length;
    assert.equal(twoStrokes, oneStrokes + 1, 'Level-2 (>=50%) AA coverage adds one batched same-color diagonal hatch pass');
    assert.equal(levelTwo.calls.filter(call => call[0] === 'clip').length, 1, 'Level-2 AA hatches are clipped to level-2 cells');
    assert.equal(oneStrokes, 2, 'An isolated board-edge cell gets a closed double-stroke perimeter');
    assert.ok(levelOne.calls.filter(call => call[0] === 'setLineDash').every(call => call[1].length === 0));
    assert.ok(levelOne.calls.some(call => call[0] === 'stroke'
        && call.at(-1).strokeStyle === '#ff4636'
        && call.at(-1).lineWidth >= 5), 'AA perimeter should be wide enough to remain visible under air range');
}

{
    const size = BOARD_RULES.hexSize;
    const origin = axialToBoardPixel(0, 0);
    const hex = (q, r) => ({ q, r, center: axialToBoardPixel(q, r) });
    for (const [q, r] of HEX_NEIGHBORS) {
        const neighbor = hex(q, r);
        const contours = buildHexRegionContours([hex(0, 0), neighbor], size);
        assert.deepEqual(contours.map(path => path.length), [10], 'Every shared edge disappears from the perimeter');
        for (let i = 0; i < contours[0].length; i++) {
            const a = contours[0][i];
            const b = contours[0][(i + 1) % contours[0].length];
            assert.ok(Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - size) < 1e-6);
        }
        const dx = neighbor.center.x - origin.x;
        const dy = neighbor.center.y - origin.y;
        assert.equal(isPointInBoardHex(origin.x + dx * 0.49, origin.y + dy * 0.49, origin), true);
        assert.equal(isPointInBoardHex(origin.x + dx * 0.51, origin.y + dy * 0.51, origin), false,
            'A point just inside the adjoining filler is outside the playable hex');
    }
    const ring = HEX_NEIGHBORS.map(([q, r]) => hex(q, r));
    assert.deepEqual(buildHexRegionContours([...ring, hex(6, 6)], size).map(path => path.length).sort((a, b) => a - b),
        [6, 6, 18], 'Holes and disconnected patches have separate closed contours');
}

{
    const ctx = createContext();
    const shape = { center, size: 30 };
    const scene = freeze({
        boardClip: { shapes: [shape] },
        antiAir: { cells: [{ ...shape, q: 0, r: 0, level: 2 }] },
        origins: [{ ...shape, time: 1 }],
        tileDeployments: [{ ...shape, active: true }],
        areaCenters: [{ ...shape, active: true }],
        unitTargets: TARGETING_PREVIEW_KINDS.map(kind => ({ ...shape, kind }))
    });
    assert.equal(renderTargetingPreview(ctx, scene), 11);
    const perimeterStrokeIdx = ctx.calls.findIndex(call => call[0] === 'stroke' && call.at(-1).lineWidth >= 5);
    const boardClipIdx = ctx.calls.map(call => call[0]).lastIndexOf('clip');
    assert.ok(perimeterStrokeIdx >= 0 && perimeterStrokeIdx < boardClipIdx,
        'Clipping reticles to the board must leave the perimeter stroke intact');
    assert.equal(ctx.globalAlpha, 1, 'renderer should restore the caller context state');
}

{
    const ctx = createContext();
    const cells = [];
    const tileDeployments = [];
    const areaCenters = [];
    for (let i = 0; i < 40; i++) {
        const c = { x: 100 + i * 10, y: 100 };
        cells.push({ center: c, size: 30, q: i, r: 0, level: 1 });
        tileDeployments.push({ center: c, size: 30, active: i === 0, alpha: 1 });
        areaCenters.push({ center: c, size: 30, active: i === 0, alpha: 1 });
    }
    const contours = buildHexRegionContours(cells, 30);
    const drawn = renderTargetingPreview(ctx, freeze({
        antiAir: { cells, contours, time: 1 },
        tileDeployments,
        areaCenters
    }));
    assert.equal(drawn, 120);
    const strokes = ctx.calls.filter(call => call[0] === 'stroke').length;
    assert.ok(strokes < 25, `Batched inactive tiles/centers should stay compact (got ${strokes} strokes for 80 targets)`);
}

{
    const ctx = createContext();
    const cell = { center, size: 32, q: 0, r: 0, level: 2 };
    const greenDrawn = drawAntiAirCoveragePreview(ctx, freeze({
        cells: [cell],
        size: 32,
        color: '#28d97c',
        innerColor: 'rgba(215, 255, 232, 0.72)',
        glowColor: '#18c96e',
        insetPx: 1.5,
        levelTwoAlpha: 0.21,
        alpha: 0.35,
        time: 1.5
    }));
    assert.equal(greenDrawn, 1);
    const greenStrokes = ctx.calls.filter(call => call[0] === 'stroke');
    assert.equal(greenStrokes.length, 3);
    assert.equal(greenStrokes[0].at(-1).strokeStyle, '#28d97c');
    assert.equal(greenStrokes[1].at(-1).strokeStyle, '#28d97c');
    assert.equal(ctx.globalAlpha, 1);
}

{
    const ctx = createContext();
    const cells = [
        { center: { x: 100, y: 100 }, size: 32, q: 0, r: 0 },
        { center: { x: 155, y: 100 }, size: 32, q: 1, r: 0 }
    ];
    assert.equal(drawAirViewOverlapHatches(ctx, freeze({ cells, size: 32, alpha: 0.5 })), 2);
    assert.equal(ctx.calls.filter(call => call[0] === 'clip').length, 1);
    const strokes = ctx.calls.filter(call => call[0] === 'stroke');
    assert.equal(strokes.length, 2, 'Alternating green and red hatches batch into 2 stroke calls');
    assert.equal(ctx.globalAlpha, 1);
}

{
    const readyCtx = createContext();
    assert.equal(drawAirViewAirfieldMarker(readyCtx, freeze({ center, size: 32, isFriendly: true, isReady: true, time: 1.2 })), true);
    assert.ok(readyCtx.calls.some(call => call[0] === 'fillText' && call[1] === '🛫'));
    assert.equal(readyCtx.globalAlpha, 1);

    const buildCtx = createContext();
    assert.equal(drawAirViewAirfieldMarker(buildCtx, freeze({ center, size: 32, isFriendly: true, isReady: false, time: 1.2 })), true);
    assert.ok(buildCtx.calls.some(call => call[0] === 'fillText' && call[1] === '建'));
    assert.ok(buildCtx.calls.some(call => call[0] === 'setLineDash' && call[1].length === 2));

    const launcherCtx = createContext();
    assert.equal(drawAirViewAirfieldMarker(launcherCtx, freeze({ center, size: 32, isFriendly: true, isReady: true, isLauncher: true, time: 1.2 })), true);
    assert.ok(launcherCtx.calls.some(call => call[0] === 'fillText' && call[1] === '出击'));
}

{
    const badgeCtx = createContext();
    assert.equal(drawAirViewAaSourceBadge(badgeCtx, freeze({ center, size: 32, isFriendly: false, time: 1.2 })), true);
    const translates = badgeCtx.calls.filter(call => call[0] === 'translate');
    assert.ok(translates.length >= 1);
    const [, tx, ty] = translates[0];
    assert.ok(tx > center.x && ty < center.y, 'AA source badge sits in the top-right corner of the hex');
    assert.ok(badgeCtx.calls.filter(call => call[0] === 'arc').length >= 3, 'Draws outer disc, inner ring, turret dome, and muzzle flash');
    assert.equal(badgeCtx.globalAlpha, 1);
}

console.log('targetingPreviewRenderer: ok');
