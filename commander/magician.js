import { UNIT_CONFIG } from '../js/config.js';

export default {
    id: 'magician',
    name: '魔术师',
    skill: '幻形',
    hpBonusPct: 0.20,
    atkBonusPct: 0,
    spdBonus: 0,
    skills: [
        { name: '千面', desc: '攻击克制目标时造成的伤害提高25%，被克制目标攻击时受到的伤害降低15%', type: 'passive' },
        { name: '幻形', desc: '击杀敌方单位后变形为其兵种类型，获得1层【幻形】效果：攻击力+3、暴击率+10%，最多叠加6层', type: 'passive' }
    ],

    onKill(killer, victim, helpers) {
        if (victim.type === killer.type || victim.type === 'mgNest') return null;
        const newConfig = UNIT_CONFIG[victim.type];
        const hpRatio = killer.hp / killer.maxHp;
        // 保留军衔血量加成（rank≥1 +20HP）
        const rankHpBonus = killer._rank >= 1 ? 20 : 0;
        killer.type = victim.type;
        killer.config = newConfig;
        // HP加成基于新兵种基础面板的20%（hpBonusPct）
        const hpPctBonus = Math.round(newConfig.hp * 0.20);
        killer.maxHp = newConfig.hp + hpPctBonus + rankHpBonus;
        killer.hp = Math.round(killer.maxHp * hpRatio);
        killer.displayHp = killer.hp;
        // 保留剩余行动力，不重置 canAct
        killer._phantomStacks = Math.min((killer._phantomStacks || 0) + 1, 6);
        const critPct = killer._phantomStacks * 10;
        const atkBonus = killer._phantomStacks * 3;
        helpers.spawnFx(killer.tile.x, killer.tile.y, '\u{1F3AD}', '幻形');
        helpers.spawnExplosion(killer.tile.x, killer.tile.y, '#cc88ff', 12);
        helpers.logMessage(`魔术师【幻形】：变形为${newConfig.name}兵，ATK+${atkBonus}、暴击率+${critPct}%`);
        return { transformed: true, newType: victim.type };
    },

    getAttackBonus(unit) {
        return (unit._phantomStacks || 0) * 3;
    }
};
