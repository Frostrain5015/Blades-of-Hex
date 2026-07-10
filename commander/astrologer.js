import { getRoundIndex } from '../js/config.js';
import { COMMANDER_CONFIG } from '../js/gameData.js';
// 占星者 —— 夜观 + 星移
// 被动：3格内友军免疫天气不利效果
// 主动：强制指定当前天气并锁定2回合（CD4）

const HEX_NEIGHBORS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

const RANGE2 = (() => {
    const set = new Set(HEX_NEIGHBORS.map(([q, r]) => `${q},${r}`));
    for (const [q1, r1] of HEX_NEIGHBORS) {
        for (const [q2, r2] of HEX_NEIGHBORS) {
            const q = q1 + q2, r = r1 + r2;
            if (q === 0 && r === 0) continue;
            set.add(`${q},${r}`);
        }
    }
    return Array.from(set).map(s => s.split(',').map(Number));
})();

const RANGE3 = (() => {
    const set = new Set();
    // 三个邻接向量相加生成距离3的所有偏移
    for (const [q1, r1] of HEX_NEIGHBORS) {
        for (const [q2, r2] of HEX_NEIGHBORS) {
            for (const [q3, r3] of HEX_NEIGHBORS) {
                const q = q1 + q2 + q3, r = r1 + r2 + r3;
                if (q === 0 && r === 0) continue;
                // 仅保留距离恰好为3的偏移
                const dist = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
                if (dist === 3) set.add(`${q},${r}`);
            }
        }
    }
    return Array.from(set).map(s => s.split(',').map(Number));
})();

const RINGS = [[[0, 0]], HEX_NEIGHBORS, RANGE2, RANGE3];
const { definition: DEFINITION, balance: BALANCE } = COMMANDER_CONFIG.astrologer;

export default {
    ...DEFINITION,

    // 检查 tile 是否在友方占星者的3格星光范围内
    isInWeatherShield(tile, friendlyCamp, tileMap) {
        if (!tile || !tileMap) return false;
        for (let d = 0; d <= BALANCE.auraRange; d++) {
            for (const [dq, dr] of RINGS[d]) {
                const nb = tileMap.get(`${tile.q + dq},${tile.r + dr}`);
                if (nb && nb.unit && nb.unit.commander === 'astrologer' &&
                    nb.unit.camp === friendlyCamp && nb.unit.hp > 0) {
                    return true;
                }
            }
        }
        return false;
    },

    // 星移期间：检查 tile 是否在敌方占星者3格减益范围内
    isInDebuffZone(tile, camp, gs) {
        if (!tile || !gs || !gs.tileMap || !gs.weatherLockUntil) return false;
        if (getRoundIndex(gs) >= gs.weatherLockUntil) return false;
        const tileMap = gs.tileMap;
        for (let d = 0; d <= BALANCE.auraRange; d++) {
            for (const [dq, dr] of RINGS[d]) {
                const nb = tileMap.get(`${tile.q + dq},${tile.r + dr}`);
                if (nb && nb.unit && nb.unit.commander === 'astrologer' &&
                    nb.unit.camp !== camp && nb.unit.hp > 0) {
                    return true;
                }
            }
        }
        return false;
    },

    // 主动技能：星移 — 弹出天气选择，锁定天气1回合
    activeSkill: {
        ...DEFINITION.activeSkill,

        onActivate(unit, helpers) {
            // 远端重放：状态已由序列化同步，只补放特效（与 paladin 一致，用 helpers.isReplay）
            if (helpers.isReplay) {
                helpers.spawnFx(unit.tile.x, unit.tile.y, '⭐', '星移');
                return;
            }
            // 本地：设置天气选择回调（由 input.js 弹出选择界面后调用）
            unit._pendingWeatherChoice = true;
            helpers.logMessage('占星者【星移】：请选择天气（晴/雨/雾/风）');
        },

        onExpire(unit, helpers) {
            // 星移无持续时间，不触发 expire
        }
    }
};
