// 关卡《雨幕下的孤城》建图 —— 固定可复现残局 + 反扑骑兵生成。
// 复用 js/tutorialScenario.js 的共享地图原语；训练教程与本关各自独立。
import { CAMP, invalidateBoard } from '../../../../js/config.js';
import { gameState, logMessage } from '../../../../js/state.js';
import { Unit } from '../../../../js/Unit.js';
import { computeCampBorders } from '../../../../js/HexTile.js';
import { setupTutorialBattlefield, TUTORIAL_COORDS, tileAt, paintTile } from '../../../../js/tutorialScenario.js';

/**
 * “雨幕下的孤城”使用完全可复现的固定残局。
 * 暂时复用标准六边形几何，但清除随机村庄/地形；后续地图编辑器可直接替换此构建入口。
 */
export function setupRainCityBattlefield() {
    const result = setupTutorialBattlefield();
    const fixedTerrain = new Map([
        [`${TUTORIAL_COORDS.archer.q},${TUTORIAL_COORDS.archer.r}`, 'mountain'],
        [`${TUTORIAL_COORDS.mountain.q},${TUTORIAL_COORDS.mountain.r}`, 'mountain'],
        [`${TUTORIAL_COORDS.forest.q},${TUTORIAL_COORDS.forest.r}`, 'forest']
    ]);
    for (const tile of gameState.tiles) {
        tile.terrain = fixedTerrain.get(`${tile.q},${tile.r}`) || 'plains';
        tile.isVillage = false;
        tile.villageDistrictId = null;
        tile.fortification = null;
    }
    gameState.villageTiles = new Map();

    // 反扑骑兵直到夺城演出才登场。
    const enemyTile = tileAt(TUTORIAL_COORDS.enemyCav);
    if (enemyTile) enemyTile.unit = null;
    gameState.tutorialTargets.enemyCavUnitId = null;
    logMessage('《我心如火》序章：雨幕下的孤城。黎明前夺取石桥，并守住它。');
    invalidateBoard();
    return result;
}

export function spawnRainCityCounterattack() {
    const tile = tileAt(TUTORIAL_COORDS.enemyCav);
    if (!tile || tile.unit) return null;
    paintTile(tile, CAMP.player2);
    const cavalry = new Unit('cavalry', CAMP.player2, tile, false, 'rain_city_counter_cavalry', null);
    cavalry.hp = Math.max(1, Math.round(cavalry.maxHp * 0.72));
    cavalry.displayHp = cavalry.hp;
    cavalry.canAct = true;
    cavalry.morale = 2;
    gameState.tutorialTargets.enemyCavUnitId = cavalry.id;
    gameState.campBorderEdges = computeCampBorders(gameState.tiles, gameState.tileMap);
    logMessage('东路蓝军骑兵收到信号，正向中央城市发起反扑！');
    invalidateBoard();
    return cavalry;
}
