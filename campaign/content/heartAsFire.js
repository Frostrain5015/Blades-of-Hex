// “我心如火”群像传记：首个可玩关卡的内容定义。
// 文案、目标和稳定实体 ID 留在内容层，控制器只负责执行流程。

export const HEART_AS_FIRE_CAMPAIGN = Object.freeze({
    id: 'heart-as-fire',
    title: '我心如火',
    scenarioIds: Object.freeze(['rain-city']),
    cast: Object.freeze([
        { characterId: 'berserker', commanderId: 'berserker', role: 'viewpoint' },
        { characterId: 'centurion', commanderId: 'centurion', role: 'opponent' }
    ])
});

export const RAIN_CITY_SCENARIO = Object.freeze({
    id: 'rain-city',
    title: '雨幕下的孤城',
    viewpointCharacterId: 'berserker',
    playableCamp: 'player1',
    seed: 0x5241494E,
    turnLimit: 4,
    objectives: Object.freeze({
        assault: { title: '突破城门', detail: '穿过森林，击败百夫长并占领中央城市。' },
        counterattack: { title: '迎击反扑', detail: '结束回合，让敌军反扑；狂战士必须活下来。' },
        hold: { title: '守到天明', detail: '在本回合结束时仍控制中央城市。' }
    }),
    optionalObjectives: Object.freeze([
        { id: 'archer-survives', text: '无人掉队：弩手存活' },
        { id: 'destroy-cavalry', text: '雷霆反击：消灭反扑骑兵' }
    ])
});

export const CAMPAIGN_STORAGE_KEY = 'bladesOfHex.campaign.heartAsFire';
