import { settings } from './config.js';

let audioCtx = null;

function getCtx() {
    if (!audioCtx) {
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            return null;
        }
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    return audioCtx;
}

function playTone(freq, duration, type = 'sine', volume = 0.15) {
    if (!settings.soundEnabled) return;
    const ctx = getCtx();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
}

export function playSound(sound) {
    if (!settings.soundEnabled) return;
    const ctx = getCtx();
    if (!ctx) return;

    switch (sound) {
        case 'attack': {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(600, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.15);
            gain.gain.setValueAtTime(0.12, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.2);
            break;
        }
        case 'crit': {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'square';
            osc.frequency.setValueAtTime(800, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.1);
            gain.gain.setValueAtTime(0.18, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.15);
            break;
        }
        case 'recruit': {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(300, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.3);
            gain.gain.setValueAtTime(0.1, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.4);
            break;
        }
        case 'move': {
            playTone(440, 0.15, 'sine', 0.1);
            setTimeout(() => playTone(550, 0.15, 'sine', 0.1), 150);
            break;
        }
        case 'turnEnd': {
            // 大钟声 — 模拟铜钟自然泛音列
            const t = ctx.currentTime;
            // 敲击瞬态：极短噪声感（用高频方波快速衰减模拟锤击）
            const strike = ctx.createOscillator();
            const strikeGain = ctx.createGain();
            strike.type = 'square';
            strike.frequency.setValueAtTime(400, t);
            strike.frequency.exponentialRampToValueAtTime(60, t + 0.03);
            strikeGain.gain.setValueAtTime(0.10, t);
            strikeGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
            strike.connect(strikeGain);
            strikeGain.connect(ctx.destination);
            strike.start(t);
            strike.stop(t + 0.04);

            // 大钟泛音层：嗡鸣基音 + 自然泛音 + 轻微频率漂移
            const partials = [
                // 频率    波形       音量  衰减  描述
                [165,   'triangle', 0.13, 2.2],  // 嗡鸣基音（偏低，模拟大钟）
                [168,   'triangle', 0.10, 2.0],  // 微失谐基音 → 拍频共振
                [248,   'sine',     0.05, 1.6],  // 小三度泛音（钟的特征泛音）
                [330,   'triangle', 0.07, 1.4],  // 八度泛音
                [413,   'sine',     0.04, 1.1],  // 五度泛音
                [495,   'sine',     0.03, 0.8],  // 上八度
                [660,   'sine',     0.02, 0.5],  // 高泛音（金属感）
            ];
            for (const [freq, wave, vol, decay] of partials) {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = wave;
                // 轻微随机频率偏移，避免太"干净"
                const jitter = (Math.random() - 0.5) * 2;
                osc.frequency.setValueAtTime(freq + jitter, t);
                // 基音做微小下滑，模拟钟体振动自然衰减
                if (freq < 200) {
                    osc.frequency.exponentialRampToValueAtTime(freq * 0.97, t + decay);
                }
                gain.gain.setValueAtTime(0, t);
                gain.gain.linearRampToValueAtTime(vol, t + 0.04);    // 4ms 起振（模拟声波传递）
                gain.gain.exponentialRampToValueAtTime(0.001, t + decay);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(t);
                osc.stop(t + decay + 0.1);
            }
            break;
        }
        case 'victory': {
            const notes = [523, 659, 784, 1047];
            notes.forEach((freq, i) => {
                setTimeout(() => playTone(freq, 0.4, 'triangle', 0.12), i * 200);
            });
            break;
        }
    }
}
