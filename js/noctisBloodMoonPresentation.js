// 诺克提斯共和国规则事件到通用阵营协同 Hero 的轻量适配层。
import { NOCTIS_FACTION_SYNERGY } from '../rules/factionSynergies.js';
import {
    playFactionSynergyPresentation,
    registerFactionSynergyFollowup
} from './factionSynergyPresentation.js';
import { createBloodMoonRiseFollowup } from './factionSynergyFollowups/bloodMoonRise.js';

registerFactionSynergyFollowup('blood-moon-rise', createBloodMoonRiseFollowup);

export function playNoctisBloodMoonPresentation(event) {
    playFactionSynergyPresentation(event, NOCTIS_FACTION_SYNERGY.hero);
}
