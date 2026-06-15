// core/rng.js — 确定性种子伪随机数发生器(PRNG),用于服务器权威化模拟。
//
// 同构(isomorphic):不依赖任何浏览器或 Node 专有 API,可同时被前端 ES 模块
// 与服务端 import。用它替换模拟核心里散落的 Math.random(),使战斗/卡牌/将领
// 的掷骰可复现、由服务器种子控制——杜绝客户端反复重掷直到出暴击的作弊。
//
// 装饰性随机(effects.js / renderer.js / audio.js)不在此列,保持 Math.random()。
//
// 算法:mulberry32 —— 快速的 32 位 PRNG,状态仅一个 uint32,易于序列化与重连恢复。

/**
 * @typedef {Object} Rng
 * @property {() => number} next        浮点数 [0,1)
 * @property {(lo:number, hi:number) => number} range   浮点数 [lo,hi)
 * @property {(n:number) => number} int        整数 [0,n)
 * @property {(lo:number, hi:number) => number} between 整数 [lo,hi](含两端)
 * @property {(p:number) => boolean} chance     概率 p 为真
 * @property {() => number} getState    取出内部状态(uint32),用于快照/重连
 * @property {(s:number) => void} setState 恢复内部状态
 */

/**
 * 创建一个确定性 RNG 实例。
 * @param {number} seed 32 位无符号整数种子(0 会被规整为 1)
 * @returns {Rng}
 */
export function createRng(seed) {
    let state = (seed >>> 0) || 1;

    function next() {
        // mulberry32
        state = (state + 0x6D2B79F5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    return {
        next,
        range: (lo, hi) => lo + next() * (hi - lo),
        int: (n) => Math.floor(next() * n),
        between: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
        chance: (p) => next() < p,
        getState: () => state >>> 0,
        setState: (s) => { state = (s >>> 0) || 1; },
    };
}

/**
 * 由字符串派生一个数值种子(FNV-1a 32 位)。
 * 用法:把房间号 + 对局 nonce 拼成字符串生成对局种子,保证每局不同且可复现。
 * @param {string} str
 * @returns {number} uint32 种子
 */
export function seedFromString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}
