// 纵横家 —— 合纵 + 连横
// 被动【合纵】：手牌上限+1、每回合用卡次数+1
// 被动【连横】：处于敌方行政区内时，对方玩家每使用一张对策卡35%概率使本阵营获得同名复制
import { campToKey } from '../rules/camps.js';
import { COMMANDER_CONFIG } from '../rules/commanders.js';

const { definition: DEFINITION, balance: BALANCE } = COMMANDER_CONFIG.diplomat;

export default {
    ...DEFINITION,

    // 部署时设置卡牌覆盖
    onDeploy(unit, gameState, helpers) {
        if (!gameState._cardOverrides) gameState._cardOverrides = {};
        const campKey = campToKey(unit.camp);
        gameState._cardOverrides[campKey] = { handSizeBonus: BALANCE.handSizeBonus, useBonus: BALANCE.useBonus };
    }
    // 连横复制逻辑内联在 gameLogic.js executeTacticalCard 尾部（见 E3 纵横家连横）
};
