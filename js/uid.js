// ==== 模块内唯一 ID 生成器 =====================
// 从 state.js 独立出来，避免 HexTile.js / Unit.js 与 state.js 之间的循环依赖

let idCounter = 0;

export function nextId() { return ++idCounter; }

export function getCounter() { return idCounter; }

export function setCounter(value) { idCounter = value; }