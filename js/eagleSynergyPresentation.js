// 天鹰规则事件到通用阵营协同 Hero 的轻量适配层。
import { EAGLE_FACTION_SYNERGY } from '../rules/factionSynergies.js';
import {
    playFactionSynergyPresentation,
    registerFactionSynergyFollowup
} from './factionSynergyPresentation.js';
import { createOrbitalSupplyFollowup } from './factionSynergyFollowups/orbitalSupply.js';

registerFactionSynergyFollowup('orbital-supply', createOrbitalSupplyFollowup);

export function playEagleSynergyPresentation(event) {
    playFactionSynergyPresentation(event, EAGLE_FACTION_SYNERGY.hero);
}
