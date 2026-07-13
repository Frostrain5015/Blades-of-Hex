// 剧情将领把“人物身份”与“玩法原型”分离：名字/立绘服务叙事，
// archetype 仍复用标准将领的数值和技能；不填 archetype 即为纯剧情将领。

export function findStoryCommander(config, id) {
    if (!id) return null;
    return (config?.storyCommanders || []).find(commander => commander?.id === id) || null;
}

export function resolveCommanderMount(config, spec = {}) {
    const story = findStoryCommander(config, spec.storyCommander);
    if (!story) {
        return {
            commander: spec.commander || null,
            storyCommanderId: null,
            commanderName: '',
            commanderPortrait: spec.commander || null
        };
    }
    const commander = story.archetype || null;
    return {
        commander,
        storyCommanderId: story.id,
        commanderName: story.name || story.id,
        commanderPortrait: story.portrait || commander || 'npcMale'
    };
}

export function applyCommanderMount(unit, mount) {
    if (!unit || !mount) return unit;
    unit.storyCommanderId = mount.storyCommanderId || null;
    unit.commanderName = mount.commanderName || '';
    unit.commanderPortrait = mount.commanderPortrait || mount.commander || null;
    return unit;
}

