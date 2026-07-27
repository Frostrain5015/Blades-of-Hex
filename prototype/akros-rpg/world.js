// 王都阿克罗斯 · 外城区。64×40 格 × 32px = 2048×1280。
// 静态世界（地面 / 建筑 / 道具 / 光池）在启动时整层烘焙成一张位图，
// 每帧只做一次 drawImage；动态元素（角色、火焰、水波、特效）画在其上。
//
// 构图遵循 VISUAL_DESIGN.md §4.1：先画南北主路，再把成簇的建筑推向两侧；
// 中央交互区保持低噪声；地标（码头吊臂、卫城外郭）南北各一，方向不靠 HUD 也读得出来。

import { ART, PALETTE, blit, drawBuilding, drawIrisBox, shift, rgba } from './art.js';
import { createRng, clamp } from './util.js';

export const TILE = 32;
export const COLS = 64;
export const ROWS = 40;
export const WORLD_W = COLS * TILE;
export const WORLD_H = ROWS * TILE;

// 静态层按 2 倍分辨率烘焙：镜头是 2 倍缩放（见 main.js ZOOM），
// 这样地面与建筑在屏幕上正好 1:1 呈现，不会被放大糊掉。
export const STATIC_SS = 2;

const T = (n) => n * TILE;
const rng = createRng(0x5b3c72);

// ============ 分区（自北向南：卫城 → 校场 → 集市 → 窄巷 → 码头） ============

export const DISTRICTS = Object.freeze([
    Object.freeze({ id: 'acropolis', name: '卫城坡道', y0: T(0), y1: T(6) }),
    Object.freeze({ id: 'campus', name: '校场入口', y0: T(6), y1: T(14) }),
    Object.freeze({ id: 'market', name: '集市街', y0: T(14), y1: T(24) }),
    Object.freeze({ id: 'alley', name: '窄巷', y0: T(24), y1: T(32) }),
    Object.freeze({ id: 'dock', name: '南门 · 码头区', y0: T(32), y1: T(40) })
]);

const GROUND_ZONES = [
    { tile: 'dirt', x: 0, y: T(0), w: WORLD_W, h: T(6) },
    { tile: 'grass', x: 0, y: T(0), w: T(11), h: T(6) },
    { tile: 'grass', x: T(53), y: T(0), w: T(11), h: T(6) },
    { tile: 'sand', x: 0, y: T(6), w: WORLD_W, h: T(8) },
    { tile: 'cobble', x: 0, y: T(14), w: WORLD_W, h: T(18) },
    { tile: 'plank', x: 0, y: T(32), w: WORLD_W, h: T(4) },
    { tile: 'water', x: 0, y: T(36), w: WORLD_W, h: T(4) }
];

// ============ 建筑 ============
// 碰撞盒 = 屋顶 + 正面墙的完整矩形，因此玩家永远画在建筑之前，无需 y-sort。

const BUILDINGS = [
    // —— 卫城外郭：北端地标，玩家从开场即可看见方向 ——
    {
        x: T(20), y: T(0), w: T(24), h: T(5), facadeH: 74,
        roofColor: '#8d8578', wallColor: '#cfc4a8', windows: 5, doorAt: T(12), awning: null, shutters: false, windowBox: false
    },
    // —— 校场：军械库与值房 ——
    { x: T(4), y: T(7), w: T(7), h: T(4), roofColor: '#8a4438', wallColor: '#bfa886', windows: 2, sign: '⚒' },
    { x: T(53), y: T(7), w: T(7), h: T(4), roofColor: '#8a4438', wallColor: '#bfa886', windows: 2 },

    // —— 集市街：西侧成簇 ——
    { x: T(2), y: T(15), w: T(9), h: T(5), roofColor: '#a04a3c', wallColor: '#c9b28d', windows: 3, awning: PALETTE.irisRed, sign: '🔨', signAt: T(7.4) },
    { x: T(2), y: T(23), w: T(7), h: T(5), roofColor: '#96453a', wallColor: '#bfa886', windows: 2 },
    // —— 集市街：东侧成簇 ——
    { x: T(53), y: T(15), w: T(9), h: T(5), roofColor: '#a04a3c', wallColor: '#c9b28d', windows: 3, awning: '#6f7d4c', sign: '🌿', signAt: T(1.6) },
    { x: T(55), y: T(23), w: T(7), h: T(5), roofColor: '#96453a', wallColor: '#bfa886', windows: 2 },

    // —— 窄巷：密集街区，街道被切成数条窄路 ——
    { x: T(12), y: T(24), w: T(7), h: T(4), roofColor: '#8f4034', wallColor: '#b8a17e', windows: 2 },
    { x: T(21), y: T(24), w: T(6), h: T(4), roofColor: '#a04a3c', wallColor: '#c2ac89', windows: 2 },
    { x: T(37), y: T(24), w: T(6), h: T(4), roofColor: '#8f4034', wallColor: '#b8a17e', windows: 2 },
    { x: T(45), y: T(24), w: T(7), h: T(4), roofColor: '#a04a3c', wallColor: '#c2ac89', windows: 2 },
    { x: T(14), y: T(29), w: T(7), h: T(3), facadeH: 40, roofColor: '#96453a', wallColor: '#bfa886', windows: 2 },
    { x: T(43), y: T(29), w: T(7), h: T(3), facadeH: 40, roofColor: '#96453a', wallColor: '#bfa886', windows: 2 },
    { x: T(2), y: T(29), w: T(6), h: T(3), facadeH: 40, roofColor: '#8f4034', wallColor: '#b8a17e', windows: 1 },
    { x: T(56), y: T(29), w: T(6), h: T(3), facadeH: 40, roofColor: '#8f4034', wallColor: '#b8a17e', windows: 1 }
];

// ============ 道具（sprite, 世界坐标为精灵左上角） ============

const PROPS = [
    // 卫城坡道：栏杆封锁（表达边界，不可通行）。
    // 必须铺满下方 solids 的整个跨度 T(10)~T(58)，否则会留下看不见的墙。
    ...Array.from({ length: 48 }, (_, i) => ({ s: 'rail', x: T(10) + i * 32, y: T(5.2), solid: false })),
    { s: 'tree', x: T(3), y: T(0.4) }, { s: 'tree', x: T(6.6), y: T(2.4) }, { s: 'tree', x: T(56), y: T(0.8) }, { s: 'tree', x: T(59.4), y: T(2.8) },

    // 校场：旗杆与长凳
    { s: 'flagPole', x: T(30.2), y: T(10.6), solid: true, r: 8 },
    { s: 'bench', x: T(20), y: T(12.4) }, { s: 'bench', x: T(42), y: T(12.4) },
    { s: 'crate', x: T(12), y: T(11.2) }, { s: 'barrel', x: T(51), y: T(11) },

    // 集市街：摊位、水井、铁砧、草药架
    { s: 'stallRed', x: T(13), y: T(16.4), solid: true, r: 22 },
    { s: 'stallGold', x: T(20), y: T(16.4), solid: true, r: 22 },
    { s: 'stallGreen', x: T(41), y: T(16.4), solid: true, r: 22 },
    { s: 'stallRed', x: T(48), y: T(16.4), solid: true, r: 22 },
    { s: 'well', x: T(30.4), y: T(18.4), solid: true, r: 18 },
    { s: 'anvil', x: T(8.6), y: T(20.6), solid: true, r: 10 },
    { s: 'herbRack', x: T(54.4), y: T(20), solid: true, r: 12 },
    { s: 'crate', x: T(11.4), y: T(21.4) }, { s: 'barrel', x: T(50.6), y: T(21.2) },
    { s: 'tree', x: T(24.6), y: T(20.6) }, { s: 'tree', x: T(35.4), y: T(20.6) },
    { s: 'stallGold', x: T(27), y: T(21.8), solid: true, r: 22 },
    { s: 'stallGreen', x: T(34), y: T(21.8), solid: true, r: 22 },
    { s: 'bench', x: T(28.4), y: T(19.4) }, { s: 'bench', x: T(34.4), y: T(19.4) },
    { s: 'crate', x: T(17.4), y: T(19.2) }, { s: 'barrel', x: T(18.8), y: T(19.6) },
    { s: 'sack', x: T(44.6), y: T(19.4) }, { s: 'crate', x: T(45.8), y: T(19.2) },
    { s: 'barrel', x: T(22.4), y: T(15.2) }, { s: 'crate', x: T(39.4), y: T(15.2) },
    { s: 'rope', x: T(13.2), y: T(22.6) }, { s: 'rope', x: T(48.6), y: T(22.6) },

    // 窄巷：桶与箱，堆在墙根
    { s: 'barrel', x: T(19.4), y: T(26.4) }, { s: 'crate', x: T(19.2), y: T(28.2) },
    { s: 'barrel', x: T(43.4), y: T(26.4) }, { s: 'sack', x: T(43.6), y: T(28.4) },
    { s: 'crate', x: T(28.4), y: T(30.4) }, { s: 'barrel', x: T(34.4), y: T(30.2) },
    { s: 'sack', x: T(9.4), y: T(27) }, { s: 'crate', x: T(52.6), y: T(27) },
    { s: 'barrel', x: T(27.4), y: T(25.2) }, { s: 'crate', x: T(35.4), y: T(25.2) },
    { s: 'tree', x: T(29.4), y: T(28.2) }, { s: 'bench', x: T(23.4), y: T(31) },
    { s: 'bench', x: T(39.4), y: T(31) }, { s: 'sack', x: T(11.4), y: T(31.2) },
    { s: 'crate', x: T(53.4), y: T(31.2) },

    // 码头：吊臂地标 + 货堆
    { s: 'crane', x: T(6), y: T(30.6), solid: true, r: 12 },
    { s: 'crate', x: T(10.4), y: T(33.4) }, { s: 'crate', x: T(12.2), y: T(34.2) },
    { s: 'barrel', x: T(17.4), y: T(33.6) }, { s: 'sack', x: T(19), y: T(34.4) },
    { s: 'rope', x: T(22), y: T(34.6) }, { s: 'barrel', x: T(45.4), y: T(33.6) },
    { s: 'crate', x: T(47.4), y: T(34.2) }, { s: 'sack', x: T(50.4), y: T(33.4) },
    { s: 'rope', x: T(41), y: T(34.8) },
    { s: 'crane', x: T(52), y: T(30.6), solid: true, r: 12 },
    // 系缆桩沿岸排开，给码头一条清晰的边
    ...Array.from({ length: 13 }, (_, i) => ({ s: 'bollard', x: T(3) + i * T(4.8), y: T(35.1) })),
    { s: 'boat', x: T(8), y: T(36.4) }, { s: 'boat', x: T(27), y: T(37) }, { s: 'boat', x: T(49), y: T(36.5) }
];

/** 火盆位置（火焰是动态绘制，底座烘焙进静态层）。 */
const BRAZIERS = [
    { x: T(11.6), y: T(21.6) }, { x: T(51.2), y: T(21.6) },
    { x: T(28.4), y: T(26.2) }, { x: T(35.6), y: T(26.2) },
    { x: T(29.4), y: T(5.6) }, { x: T(34.4), y: T(5.6) },
    { x: T(24.4), y: T(33.4) }, { x: T(39.4), y: T(33.4) }
];

// ============ 交互点与刷怪点 ============

const INTERACTABLES = [
    { id: 'smith', kind: 'merchant', sprite: 'smith', x: T(6.6), y: T(21.4), radius: 46, dir: 'down' },
    { id: 'herbalist', kind: 'merchant', sprite: 'herbalist', x: T(57.2), y: T(21.4), radius: 46, dir: 'down' },
    { id: 'quartermaster', kind: 'merchant', sprite: 'quartermaster', x: T(33.6), y: T(12.2), radius: 46, dir: 'down' },
    { id: 'dockHand', kind: 'npc', sprite: 'dockHand', x: T(14.6), y: T(35.2), radius: 46, dir: 'down' },
    { id: 'dummy1', kind: 'dummy', x: T(24), y: T(9.4), radius: 40 },
    { id: 'dummy2', kind: 'dummy', x: T(32), y: T(8.6), radius: 40 },
    { id: 'dummy3', kind: 'dummy', x: T(40), y: T(9.4), radius: 40 }
];

const ENEMY_SPAWNS = [
    { type: 'dockThug', x: T(17.5), y: T(21.6) },
    { type: 'dockThug', x: T(47), y: T(21.6) },
    { type: 'dockThug', x: T(20), y: T(28.6) },
    { type: 'dockThug', x: T(44), y: T(28.6) },
    // 出生点（码头中段）半径两屏内不放敌人：开场对白期间不能被打
    { type: 'drunkVeteran', x: T(24.4), y: T(28.6) },
    { type: 'drunkVeteran', x: T(10.4), y: T(26) },
    { type: 'regencyInformant', x: T(56), y: T(26) },
    { type: 'regencyInformant', x: T(32), y: T(22.6) }
];

/** 只为让街道有人气的市民，不可交互、不参与战斗。 */
const AMBIENT = [
    { sprite: 'townswoman', x: T(26.4), y: T(19.2), dir: 'down' },
    { sprite: 'townsman', x: T(37.6), y: T(22.8), dir: 'up' },
    { sprite: 'townsman', x: T(15.4), y: T(22.6), dir: 'right' },
    { sprite: 'townswoman', x: T(50.4), y: T(19.4), dir: 'down' },
    { sprite: 'porter', x: T(21.4), y: T(34.6), dir: 'right' },
    { sprite: 'porter', x: T(46.6), y: T(34.4), dir: 'left' },
    { sprite: 'townsman', x: T(44.6), y: T(12.6), dir: 'left' },
    { sprite: 'townswoman', x: T(31.4), y: T(30.6), dir: 'down' }
];

export const PLAYER_SPAWN = Object.freeze({ x: T(32), y: T(34.4) });

// ============ 构建 ============

export function createWorld() {
    const solids = [];

    // 建筑：整块矩形都是墙
    for (const b of BUILDINGS) solids.push({ x: b.x, y: b.y, w: b.w, h: b.h });
    // 水面不可进入（留 4px 让脚尖贴到岸边）
    solids.push({ x: 0, y: T(36) + 4, w: WORLD_W, h: T(4) });
    // 卫城栏杆
    solids.push({ x: T(10), y: T(5.2) + 6, w: T(14), h: 12 });
    solids.push({ x: T(24), y: T(5.2) + 6, w: T(20), h: 12 });
    solids.push({ x: T(44), y: T(5.2) + 6, w: T(14), h: 12 });
    // 世界边界
    solids.push({ x: -40, y: -40, w: 40, h: WORLD_H + 80 });
    solids.push({ x: WORLD_W, y: -40, w: 40, h: WORLD_H + 80 });
    solids.push({ x: -40, y: -40, w: WORLD_W + 80, h: 40 });

    // 实心道具 → 方形碰撞
    for (const p of PROPS) {
        if (!p.solid) continue;
        const sp = ART.props[p.s];
        const r = p.r ?? 12;
        solids.push({ x: p.x + sp.w / 2 - r, y: p.y + sp.h - r * 1.4, w: r * 2, h: r * 1.6 });
    }
    for (const b of BRAZIERS) solids.push({ x: b.x + 4, y: b.y + 14, w: 12, h: 10 });
    for (const it of INTERACTABLES) {
        if (it.kind === 'dummy') solids.push({ x: it.x - 9, y: it.y - 12, w: 18, h: 16 });
    }

    const staticCanvas = bakeStaticLayer();

    return {
        staticCanvas,
        solids,
        props: PROPS,
        braziers: BRAZIERS,
        ambient: AMBIENT.map(a => ({ ...a })),
        interactables: INTERACTABLES.map(it => ({ ...it })),
        enemySpawns: ENEMY_SPAWNS,
        districts: DISTRICTS,
        width: WORLD_W,
        height: WORLD_H
    };
}

// ============ 静态层烘焙 ============

function fillZone(ctx, zone) {
    const sprite = ART.tiles[zone.tile];
    const pattern = ctx.createPattern(sprite.canvas, 'repeat');
    // 精灵按 SS 超采样过，用矩阵缩回逻辑尺寸再平铺
    const scale = sprite.w / sprite.canvas.width;
    pattern.setTransform(new DOMMatrix([scale, 0, 0, scale, 0, 0]));
    ctx.fillStyle = pattern;
    ctx.fillRect(zone.x, zone.y, zone.w, zone.h);
}

function bakeStaticLayer() {
    const canvas = document.createElement('canvas');
    canvas.width = WORLD_W * STATIC_SS;
    canvas.height = WORLD_H * STATIC_SS;
    const ctx = canvas.getContext('2d');
    ctx.scale(STATIC_SS, STATIC_SS);           // 此后全部按世界单位作画
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // —— 地面 ——
    for (const zone of GROUND_ZONES) fillZone(ctx, zone);

    // 分区之间的软过渡，避免出现机械的直线接缝
    softSeam(ctx, T(6), '#7b6a4e', PALETTE.sand);
    softSeam(ctx, T(14), PALETTE.sand, PALETTE.stone);
    softSeam(ctx, T(32), PALETTE.stone, PALETTE.wood);

    // 水面纵深：越远离岸越暗，避免整片死板的青灰色
    ctx.save();
    const depth = ctx.createLinearGradient(0, T(36), 0, WORLD_H);
    depth.addColorStop(0, 'rgba(90,124,132,0.16)');
    depth.addColorStop(0.45, 'rgba(18,32,42,0.30)');
    depth.addColorStop(1, 'rgba(8,18,26,0.66)');
    ctx.fillStyle = depth;
    ctx.fillRect(0, T(36), WORLD_W, T(4));
    ctx.restore();

    // 岸线：木栈道与水面之间的湿痕与浪线
    ctx.save();
    const shore = ctx.createLinearGradient(0, T(36) - 12, 0, T(36) + 6);
    shore.addColorStop(0, 'rgba(30,24,16,0)');
    shore.addColorStop(1, 'rgba(24,32,36,0.55)');
    ctx.fillStyle = shore;
    ctx.fillRect(0, T(36) - 12, WORLD_W, 18);
    ctx.strokeStyle = rgba(PALETTE.waterHi, 0.4);
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(0, T(36) + 2 + i * 5);
        for (let x = 0; x <= WORLD_W; x += 48) {
            ctx.quadraticCurveTo(x + 24, T(36) + 2 + i * 5 + (i % 2 ? 3 : -3), x + 48, T(36) + 2 + i * 5);
        }
        ctx.stroke();
    }
    ctx.restore();

    // 主路：中央南北草道用极浅的暖色留白强调（负空间画路线）
    ctx.save();
    const road = ctx.createLinearGradient(T(26), 0, T(38), 0);
    road.addColorStop(0, 'rgba(213,181,111,0)');
    road.addColorStop(0.5, 'rgba(213,181,111,0.09)');
    road.addColorStop(1, 'rgba(213,181,111,0)');
    ctx.fillStyle = road;
    ctx.fillRect(T(26), T(5), T(12), T(30));
    ctx.restore();

    // —— 建筑 ——
    for (const b of BUILDINGS) {
        drawBuilding(ctx, b.x, b.y, b.w, b.h, b);
    }
    // 卫城外郭额外补一排窗台鸢尾与檐下阴影，强调它是"活着的城"
    for (let i = 0; i < 6; i++) drawIrisBox(ctx, T(21) + i * T(3.6), T(4.1), 26);

    // —— 道具 ——
    for (const p of PROPS) blit(ctx, ART.props[p.s], p.x, p.y);
    for (const b of BRAZIERS) blit(ctx, ART.props.brazier, b.x, b.y);

    // —— 环境光：黄昏暖调 + 火盆光池 ——
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    const dusk = ctx.createLinearGradient(0, 0, 0, WORLD_H);
    dusk.addColorStop(0, '#a3a3ba');       // 北端偏冷（背阴的卫城）
    dusk.addColorStop(0.55, '#ded0b6');
    dusk.addColorStop(1, '#bfae9c');       // 南端码头潮湿偏暗
    ctx.fillStyle = dusk;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const b of BRAZIERS) {
        const g = ctx.createRadialGradient(b.x + 10, b.y + 6, 4, b.x + 10, b.y + 6, 92);
        g.addColorStop(0, 'rgba(255,186,96,0.34)');
        g.addColorStop(0.45, 'rgba(214,124,44,0.14)');
        g.addColorStop(1, 'rgba(160,70,20,0)');
        ctx.fillStyle = g;
        ctx.fillRect(b.x - 82, b.y - 86, 184, 184);
    }
    ctx.restore();

    // 积水：低洼处的浅坑，反着天光。放在光照之后，才不会被暖调压掉
    ctx.save();
    for (let i = 0; i < 26; i++) {
        const x = rng.range(T(2), T(62));
        const y = rng.range(T(15), T(35));
        const rx = rng.range(9, 26), ry = rx * rng.range(0.34, 0.5);
        ctx.globalAlpha = rng.range(0.10, 0.20);
        const g = ctx.createRadialGradient(x, y, 1, x, y, rx);
        g.addColorStop(0, '#8fa6ae');
        g.addColorStop(0.65, '#5c6f75');
        g.addColorStop(1, 'rgba(60,72,78,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rng.range(-0.4, 0.4), 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha *= 0.7;
        ctx.strokeStyle = '#c8d6da'; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.ellipse(x - rx * 0.12, y - ry * 0.18, rx * 0.6, ry * 0.5, 0, Math.PI * 0.9, Math.PI * 1.7); ctx.stroke();
    }
    ctx.restore();

    // 地面碎屑与湿痕，打散大面积纯色
    ctx.save();
    ctx.globalAlpha = 0.10;
    for (let i = 0; i < 900; i++) {
        const x = rng.next() * WORLD_W, y = T(6) + rng.next() * T(30);
        ctx.fillStyle = rng.chance(0.5) ? '#2b241a' : '#e6dcc4';
        ctx.fillRect(x, y, rng.range(1, 2.6), rng.range(1, 2));
    }
    ctx.restore();

    return canvas;
}

function softSeam(ctx, y, fromColor, toColor) {
    ctx.save();
    ctx.globalAlpha = 0.34;
    const g = ctx.createLinearGradient(0, y - 14, 0, y + 14);
    g.addColorStop(0, rgba(fromColor, 0.9));
    g.addColorStop(0.5, rgba(shift(fromColor, -0.1), 0.35));
    g.addColorStop(1, rgba(toColor, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, y - 14, WORLD_W, 28);
    ctx.restore();
}

// ============ 碰撞 ============

/** 圆 vs 矩形集合的分轴推挤：先解 x 再解 y，贴墙滑动手感稳定。 */
export function resolveCollision(world, x, y, radius) {
    let nx = x, ny = y;
    for (let i = 0, len = world.solids.length; i < len; i++) {
        const s = world.solids[i];
        const cx = clamp(nx, s.x, s.x + s.w);
        const cy = clamp(ny, s.y, s.y + s.h);
        const dx = nx - cx, dy = ny - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 >= radius * radius) continue;
        if (d2 > 0.0001) {
            const d = Math.sqrt(d2);
            nx = cx + (dx / d) * radius;
            ny = cy + (dy / d) * radius;
        } else {
            // 圆心陷进矩形：沿最短边推出
            const left = nx - s.x, right = s.x + s.w - nx;
            const top = ny - s.y, bottom = s.y + s.h - ny;
            const min = Math.min(left, right, top, bottom);
            if (min === left) nx = s.x - radius;
            else if (min === right) nx = s.x + s.w + radius;
            else if (min === top) ny = s.y - radius;
            else ny = s.y + s.h + radius;
        }
    }
    return { x: nx, y: ny };
}

export function districtAt(y) {
    for (const d of DISTRICTS) if (y >= d.y0 && y < d.y1) return d;
    return DISTRICTS[DISTRICTS.length - 1];
}

// ============ 动态覆盖层（水波） ============

export function drawWaterOverlay(ctx, t, view) {
    const y0 = T(36);
    if (view.y + view.h < y0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(PALETTE.waterHi, 0.16);
    ctx.lineWidth = 2;
    for (let row = 0; row < 6; row++) {
        const y = y0 + 10 + row * 20;
        const phase = t * (0.35 + row * 0.08) + row;
        ctx.beginPath();
        for (let x = view.x - 60; x < view.x + view.w + 60; x += 40) {
            const off = Math.sin((x * 0.02) + phase) * 3;
            ctx.lineTo(x, y + off);
        }
        ctx.stroke();
    }
    ctx.restore();
}
