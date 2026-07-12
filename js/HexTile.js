import { HEX_SIZE, HEX_WIDTH, LOGICAL_W, LOGICAL_H, ctx, hexPath, drawHexagonOutline, hexToRgb, rgbToHex, frameInfo, CAMP_FLAG_COLORS, HEX_NEIGHBORS, hexEdge, TERRAIN_CONFIG, CAMP, settings } from './config.js';
import { FORTIFICATION_CONFIG } from './config.js';
import { EngineHexTile } from '../engine/HexTile.js';
import { campToKey } from '../rules/camps.js';

let _gameState = null;
export function setGameStateRef(ref) { _gameState = ref; }

export class HexTile extends EngineHexTile {
    constructor(q, r, idOverride = null) {
        super(q, r, idOverride);
        this.fadeDuration = 1500;
    }

    setCampWithFade(newCamp) {
        if (this.camp === newCamp && this.targetColor === newCamp.color) return;
        this.camp = newCamp;
        this.startColor = this.currentColor;
        this.targetColor = newCamp.color;
        this.fadeDuration = 1500 / settings.animationSpeed;
        this.fadeStartTime = performance.now();
    }

    updateFadeColor(now = performance.now()) {
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

    _drawTerrainGlyphs(c, cx, cy) {
        const glyphs = [];
        if (this.isVillage) {
            glyphs.push({
                icon: '🏡',
                font: '14px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif',
                color: 'rgba(255,255,255,0.8)'
            });
        }

        const terrain = TERRAIN_CONFIG[this.terrain];
        if (this.terrain !== 'plains' && terrain?.icon) {
            glyphs.push({
                icon: terrain.icon,
                font: terrain.iconFont,
                color: 'rgba(255,255,255,0.65)'
            });
        }

        const fortification = FORTIFICATION_CONFIG[this.fortification];
        if (fortification?.icon) {
            glyphs.push({
                icon: fortification.icon,
                font: fortification.iconFont,
                color: '#e8c477'
            });
        }

        if (glyphs.length === 0) return;

        const gap = 3;
        const widths = glyphs.map(glyph => {
            c.font = glyph.font;
            return c.measureText(glyph.icon).width;
        });
        const totalWidth = widths.reduce((sum, width) => sum + width, 0) + gap * (glyphs.length - 1);
        let glyphX = cx - totalWidth / 2;

        c.save();
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.shadowColor = 'rgba(0,0,0,0.3)';
        c.shadowBlur = 1;
        for (let index = 0; index < glyphs.length; index++) {
            const glyph = glyphs[index];
            c.font = glyph.font;
            c.fillStyle = glyph.color;
            c.fillText(glyph.icon, glyphX + widths[index] / 2, cy + HEX_SIZE * 0.5);
            glyphX += widths[index] + gap;
        }
        c.restore();
    }

    // Fill, shadow, and ordered terrain glyphs.
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
        }
        this._drawTerrainGlyphs(c, cx, cy);
        c.restore();
    }

    // Per-frame: animated city flag drawn AFTER all hex bases (avoids being covered)
    _flagParams() {
        if (!this.isCity && !this.isVillage) return null;
        const cx = this.x, cy = this.y;
        const flagCx = cx - HEX_SIZE * 0.55;
        const flagCy = cy - HEX_SIZE * 0.50;
        let effectiveCamp = this.camp;
        if (this.isVillage) {
            // 鏉戝簞鏃楀笢棰滆壊鍙栧喅浜庡綋鍓嶅彈鐩婇樀钀?
            if (this.unit) {
                effectiveCamp = this.unit.camp;
            } else {
                // 绌虹疆鏃跺彇琛屾斂鍖哄煄甯傛墍灞為樀钀?
                const gs = _gameState;
                if (gs) {
                    const cityTile = gs.tiles.find(t => t.isCity && t.districtId === this.villageDistrictId);
                    if (cityTile) effectiveCamp = cityTile.camp;
                }
            }
        }
        const key = campToKey(effectiveCamp);
        const campKey = key === 'player1' ? 'p1' : key === 'player2' ? 'p2' : key === 'player3' ? 'p3' : key === 'neutral' ? 'neu' : key;
        return {
            poleX: flagCx, poleTop: flagCy - 16, poleBottom: flagCy + 10,
            fc: CAMP_FLAG_COLORS[campKey] || { main: effectiveCamp?.color || '#777', dark: effectiveCamp?.color || '#555', light: effectiveCamp?.color || '#999' },
            flagLeft: flagCx + 1.5, flagRight: flagCx + 1.5 + 18,
            flagTop: flagCy - 16 + 3, flagMid: flagCy - 16 + 3 + 7, flagBot: flagCy - 16 + 3 + 16
        };
    }

    drawFlagPole() {
        const p = this._flagParams();
        if (!p) return;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(p.poleX, p.poleTop);
        ctx.lineTo(p.poleX, p.poleBottom);
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.restore();
    }

    drawFlagFinialAndCloth() {
        const p = this._flagParams();
        if (!p) return;
        const gs = _gameState;
        const now = frameInfo.now;
        const time = now / 1000;
        ctx.save();

        // Pole finial
        ctx.beginPath();
        ctx.arc(p.poleX, p.poleTop, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffd700';
        ctx.fill();

        // Waving flag (animated)
        const windMult = (gs && gs.weather === 'wind') ? 2.5 : 1.0;
        const wave = Math.sin(time * 5 * windMult + this.id * 0.7) * 2.5;
        ctx.beginPath();
        ctx.moveTo(p.flagLeft, p.flagTop);
        ctx.quadraticCurveTo(p.flagLeft + 6, p.flagMid - 3 + wave, p.flagRight, p.flagMid + wave);
        ctx.lineTo(p.flagRight, p.flagBot + wave * 0.6);
        ctx.quadraticCurveTo(p.flagLeft + 6, p.flagMid + 3 + wave * 0.6, p.flagLeft, p.flagBot);
        ctx.closePath();
        const flagGrad = ctx.createLinearGradient(p.flagLeft, 0, p.flagRight, 0);
        flagGrad.addColorStop(0, p.fc.main);
        flagGrad.addColorStop(1, p.fc.dark);
        ctx.fillStyle = flagGrad;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 0.8;
        ctx.stroke();

        // 灏嗛鏄熸爣锛堝煄鍐呮湁灏嗛鍗曚綅鏃讹紝璺熼殢鏃楀笢椋樺姩+鎵洸锛?
        if (this.unit && this.unit.commander) {
            ctx.save();
            const starX = p.flagLeft + 9;
            const starY = p.flagTop + 9 + wave * 0.5;
            ctx.translate(starX, starY);
            const waveTilt = Math.cos(time * 5 * windMult + this.id * 0.7) * 0.14;
            ctx.rotate(waveTilt);
            ctx.fillStyle = '#ffd700';
            ctx.font = 'bold 12px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = '#ffd700';
            ctx.shadowBlur = 6;
            ctx.fillText('★', 0, 0);
            ctx.restore();
        }

        ctx.restore();
    }

    // Per-frame: hover, selection highlights on main canvas
    drawOverlay() {
        const gs = _gameState;
        const cx = this.x, cy = this.y;
        const isSelected = gs && !gs.aiActing && gs.selectedUnit && gs.selectedUnit.tile === this;
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

// ==== 杈圭晫缁樺埗 ====
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

// 鎵惧埌 tileA 鐨勫摢鏉¤竟闈㈠悜 tileB锛堜粎鐢ㄤ簬娓℃渤娑堣€楁煡鎵撅紝娓叉煋涓嶄緷璧栨鍑芥暟锛?
function findSharedEdge(tileA, tileB) {
    for (let e = 0; e < 6; e++) {
        const [dq, dr] = HEX_NEIGHBORS[(e + 1) % 6];
        if (tileA.q + dq === tileB.q && tileA.r + dr === tileB.r) return e;
    }
    return -1;
}

// ==== 鍥界晫绾匡紙闃佃惀浜ょ晫锛?====
export function computeCampBorders(tiles, tileMap) {
    const borders = [];
    for (const tile of tiles) {
        const cx = tile.x, cy = tile.y;
        for (let e = 0; e < 6; e++) {
            // edge e faces neighbor at HEX_NEIGHBORS[(5 - e) % 6]
            const [dq, dr] = HEX_NEIGHBORS[(5 - e) % 6];
            const nb = tileMap.get(`${tile.q + dq},${tile.r + dr}`);
            if (!nb) continue;
            if (tile.camp === nb.camp) continue;
            if (tile.id > nb.id) continue;
            const ep = hexEdge(cx, cy, HEX_SIZE, e);
            borders.push({ x0: ep.x0, y0: ep.y0, x1: ep.x1, y1: ep.y1, qa: tile.q, ra: tile.r, qb: nb.q, rb: nb.r });
        }
    }
    return borders;
}

export function drawCampBorders(ctx2d, borderEdges) {
    if (!borderEdges || borderEdges.length === 0) return;

    ctx2d.save();
    ctx2d.lineCap = 'round';
    ctx2d.lineJoin = 'round';

    // 澶栧眰娣辩伆绮楃嚎 + 鍙戝厜
    ctx2d.shadowColor = 'rgba(80, 80, 80, 0.5)';
    ctx2d.shadowBlur = 6;
    ctx2d.setLineDash([12, 7]);
    ctx2d.lineWidth = 5;
    ctx2d.strokeStyle = 'rgba(60, 60, 60, 0.85)';
    for (const edge of borderEdges) {
        ctx2d.beginPath();
        ctx2d.moveTo(edge.x0, edge.y0);
        ctx2d.lineTo(edge.x1, edge.y1);
        ctx2d.stroke();
    }

    // 鍐呭眰绋嶆祬铏氱嚎
    ctx2d.shadowBlur = 0;
    ctx2d.lineDashOffset = 3;
    ctx2d.lineWidth = 2.5;
    ctx2d.strokeStyle = 'rgba(120, 120, 120, 0.7)';
    for (const edge of borderEdges) {
        ctx2d.beginPath();
        ctx2d.moveTo(edge.x0, edge.y0);
        ctx2d.lineTo(edge.x1, edge.y1);
        ctx2d.stroke();
    }

    ctx2d.setLineDash([]);
    ctx2d.restore();
}

// ==== 琛屾斂鍖虹晫绾匡紙鍚岄樀钀ヤ笉鍚岃鏀垮尯锛?====
export function computeDistrictBorders(tiles, tileMap) {
    const borders = [];
    for (const tile of tiles) {
        const cx = tile.x, cy = tile.y;
        for (let e = 0; e < 6; e++) {
            const [dq, dr] = HEX_NEIGHBORS[(5 - e) % 6];
            const nb = tileMap.get(`${tile.q + dq},${tile.r + dr}`);
            if (!nb) continue;
            if (tile.camp !== nb.camp) continue;        // 涓嶅悓闃佃惀 鈫?鐢卞浗鐣岀嚎澶勭悊
            if (tile.districtId === nb.districtId) continue; // 鍚岃鏀垮尯 鈫?涓嶇敾
            if (tile.id > nb.id) continue;
            const ep = hexEdge(cx, cy, HEX_SIZE, e);
            borders.push({ x0: ep.x0, y0: ep.y0, x1: ep.x1, y1: ep.y1, qa: tile.q, ra: tile.r, qb: nb.q, rb: nb.r });
        }
    }
    return borders;
}

export function drawDistrictBorders(ctx2d, borderEdges) {
    if (!borderEdges || borderEdges.length === 0) return;

    ctx2d.save();
    ctx2d.lineCap = 'round';
    ctx2d.lineJoin = 'round';
    ctx2d.setLineDash([8, 5]);
    ctx2d.lineWidth = 2.3;
    ctx2d.strokeStyle = 'rgba(50, 50, 50, 0.5)';
    for (const edge of borderEdges) {
        ctx2d.beginPath();
        ctx2d.moveTo(edge.x0, edge.y0);
        ctx2d.lineTo(edge.x1, edge.y1);
        ctx2d.stroke();
    }
    ctx2d.setLineDash([]);
    ctx2d.restore();
}
