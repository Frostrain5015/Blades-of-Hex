import { EN_US } from '../locales/en-US.js';

const STORAGE_KEY = 'blades-of-hex.locale.v1';
const SUPPORTED = new Set(['zh-CN', 'en-US']);
const textState = new WeakMap();
const attributeState = new WeakMap();
let applying = false;

const templates = [
    [/^当前进度\s*(\d+)%$/, 'Progress $1%'],
    [/^教程\s*(\d+)%$/, 'Tutorial $1%'],
    [/^第\s*(\d+)\s*回合$/, 'Round $1'],
    [/^回合\s*(\d+)$/, 'Round $1'],
    [/^(.+)的回合$/, "$1's Turn"],
    [/^轮到(.+)行动$/, "$1's Turn"],
    [/^与(.+)的私聊$/, 'Private Chat with $1'],
    [/^等待(.+)行动\.\.\.$/, 'Waiting for $1…'],
    [/^(.+)胜利$/, '$1 Wins'],
    [/^(.+)已战败$/, '$1 Has Been Defeated'],
    [/^已解锁\s*(\d+)\/(\d+)$/, 'Unlocked $1/$2'],
    [/^(\d+)\s*座城市$/, '$1 Cities'],
    [/^(\d+)\s*支部队$/, '$1 Units'],
    [/^难度[：:]\s*(.+)$/, 'Difficulty: $1'],
    [/^回合限制[：:]\s*(\d+)$/, 'Round Limit: $1'],
    [/^房间\s*(.+)$/, 'Room $1'],
    [/^玩家\s*(\d+)$/, 'Player $1'],
    [/^星级[：:]\s*(.+)$/, 'Rating: $1'],
    [/^(.+)\s*·\s*第(\d+)回合$/, '$1 · Round $2']
];

function detectLocale() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (SUPPORTED.has(stored)) return stored;
    return navigator.language?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
}

let locale = detectLocale();

function translateCore(value) {
    if (locale === 'zh-CN' || typeof value !== 'string' || !value) return value;
    const direct = EN_US[value];
    if (direct !== undefined) return direct;
    for (const [pattern, replacement] of templates) {
        if (pattern.test(value)) return value.replace(pattern, replacement);
    }
    return value;
}

export function t(value) {
    if (typeof value !== 'string') return value;
    const match = value.match(/^(\s*)([\s\S]*?)(\s*)$/);
    if (!match) return translateCore(value);
    return `${match[1]}${translateCore(match[2])}${match[3]}`;
}

export function getLocale() {
    return locale;
}

function translateTextNode(node) {
    if (!node?.parentElement || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(node.parentElement.tagName)) return;
    const current = node.nodeValue || '';
    let state = textState.get(node);
    if (!state || current !== state.rendered) state = { source: current, rendered: current };
    const rendered = t(state.source);
    state.rendered = rendered;
    textState.set(node, state);
    if (current !== rendered) node.nodeValue = rendered;
}

const TRANSLATED_ATTRIBUTES = ['title', 'placeholder', 'aria-label'];

function translateAttributes(element) {
    let states = attributeState.get(element);
    if (!states) states = new Map();
    for (const name of TRANSLATED_ATTRIBUTES) {
        if (!element.hasAttribute(name)) continue;
        const current = element.getAttribute(name) || '';
        let state = states.get(name);
        if (!state || current !== state.rendered) state = { source: current, rendered: current };
        const rendered = t(state.source);
        state.rendered = rendered;
        states.set(name, state);
        if (current !== rendered) element.setAttribute(name, rendered);
    }
    attributeState.set(element, states);
}

function translateTree(root = document.body) {
    if (!root) return;
    applying = true;
    try {
        if (root.nodeType === Node.TEXT_NODE) {
            translateTextNode(root);
            return;
        }
        if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
        if (root.nodeType === Node.ELEMENT_NODE) translateAttributes(root);
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
            if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
            else translateAttributes(node);
            node = walker.nextNode();
        }
    } finally {
        applying = false;
    }
}

function updateLanguageButton() {
    const button = document.getElementById('languageToggleBtn');
    const flag = document.getElementById('languageFlag');
    if (!button || !flag) return;
    const english = locale === 'en-US';
    flag.src = english ? 'img/ui/flag-gb.svg' : 'img/ui/flag-cn.svg';
    flag.alt = english ? 'English' : '中文';
    button.title = english ? '切换为中文' : 'Switch to English';
    button.setAttribute('aria-label', button.title);
}

export function setLocale(nextLocale) {
    if (!SUPPORTED.has(nextLocale) || nextLocale === locale) return;
    locale = nextLocale;
    localStorage.setItem(STORAGE_KEY, locale);
    document.documentElement.lang = locale;
    translateTree(document.body);
    updateLanguageButton();
    window.dispatchEvent(new CustomEvent('boh:locale-change', { detail: { locale } }));
}

function initialize() {
    document.documentElement.lang = locale;
    translateTree(document.body);
    updateLanguageButton();
    document.getElementById('languageToggleBtn')?.addEventListener('click', () => {
        setLocale(locale === 'zh-CN' ? 'en-US' : 'zh-CN');
    });

    const observer = new MutationObserver(records => {
        if (applying) return;
        for (const record of records) {
            if (record.type === 'characterData') translateTextNode(record.target);
            else if (record.type === 'attributes') translateAttributes(record.target);
            else for (const node of record.addedNodes) translateTree(node);
        }
    });
    observer.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: TRANSLATED_ATTRIBUTES
    });
}

initialize();

window.gameI18n = Object.freeze({ getLocale, setLocale, t });
