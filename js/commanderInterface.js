// 将领通用接口 —— 游戏主体通过此模块调用将领钩子
import { getCommander } from '../commander/index.js';
import { HEX_NEIGHBORS } from '../rules/hex.js';
import { campToKey } from '../rules/camps.js';
import stallerDef from '../commander/staller.js';
import { COMMANDER_CONFIG } from '../rules/commanders.js';
import { emit } from './eventBus.js';
import { areCommanderMechanicsSuppressed } from '../rules/movement.js';

// 延迟引用，由 main.js 初始化（避免循环依赖）
let _gameState = null;
let _logMessage = null;
let _spawnFx = null;
let _spawnGoldenBeam = null;
let _spawnOrbitBeams = null;
let _clearOrbitBeams = null;
let _spawnBeamProjectiles = null;
let _spawnHealingChain = null;

// 将领专属视觉特效延迟引用（由 main.js 通过 setter 注入；headless 下不注入即为 no-op）
let _spawnBloodDrain = null;
let _spawnGongxinRipple = null;
// 完整占城流程（gameLogic.updateDistrictColor，模块加载时注入，避免循环依赖）
let _captureCityRef = null;

export function setGameStateRef(fn) { _gameState = fn; }
export function setCityCaptureRef(fn) { _captureCityRef = fn; }
export function setLogMessageRef(fn) { _logMessage = fn; }
export function setSpawnFxRef(fn) { _spawnFx = fn; }
export function setSpawnGoldenBeamRef(fn) { _spawnGoldenBeam = fn; }
export function setSpawnOrbitBeamsRef(fn) { _spawnOrbitBeams = fn; }
export function setClearOrbitBeamsRef(fn) { _clearOrbitBeams = fn; }
export function setSpawnBeamProjectilesRef(fn) { _spawnBeamProjectiles = fn; }
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

function _commanderEnabled(unit) {
  return !!unit && !areCommanderMechanicsSuppressed(unit);
}

function _getCommanderIdForCamp(camp) {
  const gs = typeof _gameState === 'function' ? _gameState() : _gameState;
  if (!gs) return null;
  const key = campToKey(camp);
  const slot = key === 'player1' ? 'commanderP1' : key === 'player2' ? 'commanderP2' : key === 'player3' ? 'commanderP3' : null;
  if (slot && gs[slot]) return gs[slot];
  return gs.tiles.find(tile => tile.unit?.commander && campToKey(tile.unit.camp) === key)?.unit.commander || null;
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
    },
    spawnOrbitBeams: (unitId, x, y, count) => {
      if (_spawnOrbitBeams) _spawnOrbitBeams(unitId, x, y, count);
    },
    clearOrbitBeams: (unitId) => {
      if (_clearOrbitBeams) _clearOrbitBeams(unitId);
    },
    spawnBeamProjectiles: (fromX, fromY, toX, toY, count) => {
      if (_spawnBeamProjectiles) _spawnBeamProjectiles(fromX, fromY, toX, toY, count);
    },
    spawnHealingChain: (fromX, fromY, toX, toY) => {
      if (_spawnHealingChain) _spawnHealingChain(fromX, fromY, toX, toY);
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
    },
    spawnGongxinRipple: (x, y, intense = false) => {
      if (_spawnGongxinRipple) _spawnGongxinRipple(x, y, intense);
    },
  };
}

// ---- 回合钩子 ----

export function triggerCommanderTurnStart(gameState, camp) {
  const campKey = campToKey(camp);
  const seen = new Set();
  for (const tile of gameState.tiles) {
    if (!tile.unit || !tile.unit.commander || !_commanderEnabled(tile.unit)) continue;
    if (campToKey(tile.unit.camp) !== campKey) continue;
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
  const seen = new Set();
  for (const tile of gameState.tiles) {
    const cmdId = tile.unit?.commander;
    if (!cmdId || !_commanderEnabled(tile.unit) || campToKey(tile.unit.camp) !== campKey || seen.has(cmdId)) continue;
    seen.add(cmdId);
    const cmd = getCommander(cmdId);
    if (!cmd?.onTurnEnd) continue;
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
  if (!attacker.commander || !_commanderEnabled(attacker)) return null;
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
  if (!attacker.commander || !_commanderEnabled(attacker)) return null;
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
  if (!target.commander || !_commanderEnabled(target)) return null;
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
  if (!killer.commander || !_commanderEnabled(killer)) return null;
  const cmd = getCommander(killer.commander);
  if (cmd && cmd.onKill) {
    return cmd.onKill(killer, victim, _helpers(killer.commander));
  }
  return null;
}

// ---- 防御加成（铁卫等） ----

export function getCommanderDefenseBonus(unit) {
  if (!unit.commander || !_commanderEnabled(unit)) return 0;
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
    if (nb && nb.unit && nb.unit.commander === commanderId && _commanderEnabled(nb.unit) && nb.unit.camp === unit.camp) {
      return nb.unit;
    }
  }
  return null;
}

export function getCommanderAttackBonus(unit) {
  if (!unit.commander || !_commanderEnabled(unit)) return 0;
  const cmd = getCommander(unit.commander);
  if (cmd && cmd.getAttackBonus) return cmd.getAttackBonus(unit);
  return 0;
}

export function getCommanderAuraDefenseBonus(unit) {
  if (!unit.tile) return 0;
  const igCmd = getCommander('ironGuard');
  if (!igCmd || !igCmd.getAuraDefenseBonus) return 0;
  // 铁卫自身也受灵光保护
  if (unit.commander === 'ironGuard' && _commanderEnabled(unit) && unit._shield > 0) {
    return igCmd.getAuraDefenseBonus(unit);
  }
  // 相邻友军
  const tileMap = _gameState && (typeof _gameState === 'function' ? _gameState() : _gameState).tileMap;
  if (!tileMap) return 0;
  for (const [dq, dr] of HEX_NEIGHBORS) {
    const nb = tileMap.get(`${unit.tile.q + dq},${unit.tile.r + dr}`);
    if (nb && nb.unit && nb.unit.commander === 'ironGuard' && _commanderEnabled(nb.unit) && nb.unit.camp === unit.camp && nb.unit._shield > 0) {
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
  // 圣骑士勇气灵光已移至增伤乘区（getCommanderDamageBonusPct），此处不再返回攻击加成
  return 0;
}

// ---- 将领增伤加成（殉道者挽歌、堕天使黑形态、圣骑士勇气灵光等） ----
// 返回聚合的伤害加成百分比（②增伤乘区），含将领机制被抑制检查。

export function getCommanderDamageBonusPct(unit) {
  let total = 0;
  if (unit?.commander && _commanderEnabled(unit)) {
    const cmd = getCommander(unit.commander);
    if (cmd && cmd.getDamageBonusPct) {
      total += cmd.getDamageBonusPct(unit);
    }
  }
  // 圣骑士勇气灵光：自身或相邻6格友军获得伤害加成（无将领单位同样享受相邻灵光）
  if (unit?.tile) {
    const gs = typeof _gameState === 'function' ? _gameState() : _gameState;
    if (gs?.tileMap) {
      const auraBonus = COMMANDER_CONFIG.paladin.balance.auraDamageBonus || 0;
      // 自身是圣骑士
      if (unit.commander === 'paladin' && _commanderEnabled(unit)) {
        total += auraBonus;
      } else {
        // 相邻6格有圣骑士
        for (const [dq, dr] of HEX_NEIGHBORS) {
          const nb = gs.tileMap.get(`${unit.tile.q + dq},${unit.tile.r + dr}`);
          if (nb && nb.unit && nb.unit.commander === 'paladin' && _commanderEnabled(nb.unit) && nb.unit.camp === unit.camp) {
            total += auraBonus;
            break;
          }
        }
      }
    }
  }
  return total;
}

// ---- 友军受击钩子（圣骑士誓言等） ----

export function triggerCommanderAllyDamage(unit, actualDmg) {
  if (!unit.tile || actualDmg <= 0) return;
  const gs = typeof _gameState === 'function' ? _gameState() : _gameState;
  if (!gs || !gs.tileMap) return;
  const palCmd = getCommander('paladin');
  if (!palCmd || !palCmd.onAllyDamage) return;
  // 受击单位自身是圣骑士
  if (unit.commander === 'paladin' && _commanderEnabled(unit)) {
    palCmd.onAllyDamage(unit, actualDmg, unit, _helpers('paladin'));
    return;
  }
  // 受击单位相邻6格有圣骑士
  for (const [dq, dr] of HEX_NEIGHBORS) {
    const nb = gs.tileMap.get(`${unit.tile.q + dq},${unit.tile.r + dr}`);
    if (nb && nb.unit && nb.unit.commander === 'paladin' && _commanderEnabled(nb.unit) && nb.unit.camp === unit.camp) {
      palCmd.onAllyDamage(unit, actualDmg, nb.unit, _helpers('paladin'));
      return;
    }
  }
}

// ---- 伤害转移（铁卫灵光） ----

export function getCommanderAllyAuraDamage(ally, actualDmg, ironGuardUnit) {
  if (!_commanderEnabled(ironGuardUnit)) return actualDmg;
  const cmd = getCommander('ironGuard');
  if (cmd && cmd.onDamageTakenAlly) {
    return cmd.onDamageTakenAlly(ally, actualDmg, ironGuardUnit, _helpers('ironGuard'));
  }
  return actualDmg;
}

// ---- 必定暴击（保留接口，供将领扩展） ----

export function isCommanderGuaranteedCrit(unit) {
  if (!unit.commander || !_commanderEnabled(unit)) return false;
  const cmd = getCommander(unit.commander);
  if (cmd && cmd.guaranteesCrit) return cmd.guaranteesCrit(unit);
  return false;
}

// ---- 暴击率加成（堕天使黑形态 +60% 等）：并入③浮动乘区的暴击概率池 ----

export function getCommanderCritRateBonus(unit) {
  if (!unit.commander || !_commanderEnabled(unit)) return 0;
  const cmd = getCommander(unit.commander);
  if (cmd && cmd.getCritRateBonus) return cmd.getCritRateBonus(unit);
  return 0;
}

// ---- 士气变化钩子（堕天使等） ----

export function triggerCommanderOnMoraleChange(unit, oldMorale, newMorale) {
  if (!unit.commander || !_commanderEnabled(unit)) return;
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

// 夜观：3格星光范围内的天气对全部单位与地块一律视为晴天（不分敌我），
// 从源头断掉所有天气效果（无论利弊）。所有天气结算都应经此函数取有效天气，
// 不再直接读 gs.weather。camp 形参仅为兼容旧调用签名保留，语义上已不使用。
export function getEffectiveWeather(tile, camp, gs) {
  if (!gs || gs.weather === 'clear') return 'clear';
  if (getCommanderWeatherImmunity(tile, camp, gs.tileMap)) return 'clear';
  return gs.weather;
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
  // 若单位在城市上，同步更改城市归属
  if (unit.tile.isCity) {
    // 走完整占城流程（行政区易色/边界重算/标准图易帜奖励/城防联动/胜负判定），
    // 使谋士策反驻城守军与武力夺城享有一致的连锁效果。
    if (_captureCityRef) {
      _captureCityRef(unit.tile, newCamp, unit);
      return true;
    }
    // 降级路径（未注入完整流程时，如部分单测）：仅同步行政区地块归属
    if (tileList) {
      const districtId = unit.tile.districtId;
      for (const tile of tileList) {
        if (tile.districtId === districtId && tile.camp === oldCamp) {
          tile.setCampWithFade(newCamp);
        }
      }
    }
  }
  return true;
}

export { getCommander };
