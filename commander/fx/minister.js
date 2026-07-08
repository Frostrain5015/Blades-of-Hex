// 尚书特效模块：统御光环
// 注意：金币雨（coinParticles）是通用城市/村庄收入特效，常驻 renderer，不在此模块
import { ministerRings } from '../../js/effects.js';
import { registerFxLayer, registerFxUpdate } from '../../js/fxRegistry.js';

function _updateMinisterRings(now) {
    for (let i = ministerRings.length - 1; i >= 0; i--) {
        if (now - ministerRings[i].startTime > ministerRings[i].duration) ministerRings.splice(i, 1);
    }
}

function _drawMinisterRings(ctx2d, now) {
    for (const r of ministerRings) {
        const elapsed = now - r.startTime;
        const progress = Math.max(0, Math.min(1, elapsed / r.duration));
        const radius = r.maxRadius * progress;
        const alpha = (1 - progress) * 0.55;
        ctx2d.save();
        ctx2d.globalAlpha = alpha;
        ctx2d.beginPath(); ctx2d.arc(r.x, r.y, radius, 0, Math.PI * 2);
        ctx2d.strokeStyle = '#ffd700';
        ctx2d.lineWidth = 3.5 * (1 - progress);
        ctx2d.shadowColor = '#ffd700'; ctx2d.shadowBlur = 14 * (1 - progress);
        ctx2d.stroke();
        ctx2d.restore();
    }
}

export function register() {
    registerFxUpdate((dt, now) => _updateMinisterRings(now));
    // 原版在攻心波纹之后、金币雨之前绘制，对应 preFog 图层末位
    registerFxLayer('preFog', _drawMinisterRings, 50);
}
