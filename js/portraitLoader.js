// 将领头像预加载器
import { COMMANDER_CONFIG } from './config.js';

const _portraits = new Map();   // commanderId → Image (选将/手牌)
const _trPortraits = new Map(); // commanderId → Image (透明底战场立绘)

export function preloadPortraits() {
    for (const [id, cfg] of Object.entries(COMMANDER_CONFIG)) {
        if (!_portraits.has(id)) {
            const img = new Image();
            img.src = `img/commander/${cfg.name}.jpg`;
            _portraits.set(id, img);
        }
        if (!_trPortraits.has(id)) {
            const img = new Image();
            img.src = `img/commander_tr/${cfg.name}.png`;
            _trPortraits.set(id, img);
        }
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
