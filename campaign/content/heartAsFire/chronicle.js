// 传记《我心如火》—— 已归档 / 整合入《染血的鸢尾花》
// ============================================================
// 本文件保留供关卡素材参考，不再从 catalog.js 加载。
// 雨幕下的孤城残局教学素材已分散融入鸢尾花四场教学闪回（T1/T3/T7/T12）。
// 见 docs/染血的鸢尾花·战役设计文档.md 第三章《关卡结构总表》。
// ============================================================

export const CAMPAIGN_STORAGE_KEY = 'bladesOfHex.campaign.heartAsFire';

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
    scenarios: Object.freeze([])
});

export default CHRONICLE;
