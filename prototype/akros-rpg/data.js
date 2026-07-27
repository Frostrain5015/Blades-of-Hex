// 全部数据表，冻结后导出。写法对齐 rules/commanders.js：
// 数值只在 BALANCE 里出现一次，描述文字由数值派生，改平衡不必再改文案。
//
// 与本体的关系：所有平衡数值均从 rules/ 复制而来并注明来源，**刻意不 import**——
// 原型必须可整目录删除，且不能反向约束 rules/ 的改动（同 prototype/3d-battlefield 的纪律）。

import { dollars, percent } from './util.js';

// ============ 战斗平衡 ============
// 源：rules/constants.js COMBAT_BALANCE —— 与本体同口径的浮动倍率、暴击阈值与减伤下限。

export const COMBAT = Object.freeze({
    float: Object.freeze({ min: 0.85, max: 1.35, critThreshold: 1.30 }),
    defense: Object.freeze({ minimumMultiplier: 0.15, maximumReduction: 0.85 }),
    critMultiplier: 1.5,
    invulnerableSec: 0.4,          // 受击无敌帧
    knockbackPx: 46,
    deathMoneyLossPct: 0.20        // 阵亡在南门复活并损失两成现金
});

// 源：rules/units.js UNIT_RANK_CONFIG —— 军衔而非等级，沿用本体的晋升门槛。
export const RANK = Object.freeze({
    xpThresholds: Object.freeze([5, 15, 25, 35]),
    names: Object.freeze(['列兵', '什长', '选锋', '百夫长', '资深百夫长']),
    gainPerRank: Object.freeze({ might: 3, vigor: 3, agility: 1 }),
    critBonusAtFourthRank: 0.25    // 对齐 rank4.critBonus
});

// ============ 将领模板 ============
// 源：rules/commanders.js buildCenturion() —— 面板加成与技能语义原样搬来。

export const CENTURION = Object.freeze({
    id: 'centurion',
    name: '百夫长',
    hpBonusPct: 0,
    atkBonusPct: 0.40,
    spdBonus: 1,
    veteranXpMultiplier: 2
});

export const HERO = Object.freeze({
    id: 'marcus',
    name: '马库斯',
    title: '东征军前卫百夫长',
    oath: 'A-147',
    portrait: '/img/commander/百夫长.webp',
    archetype: CENTURION,
    base: Object.freeze({ might: 14, vigor: 12, agility: 11 }),
    startMoney: dollars(1.85),      // 半年军饷余额
    startEquipment: Object.freeze({ trinket: 'oathBadge' })
});

// ============ 技能 ============

const SKILL_BALANCE = Object.freeze({
    slash: { cooldown: 0.45, windup: 0.09, arc: Math.PI / 2, range: 40, multiplier: 1.0 },
    press: { cooldown: 4.0, windup: 0.06, dashPx: 80, dashSec: 0.17, arc: Math.PI * 0.72, range: 46, multiplier: 1.6, resetChance: 0.30 },
    formation: { cooldown: 8.0, duration: 1.2, damageReduction: 0.70, knockbackPx: 78, range: 52 }
});

export const SKILLS = Object.freeze({
    slash: Object.freeze({
        id: 'slash', name: '劈砍', key: '左键', glyph: '⚔',
        desc: `面朝方向 ${Math.round(SKILL_BALANCE.slash.arc * 180 / Math.PI)}° 扇形挥击`,
        balance: SKILL_BALANCE.slash
    }),
    press: Object.freeze({
        id: 'press', name: '乘胜', key: '1', glyph: '➤',
        desc: `突进并造成 ${SKILL_BALANCE.press.multiplier} 倍伤害；命中后 ${percent(SKILL_BALANCE.press.resetChance)} 概率、击杀必定立即重置冷却`,
        balance: SKILL_BALANCE.press
    }),
    formation: Object.freeze({
        id: 'formation', name: '结阵', key: '2', glyph: '🛡',
        desc: `举盾 ${SKILL_BALANCE.formation.duration} 秒，期间减伤 ${percent(SKILL_BALANCE.formation.damageReduction)}，结束时击退身前敌人`,
        balance: SKILL_BALANCE.formation
    })
});

export const PASSIVE = Object.freeze({
    id: 'veteran', name: '老兵', glyph: '✦',
    desc: `晋升速度提高 ${percent(CENTURION.veteranXpMultiplier - 1)}`
});

// ============ 物品 ============
// slot: weapon | armor | offhand | trinket；无 slot 即消耗品。
// modifiers 走可逆的修饰层：装备 push、卸下 pop，永不改写 base。

const mod = (stat, type, value) => Object.freeze({ stat, type, value });

export const ITEMS = Object.freeze({
    // —— 消耗品 ——
    bread: Object.freeze({
        id: 'bread', name: '黑麦面包', glyph: '🍞', price: dollars(0.02),
        use: Object.freeze({ healPct: 0.08 }), desc: '码头摊子上最便宜的一口热食。回复 8% 生命。'
    }),
    soup: Object.freeze({
        id: 'soup', name: '酒馆热汤', glyph: '🥣', price: dollars(0.06),
        use: Object.freeze({ healPct: 0.25 }), desc: '豆子与咸肉煮出来的浓汤。回复 25% 生命。'
    }),
    bandage: Object.freeze({
        id: 'bandage', name: '军用绷带', glyph: '🩹', price: dollars(0.14),
        use: Object.freeze({ healPct: 0.40 }), desc: '军中制式亚麻绷带，配一小罐蜂蜡。回复 40% 生命。'
    }),
    whetstone: Object.freeze({
        id: 'whetstone', name: '磨刀石', glyph: '🪨', price: dollars(0.25),
        use: Object.freeze({ nextHitBonus: 0.50 }), desc: '细砂岩。下一次命中伤害提高 50%。'
    }),

    // —— 武器 ——
    dagger: Object.freeze({
        id: 'dagger', name: '铜柄短匕', glyph: '🗡', slot: 'weapon', price: dollars(0.35),
        modifiers: Object.freeze([mod('attack', 'flat', 4)]), desc: '巷子里防身用的东西，算不上兵器。'
    }),
    gladius: Object.freeze({
        id: 'gladius', name: '制式短剑', glyph: '⚔', slot: 'weapon', price: dollars(1.10),
        modifiers: Object.freeze([mod('attack', 'flat', 12)]), desc: '王国远征军制式短剑。刃身短而厚，为列阵而生。'
    }),
    centurionBlade: Object.freeze({
        id: 'centurionBlade', name: '百夫长横剑', glyph: '🗡', slot: 'weapon', price: dollars(2.80),
        modifiers: Object.freeze([mod('attack', 'flat', 22), mod('critRate', 'flat', 0.08)]),
        desc: '柄首錾着鸢尾。军官自费，规制之外。'
    }),

    // —— 护甲 ——
    linen: Object.freeze({
        id: 'linen', name: '亚麻护胸', glyph: '🧥', slot: 'armor', price: dollars(0.30),
        modifiers: Object.freeze([mod('defense', 'flat', 0.04)]), desc: '多层亚麻压胶，穷士兵的第一件甲。'
    }),
    leather: Object.freeze({
        id: 'leather', name: '皮甲', glyph: '🧥', slot: 'armor', price: dollars(0.70),
        modifiers: Object.freeze([mod('defense', 'flat', 0.09)]), desc: '硬化牛皮缀铜片，轻便耐用。'
    }),
    chainmail: Object.freeze({
        id: 'chainmail', name: '锁子甲', glyph: '🛡', slot: 'armor', price: dollars(1.90),
        modifiers: Object.freeze([mod('defense', 'flat', 0.16), mod('moveSpeed', 'pct', -0.06)]),
        desc: '一万四千个铁环。挡得住刀，跑不快。'
    }),

    // —— 副手 ——
    woodShield: Object.freeze({
        id: 'woodShield', name: '木质圆盾', glyph: '🛡', slot: 'offhand', price: dollars(0.55),
        modifiers: Object.freeze([mod('defense', 'flat', 0.06)]), desc: '杨木蒙皮，边缘裹了一圈生铁。'
    }),
    irisShield: Object.freeze({
        id: 'irisShield', name: '鸢尾包铁盾', glyph: '⚜', slot: 'offhand', price: dollars(1.40),
        modifiers: Object.freeze([mod('defense', 'flat', 0.11), mod('formationBonus', 'flat', 0.10)]),
        desc: '盾面绘着王国的鸢尾。【结阵】减伤额外提高 10%。'
    }),

    // —— 饰品（非卖品，剧情物） ——
    oathBadge: Object.freeze({
        id: 'oathBadge', name: '鸢尾誓章 A-147', glyph: '⚜', slot: 'trinket', price: 0, priceless: true,
        modifiers: Object.freeze([mod('might', 'flat', 2)]),
        desc: '"以血印此花：我守奥雷利亚，奥雷利亚不负于我。"背面刻着军团、番号和他的名字。'
    })
});

// ============ 商人 ============
// 回购价 = 售价 × BUYBACK_RATE；库存有限，卖光即无，避免刷钱。

export const BUYBACK_RATE = 0.50;

export const MERCHANTS = Object.freeze({
    smith: Object.freeze({
        id: 'smith', name: '铁匠「砧」', sprite: 'smith', portrait: '/img/commander/NPC男.webp',
        greeting: '要打仗了？那就别拿巷子里的破铜烂铁去。东西在这儿，钱货两清。',
        buysAnything: false,
        stock: Object.freeze([
            Object.freeze({ item: 'dagger', count: 3 }),
            Object.freeze({ item: 'gladius', count: 2 }),
            Object.freeze({ item: 'centurionBlade', count: 1 }),
            Object.freeze({ item: 'linen', count: 3 }),
            Object.freeze({ item: 'leather', count: 2 }),
            Object.freeze({ item: 'chainmail', count: 1 }),
            Object.freeze({ item: 'woodShield', count: 3 }),
            Object.freeze({ item: 'irisShield', count: 1 }),
            Object.freeze({ item: 'whetstone', count: 5 })
        ])
    }),
    herbalist: Object.freeze({
        id: 'herbalist', name: '药婆 伊蕾妮', sprite: 'herbalist', portrait: '/img/commander/NPC女.webp',
        greeting: '东征的都来买绷带。带够了吗？回不来的都是嫌重的那些。',
        buysAnything: false,
        stock: Object.freeze([
            Object.freeze({ item: 'bread', count: 12 }),
            Object.freeze({ item: 'soup', count: 8 }),
            Object.freeze({ item: 'bandage', count: 6 })
        ])
    }),
    quartermaster: Object.freeze({
        id: 'quartermaster', name: '军需官', sprite: 'quartermaster', portrait: '/img/commander/NPC男.webp',
        greeting: '百夫长。军里只发口粮和绷带，别的自备——你知道规矩。多余的东西我按半价收。',
        buysAnything: true,
        stock: Object.freeze([
            Object.freeze({ item: 'bread', count: 20 }),
            Object.freeze({ item: 'bandage', count: 4 }),
            Object.freeze({ item: 'whetstone', count: 3 })
        ])
    })
});

// ============ NPC 对白（非商人） ============

export const NPCS = Object.freeze({
    dockHand: Object.freeze({
        id: 'dockHand', name: '码头搬运工', sprite: 'dockHand', portrait: '/img/commander/NPC男.webp',
        lines: Object.freeze([
            '……东征令下来了？',
            '我在这码头扛了两年半麻袋。什么船进来、什么人上岸，我都记得。',
            '你要是往北去，别走卫城那条坡道。上面现在只认紫色。'
        ])
    })
});

// ============ 敌人 ============

export const ENEMIES = Object.freeze({
    trainingDummy: Object.freeze({
        id: 'trainingDummy', name: '校场木桩', prop: 'dummy',
        hp: 200, attack: 0, defense: 0, speed: 0, xp: 1,
        senseRange: 0, attackRange: 0, attackCooldown: 99, drop: Object.freeze([0, 0]),
        respawnSec: 4
    }),
    dockThug: Object.freeze({
        id: 'dockThug', name: '码头混混', sprite: 'dockThug',
        hp: 60, attack: 9, defense: 0.02, speed: 74, xp: 4,
        senseRange: 190, attackRange: 34, attackCooldown: 1.2, windup: 0.28,
        drop: Object.freeze([dollars(0.03), dollars(0.08)]), respawnSec: 14
    }),
    drunkVeteran: Object.freeze({
        id: 'drunkVeteran', name: '醉酒老兵', sprite: 'drunkVeteran',
        hp: 95, attack: 14, defense: 0.08, speed: 66, xp: 8,
        senseRange: 210, attackRange: 38, attackCooldown: 1.7, windup: 0.46,
        drop: Object.freeze([dollars(0.06), dollars(0.14)]), respawnSec: 20
    }),
    regencyInformant: Object.freeze({
        id: 'regencyInformant', name: '摄政府眼线', sprite: 'regencyInformant',
        hp: 70, attack: 12, defense: 0.04, speed: 96, xp: 7,
        senseRange: 260, attackRange: 150, keepDistance: 110, attackCooldown: 2.0, windup: 0.36,
        ranged: true, projectileSpeed: 240,
        drop: Object.freeze([dollars(0.10), dollars(0.18)]), respawnSec: 22
    })
});

// ============ 开场提示 ============

export const INTRO = Object.freeze({
    speaker: '马库斯',
    portrait: HERO.portrait,
    lines: Object.freeze([
        '东征令昨夜就贴在校场门口了。三天后开拔。',
        '军里只发口粮和绷带，刀和甲得自己备——半年的饷，全在这袋子里。',
        '先去校场把手活过一遍，再进巷子里换点钱。'
    ])
});
