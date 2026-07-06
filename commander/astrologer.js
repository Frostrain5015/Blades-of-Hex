// 占星者 —— 夜观 + 星移
// 被动：3格内友军免疫天气不利效果
// 主动：强制指定当前天气并锁定1回合（CD4）

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

export default {
    id: 'astrologer',
    name: '占星者',
    skill: '夜观',
    hpBonusPct: 0.30, atkBonusPct: 0.20, spdBonus: 0,
    desc: '3格内友军免疫天气不利效果；主动【星移】：强制指定天气并锁定1回合（⏳4）',
    tooltipDesc: '被动：3格内友军免疫天气不利；主动：指定天气锁定1回合（CD4）',
    skills: [
        { name: '夜观', desc: '3格内友军免疫天气不利效果（雨骑兵减速/风步兵减防/雾骑兵穿甲/风炮兵禁暴/雾炮兵减射程）', type: 'passive' },
        { name: '星移', desc: '强制指定当前天气并锁定1回合（⏳4）', type: 'active' }
    ],

    // 检查 tile 是否在友方占星者的3格星光范围内
    isInWeatherShield(tile, friendlyCamp, tileMap) {
        if (!tile || !tileMap) return false;
        for (let d = 0; d <= 3; d++) {
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

    // 主动技能：星移 — 弹出天气选择，锁定天气1回合
    activeSkill: {
        name: '星移',
        desc: '强制指定当前天气并锁定1回合（⏳4）',
        duration: 0,
        cooldown: 4,

        onActivate(unit, helpers) {
            // 远端重放：状态已由序列化同步
            if (unit._astrologerReplay) {
                unit._astrologerReplay = false;
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
