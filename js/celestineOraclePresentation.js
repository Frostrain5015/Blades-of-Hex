// 塞莱斯廷圣国规则事件到通用阵营协同 Hero 的轻量适配层。
import { CELESTINE_FACTION_SYNERGY } from '../rules/factionSynergies.js';
import {
    playFactionSynergyPresentation,
    registerFactionSynergyFollowup
} from './factionSynergyPresentation.js';

// oracle-descent 后半段以 null 落地（后续可扩展为神像金光垂落动画）
registerFactionSynergyFollowup('oracle-descent', null);

export function playCelestineOraclePresentation(event) {
    playFactionSynergyPresentation(event, CELESTINE_FACTION_SYNERGY.hero);
}