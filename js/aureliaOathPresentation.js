// 奥雷利亚规则事件到通用阵营协同 Hero 的轻量适配层。
import { AURELIA_FACTION_SYNERGY } from '../rules/factionSynergies.js';
import {
    playFactionSynergyPresentation,
    registerFactionSynergyFollowup
} from './factionSynergyPresentation.js';
import { createRescueLinkFollowup } from './factionSynergyFollowups/rescueLink.js';

registerFactionSynergyFollowup('rescue-link', createRescueLinkFollowup);

export function playAureliaOathPresentation(event) {
    playFactionSynergyPresentation(event, AURELIA_FACTION_SYNERGY.hero);
}

