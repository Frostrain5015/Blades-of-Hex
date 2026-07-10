// 天眼 —— 无人机指挥官
// 本体：HP+30% / ATK+15% / 移速+1，核心战力集中在无人机上。
import { CAMP, hexDistance, HEX_NEIGHBORS } from '../js/config.js';
import { emit } from '../js/eventBus.js';

export const DRONE_MAX_COUNT = 2;
export const DRONE_SIGNAL_RANGE = 5;
export const DRONE_DEPLOY_RANGE = 1;
export const DRONE_DEPLOY_LIMIT_PER_TURN = 1;
export const DRONE_DEPLOY_COST = 5;
export const DRONE_HP = 75;
export const DRONE_ATK = 30;
export const DRONE_MP = 8;
export const DRONE_RANGE = 2;
export const DRONE_SUICIDE_RANGE = 3;

function _campToKey(camp) {
    return camp === CAMP.player1 ? 'player1' : camp === CAMP.player2 ? 'player2' : camp === CAMP.player3 ? 'player3' : 'neutral';
}

export function _findTianyanUnit(gameState, camp) {
    for (const t of gameState.tiles) {
        if (t.unit && t.unit.commander === 'tianyan' && t.unit.camp === camp && t.unit.hp > 0) {
            return t.unit;
        }
    }
    return null;
}

export function _findDrones(gameState, campKey) {
    const drones = [];
    for (const t of gameState.tiles) {
        if (t.unit && t.unit._isDrone && t.unit._droneCampKey === campKey) {
            drones.push(t.unit);
        }
    }
    return drones;
}

function _isValidDeployTile(tile) {
    return tile && !tile.unit && !tile.isCity && tile.terrain !== 'mountain';
}

function _ensureDeployLimitState(gameState) {
    if (!gameState._droneDeployTurn) gameState._droneDeployTurn = {};
    if (!gameState._droneDeployCount) gameState._droneDeployCount = {};
}

function _getDeployCountThisTurn(gameState, campKey) {
    _ensureDeployLimitState(gameState);
    if (gameState._droneDeployTurn[campKey] !== gameState.turnCounter) {
        gameState._droneDeployTurn[campKey] = gameState.turnCounter;
        gameState._droneDeployCount[campKey] = 0;
    }
    return gameState._droneDeployCount[campKey] || 0;
}

function _markDroneDeployedThisTurn(gameState, campKey) {
    _ensureDeployLimitState(gameState);
    gameState._droneDeployTurn[campKey] = gameState.turnCounter;
    gameState._droneDeployCount[campKey] = _getDeployCountThisTurn(gameState, campKey) + 1;
}

export function resetDroneDeployLimit(gameState, camp) {
    const campKey = _campToKey(camp);
    _ensureDeployLimitState(gameState);
    gameState._droneDeployTurn[campKey] = gameState.turnCounter;
    gameState._droneDeployCount[campKey] = 0;
}

function _setDroneSignalState(drone, disoriented, resetActive = false) {
    drone.morale = disoriented ? 0 : 2;
    if (disoriented) {
        drone._droneSignalDisabled = true;
        drone.canAct = false;
        return;
    }

    const wasSignalDisabled = drone._droneSignalDisabled;
    drone._droneSignalDisabled = false;
    if (resetActive) {
        drone.remainingMP = DRONE_MP;
        drone.displaySpeed = DRONE_MP;
        drone.canAct = true;
    } else if (wasSignalDisabled && drone.remainingMP > 0) {
        drone.canAct = true;
    }
}

export function refreshDroneSignal(gameState, camp, options = {}) {
    const campKey = _campToKey(camp);
    const tianyan = _findTianyanUnit(gameState, camp);
    const drones = _findDrones(gameState, campKey);
    for (const drone of drones) {
        const disoriented = !tianyan || !tianyan.tile || !drone.tile || hexDistance(tianyan.tile, drone.tile) > DRONE_SIGNAL_RANGE;
        _setDroneSignalState(drone, disoriented, !disoriented && !!options.resetActive);
    }
}

export function isDroneInSignal(gameState, droneUnit) {
    if (!droneUnit || !droneUnit._isDrone || !droneUnit.tile) return false;
    const tianyan = _findTianyanUnit(gameState, droneUnit.camp);
    return !!(tianyan && tianyan.tile && hexDistance(tianyan.tile, droneUnit.tile) <= DRONE_SIGNAL_RANGE);
}

export function isTileInDroneSignal(gameState, camp, tile) {
    if (!tile) return false;
    const tianyan = _findTianyanUnit(gameState, camp);
    return !!(tianyan && tianyan.tile && hexDistance(tianyan.tile, tile) <= DRONE_SIGNAL_RANGE);
}

/**
 * 在目标地块部署一架无人机。由 input.js 在玩家选定目标后调用。
 * helpers 需包含 { gameState, Unit, logMessage }
 */
export function deployDrone(tianyanUnit, targetTile, helpers) {
    const gs = helpers.gameState;
    const campKey = _campToKey(tianyanUnit.camp);

    if (!_isValidDeployTile(targetTile || hexDistance(tianyanUnit.tile, targetTile) > DRONE_DEPLOY_RANGE)) {
        helpers.logMessage('该位置无法部署');
        return null;
    }
    if ((gs.playerGold[campKey] || 0) < DRONE_DEPLOY_COST) {
        helpers.logMessage('金币不足');
        return null;
    }
    if (_getDeployCountThisTurn(gs, campKey) >= DRONE_DEPLOY_LIMIT_PER_TURN) {
        helpers.logMessage('每回合最多部署1架天眼哨机');
        return null;
    }

    const drones = _findDrones(gs, campKey);
    if (drones.length >= DRONE_MAX_COUNT) {
        drones.sort((a, b) => (a._droneBornAt || 0) - (b._droneBornAt || 0));
        const oldest = drones[0];
        if (oldest && oldest.tile) {
            helpers.logMessage('天眼哨机数量超出上限 已自动销毁最旧无人机');
            oldest.hp = 0;
            oldest.destroy(null);
        }
    }

    gs.playerGold[campKey] -= DRONE_DEPLOY_COST;
    _markDroneDeployedThisTurn(gs, campKey);

    const UnitClass = helpers.Unit;
    const drone = new UnitClass('drone', tianyanUnit.camp, targetTile, false);
    drone._isDrone = true;
    drone._droneCampKey = campKey;
    drone._droneBornAt = performance.now();
    drone.morale = 2;
    drone._droneSignalDisabled = false;
    drone.maxHp = DRONE_HP;
    drone.hp = DRONE_HP;
    drone.displayHp = DRONE_HP;
    drone._atkBonus = 0;
    drone.remainingMP = DRONE_MP;
    drone.displaySpeed = DRONE_MP;
    drone.canAct = true;
    drone.isNewRecruit = false;

    helpers.logMessage('【天眼哨机】部署天眼哨机');
    emit('tianyan:droneDeploy', {
        x: targetTile.x,
        y: targetTile.y,
        q: targetTile.q,
        r: targetTile.r,
        unitId: drone.id,
        campKey
    });

    return drone;
}

export function canDeployDrone(tianyanUnit, gameState) {
    const campKey = _campToKey(tianyanUnit.camp);
    return (gameState.playerGold[campKey] || 0) >= DRONE_DEPLOY_COST
        && _getDeployCountThisTurn(gameState, campKey) < DRONE_DEPLOY_LIMIT_PER_TURN;
}

export default {
    id: 'tianyan',
    name: '天眼',
    hpBonusPct: 0.30, atkBonusPct: 0.15, spdBonus: 1,
    skills: [
        { name: '战场观测', desc: '遭遇战中自身视野+1；常驻显示5格无人机信号范围', type: 'passive' },
        { name: '天眼哨机', desc: '$5 在周围部署天眼哨机，每回合可部署1架，上限2架，哨机与天眼距离超过5格会失控', type: 'active' },
        { name: '自爆', desc: '立即撞向3格内指定目标自毁并造成穿刺伤害', type: 'active' }
    ],

    onDeploy(unit, gameState, helpers) {
        // 无需额外初始化，无人机在主动技能部署时创建
    },

    onTurnStart(gameState, camp, helpers) {
        resetDroneDeployLimit(gameState, camp);
        refreshDroneSignal(gameState, camp, { resetActive: true });
    },

    activeSkill: {
        name: '天眼哨机',
        desc: '$5 在周围1格空地部署天眼哨机，每回合最多部署1架，同时最多存在2架',
        duration: 0,
        cooldown: 0,

        onActivate(unit, helpers) {
            const gs = helpers.gameState;
            const campKey = _campToKey(unit.camp);
            if ((gs.playerGold[campKey] || 0) < DRONE_DEPLOY_COST) {
                helpers.logMessage('金币不足');
                return;
            }
            if (_getDeployCountThisTurn(gs, campKey) >= DRONE_DEPLOY_LIMIT_PER_TURN) {
                helpers.logMessage('每回合最多部署1架天眼哨机');
                return;
            }
            unit._pendingDroneDeploy = true;
            helpers.logMessage('【天眼哨机】：请选择部署位置');
        },
        onExpire(unit, helpers) {}
    }
};
