import { COMMANDER_CONFIG } from '../js/gameData.js';

const { definition: DEFINITION, balance: BALANCE } = COMMANDER_CONFIG.paladin;

const _syncOrbitBeams = (unit, helpers) => {
    if (!unit.tile || !helpers.spawnOrbitBeams) return;
    let count = unit._faith;
    if (unit._smiteReady) count += unit._smiteCharged ? BALANCE.maxSmiteCharges : BALANCE.faithCostPerCharge;
    helpers.spawnOrbitBeams(unit.id, unit.tile.x, unit.tile.y, count);
};

const _spawnFx = (helpers, x, y, glyph, label) => {
    if (helpers && typeof helpers.spawnFx === 'function') {
        helpers.spawnFx(x, y, glyph, label);
    }
};

export default {
    ...DEFINITION,
    FAITH_MAX: BALANCE.faithMax,

    onDeploy(unit, gameState, helpers) {
        unit._faith = BALANCE.faithOnDeploy;
        _syncOrbitBeams(unit, helpers);
    },

    getDefenseBonus(unit) {
        return (unit._faith || 0) * BALANCE.defensePerFaith;
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
        if (killer._faith < BALANCE.faithMax && this._canGainOath(killer, helpers)) {
            killer._faith++;
            _syncOrbitBeams(killer, helpers);
        }
        return null;
    },

    onAllyDamage(victim, damage, paladinUnit, helpers) {
        if (paladinUnit._faith >= BALANCE.faithMax) return;
        if (!this._canGainOath(paladinUnit, helpers)) return;
        paladinUnit._faith++;
        _syncOrbitBeams(paladinUnit, helpers);
        helpers.logMessage(`圣骑士【誓言】：目睹战友受创 誓言+1 ${paladinUnit._faith}/${BALANCE.faithMax}`);
    },

    onAttack(attacker, target, dmg, helpers) {
        if (!attacker._smiteReady || dmg <= 0) return null;
        const charged = attacker._smiteCharged;
        const beamCount = charged ? 2 : 1;
        attacker._smiteReady = false;
        attacker._smiteCharged = false;
        // 命中后冷却1回合（activeSkillCD 随状态序列化同步，回合开始统一递减）
        attacker.activeSkillCD = Math.max(attacker.activeSkillCD || 0, BALANCE.smiteCooldown);
        const smiteDmg = charged
            ? (helpers.rng ? helpers.rng.between(BALANCE.chargedSmiteMin, BALANCE.chargedSmiteMax) : BALANCE.chargedSmiteMin + Math.floor(Math.random() * (BALANCE.chargedSmiteMax - BALANCE.chargedSmiteMin + 1)))
            : (helpers.rng ? helpers.rng.between(BALANCE.normalSmiteMin, BALANCE.normalSmiteMax) : BALANCE.normalSmiteMin + Math.floor(Math.random() * (BALANCE.normalSmiteMax - BALANCE.normalSmiteMin + 1)));
        // Phase 1: 剑从环绕轨道飞向目标（发射即释放，移除环绕剑）
        // 注意：gameLogic 的 setTimeout(smiteDelay) 内会触发 spawnGoldenBeam
        // 此处不应再立即 spawnGoldenBeam，否则会 double
        const paladinProjectileDatas = helpers.launchOrbitSwords
            ? helpers.launchOrbitSwords(attacker.id, target.tile.x, target.tile.y, beamCount)
            : [];
        // 光环剑影闪 — 圣骑士自身位置爆发金色辉光
        _spawnFx(helpers, attacker.tile.x, attacker.tile.y, '⚡', '至圣斩');
        // 剩余剑同步到当前誓言层数
        setTimeout(() => {
            _syncOrbitBeams(attacker, helpers);
        }, 350);
        helpers.logMessage(
            `圣骑士【至圣斩】：附加${smiteDmg}真实伤害` +
            `${charged ? '（蓄力翻倍）' : ''}`
        );
        return { smiteDmg, paladinProjectileDatas };
    },

    activeSkill: {
        ...DEFINITION.activeSkill,
        // 冷却在命中后由 onAttack 施加（此处保持0，避免两段蓄力点击被自身冷却卡住）
        cooldown: 0,

        onActivate(unit, helpers) {
            // 远端重放：状态已由序列化同步，仅重放对应特效
            if (unit._smiteCharged || (helpers.isReplay && unit._smiteReady)) {
                // 重放时不改变环绕剑数量（已被远端锁定）
                const label = unit._smiteCharged ? '至圣斩·誓约' : '至圣斩';
                _spawnFx(helpers, unit.tile.x, unit.tile.y, '✝️', label);
                return true;
            }
            if (unit._faith < BALANCE.faithCostPerCharge) {
                helpers.logMessage('誓言不足，无法蓄力至圣斩');
                return false;
            }
            // 每次点击消耗1层誓言（环绕剑数量暂时锁定，不在此同步）
            unit._faith -= BALANCE.faithCostPerCharge;
            if (unit._smiteReady && !unit._smiteCharged) {
                // 已有1层，升级为至圣斩·誓约（2层65~85伤）
                unit._smiteCharged = true;
                _spawnFx(helpers, unit.tile.x, unit.tile.y, '✝️', '至圣斩·誓约');
                helpers.logMessage(`圣骑士【至圣斩·誓约】：再消耗1誓言，下次攻击附加${BALANCE.chargedSmiteMin}~${BALANCE.chargedSmiteMax}真实伤害（${unit._faith}/${BALANCE.faithMax}）`);
            } else {
                // 首次蓄力：至圣斩（1层25~40伤）
                unit._smiteReady = true;
                unit._smiteCharged = false;
                _spawnFx(helpers, unit.tile.x, unit.tile.y, '✝️', '至圣斩');
                helpers.logMessage(`圣骑士【至圣斩】：消耗1誓言，下次攻击附加${BALANCE.normalSmiteMin}~${BALANCE.normalSmiteMax}真实伤害（${unit._faith}/${BALANCE.faithMax}）`);
            }
            return true;
        },

        onExpire(unit, helpers) {}
    }
};
