// 传记《染血的鸢尾花》—— 王国宫廷政变群像
// 三年前的弑君之夜，一句谎言烧尽了整座王国的夏天。
//
// 四章结构：
//   第一章「雨夜孤城」—— 佩特拉围城，百夫长马库斯视角（T1-T5）
//   第二章「我心如火」—— 猎宫转折，狂战士阿格里乌斯真相线（T6-T9）
//   第三章「同一个誓言」—— 集结反正，城门之战（T10-T13）
//   第四章「鸢尾落处」—— 复都，王座最终决战（T14-T15）
//
// 原《我心如火》的雨幕下的孤城残局素材已分散融入四场教学闪回中。
// 原 heartAsFire 关卡数据文件保留以供参考，不再从 catalog 加载。

export const CAMPAIGN_STORAGE_KEY = 'bladesOfHex.campaign.bloodIris';

const SCENARIOS = Object.freeze([]); // 待关卡设计完成后逐步填充

const CHRONICLE = Object.freeze({
    id: 'blood-iris',
    title: '染血的鸢尾花',
    index: '将星列传',
    description: '三年前先王暴毙，一句谎言如铁幕般覆盖了奥雷利亚全境。百夫长、铁卫、狂战士、尚书、谋士——五个按同一枚血印起誓的人，走向了五种对誓约的解释。',
    posterUrl: 'img/campaign/染血的鸢尾花.webp',
    storageKey: CAMPAIGN_STORAGE_KEY,
    cast: Object.freeze([
        { characterId: 'marcus',   commanderId: 'centurion',   role: 'viewpoint' },
        { characterId: 'varo',     commanderId: 'ironGuard',   role: 'opponent' },
        { characterId: 'agrius',   commanderId: 'berserker',   role: 'ally' },
        { characterId: 'cato',     commanderId: 'minister',    role: 'ally' },
        { characterId: 'severus',  commanderId: 'advisor',     role: 'villain' }
    ]),
    scenarios: SCENARIOS
});

export default CHRONICLE;
