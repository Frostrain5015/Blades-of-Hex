// 依配置部署战场 —— 单位、将领绑定、天气、金币、初始手牌。
// 与建图分离：mapBuilder 先铺好地块，本模块在其上放单位并写对局参数。
import { campFromKey, getFactionKeys } from '../../rules/diplomacy.js';
import { configureMatchFactions } from '../../engine/matchState.js';
import { createDefaultMechanics } from '../../rules/mechanics.js';
import { Unit } from '../../js/Unit.js';
import { computeCampBorders } from '../../js/HexTile.js';
import { applyCommanderMount, resolveCommanderMount } from './storyCommanders.js';
import { canUnitOccupyTile } from '../../rules/movement.js';
import { isLandTile } from '../../rules/surfaces.js';

const COMMANDER_SLOTS = {
    player1: { id: 'commanderP1', confirmed: 'commanderP1Confirmed', deployed: 'commanderP1Deployed' },
    player2: { id: 'commanderP2', confirmed: 'commanderP2Confirmed', deployed: 'commanderP2Deployed' },
    player3: { id: 'commanderP3', confirmed: 'commanderP3Confirmed', deployed: 'commanderP3Deployed' }
};

/** 在建图前建立本关唯一的阵营对象、回合顺序和阵营相关容器。 */
export function prepareCampaignFactions(config, gameState) {
    configureMatchFactions(gameState, {
        factionDefinitions: config.factions || [],
        diplomacy: config.diplomacy || {},
        turnOrder: config.turnOrder || [],
        localPlayerCampKey: config.localPlayerCamp,
        defaultGold: 4
    });
    gameState.aiOpponentCamp = config.aiOpponentCamp ? campFromKey(config.aiOpponentCamp, gameState) : null;

    const keys = getFactionKeys(gameState);
    for (const key of keys) gameState.playerGold[key] = config.gold?.[key] ?? 4;
    gameState._prevVisibleTiles = Object.fromEntries(keys.map(key => [key, new Set()]));
    gameState._campaignFactionConfig = config;
}

/**
 * 依配置在已建好的棋盘上放置单位并写入对局参数。
 * @returns {{ unitIds: string[] }} 已放置单位的实际 id 列表（供触发器/结算引用）。
 */
export function buildBattlefieldFromConfig(config, gameState) {
    const placedIds = [];

    if (gameState._campaignFactionConfig !== config) prepareCampaignFactions(config, gameState);
    gameState.mechanics = createDefaultMechanics(config.mechanics || {});
    gameState.levelVariables = Object.fromEntries((config.variables || [])
        .filter(variable => variable.scope !== 'campaign')
        .map(variable => [variable.id, variable.initial ?? (variable.type === 'boolean' ? false : variable.type === 'string' ? '' : 0)]));
    gameState.objectiveStates = Object.fromEntries(Object.keys(config.objectives || {})
        .map(id => [id, (config.objectives[id]?.active !== false ? 'active' : (config.objectives[id]?.status || 'hidden'))]));
    gameState.interactionStates = Object.fromEntries((config.interactables || [])
        .map(item => [item.id, item.enabled === false ? 'disabled' : 'available']));

    // ── 天气（'cycle'=标准循环，从晴天开始）──
    gameState.weather = config.weather === 'cycle' ? 'clear' : (config.weather || 'clear');
    gameState.lastWeather = config.weather === 'cycle' ? null : gameState.weather;

    // ── 将领绑定（每阵营主将；标记为已确认/已部署，跳过选将阶段）──
    const commanders = config.commanders || {};
    gameState.doubleCommanderMode = false;
    gameState.commanderPhase = 'done';
    for (const camp of ['player1', 'player2', 'player3']) {
        const slot = COMMANDER_SLOTS[camp];
        const id = commanders[camp] || null;
        gameState[slot.id] = id;
        gameState[slot.confirmed] = !!id;
        gameState[slot.deployed] = !!id;
    }

    // ── 单位 ──
    for (const spec of (config.units || [])) {
        const tile = gameState.tileMap.get(`${spec.q},${spec.r}`);
        if (!tile) continue;                 // 越界或坐标无效，跳过
        if (tile.unit) continue;             // 该格已被占用
        if (!canUnitOccupyTile({ type: spec.type }, tile, gameState)) continue;
        const camp = campFromKey(spec.camp, gameState);
        const mount = resolveCommanderMount(config, spec);
        const unit = new Unit(
            spec.type,
            camp,
            tile,
            false,
            spec.id || null,                 // 用编辑器 id 作为单位 id，触发器据此引用
            mount.commander
        );
        applyCommanderMount(unit, mount);
        // 生命值：优先绝对 hp，其次 hpPct（1~100 百分比），默认满血。
        if (typeof spec.hp === 'number') {
            unit.hp = Math.max(1, Math.min(unit.maxHp, Math.round(spec.hp)));
        } else if (typeof spec.hpPct === 'number') {
            unit.hp = Math.max(1, Math.min(unit.maxHp, Math.round(unit.maxHp * spec.hpPct / 100)));
        }
        unit.displayHp = unit.hp;
        unit.morale = typeof spec.morale === 'number' ? spec.morale : 2;
        unit.canAct = spec.canAct !== false;  // 默认可行动
        placedIds.push(unit.id);

        // 若单位携带将领而该阵营未显式配置主将，用它补上（保证 HUD 与技能条正确）。
        const slot = COMMANDER_SLOTS[spec.camp];
        if (mount.commander && slot && !gameState[slot.id]) {
            gameState[slot.id] = mount.commander;
            gameState[slot.confirmed] = true;
            gameState[slot.deployed] = true;
        }
    }

    // ── 初始手牌 ──
    const hands = config.hands || {};
    for (const camp of getFactionKeys(gameState)) {
        const list = Array.isArray(hands[camp]) ? hands[camp] : [];
        gameState.playerHands[camp] = list.map(id => ({ id }));
    }

    // 放置单位后城市/村庄旗帜的归属可能变化，刷新阵营边界缓存。
    const landTiles = gameState.tiles.filter(isLandTile);
    const landTileMap = new Map(landTiles.map(tile => [`${tile.q},${tile.r}`, tile]));
    gameState.campBorderEdges = computeCampBorders(landTiles, landTileMap);

    return { unitIds: placedIds };
}
