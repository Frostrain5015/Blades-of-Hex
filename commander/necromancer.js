// 亡灵法师 —— 留魂 + 回魂
import { Unit } from '../js/Unit.js';
// 被动【留魂】：己方单位阵亡后原地留下亡魂标记，存在2回合后消失
// 被动【回魂】：己方回合开始牵引3格范围内1个亡魂标记，原地唤起魂卒

export default {
    id: 'necromancer',
    name: '亡灵法师',
    skill: '留魂',
    hpBonusPct: 0.25, atkBonusPct: 0.10, spdBonus: 0,
    desc: '己方单位阵亡时留下亡魂标记（2回合消失）；回合开始牵引3格内1个亡魂标记，原地唤起魂卒（40%HP/70%ATK，最多2个）',
    tooltipDesc: '留魂：友军阵亡留亡魂标记（2回合）；回魂：牵引3格内亡魂→魂卒（40%HP/70%ATK，最多2个）',
    skills: [
        { name: '留魂', desc: '己方单位阵亡后原地留下亡魂标记，2回合后消失', type: 'passive' },
        { name: '回魂', desc: '己方回合开始牵引3格范围内1个亡魂标记，原地唤起魂卒（40%HP/70%ATK，场上最多2个）', type: 'passive' }
    ],

    // 回魂：回合开始时牵引亡魂标记
    onTurnStart(gameState, camp, helpers) {
        const unit = helpers.findCommanderUnit(camp, 'necromancer');
        if (!unit || !unit.tile || unit.hp <= 0) return;
        const necroTile = unit.tile;
        if (!gameState._soulMarks || gameState._soulMarks.length === 0) return;
        const campKey = helpers.campKey || 'player1';

        // 扫描3格内最近的亡魂标记
        let best = null, bestDist = 999;
        for (const mark of gameState._soulMarks) {
            if (mark.campKey !== campKey) continue;
            const dist = Math.max(Math.abs(necroTile.q - mark.q), Math.abs(necroTile.r - mark.r), Math.abs(necroTile.q + necroTile.r - mark.q - mark.r));
            if (dist <= 3 && dist < bestDist) best = mark;
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

        // 唤起魂卒：步兵基础，40%HP/70%ATK
        const baseHp = 200; // 步兵基础HP
        const baseAtk = 40; // 步兵基础ATK
        const soulHp = Math.round(baseHp * 0.40);
        const soulAtk = Math.round(baseAtk * 0.70);

        // 创建魂卒单位
        const soulUnit = new Unit('infantry', camp, targetTile, false);
        soulUnit._isSoulMinion = true;
        soulUnit.maxHp = soulHp;
        soulUnit.hp = soulHp;
        soulUnit.displayHp = soulHp;
        soulUnit._atkBonus = (soulUnit._atkBonus || 0) + soulAtk - baseAtk; // 调整ATK
        soulUnit.canAct = true;
        soulUnit.remainingMP = 5; // 步兵速度

        helpers.spawnFx(targetTile.x, targetTile.y, '💀', '回魂');
        helpers.logMessage(`亡灵法师【回魂】：亡魂→魂卒（${soulHp}HP/${soulAtk}ATK）`);
    }
};