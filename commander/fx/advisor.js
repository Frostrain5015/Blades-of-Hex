// 谋士攻心紫色波纹模块
import { gongxinRipples } from '../../js/effects.js';
import { registerFxLayer, registerFxUpdate } from '../../js/fxRegistry.js';

function _updateGongxin(now) {
    for (let i = gongxinRipples.length - 1; i >= 0; i--) {
        if (now - gongxinRipples[i].startTime > gongxinRipples[i].duration) {
            gongxinRipples.splice(i, 1);
        }
    }
}

function _drawGongxin(ctx2d, now) {
    for (const r of gongxinRipples) {
        const elapsed = now - r.startTime;
        const alpha = Math.max(0, 1 - elapsed / r.duration);
        for (const ring of r.rings) {
            const localT = Math.max(0, Math.min(1, (elapsed - ring.delay * r.duration) / (r.duration * 0.7)));
            if (localT <= 0 || localT >= 1) continue;
            const radius = ring.maxR * localT;
            const ringAlpha = alpha * (1 - localT) * 0.7;
            ctx2d.save();
            ctx2d.globalAlpha = ringAlpha;
            ctx2d.beginPath(); ctx2d.arc(r.x, r.y, radius, 0, Math.PI * 2);
            ctx2d.strokeStyle = r.intense ? '#cc88ff' : '#9966cc';
            ctx2d.lineWidth = 2.5 * (1 - localT);
            ctx2d.shadowColor = r.intense ? '#cc88ff' : '#8855bb';
            ctx2d.shadowBlur = 10 * (1 - localT);
            ctx2d.stroke();
            ctx2d.restore();
        }
    }
}

export function register() {
    registerFxUpdate((dt, now) => _updateGongxin(now));
    // 原版在雷击之后、迷雾遮罩之前绘制，对应 preFog 图层
    registerFxLayer('preFog', _drawGongxin, 40);
}
