// 将领通用接口 —— 游戏主体通过此模块调用将领钩子
import { getCommander } from '../commander/index.js';
import { HEX_NEIGHBORS } from '../rules/hex.js';
import { CAMP, campToKey } from '../rules/camps.js';
import stallerDef from '../commander/staller.js';
import { COMMANDER_CONFIG } from '../rules/commanders.js';
import { emit } from './eventBus.js';

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

// 将领专属视觉特效延迟引用（由 main.js 通过 setter 注入；headless 下不注入即为 no-op）
let _spawnBloodDrain = null;
let _spawnGongxinRipple = null;

export function setGameStateRef(fn) { _gameState = fn; }
export function setLogMessageRef(fn) { _logMessage = fn; }
export function setSpawnFxRef(fn) { _spawnFx = fn; }
export function setSpawnGoldenBeamRef(fn) { _spawnGoldenBeam = fn; }
export function setSpawnOrbitBeamsRef(fn) { _spawnOrbitBeams = fn; }
export function setClearOrbitBeamsRef(fn) { _clearOrbitBeams = fn; }
export function setSpawnBeamProjectilesRef(fn) { _spawnBeamProjectiles = fn; }
export function setLaunchOrbitSwordsRef(fn) { _launchOrbitSwords = fn; }
export function setSpawnHealingChainRef(fn) { _spawnHealingChain = fn; }
export function setSpawnBloodDrainRef(fn) { _spawnBloodDrain = fn; }
export function setSpawnGongxinRippleRef(fn) { _spawnGongxinRipple = fn; }

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
  if (gs.campaignMode) {
    return gs.tiles.find(tile => tile.unit?.commander && campToKey(tile.unit.camp) === campToKey(camp))?.unit.commander || null;
  }
  if (camp === CAMP.player1) return gs.commanderP1;
  if (camp === CAMP.player2) return gs.commanderP2;
  if (camp === CAMP.player3) return gs.commanderP3;
  return null;
}

function _helpers(cmdId) {
  const gs = typeof _gameState === 'function' ? _gameState() : _gameState;
  const cmd = cmdId ? getCommander(cmdId) : null;
  const label = cmd ? cmd.skill : '';
  return {
    gameState: gs,
    rng: gs ? gs.rng : null,
    logMessage: _logMessage || ((m) => console.log(m)),
    spawnFx: (x, y, glyph) => {
      if (_spawnFx) _spawnFx(x, y, glyph || '\u{1F3C5}', label);
      else emit('fx:commanderSkill', { x, y, glyph: glyph || '\u{1F3C5}', label });
    },
    spawnGoldenBeam: (x, y) => {
      if (_spawnGoldenBeam) _spawnGoldenBeam(x, y);
      else emit('fx:goldenBeam', { x, y });
    },
    spawnOrbitBeams: (unitId, x, y, count) => {
      if (_spawnOrbitBeams) _spawnOrbitBeams(unitId, x, y, count);
      else emit('fx:orbitBeams', { unitId, x, y, count });
    },
    clearOrbitBeams: (unitId) => {
      if (_clearOrbitBeams) _clearOrbitBeams(unitId);
      else emit('fx:clearOrbitBeams', { unitId });
    },
    spawnBeamProjectiles: (fromX, fromY, toX, toY, count) => {
      if (_spawnBeamProjectiles) _spawnBeamProjectiles(fromX, fromY, toX, toY, count);
      else emit('fx:beamProjectiles', { fromX, fromY, toX, toY, count });
    },
    launchOrbitSwords: (unitId, targetX, targetY, count) => {
      if (_launchOrbitSwords) return _launchOrbitSwords(unitId, targetX, targetY, count);
      emit('fx:launchOrbitSwords', { unitId, targetX, targetY, count });
      return [];
    },
    spawnHealingChain: (fromX, fromY, toX, toY) => {
      if (_spawnHealingChain) _spawnHealingChain(fromX, fromY, toX, toY);
      else emit('fx:healingChain', { fromX, fromY, toX, toY });
    },
    spawnExplosion: (x, y, color, count = 18) => {
      emit('fx:explosion', { x, y, color, count });
    },
    playSound: (soundName) => {
      emit('audio:play', { soundName });
    },
    spawnMoraleEffect: (unit) => {
      emit('fx:morale', { unit });
    },
    findCommanderUnit: _findCommanderUnit,
    changeUnitCamp,
    // 将领专属视觉特效（由 commander 自身 onAttack/onKill 等钩子调用）
    spawnBloodDrain: (toX, toY, fromX, fromY) => {
      if (_spawnBloodDrain) _spawnBloodDrain(toX, toY, fromX, fromY);
      else emit('fx:bloodDrain', { toX, toY, fromX, fromY });
    },
    spawnGongxinRipple: (x, y, intense = false) => {
      if (_spawnGongxinRipple) _spawnGongxinRipple(x, y, intense);
      else emit('fx:gongxinRipple', { x, y, intense });
    },
  };
}

// ---- 回合钩子 ----

export function triggerCommanderTurnStart(gameState, camp) {
  const campKey = campToKey(camp);
  const seen = new Set();
  for (const tile of gameState.tiles) {
    if (!tile.unit || !tile.unit.commander) continue;
    if (gameState.campaignMode && campToKey(tile.unit.camp) !== campKey) continue;
    const cid = tile.unit.commander;
    if (seen.has(cid)) continue;
    seen.add(cid);
    const cmd = getCommander(cid);
    if (cmd && cmd.onTurnStart) {
      const h = _helpers(cid);
      h.campKey = campKey;
      h.addGold = (amount) => { gameState.playerGold[campKey] += amount; };
      h.triggerCommanderOnKill = triggerCommanderOnKill;
      cmd.onTurnStart(gameState, camp, h);
    }
  }
}

export function triggerCommanderTurnEnd(gameState, camp, campKey) {
  if (gameState.campaignMode) {
    const seen = new Set();
    for (const tile of gameState.tiles) {
      const cmdId = tile.unit?.commander;
      if (!cmdId || campToKey(tile.unit.camp) !== campKey || seen.has(cmdId)) continue;
      seen.add(cmdId);
      const cmd = getCommander(cmdId);
      if (!cmd?.onTurnEnd) continue;
      const h = _helpers(cmdId);
      h.campKey = campKey;
      h.addGold = (amount) => { gameState.playerGold[campKey] += amount; };
      cmd.onTurnEnd(gameState, camp, h);
    }
    return;
  }
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

/** triggerCommanderOnAttack 的增强版，包含击杀状态，供 gameLogic 调用 */
export function triggerCommanderOnAttackEx(attacker, target, dmg, isCrit, isTargetDead) {
  if (!attacker.commander) return null;
  const cmd = getCommander(attacker.commander);
  if (cmd && cmd.onAttack) {
    const h = _helpers(attacker.commander);
    h.isCrit = isCrit;
    h.isTargetDead = isTargetDead;
    h.attackerType = attacker.type;
    h.targetTile = target.tile;
    h.attackerTile = attacker.tile;
    return cmd.onAttack(attacker, target, dmg, h);
  }
  return null;
}

export function triggerCommanderOnCounterAttack(attacker, target, dmg) {
  if (!target.commander) return null;
  const cmd = getCommander(target.commander);
  if (cmd && cmd.onCounterAttack) {
    const h = _helpers(target.commander);
    h.attackerType = target.type;
    h.targetTile = attacker.tile;
    h.attackerTile = target.tile;
    return cmd.onCounterAttack(attacker, target, dmg, h);
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
      return COMMANDER_CONFIG.paladin.balance.auraAttackBonus;
    }
  }
  if (unit.commander === 'paladin') return COMMANDER_CONFIG.paladin.balance.auraAttackBonus;
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

// ---- 必定暴击（保留接口，供将领扩展） ----

export function isCommanderGuaranteedCrit(unit) {
  if (!unit.commander) return false;
  const cmd = getCommander(unit.commander);
  if (cmd && cmd.guaranteesCrit) return cmd.guaranteesCrit(unit);
  return false;
}

// ---- 暴击率加成（堕天使黑形态 +60% 等）：并入③浮动乘区的暴击概率池 ----

export function getCommanderCritRateBonus(unit) {
  if (!unit.commander) return 0;
  const cmd = getCommander(unit.commander);
  if (cmd && cmd.getCritRateBonus) return cmd.getCritRateBonus(unit);
  return 0;
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

// ---- 停滞者迟滞力场 ----

export function getCommanderRangeReduction(tile, tileMap) {
  if (!tileMap) return 0;
  return stallerDef.getRangeReduction(tile, tileMap);
}

// ---- 占星者星光力场（天气免疫） ----

export function getCommanderWeatherImmunity(tile, camp, tileMap) {
  if (!tileMap) return false;
  const astrologerDef = getCommander('astrologer');
  if (!astrologerDef || !astrologerDef.isInWeatherShield) return false;
  return astrologerDef.isInWeatherShield(tile, camp, tileMap);
}

export function getCommanderWeatherDebuff(tile, camp, gs) {
  if (!gs) return false;
  const astrologerDef = getCommander('astrologer');
  if (!astrologerDef || !astrologerDef.isInDebuffZone) return false;
  return astrologerDef.isInDebuffZone(tile, camp, gs);
}

// 力场防御加成：友军在2格内停滞者力场中 → 对远程攻击+25%防御
// 注意：当前无调用点，实际生效路径是 Unit.js _resolveDamage 的内联判定，数值需与其保持一致
export function getCommanderFieldDefenseBonus(tile, friendlyCamp, tileMap) {
  if (!tileMap) return 0;
  return stallerDef.isInField(tile, friendlyCamp, tileMap) ? 0.25 : 0;
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
