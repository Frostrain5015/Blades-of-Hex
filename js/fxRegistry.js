// 将领特效图层注册表 —— renderGame 在固定图层点位遍历执行已注册的绘制钩子。
// 特效模块（commander/fx/*.js）在 register() 中通过 registerFxLayer 挂钩，
// 换局装载新将领前由 loadCommanderFx 统一 clearFxLayers()。
// 好处：本局未选的将领零帧开销；renderer 不再 import 任何将领专属绘制函数。

import { on, off } from './eventBus.js';

// 图层点位（与 renderGame 内的调用顺序一一对应，严格对齐重构前的绘制次序）：
//   ground         — 地块覆盖层之后、单位六边形辉光之前（缚足色层/灵光/力场/魂印）
//   underUnits     — 立绘之后、单位徽章之前（圣骑士剑环后半圈）
//   aboveUnits     — 单位与旗帜之后（星移光柱）
//   overSkillFx    — 将领技能触发特效之后（圣骑士剑环前半圈）
//   weatherOverlay — 天气粒子之后（占星者星光力场覆绘）
//   projectiles    — 通用弹道之后、近战斩击之前（至圣斩弹射飞剑）
//   preFog         — 雷击之后、战争迷雾遮罩之前（血流/金光/圣链/攻心波纹/统御环）
//   top            — 烧牌/空袭/空运之后的最高图层（魂卒召回黑烟）
//
// 同一图层内多个钩子按 order 升序绘制（对齐原 renderer 内的先后顺序）。
const _layers = new Map();   // layerName → [{fn, order}]（按 order 升序）
const _updaters = [];        // fn(dt, now) — 每帧更新（粒子寿命、弹道位置等）
const _fxListeners = [];     // fx 模块注册的总线监听，随 clearFxLayers 一并清理

export function registerFxLayer(layer, fn, order = 0) {
    let arr = _layers.get(layer);
    if (!arr) { arr = []; _layers.set(layer, arr); }
    const entry = { fn, order };
    const idx = arr.findIndex(e => e.order > order);
    if (idx === -1) arr.push(entry); else arr.splice(idx, 0, entry);
}

// fx 模块注册每帧 update 回调（粒子更新、弹道更新等），由 renderGame 末尾统一驱动
export function registerFxUpdate(fn) {
    _updaters.push(fn);
}

// fx 模块订阅逻辑事件用。经此注册的监听在换局时自动解除。
export function registerFxListener(event, fn) {
    _fxListeners.push([event, fn]);
    return on(event, fn);
}

export function clearFxLayers() {
    _layers.clear();
    _updaters.length = 0;
    for (const [event, fn] of _fxListeners) off(event, fn);
    _fxListeners.length = 0;
}

export function drawFxLayer(layer, ctx, now) {
    const arr = _layers.get(layer);
    if (!arr) return;
    for (let i = 0; i < arr.length; i++) arr[i].fn(ctx, now);
}

export function updateFxFns(dt, now) {
    for (let i = 0; i < _updaters.length; i++) _updaters[i](dt, now);
}

// 测试/调试用：当前注册状态快照（只读）
export function getFxRegistryStats() {
    const layers = {};
    for (const [name, arr] of _layers) layers[name] = arr.length;
    return { layers, updaters: _updaters.length, listeners: _fxListeners.length };
}
