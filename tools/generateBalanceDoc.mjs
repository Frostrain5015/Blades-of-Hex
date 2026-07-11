// tools/generateBalanceDoc.mjs — 从 rules/ 生成平衡参考文档。
// 用法：node tools/generateBalanceDoc.mjs   （输出 docs/BALANCE.md）
// README 不再手工维护数值表；本文档由规则定义生成，改数值后重新运行即可。

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const { UNIT_CONFIG, COUNTER_RELATION } = await import('../rules/units.js');
const { GAME_RULES, COMBAT_BALANCE, calcIncome } = await import('../rules/constants.js');
const { TERRAIN_CONFIG, FORTIFICATION_CONFIG, MORALE_CONFIG, WEATHER_CONFIG } = await import('../rules/terrain.js');
const { TACTICAL_CARD_DATA, COLONEL_CARD_DATA } = await import('../rules/cards.js');
const { COMMANDER_CONFIG } = await import('../rules/commanders.js');
const { FRONTEND_TEXT } = await import('../rules/uiText.js');

const lines = [];
const P = (s = '') => lines.push(s);
const pct = (v) => `${Math.round(v * 100)}%`;

P('# Blades of Hex — 平衡参考（自动生成）');
P();
P('> 本文件由 `node tools/generateBalanceDoc.mjs` 从 `rules/` 生成，请勿手工编辑。');
P();

P('## 兵种');
P();
P('| 兵种 | HP | ATK | 防御 | 移动 | 射程 | 造价 | 被动 |');
P('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const [key, u] of Object.entries(UNIT_CONFIG)) {
    const passive = FRONTEND_TEXT.unitPassives[key];
    const passiveText = passive ? `**${passive.name}** ${passive.desc}` : '—';
    P(`| ${u.name} (${key}) | ${u.hp} | ${u.attack} | ${pct(u.defense)} | ${u.speed} | ${u.range} | $${u.cost} | ${passiveText} |`);
}
P();

P('### 克制关系（行攻击列）');
P();
const unitKeys = Object.keys(COUNTER_RELATION);
P(`| 攻击方 \\ 目标 | ${unitKeys.map(k => UNIT_CONFIG[k].name).join(' | ')} |`);
P(`| --- | ${unitKeys.map(() => '---').join(' | ')} |`);
for (const atk of unitKeys) {
    P(`| ${UNIT_CONFIG[atk].name} | ${unitKeys.map(def => `×${COUNTER_RELATION[atk][def]}`).join(' | ')} |`);
}
P();

P('## 经济');
P();
P(`- 城市收入：1 城 $${calcIncome(1)}，2 城 $${calcIncome(2)}，3 城 $${calcIncome(3)}，4 城 $${calcIncome(4)}`);
P(`- 村庄产出：$${GAME_RULES.villageGold}/回合（村庄间最小距离 ${GAME_RULES.villageMinDistance}）`);
P(`- 洗牌换将成本：$${GAME_RULES.commanderRerollCost}`);
P(`- 对策卡：抽卡 $${GAME_RULES.cardSystem.drawCost}，手牌上限 ${GAME_RULES.cardSystem.maxHandSize}，每回合最多抽 ${GAME_RULES.cardSystem.maxDrawsPerTurn} 张 / 用 ${GAME_RULES.cardSystem.maxUsesPerTurn} 张`);
P(`- 天气循环：前 ${GAME_RULES.weatherCycle.warmupRounds} 回合晴朗，随后特殊天气 ${GAME_RULES.weatherCycle.weatherDuration} 回合 / 晴 ${GAME_RULES.weatherCycle.clearDuration} 回合交替`);
P(`- 选将：普通模式每人 ${GAME_RULES.commanderDraft.candidatesPerPlayer} 选 1；双将模式每人 ${GAME_RULES.commanderDraft.dualCandidatesPerPlayer} 选 ${GAME_RULES.commanderDraft.dualCommanderCount}`);
P();

P('## 地形与工事');
P();
P('| 名称 | 防御加成 | 每步消耗 | 说明 |');
P('| --- | --- | --- | --- |');
for (const t of Object.values(TERRAIN_CONFIG)) {
    P(`| ${t.name} | ${pct(t.defenseBonus)} | ${t.stepCost} | ${t.moveDesc || '—'} |`);
}
for (const f of Object.values(FORTIFICATION_CONFIG)) {
    P(`| ${f.name} | ${pct(f.defenseBonus)}（${f.appliesTo === 'melee' ? '近战' : '远程'}） | — | ${f.desc} |`);
}
P();

P('## 士气');
P();
P('| 状态 | 防御修正 | 效果 |');
P('| --- | --- | --- |');
for (const key of [3, 2, 1, 0]) {
    const m = MORALE_CONFIG[key];
    P(`| ${m.name} | ${pct(m.defBonus)} | ${m.desc || '—'} |`);
}
P();

P('## 天气');
P();
for (const w of Object.values(WEATHER_CONFIG)) {
    P(`- **${w.name}** ${w.icon}：${w.desc}`);
}
P();

P('## 对策卡');
P();
for (const c of Object.values(TACTICAL_CARD_DATA)) {
    P(`- **${c.name}** ${c.icon}：${c.desc.replace(/\n/g, ' ')}`);
}
P();
P('### 空军上校专属卡');
P();
for (const key of ['diveStrafe', 'carpetBomb', 'airlift']) {
    const c = COLONEL_CARD_DATA[key];
    P(`- **${c.name}** ${c.icon}（$${COLONEL_CARD_DATA.goldCost[key]}）：${c.desc.replace(/\n/g, ' ')}`);
}
P(`- 航程 ${COLONEL_CARD_DATA.range} 格；防空半径 ${COLONEL_CARD_DATA.antiairRadius} 格；每用 1 张空军卡伤害 +${pct(COLONEL_CARD_DATA.airDamagePerStack)}（最多 ${COLONEL_CARD_DATA.maxAirDamageStacks} 层）`);
P();

P('## 将领');
P();
for (const [key, cfg] of Object.entries(COMMANDER_CONFIG)) {
    const d = cfg.definition;
    const buffs = [
        d.hpBonusPct ? `HP+${pct(d.hpBonusPct)}` : null,
        d.atkBonusPct ? `ATK+${pct(d.atkBonusPct)}` : null,
        d.spdBonus ? `移速+${d.spdBonus}` : null
    ].filter(Boolean).join(' / ') || '无部署加成';
    P(`### ${d.name}（${key}）`);
    P();
    P(`部署加成：${buffs}`);
    P();
    if (d.skills) {
        for (const s of d.skills) {
            P(`- 【${s.name}】(${s.type === 'active' ? '主动' : '被动'})：${s.desc || '—'}`);
        }
    } else if (d.desc) {
        P(`- 【${d.skill}】：${d.desc}`);
    }
    P();
}

P('## 战斗管线参数');
P();
P('```json');
P(JSON.stringify(COMBAT_BALANCE, null, 2));
P('```');
P();

mkdirSync(join(root, 'docs'), { recursive: true });
const outPath = join(root, 'docs', 'BALANCE.md');
writeFileSync(outPath, lines.join('\n'), 'utf8');
console.log(`已生成 ${outPath}（${lines.length} 行）`);
