import { UNIT_CONFIG } from '../rules/units.js';
import { COMMANDER_CONFIG } from '../rules/commanders.js';
import { getUnitMovementDomain, MOVEMENT_DOMAIN } from '../rules/movement.js';
import { isWaterTile } from '../rules/surfaces.js';

const { definition: DEFINITION, balance: BALANCE } = COMMANDER_CONFIG.magician;

export default {
    ...DEFINITION,

    onKill(killer, victim, helpers) {
        if (victim.type === 'mgNest') return null;
        const navalAtSea = getUnitMovementDomain(killer) === MOVEMENT_DOMAIN.NAVAL && isWaterTile(killer.tile);
        if (victim.type === killer.type) return null;
        const canTransform = victim.type !== killer.type
            && (!navalAtSea || getUnitMovementDomain(victim) === MOVEMENT_DOMAIN.NAVAL);
        if (canTransform) {
            const newConfig = UNIT_CONFIG[victim.type];
            const hpRatio = killer.hp / killer.maxHp;
            // 保留军衔血量加成（rank≥1 +20HP）
            const rankHpBonus = killer._rank >= 1 ? BALANCE.rankHpBonus : 0;
            killer.type = victim.type;
            killer.config = newConfig;
            killer.movementDomain = getUnitMovementDomain({ type: victim.type, config: newConfig });
            // HP加成基于新兵种基础面板的20%（hpBonusPct）
            const hpPctBonus = Math.round(newConfig.hp * BALANCE.hpBonusPct);
            killer.maxHp = newConfig.hp + hpPctBonus + rankHpBonus;
            killer.hp = Math.round(killer.maxHp * hpRatio);
            killer.displayHp = killer.hp;
        }
        // 保留剩余行动力，不重置 canAct
        killer._phantomStacks = Math.min((killer._phantomStacks || 0) + 1, BALANCE.maxStacks);
        const critPct = killer._phantomStacks * BALANCE.critPerStack * 100;
        const dmgPct = killer._phantomStacks * BALANCE.damagePerStack * 100;
        helpers.spawnFx(killer.tile.x, killer.tile.y, '\u{1F3AD}', '幻形');
        helpers.spawnExplosion(killer.tile.x, killer.tile.y, '#cc88ff', 12);
        const transformText = canTransform ? `变形为${killer.config.name}兵 ` : '';
        helpers.logMessage(`魔术师【幻形】：${transformText}增伤+${dmgPct}% 暴击率+${critPct}%`);
        return { transformed: canTransform, newType: canTransform ? victim.type : killer.type };
    },

    getAttackBonus(unit) {
        return 0; // 幻形增伤移至②增伤乘区（见 _resolveDamage）
    }
};
