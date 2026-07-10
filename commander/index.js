// 将领注册中心 —— 汇总所有将领，提供查询接口
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

export function shuffleAndSplitPool(isThreePlayer = false, commandersPerPlayer = 3) {
  const keys = Object.keys(allCommanders);
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
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
  return {
    p1: pool.slice(0, commandersPerPlayer),
    p2: pool.slice(commandersPerPlayer, commandersPerPlayer * 2)
  };
}
