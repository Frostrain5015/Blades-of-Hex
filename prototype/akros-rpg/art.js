// 程序化美术：启动时把地面、道具、角色四向行走帧烘焙进离屏 canvas，运行期只做 blit。
// 不引入任何外部美术资源（立绘除外，走 HTTP 读 img/commander/*.webp）。
// 所有精灵按 SS 倍超采样绘制，blit 时按逻辑尺寸缩回，保证高 DPI 下依然锐利。

import { createRng, clamp } from './util.js';

// ============ 调色板 ============
// 主色取自 VISUAL_DESIGN.md §2：鸢尾红 / 深紫 / 草土绿 / 林冠绿 / 暖金。

export const PALETTE = Object.freeze({
    irisRed: '#9e3438', irisRedHi: '#c05046', irisRedDark: '#6d2226',
    regencyPurple: '#5b3c72', regencyPurpleHi: '#7d569a',
    grassGreen: '#849860', canopyGreen: '#46583f',
    warmGold: '#d5b56f', gold: '#ffd700', brass: '#8a6d3b',

    stone: '#6f675c', stoneHi: '#867d70', stoneDark: '#4e483f', stoneGrout: '#3c372f',
    plaster: '#c2ac89', plasterHi: '#d8c4a3', plasterDark: '#96825f',
    roof: '#a04a3c', roofHi: '#bd6046', roofDark: '#743029',
    wood: '#6d4c30', woodHi: '#8d6339', woodDark: '#452f1c',
    bronze: '#b98a4a', bronzeHi: '#e0b273', iron: '#5c626a', ironHi: '#8f97a1',
    cloth: '#b9a887', clothDark: '#8d7d5f',
    skin: '#d6a678', skinDark: '#a97c50', skinPale: '#e8c39a',
    water: '#3d5a63', waterHi: '#5b828a', waterDeep: '#263d47',
    sand: '#b5a077', sandDark: '#8e7c58',
    ink: '#241a12'
});

const SS = 2;                       // 超采样倍率
const rng = createRng(0x9e3438);    // 固定种子：截图可复现

// ============ 烘焙基元 ============

/** 建一张离屏画布并按 SS 缩放坐标系；drawFn 用逻辑尺寸作画。 */
export function bake(w, h, drawFn) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * SS));
    canvas.height = Math.max(1, Math.round(h * SS));
    const ctx = canvas.getContext('2d');
    ctx.scale(SS, SS);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    drawFn(ctx, w, h);
    return { canvas, w, h };
}

/** 把烘焙精灵画到目标 ctx，(x, y) 为左上角。 */
export function blit(ctx, sprite, x, y) {
    ctx.drawImage(sprite.canvas, x, y, sprite.w, sprite.h);
}

/** 以脚底中心为锚点画角色精灵。 */
export function blitAnchored(ctx, sprite, x, y, anchorX, anchorY) {
    ctx.drawImage(sprite.canvas, x - anchorX, y - anchorY, sprite.w, sprite.h);
}

function vgrad(ctx, x, y, w, h, top, bottom) {
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
}

function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
}

/** 在区域内撒噪点，用来打散大面积纯色。 */
function speckle(ctx, x, y, w, h, color, count, alpha, size = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    for (let i = 0; i < count; i++) {
        ctx.fillRect(x + rng.next() * w, y + rng.next() * h, size, size);
    }
    ctx.restore();
}

// ============ 地面瓦片（64×64 可平铺） ============

const TILE_BAKE = 96;

/**
 * 街面石板。整齐的砖格会读成一堵墙——这里改用「抖动点阵」：
 * 每个格位的石头中心随机偏移、尺寸与转角各不相同，相邻石块互相压边补缝，
 * 出来的是碎石铺装（crazy paving）而不是砌体。明暗只做极轻的中心受光，不做立面斜角。
 */
function bakeCobble() {
    const CELL = 8;
    return bake(TILE_BAKE, TILE_BAKE, (ctx, w, h) => {
        ctx.fillStyle = '#5f584a';                       // 灰浆：比石头略暗即可，压太黑就成砖缝了
        ctx.fillRect(0, 0, w, h);
        speckle(ctx, 0, 0, w, h, '#4d4638', 600, 0.30);

        const cells = Math.round(w / CELL);
        // 多画一圈越界的石头，保证四边可无缝平铺
        for (let j = -1; j <= cells; j++) {
            for (let i = -1; i <= cells; i++) {
                // 约一成是压两格的大板石，打破单一粒径
                const big = rng.chance(0.10);
                const cx = (i + 0.5) * CELL + rng.range(-1.7, 1.7);
                const cy = (j + 0.5) * CELL + rng.range(-1.7, 1.7);
                const sw = CELL * (big ? rng.range(1.7, 2.2) : rng.range(0.92, 1.24));
                const sh = CELL * (big ? rng.range(1.2, 1.8) : rng.range(0.90, 1.20));
                const tone = rng.range(-0.11, 0.10);
                const warm = rng.chance(0.26) ? '#7a7061' : (rng.chance(0.4) ? '#69665e' : PALETTE.stone);

                ctx.save();
                ctx.translate(cx, cy);
                ctx.rotate(rng.range(-0.34, 0.34));
                ctx.fillStyle = shift(warm, tone);
                roundRect(ctx, -sw / 2, -sh / 2, sw, sh, rng.range(1, 2.2));
                ctx.fill();
                // 极轻的中心受光。做重了石头会变成鹅卵石，读起来像沙滩而不是街面
                ctx.globalAlpha = 0.11;
                const g = ctx.createRadialGradient(-sw * 0.14, -sh * 0.18, 0.5, 0, 0, sw * 0.7);
                g.addColorStop(0, shift(warm, tone + 0.36));
                g.addColorStop(1, rgba('#000000', 0));
                ctx.fillStyle = g;
                roundRect(ctx, -sw / 2, -sh / 2, sw, sh, 2);
                ctx.fill();
                if (rng.chance(0.22)) {
                    ctx.globalAlpha = 0.12;
                    ctx.strokeStyle = '#241f18';
                    ctx.lineWidth = 0.6;
                    ctx.beginPath();
                    ctx.moveTo(rng.range(-sw / 2, 0), rng.range(-sh / 2, 0));
                    ctx.lineTo(rng.range(0, sw / 2), rng.range(0, sh / 2));
                    ctx.stroke();
                }
                ctx.globalAlpha = 1;
                ctx.restore();
            }
        }
        // 缝隙里的青苔与积尘
        speckle(ctx, 0, 0, w, h, '#5f6647', 150, 0.14, 2);
        speckle(ctx, 0, 0, w, h, '#938a76', 220, 0.09);
    });
}

function bakeDirt() {
    return bake(TILE_BAKE, TILE_BAKE, (ctx, w, h) => {
        ctx.fillStyle = '#7b6a4e';
        ctx.fillRect(0, 0, w, h);
        speckle(ctx, 0, 0, w, h, '#5f5138', 600, 0.30);
        speckle(ctx, 0, 0, w, h, '#8f7c5b', 400, 0.26);
        // 车辙与踩踏痕
        ctx.strokeStyle = '#6a5a41';
        ctx.globalAlpha = 0.5;
        for (let i = 0; i < 5; i++) {
            ctx.lineWidth = rng.range(1, 2.4);
            ctx.beginPath();
            const y = rng.next() * h;
            ctx.moveTo(0, y);
            ctx.bezierCurveTo(w * 0.3, y + rng.range(-5, 5), w * 0.7, y + rng.range(-5, 5), w, y);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
        for (let i = 0; i < 14; i++) {
            ctx.fillStyle = '#928068';
            ctx.globalAlpha = 0.5;
            ctx.beginPath();
            ctx.ellipse(rng.next() * w, rng.next() * h, rng.range(1, 2.6), rng.range(0.8, 1.8), rng.next() * 3, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    });
}

function bakeSand() {
    return bake(TILE_BAKE, TILE_BAKE, (ctx, w, h) => {
        vgrad(ctx, 0, 0, w, h, PALETTE.sand, PALETTE.sandDark);
        speckle(ctx, 0, 0, w, h, '#cbb68b', 520, 0.28);
        speckle(ctx, 0, 0, w, h, '#7d6c4b', 320, 0.24);
        // 耙过的校场沙纹
        ctx.strokeStyle = '#9b8a63';
        ctx.globalAlpha = 0.32;
        ctx.lineWidth = 1;
        for (let y = 3; y < h; y += 6) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.bezierCurveTo(w * 0.33, y + 1.6, w * 0.66, y - 1.6, w, y);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    });
}

function bakeGrass() {
    return bake(TILE_BAKE, TILE_BAKE, (ctx, w, h) => {
        ctx.fillStyle = PALETTE.grassGreen;
        ctx.fillRect(0, 0, w, h);
        speckle(ctx, 0, 0, w, h, PALETTE.canopyGreen, 500, 0.30);
        ctx.strokeStyle = '#98ab72';
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.55;
        for (let i = 0; i < 130; i++) {
            const x = rng.next() * w, y = rng.next() * h;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + rng.range(-1.5, 1.5), y - rng.range(1.5, 3.5));
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    });
}

/** 木栈道。板条竖向排列（垂直于岸线，栈桥的真实做法），横向条纹会读成地板贴图。 */
function bakePlank() {
    const BOARD_W = 96 / 8;
    return bake(TILE_BAKE, TILE_BAKE, (ctx, w, h) => {
        ctx.fillStyle = '#2b1d11';                          // 板缝里透出的暗处
        ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 8; i++) {
            const x = i * BOARD_W;
            const base = rng.chance(0.3) ? '#8f6942' : (rng.chance(0.5) ? '#7d5a37' : '#6d4e30');
            const g = ctx.createLinearGradient(x, 0, x + BOARD_W, 0);
            g.addColorStop(0, shift(base, 0.14));
            g.addColorStop(0.4, base);
            g.addColorStop(1, shift(base, -0.24));
            ctx.fillStyle = g;
            ctx.fillRect(x + 0.7, 0, BOARD_W - 1.6, h);
            // 顺纹
            ctx.strokeStyle = shift(base, -0.40);
            ctx.globalAlpha = 0.40;
            ctx.lineWidth = 0.8;
            for (let k = 0; k < 3; k++) {
                const gx = x + 2.4 + k * 3.2;
                ctx.beginPath();
                ctx.moveTo(gx, 0);
                ctx.bezierCurveTo(gx + rng.range(-1, 1), h * 0.33, gx + rng.range(-1, 1), h * 0.66, gx, h);
                ctx.stroke();
            }
            ctx.globalAlpha = 0.55;
            if (rng.chance(0.55)) {
                ctx.fillStyle = shift(base, -0.38);
                ctx.beginPath();
                ctx.ellipse(x + BOARD_W / 2, rng.range(10, h - 10), 1.7, 2.6, 0, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
            // 受光的板边 + 横梁位置的钉头
            ctx.fillStyle = 'rgba(255,232,190,0.09)';
            ctx.fillRect(x + 0.7, 0, 1, h);
            ctx.fillStyle = '#585d62';
            for (const ny of [8, 40, 72]) {
                ctx.beginPath(); ctx.arc(x + BOARD_W / 2, ny, 1.1, 0, Math.PI * 2); ctx.fill();
            }
        }
        // 横向压条：每隔一段的托梁投影，打断纯竖纹
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = '#2b1d11';
        ctx.fillRect(0, 46, w, 3);
        ctx.globalAlpha = 1;
    });
}

function bakeWater() {
    return bake(TILE_BAKE, TILE_BAKE, (ctx, w, h) => {
        vgrad(ctx, 0, 0, w, h, PALETTE.water, PALETTE.waterDeep);
        ctx.strokeStyle = PALETTE.waterHi;
        ctx.lineWidth = 1.2;
        for (let i = 0; i < 16; i++) {
            ctx.globalAlpha = rng.range(0.10, 0.34);
            const y = rng.next() * h;
            const x = rng.next() * w;
            const len = rng.range(6, 20);
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.quadraticCurveTo(x + len / 2, y - 1.6, x + len, y);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    });
}

// ============ 颜色工具 ============

function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 明暗平移：amount > 0 提亮，< 0 压暗。 */
export function shift(hex, amount) {
    const [r, g, b] = hexToRgb(hex);
    const f = (v) => clamp(Math.round(amount > 0 ? v + (255 - v) * amount : v * (1 + amount)), 0, 255);
    return `rgb(${f(r)},${f(g)},${f(b)})`;
}

export function rgba(hex, alpha) {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r},${g},${b},${alpha})`;
}

// ============ 建筑（斜投影：俯视屋顶 + 向南延伸的正面墙） ============

/**
 * 直接画进静态层。footprint 以像素给出。
 * opts: { roofColor, wallColor, facadeH, door, awning, sign, windows, shutters, windowBox }
 */
export function drawBuilding(ctx, x, y, w, h, opts = {}) {
    const facadeH = opts.facadeH ?? 46;
    const roofColor = opts.roofColor || PALETTE.roof;
    const wallColor = opts.wallColor || PALETTE.plaster;
    const roofH = h - facadeH;

    // —— 落影 ——
    ctx.save();
    ctx.fillStyle = 'rgba(20,14,8,0.34)';
    ctx.filter = 'blur(3px)';
    ctx.fillRect(x + 6, y + 8, w, h);
    ctx.restore();

    // —— 屋顶：逐片陶瓦 ——
    vgrad(ctx, x, y, w, roofH, shift(roofColor, 0.16), shift(roofColor, -0.18));
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, roofH);
    ctx.clip();
    for (let ty = 0; ty < roofH; ty += 7) {
        for (let tx = -6; tx < w; tx += 11) {
            const ox = ((ty / 7) | 0) % 2 ? 5.5 : 0;
            ctx.fillStyle = shift(roofColor, rng.range(-0.13, 0.11));
            ctx.beginPath();
            ctx.moveTo(x + tx + ox, y + ty + 7);
            ctx.quadraticCurveTo(x + tx + ox + 5, y + ty - 1.5, x + tx + ox + 10, y + ty + 7);
            ctx.closePath();
            ctx.fill();
        }
    }
    // 屋脊高光
    ctx.globalAlpha = 0.30;
    ctx.fillStyle = PALETTE.roofHi;
    ctx.fillRect(x, y, w, 3);
    ctx.globalAlpha = 0.24;
    ctx.fillStyle = PALETTE.roofDark;
    ctx.fillRect(x, y + roofH - 4, w, 4);
    ctx.globalAlpha = 1;
    ctx.restore();

    // 屋檐挑出
    ctx.fillStyle = shift(roofColor, -0.34);
    ctx.fillRect(x - 3, y + roofH - 2, w + 6, 4);
    ctx.fillStyle = shift(roofColor, 0.10);
    ctx.fillRect(x - 3, y + roofH - 2, w + 6, 1.4);

    // —— 正面墙 ——
    const fy = y + roofH + 2;
    vgrad(ctx, x, fy, w, facadeH, shift(wallColor, 0.10), shift(wallColor, -0.22));
    speckle(ctx, x, fy, w, facadeH, shift(wallColor, -0.34), 160, 0.20);
    // 墙脚湿痕
    ctx.fillStyle = 'rgba(50,40,28,0.26)';
    ctx.fillRect(x, fy + facadeH - 7, w, 7);
    // 木构架
    ctx.fillStyle = PALETTE.woodDark;
    ctx.globalAlpha = 0.7;
    ctx.fillRect(x, fy, w, 2.4);
    ctx.fillRect(x, fy + facadeH - 2.4, w, 2.4);
    ctx.globalAlpha = 1;

    // —— 门 ——
    if (opts.door !== false) {
        const dw = 20, dh = facadeH - 12;
        const dx = x + (opts.doorAt ?? w * 0.5) - dw / 2;
        const dy = fy + facadeH - dh;
        ctx.fillStyle = PALETTE.woodDark;
        ctx.fillRect(dx - 2, dy - 2, dw + 4, dh + 2);
        vgrad(ctx, dx, dy, dw, dh, PALETTE.woodHi, PALETTE.wood);
        ctx.strokeStyle = 'rgba(40,28,16,0.5)';
        ctx.lineWidth = 1;
        for (let i = 1; i < 4; i++) {
            ctx.beginPath();
            ctx.moveTo(dx + i * dw / 4, dy);
            ctx.lineTo(dx + i * dw / 4, dy + dh);
            ctx.stroke();
        }
        ctx.fillStyle = PALETTE.bronzeHi;
        ctx.beginPath();
        ctx.arc(dx + dw - 4, dy + dh * 0.55, 1.6, 0, Math.PI * 2);
        ctx.fill();
    }

    // —— 窗（带百叶与窗台鸢尾花箱） ——
    const windows = opts.windows ?? 2;
    for (let i = 0; i < windows; i++) {
        const ww = 13, wh = 15;
        const wx = x + (w / (windows + 1)) * (i + 1) - ww / 2 + (opts.windowShift ?? 0);
        const wy = fy + 7;
        if (Math.abs(wx + ww / 2 - (x + (opts.doorAt ?? w * 0.5))) < 16) continue;   // 避开门
        ctx.fillStyle = PALETTE.woodDark;
        ctx.fillRect(wx - 1.6, wy - 1.6, ww + 3.2, wh + 3.2);
        vgrad(ctx, wx, wy, ww, wh, '#2b2620', '#151210');
        ctx.strokeStyle = PALETTE.wood;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(wx + ww / 2, wy); ctx.lineTo(wx + ww / 2, wy + wh);
        ctx.moveTo(wx, wy + wh / 2); ctx.lineTo(wx + ww, wy + wh / 2);
        ctx.stroke();
        if (opts.shutters !== false) {
            ctx.fillStyle = shift(PALETTE.wood, -0.12);
            ctx.fillRect(wx - 5, wy - 1, 4, wh + 2);
            ctx.fillRect(wx + ww + 1, wy - 1, 4, wh + 2);
        }
        if (opts.windowBox !== false) drawIrisBox(ctx, wx - 2, wy + wh + 1, ww + 4);
    }

    // —— 雨棚 ——
    if (opts.awning) drawAwning(ctx, x + 4, fy + 4, w - 8, opts.awning);

    // —— 挂牌 ——
    if (opts.sign) drawShopSign(ctx, x + (opts.signAt ?? w - 18), fy + 6, opts.sign);
}

/** 窗台鸢尾花箱：紫瓣 + 金蕊，外城区的视觉签名。 */
export function drawIrisBox(ctx, x, y, w) {
    ctx.fillStyle = PALETTE.woodDark;
    ctx.fillRect(x, y, w, 4.5);
    ctx.fillStyle = PALETTE.woodHi;
    ctx.fillRect(x, y, w, 1.2);
    for (let i = 0; i < Math.max(3, w / 5); i++) {
        const fx = x + 2 + rng.next() * (w - 4);
        const fy = y - rng.range(2, 6);
        ctx.strokeStyle = PALETTE.canopyGreen;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(fx, y);
        ctx.lineTo(fx + rng.range(-1, 1), fy);
        ctx.stroke();
        ctx.fillStyle = rng.chance(0.75) ? PALETTE.regencyPurple : PALETTE.regencyPurpleHi;
        ctx.beginPath();
        ctx.ellipse(fx, fy, 1.7, 2.2, rng.range(-0.4, 0.4), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = PALETTE.warmGold;
        ctx.fillRect(fx - 0.4, fy - 0.4, 0.9, 0.9);
    }
}

function drawAwning(ctx, x, y, w, color) {
    const h = 11;
    ctx.save();
    ctx.fillStyle = 'rgba(20,14,8,0.28)';
    ctx.fillRect(x, y + h, w, 4);
    ctx.restore();
    const stripe = 8;
    for (let i = 0; i * stripe < w; i++) {
        ctx.fillStyle = i % 2 ? shift(color, -0.20) : shift(color, 0.10);
        ctx.beginPath();
        ctx.moveTo(x + i * stripe, y);
        ctx.lineTo(x + Math.min(w, (i + 1) * stripe), y);
        ctx.lineTo(x + Math.min(w, (i + 1) * stripe), y + h);
        ctx.quadraticCurveTo(x + i * stripe + stripe / 2, y + h + 3, x + i * stripe, y + h);
        ctx.closePath();
        ctx.fill();
    }
    ctx.fillStyle = PALETTE.woodDark;
    ctx.fillRect(x - 1, y - 1.5, w + 2, 2.5);
}

function drawShopSign(ctx, x, y, glyph) {
    ctx.strokeStyle = PALETTE.iron;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x + 7, y);
    ctx.lineTo(x + 7, y + 5);
    ctx.stroke();
    ctx.fillStyle = 'rgba(20,14,8,0.3)';
    ctx.fillRect(x + 1, y + 7, 16, 14);
    vgrad(ctx, x, y + 5, 16, 14, PALETTE.woodHi, PALETTE.wood);
    ctx.strokeStyle = PALETTE.brass;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 5.5, 15, 13);
    ctx.font = '11px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = PALETTE.warmGold;
    ctx.fillText(glyph, x + 8, y + 12.6);
}

// ============ 道具 ============

function bakeBarrel() {
    return bake(20, 24, (ctx) => {
        ctx.fillStyle = 'rgba(20,14,8,0.32)';
        ctx.beginPath(); ctx.ellipse(10, 22, 9, 3, 0, 0, Math.PI * 2); ctx.fill();
        const g = ctx.createLinearGradient(1, 0, 19, 0);
        g.addColorStop(0, PALETTE.woodDark);
        g.addColorStop(0.38, PALETTE.woodHi);
        g.addColorStop(1, PALETTE.woodDark);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(3, 5); ctx.quadraticCurveTo(0.5, 12, 3, 22);
        ctx.lineTo(17, 22); ctx.quadraticCurveTo(19.5, 12, 17, 5);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = PALETTE.iron;
        ctx.fillRect(1.6, 8, 16.8, 2.2);
        ctx.fillRect(1.6, 17, 16.8, 2.2);
        ctx.fillStyle = PALETTE.ironHi;
        ctx.fillRect(1.6, 8, 16.8, 0.8);
        ctx.fillStyle = shift(PALETTE.wood, 0.22);
        ctx.beginPath(); ctx.ellipse(10, 5, 7, 2.6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = PALETTE.woodDark; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.ellipse(10, 5, 7, 2.6, 0, 0, Math.PI * 2); ctx.stroke();
    });
}

function bakeCrate() {
    return bake(22, 22, (ctx) => {
        ctx.fillStyle = 'rgba(20,14,8,0.32)';
        ctx.beginPath(); ctx.ellipse(11, 20.5, 10, 3, 0, 0, Math.PI * 2); ctx.fill();
        vgrad(ctx, 2, 3, 18, 17, PALETTE.woodHi, PALETTE.wood);
        ctx.strokeStyle = PALETTE.woodDark; ctx.lineWidth = 1.6;
        ctx.strokeRect(2.8, 3.8, 16.4, 15.4);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(3, 4); ctx.lineTo(19, 19);
        ctx.moveTo(19, 4); ctx.lineTo(3, 19);
        ctx.stroke();
        ctx.fillStyle = shift(PALETTE.wood, 0.2);
        ctx.fillRect(2, 3, 18, 1.6);
    });
}

function bakeSack() {
    return bake(18, 20, (ctx) => {
        ctx.fillStyle = 'rgba(20,14,8,0.30)';
        ctx.beginPath(); ctx.ellipse(9, 18.5, 8, 2.6, 0, 0, Math.PI * 2); ctx.fill();
        const g = ctx.createLinearGradient(2, 0, 16, 0);
        g.addColorStop(0, PALETTE.clothDark);
        g.addColorStop(0.4, PALETTE.cloth);
        g.addColorStop(1, PALETTE.clothDark);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(9, 3);
        ctx.bezierCurveTo(2, 6, 1.5, 14, 3.5, 19);
        ctx.lineTo(14.5, 19);
        ctx.bezierCurveTo(16.5, 14, 16, 6, 9, 3);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = PALETTE.woodDark; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(6, 5.2); ctx.lineTo(12, 5.2); ctx.stroke();
        ctx.fillStyle = PALETTE.clothDark;
        ctx.beginPath(); ctx.moveTo(9, 1); ctx.lineTo(6.5, 4.6); ctx.lineTo(11.5, 4.6); ctx.closePath(); ctx.fill();
    });
}

function bakeRope() {
    return bake(20, 10, (ctx) => {
        ctx.fillStyle = 'rgba(20,14,8,0.26)';
        ctx.beginPath(); ctx.ellipse(10, 7.5, 9, 2.6, 0, 0, Math.PI * 2); ctx.fill();
        for (let i = 3; i >= 0; i--) {
            ctx.strokeStyle = shift(PALETTE.cloth, -0.10 - i * 0.06);
            ctx.lineWidth = 2.2;
            ctx.beginPath();
            ctx.ellipse(10, 6 - i * 0.5, 8 - i * 1.7, 2.6 - i * 0.5, 0, 0, Math.PI * 2);
            ctx.stroke();
        }
    });
}

function bakeAnvil() {
    return bake(24, 22, (ctx) => {
        ctx.fillStyle = 'rgba(20,14,8,0.34)';
        ctx.beginPath(); ctx.ellipse(12, 20.5, 10, 3, 0, 0, Math.PI * 2); ctx.fill();
        vgrad(ctx, 6, 14, 12, 7, PALETTE.woodHi, PALETTE.woodDark);   // 木墩
        const g = ctx.createLinearGradient(0, 4, 0, 15);
        g.addColorStop(0, PALETTE.ironHi);
        g.addColorStop(1, PALETTE.iron);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(3, 6); ctx.lineTo(19, 6); ctx.lineTo(21, 8.4); ctx.lineTo(16, 9.6);
        ctx.lineTo(15, 13.6); ctx.lineTo(9, 13.6); ctx.lineTo(8, 9.6); ctx.lineTo(3, 8.4);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = shift(PALETTE.ironHi, 0.3);
        ctx.fillRect(3.5, 6, 15.5, 1.2);
    });
}

function bakeDummy() {
    return bake(26, 46, (ctx) => {
        ctx.fillStyle = 'rgba(20,14,8,0.34)';
        ctx.beginPath(); ctx.ellipse(13, 44, 9, 2.8, 0, 0, Math.PI * 2); ctx.fill();
        vgrad(ctx, 11, 20, 5, 24, PALETTE.woodHi, PALETTE.woodDark);      // 立柱
        // 稻草躯干
        const g = ctx.createLinearGradient(0, 8, 0, 30);
        g.addColorStop(0, '#cbb26a'); g.addColorStop(1, '#8d7639');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(13, 20, 8.5, 11, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#7c6630'; ctx.lineWidth = 0.7; ctx.globalAlpha = 0.7;
        for (let i = 0; i < 22; i++) {
            const a = rng.next() * Math.PI * 2, r = rng.range(2, 8);
            ctx.beginPath();
            ctx.moveTo(13 + Math.cos(a) * r, 20 + Math.sin(a) * r * 1.3);
            ctx.lineTo(13 + Math.cos(a) * (r + 3), 20 + Math.sin(a) * (r + 3) * 1.3);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
        // 横臂
        vgrad(ctx, 1, 15, 24, 3.4, PALETTE.woodHi, PALETTE.wood);
        // 头 + 盾靶
        ctx.fillStyle = '#b89a58';
        ctx.beginPath(); ctx.arc(13, 8, 5.4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = PALETTE.irisRed;
        ctx.beginPath(); ctx.arc(13, 20, 4.4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#e8dfc8';
        ctx.beginPath(); ctx.arc(13, 20, 2.4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = PALETTE.irisRed;
        ctx.beginPath(); ctx.arc(13, 20, 1, 0, Math.PI * 2); ctx.fill();
    });
}

function bakeStall(color) {
    return bake(64, 44, (ctx) => {
        ctx.fillStyle = 'rgba(20,14,8,0.30)';
        ctx.fillRect(4, 38, 58, 5);
        // 支柱
        ctx.fillStyle = PALETTE.woodDark;
        ctx.fillRect(3, 8, 3, 32);
        ctx.fillRect(58, 8, 3, 32);
        // 顶棚
        drawAwning(ctx, 0, 4, 64, color);
        // 台面
        vgrad(ctx, 2, 26, 60, 6, PALETTE.woodHi, PALETTE.wood);
        ctx.fillStyle = PALETTE.woodDark;
        ctx.fillRect(2, 31, 60, 2);
        // 台下帘布
        ctx.fillStyle = shift(color, -0.34);
        ctx.fillRect(4, 33, 56, 7);
        // 台面货品
        for (let i = 0; i < 7; i++) {
            const gx = 8 + i * 7.6, gy = 24;
            ctx.fillStyle = rng.pick([PALETTE.irisRed, PALETTE.warmGold, PALETTE.canopyGreen, '#c98f3f', '#8f5a3c']);
            ctx.beginPath();
            ctx.ellipse(gx, gy, rng.range(1.8, 3), rng.range(1.8, 2.6), 0, 0, Math.PI * 2);
            ctx.fill();
        }
    });
}

function bakeBrazierBase() {
    return bake(20, 26, (ctx) => {
        ctx.fillStyle = 'rgba(20,14,8,0.34)';
        ctx.beginPath(); ctx.ellipse(10, 24, 8, 2.6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = PALETTE.iron; ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(5, 24); ctx.lineTo(9, 13);
        ctx.moveTo(15, 24); ctx.lineTo(11, 13);
        ctx.moveTo(10, 24); ctx.lineTo(10, 13);
        ctx.stroke();
        const g = ctx.createLinearGradient(0, 7, 0, 15);
        g.addColorStop(0, PALETTE.ironHi); g.addColorStop(1, PALETTE.iron);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(2, 8); ctx.lineTo(18, 8); ctx.lineTo(14.5, 15); ctx.lineTo(5.5, 15);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#2a1c10';
        ctx.beginPath(); ctx.ellipse(10, 8.4, 8, 2.4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#4a2d16';
        for (let i = 0; i < 6; i++) ctx.fillRect(4 + i * 2, 6.8 + rng.range(0, 1.6), 2.4, 1.6);
    });
}

function bakeWell() {
    return bake(44, 46, (ctx) => {
        ctx.fillStyle = 'rgba(20,14,8,0.34)';
        ctx.beginPath(); ctx.ellipse(22, 42, 18, 5, 0, 0, Math.PI * 2); ctx.fill();
        // 井圈
        ctx.fillStyle = PALETTE.stoneDark;
        ctx.beginPath(); ctx.ellipse(22, 34, 16, 7, 0, 0, Math.PI * 2); ctx.fill();
        vgrad(ctx, 6, 26, 32, 12, PALETTE.stoneHi, PALETTE.stone);
        ctx.fillStyle = '#12100c';
        ctx.beginPath(); ctx.ellipse(22, 27, 14, 5.6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = PALETTE.waterDeep;
        ctx.beginPath(); ctx.ellipse(22, 28.4, 10, 3.6, 0, 0, Math.PI * 2); ctx.fill();
        // 石块勾缝
        ctx.strokeStyle = PALETTE.stoneGrout; ctx.lineWidth = 1;
        for (let i = 0; i < 7; i++) {
            const x = 7 + i * 4.6;
            ctx.beginPath(); ctx.moveTo(x, 30); ctx.lineTo(x, 38); ctx.stroke();
        }
        // 支架与横梁
        ctx.fillStyle = PALETTE.woodDark;
        ctx.fillRect(8, 4, 3.4, 26);
        ctx.fillRect(32.6, 4, 3.4, 26);
        vgrad(ctx, 6, 1, 32, 4, PALETTE.woodHi, PALETTE.wood);
        // 吊桶
        ctx.strokeStyle = PALETTE.cloth; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(22, 5); ctx.lineTo(22, 15); ctx.stroke();
        vgrad(ctx, 18, 15, 8, 7, PALETTE.woodHi, PALETTE.woodDark);
        ctx.fillStyle = PALETTE.iron;
        ctx.fillRect(18, 17.5, 8, 1.2);
    });
}

function bakeCrane() {
    // 码头吊臂：地图北侧的可辨识地标之一
    return bake(56, 84, (ctx) => {
        ctx.fillStyle = 'rgba(20,14,8,0.30)';
        ctx.beginPath(); ctx.ellipse(16, 81, 14, 4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = PALETTE.woodDark;
        ctx.fillRect(6, 60, 20, 20);
        vgrad(ctx, 12, 8, 8, 60, PALETTE.woodHi, PALETTE.wood);      // 立柱
        ctx.save();
        ctx.translate(16, 12);
        ctx.rotate(-0.28);
        vgrad(ctx, 0, -4, 44, 7, PALETTE.woodHi, PALETTE.wood);      // 吊臂
        ctx.restore();
        // 斜撑
        ctx.strokeStyle = PALETTE.wood; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(16, 30); ctx.lineTo(36, 12); ctx.stroke();
        // 吊索与吊钩
        ctx.strokeStyle = PALETTE.cloth; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(56, 0.5); ctx.lineTo(56, 26); ctx.stroke();
        ctx.strokeStyle = PALETTE.ironHi; ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.arc(56, 29, 3, Math.PI * 0.2, Math.PI * 1.5); ctx.stroke();
    });
}

function bakeBench() {
    return bake(28, 14, (ctx) => {
        ctx.fillStyle = 'rgba(20,14,8,0.28)';
        ctx.fillRect(2, 11, 24, 3);
        ctx.fillStyle = PALETTE.stoneDark;
        ctx.fillRect(3, 6, 4, 6);
        ctx.fillRect(21, 6, 4, 6);
        vgrad(ctx, 1, 2, 26, 5, PALETTE.stoneHi, PALETTE.stone);
        ctx.fillStyle = PALETTE.stoneDark;
        ctx.fillRect(1, 6.2, 26, 1.4);
    });
}

function bakeFlagPole() {
    return bake(30, 66, (ctx) => {
        ctx.fillStyle = 'rgba(20,14,8,0.30)';
        ctx.beginPath(); ctx.ellipse(6, 64, 6, 2.4, 0, 0, Math.PI * 2); ctx.fill();
        vgrad(ctx, 4.4, 4, 3.2, 60, PALETTE.ironHi, PALETTE.iron);
        ctx.fillStyle = PALETTE.warmGold;
        ctx.beginPath(); ctx.arc(6, 3.2, 2.6, 0, Math.PI * 2); ctx.fill();
        // 鸢尾红旗，带布褶
        const g = ctx.createLinearGradient(7, 0, 28, 0);
        g.addColorStop(0, PALETTE.irisRedHi);
        g.addColorStop(0.5, PALETTE.irisRed);
        g.addColorStop(1, PALETTE.irisRedDark);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(7, 7);
        ctx.bezierCurveTo(16, 5, 22, 10, 29, 8);
        ctx.lineTo(29, 26);
        ctx.bezierCurveTo(22, 28, 16, 23, 7, 25);
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 0.22; ctx.fillStyle = '#000';
        ctx.beginPath(); ctx.moveTo(15, 6); ctx.bezierCurveTo(17, 12, 15, 20, 14, 25.4);
        ctx.lineTo(18, 24.6); ctx.bezierCurveTo(19, 19, 20, 11, 19, 5.6);
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
        // 鸢尾徽记
        ctx.font = '11px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('⚜️', 18, 16.5);
    });
}

function bakeRail() {
    // 卫城坡道封锁栏杆
    return bake(32, 20, (ctx) => {
        ctx.fillStyle = 'rgba(20,14,8,0.28)';
        ctx.fillRect(0, 17, 32, 3);
        ctx.fillStyle = PALETTE.iron;
        for (let i = 0; i < 5; i++) {
            ctx.fillRect(2 + i * 7, 4, 2.2, 14);
            ctx.fillStyle = PALETTE.warmGold;
            ctx.beginPath(); ctx.arc(3.1 + i * 7, 3.4, 1.5, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = PALETTE.iron;
        }
        ctx.fillStyle = PALETTE.ironHi;
        ctx.fillRect(0, 6, 32, 2);
        ctx.fillStyle = PALETTE.iron;
        ctx.fillRect(0, 13, 32, 2);
    });
}

function bakeBollard() {
    // 系缆桩：码头边缘的节奏点
    return bake(16, 22, (ctx) => {
        ctx.fillStyle = 'rgba(16,11,6,0.34)';
        ctx.beginPath(); ctx.ellipse(8, 20, 7, 2.4, 0, 0, Math.PI * 2); ctx.fill();
        const g = ctx.createLinearGradient(3, 0, 13, 0);
        g.addColorStop(0, PALETTE.woodDark); g.addColorStop(0.4, PALETTE.woodHi); g.addColorStop(1, PALETTE.woodDark);
        ctx.fillStyle = g;
        roundRect(ctx, 4, 5, 8, 15, 2); ctx.fill();
        ctx.fillStyle = shift(PALETTE.wood, 0.24);
        ctx.beginPath(); ctx.ellipse(8, 5.4, 5.2, 2.4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = PALETTE.cloth; ctx.lineWidth = 1.6; ctx.globalAlpha = 0.85;
        ctx.beginPath(); ctx.ellipse(8, 12, 5.4, 2.2, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
    });
}

function bakeBoat() {
    // 靠泊的小艇：给水面一个可读的尺度参照
    return bake(84, 34, (ctx) => {
        ctx.fillStyle = 'rgba(10,20,26,0.42)';
        ctx.beginPath(); ctx.ellipse(42, 27, 38, 6, 0, 0, Math.PI * 2); ctx.fill();
        const g = ctx.createLinearGradient(0, 6, 0, 26);
        g.addColorStop(0, PALETTE.woodHi); g.addColorStop(1, PALETTE.woodDark);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(4, 12);
        ctx.quadraticCurveTo(42, 2, 80, 12);
        ctx.quadraticCurveTo(74, 26, 42, 27);
        ctx.quadraticCurveTo(10, 26, 4, 12);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#3a2718';
        ctx.beginPath();
        ctx.moveTo(9, 13); ctx.quadraticCurveTo(42, 6, 75, 13);
        ctx.quadraticCurveTo(70, 21, 42, 22);
        ctx.quadraticCurveTo(14, 21, 9, 13);
        ctx.closePath(); ctx.fill();
        // 横座板与桨
        ctx.fillStyle = PALETTE.wood;
        ctx.fillRect(26, 11, 6, 9);
        ctx.fillRect(52, 11, 6, 9);
        ctx.save();
        ctx.translate(40, 16); ctx.rotate(-0.22);
        ctx.fillStyle = PALETTE.woodHi;
        ctx.fillRect(-26, -1.2, 42, 2.4);
        ctx.beginPath(); ctx.ellipse(18, 0, 5, 2.6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.strokeStyle = shift(PALETTE.wood, 0.3); ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(5, 12); ctx.quadraticCurveTo(42, 3, 79, 12); ctx.stroke();
    });
}

function bakeTree() {
    return bake(52, 62, (ctx) => {
        ctx.fillStyle = 'rgba(16,11,6,0.32)';
        ctx.beginPath(); ctx.ellipse(26, 58, 15, 4.6, 0, 0, Math.PI * 2); ctx.fill();
        // 树干
        const g = ctx.createLinearGradient(21, 0, 31, 0);
        g.addColorStop(0, PALETTE.woodDark); g.addColorStop(0.4, PALETTE.wood); g.addColorStop(1, PALETTE.woodDark);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(22, 58); ctx.quadraticCurveTo(24, 42, 23.5, 30);
        ctx.lineTo(28.5, 30); ctx.quadraticCurveTo(28, 42, 30, 58);
        ctx.closePath(); ctx.fill();
        // 树冠：三层成簇，避免均匀撒点（VISUAL_DESIGN §4.1）
        const blobs = [
            [26, 20, 20, 15, PALETTE.canopyGreen],
            [15, 26, 13, 10, '#3d5038'],
            [37, 25, 13, 10, '#3d5038'],
            [24, 13, 15, 11, '#5c7048'],
            [31, 18, 12, 9, '#6b8052']
        ];
        for (const [bx, by, rw, rh, color] of blobs) {
            ctx.fillStyle = color;
            ctx.beginPath(); ctx.ellipse(bx, by, rw, rh, 0, 0, Math.PI * 2); ctx.fill();
        }
        // 叶簇高光与暗部
        ctx.globalAlpha = 0.5;
        for (let i = 0; i < 60; i++) {
            const a = rng.next() * Math.PI * 2, r = rng.range(0, 19);
            const lx = 26 + Math.cos(a) * r, ly = 19 + Math.sin(a) * r * 0.78;
            ctx.fillStyle = rng.chance(0.5) ? '#7b9159' : '#334429';
            ctx.beginPath(); ctx.ellipse(lx, ly, rng.range(1.4, 3), rng.range(1.2, 2.4), 0, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
    });
}

function bakeHerbRack() {
    return bake(30, 34, (ctx) => {
        ctx.fillStyle = 'rgba(20,14,8,0.28)';
        ctx.fillRect(3, 31, 24, 3);
        ctx.fillStyle = PALETTE.woodDark;
        ctx.fillRect(3, 4, 2.6, 28);
        ctx.fillRect(24.4, 4, 2.6, 28);
        vgrad(ctx, 2, 3, 26, 3, PALETTE.woodHi, PALETTE.wood);
        // 倒挂草药束
        for (let i = 0; i < 5; i++) {
            const x = 6 + i * 4.4;
            ctx.strokeStyle = i % 2 ? PALETTE.canopyGreen : '#7d8a52';
            ctx.lineWidth = 2.6;
            ctx.beginPath(); ctx.moveTo(x, 6); ctx.lineTo(x + rng.range(-1, 1), 6 + rng.range(9, 17)); ctx.stroke();
            ctx.strokeStyle = PALETTE.warmGold; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(x - 1.6, 8); ctx.lineTo(x + 1.6, 8); ctx.stroke();
        }
        // 药瓶
        for (let i = 0; i < 3; i++) {
            const x = 6 + i * 7;
            ctx.fillStyle = ['#7ea8b5', '#a76f8e', '#b59a5e'][i];
            ctx.fillRect(x, 24, 4, 6);
            ctx.fillStyle = PALETTE.woodDark;
            ctx.fillRect(x + 1, 22.4, 2, 2);
        }
    });
}

// ============ 角色：参数化人形，四向 × 四帧 ============

const CH_W = 40, CH_H = 58;
export const CHAR_ANCHOR = Object.freeze({ x: 20, y: 54 });

/** 行走相位 → 肢体偏移。phase 0/2 为过渡，1/3 为两个极值。 */
function gait(phase) {
    const swing = [0, 1, 0, -1][phase];
    return { swing, bob: phase % 2 === 0 ? 0 : -1 };
}

/**
 * 画一个人形。cfg 字段：
 *   skin, tunic, tunicDark, trouser, cloak, armor, armorHi,
 *   helmet, crest（横向红缨）, hair, hood, belt,
 *   weapon: null|'gladius'|'club'|'sling'|'hammer'|'basket'|'scroll'|'bottle'
 *   shield: null|'oval'|'round'
 *   build: 1 = 标准，>1 更壮
 */
function drawHumanoid(ctx, cfg, dir, phase, action) {
    const { swing, bob } = action === 'attack' ? { swing: 0, bob: 0 } : gait(phase);
    const cx = CH_W / 2;
    const feet = 52 + bob;
    const build = cfg.build ?? 1;
    const back = dir === 'up';
    const side = dir === 'left' || dir === 'right';
    const flip = dir === 'left';

    ctx.save();
    if (flip) { ctx.translate(CH_W, 0); ctx.scale(-1, 1); }

    // —— 落影 ——
    ctx.fillStyle = 'rgba(16,11,6,0.36)';
    ctx.beginPath();
    ctx.ellipse(cx, 53, 9 * build, 3.2, 0, 0, Math.PI * 2);
    ctx.fill();

    // —— 披风（身后） ——
    if (cfg.cloak) {
        ctx.fillStyle = shift(cfg.cloak, back ? 0.06 : -0.22);
        ctx.beginPath();
        ctx.moveTo(cx - 8 * build, 20);
        ctx.bezierCurveTo(cx - 12 * build, 32, cx - 10 * build, 42, cx - 7 * build, feet - 6);
        ctx.lineTo(cx + 7 * build, feet - 6);
        ctx.bezierCurveTo(cx + 10 * build, 42, cx + 12 * build, 32, cx + 8 * build, 20);
        ctx.closePath();
        ctx.fill();
        if (back) {
            ctx.fillStyle = rgba('#000000', 0.16);
            ctx.beginPath();
            ctx.moveTo(cx, 21); ctx.lineTo(cx - 3, feet - 6); ctx.lineTo(cx + 3, feet - 6);
            ctx.closePath(); ctx.fill();
        }
    }

    // —— 腿 ——
    const legY = 38, legH = feet - legY;
    const legs = side
        ? [[cx - 1 + swing * 3, legH], [cx - 1 - swing * 3, legH]]
        : [[cx - 4.2 * build, legH + swing * 1.5], [cx + 1.6 * build, legH - swing * 1.5]];
    for (let i = 0; i < 2; i++) {
        const [lx, lh] = legs[i];
        ctx.fillStyle = i === 0 ? shift(cfg.trouser, -0.16) : cfg.trouser;
        roundRect(ctx, lx, legY, 3.6 * build, lh, 1.6);
        ctx.fill();
        // 军靴/绑腿
        ctx.fillStyle = cfg.boot || PALETTE.woodDark;
        roundRect(ctx, lx - 0.5, legY + lh - 6, 4.6 * build, 6, 1.6);
        ctx.fill();
    }

    // —— 躯干 ——
    const torsoTop = 19, torsoH = 20;
    const bw = 11 * build;
    ctx.fillStyle = cfg.tunic;
    ctx.beginPath();
    ctx.moveTo(cx - bw / 2, torsoTop);
    ctx.lineTo(cx + bw / 2, torsoTop);
    ctx.quadraticCurveTo(cx + bw / 2 + 0.6, torsoTop + torsoH, cx + bw / 2 - 1.6, torsoTop + torsoH);
    ctx.lineTo(cx - bw / 2 + 1.6, torsoTop + torsoH);
    ctx.quadraticCurveTo(cx - bw / 2 - 0.6, torsoTop + torsoH, cx - bw / 2, torsoTop);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = rgba('#000000', 0.18);
    ctx.fillRect(cx - bw / 2, torsoTop, bw * 0.32, torsoH);

    // —— 胸甲 ——
    if (cfg.armor) {
        const g = ctx.createLinearGradient(cx - bw / 2, torsoTop, cx + bw / 2, torsoTop + torsoH);
        g.addColorStop(0, cfg.armorHi || shift(cfg.armor, 0.28));
        g.addColorStop(0.55, cfg.armor);
        g.addColorStop(1, shift(cfg.armor, -0.28));
        ctx.fillStyle = g;
        roundRect(ctx, cx - bw / 2 + 0.4, torsoTop + 1, bw - 0.8, torsoH - 7, 2.4);
        ctx.fill();
        if (!back) {
            // 肌肉甲纹样
            ctx.strokeStyle = rgba('#000000', 0.28);
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(cx - bw * 0.22, torsoTop + 4);
            ctx.quadraticCurveTo(cx, torsoTop + 7, cx + bw * 0.22, torsoTop + 4);
            ctx.moveTo(cx, torsoTop + 6.6); ctx.lineTo(cx, torsoTop + 12);
            ctx.stroke();
        }
        // 战裙皮条
        ctx.fillStyle = shift(cfg.belt || PALETTE.wood, -0.06);
        for (let i = 0; i < 5; i++) {
            ctx.fillRect(cx - bw / 2 + 0.6 + i * (bw - 1.2) / 5, torsoTop + torsoH - 6, (bw - 1.2) / 5 - 0.9, 6.5);
        }
    }
    // 腰带
    ctx.fillStyle = cfg.belt || PALETTE.woodDark;
    ctx.fillRect(cx - bw / 2, torsoTop + torsoH - 8.5, bw, 2.6);
    ctx.fillStyle = PALETTE.bronzeHi;
    ctx.fillRect(cx - 1.4, torsoTop + torsoH - 8.5, 2.8, 2.6);

    // —— 手臂 ——
    const armY = torsoTop + 2;
    const attackReach = action === 'attack' ? 6 : 0;
    // 后手（持盾）
    ctx.fillStyle = shift(cfg.tunic, -0.20);
    roundRect(ctx, cx - bw / 2 - 3, armY - swing * 1.2, 3.4, 15, 1.7);
    ctx.fill();
    // 前手（持械）
    ctx.fillStyle = cfg.tunic;
    roundRect(ctx, cx + bw / 2 - 0.6, armY + swing * 1.2 - attackReach * 0.4, 3.4, 15 - attackReach * 0.3, 1.7);
    ctx.fill();
    ctx.fillStyle = cfg.skin;
    ctx.beginPath(); ctx.arc(cx + bw / 2 + 1.1, armY + 14 + swing * 1.2 - attackReach * 0.7, 2, 0, Math.PI * 2); ctx.fill();

    // —— 武器 ——
    drawWeapon(ctx, cfg.weapon, cx + bw / 2 + 1.2, armY + 14 + swing * 1.2 - attackReach * 0.7, action, side);

    // —— 盾 ——
    if (cfg.shield && !back) drawShield(ctx, cfg, cx - bw / 2 - 3.5, armY + 3);

    // —— 头 ——
    const headY = 12;
    ctx.fillStyle = cfg.skin;
    ctx.beginPath(); ctx.ellipse(cx, headY, 5.6, 6.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = rgba('#000000', 0.14);
    ctx.beginPath(); ctx.ellipse(cx - 2.6, headY, 3, 6.2, 0, 0, Math.PI * 2); ctx.fill();
    // 脖颈阴影
    ctx.fillStyle = shift(cfg.skin, -0.30);
    ctx.fillRect(cx - 2.4, headY + 5, 4.8, 2.6);

    if (!back && !cfg.helmet && !cfg.hood) {
        // 五官（仅正/侧面）
        ctx.fillStyle = PALETTE.ink;
        if (side) {
            ctx.fillRect(cx + 1.6, headY - 1, 1.2, 1.2);
        } else {
            ctx.fillRect(cx - 2.6, headY - 1, 1.3, 1.3);
            ctx.fillRect(cx + 1.4, headY - 1, 1.3, 1.3);
        }
        if (cfg.beard) {
            ctx.fillStyle = cfg.beard;
            ctx.beginPath();
            ctx.ellipse(cx, headY + 3.4, 4.4, 3, 0, 0, Math.PI);
            ctx.fill();
        }
    }
    // 头发
    if (cfg.hair && !cfg.helmet && !cfg.hood) {
        ctx.fillStyle = cfg.hair;
        ctx.beginPath();
        ctx.ellipse(cx, headY - 2.4, 5.9, 4.4, 0, Math.PI, 0);
        ctx.fill();
        if (cfg.longHair) {
            ctx.beginPath();
            ctx.moveTo(cx - 5.6, headY - 2); ctx.quadraticCurveTo(cx - 7, headY + 8, cx - 3.4, headY + 9);
            ctx.lineTo(cx + 3.4, headY + 9); ctx.quadraticCurveTo(cx + 7, headY + 8, cx + 5.6, headY - 2);
            ctx.closePath(); ctx.fill();
        }
    }
    // 兜帽
    if (cfg.hood) {
        ctx.fillStyle = cfg.hood;
        ctx.beginPath();
        ctx.moveTo(cx - 7, headY + 6);
        ctx.quadraticCurveTo(cx - 7.6, headY - 8, cx, headY - 8.6);
        ctx.quadraticCurveTo(cx + 7.6, headY - 8, cx + 7, headY + 6);
        ctx.closePath(); ctx.fill();
        if (!back) {
            ctx.fillStyle = 'rgba(10,8,6,0.72)';
            ctx.beginPath(); ctx.ellipse(cx, headY + 0.6, 4.4, 4.8, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = rgba(PALETTE.regencyPurpleHi, 0.9);
            ctx.fillRect(cx - 2.4, headY, 1.4, 1.2);
            ctx.fillRect(cx + 1, headY, 1.4, 1.2);
        }
    }
    // 头盔
    if (cfg.helmet) {
        const g = ctx.createLinearGradient(cx - 6, headY - 7, cx + 6, headY + 4);
        g.addColorStop(0, shift(cfg.helmet, 0.34));
        g.addColorStop(0.55, cfg.helmet);
        g.addColorStop(1, shift(cfg.helmet, -0.30));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(cx - 6.2, headY + 3.2);
        ctx.quadraticCurveTo(cx - 6.6, headY - 7.6, cx, headY - 8);
        ctx.quadraticCurveTo(cx + 6.6, headY - 7.6, cx + 6.2, headY + 3.2);
        ctx.closePath(); ctx.fill();
        // 护颊
        if (!back) {
            ctx.fillStyle = shift(cfg.helmet, -0.10);
            ctx.beginPath(); ctx.moveTo(cx - 6.2, headY - 1); ctx.lineTo(cx - 3.6, headY - 1);
            ctx.lineTo(cx - 4.2, headY + 5.4); ctx.lineTo(cx - 6.2, headY + 3.6); ctx.closePath(); ctx.fill();
            ctx.beginPath(); ctx.moveTo(cx + 6.2, headY - 1); ctx.lineTo(cx + 3.6, headY - 1);
            ctx.lineTo(cx + 4.2, headY + 5.4); ctx.lineTo(cx + 6.2, headY + 3.6); ctx.closePath(); ctx.fill();
            ctx.fillStyle = PALETTE.ink;
            ctx.fillRect(cx - 2.8, headY, 1.4, 1.3);
            ctx.fillRect(cx + 1.4, headY, 1.4, 1.3);
        }
        ctx.fillStyle = shift(cfg.helmet, 0.42);
        ctx.fillRect(cx - 6.2, headY - 1.6, 12.4, 1);
        // 百夫长横向红缨：正/背面是一条横冠，侧面是一道前后延伸的鬃
        if (cfg.crest) {
            ctx.fillStyle = cfg.crest;
            if (side) {
                ctx.beginPath();
                ctx.moveTo(cx - 1, headY - 7.4);
                ctx.quadraticCurveTo(cx, headY - 11.4, cx + 1, headY - 7.4);
                ctx.closePath(); ctx.fill();
                ctx.fillRect(cx - 1, headY - 9.4, 2, 2);
            } else {
                ctx.beginPath();
                ctx.moveTo(cx - 8.4, headY - 6.4);
                ctx.quadraticCurveTo(cx, headY - 14.6, cx + 8.4, headY - 6.4);
                ctx.quadraticCurveTo(cx, headY - 9.6, cx - 8.4, headY - 6.4);
                ctx.closePath(); ctx.fill();
                ctx.fillStyle = shift(cfg.crest, -0.28);
                for (let i = -3; i <= 3; i++) {
                    ctx.fillRect(cx + i * 2.2, headY - 12 + Math.abs(i) * 1.1, 0.9, 4);
                }
            }
        }
    }

    ctx.restore();
}

function drawWeapon(ctx, kind, hx, hy, action, side) {
    if (!kind) return;
    ctx.save();
    ctx.translate(hx, hy);
    if (action === 'attack') ctx.rotate(side ? -0.95 : -0.55);
    switch (kind) {
        case 'gladius': {
            ctx.fillStyle = PALETTE.woodDark; ctx.fillRect(-1.2, -1, 2.6, 5);
            ctx.fillStyle = PALETTE.bronzeHi; ctx.fillRect(-2.6, -2.2, 5.4, 1.8);
            const g = ctx.createLinearGradient(-1.6, -20, 1.6, -2);
            g.addColorStop(0, '#eef2f6'); g.addColorStop(0.5, '#b9c2cc'); g.addColorStop(1, '#7f8892');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.moveTo(-1.7, -2.2); ctx.lineTo(1.7, -2.2); ctx.lineTo(1.4, -17); ctx.lineTo(0, -21); ctx.lineTo(-1.4, -17);
            ctx.closePath(); ctx.fill();
            break;
        }
        case 'club': {
            ctx.fillStyle = PALETTE.wood;
            roundRect(ctx, -1.6, -16, 3.2, 18, 1.4); ctx.fill();
            ctx.fillStyle = PALETTE.woodHi;
            roundRect(ctx, -3, -18.5, 6, 7, 2.4); ctx.fill();
            ctx.fillStyle = PALETTE.iron;
            ctx.fillRect(-3, -16.5, 6, 1.2);
            break;
        }
        case 'hammer': {
            ctx.fillStyle = PALETTE.wood;
            roundRect(ctx, -1.4, -15, 2.8, 17, 1.2); ctx.fill();
            ctx.fillStyle = PALETTE.iron;
            roundRect(ctx, -4.4, -19, 8.8, 5, 1.2); ctx.fill();
            ctx.fillStyle = PALETTE.ironHi;
            ctx.fillRect(-4.4, -19, 8.8, 1.4);
            break;
        }
        case 'sling': {
            ctx.strokeStyle = PALETTE.cloth; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(5, 6, 1, 11); ctx.stroke();
            ctx.fillStyle = PALETTE.stoneHi;
            ctx.beginPath(); ctx.arc(1, 11.6, 1.8, 0, Math.PI * 2); ctx.fill();
            break;
        }
        case 'bottle': {
            ctx.fillStyle = '#4f6b4a';
            roundRect(ctx, -2.2, -9, 4.4, 9, 1.6); ctx.fill();
            ctx.fillRect(-1, -12.6, 2, 4);
            ctx.fillStyle = PALETTE.cloth; ctx.fillRect(-1.2, -13.6, 2.4, 1.4);
            ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(-1.6, -8, 1, 6);
            break;
        }
        case 'basket': {
            ctx.fillStyle = PALETTE.woodHi;
            ctx.beginPath(); ctx.ellipse(0, 3, 6, 4.4, 0, 0, Math.PI); ctx.fill();
            ctx.strokeStyle = PALETTE.woodDark; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(0, 3, 6, Math.PI, 0); ctx.stroke();
            ctx.fillStyle = PALETTE.canopyGreen;
            ctx.beginPath(); ctx.ellipse(-2, 2.4, 2, 1.6, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = PALETTE.warmGold;
            ctx.beginPath(); ctx.ellipse(2, 2.4, 2, 1.6, 0, 0, Math.PI * 2); ctx.fill();
            break;
        }
        case 'scroll': {
            ctx.fillStyle = '#e2d6b4';
            roundRect(ctx, -5, -2, 10, 6, 1.4); ctx.fill();
            ctx.fillStyle = PALETTE.woodDark;
            ctx.fillRect(-6, -2.6, 1.8, 7.2); ctx.fillRect(4.2, -2.6, 1.8, 7.2);
            ctx.strokeStyle = 'rgba(60,44,26,0.5)'; ctx.lineWidth = 0.6;
            for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(-3.6, -0.6 + i * 1.6); ctx.lineTo(3.6, -0.6 + i * 1.6); ctx.stroke(); }
            break;
        }
        default: break;
    }
    ctx.restore();
}

function drawShield(ctx, cfg, x, y) {
    const oval = cfg.shield === 'oval';
    const w = oval ? 11 : 12, h = oval ? 19 : 12;
    ctx.save();
    ctx.fillStyle = 'rgba(16,11,6,0.28)';
    ctx.beginPath(); ctx.ellipse(x + 1.4, y + h / 2 + 1.4, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createLinearGradient(x - w / 2, y, x + w / 2, y + h);
    g.addColorStop(0, shift(cfg.shieldColor || PALETTE.irisRed, 0.24));
    g.addColorStop(1, shift(cfg.shieldColor || PALETTE.irisRed, -0.26));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(x, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = PALETTE.bronze; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.ellipse(x, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.stroke();
    // 盾心与鸢尾纹
    ctx.fillStyle = PALETTE.bronzeHi;
    ctx.beginPath(); ctx.arc(x, y + h / 2, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = PALETTE.warmGold; ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(x, y + h / 2 - 5.4); ctx.lineTo(x, y + h / 2 + 5.4);
    ctx.moveTo(x - 3, y + h / 2 - 1.6); ctx.quadraticCurveTo(x, y + h / 2 - 5, x + 3, y + h / 2 - 1.6);
    ctx.stroke();
    ctx.restore();
}

/** 烘焙一整套四向 × 四帧 + 攻击帧。 */
export function bakeActor(cfg) {
    const dirs = ['down', 'up', 'left', 'right'];
    const sheet = { w: CH_W, h: CH_H, anchor: CHAR_ANCHOR, walk: {}, attack: {} };
    for (const dir of dirs) {
        sheet.walk[dir] = [];
        for (let phase = 0; phase < 4; phase++) {
            sheet.walk[dir].push(bake(CH_W, CH_H, (ctx) => drawHumanoid(ctx, cfg, dir, phase, 'walk')));
        }
        sheet.attack[dir] = bake(CH_W, CH_H, (ctx) => drawHumanoid(ctx, cfg, dir, 0, 'attack'));
    }
    return sheet;
}

// ============ 角色外观表 ============

export const APPEARANCE = Object.freeze({
    // 马库斯：百夫长制式——横向红缨盔、鸢尾红披风、青铜胸甲、gladius、椭圆盾
    marcus: {
        skin: PALETTE.skin, tunic: '#b8542f', trouser: '#8a5a3a', boot: '#4a3320',
        cloak: PALETTE.irisRed, armor: PALETTE.bronze, armorHi: PALETTE.bronzeHi,
        helmet: '#a8823f', crest: PALETTE.irisRedHi, belt: '#5c3d22',
        weapon: 'gladius', shield: 'oval', shieldColor: PALETTE.irisRed, build: 1.05
    },
    dockThug: {
        skin: '#c39466', tunic: '#7a6a4d', trouser: '#5b4d38', boot: '#3d3324',
        hair: '#3a2b1c', beard: '#3a2b1c', belt: '#4a3a26',
        weapon: 'club', shield: null, build: 1
    },
    drunkVeteran: {
        skin: '#c99a6c', tunic: '#8b7350', trouser: '#5f5138', boot: '#41341f',
        armor: '#7d7f83', armorHi: '#a9adb2', hair: '#6b5b45', beard: '#6b5b45',
        belt: '#4a3a26', weapon: 'bottle', shield: 'round', shieldColor: '#7d6a4c', build: 1.08
    },
    regencyInformant: {
        skin: '#c39466', tunic: '#3f2f52', trouser: '#33284a', boot: '#241c33',
        cloak: PALETTE.regencyPurple, hood: PALETTE.regencyPurple, belt: '#2a2038',
        weapon: 'sling', shield: null, build: 0.95
    },
    smith: {
        skin: '#c08553', tunic: '#6f5334', trouser: '#4f4029', boot: '#3a2c1b',
        armor: '#6b4a2f', armorHi: '#8d6339', hair: '#2f2418', beard: '#3d3020',
        belt: '#3c2c19', weapon: 'hammer', shield: null, build: 1.22
    },
    herbalist: {
        skin: PALETTE.skinPale, tunic: '#6d7a52', trouser: '#57603f', boot: '#3f3a28',
        cloak: '#8a8f6a', hair: '#6d6455', longHair: true, belt: '#55503a',
        weapon: 'basket', shield: null, build: 0.94
    },
    quartermaster: {
        skin: PALETTE.skin, tunic: '#9c4038', trouser: '#6a4a30', boot: '#43301d',
        armor: '#8b8f95', armorHi: '#b6bbc2', helmet: '#8e8f93', hair: '#4a3826',
        belt: '#54371f', weapon: 'scroll', shield: null, build: 1.05
    },
    // 码头搬运工：阿格里乌斯的化名身份，不点破
    dockHand: {
        skin: '#bd8a58', tunic: '#6b6250', trouser: '#4e4636', boot: '#382d1e',
        hair: '#241c14', beard: '#241c14', belt: '#3f3323',
        weapon: null, shield: null, build: 1.16
    },
    // 市民：只为让街道有人气，不可交互
    townsman: {
        skin: '#c99a6c', tunic: '#8a7a56', trouser: '#5d5138', boot: '#3f3323',
        hair: '#4a3826', belt: '#4a3a26', weapon: null, shield: null, build: 1
    },
    townswoman: {
        skin: PALETTE.skinPale, tunic: '#7c5f6d', trouser: '#5d4a53', boot: '#3d3128',
        cloak: '#9a7f88', hair: '#4a3628', longHair: true, belt: '#544048',
        weapon: 'basket', shield: null, build: 0.92
    },
    porter: {
        skin: '#c08553', tunic: '#5f6a52', trouser: '#46503b', boot: '#33301f',
        hair: '#31281c', beard: '#31281c', belt: '#3a3527',
        weapon: null, shield: null, build: 1.10
    }
});

// ============ 对外资源表 ============

export const ART = {
    tiles: null,
    props: null,
    actors: null,
    ready: false
};

export function bakeAll() {
    ART.tiles = {
        cobble: bakeCobble(),
        dirt: bakeDirt(),
        sand: bakeSand(),
        grass: bakeGrass(),
        plank: bakePlank(),
        water: bakeWater()
    };
    ART.props = {
        barrel: bakeBarrel(),
        crate: bakeCrate(),
        sack: bakeSack(),
        rope: bakeRope(),
        anvil: bakeAnvil(),
        dummy: bakeDummy(),
        stallRed: bakeStall(PALETTE.irisRed),
        stallGreen: bakeStall('#6f7d4c'),
        stallGold: bakeStall('#a8863f'),
        brazier: bakeBrazierBase(),
        well: bakeWell(),
        crane: bakeCrane(),
        bench: bakeBench(),
        flagPole: bakeFlagPole(),
        rail: bakeRail(),
        herbRack: bakeHerbRack(),
        tree: bakeTree(),
        bollard: bakeBollard(),
        boat: bakeBoat()
    };
    ART.actors = {
        marcus: bakeActor(APPEARANCE.marcus),
        dockThug: bakeActor(APPEARANCE.dockThug),
        drunkVeteran: bakeActor(APPEARANCE.drunkVeteran),
        regencyInformant: bakeActor(APPEARANCE.regencyInformant),
        smith: bakeActor(APPEARANCE.smith),
        herbalist: bakeActor(APPEARANCE.herbalist),
        quartermaster: bakeActor(APPEARANCE.quartermaster),
        dockHand: bakeActor(APPEARANCE.dockHand),
        townsman: bakeActor(APPEARANCE.townsman),
        townswoman: bakeActor(APPEARANCE.townswoman),
        porter: bakeActor(APPEARANCE.porter)
    };
    ART.ready = true;
    return ART;
}

/** 火盆火焰：动态绘制（不烘焙），t 为秒。 */
export function drawFlame(ctx, x, y, t, scale = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
        const p = t * (2.4 + i * 0.7) + i * 2.1;
        const flick = Math.sin(p) * 0.5 + Math.sin(p * 1.7) * 0.5;
        const hgt = 12 + flick * 3 - i * 3;
        const wid = 5 - i * 1.2;
        const g = ctx.createRadialGradient(0, -hgt * 0.4, 0, 0, -hgt * 0.4, hgt);
        g.addColorStop(0, ['rgba(255,246,196,0.95)', 'rgba(255,196,90,0.85)', 'rgba(214,96,30,0.6)'][i]);
        g.addColorStop(1, 'rgba(180,60,10,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(-wid, 0);
        ctx.quadraticCurveTo(-wid * 0.8, -hgt * 0.6, flick * 1.6, -hgt);
        ctx.quadraticCurveTo(wid * 0.8, -hgt * 0.6, wid, 0);
        ctx.closePath();
        ctx.fill();
    }
    ctx.restore();
}
