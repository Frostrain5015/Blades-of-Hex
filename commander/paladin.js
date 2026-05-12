export default {
    id: 'paladin',
    name: '圣骑士',
    hpBonus: 40,
    atkBonus: 10,
    spdBonus: 0,
    skills: [
        { name: '勇气灵光', desc: '自身及相邻6格友军攻击力+10%，士气不会下降或混乱', type: 'passive' },
        { name: '誓言', desc: '【勇气灵光】范围内的友军（包括自己）受击时有50%概率获得1誓言（上限3），击杀时再获得1誓言', type: 'passive' },
        { name: '至圣斩', desc: '消耗最多2层誓言，每层为下次攻击附加30真实伤害', type: 'active' }
    ],

    FAITH_MAX: 3,

    onDeploy(unit, gameState, helpers) {
        unit._faith = 1;
    },

    onKill(killer, victim, helpers) {
        if (killer._faith < 3) {
            killer._faith++;
            helpers.spawnGoldenBeam(killer.tile.x, killer.tile.y);
        }
        return null;
    },

    onAllyDamage(victim, damage, paladinUnit, helpers) {
        if (paladinUnit._faith >= 3) return;
        if (Math.random() < 0.5) {
            paladinUnit._faith++;
            helpers.spawnGoldenBeam(paladinUnit.tile.x, paladinUnit.tile.y);
            helpers.logMessage(`圣骑士【誓言】：目睹战友受创，誓言+1（${paladinUnit._faith}/3）`);
        }
    },

    onAttack(attacker, target, dmg, helpers) {
        if (!attacker._smiteReady || dmg <= 0) return null;
        const beamCount = attacker._smiteCharged ? 2 : 1;
        attacker._smiteReady = false;
        const charged = attacker._smiteCharged;
        attacker._smiteCharged = false;
        const base = charged ? 60 : 30;
        const smiteDmg = helpers.isCrit ? base * 2 : base;
        target.hp = Math.max(0, target.hp - smiteDmg);
        target.displayHp = target.hp;
        const label = charged ? '至圣斩·誓约' : '至圣斩';
        helpers.clearOrbitBeams(attacker.id);
        helpers.spawnBeamProjectiles(attacker.tile.x, attacker.tile.y, target.tile.x, target.tile.y, beamCount);
        helpers.spawnFx(target.tile.x, target.tile.y, '✝️', label);
        helpers.logMessage(
            `圣骑士【至圣斩】：附加${smiteDmg}真实伤害` +
            `${charged ? '（蓄力翻倍）' : ''}${helpers.isCrit ? '（强击翻倍）' : ''}`
        );
        return { smiteDmg };
    },

    activeSkill: {
        name: '至圣斩',
        desc: '消耗誓言，每层为下次攻击附加30真实伤害，最多2层',
        duration: 0,
        cooldown: 0,

        onActivate(unit, helpers) {
            // 远端重放保护：状态已由序列化同步，仅重放特效
            if (unit._smiteReady) {
                const count = unit._smiteCharged ? 2 : 1;
                helpers.spawnOrbitBeams(unit.id, unit.tile.x, unit.tile.y, count);
                const label = unit._smiteCharged ? '至圣斩·誓约' : '至圣斩';
                helpers.spawnFx(unit.tile.x, unit.tile.y, '✝️', label);
                return true;
            }
            if (unit._faith < 1) {
                helpers.logMessage('誓言不足，无法蓄力至圣斩');
                return false;
            }
            if (unit._faith >= 2) {
                unit._faith -= 2;
                unit._smiteReady = true;
                unit._smiteCharged = true;
                helpers.spawnOrbitBeams(unit.id, unit.tile.x, unit.tile.y, 2);
                helpers.spawnFx(unit.tile.x, unit.tile.y, '✝️', '至圣斩·誓约');
                helpers.logMessage(`圣骑士【至圣斩·誓约】：消耗2誓言，下次攻击附加双倍真实伤害（${unit._faith}/3）`);
            } else {
                unit._faith -= 1;
                unit._smiteReady = true;
                unit._smiteCharged = false;
                helpers.spawnOrbitBeams(unit.id, unit.tile.x, unit.tile.y, 1);
                helpers.spawnFx(unit.tile.x, unit.tile.y, '✝️', '至圣斩');
                helpers.logMessage(`圣骑士【至圣斩】：消耗1誓言，下次攻击附加真实伤害（${unit._faith}/3）`);
            }
            return true;
        },

        onExpire(unit, helpers) {}
    }
};
