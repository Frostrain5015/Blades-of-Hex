// 将领通用接口 —— 游戏主体通过此模块调用将领钩子
import { getCommander } from '../commander/index.js';
import { HEX_NEIGHBORS, CAMP } from './config.js';
import stallerDef from '../commander/staller.js';
import { spawnExplosionParticles } from './effects.js';

// 延迟引用，由 main.js 初始化（避免循环依赖）
let _gameState = null;
let _logMessage = null;
let _spawnFx = null;
let _spawnGoldenBeam = null;
let _spawnOrbitBeams = null;
let _clearOrbitBeams = null;
let _spawnBeamProjectiles = null;
let _launchOrbitSwords = null;
let _spawnHealingChain = null;

export function setGameStateRef(fn) { _gameState = fn; }
export function setLogMessageRef(fn) { _logMessage = fn; }
export function setSpawnFxRef(fn) { _spawnFx = fn; }
export function setSpawnGoldenBeamRef(fn) { _spawnGoldenBeam = fn; }
export function setSpawnOrbitBeamsRef(fn) { _spawnOrbitBeams = fn; }
export function setClearOrbitBeamsRef(fn) { _clearOrbitBeams = fn; }
export function setSpawnBeamProjectilesRef(fn) { _spawnBeamProjectiles = fn; }
export function setLaunchOrbitSwordsRef(fn) { _launchOrbitSwords = fn; }
export function setSpawnHealingChainRef(fn) { _spawnHealingChain = fn; }

// ---- 内部辅助 ----

function _findCommanderUnit(camp, commanderId) {
  const gs = typeof _gameState === 'function' ? _gameState() : _gameState;
  if (!gs) return null;
  for (const tile of gs.tiles) {
    if (tile.unit && tile.unit.commander === commanderId && tile.unit.camp === camp) {
      return tile.unit;
    }
  }
  return null;
}

function _getCommanderIdForCamp(camp) {
  const gs = typeof _gameState === 'function' ? _gameState() : _gameState;
  if (!gs) return null;
  if (camp === CAMP.player1) return gs.commanderP1;
  if (camp === CAMP.player2) return gs.commanderP2;
  return null;
}

function _helpers(cmdId) {
  const gs = typeof _gameState === 'function' ? _gameState() : _gameState;
  const cmd = cmdId ? getCommander(cmdId) : null;
  const label = cmd ? cmd.skill : '';
  return {
    gameState: gs,
    logMessage: _logMessage || ((m) => console.log(m)),
    spawnFx: (x, y, glyph) => {
      const fn = _spawnFx || ((x, y, g, l) => {});
      fn(x, y, glyph || '\u{1F3C5}', label);
    },
    spawnGoldenBeam: (x, y) => {
      const fn = _spawnGoldenBeam || ((a, b) => {});
      fn(x, y);
    },
    spawnOrbitBeams: (unitId, x, y, count) => {
      const fn = _spawnOrbitBeams || ((uid, px, py, c) => {});
      fn(unitId, x, y, count);
    },
    clearOrbitBeams: (unitId) => {
      const fn = _clearOrbitBeams || ((uid) => {});
      fn(unitId);
    },
    spawnBeamProjectiles: (fromX, fromY, toX, toY, count) => {
      const fn = _spawnBeamProjectiles || ((fx, fy, tx, ty, c) => {});
      fn(fromX, fromY, toX, toY, count);
    },
    launchOrbitSwords: (unitId, targetX, targetY, count) => {
      const fn = _launchOrbitSwords || ((uid, tx, ty, c) => []);
      return fn(unitId, targetX, targetY, count);
    },
    spawnHealingChain: (fromX, fromY, toX, toY) => {
      const fn = _spawnHealingChain || ((fx, fy, tx, ty) => {});
      fn(fromX, fromY, toX, toY);
    },
    spawnExplosion: (x, y, color, count = 18) => {
      spawnExplosionParticles(x, y, color, count);
    },
    findCommanderUnit: _findCommanderUnit,
    changeUnitCamp
  };
}

// ---- 回合钩子 ----

export function triggerCommanderTurnStart(gameState, camp) {
  const campKey = camp === CAMP.player1 ? 'player1' : camp === CAMP.player2 ? 'player2' : camp === CAMP.player3 ? 'player3' : 'neutral';
  const seen = new Set();
  for (const tile of gameState.tiles) {
    if (!tile.unit || !tile.unit.commander) continue;
    const cid = tile.unit.commander;
    if (seen.has(cid)) continue;
    seen.add(cid);
    const cmd = getCommander(cid);
    if (cmd && cmd.onTurnStart) {
      const h = _helpers(cid);
      h.campKey = campKey;
      h.addGold = (amount) => { gameState.playerGold[campKey] += amount; };
      cmd.onTurnStart(gameState, camp, h);
    }
  }
}

export function triggerCommanderTurnEnd(gameState, camp, campKey) {
  const cmdId = _getCommanderIdForCamp(camp);
  if (!cmdId) return;
  const cmd = getCommander(cmdId);
  if (cmd && cmd.onTurnEnd) {
    const h = _helpers(cmdId);
    h.campKey = campKey;
    h.addGold = (amount) => { gameState.playerGold[campKey] += amount; };
    cmd.onTurnEnd(gameState, camp, h);
  }
}

// ---- 招募费用 ----

export function getCommanderRecruitCost(baseCost, gameState, camp) {
  const cmdId = _getCommanderIdForCamp(camp);
  if (!cmdId) return baseCost;
  const cmd = getCommander(cmdId);
  if (cmd && cmd.getRecruitCost) {
    return cmd.getRecruitCost(baseCost, gameState, camp, _helpers(cmdId));
  }
  return baseCost;
}

// ---- 攻击钩子 ----

export function triggerCommanderOnAttack(attacker, target, dmg, isCrit = false) {
  if (!attacker.commander) return null;
  const cmd = getCommander(attacker.commander);
  if (cmd && cmd.onAttack) {
    const h = _helpers(attacker.commander);
    h.isCrit = isCrit;
    return cmd.onAttack(attacker, target, dmg, h);
  }
  return null;
}

export function triggerCommanderOnCounterAttack(attacker, target, dmg) {
  if (!target.commander) return null;
  const cmd = getCommander(target.commander);
  if (cmd && cmd.onCounterAttack) {
    return cmd.onCounterAttack(attacker, target, dmg, _helpers(target.commander));
  }
  return null;
}

// ---- 击杀钩子 ----

export function triggerCommanderOnKill(killer, victim) {
  if (!killer.commander) return null;
  const cmd = getCommander(killer.commander);
  if (cmd && cmd.onKill) {
    return cmd.onKill(killer, victim, _helpers(killer.commander));
  }
  return null;
}

// ---- 防御加成（铁卫等） ----

export function getCommanderDefenseBonus(unit) {
  if (!unit.commander) return 0;
  const cmd = getCommander(unit.commander);
  if (cmd && cmd.getDefenseBonus) {
    return cmd.getDefenseBonus(unit);
  }
  return 0;
}

// ---- 攻击加成（堕天使等） ----

export function findAdjacentCommander(unit, commanderId) {
  if (!unit || !unit.tile) return null;
  const gs = typeof _gameState === 'function' ? _gameState() : _gameState;
  if (!gs || !gs.tileMap) return null;
  for (const [dq, dr] of HEX_NEIGHBORS) {
    const nb = gs.tileMap.get(`${unit.tile.q + dq},${unit.tile.r + dr}`);
    if (nb && nb.unit && nb.unit.commander === commanderId && nb.unit.camp === unit.camp) {
      return nb.unit;
    }
  }
  return null;
}

export function getCommanderAttackBonus(unit) {
  if (!unit.commander) return 0;
  const cmd = getCommander(unit.commander);
  if (cmd && cmd.getAttackBonus) return cmd.getAttackBonus(unit);
  return 0;
}

export function getCommanderAuraDefenseBonus(unit) {
  if (!unit.tile) return 0;
  const igCmd = getCommander('ironGuard');
  if (!igCmd || !igCmd.getAuraDefenseBonus) return 0;
  // 铁卫自身也受灵光保护
  if (unit.commander === 'ironGuard' && unit._shield > 0) {
    return igCmd.getAuraDefenseBonus(unit);
  }
  // 相邻友军
  const tileMap = _gameState && (typeof _gameState === 'function' ? _gameState() : _gameState).tileMap;
  if (!tileMap) return 0;
  for (const [dq, dr] of HEX_NEIGHBORS) {
    const nb = tileMap.get(`${unit.tile.q + dq},${unit.tile.r + dr}`);
    if (nb && nb.unit && nb.unit.commander === 'ironGuard' && nb.unit.camp === unit.camp && nb.unit._shield > 0) {
      return igCmd.getAuraDefenseBonus(unit);
    }
  }
  return 0;
}

// ---- 攻击灵光（圣骑士等） ----

export function getCommanderAuraAttackBonus(unit) {
  if (!unit.tile) return 0;
  const gs = typeof _gameState === 'function' ? _gameState() : _gameState;
  if (!gs || !gs.tileMap) return 0;
  for (const [dq, dr] of HEX_NEIGHBORS) {
    const nb = gs.tileMap.get(`${unit.tile.q + dq},${unit.tile.r + dr}`);
    if (nb && nb.unit && nb.unit.commander === 'paladin' && nb.unit.camp === unit.camp) {
      return 0.10;
    }
  }
  if (unit.commander === 'paladin') return 0.10;
  return 0;
}

// ---- 友军受击钩子（圣骑士誓言等） ----

export function triggerCommanderAllyDamage(unit, actualDmg) {
  if (!unit.tile || actualDmg <= 0) return;
  const gs = typeof _gameState === 'function' ? _gameState() : _gameState;
  if (!gs || !gs.tileMap) return;
  const palCmd = getCommander('paladin');
  if (!palCmd || !palCmd.onAllyDamage) return;
  // 受击单位自身是圣骑士
  if (unit.commander === 'paladin') {
    palCmd.onAllyDamage(unit, actualDmg, unit, _helpers('paladin'));
    return;
  }
  // 受击单位相邻6格有圣骑士
  for (const [dq, dr] of HEX_NEIGHBORS) {
    const nb = gs.tileMap.get(`${unit.tile.q + dq},${unit.tile.r + dr}`);
    if (nb && nb.unit && nb.unit.commander === 'paladin' && nb.unit.camp === unit.camp) {
      palCmd.onAllyDamage(unit, actualDmg, nb.unit, _helpers('paladin'));
      return;
    }
  }
}

// ---- 伤害转移（铁卫灵光） ----

export function getCommanderAllyAuraDamage(ally, actualDmg, ironGuardUnit) {
  const cmd = getCommander('ironGuard');
  if (cmd && cmd.onDamageTakenAlly) {
    return cmd.onDamageTakenAlly(ally, actualDmg, ironGuardUnit, _helpers('ironGuard'));
  }
  return actualDmg;
}

// ---- 必定暴击（堕天使黑形态等） ----

export function isCommanderGuaranteedCrit(unit) {
  if (!unit.commander) return false;
  const cmd = getCommander(unit.commander);
  if (cmd && cmd.guaranteesCrit) return cmd.guaranteesCrit(unit);
  return false;
}

// ---- 士气变化钩子（堕天使等） ----

export function triggerCommanderOnMoraleChange(unit, oldMorale, newMorale) {
  if (!unit.commander) return;
  const cmd = getCommander(unit.commander);
  if (cmd && cmd.onMoraleChange) {
    cmd.onMoraleChange(unit, oldMorale, newMorale, _helpers(unit.commander));
  }
}

// ---- 停滞者缚足 ----

export function getStallerSnareLayers(tile, friendlyCamp, tileMap) {
  if (!tileMap) return 0;
  return stallerDef.getSnareLayers(tile, friendlyCamp, tileMap);
}

function isInStallerZone(tile, friendlyCamp, tileMap) {
  return getStallerSnareLayers(tile, friendlyCamp, tileMap) > 0;
}

// ---- 通用：改变单位阵营（感化/招降，供将领钩子调用） ----
export function changeUnitCamp(unit, newCamp, tileList) {
  if (!unit || !unit.tile) return false;
  const oldCamp = unit.camp;
  if (oldCamp === newCamp) return false;
  unit.camp = newCamp;
  // 若单位在城市上，同步更改城市及整个行政区归属
  if (unit.tile.isCity && tileList) {
    const districtId = unit.tile.districtId;
    for (const tile of tileList) {
      if (tile.districtId === districtId && tile.camp === oldCamp) {
        tile.setCampWithFade(newCamp);
      }
    }
  }
  return true;
}

export { getCommander };
