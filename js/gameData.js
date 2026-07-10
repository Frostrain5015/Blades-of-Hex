// ============================================================================
// 游戏数据表（给策划/平衡调整使用）
// ============================================================================
//
// 这个文件刻意不访问 DOM、不包含动画或结算代码。可以把它当作游戏的
// “数据面板”：改这里的数值、名称、说明或 emoji，就能调整游戏内容。
//
// 约定：
// - 百分比统一用小数：0.25 表示 25%。
// - 距离、回合、金币、HP、ATK 等均使用实际数值。
// - `definition` 是前端展示的将领资料；`balance` 是结算读取的参数。
// - emoji 使用 FE0F 变体选择符，配合 EMOJI_FONT_STACK 保持彩色显示。
// ============================================================================

/** 用于 DOM 徽章和 Canvas 地图的彩色 emoji 字体栈。 */
export const EMOJI_FONT_STACK = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';

// 以下两个格式化函数只负责把同一份平衡数值写入前端文案；它们不参与游戏结算。
// 因此调整 0.25 这类数值后，逻辑和说明会在加载时一起更新。
const percent = (value) => `${Math.round(value * 100)}%`;
const rangeText = (min, max) => `${min}~${max}`;

/** 所有前端图标集中定义，避免同一个效果出现不同图案或黑白字形。 */
export const EMOJI = {
    camp: { player1: '🔴', player2: '🔵', player3: '🟢', neutral: '⚫' },
    terrain: { plains: '🌾', forest: '🌲', mountain: '⛰️' },
    fortification: { trench: '🚧', trenchBadge: '🪖', flak: '🔫' },
    moraleBadge: { up: '⬆️', down: '⬇️', confused: '❓' },
    commander: {
        courageAura: '🗡️', healingAura: '🕊️', guardianAura: '🛡️',
        qixue: '🩸', oath: '✝️', martyr: '💥', drone: '✈️', soul: '👻'
    },
    cards: {
        heal: '💚', lightning: '⚡', mgNest: '🏰', airdrop: '🪂', imprison: '🔗',
        forceMarch: '🏃', scout: '🔭', airstrike: '✈️', shield: '🛡️',
        landmine: '💣', commanderDeploy: '🎖️', diveStrafe: '💥', carpetBomb: '💣', airlift: '🪂'
    }
};

/** 棋盘和回合的基础规则。一般无需为了平衡而修改像素尺寸。 */
export const BOARD_RULES = {
    hexSize: 30,
    logicalWidth: 1000,
    logicalHeight: 750,
    logLimit: 20,
    hexNeighbors: [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]
};

/** 可招募兵种的面板与展示名称。 */
export const UNIT_CONFIG = {
    infantry: { name: '步', hp: 200, attack: 40, defense: 0.05, speed: 5, range: 1, cost: 8, color: '#0a0a0a' },
    cavalry: { name: '骑', hp: 150, attack: 50, defense: 0.05, speed: 8, range: 1, cost: 10, color: '#0a0a0a' },
    archer: { name: '炮', hp: 100, attack: 60, defense: 0, speed: 3, range: 2, cost: 12, color: '#0a0a0a' },
    mgNest: { name: '碉堡', hp: 200, attack: 40, defense: 0.05, speed: 0, range: 2, cost: 0, color: '#8B7355' },
    drone: { name: '无人机', hp: 75, attack: 30, defense: 0, speed: 8, range: 2, cost: 0, color: '#6bbcff' }
};

/** 阵营的显示名、底色和旗帜 emoji。 */
export const CAMP_DATA = {
    player1: { name: '红军', color: '#ffaaaa', flag: EMOJI.camp.player1 },
    player2: { name: '蓝军', color: '#aaaaff', flag: EMOJI.camp.player2 },
    player3: { name: '绿军', color: '#aaffaa', flag: EMOJI.camp.player3 },
    neutral: { name: '中立', color: '#c0c0c0', flag: EMOJI.camp.neutral }
};

export const CAMP_FLAG_COLORS = {
    p1: { main: '#d44040', dark: '#8b1a1a', light: '#f06060' },
    p2: { main: '#4060d0', dark: '#1a2a80', light: '#6080f0' },
    p3: { main: '#40a040', dark: '#1a601a', light: '#60d060' },
    neu: { main: '#777', dark: '#444', light: '#999' }
};

/** 行为克制关系。1 为无修正，大于 1 为顺克，小于 1 为逆克。 */
export const COUNTER_RELATION = {
    infantry: { archer: 0.75, cavalry: 1.25, infantry: 1, mgNest: 0.75, drone: 1 },
    archer: { cavalry: 0.75, infantry: 1.25, archer: 1, mgNest: 1.25, drone: 1 },
    cavalry: { infantry: 0.75, archer: 1.25, cavalry: 1, mgNest: 0.75, drone: 1 },
    mgNest: { infantry: 1.25, archer: 0.75, cavalry: 1.25, mgNest: 1, drone: 1 },
    drone: { infantry: 1.25, archer: 1, cavalry: 1, mgNest: 1, drone: 1 }
};

/** 地形和工事既提供结算参数，也提供效果栏与地图的展示资料。 */
export const TERRAIN_CONFIG = {
    plains: { name: '平原', defenseBonus: 0, stepCost: 2, moveDesc: '', icon: '', iconFont: '' },
    forest: { name: '森林', defenseBonus: 0.05, stepCost: 3, moveDesc: '部队移动较慢', icon: EMOJI.terrain.forest, iconFont: `13px ${EMOJI_FONT_STACK}` },
    mountain: { name: '山地', defenseBonus: 0.05, stepCost: 6, moveDesc: '部队移动缓慢', icon: EMOJI.terrain.mountain, iconFont: `15px ${EMOJI_FONT_STACK}` }
};

export const FORTIFICATION_CONFIG = {
    trench: {
        name: '战壕', defenseBonus: 0.25, appliesTo: 'melee',
        desc: '', icon: EMOJI.fortification.trench,
        iconFont: `14px ${EMOJI_FONT_STACK}`
    },
    flak: {
        name: '高射机枪', defenseBonus: 0.25, appliesTo: 'ranged', providesSelfAA: true,
        desc: '', icon: EMOJI.fortification.flak,
        iconFont: `14px ${EMOJI_FONT_STACK}`
    }
};

/** 士气的棋盘图形和效果徽章图形分开配置：前者保持原有表现，后者使用彩色 emoji。 */
export const MORALE_CONFIG = {
    3: { name: '士气上升', dmgBonus: 0, defBonus: 0.05, icon: '▲', badgeIcon: EMOJI.moraleBadge.up, color: '#ffd700', desc: '' },
    2: { name: '正常', dmgBonus: 0, defBonus: 0, icon: '', badgeIcon: '', color: '#aaa', desc: '' },
    1: { name: '士气下降', dmgBonus: 0, defBonus: -0.05, icon: '▼', badgeIcon: EMOJI.moraleBadge.down, color: '#b080e8', desc: '' },
    0: { name: '混乱', dmgBonus: 0, defBonus: -0.20, icon: '？', badgeIcon: EMOJI.moraleBadge.confused, color: '#666', desc: '' }
};

export const WEATHER_CONFIG = {
    clear: { name: '晴', icon: '☀️', color: '#ffd700', desc: '无特殊效果' },
    rain: { name: '雨', icon: '🌧️', color: '#5588cc', desc: '' },
    fog: { name: '雾', icon: '🌫️', color: '#bbccdd', desc: '' },
    wind: { name: '风', icon: '💨', color: '#aaccaa', desc: '' }
};

/** 全局经济、卡牌与天气循环参数。 */
export const GAME_RULES = {
    villageGold: 2,
    villageMinDistance: 3,
    commanderRerollCost: 3,
    income: { firstCityGold: 4, secondCityGold: 3, additionalCityGold: 2 },
    cardSystem: { drawCost: 4, maxHandSize: 3, maxDrawsPerTurn: 2, maxUsesPerTurn: 2 },
    weatherCycle: { warmupRounds: 2, weatherDuration: 2, clearDuration: 1 },
    deckComposition: [
        'heal', 'heal', 'heal', 'heal', 'lightning', 'lightning', 'lightning',
        'airstrike', 'airstrike', 'airdrop', 'airdrop', 'mgNest', 'shield', 'shield',
        'landmine', 'landmine', 'imprison', 'imprison', 'forceMarch'
    ],
    skirmishExtras: ['scout', 'scout', 'scout', 'scout', 'scout']
};

/**
 * 标准对策卡：文字、图标、目标类型、金币/伤害/回合等全部在这里。
 * `config.js` 只把本表中的数据交给对应的执行函数。
 */
export const TACTICAL_CARD_DATA = {
    heal: { id: 'heal', name: '疗愈', icon: EMOJI.cards.heal, targeting: 'anyUnit', desc: '', balance: { healMaxHpPct: 0.40 } },
    lightning: { id: 'lightning', name: '雷击', icon: EMOJI.cards.lightning, targeting: 'enemyGlobal', desc: '', balance: { minDamage: 40, maxDamage: 60, rainMultiplier: 1.5 } },
    mgNest: { id: 'mgNest', name: '碉堡', icon: EMOJI.cards.mgNest, targeting: 'emptyFriendlyNonCity', desc: '' },
    airdrop: { id: 'airdrop', name: '空降', icon: EMOJI.cards.airdrop, targeting: 'emptyTile', desc: '【空降】\n在指定空地投放一支空降步兵', balance: { infantryHp: 100 } },
    imprison: { id: 'imprison', name: '禁锢', icon: EMOJI.cards.imprison, targeting: 'enemyGlobal', desc: '【禁锢】\n对指定敌方单位释放，使其下回合无法移动' },
    forceMarch: { id: 'forceMarch', name: '强行军', icon: EMOJI.cards.forceMarch, targeting: 'friendlyAny', desc: '', balance: { movementPoints: 2 } },
    scout: { id: 'scout', name: '侦察', icon: EMOJI.cards.scout, targeting: 'anyTileGlobal', desc: '', balance: { duration: 3 } },
    airstrike: { id: 'airstrike', name: '空袭', icon: EMOJI.cards.airstrike, targeting: 'enemyGlobal', desc: '', balance: { minDamage: 35, maxDamage: 50, forestMultiplier: 0.8, cityDisableRounds: 2 } },
    shield: { id: 'shield', name: '护盾', icon: EMOJI.cards.shield, targeting: 'shieldTarget', desc: '', balance: { shield: 50, duration: 3 } },
    landmine: { id: 'landmine', name: '地雷', icon: EMOJI.cards.landmine, targeting: 'emptyFriendlyLandmine', desc: '【地雷】\n在己方空地部署地雷，敌方单位经过时触发造成伤害' },
    commanderDeploy: { id: 'commanderDeploy', name: '部署将领', icon: EMOJI.cards.commanderDeploy, targeting: 'friendlyAny', desc: '【部署将领】\n将所选将领挂载到指定己方单位上' }
};

export const COLONEL_CARD_DATA = {
    goldCost: { diveStrafe: 3, carpetBomb: 4, airlift: 4 },
    range: 6,
    antiairRadius: 2,
    airDamagePerStack: 0.05,
    maxAirDamageStacks: 6,
    diveStrafe: {
        id: 'diveStrafe', name: '扫射', icon: EMOJI.cards.diveStrafe, targeting: 'enemyGlobal',
        desc: '',
        balance: { attackMultiplier: 1.5, missingHpToAttackPct: 0.10, maxMissingHpAttack: 15 }
    },
    carpetBomb: {
        id: 'carpetBomb', name: '轰炸', icon: EMOJI.cards.carpetBomb, targeting: 'enemyGlobal',
        desc: '',
        balance: { centerMultiplier: 1, splashMultiplier: 0.6, ignoreDefense: 0.10 }
    },
    airlift: { id: 'airlift', name: '空运', icon: EMOJI.cards.airlift, targeting: 'friendlyAny', desc: '' }
};

// 卡牌的数值说明由 balance 自动生成，禁止在此以外重复写伤害、回合或金币数字。
TACTICAL_CARD_DATA.heal.desc = `【疗愈】\n对指定单位释放，立即恢复其${percent(TACTICAL_CARD_DATA.heal.balance.healMaxHpPct)}最大生命值`;
TACTICAL_CARD_DATA.lightning.desc = `【雷击】\n对指定敌方单位造成${rangeText(TACTICAL_CARD_DATA.lightning.balance.minDamage, TACTICAL_CARD_DATA.lightning.balance.maxDamage)}真实伤害，雨天伤害提高${percent(TACTICAL_CARD_DATA.lightning.balance.rainMultiplier - 1)}`;
TACTICAL_CARD_DATA.mgNest.desc = `【碉堡】\n在指定己方行政区空地部署一座碉堡\nHP=${UNIT_CONFIG.mgNest.hp} ATK=${UNIT_CONFIG.mgNest.attack} 射程=${UNIT_CONFIG.mgNest.range} 不可移动`;
TACTICAL_CARD_DATA.airdrop.desc = `【空降】\n在指定空地投放一支${TACTICAL_CARD_DATA.airdrop.balance.infantryHp}生命值的空降步兵`;
TACTICAL_CARD_DATA.forceMarch.desc = `【强行军】\n对指定己方单位释放，立即回复${TACTICAL_CARD_DATA.forceMarch.balance.movementPoints}点行动力`;
TACTICAL_CARD_DATA.scout.desc = `【侦察】\n对指定位置释放，揭示目标及其周围6格区域的战争迷雾，持续${TACTICAL_CARD_DATA.scout.balance.duration}回合`;
TACTICAL_CARD_DATA.airstrike.desc = `【空袭】\n对指定敌方目标及周边6格造成${rangeText(TACTICAL_CARD_DATA.airstrike.balance.minDamage, TACTICAL_CARD_DATA.airstrike.balance.maxDamage)}范围伤害，命中城市时其${TACTICAL_CARD_DATA.airstrike.balance.cityDisableRounds}回合内无法产出资源或招募部队`;
TACTICAL_CARD_DATA.shield.desc = `【护盾】\n对指定目标释放，使其获得${TACTICAL_CARD_DATA.shield.balance.shield}点护盾值，持续${TACTICAL_CARD_DATA.shield.balance.duration}回合`;
COLONEL_CARD_DATA.diveStrafe.desc = `【扫射】$${COLONEL_CARD_DATA.goldCost.diveStrafe}\n对指定单体目标造成伤害；附加等同于目标已损生命值${percent(COLONEL_CARD_DATA.diveStrafe.balance.missingHpToAttackPct)}的攻击力（最多+${COLONEL_CARD_DATA.diveStrafe.balance.maxMissingHpAttack}），再按标准伤害流程结算`;
COLONEL_CARD_DATA.carpetBomb.desc = `【轰炸】$${COLONEL_CARD_DATA.goldCost.carpetBomb}\n对指定单体目标及相邻6格造成范围伤害（中心${percent(COLONEL_CARD_DATA.carpetBomb.balance.centerMultiplier)}/溅射${percent(COLONEL_CARD_DATA.carpetBomb.balance.splashMultiplier)}，破甲${percent(COLONEL_CARD_DATA.carpetBomb.balance.ignoreDefense)}）`;
COLONEL_CARD_DATA.airlift.desc = `【空运】$${COLONEL_CARD_DATA.goldCost.airlift}\n运送一名自己以外的友军单位至已探索空地`;

/** 兵种被动和效果栏文案。这里改动会同时影响选择面板和悬浮详情。 */
export const FRONTEND_TEXT = {
    unitPassives: {
        infantry: { name: '坚守', desc: '' },
        cavalry: { name: '冲锋', desc: '' },
        archer: { name: '远射', desc: '' }
    },
    effectDescriptions: {
        courageAura: '',
        healingAura: '',
        imprisoned: '本回合无法移动',
        immobile: '该单位无法移动',
        signalLost: '超出天眼5格信号范围，当前无法行动；回到信号范围后恢复。',
        guardianSelf: '',
        guardianAlly: ''
    },
    icons: {
        unitPassive: { infantry: '⚔️', cavalry: '🐎', archer: '🎯', drone: EMOJI.commander.drone },
        commander: {
            advisor: '🧠', astrologer: '🔮', berserker: EMOJI.commander.qixue, centurion: '🏛️', colonel: '🛩️', diplomat: '🤝', engineer: '🛠️', fallenAngel: '😇', ironGuard: '🛡️', magician: '🎩', martyr: '🔥', minister: '📜', necromancer: '💀', paladin: '✝️', priest: '🙏', staller: '🕳️', tianyan: '🛰️', vampire: '🧛'
        },
        skill: {
            '坚守': '🏰', '冲锋': '🐎', '远射': '🎯', '攻心': '🧠', '守护': '✨', '守护灵光': EMOJI.commander.guardianAura, '勇气灵光': EMOJI.commander.courageAura, '誓言': '⚔️', '至圣斩': '✝️', '挽歌': EMOJI.commander.qixue, '幻形': '🎭', '乘胜': '🏆', '制空': '✈️', '老练': '⭐', '留魂': EMOJI.commander.soul, '回魂': '💀', '治愈灵光': EMOJI.commander.healingAura, '夜观': '🌟', '堕天使·白': '🤍', '堕天使·黑': '🖤', '血怒': '💢', '泣血': EMOJI.commander.qixue, '殉道': '💀', '屯田': EMOJI.terrain.plains, '迟滞力场': '🌀', '连横': '🃏', '合纵': '🎴'
        },
        effect: {
            '城市': '🏙️', '村庄': '🏘️', '平原': EMOJI.terrain.plains, '森林': EMOJI.terrain.forest, '山地': EMOJI.terrain.mountain, '战壕': EMOJI.fortification.trenchBadge, '高射机枪': EMOJI.fortification.flak, '碉堡': '🏰', '士气上升': EMOJI.moraleBadge.up, '士气下降': EMOJI.moraleBadge.down, '混乱': EMOJI.moraleBadge.confused, '禁锢': '🔒', '不可移动': '🚫', '勇气灵光': EMOJI.commander.courageAura, '治愈灵光': EMOJI.commander.healingAura, '守护灵光': EMOJI.commander.guardianAura, '夜观': '🌟', '亡魂': EMOJI.commander.soul, '合纵': '🎴', '连横': '🃏', '缚足': '🕸️', '施工中': '🚧', '脚手架': '🏗️', '泣血': EMOJI.commander.qixue, '星移': '🔮'
        }
    }
};

/**
 * 将领平衡表。代码只读取这里的数值；描述中的数字也应同步在这里修改。
 * 保留 0 值是为了让配置项显式可见，而不是表示遗漏。
 */
export const COMMANDER_CONFIG = {
    advisor: {
        definition: {
            id: 'advisor', name: '谋士', skill: '攻心', hpBonusPct: 0.35, atkBonusPct: 0, spdBonus: 1,
            desc: '', tooltipDesc: ''
        },
        balance: { outcomeCount: 4, noEffectOutcome: 0, moraleDownOutcome: 1, confusedOutcome: 2, moraleDownLevel: 1, confusedLevel: 0, normalMorale: 2, durationRounds: 2, paladinAuraRange: 1 }
    },
    astrologer: {
        definition: {
            id: 'astrologer', name: '占星者', hpBonusPct: 0.30, atkBonusPct: 0.20, spdBonus: 0,
            skills: [
                { name: '夜观', desc: '', type: 'passive' },
                { name: '星移', desc: '', type: 'active' }
            ],
            activeSkill: { name: '星移', desc: '', duration: 2, cooldown: 5 }
        },
        balance: { auraRange: 3, weatherLockRounds: 2, cooldown: 5 }
    },
    berserker: {
        definition: {
            id: 'berserker', name: '狂战士', skill: '血怒', hpBonusPct: 0.25, atkBonusPct: 0, spdBonus: 0,
            desc: '', tooltipDesc: '',
            skills: [
                { name: '血怒', desc: '', type: 'passive' },
                { name: '泣血', desc: '', type: 'active' }
            ],
            activeSkill: { name: '泣血', desc: '', duration: 0, cooldown: 1 }
        },
        balance: { hpLossPerStackPct: 0.02, maxStacks: 40, statBonusPerStackPct: 0.01, qixueHpCostPct: 0.30, qixueDamageBonus: 0.30, qixueCritBonus: 0.50, qixueSplashMultiplier: 0.40, qixueRange: 1, cooldown: 1 }
    },
    centurion: {
        definition: {
            id: 'centurion', name: '百夫长', hpBonusPct: 0, atkBonusPct: 0.40, spdBonus: 1,
            skills: [{ name: '老兵', desc: '', type: 'passive' }, { name: '乘胜', desc: '', type: 'passive' }]
        },
        balance: { attackTriggerChance: 0.30, movementPoints: 3, maxTriggersPerRound: 1, veteranXpMultiplier: 2 }
    },
    colonel: {
        definition: {
            id: 'colonel', name: '空军上校', hpBonusPct: 0.30, atkBonusPct: 0.30, spdBonus: 1,
            skills: [
                { name: '制空', desc: '', type: 'passive' }, { name: '老练', desc: '', type: 'passive' }, { name: '扫射', desc: '', type: 'active' }, { name: '轰炸', desc: '', type: 'active' }, { name: '空运', desc: '', type: 'active' }
            ]
        },
        balance: { ...COLONEL_CARD_DATA }
    },
    diplomat: {
        definition: {
            id: 'diplomat', name: '纵横家', skill: '合纵', hpBonusPct: 0.30, atkBonusPct: 0.25, spdBonus: 0,
            skills: [{ name: '合纵', desc: '', type: 'passive' }, { name: '连横', desc: '', type: 'passive' }]
        },
        balance: { handSizeBonus: 1, useBonus: 1, copyChance: 0.50 }
    },
    engineer: {
        definition: {
            id: 'engineer', name: '工程师', hpBonusPct: 0.30, atkBonusPct: 0.15, spdBonus: 0,
            skills: [
                { name: '挖掘战壕', desc: '', type: 'active' },
                { name: '高射机枪', desc: '', type: 'active' },
                { name: '建造碉堡', desc: '', type: 'active' }
            ],
            activeSkills: [
                { id: 'trench', name: '战壕', goldCost: 0 },
                { id: 'flak', name: '高射机枪', goldCost: 0 },
                { id: 'bunker', name: '碉堡', goldCost: 0 }
            ]
        },
        balance: { trenchGoldCost: 2, flakGoldCost: 2, bunkerGoldCost: 5, bunkerBuildRounds: 1, bunkerCooldownRounds: 2, bunkerHp: 200, bunkerRange: 1 }
    },
    fallenAngel: {
        definition: {
            id: 'fallenAngel', name: '堕天使', hpBonusPct: 0.35, atkBonusPct: 0, spdBonus: 0,
            skills: [{ name: '堕落', desc: '', type: 'passive' }, { name: '净化', desc: '', type: 'passive' }]
        },
        balance: { blackMoraleLevels: [1, 3], normalMorale: 2, blackAttackFlat: 30, blackCritBonus: 0.60, blackHpLossPct: 0.20, whiteMissingHpHealPct: 0.30 }
    },
    ironGuard: {
        definition: {
            id: 'ironGuard', name: '铁卫', hpBonusPct: 0.30, atkBonusPct: 0, spdBonus: 0,
            skills: [{ name: '守护', desc: '', type: 'passive' }, { name: '守护灵光', desc: '', type: 'passive' }]
        },
        balance: { shieldMax: 120, shieldRestorePerRound: 40, auraDefenseBonus: 0.10 }
    },
    magician: {
        definition: {
            id: 'magician', name: '魔术师', skill: '幻形', hpBonusPct: 0.20, atkBonusPct: 0, spdBonus: 0,
            skills: [{ name: '千面', desc: '', type: 'passive' }, { name: '幻形', desc: '', type: 'passive' }]
        },
        balance: { counterDamageBonus: 0.25, counterDefenseBonus: 0.15, hpBonusPct: 0.20, rankHpBonus: 20, damagePerStack: 0.05, critPerStack: 0.10, maxStacks: 6 }
    },
    martyr: {
        definition: {
            id: 'martyr', name: '殉道者', skill: '殉道', hpBonusPct: 0.30, atkBonusPct: 0, spdBonus: 0,
            skills: [{ name: '殉道', desc: '', type: 'passive' }, { name: '挽歌', desc: '', type: 'passive' }]
        },
        balance: { triggerHp: 1, explosionRange: 2, centerMultiplier: 4, adjacentMultiplier: 2, outerMultiplier: 1, elegyAttackPerDeath: 5, elegyAttackCap: 25, moraleBoostRounds: 2 }
    },
    minister: {
        definition: { id: 'minister', name: '尚书', skill: '屯田', hpBonusPct: 0.40, atkBonusPct: 0, spdBonus: 0, desc: '' },
        balance: { goldPerRound: 1, maxGoldPerRound: 12 }
    },
    necromancer: {
        definition: {
            id: 'necromancer', name: '亡灵法师', hpBonusPct: 0.25, atkBonusPct: 0.20, spdBonus: 0,
            skills: [{ name: '留魂', desc: '', type: 'passive' }, { name: '回魂', desc: '', type: 'passive' }]
        },
        balance: { soulMarkRounds: 3, curseBaseDamage: 20, curseMissingHpPct: 0.40, maxSoulMinions: 2, soulHpPct: 0.40, soulAttackPct: 0.70, moraleBoostRounds: 2, rankXp: [0, 2, 5, 12, 20], killBaseXp: 3, commanderKillXp: 10 }
    },
    paladin: {
        definition: {
            id: 'paladin', name: '圣骑士', hpBonusPct: 0.25, atkBonusPct: 0.30, spdBonus: 0,
            skills: [{ name: '勇气灵光', desc: '', type: 'passive' }, { name: '誓言', desc: '', type: 'passive' }, { name: '至圣斩', desc: '', type: 'active' }],
            activeSkill: { name: '至圣斩', desc: '', duration: 0, cooldown: 0 }
        },
        balance: { faithMax: 3, faithOnDeploy: 1, faithCostPerCharge: 1, defensePerFaith: 0.05, auraAttackBonus: 0.10, smiteCooldown: 1, normalSmiteMin: 25, normalSmiteMax: 40, chargedSmiteMin: 65, chargedSmiteMax: 85, maxSmiteCharges: 2 }
    },
    priest: {
        definition: {
            id: 'priest', name: '牧师', hpBonusPct: 0.30, atkBonusPct: 0, spdBonus: 0,
            skills: [{ name: '圣疗', desc: '', type: 'passive' }, { name: '祈祷', desc: '', type: 'active' }],
            activeSkill: { name: '祈祷', desc: '', duration: 0, cooldown: 5 }
        },
        balance: { chainFirstRange: 1, chainFirstHealPct: 0.10, chainSecondRange: 2, chainSecondHealPct: 0.05, prayerRange: 2, prayerHpCostPct: 0.50, prayerInitialHealPct: 0.35, auraHealPct: 0.20, auraDuration: 3, minimumHpPct: 0.20, cooldown: 5 }
    },
    staller: {
        definition: { id: 'staller', name: '停滞者', skill: '迟滞力场', hpBonusPct: 0.30, atkBonusPct: 0.20, spdBonus: 0, desc: '' },
        balance: { range: 2, movementCostPerLayer: 2, rangedDefenseBonus: 0.25, rangeReduction: 1 }
    },
    tianyan: {
        definition: {
            id: 'tianyan', name: '天眼', hpBonusPct: 0.30, atkBonusPct: 0.15, spdBonus: 1,
            skills: [{ name: '战场观测', desc: '', type: 'passive' }, { name: '天眼哨机', desc: '', type: 'active' }, { name: '自爆', desc: '', type: 'active' }],
            activeSkill: { name: '天眼哨机', desc: '', duration: 0, cooldown: 0 }
        },
        balance: { maxCount: 2, signalRange: 5, deployRange: 1, deployLimitPerTurn: 1, deployGoldCost: 5, hp: 75, attack: 30, movement: 8, attackRange: 2, suicideRange: 3, visionBonus: 1, actionPointCost: 2 }
    },
    vampire: {
        definition: { id: 'vampire', name: '吸血鬼', skill: '嗜血', hpBonusPct: 0.20, atkBonusPct: 0.40, spdBonus: 0, desc: '' },
        balance: { healMinPct: 0.30, healMaxPct: 0.60, overflowToShieldPct: 0.50, shieldCap: 60 }
    }
};

// 将领数值说明：只引用上方 balance。若修改平衡值，选将卡、技能详情和 tooltip 会同步更新。
{
    const advisor = COMMANDER_CONFIG.advisor;
    advisor.definition.desc = advisor.definition.tooltipDesc = `攻击时随机判定：${percent(1 / advisor.balance.outcomeCount)}无效果、${percent(1 / advisor.balance.outcomeCount)}使目标士气下降${advisor.balance.durationRounds}回合、${percent(1 / advisor.balance.outcomeCount)}使目标混乱${advisor.balance.durationRounds}回合、${percent(1 / advisor.balance.outcomeCount)}使非将领目标变更为己方势力；将领命中最后一项时改为混乱${advisor.balance.durationRounds}回合`;

    const astrologer = COMMANDER_CONFIG.astrologer;
    astrologer.definition.skills[0].desc = `自身${astrologer.balance.auraRange}格范围内友军单位免疫天气不利效果`;
    astrologer.definition.skills[1].desc = `强制指定天气并锁定${astrologer.balance.weatherLockRounds}回合，锁定期间天气负面效果对所有敌人生效，若处于【夜观】范围内则效果翻倍（⏳${astrologer.balance.cooldown}）`;
    astrologer.definition.activeSkill.desc = `强制指定当前天气并锁定${astrologer.balance.weatherLockRounds}回合（⏳${astrologer.balance.cooldown}）`;

    const berserker = COMMANDER_CONFIG.berserker;
    const berserkerStackLoss = percent(berserker.balance.hpLossPerStackPct);
    const berserkerStatBonus = percent(berserker.balance.statBonusPerStackPct);
    const berserkerPassive = `每损失${berserkerStackLoss}生命值，获得${berserkerStatBonus}攻击力与${berserkerStatBonus}防御力加成，最多${percent(berserker.balance.maxStacks * berserker.balance.statBonusPerStackPct)}`;
    const qixueText = `立即消耗${percent(berserker.balance.qixueHpCostPct)}当前生命值使下一次攻击获得${percent(berserker.balance.qixueDamageBonus)}伤害加成并获得${percent(berserker.balance.qixueCritBonus)}暴击率，同时主目标周围${berserker.balance.qixueRange}格范围内的敌人受到原本${percent(berserker.balance.qixueSplashMultiplier)}的溅射伤害。`;
    berserker.definition.desc = berserker.definition.tooltipDesc = berserkerPassive;
    berserker.definition.skills[0].desc = berserkerPassive;
    berserker.definition.skills[1].desc = qixueText;
    berserker.definition.activeSkill.desc = qixueText;
    berserker.definition.activeSkill.cooldown = berserker.balance.cooldown;

    const centurion = COMMANDER_CONFIG.centurion;
    centurion.definition.skills[1].desc = `攻击时有${percent(centurion.balance.attackTriggerChance)}概率获得${centurion.balance.movementPoints}点行动力，击杀时必定触发，每回合最多${centurion.balance.maxTriggersPerRound}次`;

    const colonel = COMMANDER_CONFIG.colonel;
    colonel.definition.skills[0].desc = `无法使用普通对策卡；上校存活且部署时可消耗金币使用专属空军对策卡；最大航程为${colonel.balance.range}格；雾天停飞无法使用`;
    colonel.definition.skills[1].desc = `每使用1张空军卡使本场空军伤害提高${percent(colonel.balance.airDamagePerStack)}，最多叠加${colonel.balance.maxAirDamageStacks}层`;
    colonel.definition.skills[2].desc = COLONEL_CARD_DATA.diveStrafe.desc.replace('【扫射】', '');
    colonel.definition.skills[3].desc = COLONEL_CARD_DATA.carpetBomb.desc.replace('【轰炸】', '');
    colonel.definition.skills[4].desc = COLONEL_CARD_DATA.airlift.desc.replace('【空运】', '');

    const diplomat = COMMANDER_CONFIG.diplomat;
    diplomat.definition.skills[0].desc = `对策卡上限+${diplomat.balance.handSizeBonus}，每回合对策卡使用次数+${diplomat.balance.useBonus}`;
    diplomat.definition.skills[1].desc = `处于非己方行政区时，有${percent(diplomat.balance.copyChance)}概率获得非己方使用的同名对策卡`;

    const engineer = COMMANDER_CONFIG.engineer;
    engineer.definition.skills[0].desc = `$${engineer.balance.trenchGoldCost} 在自身所在格挖掘永久【战壕】：处于其中的单位对近战攻击防御力提高${percent(FORTIFICATION_CONFIG.trench.defenseBonus)}`;
    engineer.definition.skills[1].desc = `$${engineer.balance.flakGoldCost} 在自身所在格架设永久【高射机枪】：处于其中的任何单位对远程攻击防御力提高${percent(FORTIFICATION_CONFIG.flak.defenseBonus)}`;
    engineer.definition.skills[2].desc = `$${engineer.balance.bunkerGoldCost} 对指定位置施工，花费${engineer.balance.bunkerBuildRounds}个己方回合（期间工程师无法行动、同时只能修建1座碉堡）建成1座碉堡`;
    engineer.definition.activeSkills[0].goldCost = engineer.balance.trenchGoldCost;
    engineer.definition.activeSkills[1].goldCost = engineer.balance.flakGoldCost;
    engineer.definition.activeSkills[2].goldCost = engineer.balance.bunkerGoldCost;

    const fallenAngel = COMMANDER_CONFIG.fallenAngel;
    fallenAngel.definition.skills[0].desc = `士气正常时切换至【堕天使·白】，每回合回复已损失生命值的${percent(fallenAngel.balance.whiteMissingHpHealPct)}`;
    fallenAngel.definition.skills[1].desc = `士气上升或下降时切换至【堕天使·黑】，攻击力+${fallenAngel.balance.blackAttackFlat}、暴击率+${percent(fallenAngel.balance.blackCritBonus)}，每回合流失当前生命值${percent(fallenAngel.balance.blackHpLossPct)}`;

    const ironGuard = COMMANDER_CONFIG.ironGuard;
    ironGuard.definition.skills[0].desc = `部署时获得${ironGuard.balance.shieldMax}点永久护盾，每回合回复${ironGuard.balance.shieldRestorePerRound}点，最多${ironGuard.balance.shieldMax}点，自身及相邻友军获得【守护灵光】`;
    ironGuard.definition.skills[1].desc = `防御力+${percent(ironGuard.balance.auraDefenseBonus)}，所受伤害转由铁卫护盾承担`;

    const magician = COMMANDER_CONFIG.magician;
    magician.definition.skills[0].desc = `攻击克制目标时造成的伤害提高${percent(magician.balance.counterDamageBonus)}，被克制目标攻击时受到的伤害降低${percent(magician.balance.counterDefenseBonus)}`;
    magician.definition.skills[1].desc = `击杀敌方单位后变形为其兵种类型，获得1层【幻形】效果：造成的伤害提高${percent(magician.balance.damagePerStack)}、暴击率+${percent(magician.balance.critPerStack)}，最多叠加${magician.balance.maxStacks}层`;

    const martyr = COMMANDER_CONFIG.martyr;
    martyr.definition.skills[0].desc = `生命≤${martyr.balance.triggerHp}时进入殉道倒计时，期间可移动但无法攻击；下回合开始时对${martyr.balance.explosionRange}格范围内所有非己方单位造成基于攻击力的真实伤害`;
    martyr.definition.skills[1].desc = `己方单位阵亡时，殉道者永久获得${martyr.balance.elegyAttackPerDeath}点攻击力，最多叠加${martyr.balance.elegyAttackCap}点`;

    const minister = COMMANDER_CONFIG.minister;
    minister.definition.desc = `驻扎于城市时，每回合额外产出$${minister.balance.goldPerRound}×当前回合数，最多$${minister.balance.maxGoldPerRound}`;

    const necromancer = COMMANDER_CONFIG.necromancer;
    necromancer.definition.skills[0].desc = `友军单位阵亡后原地留下持续${necromancer.balance.soulMarkRounds}回合的【亡魂】，对占据其上的单位持续施加【亡魂诅咒】，每回合造成${necromancer.balance.curseBaseDamage}+${percent(necromancer.balance.curseMissingHpPct)}当前已损失生命值的真实伤害`;
    necromancer.definition.skills[1].desc = `回合开始牵引最近的空地【亡魂】唤起【魂卒】，拥有原单位${percent(necromancer.balance.soulHpPct)}生命值和${percent(necromancer.balance.soulAttackPct)}攻击力，场上最多${necromancer.balance.maxSoulMinions}个`;

    const paladin = COMMANDER_CONFIG.paladin;
    paladin.definition.skills[0].desc = `自身及相邻6格友军攻击力+${percent(paladin.balance.auraAttackBonus)}，士气不会下降或混乱`;
    paladin.definition.skills[1].desc = `【勇气灵光】范围内的友军受击或击杀时获得1誓言，每回合最多1层，上限${paladin.balance.faithMax}层，每层为圣骑士提供${percent(paladin.balance.defensePerFaith)}防御力`;
    paladin.definition.skills[2].desc = `每次点击消耗1层誓言蓄力（1层${rangeText(paladin.balance.normalSmiteMin, paladin.balance.normalSmiteMax)}/2层${rangeText(paladin.balance.chargedSmiteMin, paladin.balance.chargedSmiteMax)}真实伤害），最多${paladin.balance.maxSmiteCharges}层，命中后冷却${paladin.balance.smiteCooldown}回合`;
    paladin.definition.activeSkill.desc = `每次点击消耗1层誓言蓄力（1层${rangeText(paladin.balance.normalSmiteMin, paladin.balance.normalSmiteMax)}→再点→2层${rangeText(paladin.balance.chargedSmiteMin, paladin.balance.chargedSmiteMax)}），最多${paladin.balance.maxSmiteCharges}层，命中后冷却${paladin.balance.smiteCooldown}回合`;

    const priest = COMMANDER_CONFIG.priest;
    priest.definition.skills[0].desc = `每回合链式群体治疗：1段瞄准相邻友方回复${percent(priest.balance.chainFirstHealPct)}生命值，2段传导${priest.balance.chainSecondRange}格内友方回复${percent(priest.balance.chainSecondHealPct)}生命值`;
    priest.definition.skills[1].desc = `消耗${percent(priest.balance.prayerHpCostPct)}当前生命值，为${priest.balance.prayerRange}格范围友军附加【治愈灵光】：立即回复${percent(priest.balance.prayerInitialHealPct)}生命值，每回合再回复${percent(priest.balance.auraHealPct)}生命值，持续期间受致命一击则提前释放全部剩余治疗量并消耗灵光（⏱${priest.balance.auraDuration} ⏳${priest.balance.cooldown}）`;
    priest.definition.activeSkill.desc = `消耗${percent(priest.balance.prayerHpCostPct)}当前HP，为${priest.balance.prayerRange}格范围友军附加【治愈灵光】（立即${percent(priest.balance.prayerInitialHealPct)}HP+每回合${percent(priest.balance.auraHealPct)}HP，持续${priest.balance.auraDuration}回合）；灵光单位受致命一击时提前迸发剩余治疗，仍不足则保底${percent(priest.balance.minimumHpPct)}生命`;

    const staller = COMMANDER_CONFIG.staller;
    staller.definition.desc = `自身${staller.balance.range}格范围内敌人每步移动力消耗+${staller.balance.movementCostPerLayer}，范围内友军单位对远程攻击防御力提高${percent(staller.balance.rangedDefenseBonus)}`;

    const tianyan = COMMANDER_CONFIG.tianyan;
    tianyan.definition.skills[0].desc = `遭遇战中自身视野+${tianyan.balance.visionBonus}；常驻显示${tianyan.balance.signalRange}格无人机信号范围`;
    tianyan.definition.skills[1].desc = `$${tianyan.balance.deployGoldCost} 在周围部署天眼哨机，每回合可部署${tianyan.balance.deployLimitPerTurn}架，上限${tianyan.balance.maxCount}架，哨机与天眼距离超过${tianyan.balance.signalRange}格会失控`;
    tianyan.definition.skills[2].desc = `立即撞向${tianyan.balance.suicideRange}格内指定目标自毁并造成穿刺伤害`;
    tianyan.definition.activeSkill.desc = `$${tianyan.balance.deployGoldCost} 在周围${tianyan.balance.deployRange}格空地部署天眼哨机，每回合最多部署${tianyan.balance.deployLimitPerTurn}架，同时最多存在${tianyan.balance.maxCount}架`;

    const vampire = COMMANDER_CONFIG.vampire;
    vampire.definition.desc = `攻击造成伤害时随机回复伤害值${percent(vampire.balance.healMinPct)}~${percent(vampire.balance.healMaxPct)}的生命值（溢出部分按${percent(vampire.balance.overflowToShieldPct)}转化为护盾，上限${vampire.balance.shieldCap}）`;
}

/** 伤害管线的共用平衡参数；`Unit.js` 不再保存这些魔法数字。 */
export const COMBAT_BALANCE = {
    float: {
        attack: { min: 0.85, max: 1.35, critThreshold: 1.30 },
        counter: { min: 0.90, cityMin: 1.00, max: 1.70, critThreshold: 1.50, baseMultiplier: 0.75 },
        morale: { up: { min: 0.05, max: 0.10 }, down: { min: -0.05, max: -0.10 }, confused: { min: -0.10, max: -0.20 } }
    },
    counter: { advantageDamage: 0.20, disadvantageDamage: -0.20, advantageCrit: 0.25 },
    defense: { minimumMultiplier: 0.30, forestVsRangedBonus: 0.15, cityInfantryBonus: 0.10, windInfantryPenalty: 0.15, rainCityInfantryBonus: 0.10, antiairPerLayer: 0.25, antiairMaxLayers: 2 },
    cavalry: { normalChargeDamagePerStep: 0.10, fogChargeDamagePerStep: 0.15, maxChargeSteps: 3, fogDamageBonus: 0.20 },
    infantry: { cityHealPct: 0.10, cityDamageBonus: 0.15 },
    weather: { rainCityHealPct: 0.15, rainCavalryMovementCost: 1, fogArcherRangeDelta: -1, windArcherRangeDelta: 1, windArcherDamageBonus: 0.20 },
    rank: { hpBonusAtFirstRank: 20 }
};

// 与全局平衡绑定的展示文字。这里没有第二份数值，前端读取的都是这些生成结果。
FRONTEND_TEXT.unitPassives.infantry.desc = `位于城市时每回合回复${percent(COMBAT_BALANCE.infantry.cityHealPct)}生命值，防御力提高${percent(COMBAT_BALANCE.defense.cityInfantryBonus)}，造成的伤害提高${percent(COMBAT_BALANCE.infantry.cityDamageBonus)}`;
FRONTEND_TEXT.unitPassives.cavalry.desc = `势能：本回合每移动1格，造成的伤害提高${percent(COMBAT_BALANCE.cavalry.normalChargeDamagePerStep)}，最多${percent(COMBAT_BALANCE.cavalry.normalChargeDamagePerStep * COMBAT_BALANCE.cavalry.maxChargeSteps)}，回合结束消失`;
FRONTEND_TEXT.unitPassives.archer.desc = `山地射程+${COMBAT_BALANCE.weather.windArcherRangeDelta}（不与风天叠加）；风天射程+${COMBAT_BALANCE.weather.windArcherRangeDelta}`;
FRONTEND_TEXT.effectDescriptions.courageAura = `攻击力提高${percent(COMMANDER_CONFIG.paladin.balance.auraAttackBonus)}，士气不会下降`;
FRONTEND_TEXT.effectDescriptions.healingAura = `每回合回复${percent(COMMANDER_CONFIG.priest.balance.auraHealPct)}最大生命值，受致命一击时提前释放全部剩余治疗量，仍不足则保底${percent(COMMANDER_CONFIG.priest.balance.minimumHpPct)}生命`;
FRONTEND_TEXT.effectDescriptions.guardianSelf = `防御力提高${percent(COMMANDER_CONFIG.ironGuard.balance.auraDefenseBonus)}`;
FRONTEND_TEXT.effectDescriptions.guardianAlly = `防御力提高${percent(COMMANDER_CONFIG.ironGuard.balance.auraDefenseBonus)}，伤害由铁卫护盾承担`;
FORTIFICATION_CONFIG.trench.desc = `对近战攻击防御力提高${percent(FORTIFICATION_CONFIG.trench.defenseBonus)}`;
FORTIFICATION_CONFIG.flak.desc = `对远程攻击防御力提高${percent(FORTIFICATION_CONFIG.flak.defenseBonus)}`;
MORALE_CONFIG[3].desc = `暴击率提高${percent(COMBAT_BALANCE.float.morale.up.max - COMBAT_BALANCE.float.morale.up.min)}，防御力提高${percent(MORALE_CONFIG[3].defBonus)}`;
MORALE_CONFIG[1].desc = `暴击率降低${percent(Math.abs(COMBAT_BALANCE.float.morale.down.max))}，防御力降低${percent(Math.abs(MORALE_CONFIG[1].defBonus))}`;
MORALE_CONFIG[0].desc = `无法行动，暴击率降低${percent(Math.abs(COMBAT_BALANCE.float.morale.confused.min))}，防御力降低${percent(Math.abs(MORALE_CONFIG[0].defBonus))}`;
WEATHER_CONFIG.rain.desc = `驻扎在城市上的单位每回合恢复${percent(COMBAT_BALANCE.weather.rainCityHealPct)}最大生命值，步兵守城防御提高${percent(COMBAT_BALANCE.defense.rainCityInfantryBonus)}，骑兵每步行动力消耗提高${COMBAT_BALANCE.weather.rainCavalryMovementCost}点`;
WEATHER_CONFIG.fog.desc = `炮兵射程${COMBAT_BALANCE.weather.fogArcherRangeDelta}，骑兵伤害提高${percent(COMBAT_BALANCE.cavalry.fogDamageBonus)}且每格冲锋伤害额外提高${percent(COMBAT_BALANCE.cavalry.fogChargeDamagePerStep - COMBAT_BALANCE.cavalry.normalChargeDamagePerStep)}`;
WEATHER_CONFIG.wind.desc = `炮兵射程+${COMBAT_BALANCE.weather.windArcherRangeDelta}且伤害提高${percent(COMBAT_BALANCE.weather.windArcherDamageBonus)}，步兵防御力降低${percent(COMBAT_BALANCE.defense.windInfantryPenalty)}`;
