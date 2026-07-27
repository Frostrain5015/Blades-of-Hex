// 《染血的鸢尾花》收藏物总表。关卡只引用属于自己的条目，大厅使用完整总表陈列。
export const BLOOD_IRIS_COLLECTIBLES = Object.freeze([
    Object.freeze({
        id: 'bi04_family_letter',
        scenarioId: 'bi-04-gate',
        name: '未焚的家书',
        emoji: '✉️',
        description: '东境往来函里夹着的一封私信，被卡托从火盆边抽了出来。官印和回执都烧了，写给人的那几行留了下来——同一间档案厅，第二天会被另一支军队翻检。'
    }),
    Object.freeze({
        id: 'bi06_cloak_clasp',
        scenarioId: 'bi-06-triumph',
        name: '王室斗篷扣',
        emoji: '🪝',
        description: '庆典夜在王宫侧门外的泥里捡到的一枚鎏金扣，扣面是五瓣鸢尾。搭扣是从里面解开的——不是被扯断的。'
    }),
    Object.freeze({
        id: 'bi05_charred_silk',
        scenarioId: 'bi-05-petra',
        name: '焦黑帛书残片',
        emoji: '📃',
        description: '佩特拉自治领档案厅灰烬中发现的半片帛书，只能依稀辨出“君侧之人，实非忠良”几个字。'
    }),
    Object.freeze({
        id: 'bi13_blood_oath_badge',
        scenarioId: 'bi-13-oppose',
        name: '暗红鸢尾誓章',
        emoji: '⚜️',
        description: '瓦罗藏在贴身甲胄里三年的旧誓章。白釉早被汗、锈与血浸成暗红；他摘下了给别人看的那枚，却从未真正丢弃这一枚。'
    })
]);

export function collectiblesForScenario(scenarioId) {
    return BLOOD_IRIS_COLLECTIBLES
        .filter(item => item.scenarioId === scenarioId)
        .map(({ id, name, emoji, description }) => ({ id, name, emoji, description }));
}
