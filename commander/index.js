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
  colonel
};

export { allCommanders };

export function getCommander(id) {
  return allCommanders[id] || null;
}

export function shuffleAndSplitPool(isThreePlayer = false) {
  const keys = Object.keys(allCommanders);
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  if (isThreePlayer) {
    // 三人模式：12选9后均分，每人3选1
    const pool = keys.slice(0, 9);
    return {
      p1: pool.slice(0, 3),
      p2: pool.slice(3, 6),
      p3: pool.slice(6, 9)
    };
  }
  // 双人模式：12选6后对半分，每人3选1
  const pool = keys.slice(0, 6);
  return {
    p1: pool.slice(0, 3),
    p2: pool.slice(3, 6)
  };
}
