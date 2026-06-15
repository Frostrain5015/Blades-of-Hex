// core/headless.js — 服务器权威化引擎引导。
//
// 在 Node 下加载与前端**完全相同**的模拟引擎(gameLogic/Unit/commander/...),
// 完成依赖注入(复刻 main.js:38-49 的逻辑必需部分),对外暴露权威模拟所需的
// 动作函数与状态序列化接口。effects/audio/renderer 在 dom-shim 下为 no-op;
// commanderInterface 的特效 ref 不设置时自带 no-op 回退,故此处只接逻辑必需 ref。
//
// 关键:dom-shim 必须最先 import,使其副作用先于引擎模块执行。

import './dom-shim.js';

import { gameState, logMessage, serializeState, deserializeState } from '../js/state.js';
import { setGameStateRef as setHexTileGameStateRef } from '../js/HexTile.js';
import { setLogMessageRef, setGameStateRef } from '../js/Unit.js';
import { setLogMessageRef as setCiLogRef, setGameStateRef as setCiGameRef } from '../js/commanderInterface.js';
import {
    initMap, moveUnit, attackUnit, recruitUnit, endTurn, executeTacticalCard, drawCard,
} from '../js/gameLogic.js';
import { HexTile } from '../js/HexTile.js';
import { Unit } from '../js/Unit.js';

let _wired = false;

// 安装依赖注入。幂等。
export function wireHeadlessEngine() {
    if (_wired) return;
    setHexTileGameStateRef(gameState);
    setLogMessageRef(logMessage);
    setGameStateRef(gameState);
    setCiLogRef(logMessage);
    setCiGameRef(() => gameState);
    // 特效相关 ref 故意不设置 → commanderInterface 走内置 no-op 回退。
    _wired = true;
}

// 引擎单例 + 动作面。服务器按房间“hydrate 单例 → 应用意图 → 重新序列化”。
export const engine = {
    gameState,
    initMap, moveUnit, attackUnit, recruitUnit, endTurn, executeTacticalCard, drawCard,
    serializeState, deserializeState,
    HexTile, Unit,
};

wireHeadlessEngine();
