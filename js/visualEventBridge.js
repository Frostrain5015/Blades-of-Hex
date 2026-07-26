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
    spawnCoinRain,
    spawnCelestineOracleBeam,
    spawnLaserBeam,
    LASER_BEAM_TIMING
} from './effects.js';
import { playSound } from './audio.js';
import { CELESTINE_ORACLE_PULSE_TIMING } from '../rules/celestine.js';
import { CELESTINE_FACTION_SYNERGY } from '../rules/factionSynergies.js';
import { playAureliaOathPresentation } from './aureliaOathPresentation.js';
import { playEagleSynergyPresentation } from './eagleSynergyPresentation.js';
import { playCelestineOraclePresentation } from './celestineOraclePresentation.js';
import { playTianhengBorrowDayPresentation } from './tianhengPresentation.js';
import { playNoctisBloodMoonPresentation } from './noctisBloodMoonPresentation.js';
import { spawnBloodMoonSlash } from './effects.js';
import { gameState, logMessage, updateUI } from './state.js';
import { enqueueFloatText } from './floatTexts.js';

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
    // Hero 动画已移至天基打击对策卡发动时刻（fx:eagleOrbitalStrikeActivation），此处仅日志
});
// 天基打击发动 → 天鹰协同 Hero 全屏动画（取代轨道补给触发时机）
on('fx:eagleOrbitalStrikeActivation', event => {
    if (!event?.campKey) return;
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
// 天鹰计量实时刷新：战功/受创每次变动都需立即反映到 HUD 被动区与金币显示，
// 尤其是空袭落弹等延迟结算路径（不在常规 updateUI 节拍上）。按帧节流，AOE 只刷一次。
let eagleMeterUiPending = false;
on('fx:eagleMeterChanged', () => {
    if (eagleMeterUiPending) return;
    eagleMeterUiPending = true;
    requestAnimationFrame(() => {
        eagleMeterUiPending = false;
        updateUI();
    });
});
// 塞莱斯廷圣国【神谕】：阶段跃迁走全屏 Hero；脉冲表现走弹道+浮字。
on('fx:celestineOracle', event => {
    const factionName = gameState.factions?.[event.campKey]?.name || '';
    const stageNames = ['', '壹·神临', '贰·神启', '叁·神怒', '肆·神威', '伍·神灭'];
    const stageName = stageNames[event.stage] || `第${event.stage}阶段`;
    logMessage(`🔆 ${factionName}阵营协同【神谕】${stageName}：神临第${event.activeRounds}轮`);
    playCelestineOraclePresentation(event);
});
// 【神罚】/【赐福】脉冲：统一两段式——前半段神像蓄力+指引光束（静默，迷雾之上），
// 后半段弹着（浮字 + 音效 + 目标处爆发）。目标坐标由 q/r 经 tileMap 解析。
on('fx:celestineOraclePulse', event => {
    const factionName = gameState.factions?.[event.campKey]?.name || '';
    const statueOk = Number.isFinite(event.statueX) && Number.isFinite(event.statueY);
    const timing = CELESTINE_ORACLE_PULSE_TIMING;
    // 阶段跃迁时 Hero 动画正在播放，脉冲弹着延迟到 Hero 结束后再触发
    const heroDelayMs = event.stageChanged ? CELESTINE_FACTION_SYNERGY.hero.durationMs : 0;
    const resolvePoint = ref => {
        if (Number.isFinite(ref?.x) && Number.isFinite(ref?.y)) return { x: ref.x, y: ref.y };
        const tile = Number.isFinite(ref?.q) && Number.isFinite(ref?.r)
            ? gameState.tileMap?.get(`${ref.q},${ref.r}`) : null;
        return tile ? { x: tile.x, y: tile.y } : null;
    };

    if (event.smite) {
        logMessage(`⚡ ${factionName}【神罚】→ 对 ${event.smite.unitId} 造成 ${event.smite.dmg} 点真实伤害${event.smite.killed ? '，将其消灭' : ''}`);
        const point = resolvePoint(event.smite);
        const smiteImpact = () => {
            if (point) {
                // 事件自复制路径（本地 emit 一次、远端经 payload 重 emit 一次）：不进广播捕获
                enqueueFloatText({
                    x: point.x, y: point.y,
                    value: event.smite.dmg, isTrueDmg: true, timeLeft: 1200
                }, { broadcast: false });
                spawnExplosionParticles(point.x, point.y, '#f5d76e', 18);
                spawnExplosionParticles(point.x, point.y, '#fff6d8', 10);
            }
            triggerScreenShake(event.smite.killed ? 6 : 4, event.smite.killed ? 260 : 180);
            playSound(event.smite.killed ? 'explosion' : 'lightning');
        };
        if (statueOk && point) {
            spawnCelestineOracleBeam(event.statueX, event.statueY, point.x, point.y, 'smite', heroDelayMs, timing);
            window.setTimeout(smiteImpact, heroDelayMs + timing.impactMs);
        } else {
            // 无神像锚点时降级为即时弹着（但阶段跃迁仍需延迟到 Hero 之后）
            if (heroDelayMs > 0) {
                window.setTimeout(smiteImpact, heroDelayMs);
            } else {
                smiteImpact();
            }
        }
    }
    if (event.shield && event.shield.amount > 0) {
        logMessage(`🛡️ ${factionName}【赐福】→ 对 ${event.shield.unitId} 附加 ${event.shield.amount} 点护盾`);
        const point = resolvePoint(event.shield);
        const shieldImpact = () => {
            if (point) {
                // 赐福改为护盾跳字；事件自复制路径：不进广播捕获
                enqueueFloatText({
                    kind: 'shield', sign: '+',
                    x: point.x, y: point.y,
                    value: event.shield.amount, timeLeft: 1200
                }, { broadcast: false });
                spawnHealParticles(point.x, point.y);
            }
            playSound('heal');
        };
        if (statueOk && point) {
            spawnCelestineOracleBeam(event.statueX, event.statueY, point.x, point.y, 'shield', heroDelayMs + timing.shieldFollowMs, timing);
            window.setTimeout(shieldImpact, heroDelayMs + timing.shieldFollowMs + timing.impactMs);
        } else {
            if (heroDelayMs > 0) {
                window.setTimeout(shieldImpact, heroDelayMs);
            } else {
                shieldImpact();
            }
        }
    }
});
// 激光塔【集束激光】齐射：本地（gameLogic 回合开始结算）与远端（endTurn 载荷重放）
// 共用此桥。每座塔的每个命中目标按全局序号 * 120ms 错峰发射；落点粒子与光束弹着时刻对齐。
on('fx:laserTowerVolley', event => {
    const volleys = Array.isArray(event?.volleys) ? event.volleys : [];
    let index = 0;
    for (const volley of volleys) {
        if (!Number.isFinite(volley?.x) || !Number.isFinite(volley?.y)) continue;
        for (const hit of volley.hits || []) {
            if (!Number.isFinite(hit?.x) || !Number.isFinite(hit?.y)) continue;
            const delayMs = index * 120;
            spawnLaserBeam(volley.x, volley.y, hit.x, hit.y, { delayMs });
            window.setTimeout(() => {
                spawnExplosionParticles(hit.x, hit.y, '#4fd8e8', 8);
                spawnExplosionParticles(hit.x, hit.y, '#ffffff', 4);
            }, delayMs + LASER_BEAM_TIMING.chargeMs + LASER_BEAM_TIMING.travelMs);
            index++;
        }
    }
    if (index > 0) playSound('lightning');
});
// 天衡联邦【日月天衡】：发牌/Hero/远端重放均通过此事件触发全屏 Hero 动画+日珥特效。
on('fx:tianhengBorrowDay', event => {
    const factionName = gameState.factions?.[event.campKey]?.name || '';
    logMessage(`⚖️ ${factionName}发动阵营协同【日月天衡】：全军40点护盾+士气提升+暴击率提升+全图视野`);
    playTianhengBorrowDayPresentation(event);
});
// 诺克提斯【血月】：rising 时播 Hero 血月降临动画；每次放血绕目标播放环形斩击。
on('fx:noctisBloodMoonBleed', event => {
    if (event.rising) {
        const factionName = gameState.factions?.[event.campKey]?.name || '';
        logMessage(`🌑 ${factionName}血月降临——永夜·禁疗，全场低血量单位持续流血`);
        playNoctisBloodMoonPresentation(event);
    }
    if (Array.isArray(event.hits)) {
        for (const h of event.hits) {
            if (h.x == null) continue;
            spawnBloodMoonSlash(h.x, h.y, !!h.killed);
        }
    }
});
on('fx:hpDeltaTexts', ({ damage, healing }) => {
    // 事件自复制路径（救援链接动画两端各自触发）：不进广播捕获
    if (damage && Number.isFinite(damage.value) && damage.value > 0) {
        enqueueFloatText({
            x: damage.x,
            y: damage.y,
            value: damage.value,
            timeLeft: 900
        }, { broadcast: false });
    }
    if (healing && Number.isFinite(healing.value) && healing.value > 0) {
        enqueueFloatText({
            kind: 'heal',
            x: healing.x,
            y: healing.y,
            value: healing.value,
            timeLeft: 1000
        }, { broadcast: false });
    }
});
on('fx:soulRecall', ({ fromX, fromY, toX, toY, unit }) => {
    unit._soulRecallLandAt = spawnSoulRecallEffect(fromX, fromY, toX, toY);
});
