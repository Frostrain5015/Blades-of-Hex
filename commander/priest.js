const HEX_NEIGHBORS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

export default {
    id: 'priest',
    name: '牧师',
    hpBonus: 60,
    atkBonus: 0,
    spdBonus: 0,
    skills: [
        { name: '圣疗', desc: '每回合链式群体治疗：1段瞄准相邻友方回复10%HP，2段传导2格内友方回复5%HP', type: 'passive' },
        { name: '祈祷', desc: '消耗50%当前HP，为2格范围友军附加【治愈灵光】（立即35%+每回合15%HP，⏱2 ⏳5）；灵光单位受致命一击时提前释放全部剩余治疗，仍不足则保底20%生命并消耗灵光', type: 'active' }
    ],

    onTurnEnd(gameState, camp, helpers) {
        const unit = helpers.findCommanderUnit(camp, 'priest');
        if (!unit || !unit.tile) return;
        const tileMap = gameState.tileMap;

        // 第一段：相邻6格（含自身），HP%最低
        let firstTarget = null, lowestRatio = 1;
        const scan1 = [unit];
        for (const [dq, dr] of HEX_NEIGHBORS) {
            const nb = tileMap.get(`${unit.tile.q + dq},${unit.tile.r + dr}`);
            if (nb && nb.unit && nb.unit.camp === camp && nb.unit.hp < nb.unit.maxHp) {
                scan1.push(nb.unit);
            }
        }
        for (const ally of scan1) {
            const ratio = ally.hp / ally.maxHp;
            if (ratio < lowestRatio) { lowestRatio = ratio; firstTarget = ally; }
        }
        if (firstTarget) {
            const heal1 = Math.round(firstTarget.maxHp * 0.10);
            firstTarget.heal(heal1);
            helpers.spawnHealingChain(unit.tile.x, unit.tile.y, firstTarget.tile.x, firstTarget.tile.y);
            helpers.logMessage(`牧师【圣链·一段】治疗${firstTarget.config.name}兵 +${heal1}HP`);

            // 第二段：以firstTarget为中心，2格内HP%次低
            const range2 = new Set();
            for (const [dq, dr] of HEX_NEIGHBORS) {
                const nb = tileMap.get(`${firstTarget.tile.q + dq},${firstTarget.tile.r + dr}`);
                if (nb && nb.unit && nb.unit.camp === camp && nb.unit !== firstTarget && nb.unit.hp < nb.unit.maxHp) {
                    range2.add(nb.unit);
                }
                for (const [dq2, dr2] of HEX_NEIGHBORS) {
                    const nb2 = tileMap.get(`${firstTarget.tile.q + dq + dq2},${firstTarget.tile.r + dr + dr2}`);
                    if (nb2 && nb2.unit && nb2.unit.camp === camp && nb2.unit !== firstTarget && nb2.unit.hp < nb2.unit.maxHp) {
                        range2.add(nb2.unit);
                    }
                }
            }
            let secondTarget = null, secondLowest = 1;
            for (const ally of range2) {
                const ratio = ally.hp / ally.maxHp;
                if (ratio < secondLowest) { secondLowest = ratio; secondTarget = ally; }
            }
            if (secondTarget) {
                const heal2 = Math.round(secondTarget.maxHp * 0.05);
                secondTarget.heal(heal2);
                helpers.spawnHealingChain(firstTarget.tile.x, firstTarget.tile.y, secondTarget.tile.x, secondTarget.tile.y);
                helpers.logMessage(`牧师【圣链·传导】治疗${secondTarget.config.name}兵 +${heal2}HP`);
            }
        }
    },

    activeSkill: {
        name: '祈祷',
        desc: '消耗50%当前HP，为2格范围友军附加【治愈灵光】（立即35%HP+每回合15%HP）；灵光单位受致命一击时提前迸发剩余治疗，仍不足则保底20%生命',
        duration: 0,
        cooldown: 5,

        onActivate(unit, helpers) {
            // 远端重放保护：状态已由序列化同步，仅重放特效
            if (unit._healingAura > 0) {
                helpers.spawnFx(unit.tile.x, unit.tile.y, '\u{1F54A}\u{FE0F}', '祈祷');
                return;
            }
            const cost = Math.max(1, Math.ceil(unit.hp * 0.5));
            unit.hp = Math.max(1, unit.hp - cost);
            unit.displayHp = unit.hp;
            unit._healingAura = 2;
            const tileMap = helpers.gameState.tileMap;

            const healed = [];
            // 2格范围：距离1（6格）+ 距离2（12格）
            for (let dq = -2; dq <= 2; dq++) {
                for (let dr = Math.max(-2, -dq - 2); dr <= Math.min(2, -dq + 2); dr++) {
                    if (dq === 0 && dr === 0) continue; // 跳过牧师自身
                    const nb = tileMap.get(`${unit.tile.q + dq},${unit.tile.r + dr}`);
                    if (nb && nb.unit && nb.unit.camp === unit.camp) {
                        const healAmt = Math.ceil(nb.unit.maxHp * 0.35);
                        nb.unit.heal(healAmt);
                        nb.unit._healingAura = 2;
                        healed.push(nb.unit.config.name);
                    }
                }
            }

            helpers.spawnFx(unit.tile.x, unit.tile.y, '\u{1F54A}\u{FE0F}', '祈祷');
            helpers.logMessage(
                `牧师【祈祷】消耗${cost}HP，为${healed.length}单位附加治愈灵光：${healed.join('、')}兵`
            );
        },

        onExpire(unit, helpers) {}
    }
};
