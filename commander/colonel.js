// 空军上校 —— 强化其驻扎城市的机场，或所挂载航母的舰载机。
import { campToKey } from '../rules/camps.js';
import { COMMANDER_CONFIG } from '../rules/commanders.js';

const { definition: DEFINITION } = COMMANDER_CONFIG.colonel;

export default {
    ...DEFINITION,

    onDeploy(unit, gameState, helpers) {
        const campKey = campToKey(unit.camp);
        if (!gameState._colonelDeployed) gameState._colonelDeployed = {};
        gameState._colonelDeployed[campKey] = true;
    }
};
