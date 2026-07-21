// 跳字统一队列：伤害/治疗/护盾/城市 HP 浮字的唯一入口。
//
// 设计要点：
// - 所有条目在产生时同步登记（即使显示有延迟 delayMs），因此广播快照能完整捕获；
//   远端按同一批条目重放（replayFloatTexts），两端看到同一序列、同一节奏。
// - 同地块条目按 FLOAT_TEXT_GAP_MS 节拍错峰播放，替代手写的 setTimeout 错开逻辑。
// - 零延迟条目立即进活动数组（damageTexts/healTexts/shieldTexts），保持既有即时行为；
//   延迟/错峰条目进 gameState.floatTextPending，由渲染帧 flushFloatTexts 到期搬入。
// - 每个条目（含算好的 finalDelay）追加到 gameState._pendingFloatTexts，
//   broadcastAction 时 drain 进 effectData.floatTexts（cap 300 防单机模式膨胀）。
// - 事件自复制路径（fx:celestineOraclePulse / fx:aureliaOath / fx:hpDeltaTexts 等
//   两端各自 emit 一次的）入队时传 { broadcast: false }，避免远端双重出字。
// - setFloatTextsSuppressed 用于远端重放中需要重跑游戏逻辑的分支（如闪电卡远端
//   调 applyDamage），抑制本地产出，防止与 payload 重放双重出字。
//
// 本模块不 import state.js：state.js 经 commanderInterface → commander/index →
// 各 commander 模块会形成回边（commander 文件也 import 本模块），静态 import 会在
// commander 模块作为入口时触发 TDZ。改为由 state.js 在创建 gameState 后反向注册。
// 所有调用方也可经 options.gs 显式传入目标状态（headless 测试的自定义状态对象）。

let _stateRef = null;
export function setFloatTextsStateRef(ref) { _stateRef = ref; }
function _defaultState() { return _stateRef; }

export const FLOAT_TEXT_GAP_MS = 400;
const MAX_CAPTURE = 300;

// 同地块错峰节拍表：tileKey -> 下一条允许显示的最早时刻
const _tileNextShowAt = new Map();
let _suppressed = false;
// 捕获抑制：延迟弹着（空袭/鱼雷等 setTimeout 落弹）回调内的跳字只显示、不进广播捕获。
// 远端在对应的弹着时刻会重跑同一段结算（applyDamage 等），自行推导出这批跳字；
// 若本地再捕获，会漏进下一次广播的 payload，远端在下个动作里看到"幽灵跳字"。
let _captureSuppressed = false;

function _ensureArrays(state) {
    if (!state.damageTexts) state.damageTexts = [];
    if (!state.healTexts) state.healTexts = [];
    if (!state.shieldTexts) state.shieldTexts = [];
    if (!state.floatTextPending) state.floatTextPending = [];
}

function _activeArray(state, kind) {
    if (kind === 'heal') return state.healTexts;
    if (kind === 'shield') return state.shieldTexts;
    return state.damageTexts;
}

function _defaultTimeLeft(kind) {
    return kind === 'damage' ? 900 : 1000;
}

function _tileKey(entry) {
    if (Number.isFinite(entry.q) && Number.isFinite(entry.r)) return `h:${entry.q},${entry.r}`;
    return `xy:${Math.round(entry.x || 0)},${Math.round(entry.y || 0)}`;
}

// 只保留可序列化、渲染需要的字段
function _makeRecord(entry, kind) {
    const record = {
        kind,
        x: entry.x,
        y: entry.y,
        value: entry.value,
        timeLeft: entry.timeLeft ?? _defaultTimeLeft(kind)
    };
    if (Number.isFinite(entry.q)) record.q = entry.q;
    if (Number.isFinite(entry.r)) record.r = entry.r;
    if (entry.sign) record.sign = entry.sign;
    if (entry.isCrit) record.isCrit = true;
    if (entry.isTrueDmg) record.isTrueDmg = true;
    if (entry.isCityDamage) record.isCityDamage = true;
    if (entry.isCityHeal) record.isCityHeal = true;
    if (entry.isPoison) record.isPoison = true;
    return record;
}

/**
 * 登记一条浮字。entry: { kind?, x, y, q?, r?, value, sign?, isCrit?, isTrueDmg?,
 * isCityDamage?, isCityHeal?, isPoison?, timeLeft?, delayMs? }
 * options: { gs? 目标状态（默认 gameState 单例）, broadcast? =false 时不进广播捕获,
 *           stagger? =false 时不参与同地块错峰 }
 */
export function enqueueFloatText(entry, options = {}) {
    if (_suppressed || !entry) return null;
    const state = options.gs || _defaultState();
    if (!state) return null;
    _ensureArrays(state);
    const kind = entry.kind || 'damage';
    const now = performance.now();
    let showAt = now + Math.max(0, entry.delayMs || 0);
    if (options.stagger !== false) {
        const key = _tileKey(entry);
        showAt = Math.max(showAt, _tileNextShowAt.get(key) || 0);
        _tileNextShowAt.set(key, showAt + FLOAT_TEXT_GAP_MS);
    }
    const finalDelay = Math.max(0, showAt - now);
    const record = _makeRecord(entry, kind);
    if (finalDelay <= 0) {
        _activeArray(state, kind).push({ ...record, lastUpdate: now });
    } else {
        state.floatTextPending.push({ ...record, showAt });
    }
    if (options.broadcast !== false && !_captureSuppressed) {
        if (!state._pendingFloatTexts) state._pendingFloatTexts = [];
        state._pendingFloatTexts.push({ ...record, delayMs: finalDelay });
        if (state._pendingFloatTexts.length > MAX_CAPTURE) state._pendingFloatTexts.shift();
    }
    return record;
}

/**
 * 远端重放：按 payload 条目原样入队（delayMs 照用、不再错峰、不再记录）。
 */
export function replayFloatTexts(entries, options = {}) {
    if (!Array.isArray(entries) || entries.length === 0) return;
    const state = options.gs || _defaultState();
    _ensureArrays(state);
    const now = performance.now();
    for (const entry of entries) {
        if (!entry) continue;
        const kind = entry.kind || 'damage';
        const record = { ...entry };
        const delayMs = Math.max(0, record.delayMs || 0);
        delete record.delayMs;
        if (delayMs <= 0) {
            _activeArray(state, kind).push({ ...record, lastUpdate: now });
        } else {
            state.floatTextPending.push({ ...record, showAt: now + delayMs });
        }
    }
}

/**
 * 渲染帧驱动：把到期的 pending 条目搬入活动数组。
 */
export function flushFloatTexts(now, gs = null) {
    const state = gs || _defaultState();
    if (!state) return;
    const pending = state.floatTextPending;
    if (!pending || pending.length === 0) return;
    _ensureArrays(state);
    for (let i = pending.length - 1; i >= 0; i--) {
        const entry = pending[i];
        if (entry.showAt > now) continue;
        pending.splice(i, 1);
        const record = { ...entry, lastUpdate: now };
        delete record.showAt;
        _activeArray(state, entry.kind || 'damage').push(record);
    }
}

/**
 * broadcastAction 时调用：取走并清空待广播的浮字条目。无条目时返回 null。
 */
export function drainPendingFloatTexts(gs = null) {
    const state = gs || _defaultState();
    const captured = state?._pendingFloatTexts;
    if (!captured || captured.length === 0) return null;
    state._pendingFloatTexts = [];
    return captured;
}

/**
 * 抑制开关：远端重放中重跑游戏逻辑的分支包裹使用。
 */
export function setFloatTextsSuppressed(flag) {
    _suppressed = !!flag;
}

/**
 * 捕获抑制：本地延迟弹着回调包裹使用——跳字照常显示，但不进 _pendingFloatTexts。
 * 远端在相同弹着时刻重跑同一结算自行推导这些跳字，两端保持对齐。
 */
export function setFloatTextCaptureSuppressed(flag) {
    _captureSuppressed = !!flag;
}

/**
 * 铁卫灵光改写：同步盟友头顶最新一条伤害数字（全部吸收则移除，部分吸收则改为
 * 实际承受值）。活动数组、pending 队列与待广播捕获副本三处同步改写，保证两端一致。
 */
export function adjustLatestDamageText(x, y, newValue, gs = null) {
    const state = gs || _defaultState();
    if (!state) return;
    const adjust = (arr, pendingKinded) => {
        if (!Array.isArray(arr)) return;
        for (let i = arr.length - 1; i >= 0; i--) {
            const t = arr[i];
            if (pendingKinded && (t.kind || 'damage') !== 'damage') continue;
            if (t.x !== x || t.y !== y) continue;
            if (newValue <= 0) arr.splice(i, 1);
            else t.value = Math.round(newValue);
            return;
        }
    };
    adjust(state.floatTextPending, true);
    adjust(state.damageTexts, false);
    adjust(state._pendingFloatTexts, true);
}
