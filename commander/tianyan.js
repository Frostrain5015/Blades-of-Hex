// 天眼 —— 无人机指挥官
// 本体：HP+30% / ATK+0% / 移速+1，核心战力集中在无人机上。
import { CAMP, hexDistance, HEX_NEIGHBORS } from '../js/config.js';

export const DRONE_MAX_COUNT = 2;
export const DRONE_SIGNAL_RANGE = 5;
export const DRONE_DEPLOY_RANGE = 1;
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

function _setDroneSignalState(drone, disoriented, resetActive = false) {
    drone._disoriented = disoriented;
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
 * helpers 需包含 { gameState, Unit, logMessage, spawnFx }
 */
export function deployDrone(tianyanUnit, targetTile, helpers) {
    const gs = helpers.gameState;
    const campKey = _campToKey(tianyanUnit.camp);

    if (hexDistance(tianyanUnit.tile, targetTile) > DRONE_DEPLOY_RANGE) {
        helpers.logMessage('超出部署范围（1格）');
        return null;
    }
    if (!_isValidDeployTile(targetTile)) {
        helpers.logMessage('该格无法部署无人机');
        return null;
    }
    if ((gs.playerGold[campKey] || 0) < DRONE_DEPLOY_COST) {
        helpers.logMessage('金币不足，需要$5');
        return null;
    }

    const drones = _findDrones(gs, campKey);
    if (drones.length >= DRONE_MAX_COUNT) {
        drones.sort((a, b) => (a._droneBornAt || 0) - (b._droneBornAt || 0));
        const oldest = drones[0];
        if (oldest && oldest.tile) {
            helpers.logMessage('天眼：无人机超上限，销毁最旧无人机');
            oldest.hp = 0;
            oldest.destroy(null);
        }
    }

    gs.playerGold[campKey] -= DRONE_DEPLOY_COST;

    const UnitClass = helpers.Unit;
    const drone = new UnitClass('drone', tianyanUnit.camp, targetTile, false);
    drone._isDrone = true;
    drone._droneCampKey = campKey;
    drone._droneBornAt = performance.now();
    drone._disoriented = false;
    drone._droneSignalDisabled = false;
    drone.maxHp = DRONE_HP;
    drone.hp = DRONE_HP;
    drone.displayHp = DRONE_HP;
    drone._atkBonus = 0;
    drone.remainingMP = DRONE_MP;
    drone.displaySpeed = DRONE_MP;
    drone.canAct = true;
    drone.isNewRecruit = false;

    helpers.logMessage('天眼【天眼哨机】：部署无人机');
    if (helpers.spawnFx) helpers.spawnFx(targetTile.x, targetTile.y, '✈️', '天眼哨机');

    return drone;
}

export function canDeployDrone(tianyanUnit, gameState) {
    const campKey = _campToKey(tianyanUnit.camp);
    return (gameState.playerGold[campKey] || 0) >= DRONE_DEPLOY_COST;
}

export default {
    id: 'tianyan',
    name: '天眼',
    skill: '天眼哨机',
    hpBonusPct: 0.30, atkBonusPct: 0, spdBonus: 1,
    desc: '本体HP+30%、移速+1，攻击力无加成；核心战力为2架无人机。',
    skills: [
        { name: '天眼哨机', desc: '$5 在自身周围1格空地部署1架无人机（上限2架）；无人机MP8/射程2/行动力消耗2（无视地形），超过5格失控陷入混乱', type: 'active' },
        { name: '机枪射击', desc: '无人机普攻：对2格内单体造成空军伤害，走标准四大乘区；无人机单向克制步兵，其余兵种与无人机互不克制；主动攻击地面单位时对方无法反击', type: 'passive' },
        { name: '自爆', desc: '无人机消耗全部剩余行动力撞向3格内目标，主目标伤害=普攻3倍（受防空减免），对身后1格左右2个目标造成普攻1.5倍穿刺伤害，随后坠毁', type: 'active' }
    ],

    onDeploy(unit, gameState, helpers) {
        // 无需额外初始化，无人机在主动技能部署时创建
    },

    onTurnStart(gameState, camp, helpers) {
        refreshDroneSignal(gameState, camp, { resetActive: true });
    },

    activeSkill: {
        name: '天眼哨机',
        desc: '$5 在自身周围1格空地部署1架无人机（上限2架）',
        duration: 0,
        cooldown: 0,

        onActivate(unit, helpers) {
            const gs = helpers.gameState;
            const campKey = _campToKey(unit.camp);
            if ((gs.playerGold[campKey] || 0) < DRONE_DEPLOY_COST) {
                helpers.logMessage('金币不足，需要$5');
                return;
            }
            unit._pendingDroneDeploy = true;
            helpers.logMessage('天眼【天眼哨机】：请选择部署位置（周围1格空地）');
        },
        onExpire(unit, helpers) {}
    }
};
