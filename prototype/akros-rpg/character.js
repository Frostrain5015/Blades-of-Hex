// 角色：基础属性 → 派生属性、装备修饰层、军衔与经验、金钱与背包。
//
// 三条铁律：
//   1. base 是唯一真值。派生属性每次重算，绝不存为真值——否则改一次属性就到处不同步。
//   2. 装备走可逆的修饰层：装备 push 一条、卸下 pop 同一条，永不改写 base。
//   3. 金钱一律以整数「分」存储（1 $ = 100 分）。浮点数存钱会在反复买卖里累积成脏数据。

import { clamp } from './util.js';
import { HERO, ITEMS, RANK, COMBAT } from './data.js';

export const SLOTS = Object.freeze(['weapon', 'armor', 'offhand', 'trinket']);
const INVENTORY_CAP = 24;

// ============ 构造 ============

export function createCharacter() {
    const ch = {
        base: { ...HERO.base },
        mods: [],                       // [{ source, entries }]
        equipment: { weapon: null, armor: null, offhand: null, trinket: null },
        inventory: [],                  // [{ id, count }]
        moneyCents: HERO.startMoney,
        rank: 0,
        xp: 0,
        hp: 0,
        buffs: { nextHitBonus: 0 },
        stats: null
    };
    for (const [slot, itemId] of Object.entries(HERO.startEquipment)) {
        addItem(ch, itemId, 1);
        equip(ch, itemId);
        void slot;
    }
    ch.stats = derive(ch);
    ch.hp = ch.stats.maxHp;
    return ch;
}

// ============ 派生属性 ============

/**
 * 纯函数：base + 修饰层 → 战斗面板。每次读取都重算。
 * 顺序遵循 base → 属性平移 → 派生 → 数值加成 → 百分比 → 钳制。
 */
export function derive(ch) {
    const arche = HERO.archetype;
    const attr = { ...ch.base };
    const flat = { maxHp: 0, attack: 0, defense: 0, critRate: 0, moveSpeed: 0, formationBonus: 0 };
    const pct = { maxHp: 0, attack: 0, defense: 0, critRate: 0, moveSpeed: 0 };

    for (let i = 0, len = ch.mods.length; i < len; i++) {
        const entries = ch.mods[i].entries;
        for (let k = 0; k < entries.length; k++) {
            const m = entries[k];
            if (m.stat in attr) { attr[m.stat] += m.value; continue; }
            if (m.type === 'pct') pct[m.stat] = (pct[m.stat] || 0) + m.value;
            else flat[m.stat] = (flat[m.stat] || 0) + m.value;
        }
    }

    const rankCrit = ch.rank >= 4 ? RANK.critBonusAtFourthRank : 0;

    return {
        might: attr.might, vigor: attr.vigor, agility: attr.agility,
        maxHp: Math.round((60 + attr.vigor * 5 + flat.maxHp) * (1 + arche.hpBonusPct + pct.maxHp)),
        attack: Math.round((attr.might * 0.8 + flat.attack) * (1 + arche.atkBonusPct + pct.attack)),
        defense: clamp(0.02 + attr.agility * 0.004 + flat.defense, 0, COMBAT.defense.maximumReduction),
        critRate: clamp(0.05 + attr.agility * 0.005 + flat.critRate + rankCrit, 0, 0.60),
        moveSpeed: (112 + attr.agility * 2 + arche.spdBonus * 8 + flat.moveSpeed) * (1 + pct.moveSpeed),
        formationBonus: flat.formationBonus
    };
}

/** 重算并缓存面板；任何会改变面板的操作都必须调用。 */
export function refresh(ch) {
    const before = ch.stats ? ch.stats.maxHp : 0;
    ch.stats = derive(ch);
    if (ch.stats.maxHp !== before && before > 0) {
        ch.hp = Math.min(ch.stats.maxHp, ch.hp + Math.max(0, ch.stats.maxHp - before));
    }
    ch.hp = clamp(ch.hp, 0, ch.stats.maxHp);
    return ch.stats;
}

/** 面板预览：假设装上某件物品后的面板，用于商店/背包的差值显示（不产生副作用）。 */
export function previewEquip(ch, itemId) {
    const item = ITEMS[itemId];
    if (!item || !item.slot) return ch.stats;
    const probe = { base: ch.base, rank: ch.rank, mods: ch.mods.filter(l => l.source !== item.slot) };
    if (item.modifiers) probe.mods = probe.mods.concat([{ source: item.slot, entries: item.modifiers }]);
    return derive(probe);
}

// ============ 装备（push / pop 对称） ============

export function equip(ch, itemId) {
    const item = ITEMS[itemId];
    if (!item || !item.slot) return false;
    const current = ch.equipment[item.slot];
    if (current) unequip(ch, item.slot);
    if (!takeItem(ch, itemId, 1)) return false;
    ch.equipment[item.slot] = itemId;
    if (item.modifiers) ch.mods.push({ source: item.slot, entries: item.modifiers });
    refresh(ch);
    return true;
}

export function unequip(ch, slot) {
    const itemId = ch.equipment[slot];
    if (!itemId) return false;
    ch.equipment[slot] = null;
    for (let i = ch.mods.length - 1; i >= 0; i--) {
        if (ch.mods[i].source === slot) { ch.mods.splice(i, 1); break; }
    }
    addItem(ch, itemId, 1);
    refresh(ch);
    return true;
}

// ============ 背包 ============

export function addItem(ch, itemId, count = 1) {
    const row = ch.inventory.find(r => r.id === itemId);
    if (row) { row.count += count; return true; }
    if (ch.inventory.length >= INVENTORY_CAP) return false;
    ch.inventory.push({ id: itemId, count });
    return true;
}

export function takeItem(ch, itemId, count = 1) {
    const index = ch.inventory.findIndex(r => r.id === itemId);
    if (index < 0 || ch.inventory[index].count < count) return false;
    ch.inventory[index].count -= count;
    if (ch.inventory[index].count <= 0) ch.inventory.splice(index, 1);
    return true;
}

export function countItem(ch, itemId) {
    const row = ch.inventory.find(r => r.id === itemId);
    return row ? row.count : 0;
}

/** 使用消耗品。返回一段可供 HUD 播报的文本，失败返回 null。 */
export function consume(ch, itemId) {
    const item = ITEMS[itemId];
    if (!item || !item.use) return null;
    if (!takeItem(ch, itemId, 1)) return null;
    if (item.use.healPct) {
        const healed = Math.min(ch.stats.maxHp - ch.hp, Math.round(ch.stats.maxHp * item.use.healPct));
        ch.hp += healed;
        return `${item.name} +${healed} HP`;
    }
    if (item.use.nextHitBonus) {
        ch.buffs.nextHitBonus = item.use.nextHitBonus;
        return `${item.name}：下一击伤害提高 ${Math.round(item.use.nextHitBonus * 100)}%`;
    }
    return item.name;
}

// ============ 金钱（整数分） ============

export function addMoney(ch, cents) {
    ch.moneyCents = Math.max(0, ch.moneyCents + Math.round(cents));
    return ch.moneyCents;
}

export function canAfford(ch, cents) { return ch.moneyCents >= cents; }

export function spendMoney(ch, cents) {
    const amount = Math.round(cents);
    if (ch.moneyCents < amount) return false;
    ch.moneyCents -= amount;
    return true;
}

// ============ 军衔与经验 ============

export function rankName(rank) { return RANK.names[Math.min(rank, RANK.names.length - 1)]; }

/** 下一衔所需的累计经验；已满衔返回 null。 */
export function xpToNext(rank) {
    return rank < RANK.xpThresholds.length ? RANK.xpThresholds[rank] : null;
}

/**
 * 获得经验。【老兵】的 ×2 由调用方在 amount 上体现，这里只管晋升。
 * 返回本次晋升的衔数（0 表示未升）。
 */
export function gainXp(ch, amount) {
    ch.xp += amount;
    let promoted = 0;
    while (ch.rank < RANK.xpThresholds.length && ch.xp >= RANK.xpThresholds[ch.rank]) {
        ch.rank += 1;
        promoted += 1;
        ch.base.might += RANK.gainPerRank.might;
        ch.base.vigor += RANK.gainPerRank.vigor;
        ch.base.agility += RANK.gainPerRank.agility;
    }
    if (promoted > 0) {
        const before = ch.stats.maxHp;
        refresh(ch);
        ch.hp = Math.min(ch.stats.maxHp, ch.hp + (ch.stats.maxHp - before));   // 晋升补足新增生命
    }
    return promoted;
}

/** 阵亡结算：损失两成现金，满血复活。 */
export function onDeath(ch) {
    const lost = Math.round(ch.moneyCents * COMBAT.deathMoneyLossPct);
    ch.moneyCents -= lost;
    ch.hp = ch.stats.maxHp;
    ch.buffs.nextHitBonus = 0;
    return lost;
}
