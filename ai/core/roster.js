// 远征兵力口径必须在任务、时钟和生产层一致；后方经济将领不计作占领者。
export function isFieldCapturer(world, unit) {
    return world.isCapturable(unit) && !world.isImmobile(unit)
        && !['minister', 'astrologer'].includes(unit.commander);
}
