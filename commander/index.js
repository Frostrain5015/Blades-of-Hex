// 将领注册中心 —— 汇总所有将领，提供查询接口
import { COMMANDER_DRAFT } from '../rules/constants.js';
import advisor   from './advisor.js';
import ironGuard from './ironGuard.js';
import vampire   from './vampire.js';
import staller   from './staller.js';
import centurion from './centurion.js';
import minister  from './minister.js';
import martyr    from './martyr.js';

import berserker   from './berserker.js';
import fallenAngel from './fallenAngel.js';

import magician from './magician.js';
import paladin  from './paladin.js';
import priest   from './priest.js';
import astrologer from './astrologer.js';
import diplomat from './diplomat.js';
import necromancer from './necromancer.js';
import colonel from './colonel.js';
import tianyan from './tianyan.js';
import engineer from './engineer.js';

const allCommanders = {
  advisor,
  ironGuard,
  vampire,
  staller,
  centurion,
  minister,
  martyr,
  berserker,
  fallenAngel,
  magician,
  paladin,
  priest,
  astrologer,
  diplomat,
  necromancer,
  colonel,
  tianyan,
  engineer
};

export { allCommanders };

export function getCommander(id) {
  return allCommanders[id] || null;
}

export function shuffleAndSplitPool(isThreePlayer = false, commandersPerPlayer = COMMANDER_DRAFT.candidatesPerPlayer, rng) {
  if (!rng) throw new Error('Commander draft requires MatchState.rng');
  const keys = Object.keys(allCommanders);
  for (let i = keys.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  if (isThreePlayer) {
    // 三人模式：按每位玩家所需数量均分候选将领
    const pool = keys.slice(0, commandersPerPlayer * 3);
    return {
      p1: pool.slice(0, commandersPerPlayer),
      p2: pool.slice(commandersPerPlayer, commandersPerPlayer * 2),
      p3: pool.slice(commandersPerPlayer * 2, commandersPerPlayer * 3)
    };
  }
  // 双人模式：候选将领不重叠，均分给双方
  const pool = keys.slice(0, commandersPerPlayer * 2);
  const p1 = pool.slice(0, commandersPerPlayer);
  const p2 = pool.slice(commandersPerPlayer, commandersPerPlayer * 2);

  // 隐形限制：空军上校（colonel）和纵横家（diplomat）不可同时出现在同一玩家池中
  // 两将机制有根本冲突：合纵覆盖了上校的卡牌系统，会导致卡牌逻辑混乱
  function enforceNoColonelDiplomatConflict(a, b) {
    if (!a.includes('colonel') || !a.includes('diplomat')) return;
    // a 同时有上校和纵横家 → 把纵横家换到 b 中
    const swapFrom = b.find(c => c !== 'colonel' && c !== 'diplomat');
    if (swapFrom === undefined) return;
    const diplomatIdxA = a.indexOf('diplomat');
    const swapIdxB = b.indexOf(swapFrom);
    a[diplomatIdxA] = swapFrom;
    b[swapIdxB] = 'diplomat';
  }
  enforceNoColonelDiplomatConflict(p1, p2);
  enforceNoColonelDiplomatConflict(p2, p1);

  return { p1, p2 };
}
