import { UNIT_CONFIG } from '../js/config.js';

export default {
    id: 'magician',
    name: '魔术师',
    skill: '幻形',
    hpBonus: 25,
    atkBonus: 0,
    spdBonus: 0,
    desc: '克制时造成的伤害提高25%，被克制时受到的伤害降低15%，击杀敌方单位后变形为敌方兵种并保留剩余行动力，每层+3攻击力、+10%暴击率（最多6层）',
    tooltipDesc: '克制+25%伤害，被克制-15%受伤，击杀变形保留行动力，每层+3ATK+10%暴击（最多6层）',

    onKill(killer, victim, helpers) {
        if (victim.type === killer.type || victim.type === 'mgNest') return null;
        const newConfig = UNIT_CONFIG[victim.type];
        const hpRatio = killer.hp / killer.maxHp;
        // 保留军衔血量加成（rank≥1 +20HP）
        const rankHpBonus = killer._rank >= 1 ? 20 : 0;
        killer.type = victim.type;
        killer.config = newConfig;
        killer.maxHp = newConfig.hp + 25 + rankHpBonus;
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
