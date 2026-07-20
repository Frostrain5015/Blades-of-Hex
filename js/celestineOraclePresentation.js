// 塞莱斯廷圣国规则事件到通用阵营协同 Hero 的轻量适配层。
import { CELESTINE_FACTION_SYNERGY } from '../rules/factionSynergies.js';
import {
    playFactionSynergyPresentation,
    registerFactionSynergyFollowup
} from './factionSynergyPresentation.js';
import { createOracleDescentFollowup } from './factionSynergyFollowups/oracleDescent.js';

registerFactionSynergyFollowup('oracle-descent', createOracleDescentFollowup);

export function playCelestineOraclePresentation(event) {
    playFactionSynergyPresentation(event, CELESTINE_FACTION_SYNERGY.hero);
}