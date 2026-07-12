// 依配置部署战场 —— 单位、将领绑定、天气、金币、初始手牌。
// 与建图分离：mapBuilder 先铺好地块，本模块在其上放单位并写对局参数。
import { CAMP } from '../../rules/camps.js';
import { createDefaultDiplomacy, createDefaultFactions } from '../../rules/diplomacy.js';
import { createDefaultMechanics } from '../../rules/mechanics.js';
import { Unit } from '../../js/Unit.js';
import { computeCampBorders } from '../../js/HexTile.js';

function campFromKey(key) {
    if (key === 'player1') return CAMP.player1;
    if (key === 'player2') return CAMP.player2;
    if (key === 'player3') return CAMP.player3;
    return CAMP.neutral;
}

const COMMANDER_SLOTS = {
    player1: { id: 'commanderP1', confirmed: 'commanderP1Confirmed', deployed: 'commanderP1Deployed' },
    player2: { id: 'commanderP2', confirmed: 'commanderP2Confirmed', deployed: 'commanderP2Deployed' },
    player3: { id: 'commanderP3', confirmed: 'commanderP3Confirmed', deployed: 'commanderP3Deployed' }
};

/**
 * 依配置在已建好的棋盘上放置单位并写入对局参数。
 * @returns {{ unitIds: string[] }} 已放置单位的实际 id 列表（供触发器/结算引用）。
 */
export function buildBattlefieldFromConfig(config, gameState) {
    const placedIds = [];

    gameState.localPlayerCampKey = config.localPlayerCamp || 'player1';
    gameState.factions = createDefaultFactions(config.factions || []);
    gameState.diplomacy = createDefaultDiplomacy(config.diplomacy || {});
    gameState.mechanics = createDefaultMechanics(config.mechanics || {});
    gameState.levelVariables = Object.fromEntries((config.variables || [])
        .filter(variable => variable.scope !== 'campaign')
        .map(variable => [variable.id, variable.initial ?? (variable.type === 'boolean' ? false : variable.type === 'string' ? '' : 0)]));
    gameState.objectiveStates = Object.fromEntries(Object.keys(config.objectives || {})
        .map(id => [id, id === config.initialObjective ? 'active' : (config.objectives[id]?.status || 'hidden')]));
    gameState.interactionStates = Object.fromEntries((config.interactables || [])
        .map(item => [item.id, item.enabled === false ? 'disabled' : 'available']));

    // ── 天气 ──
    gameState.weather = config.weather || 'clear';
    gameState.lastWeather = gameState.weather;

    // ── 金币 ──
    const gold = config.gold || {};
    gameState.playerGold.player1 = gold.player1 ?? 4;
    gameState.playerGold.player2 = gold.player2 ?? 4;
    gameState.playerGold.player3 = gold.player3 ?? 4;

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
        const camp = campFromKey(spec.camp);
        const unit = new Unit(
            spec.type,
            camp,
            tile,
            false,
            spec.id || null,                 // 用编辑器 id 作为单位 id，触发器据此引用
            spec.commander || null
        );
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
        if (spec.commander && slot && !gameState[slot.id]) {
            gameState[slot.id] = spec.commander;
            gameState[slot.confirmed] = true;
            gameState[slot.deployed] = true;
        }
    }

    // ── 初始手牌 ──
    const hands = config.hands || {};
    for (const camp of ['player1', 'player2', 'player3']) {
        const list = Array.isArray(hands[camp]) ? hands[camp] : [];
        gameState.playerHands[camp] = list.map(id => ({ id }));
    }

    // 放置单位后城市/村庄旗帜的归属可能变化，刷新阵营边界缓存。
    gameState.campBorderEdges = computeCampBorders(gameState.tiles, gameState.tileMap);

    return { unitIds: placedIds };
}
