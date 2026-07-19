// 音效清单 — 映射逻辑名称到文件路径、音量、池大小、预加载策略。
// 同时作为 freesound.org 音效署名的权威来源。
//
// available: false 表示素材尚未生成（sounds_src 缺源文件，mp3 未产出）。
// 播放层对这些条目直接走合成回退、不发网络请求，避免 404 噪音；
// 补齐对应 sounds/*.mp3 后删除该标记即可启用。

export const SOUND_MANIFEST = {
    // ---- 战斗 ----
    attack:        { file: 'sounds/attack.mp3',        volume: 0.8,  pool: 4,  preload: false, category: 'combat' },
    cannon:        { file: 'sounds/cannon.mp3',        volume: 0.85, pool: 2,  preload: false, category: 'combat' },
    crit:          { file: 'sounds/crit.mp3',          volume: 1.3,  pool: 2,  preload: false, category: 'combat' },
    unitDeath:     { file: 'sounds/unitDeath.mp3',     volume: 0.7,  pool: 3,  preload: false, category: 'combat', available: false },
    mineExplode:   { file: 'sounds/mineExplode.mp3',   volume: 0.75, pool: 2,  preload: false, category: 'combat', available: false },

    // ---- 法术 / 能力 ----
    heal:          { file: 'sounds/heal.mp3',          volume: 0.6,  pool: 2,  preload: false, category: 'magic' },
    shield:        { file: 'sounds/shield.mp3',        volume: 0.7,  pool: 2,  preload: false, category: 'magic', available: false },
    lightning:     { file: 'sounds/lightning.mp3',     volume: 0.85, pool: 2,  preload: false, category: 'magic' },
    machinegun:    { file: 'sounds/machinegun.mp3',    volume: 0.7,  pool: 4,  preload: false, category: 'combat' },
    airstrike:     { file: 'sounds/airstrike.mp3',     volume: 0.8,  pool: 1,  preload: false, category: 'magic' },
    explosion:     { file: 'sounds/explosion.mp3',     volume: 0.75, pool: 3,  preload: false, category: 'combat' },
    commanderSkill:{ file: 'sounds/commanderSkill.mp3',volume: 0.8,  pool: 2,  preload: false, category: 'magic' },

    // ---- 战术卡 ----
    spawn:         { file: 'sounds/spawn.mp3',         volume: 0.85, pool: 2,  preload: false, category: 'tactical' },
    airdrop:       { file: 'sounds/airdrop.mp3',       volume: 0.7,  pool: 1,  preload: false, category: 'tactical', available: false },
    imprison:      { file: 'sounds/imprison.mp3',      volume: 0.7,  pool: 1,  preload: false, category: 'tactical', available: false },
    forceMarch:    { file: 'sounds/forceMarch.mp3',    volume: 0.65, pool: 1,  preload: false, category: 'tactical', available: false },
    mgNest:        { file: 'sounds/mgNest.mp3',        volume: 0.7,  pool: 1,  preload: false, category: 'tactical', available: false },
    scout:         { file: 'sounds/scout.mp3',         volume: 0.65, pool: 1,  preload: false, category: 'tactical', available: false },
    landmine:      { file: 'sounds/landmine.mp3',      volume: 0.5,  pool: 1,  preload: false, category: 'tactical', available: false },

    // ---- 移动 / 回合 ----
    move:          { file: 'sounds/move.mp3',          volume: 0.45, pool: 6,  preload: false, category: 'movement' },
    turnEnd:       { file: 'sounds/turnEnd.mp3',       volume: 0.8,  pool: 1,  preload: false, category: 'movement' },
    cityCapture:   { file: 'sounds/cityCapture.mp3',   volume: 0.8,  pool: 1,  preload: false, category: 'movement', available: false },

    // ---- UI / 反馈 ----
    buttonClick:   { file: 'sounds/buttonClick.mp3',   volume: 0.4,  pool: 3,  preload: false, category: 'ui', available: false },
    cardDraw:      { file: 'sounds/cardDraw.mp3',      volume: 0.5,  pool: 2,  preload: false, category: 'ui', available: false },
    // countdown 使用纯合成音效，不依赖外部文件
    // countdown:     { file: 'sounds/countdown.mp3',     volume: 0.6,  pool: 1,  preload: false, category: 'ui' },
    rankUp:        { file: 'sounds/rankUp.mp3',        volume: 0.7,  pool: 2,  preload: false, category: 'ui', available: false },
    goldEarn:      { file: 'sounds/goldEarn.mp3',      volume: 0.5,  pool: 2,  preload: false, category: 'ui', available: false },
    error:         { file: 'sounds/error.mp3',         volume: 0.5,  pool: 1,  preload: false, category: 'ui', available: false },

    // ---- 游戏事件 ----
    victory:       { file: 'sounds/victory.mp3',       volume: 0.9,  pool: 1,  preload: false, category: 'game' },
    defeat:        { file: 'sounds/defeat.mp3',        volume: 0.9,  pool: 1,  preload: false, category: 'game', available: false },
    weatherRain:   { file: 'sounds/weatherRain.mp3',   volume: 0.5,  pool: 1,  preload: false, category: 'game', available: false },

    // ---- 音乐 ----
    lobby_bgm:     { file: 'sounds/lobby_bgm.mp3',     volume: 0.45, pool: 1,  preload: true,  category: 'music' },
    battle_bgm:    { file: 'sounds/battle_bgm.mp3',    volume: 0.4,  pool: 1,  preload: true,  loop: true, category: 'music' },
};

// 向后兼容别名：旧调用点继续使用旧名称，内部自动映射到新名称
export const ALIAS_MAP = {
    recruit: 'spawn',
};
