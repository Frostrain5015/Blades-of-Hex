// DOM 层：常驻 HUD、商店面板、背包/装备面板、对话框、播报条。
// 沿用主游戏的写法：createElement + replaceChildren + textContent，不用 innerHTML；
// HUD 用签名判脏，避免每帧重建 DOM（见 js/input.js 的 _renderBoardActionQueue）。

import { ITEMS, SKILLS, PASSIVE, HERO, MERCHANTS, NPCS } from './data.js';
import { SLOTS, previewEquip, rankName, xpToNext, equip, unequip, consume } from './character.js';
import { buy, sell, buybackPrice, accepts } from './shop.js';
import { formatMoney, clamp } from './util.js';

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};

export const ui = {
    mode: 'world',            // 'world' | 'shop' | 'bag' | 'dialogue'
    shopId: null,
    selected: null,           // { source: 'stock'|'bag'|'slot', itemId, slot }
    dialogue: null,
    toasts: [],
    _hudSig: '',
    _panelSig: ''
};

let dom = {};
let game = null;

// ============ 初始化 ============

export function initUi(gameRef) {
    game = gameRef;
    dom = {
        hud: document.getElementById('hud'),
        portrait: document.getElementById('hud-portrait'),
        name: document.getElementById('hud-name'),
        rank: document.getElementById('hud-rank'),
        hpFill: document.getElementById('hud-hp-fill'),
        hpText: document.getElementById('hud-hp-text'),
        xpFill: document.getElementById('hud-xp-fill'),
        money: document.getElementById('hud-money'),
        skills: document.getElementById('hud-skills'),
        district: document.getElementById('district'),
        panel: document.getElementById('panel'),
        dialogue: document.getElementById('dialogue'),
        dlgPortrait: document.getElementById('dlg-portrait'),
        dlgSpeaker: document.getElementById('dlg-speaker'),
        dlgText: document.getElementById('dlg-text'),
        toast: document.getElementById('toast'),
        hint: document.getElementById('hint')
    };
    dom.portrait.src = HERO.portrait;
    dom.name.textContent = `${HERO.name} · ${HERO.title}`;
    buildSkillBar();
    updateHud(true);
}

function buildSkillBar() {
    const rows = [SKILLS.slash, SKILLS.press, SKILLS.formation];
    const frag = document.createDocumentFragment();
    for (const skill of rows) {
        const box = el('div', 'skill');
        box.dataset.skill = skill.id;
        const ring = el('div', 'skill-ring');
        const glyph = el('div', 'skill-glyph', skill.glyph);
        ring.appendChild(glyph);
        box.appendChild(ring);
        box.appendChild(el('div', 'skill-key', skill.key));
        box.appendChild(el('div', 'skill-name', skill.name));
        box.title = `${skill.name}（${skill.key}）：${skill.desc}`;
        frag.appendChild(box);
    }
    const passive = el('div', 'skill is-passive');
    const ring = el('div', 'skill-ring');
    ring.appendChild(el('div', 'skill-glyph', PASSIVE.glyph));
    passive.appendChild(ring);
    passive.appendChild(el('div', 'skill-key', '被动'));
    passive.appendChild(el('div', 'skill-name', PASSIVE.name));
    passive.title = `${PASSIVE.name}：${PASSIVE.desc}`;
    frag.appendChild(passive);
    dom.skills.replaceChildren(frag);
}

// ============ HUD ============

export function updateHud(force) {
    const ch = game.character;
    const s = ch.stats;
    const next = xpToNext(ch.rank);
    const sig = [
        ch.hp, s.maxHp, ch.moneyCents, ch.rank, ch.xp, s.attack, s.defense.toFixed(3),
        Math.ceil(game.combat.cooldowns.press * 10), Math.ceil(game.combat.cooldowns.formation * 10),
        game.districtName()
    ].join('|');
    if (!force && sig === ui._hudSig) return;
    ui._hudSig = sig;

    dom.rank.textContent = `${rankName(ch.rank)}　攻 ${s.attack}　防 ${Math.round(s.defense * 100)}%`;
    dom.hpFill.style.width = `${clamp(ch.hp / s.maxHp, 0, 1) * 100}%`;
    dom.hpText.textContent = `${ch.hp} / ${s.maxHp}`;
    const prev = ch.rank > 0 ? xpToNext(ch.rank - 1) : 0;
    const ratio = next === null ? 1 : clamp((ch.xp - prev) / Math.max(1, next - prev), 0, 1);
    dom.xpFill.style.width = `${ratio * 100}%`;
    dom.money.textContent = formatMoney(ch.moneyCents);
    dom.district.textContent = game.districtName();

    for (const box of dom.skills.children) {
        const id = box.dataset.skill;
        if (!id) continue;
        const cd = game.combat.cooldowns[id] || 0;
        const total = SKILLS[id].balance.cooldown;
        const ring = box.firstChild;
        const pct = total > 0 ? clamp(cd / total, 0, 1) : 0;
        ring.style.setProperty('--cd', `${pct * 360}deg`);
        box.classList.toggle('is-cooling', cd > 0.02);
    }
}

// ============ 播报 ============

export function toast(text) {
    ui.toasts.push({ text, life: 4.2 });
    if (ui.toasts.length > 5) ui.toasts.shift();
    renderToasts();
}

function renderToasts() {
    const frag = document.createDocumentFragment();
    for (const t of ui.toasts) {
        const line = el('div', 'toast-line', t.text);
        line.style.opacity = String(clamp(t.life / 1.2, 0, 1));
        frag.appendChild(line);
    }
    dom.toast.replaceChildren(frag);
}

export function tickToasts(dt) {
    if (ui.toasts.length === 0) return;
    let dirty = false;
    for (let i = ui.toasts.length - 1; i >= 0; i--) {
        ui.toasts[i].life -= dt;
        if (ui.toasts[i].life <= 0) { ui.toasts.splice(i, 1); dirty = true; }
        else if (ui.toasts[i].life < 1.2) dirty = true;
    }
    if (dirty) renderToasts();
}

// ============ 对话 ============

export function showDialogue(speaker, portrait, lines, onDone) {
    ui.mode = 'dialogue';
    ui.dialogue = { speaker, portrait, lines: lines.slice(), index: 0, onDone };
    dom.dialogue.classList.add('show');
    renderDialogue();
}

function renderDialogue() {
    const d = ui.dialogue;
    dom.dlgPortrait.src = d.portrait;
    dom.dlgSpeaker.textContent = d.speaker;
    dom.dlgText.textContent = d.lines[d.index];
}

/** 推进一句；已到结尾则关闭并回调。 */
export function advanceDialogue() {
    const d = ui.dialogue;
    if (!d) return;
    d.index += 1;
    if (d.index >= d.lines.length) {
        dom.dialogue.classList.remove('show');
        ui.dialogue = null;
        ui.mode = 'world';
        if (d.onDone) d.onDone();
        return;
    }
    renderDialogue();
}

// ============ 面板 ============

export function openShop(shopId) {
    ui.mode = 'shop';
    ui.shopId = shopId;
    ui.selected = null;
    ui._panelSig = '';
    dom.panel.classList.add('show');
    renderPanel();
}

export function openBag() {
    ui.mode = 'bag';
    ui.selected = null;
    ui._panelSig = '';
    dom.panel.classList.add('show');
    renderPanel();
}

export function closePanel() {
    ui.mode = 'world';
    ui.shopId = null;
    ui.selected = null;
    dom.panel.classList.remove('show');
    dom.panel.replaceChildren();
}

export function isBlocking() { return ui.mode !== 'world'; }

function itemRow(itemId, opts) {
    const item = ITEMS[itemId];
    const row = el('div', 'row');
    row.dataset.itemId = itemId;
    if (opts.selected) row.classList.add('is-selected');
    if (opts.disabled) row.classList.add('is-disabled');

    row.appendChild(el('span', 'row-glyph', item.glyph));
    const mid = el('div', 'row-mid');
    mid.appendChild(el('span', 'row-name', item.name + (opts.count > 1 ? ` ×${opts.count}` : '')));
    mid.appendChild(el('span', 'row-slot', slotLabel(item)));
    row.appendChild(mid);
    if (opts.price !== undefined) {
        const price = el('span', 'row-price', item.priceless ? '非卖品' : formatMoney(opts.price));
        if (opts.affordable === false) price.classList.add('is-poor');
        row.appendChild(price);
    }
    if (opts.action) {
        const btn = el('button', 'row-btn', opts.action.label);
        btn.dataset.action = opts.action.kind;
        btn.dataset.itemId = itemId;
        if (opts.action.disabled) btn.disabled = true;
        row.appendChild(btn);
    }
    return row;
}

const SLOT_NAMES = Object.freeze({ weapon: '武器', armor: '护甲', offhand: '副手', trinket: '饰品' });
function slotLabel(item) {
    if (item.slot) return SLOT_NAMES[item.slot];
    if (item.use && item.use.healPct) return `消耗 · 回复 ${Math.round(item.use.healPct * 100)}%`;
    return '消耗';
}

function statsBlock() {
    const ch = game.character;
    const cur = ch.stats;
    const sel = ui.selected;
    const item = sel ? ITEMS[sel.itemId] : null;
    const next = item && item.slot && sel.source !== 'slot' ? previewEquip(ch, sel.itemId) : null;

    const wrap = el('div', 'stats');
    wrap.appendChild(el('div', 'stats-title', sel && next ? `装上「${item.name}」后` : '当前面板'));
    const rows = [
        ['生命上限', cur.maxHp, next && next.maxHp, v => String(v)],
        ['攻击力', cur.attack, next && next.attack, v => String(v)],
        ['防御减伤', cur.defense, next && next.defense, v => `${Math.round(v * 100)}%`],
        ['暴击率', cur.critRate, next && next.critRate, v => `${Math.round(v * 100)}%`],
        ['移动速度', cur.moveSpeed, next && next.moveSpeed, v => String(Math.round(v))]
    ];
    for (const [label, a, b, fmt] of rows) {
        const line = el('div', 'stat-line');
        line.appendChild(el('span', 'stat-label', label));
        const valueBox = el('span', 'stat-value');
        valueBox.appendChild(el('span', null, fmt(a)));
        if (b !== null && b !== undefined && Math.abs(b - a) > 1e-6) {
            valueBox.appendChild(el('span', 'stat-arrow', '→'));
            const delta = el('span', b > a ? 'stat-up' : 'stat-down', fmt(b));
            valueBox.appendChild(delta);
        }
        line.appendChild(valueBox);
        wrap.appendChild(line);
    }
    if (item) {
        wrap.appendChild(el('div', 'stat-desc', item.desc));
    }
    return wrap;
}

function equipmentBlock() {
    const ch = game.character;
    const box = el('div', 'equip');
    box.appendChild(el('div', 'col-title', '装备'));
    for (const slot of SLOTS) {
        const itemId = ch.equipment[slot];
        const cell = el('div', 'equip-slot');
        cell.dataset.slot = slot;
        if (ui.selected && ui.selected.source === 'slot' && ui.selected.slot === slot) cell.classList.add('is-selected');
        cell.appendChild(el('span', 'equip-slot-name', SLOT_NAMES[slot]));
        if (itemId) {
            const item = ITEMS[itemId];
            cell.appendChild(el('span', 'equip-glyph', item.glyph));
            cell.appendChild(el('span', 'equip-item', item.name));
            if (!item.priceless) {
                const btn = el('button', 'row-btn', '卸下');
                btn.dataset.action = 'unequip';
                btn.dataset.slot = slot;
                cell.appendChild(btn);
            }
        } else {
            cell.appendChild(el('span', 'equip-empty', '空'));
        }
        box.appendChild(cell);
    }
    return box;
}

function renderPanel() {
    const ch = game.character;
    const frag = document.createDocumentFragment();
    const card = el('div', 'panel-card');

    // —— 头部 ——
    const head = el('div', 'panel-head');
    if (ui.mode === 'shop') {
        const shop = game.shops[ui.shopId];
        const img = el('img', 'panel-portrait');
        img.src = shop.def.portrait;
        img.alt = '';
        head.appendChild(img);
        const info = el('div', 'panel-head-info');
        info.appendChild(el('div', 'panel-title', shop.def.name));
        info.appendChild(el('div', 'panel-sub', shop.def.greeting));
        head.appendChild(info);
    } else {
        const img = el('img', 'panel-portrait');
        img.src = HERO.portrait;
        img.alt = '';
        head.appendChild(img);
        const info = el('div', 'panel-head-info');
        info.appendChild(el('div', 'panel-title', `${HERO.name} · ${rankName(ch.rank)}`));
        info.appendChild(el('div', 'panel-sub', `鸢尾誓章 ${HERO.oath}　经验 ${ch.xp}`));
        head.appendChild(info);
    }
    const purse = el('div', 'panel-purse');
    purse.appendChild(el('div', 'purse-label', '钱袋'));
    purse.appendChild(el('div', 'purse-value', formatMoney(ch.moneyCents)));
    head.appendChild(purse);
    card.appendChild(head);

    // —— 三栏 ——
    const body = el('div', 'panel-body');

    const left = el('div', 'col');
    if (ui.mode === 'shop') {
        const shop = game.shops[ui.shopId];
        left.appendChild(el('div', 'col-title', '货架'));
        const list = el('div', 'list');
        list.dataset.source = 'stock';
        for (const row of shop.stock) {
            if (row.count <= 0) continue;
            const item = ITEMS[row.item];
            list.appendChild(itemRow(row.item, {
                count: row.count,
                price: item.price,
                affordable: ch.moneyCents >= item.price,
                selected: ui.selected && ui.selected.source === 'stock' && ui.selected.itemId === row.item,
                action: { kind: 'buy', label: '买', disabled: ch.moneyCents < item.price }
            }));
        }
        if (!list.hasChildNodes()) list.appendChild(el('div', 'list-empty', '货架空了'));
        left.appendChild(list);
    } else {
        left.appendChild(equipmentBlock());
    }
    body.appendChild(left);

    const mid = el('div', 'col');
    mid.appendChild(el('div', 'col-title', '行囊'));
    const bag = el('div', 'list');
    bag.dataset.source = 'bag';
    for (const row of ch.inventory) {
        const item = ITEMS[row.id];
        let action = null;
        if (ui.mode === 'shop') {
            const ok = accepts(game.shops[ui.shopId], row.id);
            action = { kind: 'sell', label: '卖', disabled: !ok };
        } else if (item.slot) {
            action = { kind: 'equip', label: '装备' };
        } else if (item.use) {
            action = { kind: 'use', label: '使用' };
        }
        bag.appendChild(itemRow(row.id, {
            count: row.count,
            price: ui.mode === 'shop' ? buybackPrice(row.id) : item.price,
            selected: ui.selected && ui.selected.source === 'bag' && ui.selected.itemId === row.id,
            action
        }));
    }
    if (!bag.hasChildNodes()) bag.appendChild(el('div', 'list-empty', '行囊是空的'));
    mid.appendChild(bag);
    body.appendChild(mid);

    const right = el('div', 'col');
    right.appendChild(statsBlock());
    if (ui.mode === 'shop') {
        right.appendChild(el('div', 'panel-note', `回购按售价五成计。选中货品可预览面板变化。`));
    } else {
        right.appendChild(el('div', 'panel-note', '点选行囊里的物品可预览装备后的面板差值。'));
    }
    body.appendChild(right);

    card.appendChild(body);

    const foot = el('div', 'panel-foot');
    foot.appendChild(el('span', null, ui.mode === 'shop' ? 'ESC / E 离开摊子' : 'ESC / I 收起行囊'));
    card.appendChild(foot);

    frag.appendChild(card);
    dom.panel.replaceChildren(frag);
}

// ============ 面板交互 ============

export function bindPanelEvents() {
    dom.panel.addEventListener('click', (event) => {
        const btn = event.target.closest('button[data-action]');
        if (btn) { handleAction(btn.dataset.action, btn.dataset.itemId, btn.dataset.slot); return; }
        const slotCell = event.target.closest('.equip-slot');
        if (slotCell) {
            const slot = slotCell.dataset.slot;
            const itemId = game.character.equipment[slot];
            ui.selected = itemId ? { source: 'slot', itemId, slot } : null;
            renderPanel();
            return;
        }
        const row = event.target.closest('.row');
        if (row) {
            const list = row.closest('.list');
            ui.selected = { source: list ? list.dataset.source : 'bag', itemId: row.dataset.itemId };
            renderPanel();
        }
    });
    dom.dialogue.addEventListener('click', () => advanceDialogue());
}

function handleAction(action, itemId, slot) {
    const ch = game.character;
    switch (action) {
        case 'buy': {
            const shop = game.shops[ui.shopId];
            const result = buy(shop, ch, itemId);
            toast(result.ok ? `买入 ${result.item.name}，-${formatMoney(result.price)}` : result.reason);
            break;
        }
        case 'sell': {
            const shop = game.shops[ui.shopId];
            const result = sell(shop, ch, itemId);
            toast(result.ok ? `卖出 ${result.item.name}，+${formatMoney(result.price)}` : result.reason);
            break;
        }
        case 'equip': {
            if (equip(ch, itemId)) toast(`装备 ${ITEMS[itemId].name}　攻 ${ch.stats.attack}　防 ${Math.round(ch.stats.defense * 100)}%`);
            break;
        }
        case 'unequip': {
            if (unequip(ch, slot)) toast(`卸下 ${SLOT_NAMES[slot]}`);
            break;
        }
        case 'use': {
            const text = consume(ch, itemId);
            if (text) toast(text);
            break;
        }
        default: break;
    }
    ui.selected = null;
    renderPanel();
    updateHud(true);
}

/** 面板内容依赖角色状态，外部改动后调用它刷新。 */
export function refreshPanel() {
    if (ui.mode === 'shop' || ui.mode === 'bag') renderPanel();
}

// ============ 底部操作提示 ============

export function setHint(text) {
    if (dom.hint.textContent !== text) dom.hint.textContent = text;
}

export const MERCHANT_DEFS = MERCHANTS;
export const NPC_DEFS = NPCS;
