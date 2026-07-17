// 通用工具：确定性随机数、缓动函数、轻量补间系统、六边形坐标数学。
// 全场景使用固定种子，保证每次打开页面布局一致（截图可复现）。

// —— mulberry32 确定性伪随机 ——
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rng = mulberry32(20260717);          // 世界生成用
export const demoRng = mulberry32(9973);          // 战斗数值用（伤害/暴击，序列固定）

export const rand = (a = 1, b) => (b === undefined ? rng() * a : a + rng() * (b - a));
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(rng() * arr.length)];

// —— 缓动 ——
export const EASE = {
  linear: (t) => t,
  inOut: (t) => t * t * (3 - 2 * t),              // smoothstep
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  outBack: (t) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
};

// —— 极简补间：每帧由主循环调用 updateTweens(dt) 推进 ——
const tweens = [];
export function tween({ dur = 1, delay = 0, ease = EASE.linear, onUpdate = null, onDone = null }) {
  const tw = { t: -delay, dur, ease, onUpdate, onDone, dead: false };
  tweens.push(tw);
  return tw;
}
export function killTween(tw) { if (tw) tw.dead = true; }
export function updateTweens(dt) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    if (tw.dead) { tweens.splice(i, 1); continue; }
    tw.t += dt;
    if (tw.t < 0) continue;                        // delay 阶段
    const k = Math.min(1, tw.t / tw.dur);
    tw.onUpdate && tw.onUpdate(tw.ease(k), k);
    if (k >= 1) { tweens.splice(i, 1); tw.onDone && tw.onDone(); }
  }
}

// 角度插值（走最短弧），用于单位转身
export function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// —— 六边形（轴坐标、尖顶朝向）——
export const HEX_SIZE = 1.0;
// 与 2D 像素版等价的布局公式：x = √3·size·(q + r/2)，z = 1.5·size·r
export function axialToWorld(q, r) {
  return { x: Math.sqrt(3) * HEX_SIZE * (q + r / 2), z: 1.5 * HEX_SIZE * r };
}
export function hexDist(a, b) {
  const dq = a.q - b.q, dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}
export const HEX_DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
export const hexKey = (q, r) => q + ',' + r;

// —— 全局风向：西北吹向东南（世界空间常量），旗帜/烟尘统一遵循 ——
export const WIND = {
  x: Math.SQRT1_2, z: Math.SQRT1_2,          // 归一化方向 (+x,+z) = 东南
  yaw: Math.PI / 4,                          // 风的水平朝向角
};
// 阵风强度：随时间缓慢起伏的时间函数（0.45 ~ 1.2）
export function gustStrength(time) {
  return 0.75 + 0.3 * Math.sin(time * 0.8) + 0.15 * Math.sin(time * 1.9 + 1.3);
}

// BFS 寻路（passable(tile) 判定可通行），返回不含起点的路径数组，找不到返回 null
export function findPath(from, to, tiles, passable, maxLen = 99) {
  if (from.q === to.q && from.r === to.r) return [];
  const prev = new Map([[hexKey(from.q, from.r), null]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    for (const [dq, dr] of HEX_DIRS) {
      const q = cur.q + dq, r = cur.r + dr, key = hexKey(q, r);
      if (prev.has(key)) continue;
      const tile = tiles.get(key);
      if (!tile || !passable(tile)) continue;
      prev.set(key, cur);
      if (q === to.q && r === to.r) {
        const path = [tile];
        let p = cur;
        while (p && !(p.q === from.q && p.r === from.r)) { path.unshift(tiles.get(hexKey(p.q, p.r))); p = prev.get(hexKey(p.q, p.r)); }
        return path.length <= maxLen ? path : null;
      }
      queue.push({ q, r });
    }
  }
  return null;
}
