import { HEX_SIZE, HEX_WIDTH, LOGICAL_W, LOGICAL_H, ctx, hexPath, drawHexagonOutline, hexToRgb, rgbToHex, HEX_NEIGHBORS, hexEdge, TERRAIN_CONFIG, settings } from './config.js';
import { FORTIFICATION_CONFIG } from './config.js';
import { EngineHexTile } from '../engine/HexTile.js';
import { CITY_FLAG_LAYOUT } from './flagLayout.js';
import { getCityMarkerColors } from '../rules/camps.js';
import { isLandTile } from '../rules/surfaces.js';

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
        const drawsFlakTexture = this.fortification === 'flak';
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
        if (fortification?.icon && !drawsFlakTexture) {
            glyphs.push({
                icon: fortification.icon,
                font: fortification.iconFont,
                color: '#e8c477'
            });
        }

        if (glyphs.length === 0) {
            if (drawsFlakTexture) this._drawFlakFortification(c, cx, cy);
            return;
        }

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

        if (drawsFlakTexture) this._drawFlakFortification(c, cx, cy);
    }

    _drawFlakFortification(c, cx, cy) {
        const size = HEX_SIZE;
        c.save();
        c.translate(cx, cy + size * 0.06);
        c.lineCap = 'round';
        c.lineJoin = 'round';

        // Earthen emplacement: the two semicircles remain readable around a
        // production-size unit badge while keeping the military-map palette.
        c.beginPath();
        c.ellipse(0, 0, size * 0.6, size * 0.36, 0, Math.PI, Math.PI * 2);
        c.strokeStyle = 'rgba(68,52,34,0.72)';
        c.lineWidth = size * 0.16;
        c.stroke();
        c.strokeStyle = 'rgba(193,158,97,0.88)';
        c.lineWidth = size * 0.035;
        c.setLineDash([size * 0.08, size * 0.045]);
        c.stroke();
        c.setLineDash([]);

        // Positive rotation turns an upward barrel toward the upper-right in
        // Canvas coordinates. The longer muzzles clear the unit HUD footprint.
        c.save();
        c.rotate(0.34);
        c.strokeStyle = 'rgba(34,37,36,0.48)';
        c.lineWidth = size * 0.15;
        c.beginPath();
        c.moveTo(-size * 0.065, size * 0.02);
        c.lineTo(-size * 0.065, -size * 0.88);
        c.moveTo(size * 0.095, size * 0.02);
        c.lineTo(size * 0.095, -size * 0.83);
        c.stroke();
        c.strokeStyle = '#4a4d48';
        c.lineWidth = size * 0.09;
        c.stroke();
        c.strokeStyle = 'rgba(181,183,166,0.72)';
        c.lineWidth = size * 0.018;
        c.stroke();
        c.restore();

        c.fillStyle = '#645d50';
        c.strokeStyle = 'rgba(37,35,31,0.9)';
        c.lineWidth = 1;
        c.beginPath();
        c.arc(0, 0, size * 0.19, 0, Math.PI * 2);
        c.fill();
        c.stroke();

        c.beginPath();
        c.ellipse(0, 0, size * 0.6, size * 0.36, 0, 0, Math.PI);
        c.strokeStyle = '#826b47';
        c.lineWidth = size * 0.13;
        c.stroke();
        c.strokeStyle = 'rgba(213,190,135,0.8)';
        c.lineWidth = size * 0.025;
        c.setLineDash([size * 0.08, size * 0.04]);
        c.stroke();
        c.setLineDash([]);
        c.restore();
    }

    // Fill, shadow, and ordered terrain glyphs.
    drawBase(c, options) {
        const drawShadow = options?.drawShadow !== false;
        const drawLegacyMapDetails = options?.drawLegacyMapDetails !== false;
        const cx = this.x, cy = this.y;
        c.save();
        if (drawShadow) {
            hexPath(c, cx + 1.5, cy + 2, HEX_SIZE);
            c.fillStyle = 'rgba(0,0,0,0.14)';
            c.fill();
        }
        hexPath(c, cx, cy, HEX_SIZE);
        c.fillStyle = this.currentColor;
        c.fill();

        if (drawLegacyMapDetails && this.isCity) {
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
        if (drawLegacyMapDetails) this._drawTerrainGlyphs(c, cx, cy);
        c.restore();
    }

    // Continuous terrain replaces the old per-cell emoji/glyph layer.  Flak
    // remains a deliberately bespoke map texture, so it is deferred until the
    // cached terrain/hydrography layers have been drawn instead of disappearing
    // beneath a forest canopy or port detail.
    drawDeferredMapDetails(c) {
        if (this.fortification !== 'flak') return;
        this._drawFlakFortification(c, this.x, this.y);
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
        return {
            poleX: flagCx,
            poleTop: flagCy + CITY_FLAG_LAYOUT.poleTopOffset,
            poleBottom: flagCy + CITY_FLAG_LAYOUT.poleBottomOffset,
            camp: effectiveCamp,
            flagLeft: flagCx + CITY_FLAG_LAYOUT.clothOffsetX,
            flagTop: flagCy + CITY_FLAG_LAYOUT.poleTopOffset + CITY_FLAG_LAYOUT.clothOffsetY
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

        // Only city standards use a grounded pedestal; village and unit poles
        // stay visually light so the ownership hierarchy remains obvious.
        if (this.isCity) {
            const halfBase = CITY_FLAG_LAYOUT.baseWidth / 2;
            const baseTop = p.poleBottom - CITY_FLAG_LAYOUT.baseHeight * 0.4;
            const baseBottom = p.poleBottom + CITY_FLAG_LAYOUT.baseHeight * 0.6;
            ctx.beginPath();
            ctx.ellipse(p.poleX, baseBottom + 0.8, halfBase + 0.8, 1.4, 0, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(25,18,10,0.35)';
            ctx.fill();

            const baseGradient = ctx.createLinearGradient(p.poleX - halfBase, 0, p.poleX + halfBase, 0);
            baseGradient.addColorStop(0, '#72501c');
            baseGradient.addColorStop(0.48, '#e3c567');
            baseGradient.addColorStop(1, '#684516');
            ctx.beginPath();
            ctx.moveTo(p.poleX - halfBase, baseBottom);
            ctx.lineTo(p.poleX + halfBase, baseBottom);
            ctx.lineTo(p.poleX + halfBase * 0.58, baseTop);
            ctx.lineTo(p.poleX - halfBase * 0.58, baseTop);
            ctx.closePath();
            ctx.fillStyle = baseGradient;
            ctx.fill();
            ctx.strokeStyle = 'rgba(55,36,12,0.8)';
            ctx.lineWidth = 0.7;
            ctx.stroke();

            ctx.beginPath();
            ctx.ellipse(p.poleX, baseTop, halfBase * 0.58, 0.75, 0, 0, Math.PI * 2);
            ctx.fillStyle = '#efd987';
            ctx.fill();
        }
        ctx.restore();
    }

    getFlagRenderData() {
        const p = this._flagParams();
        if (!p) return null;
        return {
            x: p.flagLeft,
            y: p.flagTop,
            width: CITY_FLAG_LAYOUT.width,
            height: CITY_FLAG_LAYOUT.height,
            camp: p.camp,
            commander: Boolean(this.unit?.isCommanderUnit ?? this.unit?.commander)
        };
    }

    drawFlagFinial() {
        const p = this._flagParams();
        if (!p) return;
        ctx.save();

        // Pole finial
        ctx.beginPath();
        ctx.arc(p.poleX, p.poleTop, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffd700';
        ctx.fill();

        ctx.restore();
    }

    // Military-map city symbol. Its hue follows the occupying faction while
    // using palette light/dark accents instead of the main flag color.
    drawCityMapMarker() {
        if (!this.isCity) return;
        const occupied = !!this.unit;
        const outerRadius = 22.5;
        const innerRadius = 19.5;
        const marker = getCityMarkerColors(this.camp?.colorId || this.camp?.color);
        const lineRgb = hexToRgb(marker.line);
        const shadowRgb = hexToRgb(marker.shadow);
        const line = alpha => `rgba(${lineRgb.r},${lineRgb.g},${lineRgb.b},${alpha})`;
        const shadow = alpha => `rgba(${shadowRgb.r},${shadowRgb.g},${shadowRgb.b},${alpha})`;
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.lineJoin = 'round';

        // Eight low bastions form a compact fortified-settlement outline.
        ctx.beginPath();
        for (let i = 0; i < 16; i++) {
            const angle = -Math.PI / 2 + i * Math.PI / 8;
            const radius = i % 2 === 0 ? outerRadius : innerRadius;
            const px = Math.cos(angle) * radius;
            const py = Math.sin(angle) * radius;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = shadow(occupied ? 0.16 : 0.09);
        ctx.fill();
        ctx.strokeStyle = shadow(occupied ? 0.72 : 0.55);
        ctx.lineWidth = occupied ? 3.1 : 2.6;
        ctx.shadowColor = 'rgba(20,16,12,0.42)';
        ctx.shadowBlur = 1.5;
        ctx.stroke();
        ctx.strokeStyle = line(occupied ? 0.96 : 0.78);
        ctx.lineWidth = occupied ? 1.45 : 1.15;
        ctx.stroke();

        // A dashed inner enceinte and tiny south gate make the symbol read as
        // a mapped city/fortification rather than another selection ring.
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(0, 0, 18.3, 0, Math.PI * 2);
        ctx.setLineDash([2.4, 2.2]);
        ctx.strokeStyle = line(occupied ? 0.72 : 0.52);
        ctx.lineWidth = 0.85;
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = line(0.96);
        ctx.fillRect(-3.2, 19.1, 6.4, 3.4);
        ctx.fillStyle = shadow(0.94);
        ctx.fillRect(-1.05, 20.15, 2.1, 2.35);
        ctx.restore();
    }

    // Per-frame: hover, selection highlights on main canvas
    drawOverlay() {
        const gs = _gameState;
        const cx = this.x, cy = this.y;
        const isHovered = gs && gs.hoveredTile === this;
        if (!isHovered) return;

        ctx.save();
        hexPath(ctx, cx, cy, HEX_SIZE);
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.fill();
        drawHexagonOutline(ctx, cx, cy, HEX_SIZE, 'rgba(255,255,255,0.30)', 1.3);
        ctx.restore();
    }

    drawUnit() {
        if (this.unit) this.unit.draw(this.x, this.y);
    }
}

function edgeNeighborOffset(edgeIndex) {
    return HEX_NEIGHBORS[(5 - edgeIndex) % 6];
}

// ==== 杈圭晫缁樺埗 ====
export function drawAllBorders(c, tiles, tileMap) {
    for (const tile of tiles) {
        const cx = tile.x, cy = tile.y;

        for (let e = 0; e < 6; e++) {
            // hexEdge 的顶点按顺时针排列；edge e 面向的轴坐标邻居是 5 - e。
            // 使用错误邻居做去重会让一部分共享边重复描画、另一部分被漏掉。
            const [dq, dr] = edgeNeighborOffset(e);
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
        const [dq, dr] = edgeNeighborOffset(e);
        if (tileA.q + dq === tileB.q && tileA.r + dr === tileB.r) return e;
    }
    return -1;
}

// ==== 鍥界晫绾匡紙闃佃惀浜ょ晫锛?====
export function computeCampBorders(tiles, tileMap) {
    const borders = [];
    for (const tile of tiles) {
        if (tile?.renderOnly === true || tile?.playable === false || !isLandTile(tile)) continue;
        const cx = tile.x, cy = tile.y;
        for (let e = 0; e < 6; e++) {
            // edge e faces neighbor at HEX_NEIGHBORS[(5 - e) % 6]
            const [dq, dr] = edgeNeighborOffset(e);
            const nb = tileMap.get(`${tile.q + dq},${tile.r + dr}`);
            if (!nb || nb.renderOnly === true || nb.playable === false || !isLandTile(nb)) continue;
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
        if (tile?.renderOnly === true || tile?.playable === false || !isLandTile(tile)) continue;
        const cx = tile.x, cy = tile.y;
        for (let e = 0; e < 6; e++) {
            const [dq, dr] = edgeNeighborOffset(e);
            const nb = tileMap.get(`${tile.q + dq},${tile.r + dr}`);
            if (!nb || nb.renderOnly === true || nb.playable === false || !isLandTile(nb)) continue;
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
