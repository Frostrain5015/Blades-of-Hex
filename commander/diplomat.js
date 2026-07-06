// 纵横家 —— 合纵 + 连横
// 被动【合纵】：手牌上限+1、每回合用卡次数+1
// 被动【连横】：处于敌方行政区内时，对方玩家每使用一张对策卡35%概率使本阵营获得同名复制
import { CAMP } from '../js/config.js';

export default {
    id: 'diplomat',
    name: '纵横家',
    skill: '合纵',
    hpBonusPct: 0.30, atkBonusPct: 0.20, spdBonus: 0,
    desc: '手牌上限+1、每回合用卡次数+1；处于敌方行政区时35%复制对方使用的对策卡',
    tooltipDesc: '合纵：手牌+1/用卡+1；连横：敌区内35%复制对方卡牌（进手牌，用后不入弃牌堆）',
    skills: [
        { name: '合纵', desc: '手牌上限+1，每回合用卡次数+1', type: 'passive' },
        { name: '连横', desc: '处于敌方行政区时，对方每用一张对策卡35%概率获得同名复制（超上限不触发，用后不入弃牌堆）', type: 'passive' }
    ],

    // 部署时设置卡牌覆盖
    onDeploy(unit, gameState, helpers) {
        if (!gameState._cardOverrides) gameState._cardOverrides = {};
        const campKey = unit.camp === CAMP.player1 ? 'player1'
                      : unit.camp === CAMP.player2 ? 'player2' : 'player3';
        gameState._cardOverrides[campKey] = { handSizeBonus: 1, useBonus: 1 };
    }
    // 连横复制逻辑内联在 gameLogic.js executeTacticalCard 尾部（见 E3 纵横家连横）
};
