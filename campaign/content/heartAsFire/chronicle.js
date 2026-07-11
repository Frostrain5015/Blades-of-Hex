// 传记《我心如火》—— 轻量元数据（eager 加载，供大厅目录与进度使用）。
// 关卡的重内容（剧本/建图/流程）在各关卡 scenario.js 里，经 load() 懒加载。

export const CAMPAIGN_STORAGE_KEY = 'bladesOfHex.campaign.heartAsFire';

// 关卡目录：只描述元信息与懒加载器，不含局内脚本。
const SCENARIOS = Object.freeze([
    Object.freeze({
        id: 'rain-city',
        title: '雨幕下的孤城',
        label: '序章',
        elementKey: 'rainCity',            // 生成 DOM id：rainCityLevelBtn / rainCityRating / startRainCityBtn
        seed: 0x5241494E,
        load: () => import('./rainCity/scenario.js')
    })
]);

const CHRONICLE = Object.freeze({
    id: 'heart-as-fire',
    title: '我心如火',
    index: '将星列传01',
    description: '伤痛会熄灭一个人，也会把他铸成火种。数位立场各异的将领，将从同一场战争的不同侧面走入彼此命运。',
    portraitCommanderId: 'berserker',      // 右侧立绘展示的视角角色
    storageKey: CAMPAIGN_STORAGE_KEY,
    cast: Object.freeze([
        { characterId: 'berserker', commanderId: 'berserker', role: 'viewpoint' },
        { characterId: 'centurion', commanderId: 'centurion', role: 'opponent' }
    ]),
    scenarios: SCENARIOS
});

export default CHRONICLE;
