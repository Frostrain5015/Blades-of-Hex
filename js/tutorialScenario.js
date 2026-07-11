// 训练场教程剧本 v2 — 残局演练：多兵种、地形克制、对策卡使用。
// 地图收束为一个可重复的战术脚本，模拟真实末期残局。
// 红军进攻蓝军城池，包含骑兵/炮兵协同、地形利用、对策卡使用。
import { CAMP, invalidateBoard } from './config.js';
import { gameState, logMessage } from './state.js';
import { Unit } from './Unit.js';
import { computeCampBorders, computeDistrictBorders } from './HexTile.js';

/*
  地图布局（双人标准图的中央偏左区域）：

          q
    -3   -2   -1    0    1
  +-----+----+----+----+----+
  | 弓  |    |    |    |    | r = 1
  +-----+----+----+----+----+
  | 山  |    | 森 |    |    | r = 0
  +-----+----+----+----+----+
  |    |    |    | 城 | 敌  | r = -1
  +-----+----+----+----+----+

  红军（玩家）：
    (q:-3, r:1) - 炮兵（跨弩手），位于山地，可展示山地射程加成
    (q:-2, r:0) - 狂战士（骑兵），已经受伤触发血怒，主控单位

  蓝军（AI）：
    (q:0, r:0)  - 百夫长（步兵），驻守中央城市，展示城市防御加成
    (q:1, r:-1) - 敌方骑兵，展示兵种识别与威胁评估

  教学流程步骤：
    选将 → 被动/兵种 → 对策卡引入 → 移动/地形 → 主动技能 → 攻击/占领 → 再次用卡 → 完成
*/

const TUTORIAL_COORDS = Object.freeze({
    berserker: { q: -2, r: 0 },
    archer:    { q: -3, r: 1 },
    forest:    { q: -1, r: 0 },
    mountain:  { q: -3, r: 0 },
    city:      { q: 0,  r: 0 },
    enemyCav:  { q: 1,  r: -1 }
});

function tileAt({ q, r }) {
    return gameState.tileMap.get(`${q},${r}`) || null;
}

function paintTile(tile, camp) {
    tile.camp = camp;
    tile.startColor = camp.color;
    tile.targetColor = camp.color;
    tile.currentColor = camp.color;
    tile.fadeStartTime = null;
}

/**
 * 部署教程战场：比 v1 更丰富的地形与兵种组合。
 * 红军带一名骑兵（狂战士）和一名远程（炮兵）；
 * 蓝军保留城市中的百夫长，新增一匹敌方骑兵用于教学识别。
 */
export function setupTutorialBattlefield() {
    // 按行政区重新分配阵营（district 1 = 红军, district 5 = 蓝军）
    for (const tile of gameState.tiles) {
        tile.unit = null;
        paintTile(tile, tile.districtId === 1 ? CAMP.player1 : tile.districtId === 5 ? CAMP.player2 : CAMP.neutral);
    }

    const bTile = tileAt(TUTORIAL_COORDS.berserker);
    const aTile = tileAt(TUTORIAL_COORDS.archer);
    const fTile = tileAt(TUTORIAL_COORDS.forest);
    const mTile = tileAt(TUTORIAL_COORDS.mountain);
    const cTile = tileAt(TUTORIAL_COORDS.city);
    const eTile = tileAt(TUTORIAL_COORDS.enemyCav);

    if (!bTile || !aTile || !fTile || !mTile || !cTile || !eTile) {
        throw new Error('Tutorial map v2 is missing a required scripted tile.');
    }

    // 显式设定教程关键地块的阵营归属（让红蓝边界更清晰）
    paintTile(bTile, CAMP.player1);   // 红军前哨
    paintTile(aTile, CAMP.player1);   // 红军后方
    paintTile(cTile, CAMP.player2);   // 蓝军城市
    paintTile(eTile, CAMP.player2);   // 蓝军阵地

    // 地形设定
    bTile.terrain = 'plains';
    aTile.terrain = 'mountain';   // 炮兵山地——展示高地射程加成
    fTile.terrain = 'forest';     // 森林——展示地形防御 + 骑兵行动力消耗
    mTile.terrain = 'mountain';
    cTile.terrain = 'plains';     // 城市本身不是地形，但 tile.isCity = true
    eTile.terrain = 'plains';

    // 确保城市标记
    cTile.isCity = true;

    // ---- 红军单位 ----
    const berserker = new Unit('cavalry', CAMP.player1, bTile, false, null, 'tutorial_berserker');
    berserker.hp = Math.max(1, Math.round(berserker.maxHp * 0.78));
    berserker.displayHp = berserker.hp;
    // 手动将 morale 恢复到 2（没有友方夹击/包围，且刚上场）
    berserker.morale = 2;

    const archer = new Unit('archer', CAMP.player1, aTile, false, null, 'tutorial_archer');
    archer.canAct = false; // 本回合已行动（展示兵种，不操作）
    archer.morale = 2;

    // ---- 蓝军单位 ----
    const centurion = new Unit('infantry', CAMP.player2, cTile, false, null, 'tutorial_centurion');
    centurion.hp = Math.max(1, Math.round(centurion.maxHp * 0.65));
    centurion.displayHp = centurion.hp;
    centurion.canAct = false; // 固守

    const enemyCav = new Unit('cavalry', CAMP.player2, eTile, false, null, 'tutorial_enemyCav');
    enemyCav.hp = 1; // 残血展示——可通过任何手段击杀
    enemyCav.displayHp = 1;
    enemyCav.canAct = false;

    // ---- 将领绑定（沿用教程 v1 的 berserker/centurion 指挥官 ID） ----
    gameState.commanderP1 = 'berserker';
    gameState.commanderP2 = 'centurion';
    gameState.commanderP1Confirmed = true;
    gameState.commanderP2Confirmed = true;
    gameState.commanderP1Deployed = true;
    gameState.commanderP2Deployed = true;

    // ---- 天气：雨天（展示骑兵额外行动力消耗 + 步兵城市防御加成） ----
    gameState.weather = 'rain';
    gameState.lastWeather = 'rain';

    // ---- 对策卡：预发一张疗愈到玩家手牌 ----
    gameState.playerHands.player1 = [{ id: 'heal', _tutorial: true }];

    // ---- 教程目标数据结构 ----
    gameState.tutorialTargets = {
        berserkerUnitId: berserker.id,
        archerUnitId: archer.id,
        centurionUnitId: centurion.id,
        enemyCavUnitId: enemyCav.id,
        move: { ...TUTORIAL_COORDS.forest },
        attack: { ...TUTORIAL_COORDS.city }
    };

    // 给玩家足够的金币用于演示（部分交互可能依赖金币检查）
    gameState.playerGold.player1 = 10;
    gameState.playerGold.player2 = 4;

    // ---- 边界缓存 ----
    gameState.campBorderEdges = computeCampBorders(gameState.tiles, gameState.tileMap);
    gameState.districtBorderEdges = computeDistrictBorders(gameState.tiles, gameState.tileMap);

    logMessage('教程剧本 v2 部署：夺下中央城市即可获胜。注意雨天对骑兵的影响！');
    invalidateBoard();
    return { berserker, archer, centurion, enemyCav, forestTile: fTile, cityTile: cTile };
}

/**
 * 教程专属蓝军脚本。当前剧本中百夫长坚守城市，骑兵待命；
 * 保留入口是为了以后扩展为多回合教程时仍能维持可预测的演出。
 */
export async function runTutorialOpponentScript() {
    if (!gameState.tutorialMode) return false;
    const targetId = gameState.tutorialTargets?.attack;
    const tile = targetId ? tileAt(targetId) : null;
    if (tile?.unit?.commander === 'centurion') {
        tile.unit.canAct = false;
        logMessage('百夫长正在固守中央城市。');
    }
    const eTile = tileAt(TUTORIAL_COORDS.enemyCav);
    if (eTile?.unit) {
        eTile.unit.canAct = false;
    }
    return true;
}
