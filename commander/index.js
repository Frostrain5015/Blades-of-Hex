// 将领注册中心 —— 汇总所有将领，提供查询接口
import advisor   from './advisor.js';
import ironGuard from './ironGuard.js';
import vampire   from './vampire.js';
import staller   from './staller.js';
import centurion from './centurion.js';
import minister  from './minister.js';

const allCommanders = {
  advisor,
  ironGuard,
  vampire,
  staller,
  centurion,
  minister
};

export { allCommanders };

export function getCommander(id) {
  return allCommanders[id] || null;
}

export function getAllCommanderIds() {
  return Object.keys(allCommanders);
}

export function shuffleAndSplitPool() {
  const keys = Object.keys(allCommanders);
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  return {
    p1: keys.slice(0, 3),
    p2: keys.slice(3, 6)
  };
}
