// 音效裁剪工具
// 用法：node tools/trimSounds.js <输入目录>
//
// 将下载的 freesound.org 原始文件按配置裁剪后输出到 sounds/ 目录。
// 依赖 ffmpeg（已通过 ffmpeg-static 提供）。
//
// 示例：
//   node tools/trimSounds.js D:/freesound_downloads
//   node tools/trimSounds.js D:/freesound_downloads 0.7   （以 0.7x 速度播放，用于调音调）

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const FFMPEG = require('ffmpeg-static');

// ---- 裁剪配置 --------------------------------------------------
// file:  最终输出文件名
// match: 用于匹配输入文件名的关键词（不区分大小写），默认等于 file 的 stem
// start: 从音频开头跳过多少秒（默认 0）
// dur:   裁剪时长（秒），null 表示不裁剪，只做格式化和音量标准化
// fadeOut: 末尾淡出时长（秒），默认 0.01，使结尾不突兀
// speed: 播放速度倍率（默认 1.0），< 1 降低音调，> 1 升高音调
// volume: 音量倍数（默认 1.0），> 1 放大

const TRIM_CFG = [
    // ==== 核心战斗 ====
    { file: 'attack.mp3',         dur: 0.35,  start: 0.03, fadeOut: 0.02, volume: 1.2 },
    { file: 'cannon.mp3',         dur: 1.63,  start: 0.37, fadeOut: 0.05, volume: 1.1 },
    { file: 'crit.mp3',           dur: 0.45,  start: 0.02, fadeOut: 0.02, volume: 1.3 },
    { file: 'unitDeath.mp3',      dur: 0.7,   start: 0.05, fadeOut: 0.04 },
    { file: 'mineExplode.mp3',    dur: 0.6,   start: 0.02, fadeOut: 0.03, volume: 1.1 },

    // ==== 法术 / 能力 ====
    { file: 'heal.mp3',           dur: 2.5,   start: 0.1,  fadeOut: 0.3 },
    { file: 'shield.mp3',         dur: 0.5,   start: 0.02, fadeOut: 0.03, volume: 1.2 },
    { file: 'lightning.mp3',      dur: 0.6,   start: 0.02, fadeOut: 0.03, volume: 1.1 },
    { file: 'airstrike.mp3',      dur: 9.0,   start: 45.0, fadeOut: 0.15, fadeIn: 0.1, speed: 4.5, volume: 0.9 },
    { file: 'commanderSkill.mp3', dur: 0.8,   start: 0.05, fadeOut: 0.05, volume: 1.1 },

    // ==== 战术卡 ====
    { file: 'spawn.mp3',          dur: 1.2,   start: 0.05, fadeOut: 0.1 },
    { file: 'airdrop.mp3',        dur: 1.2,   start: 0.05, fadeOut: 0.08 },
    { file: 'imprison.mp3',       dur: 0.4,   start: 0.02, fadeOut: 0.03, volume: 1.1 },
    { file: 'forceMarch.mp3',     dur: 0.5,   start: 0.02, fadeOut: 0.03, volume: 1.1 },
    { file: 'mgNest.mp3',         dur: 0.7,   start: 0.03, fadeOut: 0.04, volume: 1.1 },
    { file: 'scout.mp3',          dur: 0.4,   start: 0.02, fadeOut: 0.03 },
    { file: 'landmine.mp3',       dur: 0.3,   start: 0.02, fadeOut: 0.02 },

    // ==== 移动 / 回合 ====
    { file: 'move.mp3',           dur: 0.2,   start: 0.02, fadeOut: 0.02 },
    { file: 'turnEnd.mp3',        dur: 5.0,   start: 0.1,  fadeOut: 0.5,  volume: 1.1 },
    { file: 'cityCapture.mp3',    dur: 0.8,   start: 0.05, fadeOut: 0.05, volume: 1.1 },

    // ==== UI ====
    { file: 'buttonClick.mp3',    dur: 0.08,  start: 0.01, fadeOut: 0.01, volume: 0.8 },
    { file: 'cardDraw.mp3',       dur: 0.25,  start: 0.02, fadeOut: 0.02 },
    { file: 'countdown.mp3',      dur: 0.1,   start: 0.01, fadeOut: 0.01 },
    { file: 'rankUp.mp3',         dur: 0.7,   start: 0.05, fadeOut: 0.05, volume: 1.1 },
    { file: 'goldEarn.mp3',       dur: 0.4,   start: 0.02, fadeOut: 0.03, volume: 1.1 },
    { file: 'error.mp3',          dur: 0.3,   start: 0.02, fadeOut: 0.02 },

    // ==== 游戏事件 ====
    { file: 'victory.mp3',        dur: null,  start: 0,    fadeOut: 0,    volume: 1.0 },
    { file: 'defeat.mp3',         dur: 2.0,   start: 0.1,  fadeOut: 0.2 },
    { file: 'weatherRain.mp3',    dur: 3.0,   start: 0.2,  fadeOut: 0.5,  volume: 0.9 },
];

// ================================================================

const soundsDir = path.resolve(__dirname, '..', 'sounds');

function findMatch(inputDir, targetFile) {
    const stem = path.basename(targetFile, '.mp3').toLowerCase();
    const files = fs.readdirSync(inputDir).filter(f =>
        /\.(mp3|wav|ogg|flac|aiff|aif|m4a|webm)$/i.test(f)
    );
    // 精确匹配文件名
    const exact = files.find(f => path.basename(f).toLowerCase() === targetFile.toLowerCase());
    if (exact) return path.join(inputDir, exact);
    // 模糊匹配 stem
    const fuzzy = files.find(f => path.basename(f, path.extname(f)).toLowerCase().includes(stem));
    if (fuzzy) return path.join(inputDir, fuzzy);
    return null;
}

function trimOne(cfg, inputPath, outputPath, speedOverride) {
    const speed = speedOverride || cfg.speed || 1.0;
    const args = ['-y', '-i', inputPath];

    const filters = [];
    const hasTrim = cfg.dur != null;

    if (hasTrim) {
        const start = cfg.start || 0;
        filters.push(`atrim=start=${start}:duration=${cfg.dur}`);
    }

    if (cfg.volume && cfg.volume !== 1.0) {
        filters.push(`volume=${cfg.volume}`);
    }

    // 变速：atempo 单次限制 0.5-2.0，链式拼接可突破
    if (Math.abs(speed - 1.0) > 0.001) {
        let rem = speed;
        while (rem > 2.0) { filters.push('atempo=2.0'); rem /= 2.0; }
        while (rem < 0.5) { filters.push('atempo=0.5'); rem /= 0.5; }
        if (Math.abs(rem - 1.0) > 0.001) filters.push(`atempo=${rem.toFixed(4)}`);
    }

    // 淡入淡出（在变速后应用，参数以输出时间线为准）
    if (cfg.fadeIn && cfg.fadeIn > 0) {
        filters.push(`afade=t=in:d=${cfg.fadeIn.toFixed(3)}`);
    }
    if (cfg.fadeOut && cfg.fadeOut > 0 && hasTrim) {
        const outDur = cfg.dur / speed;
        const fadeStart = Math.max(0, outDur - cfg.fadeOut).toFixed(3);
        filters.push(`afade=t=out:st=${fadeStart}:d=${cfg.fadeOut.toFixed(3)}`);
    }

    if (filters.length > 0) {
        args.push('-af', filters.join(','));
    }

    // 输出格式
    args.push('-ac', '1');           // 单声道
    args.push('-b:a', '64k');        // 64kbps
    args.push('-ar', '44100');       // 44.1kHz
    args.push('-map_metadata', '-1');// 去除元数据
    args.push(outputPath);

    console.log(`  ${path.basename(inputPath)} -> ${cfg.file} ...`);
    try {
        execFileSync(FFMPEG, args, { stdio: 'pipe', timeout: 15000 });
        const sizeKB = (fs.statSync(outputPath).size / 1024).toFixed(1);
        const durInfo = cfg.dur != null ? `${cfg.dur.toFixed(2)}s` : 'passthru';
        console.log(`    OK  ${sizeKB} KB  dur=${durInfo}  speed=${speed}x  vol=${cfg.volume || 1.0}x`);
    } catch (e) {
        console.error(`    FAILED: ${e.message}`);
    }
}

function main() {
    const args = process.argv.slice(2);
    if (args.length < 1) {
        console.log('用法: node tools/trimSounds.js <输入目录> [speed]');
        console.log('  <输入目录>  包含从 freesound.org 下载的原始音频文件');
        console.log('  [speed]     可选，播放速度倍率（如 0.8 降音调，1.2 升音调）');
        console.log('');
        console.log('文件匹配规则：');
        console.log('  1. 精确匹配文件名（如 attack.mp3）');
        console.log('  2. 模糊匹配文件名中的关键词（如包含 "sword" 的匹配 attack.mp3）');
        console.log('');
        console.log('输出目录: sounds/');
        process.exit(1);
    }

    const inputDir = args[0];
    const speed = args[1] ? parseFloat(args[1]) : null;

    if (!fs.existsSync(inputDir)) {
        console.error(`错误: 输入目录不存在: ${inputDir}`);
        process.exit(1);
    }
    if (!fs.existsSync(FFMPEG)) {
        console.error(`错误: ffmpeg 未找到: ${FFMPEG}\n请先运行 npm install`);
        process.exit(1);
    }

    console.log(`输入: ${inputDir}`);
    console.log(`输出: ${soundsDir}`);
    if (speed) console.log(`速度: ${speed}x`);
    console.log('');

    let found = 0;
    let skipped = 0;

    for (const cfg of TRIM_CFG) {
        const inputPath = findMatch(inputDir, cfg.file);
        if (!inputPath) {
            skipped++;
            continue;
        }
        found++;
        const outputPath = path.join(soundsDir, cfg.file);
        trimOne(cfg, inputPath, outputPath, speed);
    }

    console.log('');
    console.log(`完成: 裁剪 ${found} 个, 跳过 ${skipped} 个（未找到源文件）`);
    if (skipped > 0) {
        console.log('跳过的文件需要在输入目录中提供匹配的源文件。');
    }
}

main();
