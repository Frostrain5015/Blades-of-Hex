// core/dom-shim.js — 让浏览器模拟引擎能在 Node(无头/服务端权威)中加载运行。
//
// 作为副作用模块:被 import 时,若检测到不在浏览器环境(无 document),则安装一套
// 最小的 DOM / canvas / 浏览器全局桩,使 config.js/effects.js/renderer.js/audio.js
// 等在 Node 下 import 与调用不抛错(canvas 操作变 no-op,作用于假 canvas)。
//
// 浏览器中 document 已存在 → 整段跳过,对前端零影响。
// 必须在任何引擎模块之前 import(headless.js 的第一条 import)。

if (typeof globalThis.document === 'undefined') {
    const noop = () => {};

    // canvas 2D 上下文:所有方法 no-op,渐变/measureText 返回安全占位
    const makeCtx = () => new Proxy({}, {
        get(_t, k) {
            if (k === 'canvas') return fakeCanvas;
            if (k === 'measureText') return () => ({ width: 0 });
            if (k === 'createLinearGradient' || k === 'createRadialGradient')
                return () => ({ addColorStop: noop });
            if (k === 'getImageData') return () => ({ data: [] });
            return noop;
        },
        set() { return true; }
    });

    const fakeCanvas = {
        width: 1000, height: 750, style: {},
        getContext: () => makeCtx(),
        addEventListener: noop, removeEventListener: noop,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 750 }),
    };

    // children/firstChild 等访问任意索引都返回可写的桩元素,避免 el.children[0].x 崩
    const childProxy = () => new Proxy([], {
        get(t, k) {
            if (k in t) return t[k];      // length / 数组方法
            if (k === Symbol.iterator) return [][Symbol.iterator].bind([]);
            return makeEl();              // children[0]、children[1]… → 桩元素
        }
    });

    const makeEl = () => ({
        style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
        appendChild: noop, removeChild: noop, setAttribute: noop, removeAttribute: noop,
        addEventListener: noop, removeEventListener: noop, getContext: () => makeCtx(),
        querySelector: () => makeEl(), querySelectorAll: () => [],
        textContent: '', innerHTML: '', value: '', focus: noop, click: noop,
        get children() { return childProxy(); },
        get firstChild() { return makeEl(); },
        get parentNode() { return makeEl(); },
    });

    const elCache = new Map();
    globalThis.document = {
        getElementById: (id) => {
            if (id === 'gameCanvas' || id === 'cardCanvas') return fakeCanvas;
            if (!elCache.has(id)) elCache.set(id, makeEl());
            return elCache.get(id);
        },
        createElement: () => makeEl(),
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: noop, removeEventListener: noop,
        dispatchEvent: noop,
        body: makeEl(),
        documentElement: makeEl(),
    };

    globalThis.window = {
        devicePixelRatio: 1,
        addEventListener: noop, removeEventListener: noop,
        requestAnimationFrame: noop, cancelAnimationFrame: noop,
        location: { href: '', search: '', reload: noop },
        matchMedia: () => ({ matches: false, addEventListener: noop }),
    };

    if (!globalThis.performance) globalThis.performance = { now: () => Date.now() };
    globalThis.requestAnimationFrame = noop;
    globalThis.cancelAnimationFrame = noop;
    globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop, clear: noop };
    globalThis.CustomEvent = class { constructor(type, opts) { this.type = type; this.detail = opts && opts.detail; } };
    globalThis.Event = globalThis.CustomEvent;
    globalThis.Image = class { constructor() { this.onload = null; this.onerror = null; } set src(_v) {} };
    globalThis.Audio = class { play() { return Promise.resolve(); } pause() {} addEventListener() {} };
    try {
        Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node-headless' }, configurable: true });
    } catch { /* 某些 Node 版本 navigator 只读,忽略 */ }

    // 第三方库全局(浏览器里由 <script> 引入,Node 下不存在):howler / gsap
    // 用可链式的 no-op Proxy 兜底,任何方法/属性访问都安全。
    const chainNoop = () => new Proxy(function () {}, {
        get(_t, k) { if (k === 'then') return undefined; return chainNoop(); },
        apply() { return chainNoop(); },
        construct() { return chainNoop(); },
    });
    globalThis.Howl = class { constructor() { return chainNoop(); } };
    globalThis.Howler = chainNoop();
    globalThis.gsap = chainNoop();

    globalThis.__BOH_HEADLESS__ = true;
}
