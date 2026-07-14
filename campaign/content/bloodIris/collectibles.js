// 《染血的鸢尾花》收藏物总表。关卡只引用属于自己的条目，大厅使用完整总表陈列。
export const BLOOD_IRIS_COLLECTIBLES = Object.freeze([
    Object.freeze({
        id: 'bi05_charred_silk',
        scenarioId: 'bi-05-petra',
        name: '焦黑帛书残片',
        emoji: '📃',
        description: '佩特拉自治领档案厅灰烬中发现的半片帛书，只能依稀辨出“君侧之人，实非忠良”几个字。'
    })
]);

export function collectiblesForScenario(scenarioId) {
    return BLOOD_IRIS_COLLECTIBLES
        .filter(item => item.scenarioId === scenarioId)
        .map(({ id, name, emoji, description }) => ({ id, name, emoji, description }));
}
