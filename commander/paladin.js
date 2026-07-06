const _syncOrbitBeams = (unit, helpers) => {
    if (!unit.tile || !helpers.spawnOrbitBeams) return;
    let count = unit._faith;
    if (unit._smiteReady) count += unit._smiteCharged ? 2 : 1;
    helpers.spawnOrbitBeams(unit.id, unit.tile.x, unit.tile.y, count);
};

export default {
    id: 'paladin',
    name: '圣骑士',
    hpBonusPct: 0.25,
    atkBonusPct: 0.30,
    spdBonus: 0,
    skills: [
        { name: '勇气灵光', desc: '自身及相邻6格友军攻击力+10%，士气不会下降或混乱', type: 'passive' },
        { name: '誓言', desc: '【勇气灵光】范围内的友军（包括自己）受击或击杀时获得1誓言（每回合最多1层，上限3）。每层为圣骑士提供5%防御力', type: 'passive' },
        { name: '至圣斩', desc: '每次点击消耗1层誓言蓄力（1层25~40/2层65~85真实伤害），最多2层，命中后冷却1回合', type: 'active' }
    ],

    FAITH_MAX: 3,

    onDeploy(unit, gameState, helpers) {
        unit._faith = 1;
        _syncOrbitBeams(unit, helpers);
    },

    getDefenseBonus(unit) {
        return (unit._faith || 0) * 0.05;
    },

    // 誓言获取每回合限1层（受击/击杀共享额度），_oathGainTurn 随状态序列化同步
    // 以回合数(0-indexed)记录，同一回合内不重复获取
    _canGainOath(unit, helpers) {
        const gs = helpers.gameState;
        const fc = gs ? (gs.isThreePlayer ? 4 : 3) : 3;
        const round = gs ? Math.floor((gs.turnCounter || 0) / fc) : 0;
        if (unit._oathGainTurn === round) return false;
        unit._oathGainTurn = round;
        return true;
    },

    onKill(killer, victim, helpers) {
        if (killer._faith < 3 && this._canGainOath(killer, helpers)) {
            killer._faith++;
            _syncOrbitBeams(killer, helpers);
        }
        return null;
    },

    onAllyDamage(victim, damage, paladinUnit, helpers) {
        if (paladinUnit._faith >= 3) return;
        if (!this._canGainOath(paladinUnit, helpers)) return;
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
        // 命中后冷却1回合（activeSkillCD 随状态序列化同步，回合开始统一递减）
        attacker.activeSkillCD = Math.max(attacker.activeSkillCD || 0, 1);
        const smiteDmg = charged
            ? (helpers.rng ? helpers.rng.between(65, 85) : 65 + Math.floor(Math.random() * 21))
            : (helpers.rng ? helpers.rng.between(25, 40) : 25 + Math.floor(Math.random() * 16));
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
        desc: '每次点击消耗1层誓言蓄力（1层25~40→再点→2层65~85），最多2层，命中后冷却1回合',
        duration: 0,
        // 冷却在命中后由 onAttack 施加（此处保持0，避免两段蓄力点击被自身冷却卡住）
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
                // 已有1层，升级为至圣斩·誓约（2层65~85伤）
                unit._smiteCharged = true;
                helpers.spawnFx(unit.tile.x, unit.tile.y, '✝️', '至圣斩·誓约');
                helpers.logMessage(`圣骑士【至圣斩·誓约】：再消耗1誓言，下次攻击附加65~85真实伤害（${unit._faith}/3）`);
            } else {
                // 首次蓄力：至圣斩（1层25~40伤）
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
