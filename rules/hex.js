// rules/hex.js — 六边形公共工具（纯函数，无 DOM/Canvas）。
// 画布上的六边形描边、顶点计算等属于渲染，留在客户端模块。

import { deepFreeze } from './freeze.js';

/** 轴坐标邻接偏移 (q, r)。 */
export const HEX_NEIGHBORS = deepFreeze([[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]);

/** 立方坐标距离。a/b 需带 q/r/s。 */
export function hexDistance(a, b) {
    return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.s - b.s)) / 2;
}
