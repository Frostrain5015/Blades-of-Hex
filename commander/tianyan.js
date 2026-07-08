// 天眼 —— 无人机指挥官
import { CAMP, hexDistance } from '../js/config.js';

export default {
    id: 'tianyan',
    name: '天眼',
    skill: '无人机舱',
    hpBonusPct: 0, atkBonusPct: 0, spdBonus: 0,
    skills: [
        { name: '无人机舱', desc: '$5 在自身周围2格空地部署1架无人机（上限2架），无人机50HP/25ATK/8MP，每步消耗2（无视地形），距离天眼超过5格时失控', type: 'active' },
    ],

    onDeploy(unit, gameState, helpers) {
        unit._tianyanDeployed = true;
    },

    onTurnStart(gameState, camp, helpers) {
        const unit = helpers.findCommanderUnit(camp, 'tianyan');
        if (!unit || !unit.tile || unit.hp <= 0) return;
        for (const tile of gameState.tiles) {
            if (!tile.unit || !tile.unit._isDrone) continue;
            const dist = hexDistance(unit.tile, tile);
            tile.unit._disoriented = dist > 5;
            if (!tile.unit._disoriented) {
                tile.unit.remainingMP = 8;
                tile.unit.canAct = true;
            }
        }
    },

    activeSkill: {
        name: '无人机舱',
        desc: '$5 在自身周围2格空地部署1架无人机（上限2架）',
        duration: 0,
        cooldown: 0,

        onActivate(unit, helpers) {
            const gs = helpers.gameState;
            const ck = unit.camp === CAMP.player1 ? 'player1' : unit.camp === CAMP.player2 ? 'player2' : 'player3';
            let n = 0;
            for (const t of gs.tiles) {
                if (t.unit && t.unit._isDrone && t.unit._droneCampKey === ck) n++;
            }
            if (n >= 2) { helpers.logMessage('无人机已达上限（2架）'); return; }
            if ((gs.playerGold[ck] || 0) < 5) { helpers.logMessage('金币不足，需要$5'); return; }
            gs.playerGold[ck] -= 5;
            unit._pendingDroneDeploy = true;
            helpers.logMessage('天眼【无人机舱】：请选择部署位置（周围2格空地）');
        },
        onExpire(unit, helpers) {}
    }
};
