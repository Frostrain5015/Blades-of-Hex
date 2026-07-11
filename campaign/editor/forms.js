// 编辑器表单助手 —— 纯 DOM 构建工具，不含业务逻辑。
// 约定：所有 onChange 回调只上报新值，由 editor.js 统一走 mutate() 修改配置。

export function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

export function section(labelText) {
    const box = el('div', 'ed-section');
    if (labelText) box.appendChild(el('div', 'ed-section-label', labelText));
    return box;
}

function row(labelText) {
    const r = el('div', 'ed-row');
    if (labelText != null) r.appendChild(el('label', null, labelText));
    return r;
}

export function textRow(labelText, value, onChange, placeholder = '') {
    const r = row(labelText);
    const input = el('input');
    input.type = 'text';
    input.value = value ?? '';
    input.placeholder = placeholder;
    input.addEventListener('change', () => onChange(input.value.trim()));
    r.appendChild(input);
    return r;
}

export function numRow(labelText, value, onChange, { min, max, step } = {}) {
    const r = row(labelText);
    const input = el('input');
    input.type = 'number';
    if (min != null) input.min = min;
    if (max != null) input.max = max;
    if (step != null) input.step = step;
    input.value = value ?? 0;
    input.addEventListener('change', () => onChange(Number(input.value)));
    r.appendChild(input);
    return r;
}

/**
 * 下拉行。options 为 [{value,label}]，或 {value:label} 映射。
 */
export function selectRow(labelText, value, options, onChange) {
    const r = row(labelText);
    const sel = el('select');
    const list = Array.isArray(options)
        ? options
        : Object.entries(options).map(([v, label]) => ({ value: v, label }));
    for (const opt of list) {
        const o = el('option', null, opt.label);
        o.value = opt.value;
        sel.appendChild(o);
    }
    sel.value = value ?? (list[0]?.value ?? '');
    sel.addEventListener('change', () => onChange(sel.value));
    r.appendChild(sel);
    return r;
}

export function checkRow(labelText, checked, onChange) {
    const r = row(labelText);
    const input = el('input');
    input.type = 'checkbox';
    input.checked = !!checked;
    input.addEventListener('change', () => onChange(input.checked));
    r.appendChild(input);
    return r;
}

export function textareaRow(labelText, value, onChange, rows = 3) {
    const r = row(labelText);
    const area = el('textarea');
    area.rows = rows;
    area.value = value ?? '';
    area.addEventListener('change', () => onChange(area.value));
    r.appendChild(area);
    return r;
}

/** 复选组：用于 allow 白名单（多选卡牌/单位）。items=[{value,label}] */
export function checkGroup(labelText, items, selected, onChange) {
    const box = section(labelText);
    const set = new Set(selected || []);
    for (const item of items) {
        const r = row(null);
        const input = el('input');
        input.type = 'checkbox';
        input.checked = set.has(item.value);
        input.addEventListener('change', () => {
            if (input.checked) set.add(item.value); else set.delete(item.value);
            onChange([...set]);
        });
        const lab = el('label', null, item.label);
        lab.style.flex = '1 1 auto';
        r.appendChild(input);
        r.appendChild(lab);
        box.appendChild(r);
    }
    return box;
}

/**
 * 可选中列表 + 删除按钮 + 新增按钮。
 * items=[{key,label}]，activeKey 高亮项。
 */
export function itemList({ items, activeKey, onSelect, onDelete, addLabel, onAdd }) {
    const wrap = el('div');
    const list = el('div', 'ed-list');
    for (const item of items) {
        const li = el('div', 'ed-list-item' + (item.key === activeKey ? ' active' : ''));
        const label = el('span', 'ed-item-label', item.label);
        li.appendChild(label);
        if (onDelete) {
            const del = el('button', 'ed-item-del', '✕');
            del.title = '删除';
            del.addEventListener('click', (e) => { e.stopPropagation(); onDelete(item.key); });
            li.appendChild(del);
        }
        li.addEventListener('click', () => onSelect?.(item.key));
        list.appendChild(li);
    }
    wrap.appendChild(list);
    if (onAdd) {
        const add = el('button', 'ed-add-btn', addLabel || '+ 新增');
        add.addEventListener('click', onAdd);
        wrap.appendChild(add);
    }
    return wrap;
}

/** 卡片容器（触发器的条件/动作块）。 */
export function card(titleText, onRemove) {
    const box = el('div', 'ed-card');
    const head = el('div', 'ed-card-head');
    head.appendChild(el('span', null, titleText));
    if (onRemove) {
        const del = el('button', 'ed-item-del', '✕');
        del.addEventListener('click', onRemove);
        head.appendChild(del);
    }
    box.appendChild(head);
    return box;
}

export function hint(text) {
    return el('div', 'ed-hint', text);
}

/** 解析 "q,r; q,r" 形式的坐标串 → [{q,r}]；非法片段忽略。 */
export function parseCoordList(text) {
    const out = [];
    for (const part of String(text || '').split(/[;；]/)) {
        const m = part.trim().match(/^(-?\d+)\s*[,，]\s*(-?\d+)$/);
        if (m) out.push({ q: Number(m[1]), r: Number(m[2]) });
    }
    return out;
}

export function coordListToText(list) {
    return (list || []).map(p => `${p.q},${p.r}`).join('; ');
}
