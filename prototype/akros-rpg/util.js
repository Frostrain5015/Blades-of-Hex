// 通用工具：确定性随机数、缓动与补间、几何、金钱格式化。
// 与 prototype/3d-battlefield/util.js 同源约定：固定种子 RNG 保证截图可复现。

// ============ 确定性随机 ============

/** mulberry32：小巧、可复现的 32 位 PRNG。 */
export function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function createRng(seed) {
    const next = mulberry32(seed);
    return {
        next,
        /** [min, max) 之间的浮点数。 */
        range(min, max) { return min + next() * (max - min); },
        /** [min, max] 之间的整数。 */
        int(min, max) { return Math.floor(min + next() * (max - min + 1)); },
        /** 以 p 的概率返回 true。 */
        chance(p) { return next() < p; },
        pick(list) { return list[Math.floor(next() * list.length)]; }
    };
}

// ============ 数学 ============

export function clamp(value, min, max) { return value < min ? min : (value > max ? max : value); }

export function lerp(a, b, t) { return a + (b - a) * t; }

/** 帧率无关的指数趋近：t 为「每秒收敛比例」。 */
export function damp(a, b, lambda, dt) { return lerp(a, b, 1 - Math.exp(-lambda * dt)); }

export function dist2(ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    return dx * dx + dy * dy;
}

/** 把角度差归一化到 (-π, π]。 */
export function angleDelta(from, to) {
    let d = (to - from) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d <= -Math.PI) d += Math.PI * 2;
    return d;
}

/** 圆 vs 轴对齐矩形是否相交（用于角色与建筑碰撞）。 */
export function circleHitsRect(cx, cy, r, rx, ry, rw, rh) {
    const nx = clamp(cx, rx, rx + rw);
    const ny = clamp(cy, ry, ry + rh);
    return dist2(cx, cy, nx, ny) < r * r;
}

// ============ 缓动与补间 ============

export const EASE = Object.freeze({
    linear: (t) => t,
    outQuad: (t) => 1 - (1 - t) * (1 - t),
    outCubic: (t) => 1 - Math.pow(1 - t, 3),
    inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    outBack: (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2)
});

const _tweens = [];

/** 注册一条补间；由主循环的 updateTweens(dt) 推进。 */
export function tween(durationSec, onUpdate, easing = EASE.outQuad, onDone = null) {
    _tweens.push({ t: 0, duration: durationSec, onUpdate, easing, onDone });
}

export function updateTweens(dt) {
    for (let i = _tweens.length - 1; i >= 0; i--) {
        const tw = _tweens[i];
        tw.t += dt;
        const k = clamp(tw.t / tw.duration, 0, 1);
        tw.onUpdate(tw.easing(k));
        if (k >= 1) {
            _tweens.splice(i, 1);
            if (tw.onDone) tw.onDone();
        }
    }
}

// ============ 金钱 ============
// 金钱一律以整数「分」存储（1 $ = 100 分），只在显示层转字符串。
// 绝不用浮点数存钱：0.1 + 0.2 这类误差会在反复买卖中累积成脏数据。

export const CENTS_PER_DOLLAR = 100;

/** 分 → '$1.85'。 */
export function formatMoney(cents) {
    const sign = cents < 0 ? '-' : '';
    const abs = Math.abs(Math.round(cents));
    return `${sign}$${Math.floor(abs / CENTS_PER_DOLLAR)}.${String(abs % CENTS_PER_DOLLAR).padStart(2, '0')}`;
}

/** '1.85' 或 1.85 → 185 分（仅用于数据表书写，运行期不再回到浮点）。 */
export function dollars(value) { return Math.round(Number(value) * CENTS_PER_DOLLAR); }

// ============ 杂项 ============

/** 百分比文本，对齐 rules/format.js 的写法。 */
export function percent(value) { return `${Math.round(value * 100)}%`; }

export function nowSec() { return performance.now() / 1000; }
