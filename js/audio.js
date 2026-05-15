import { settings } from './config.js';
import { SOUND_MANIFEST, ALIAS_MAP } from './audioManifest.js';

// ============================================================
//  Howler.js 引擎层 — 播放 freesound.org 真实音频素材
//  加载失败时自动回退到原有 OscillatorNode 合成
// ============================================================

let _howls = {};
let _loadErrors = {};
let _initDone = false;

// ============================================================
//  初始化
// ============================================================

export function initAudio() {
    if (_initDone) return;
    _initDone = true;
    Howler.volume(settings.soundVolume ?? 0.7);
    Howler.mute(!settings.soundEnabled);

    // 预创建 BGM 的 Howl 实例，让 Howler 内部尽早开始加载和注册 autoplay 解锁
    _getHowl('lobby_bgm');
}

export function playSound(soundName) {
    // 入口统一网关：静音开关
    if (!settings.soundEnabled) return;

    const resolved = ALIAS_MAP[soundName] || soundName;
    const cfg = SOUND_MANIFEST[resolved];

    // 清单中未注册 → 合成回退
    if (!cfg) {
        _playSynthFallback(soundName);
        return;
    }

    const { howl } = _getHowl(resolved);

    // 文件加载失败 → 合成回退
    if (_loadErrors[resolved]) {
        _playSynthFallback(soundName);
        return;
    }

    const masterVol = settings.soundVolume ?? 0.7;
    howl.volume(cfg.volume * masterVol);
    howl.play();
}

function _getHowl(name) {
    const resolved = ALIAS_MAP[name] || name;
    const cfg = SOUND_MANIFEST[resolved];
    if (!cfg) return null;
    if (!_howls[resolved]) {
        const extra = {};
        if (cfg.loop !== undefined) extra.loop = cfg.loop;
        if (cfg.html5 !== undefined) extra.html5 = cfg.html5;
        _howls[resolved] = new Howl({
            src: [cfg.file],
            volume: cfg.volume,
            pool: cfg.pool,
            preload: true,
            ...extra,
            onloaderror: () => { _loadErrors[resolved] = true; }
        });
    }
    return { howl: _howls[resolved], cfg, resolved };
}

// ============================================================
//  BGM 控制 — 对局背景音乐循环播放
// ============================================================

let _battleBgmId = null;

export function startBattleBGM() {
    if (_battleBgmId !== null) return; // 已在播放
    const result = _getHowl('battle_bgm');
    if (!result || !result.howl) return;
    if (_loadErrors['battle_bgm']) return;

    const play = () => {
        const masterVol = settings.soundVolume ?? 0.7;
        result.howl.volume(result.cfg.volume * masterVol);
        _battleBgmId = result.howl.play();
    };

    if (Howler.ctx && Howler.ctx.state === 'suspended') {
        Howler.ctx.resume().then(play).catch(play);
    } else {
        play();
    }
}

export function stopBattleBGM() {
    if (_battleBgmId === null) return;
    const result = _getHowl('battle_bgm');
    if (result && result.howl) {
        result.howl.stop();
    }
    _battleBgmId = null;
}

export function stopLobbyBGM() {
    const result = _getHowl('lobby_bgm');
    if (result && result.howl) {
        result.howl.stop();
    }
}

// ============================================================
//  音量 / 静音控制
// ============================================================

export function setMasterVolume(vol) {
    Howler.volume(vol);
}

export function setMuted(muted) {
    Howler.mute(muted);
}

// ============================================================
//  合成回退层（保留原有 OscillatorNode 代码）
//  当音频文件不存在或加载失败时使用
// ============================================================

let _synthCtx = null;

function _getCtx() {
    if (!_synthCtx) {
        try {
            _synthCtx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            return null;
        }
    }
    if (_synthCtx.state === 'suspended') {
        _synthCtx.resume();
    }
    return _synthCtx;
}

function _playTone(freq, duration, type = 'sine', volume = 0.15) {
    const ctx = _getCtx();
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

function _playSynthFallback(sound) {
    const ctx = _getCtx();
    if (!ctx) return;

    switch (sound) {
        case 'attack':
        case 'mineExplode': {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(600, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.15);
            gain.gain.setValueAtTime(0.12, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
            osc.connect(gain); gain.connect(ctx.destination);
            osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.2);
            break;
        }
        case 'crit': {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'square';
            osc.frequency.setValueAtTime(800, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.1);
            gain.gain.setValueAtTime(0.4, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
            osc.connect(gain); gain.connect(ctx.destination);
            osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.15);
            break;
        }
        case 'recruit':
        case 'spawn': {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(300, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.3);
            gain.gain.setValueAtTime(0.1, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
            osc.connect(gain); gain.connect(ctx.destination);
            osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.4);
            break;
        }
        case 'move': {
            _playTone(440, 0.15, 'sine', 0.1);
            setTimeout(() => _playTone(550, 0.15, 'sine', 0.1), 150);
            break;
        }
        case 'turnEnd': {
            const t = ctx.currentTime;
            const strike = ctx.createOscillator();
            const strikeGain = ctx.createGain();
            strike.type = 'square';
            strike.frequency.setValueAtTime(400, t);
            strike.frequency.exponentialRampToValueAtTime(60, t + 0.03);
            strikeGain.gain.setValueAtTime(0.10, t);
            strikeGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
            strike.connect(strikeGain); strikeGain.connect(ctx.destination);
            strike.start(t); strike.stop(t + 0.04);
            const partials = [
                [165, 'triangle', 0.13, 2.2],
                [168, 'triangle', 0.10, 2.0],
                [248, 'sine',     0.05, 1.6],
                [330, 'triangle', 0.07, 1.4],
                [413, 'sine',     0.04, 1.1],
                [495, 'sine',     0.03, 0.8],
                [660, 'sine',     0.02, 0.5],
            ];
            for (const [freq, wave, vol, decay] of partials) {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = wave;
                const jitter = (Math.random() - 0.5) * 2;
                osc.frequency.setValueAtTime(freq + jitter, t);
                if (freq < 200) {
                    osc.frequency.exponentialRampToValueAtTime(freq * 0.97, t + decay);
                }
                gain.gain.setValueAtTime(0, t);
                gain.gain.linearRampToValueAtTime(vol, t + 0.04);
                gain.gain.exponentialRampToValueAtTime(0.001, t + decay);
                osc.connect(gain); gain.connect(ctx.destination);
                osc.start(t); osc.stop(t + decay + 0.1);
            }
            break;
        }
        case 'commanderSkill':
        case 'heal':
        case 'shield':
        case 'airdrop':
        case 'mgNest':
        case 'imprison':
        case 'forceMarch':
        case 'scout':
        case 'landmine': {
            const t = ctx.currentTime;
            [0, 80, 160].forEach((delay, i) => {
                const freq = 660 + i * 220;
                setTimeout(() => _playTone(freq, 0.35, 'sine', 0.10), delay);
                setTimeout(() => _playTone(freq * 1.5, 0.25, 'sine', 0.06), delay + 40);
            });
            break;
        }
        case 'victory': {
            [523, 659, 784, 1047].forEach((freq, i) => {
                setTimeout(() => _playTone(freq, 0.4, 'triangle', 0.12), i * 200);
            });
            break;
        }
        case 'countdown': {
            // 短促倒计时提示音：方波快速下行 + 正弦泛音
            const t = ctx.currentTime;
            const osc1 = ctx.createOscillator();
            const gain1 = ctx.createGain();
            osc1.type = 'square';
            osc1.frequency.setValueAtTime(880, t);
            osc1.frequency.exponentialRampToValueAtTime(440, t + 0.12);
            gain1.gain.setValueAtTime(0.10, t);
            gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
            osc1.connect(gain1); gain1.connect(ctx.destination);
            osc1.start(t); osc1.stop(t + 0.18);
            const osc2 = ctx.createOscillator();
            const gain2 = ctx.createGain();
            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(1320, t);
            osc2.frequency.exponentialRampToValueAtTime(660, t + 0.1);
            gain2.gain.setValueAtTime(0.06, t);
            gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
            osc2.connect(gain2); gain2.connect(ctx.destination);
            osc2.start(t); osc2.stop(t + 0.15);
            break;
        }
        case 'unitDeath':
        case 'cityCapture':
        case 'cardDraw':
        case 'buttonClick':
        case 'rankUp':
        case 'goldEarn':
        case 'defeat':
        case 'error':
        case 'weatherRain':
        case 'lightning':
        case 'airstrike': {
            // 新音效没有合成回退 — 静默
            break;
        }
    }
}
