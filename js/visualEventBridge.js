// Browser-only bridge from domain events to Canvas effects.
// Engine modules emit descriptive events and never import this file.
import { on } from './eventBus.js';
import {
    spawnExplosionParticles,
    spawnHealParticles,
    triggerHealFlash,
    triggerScreenShake,
    spawnCommanderSkillEffect,
    spawnMoraleEffect,
    triggerFactionMoraleFlash,
    spawnRankUpEffect,
    spawnSoulRecallEffect,
    spawnCoinRain
} from './effects.js';
import { playSound } from './audio.js';
import { playAureliaOathPresentation } from './aureliaOathPresentation.js';
import { playEagleSynergyPresentation } from './eagleSynergyPresentation.js';
import { gameState, logMessage } from './state.js';

on('fx:healFlash', ({ x, y }) => triggerHealFlash(x, y));
on('fx:healParticles', ({ x, y }) => spawnHealParticles(x, y));
on('fx:commanderSkill', ({ x, y, glyph, label }) => spawnCommanderSkillEffect(x, y, glyph, label));
on('fx:morale', ({ unit }) => spawnMoraleEffect(unit));
on('fx:factionMorale', ({ color }) => triggerFactionMoraleFlash(color));
on('fx:explosion', ({ x, y, color, count }) => spawnExplosionParticles(x, y, color, count));
on('fx:screenShake', ({ strength, duration }) => triggerScreenShake(strength, duration));
on('fx:rankUp', ({ x, y, rank }) => spawnRankUpEffect(x, y, rank));
on('audio:play', ({ soundName }) => playSound(soundName));
on('fx:aureliaOath', event => playAureliaOathPresentation(event));
// 天鹰【天基支援协议】：轨道补给走全屏 Hero；天基打击授权是轻量表现（将领处卫星标记）。
// 日志统一在此落地：同步结算路径由广播 relay，延迟结算路径两端各自确定性重算，
// 均经本桥，presentationEventId 由 Hero 层去重。
on('fx:eagleSynergy', event => {
    if (event?.kind === 'orbitalGrant') {
        const factionName = gameState.factions?.[event.campKey]?.name || '';
        logMessage(`🛰️ ${factionName}阵营协同【天基打击授权】：天基武器就绪，获得对策卡【天基打击】`);
        for (const commander of event.commanders || []) {
            if (Number.isFinite(commander.x) && Number.isFinite(commander.y)) {
                spawnCommanderSkillEffect(commander.x, commander.y, '🛰️', '天基打击授权');
            }
        }
        playSound('commanderSkill');
        return;
    }
    const factionName = gameState.factions?.[event.campKey]?.name || '';
    logMessage(`📦 ${factionName}阵营协同【轨道补给】：天基平台完成战果核算，拨付$${event.goldAwarded}`);
    playEagleSynergyPresentation(event);
});
// 轨道补给结算节拍：向棋盘发放金币雨与 +$ 浮字（由后半段动画在对点时触发）
on('fx:eagleSupplyDrop', event => {
    const commanders = (event.commanders || [])
        .filter(commander => Number.isFinite(commander.x) && Number.isFinite(commander.y));
    if (commanders.length === 0) return;
    const now = performance.now();
    const centerX = commanders.reduce((sum, commander) => sum + commander.x, 0) / commanders.length;
    const centerY = commanders.reduce((sum, commander) => sum + commander.y, 0) / commanders.length;
    gameState.goldTexts.push({
        x: centerX, y: centerY,
        value: event.goldAwarded || 0, prefix: '+', color: '#f5d76e', shadowColor: '#7fd0ff',
        timeLeft: 1600, lastUpdate: now
    });
    for (const commander of commanders) spawnCoinRain(commander.x, commander.y, 1);
});
on('fx:hpDeltaTexts', ({ damage, healing }) => {
    const now = performance.now();
    if (damage && Number.isFinite(damage.value) && damage.value > 0) {
        gameState.damageTexts.push({
            x: damage.x,
            y: damage.y,
            value: damage.value,
            isCrit: false,
            timeLeft: 900,
            lastUpdate: now
        });
    }
    if (healing && Number.isFinite(healing.value) && healing.value > 0) {
        gameState.healTexts.push({
            x: healing.x,
            y: healing.y,
            value: healing.value,
            timeLeft: 1000,
            lastUpdate: now
        });
    }
});
on('fx:soulRecall', ({ fromX, fromY, toX, toY, unit }) => {
    unit._soulRecallLandAt = spawnSoulRecallEffect(fromX, fromY, toX, toY);
});
