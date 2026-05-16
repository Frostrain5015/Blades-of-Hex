import { UNIT_CONFIG } from '../js/config.js';

export default {
    id: 'magician',
    name: '魔术师',
    skill: '幻形',
    hpBonus: 25,
    atkBonus: 0,
    spdBonus: 0,
    desc: '克制时伤害+25%，被克制时伤害-15%，击杀敌方单位后变形为敌方兵种，每触发1次暴击率+10%（最多6层）',
    tooltipDesc: '克制时伤害+25%，被克制时伤害-15%，击杀敌方后变形为敌方兵种，每触发1次暴击率+10%（最多6层）',

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
        killer.remainingMP = 0;
        killer.canAct = false;
        killer._phantomStacks = Math.min((killer._phantomStacks || 0) + 1, 6);
        const critPct = killer._phantomStacks * 10;
        helpers.spawnFx(killer.tile.x, killer.tile.y, '\u{1F3AD}', '幻形');
        helpers.spawnExplosion(killer.tile.x, killer.tile.y, '#cc88ff', 12);
        helpers.logMessage(`魔术师【幻形】：变形为${newConfig.name}兵，暴击率+10%（共${critPct}%）`);
        return { transformed: true, newType: victim.type };
    }
};
