// 将领特效按需装载器 —— 开局仅动态 import 在场 2~3 名将领的特效模块。
// 调用点：startGame()（倒计时前发起，倒计时期间完成动态 import）、
//         联机 stateSync 重连/观战恢复后。
// headless 服务器不 import 本文件，将领逻辑（commander/*.js）不受影响。

import { clearFxLayers } from './fxRegistry.js';

// 已完成特效模块化的将领清单 —— 每迁移一个将领就在此登记；
// 不在清单内的将领（如上校，其空袭/空运为通用对策卡特效）由 renderer.js 常驻绘制。
const FX_MANIFEST = new Set([
    'ironGuard',
    'astrologer',
    'staller',
    'necromancer',
    'fallenAngel',
    'berserker',
    'paladin',
    'priest',
    'diplomat',
    'vampire',
    'advisor',
    'minister',
    'tianyan'
]);

const _loaded = new Map(); // id → module（模块缓存，重复开局不再发请求）

export async function loadCommanderFx(gameState) {
    clearFxLayers();
    const picked = new Set(
        [
            gameState.commanderP1, gameState.commanderP2, gameState.commanderP3,
            gameState.commanderP1Secondary, gameState.commanderP2Secondary, gameState.commanderP3Secondary
        ]
            .filter(id => id && FX_MANIFEST.has(id))
    );
    for (const id of picked) {
        // 单个模块失败不影响其余将领的特效装载
        try {
            let mod = _loaded.get(id);
            if (!mod) {
                mod = await import(`../commander/fx/${id}.js`);
                _loaded.set(id, mod);
            }
            // 注册必须走 register() 而非模块副作用：模块缓存后副作用只执行一次，
            // 而每次开局 clearFxLayers 之后都需要重新挂钩。
            const reg = mod.register || (mod.default && mod.default.register);
            if (reg) reg(); else console.warn(`[commanderFx] ${id} 缺少 register()`);
        } catch (err) {
            console.warn(`[commanderFx] 加载 ${id} 特效模块失败:`, err);
        }
    }
}
