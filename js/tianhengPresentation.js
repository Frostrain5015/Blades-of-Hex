// 天衡联邦规则事件到通用阵营协同 Hero 的轻量适配层。
import { TIANHENG_FACTION_SYNERGY } from '../rules/factionSynergies.js';
import {
    playFactionSynergyPresentation,
    registerFactionSynergyFollowup
} from './factionSynergyPresentation.js';
import { createBorrowDayFollowup } from './factionSynergyFollowups/borrowDay.js';

registerFactionSynergyFollowup('borrow-day', createBorrowDayFollowup);

export function playTianhengBorrowDayPresentation(event) {
    playFactionSynergyPresentation(event, TIANHENG_FACTION_SYNERGY.hero);
}
