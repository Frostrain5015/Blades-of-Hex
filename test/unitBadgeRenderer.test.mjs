import test from 'node:test';
import assert from 'node:assert/strict';

import {
    UNIT_BADGE_CENTER_Y,
    UNIT_BADGE_RADIUS,
    UNIT_HUD_OUTER_RADIUS,
    UNIT_GLYPH_FONT_SCALE,
    UNIT_SHIELD_LINE_WIDTH,
    UNIT_SHIELD_RADIUS,
    createUnitSpherePalette,
    drawUnitBadge,
    resolveUnitBadgeGlyph
} from '../js/unitBadgeRenderer.js';

class RecordingGradient {
    constructor(args) {
        this.args = args;
        this.stops = [];
    }
    addColorStop(offset, color) { this.stops.push({ offset, color }); }
}

class RecordingContext {
    constructor() {
        this.calls = [];
        this.gradients = [];
        this.depth = 0;
        this.stack = [];
        this.currentPath = [];
        this.globalAlpha = 1;
        this.fillStyle = '#000';
        this.strokeStyle = '#000';
        this.lineWidth = 1;
        this.shadowColor = 'transparent';
        this.shadowBlur = 0;
        this.shadowOffsetY = 0;
        this.lineCap = 'butt';
        this.lineJoin = 'miter';
        this.font = '';
        this.textAlign = 'start';
        this.textBaseline = 'alphabetic';
    }
    snapshotState() {
        return {
            globalAlpha: this.globalAlpha,
            fillStyle: this.fillStyle,
            strokeStyle: this.strokeStyle,
            lineWidth: this.lineWidth,
            shadowColor: this.shadowColor,
            shadowBlur: this.shadowBlur,
            shadowOffsetY: this.shadowOffsetY,
            lineCap: this.lineCap,
            lineJoin: this.lineJoin,
            font: this.font,
            textAlign: this.textAlign,
            textBaseline: this.textBaseline
        };
    }
    save() {
        this.stack.push(this.snapshotState());
        this.depth++;
        this.calls.push({ name: 'save' });
    }
    restore() {
        const state = this.stack.pop();
        if (state) Object.assign(this, state);
        this.depth--;
        this.calls.push({ name: 'restore' });
    }
    beginPath() {
        this.currentPath = [];
        this.calls.push({ name: 'beginPath' });
    }
    moveTo(...args) {
        this.currentPath.push({ name: 'moveTo', args });
        this.calls.push({ name: 'moveTo', args });
    }
    bezierCurveTo(...args) {
        this.currentPath.push({ name: 'bezierCurveTo', args });
        this.calls.push({ name: 'bezierCurveTo', args });
    }
    closePath() {
        this.currentPath.push({ name: 'closePath', args: [] });
        this.calls.push({ name: 'closePath', args: [] });
    }
    arc(...args) {
        this.currentPath.push({ name: 'arc', args });
        this.calls.push({ name: 'arc', args });
    }
    ellipse(...args) {
        this.currentPath.push({ name: 'ellipse', args });
        this.calls.push({ name: 'ellipse', args });
    }
    fill() {
        this.calls.push({ name: 'fill', path: [...this.currentPath], state: this.snapshotState() });
    }
    stroke() {
        this.calls.push({ name: 'stroke', path: [...this.currentPath], state: this.snapshotState() });
    }
    fillText(...args) {
        this.calls.push({ name: 'fillText', args, state: this.snapshotState() });
    }
    strokeText(...args) {
        this.calls.push({ name: 'strokeText', args, state: this.snapshotState() });
    }
    createRadialGradient(...args) {
        const gradient = new RecordingGradient(args);
        this.gradients.push(gradient);
        return gradient;
    }
}

function arcFrom(call) {
    return call.path.length === 1 && call.path[0].name === 'arc' ? call.path[0].args : null;
}

test('flat custom faction colours still produce a materially shaded sphere palette', () => {
    const palette = createUnitSpherePalette({ main: '#777777', light: '#777777', dark: '#777777' });
    assert.notEqual(palette.highlight, palette.main);
    assert.notEqual(palette.dark, palette.main);
    assert.notEqual(palette.outline, palette.dark);
    assert.equal(createUnitSpherePalette({ main: '#777777', light: '#777777', dark: '#777777' }), palette,
        'derived palette should be cached instead of allocated for every unit frame');
});

test('unit badge draws a ground ellipse, sphere material, relation dial and bounded shield', () => {
    const context = new RecordingContext();
    drawUnitBadge(context, {
        flagColors: { main: '#d44040', light: '#f06060', dark: '#8b1a1a' },
        relationColor: '#ef5350',
        hpRatio: 0.32,
        shieldRatio: 0.75,
        glyph: resolveUnitBadgeGlyph('warship')
    });

    assert.equal(context.depth, 0);
    const shadowFill = context.calls.find(call => call.name === 'fill' && call.path[0]?.name === 'ellipse');
    assert.ok(shadowFill, '2.5D body must start with an independent ground-plane ellipse');
    const [, shadowY, shadowRadiusX, shadowRadiusY] = shadowFill.path[0].args;
    assert.ok(shadowY > UNIT_BADGE_CENTER_Y);
    assert.ok(shadowRadiusX > UNIT_BADGE_RADIUS);
    assert.ok(shadowRadiusY < UNIT_BADGE_RADIUS * 0.5);

    assert.equal(context.gradients.length, 1);
    assert.deepEqual(context.gradients[0].stops.map(stop => stop.offset), [0, 0.22, 0.62, 1]);

    const relationTrack = context.calls.find(call => call.name === 'stroke'
        && call.state.strokeStyle === '#ef5350'
        && call.state.globalAlpha === 0.34
        && arcFrom(call)?.[2] === UNIT_BADGE_RADIUS);
    assert.ok(relationTrack, 'low-brightness relation track must remain visible below the HP arc');

    const healthArc = context.calls.find(call => {
        const arc = call.name === 'stroke' ? arcFrom(call) : null;
        return arc?.[2] === UNIT_BADGE_RADIUS
            && Math.abs(arc[3] + Math.PI / 2) < 1e-9
            && Math.abs(arc[4] - (-Math.PI / 2 + Math.PI * 2 * 0.32)) < 1e-9;
    });
    assert.ok(healthArc);

    const shieldArc = context.calls.find(call => {
        const arc = call.name === 'stroke' ? arcFrom(call) : null;
        return arc?.[2] === UNIT_SHIELD_RADIUS && call.state.strokeStyle === '#76e7ff';
    });
    assert.ok(shieldArc);
    assert.equal(shieldArc.state.lineWidth, UNIT_SHIELD_LINE_WIDTH);
    assert.ok(UNIT_SHIELD_RADIUS + UNIT_SHIELD_LINE_WIDTH / 2 <= UNIT_HUD_OUTER_RADIUS);

    const glyphCall = context.calls.find(call => call.name === 'fillText');
    assert.equal(glyphCall?.args[0], '\u2693\uFE0E');
    assert.match(glyphCall?.state.font || '', /Segoe UI Symbol/);
    assert.match(glyphCall?.state.font || '', new RegExp(`\\b${Math.round(UNIT_BADGE_RADIUS * UNIT_GLYPH_FONT_SCALE)}px\\b`));
});

test('all production unit types, including warship, resolve to deliberate glyphs', () => {
    for (const type of ['infantry', 'cavalry', 'archer', 'mgNest', 'drone', 'warship', 'carrier']) {
        assert.notEqual(resolveUnitBadgeGlyph(type), '?', `${type} must not fall back to ?`);
    }
    assert.equal(resolveUnitBadgeGlyph('carrier'), '🛫');
    assert.notEqual(resolveUnitBadgeGlyph('infantry', true), resolveUnitBadgeGlyph('infantry'));
});

test('waterborne badge omits land shadow and masks its lower sphere with a foam waterline', () => {
    const context = new RecordingContext();
    drawUnitBadge(context, {
        flagColors: { main: '#4060d0', light: '#6080f0', dark: '#1a2a80' },
        relationColor: '#ef5350',
        hpRatio: 1,
        glyph: resolveUnitBadgeGlyph('warship'),
        waterColor: '#294f67'
    });

    const ellipseFills = context.calls.filter(call => call.name === 'fill' && call.path[0]?.name === 'ellipse');
    assert.equal(ellipseFills.length, 1, 'only the sphere specular ellipse remains; no ground-plane shadow is drawn');
    const waterFill = context.calls.find(call => call.name === 'fill'
        && call.state.fillStyle === '#294f67'
        && call.path.some(part => part.name === 'bezierCurveTo'));
    assert.ok(waterFill, 'lower sphere must be occluded by a water cap');
    const foam = context.calls.find(call => call.name === 'stroke'
        && call.state.strokeStyle === 'rgba(210,238,232,0.78)');
    assert.ok(foam, 'waterline must retain a visible foam crest');
});
