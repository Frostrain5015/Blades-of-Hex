// js/perf.js — 轻量同步耗时埋点。
// 开启方式：URL 加 ?perf=1，或 localStorage.setItem('boh_perf', '1') 后刷新。
// 关闭时 measure() 只有一次布尔判断 + 直接调用，零分配、无计时开销。
// 用法：控制台执行 __perfReport() 查看按总耗时排序的表格，__perfReset() 清零。
// 单帧超过 PERF_SLOW_MS 的调用会即时打印警告，便于捕捉掉帧现场。

const PERF_SLOW_MS = 8;

const _enabled = (() => {
    try {
        if (typeof window === 'undefined') return false;
        if (new URLSearchParams(window.location?.search || '').has('perf')) return true;
        return globalThis.localStorage?.getItem?.('boh_perf') === '1';
    } catch {
        return false;
    }
})();

const _stats = new Map(); // name -> { count, total, max }

/** 是否已开启埋点。热路径包装用它分流，避免关闭时为每次调用分配闭包。 */
export function perfEnabled() {
    return _enabled;
}

/** 同步测量 fn 的执行耗时并累计到 name 名下；返回值透传。 */
export function measure(name, fn) {
    if (!_enabled) return fn();
    const t0 = performance.now();
    try {
        return fn();
    } finally {
        const dt = performance.now() - t0;
        let s = _stats.get(name);
        if (!s) {
            s = { count: 0, total: 0, max: 0 };
            _stats.set(name, s);
        }
        s.count++;
        s.total += dt;
        if (dt > s.max) s.max = dt;
        if (dt >= PERF_SLOW_MS) console.warn(`[perf] ${name} 单次 ${dt.toFixed(2)}ms`);
    }
}

export function perfReport() {
    const rows = [..._stats.entries()]
        .map(([name, s]) => ({
            name,
            count: s.count,
            totalMs: +s.total.toFixed(1),
            avgMs: +(s.total / s.count).toFixed(3),
            maxMs: +s.max.toFixed(2)
        }))
        .sort((a, b) => b.totalMs - a.totalMs);
    console.table(rows);
    return rows;
}

export function perfReset() {
    _stats.clear();
}

if (typeof window !== 'undefined') {
    window.__perfReport = perfReport;
    window.__perfReset = perfReset;
}
