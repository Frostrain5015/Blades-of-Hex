// 亡灵法师 —— 留魂 + 回魂
import { Unit } from '../js/Unit.js';
import { UNIT_CONFIG } from '../js/config.js';
import { spawnSoulRecallEffect } from '../js/effects.js';
// 被动【留魂】：己方单位阵亡后原地留下亡魂标记，存在3回合后消失
// 被动【回魂】：己方回合开始牵引全图最近的1个亡魂标记，原地唤起魂卒（无距离限制）

export default {
    id: 'necromancer',
    name: '亡灵法师',
    hpBonusPct: 0.25, atkBonusPct: 0.20, spdBonus: 0,
    skills: [
        { name: '留魂', desc: '友军单位阵亡后在原地留下持续3回合的【亡魂】', type: 'passive' },
        { name: '回魂', desc: '回合开始时自动牵引1个【亡魂】唤起【魂卒】，拥有原单位40%的生命值和70%的攻击力，场上最多存在2个魂卒', type: 'passive' }
    ],

    // 回魂：回合开始时牵引亡魂标记
    onTurnStart(gameState, camp, helpers) {
        const unit = helpers.findCommanderUnit(camp, 'necromancer');
        if (!unit || !unit.tile || unit.hp <= 0) return;
        const necroTile = unit.tile;
        if (!gameState._soulMarks || gameState._soulMarks.length === 0) return;
        const campKey = helpers.campKey || 'player1';

        // 扫描最近的己方亡魂标记（无距离限制，只要目标地块为空地即可召回）
        let best = null, bestDist = 999;
        for (const mark of gameState._soulMarks) {
            if (mark.campKey !== campKey) continue;
            const dist = Math.max(Math.abs(necroTile.q - mark.q), Math.abs(necroTile.r - mark.r), Math.abs(necroTile.q + necroTile.r - mark.q - mark.r));
            if (dist < bestDist) { best = mark; bestDist = dist; }
        }
        if (!best) return;

        // 检查目标地块是否可用
        const targetTile = gameState.tileMap && gameState.tileMap.get(`${best.q},${best.r}`);
        if (!targetTile || targetTile.unit) return;

        // 检查场上魂卒数量
        let soulCount = 0;
        for (const t of gameState.tiles) {
            if (t.unit && t.unit._isSoulMinion && t.unit.camp === camp) soulCount++;
        }
        if (soulCount >= 2) return;

        // 移除亡魂标记
        const idx = gameState._soulMarks.indexOf(best);
        if (idx >= 0) gameState._soulMarks.splice(idx, 1);

        // 唤起魂卒：保留原兵种和生命上限，当前HP=40%原上限，攻击=70%原攻击
        const origType = best.origType || 'infantry';
        const origMaxHp = best.origMaxHp || 200;
        const origAtkBonus = best.origAtkBonus || 0;
        const baseAtk = (UNIT_CONFIG[origType] && UNIT_CONFIG[origType].attack) || 40;
        const soulHp = Math.round(origMaxHp * 0.40);
        const soulAtk = Math.round((baseAtk + origAtkBonus) * 0.70);

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