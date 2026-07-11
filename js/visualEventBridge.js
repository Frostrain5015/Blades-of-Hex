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
    spawnSoulRecallEffect
} from './effects.js';
import { playSound } from './audio.js';

on('fx:healFlash', ({ x, y }) => triggerHealFlash(x, y));
on('fx:healParticles', ({ x, y }) => spawnHealParticles(x, y));
on('fx:commanderSkill', ({ x, y, glyph, label }) => spawnCommanderSkillEffect(x, y, glyph, label));
on('fx:morale', ({ unit }) => spawnMoraleEffect(unit));
on('fx:factionMorale', ({ color }) => triggerFactionMoraleFlash(color));
on('fx:explosion', ({ x, y, color, count }) => spawnExplosionParticles(x, y, color, count));
on('fx:screenShake', ({ strength, duration }) => triggerScreenShake(strength, duration));
on('fx:rankUp', ({ x, y, rank }) => spawnRankUpEffect(x, y, rank));
on('audio:play', ({ soundName }) => playSound(soundName));
on('fx:soulRecall', ({ fromX, fromY, toX, toY, unit }) => {
    unit._soulRecallLandAt = spawnSoulRecallEffect(fromX, fromY, toX, toY);
});
