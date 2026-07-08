// 将领头像预加载器
import { allCommanders as COMMANDER_CONFIG } from '../commander/index.js';

const _portraits = new Map();   // commanderId → Image (选将/手牌)
const _trPortraits = new Map(); // commanderId → Image (透明底战场立绘)

function _loadOne(id, cfg) {
    const img = new Image();
    img.src = `img/commander/${cfg.name}.webp`;
    _portraits.set(id, img);
    const trImg = new Image();
    trImg.src = `img/commander_tr/${cfg.name}.webp`;
    _trPortraits.set(id, trImg);
}

export function preloadPortraits() {
    for (const [id, cfg] of Object.entries(COMMANDER_CONFIG)) {
        if (!_portraits.has(id)) _loadOne(id, cfg);
    }
}

// 联机重连后强制重新加载所有将领立绘（旧 Image 对象可能已失效）
export function reloadPortraits() {
    for (const [id, cfg] of Object.entries(COMMANDER_CONFIG)) {
        _loadOne(id, cfg);
    }
}

export function getPortrait(commanderId) {
    if (!commanderId) return null;
    const img = _portraits.get(commanderId);
    if (!img || !img.complete || img.naturalWidth === 0) return null;
    return img;
}

export function getTransparentPortrait(commanderId) {
    if (!commanderId) return null;
    const img = _trPortraits.get(commanderId);
    if (!img || !img.complete || img.naturalWidth === 0) return null;
    return img;
}
