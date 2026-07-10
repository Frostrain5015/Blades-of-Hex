// 亡灵法师 —— 留魂 + 回魂
import { Unit } from '../js/Unit.js';
import { UNIT_CONFIG, getRoundIndex } from '../js/config.js';
import { spawnSoulRecallEffect } from '../js/effects.js';
import { COMMANDER_CONFIG } from '../js/gameData.js';

const { definition: DEFINITION, balance: BALANCE } = COMMANDER_CONFIG.necromancer;
// 被动【留魂】：己方单位阵亡后原地留下亡魂标记，存在3回合后消失
//   · 视野：遭遇战中亡魂标记为本阵营持续提供视野（范围=原单位）
//   · 亡魂诅咒：标记被敌方单位占据时，每回合对其施加真实伤害
// 被动【回魂】：己方回合开始牵引最近的空地亡魂标记唤起魂卒（无距离限制）

function _getCurseDamage(victim) {
    const maxHp = victim && typeof victim.maxHp === 'number' ? victim.maxHp : 0;
    const hp = victim && typeof victim.hp === 'number' ? victim.hp : maxHp;
    const missingHp = Math.max(0, maxHp - hp);
    return Math.max(1, Math.round(BALANCE.curseBaseDamage + missingHp * BALANCE.curseMissingHpPct));
}

function _grantCurseKillCredit(killer, victim, gameState, helpers) {
    if (!killer || !victim) return;

    if (typeof killer.morale === 'number' && killer.morale !== 0) {
        const oldMorale = killer.morale;
        killer.morale = Math.min(3, killer.morale + 1);
        if (killer.morale === 3) {
            const roundIndex = gameState && Number.isFinite(gameState.turnCounter)
                ? getRoundIndex(gameState)
                : 0;
            killer.moraleBoostUntil = roundIndex + BALANCE.moraleBoostRounds;
        }
        if (killer.morale !== oldMorale && helpers && typeof helpers.spawnMoraleEffect === 'function') {
            helpers.spawnMoraleEffect(killer);
        }
    }

    const rankExtra = BALANCE.rankXp;
    const victimRank = Math.max(0, Math.min(4, victim._rank || 0));
    const xp = BALANCE.killBaseXp + (rankExtra[victimRank] || 0) + (victim.commander ? BALANCE.commanderKillXp : 0);
    if (typeof killer.addXP === 'function') {
        killer.addXP(xp);
    } else {
        killer._xp = (killer._xp || 0) + xp;
    }
}

export default {
    ...DEFINITION,

    // 回魂 + 亡魂诅咒：回合开始处理己方亡魂标记
    onTurnStart(gameState, camp, helpers) {
        const unit = helpers.findCommanderUnit(camp, 'necromancer');
        if (!unit || !unit.tile || unit.hp <= 0) return;
        const necroTile = unit.tile;
        const tileMap = gameState.tileMap;
        if (!tileMap || !gameState._soulMarks || gameState._soulMarks.length === 0) return;
        const campKey = helpers.campKey || 'player1';

        // ── 亡魂诅咒：占据己方亡魂标记的敌方单位每回合受真实伤害（无法回魂的代价） ──
        // 遍历副本：诅咒致死会触发 destroy，可能改动 _soulMarks（敌方己方留魂等）
        for (const mark of gameState._soulMarks.slice()) {
            if (mark.campKey !== campKey) continue;
            const mt = tileMap.get(`${mark.q},${mark.r}`);
            if (!mt || !mt.unit || mt.unit.camp === unit.camp || mt.unit.hp <= 0) continue;
            const victim = mt.unit;
            const curse = _getCurseDamage(victim);
            if (!gameState.damageTexts) gameState.damageTexts = [];
            gameState.damageTexts.push({ x: mt.x, y: mt.y, value: curse, isCrit: false, timeLeft: 900, lastUpdate: performance.now() });
            helpers.spawnFx(mt.x, mt.y, '👻');
            helpers.spawnExplosion(mt.x, mt.y, '#4a2060', 12);
            const killed = victim.applyDamage(curse, { source: 'true', attacker: unit });
            if (killed) {
                _grantCurseKillCredit(unit, victim, gameState, helpers);
                if (typeof helpers.triggerCommanderOnKill === 'function') {
                    helpers.triggerCommanderOnKill(unit, victim);
                }
            }
            helpers.logMessage(`亡魂诅咒：${victim.camp.name}${victim.config.name}兵占据亡魂之地，受${curse}点诅咒伤害${killed ? '（诅咒致死）' : ''}`);
        }

        // ── 回魂：牵引最近的、位于空地上的己方亡魂标记唤起魂卒（被占据的标记跳过） ──
        let soulCount = 0;
        for (const t of gameState.tiles) {
            if (t.unit && t.unit._isSoulMinion && t.unit.camp === camp) soulCount++;
        }
        if (soulCount >= BALANCE.maxSoulMinions) return;

        let best = null, bestDist = 999, targetTile = null;
        for (const mark of gameState._soulMarks) {
            if (mark.campKey !== campKey) continue;
            const mt = tileMap.get(`${mark.q},${mark.r}`);
            if (!mt || mt.unit) continue; // 被占据（含被诅咒的敌方）→ 本回合不可召回
            const dist = Math.max(Math.abs(necroTile.q - mark.q), Math.abs(necroTile.r - mark.r), Math.abs(necroTile.q + necroTile.r - mark.q - mark.r));
            if (dist < bestDist) { best = mark; bestDist = dist; targetTile = mt; }
        }
        if (!best || !targetTile) return;

        // 移除亡魂标记
        const idx = gameState._soulMarks.indexOf(best);
        if (idx >= 0) gameState._soulMarks.splice(idx, 1);

        // 唤起魂卒：保留原兵种和生命上限，当前HP=40%原上限，攻击=70%原攻击
        const origType = best.origType || 'infantry';
        const origMaxHp = best.origMaxHp || UNIT_CONFIG.infantry.hp;
        const origAtkBonus = best.origAtkBonus || 0;
        const baseAtk = (UNIT_CONFIG[origType] && UNIT_CONFIG[origType].attack) || UNIT_CONFIG.infantry.attack;
        const soulHp = Math.round(origMaxHp * BALANCE.soulHpPct);
        const soulAtk = Math.round((baseAtk + origAtkBonus) * BALANCE.soulAttackPct);

        // 创建魂卒单位（同原兵种），设落地时间戳以延迟显示
        const soulUnit = new Unit(origType, camp, targetTile, false);
        soulUnit._isSoulMinion = true;
        soulUnit.maxHp = origMaxHp;
        soulUnit.hp = soulHp;
        soulUnit.displayHp = soulHp;
        soulUnit._atkBonus = soulAtk - baseAtk; // 调整至70%原攻击
        soulUnit.canAct = true;
        soulUnit.remainingMP = soulUnit.config.speed;
        // 黑烟飞抵后才现身
        soulUnit._soulRecallLandAt = spawnSoulRecallEffect(necroTile.x, necroTile.y, targetTile.x, targetTile.y);

        helpers.logMessage(`亡灵法师【回魂】：亡魂→魂卒（${soulHp}HP/${soulAtk}ATK）`);
    }
};
