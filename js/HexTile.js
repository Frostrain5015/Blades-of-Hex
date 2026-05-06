import { HEX_SIZE, HEX_WIDTH, LOGICAL_W, LOGICAL_H, ctx, hexPath, drawHexagonOutline, hexToRgb, rgbToHex, frameInfo, CAMP_FLAG_COLORS, HEX_NEIGHBORS, hexEdge, TERRAIN_CONFIG, CAMP, settings } from './config.js';
import { nextId } from './state.js';

let _gameState = null;
export function setGameStateRef(ref) { _gameState = ref; }

export class HexTile {
    constructor(q, r, idOverride = null) {
        this.id = idOverride ?? nextId();
        this.q = q;
        this.r = r;
        this.s = -q - r;
        this.camp = CAMP.neutral;
        this.isCity = false;
        this.districtId = 0;
        this.terrain = 'plains';
        this.unit = null;

        this.startColor = this.camp.color;
        this.targetColor = this.camp.color;
        this.currentColor = this.camp.color;
        this.fadeDuration = 1500;
        this.fadeStartTime = null;

        this.x = (LOGICAL_W / 2) + HEX_WIDTH * (q + r * 0.5);
        this.y = LOGICAL_H / 2 + (3 / 2 * HEX_SIZE) * r;
    }

    setCampWithFade(newCamp) {
        if (this.camp === newCamp && this.targetColor === newCamp.color) return;
        this.camp = newCamp;
        this.startColor = this.currentColor;
        this.targetColor = newCamp.color;
        this.fadeDuration = 1500 / settings.animationSpeed;
        this.fadeStartTime = Date.now();
    }

    updateFadeColor(now = Date.now()) {
        if (!this.fadeStartTime) return;
        const elapsed = now - this.fadeStartTime;
        const progress = Math.min(elapsed / this.fadeDuration, 1);
        const startRgb = hexToRgb(this.startColor);
        const targetRgb = hexToRgb(this.targetColor);
        this.currentColor = rgbToHex(
            Math.round(startRgb.r + (targetRgb.r - startRgb.r) * progress),
            Math.round(startRgb.g + (targetRgb.g - startRgb.g) * progress),
            Math.round(startRgb.b + (targetRgb.b - startRgb.b) * progress)
        );
        if (progress >= 1) this.fadeStartTime = null;
    }

    // Fill, shadow, star
    drawBase(c) {
        const cx = this.x, cy = this.y;
        c.save();
        hexPath(c, cx + 1.5, cy + 2, HEX_SIZE);
        c.fillStyle = 'rgba(0,0,0,0.14)';
        c.fill();
        hexPath(c, cx, cy, HEX_SIZE);
        c.fillStyle = this.currentColor;
        c.fill();

        if (this.isCity) {
            c.fillStyle = '#e6c200';
            c.font = 'bold 16px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.shadowColor = 'rgba(0,0,0,0.3)';
            c.shadowBlur = 2;
            c.fillText('🏰', cx, cy);
            c.shadowColor = 'transparent';
            c.shadowBlur = 0;
        } else if (this.terrain !== 'plains') {
            const tcfg = TERRAIN_CONFIG[this.terrain];
            c.fillStyle = 'rgba(255,255,255,0.65)';
            c.font = tcfg.iconFont;
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.shadowColor = 'rgba(0,0,0,0.3)';
            c.shadowBlur = 1;
            c.fillText(tcfg.icon, cx, cy + HEX_SIZE * 0.5);
            c.shadowColor = 'transparent';
            c.shadowBlur = 0;
        }
        c.restore();
    }

    // Per-frame: animated city flag drawn AFTER all hex bases (avoids being covered)
    drawCityFlag() {
        if (!this.isCity) return;
        const now = frameInfo.now;
        const time = now / 1000;
        const cx = this.x, cy = this.y;

        // Position: upper-left of tile center
        const flagCx = cx - HEX_SIZE * 0.55;
        const flagCy = cy - HEX_SIZE * 0.50;
        const isP1 = this.camp === CAMP.player1;
        const isP2 = this.camp === CAMP.player2;
        const campKey = isP1 ? 'p1' : isP2 ? 'p2' : 'neu';
        const fc = CAMP_FLAG_COLORS[campKey];

        ctx.save();

        // Flagpole
        const poleX = flagCx;
        const poleTop = flagCy - 16;
        const poleBottom = flagCy + 10;
        ctx.beginPath();
        ctx.moveTo(poleX, poleTop);
        ctx.lineTo(poleX, poleBottom);
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.stroke();
        // Pole finial
        ctx.beginPath();
        ctx.arc(poleX, poleTop, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffd700';
        ctx.fill();

        // Waving flag (animated)
        const wave = Math.sin(time * 5 + this.id * 0.7) * 2.5;
        const flagLeft = poleX + 1.5;
        const flagRight = flagLeft + 18;
        const flagTop = poleTop + 3;
        const flagMid = flagTop + 7;
        const flagBot = flagTop + 16;
        ctx.beginPath();
        ctx.moveTo(flagLeft, flagTop);
        ctx.quadraticCurveTo(flagLeft + 6, flagMid - 3 + wave, flagRight, flagMid + wave);
        ctx.lineTo(flagRight, flagBot + wave * 0.6);
        ctx.quadraticCurveTo(flagLeft + 6, flagMid + 3 + wave * 0.6, flagLeft, flagBot);
        ctx.closePath();
        const flagGrad = ctx.createLinearGradient(flagLeft, 0, flagRight, 0);
        flagGrad.addColorStop(0, fc.main);
        flagGrad.addColorStop(1, fc.dark);
        ctx.fillStyle = flagGrad;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 0.8;
        ctx.stroke();

        ctx.restore();
    }

    // Per-frame: hover, selection highlights on main canvas
    drawOverlay() {
        const gs = _gameState;
        const cx = this.x, cy = this.y;
        const isSelected = gs && gs.selectedUnit && gs.selectedUnit.tile === this;
        const isHovered = gs && gs.hoveredTile === this;
        if (!isHovered && !isSelected) return;

        ctx.save();
        if (isHovered && !isSelected) {
            hexPath(ctx, cx, cy, HEX_SIZE);
            ctx.fillStyle = 'rgba(255,255,255,0.14)';
            ctx.fill();
            drawHexagonOutline(ctx, cx, cy, HEX_SIZE, 'rgba(255,255,255,0.30)', 1.3);
        }
        if (isSelected) {
            hexPath(ctx, cx, cy, HEX_SIZE);
            ctx.fillStyle = 'rgba(255,215,0,0.14)';
            ctx.fill();
            drawHexagonOutline(ctx, cx, cy, HEX_SIZE, '#e6c200', 2);
        }
        ctx.restore();
    }

    drawUnit() {
        if (this.unit) this.unit.draw(this.x, this.y);
    }
}

// ==== 边界绘制 ====
export function drawAllBorders(c, tiles, tileMap) {
    for (const tile of tiles) {
        const cx = tile.x, cy = tile.y;

        for (let e = 0; e < 6; e++) {
            const [dq, dr] = HEX_NEIGHBORS[(e + 1) % 6];
            const nb = tileMap.get(`${tile.q + dq},${tile.r + dr}`);
            if (nb && tile.id > nb.id) continue;

            const ep = hexEdge(cx, cy, HEX_SIZE, e);
            c.beginPath();
            c.moveTo(ep.x0, ep.y0);
            c.lineTo(ep.x1, ep.y1);
            c.strokeStyle = 'rgba(0,0,0,0.28)';
            c.lineWidth = 0.9;
            c.stroke();
        }
    }
}
