const SCENARIOS = Object.freeze([
    {
        id: 'visual-qa-all-effects',
        title: '全域视觉验收场',
        label: 'QA',
        elementKey: 'visual-qa-all-effects',
        type: 'utility',
        chapter: 0,
        order: 1,
        load: () => import('./visual-qa-all-effects.js')
    }
]);

export default Object.freeze({
    id: 'visual-qa',
    title: '视觉验收实验场',
    index: '开发工具',
    description: '常驻综合战场，用于快速检查地形、水文、单位、行动线与目标选择表现。',
    portraitCommanderId: 'engineer',
    storageKey: 'bladesOfHex.campaign.visualQa',
    collectibles: Object.freeze([]),
    cast: Object.freeze([]),
    scenarios: SCENARIOS
});
