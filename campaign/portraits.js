// 战役对白可用的非将领立绘。键名是 JSON 剧本的稳定公开接口，
// 资源路径集中在此，避免剧情模块和 UI 各自硬编码中文文件名。
export const NPC_DIALOGUE_PORTRAITS = Object.freeze({
    npcMale: Object.freeze({
        label: 'NPC 男性（兜底立绘）',
        source: 'img/commander/NPC男.webp',
        transparentSource: 'img/commander_tr/NPC男.webp'
    }),
    npcFemale: Object.freeze({
        label: 'NPC 女性（兜底立绘）',
        source: 'img/commander/NPC女.webp',
        transparentSource: 'img/commander_tr/NPC女.webp'
    })
});

export const NPC_DIALOGUE_PORTRAIT_IDS = Object.freeze(Object.keys(NPC_DIALOGUE_PORTRAITS));
export const NPC_DIALOGUE_PORTRAIT_LABELS = Object.freeze(
    Object.fromEntries(Object.entries(NPC_DIALOGUE_PORTRAITS).map(([id, portrait]) => [id, portrait.label]))
);
