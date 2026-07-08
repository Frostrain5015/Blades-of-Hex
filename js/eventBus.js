// 轻量事件总线 —— 将领逻辑与视觉特效解耦用。
// 逻辑侧 emit(事件名, ...参数)；特效模块加载后 on() 订阅。
// 无监听者时 emit 为 no-op：headless 服务器与"本局未选该将领"两种场景天然静默，
// 无需 dom-shim 垫片或 setXxxRef 空回退。

const _listeners = new Map(); // event → Set<fn>

export function on(event, fn) {
    let set = _listeners.get(event);
    if (!set) { set = new Set(); _listeners.set(event, set); }
    set.add(fn);
    return () => off(event, fn);
}

export function off(event, fn) {
    const set = _listeners.get(event);
    if (set) { set.delete(fn); if (set.size === 0) _listeners.delete(event); }
}

export function emit(event, ...args) {
    const set = _listeners.get(event);
    if (!set) return;
    for (const fn of [...set]) fn(...args);
}
