const _syncOrbitBeams = (unit, helpers) => {
    if (!unit.tile || !helpers.spawnOrbitBeams) return;
    let count = unit._faith;
    if (unit._smiteReady) count += unit._smiteCharged ? 2 : 1;
    helpers.spawnOrbitBeams(unit.id, unit.tile.x, unit.tile.y, count);
};

export default {
    id: 'paladin',
    name: '圣骑士',
    hpBonus: 50,
    atkBonus: 15,
    spdBonus: 0,
    skills: [
        { name: '勇气灵光', desc: '自身及相邻6格友军攻击力+10%，士气不会下降或混乱', type: 'passive' },
        { name: '誓言', desc: '【勇气灵光】范围内的友军（包括自己）受击时获得1誓言（上限3），击杀时再获得1誓言。每层为圣骑士提供6.67%防御力', type: 'passive' },
        { name: '至圣斩', desc: '每次点击消耗1层誓言蓄力（1层30~45/2层80~100真实伤害），最多2层', type: 'active' }
    ],

    FAITH_MAX: 3,

    onDeploy(unit, gameState, helpers) {
        unit._faith = 1;
        _syncOrbitBeams(unit, helpers);
    },

    getDefenseBonus(unit) {
        return (unit._faith || 0) * 0.0667;
    },

    onKill(killer, victim, helpers) {
        if (killer._faith < 3) {
            killer._faith++;
            _syncOrbitBeams(killer, helpers);
        }
        return null;
    },

    onAllyDamage(victim, damage, paladinUnit, helpers) {
        if (paladinUnit._faith >= 3) return;
        paladinUnit._faith++;
        _syncOrbitBeams(paladinUnit, helpers);
        helpers.logMessage(`圣骑士【誓言】：目睹战友受创，誓言+1（${paladinUnit._faith}/3）`);
    },

    onAttack(attacker, target, dmg, helpers) {
        if (!attacker._smiteReady || dmg <= 0) return null;
        const charged = attacker._smiteCharged;
        const beamCount = charged ? 2 : 1;
        attacker._smiteReady = false;
        attacker._smiteCharged = false;
        const smiteDmg = charged
            ? (helpers.rng ? helpers.rng.between(80, 100) : 80 + Math.floor(Math.random() * 21))
            : (helpers.rng ? helpers.rng.between(30, 45) : 30 + Math.floor(Math.random() * 16));
        // 剑从环绕轨道飞向目标
        const paladinProjectileDatas = helpers.launchOrbitSwords
            ? helpers.launchOrbitSwords(attacker.id, target.tile.x, target.tile.y, beamCount)
            : [];
        // 至圣斩命中时金色光束从目标上方降落
        helpers.spawnGoldenBeam(target.tile.x, target.tile.y);
        // 剩余剑同步到当前誓言层数
        _syncOrbitBeams(attacker, helpers);
        helpers.logMessage(
            `圣骑士【至圣斩】：附加${smiteDmg}真实伤害` +
            `${charged ? '（蓄力翻倍）' : ''}`
        );
        return { smiteDmg, paladinProjectileDatas };
    },

    activeSkill: {
        name: '至圣斩',
        desc: '每次点击消耗1层誓言蓄力（1层30~45→再点→2层80~100），最多2层',
        duration: 0,
        cooldown: 0,

        onActivate(unit, helpers) {
            // 远端重放：状态已由序列化同步，仅重放对应特效
            if (unit._smiteCharged || (helpers.isReplay && unit._smiteReady)) {
                // 重放时不改变环绕剑数量（已被远端锁定）
                const label = unit._smiteCharged ? '至圣斩·誓约' : '至圣斩';
                helpers.spawnFx(unit.tile.x, unit.tile.y, '✝️', label);
                return true;
            }
            if (unit._faith < 1) {
                helpers.logMessage('誓言不足，无法蓄力至圣斩');
                return false;
            }
            // 每次点击消耗1层誓言（环绕剑数量暂时锁定，不在此同步）
            unit._faith -= 1;
            if (unit._smiteReady && !unit._smiteCharged) {
                // 已有1层，升级为至圣斩·誓约（2层80~100伤）
                unit._smiteCharged = true;
                helpers.spawnFx(unit.tile.x, unit.tile.y, '✝️', '至圣斩·誓约');
                helpers.logMessage(`圣骑士【至圣斩·誓约】：再消耗1誓言，下次攻击附加80~100真实伤害（${unit._faith}/3）`);
            } else {
                // 首次蓄力：至圣斩（1层30~45伤）
                unit._smiteReady = true;
                unit._smiteCharged = false;
                helpers.spawnFx(unit.tile.x, unit.tile.y, '✝️', '至圣斩');
                helpers.logMessage(`圣骑士【至圣斩】：消耗1誓言，下次攻击附加真实伤害（${unit._faith}/3）`);
            }
            return true;
        },

        onExpire(unit, helpers) {}
    }
};
