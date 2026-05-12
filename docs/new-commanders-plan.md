# 新将领设计方案：魔术师 · 圣骑士 · 牧师

> **文档类型**：Agent Plan — 将领设计规格说明  
> **版本**：v1.0  
> **状态**：待评审  
> **关联分支**：`feature/new-commanders-design`

---

## 概览

本文档描述三位新将领的完整设计方案，包括基础属性加成、被动技能、主动技能的精确数值，以及实现所需的钩子接口说明。三位将领的定位互补，填补现有将领池中"克制循环猎手""攻击灵光爆发""链式群疗辅助"三个空白方向。

| 将领 | ID | 技能名 | 核心定位 | hpBonus | atkBonus | spdBonus |
|------|----|--------|----------|---------|----------|----------|
| 魔术师 | `magician` | 幻形 | 克制强化 + 击杀变形 | +25 | 0 | 0 |
| 圣骑士 | `paladin` | 神圣斥喝 | 信仰资源爆发 + 攻击灵光 | +40 | +10 | 0 |
| 牧师 | `priest` | 圣链 | 链式智能群疗 | +60 | 0 | 0 |

---

## 一、魔术师（Magician）

### 设计意图

鼓励玩家在步兵→骑兵→炮兵三种兵种之间循环击杀，形成"找到正确克制目标→击杀→获得新克制位"的连锁战术循环。与百夫长"连杀连动"的定位不同，魔术师的节奏更慢、更需要规划。

**克制循环示例**：步兵魔术师 →（克制）杀骑兵 → 变形骑兵 → 下回合（克制）杀炮兵 → 变形炮兵 → 远程压制步兵。

### 基础属性

```js
id: 'magician'
name: '魔术师'
skill: '幻形'
hpBonus: 25
atkBonus: 0
spdBonus: 0
```

> **精算说明**：变形机制本身等价于"随时切换克制位"，属于高价值被动。面板故意压低：HP+25 保证三种形态切换后基础生命合理（步225 / 骑150 / 炮125），不至于变成炮兵就立即崩盘；不加攻击是因为克制系数提升已经是隐性攻击 buff。

### 被动一：【克制精通】

修改 `COUNTER_RELATION` 在魔术师攻击/防守时的实际生效系数：

| 情形 | 原系数 | 魔术师实际系数 |
|------|--------|----------------|
| 魔术师攻击克制目标 | 1.25× | **1.5×** |
| 魔术师攻击被克制目标 | 0.75× | **0.6×** |
| 敌方攻击克制魔术师 | 1.25× | **1.5×**（魔术师更怕被克） |

实现位置：在 `Unit._resolveDamage()` 中，若 `attacker.commander === 'magician'` 或 `defender.commander === 'magician'`，覆盖 `counterCoeff` 的取值。

### 被动二：【幻形】

**触发条件**：魔术师所在单位击杀敌方单位后。

**效果**：
1. 若被击杀单位兵种 === 魔术师当前兵种，**不触发**（同类无意义）。
2. 若被击杀单位为要塞（`mgNest`），**不触发**。
3. 否则，魔术师变形为被击杀单位的兵种：
   - 更新 `unit.type`、`unit.config`
   - HP 按比例迁移：`新HP = Math.round(新maxHp × (旧HP / 旧maxHp))`
   - 保留：`_xp`、`_rank`、`_rankDefBonus`、`_rankCritBonus`、`_rankRegenPct`、`_atkBonus`、`_shield`
   - 重置：`remainingMP = 0`、`canAct = false`（变形后本回合锁定）
   - 更新 `maxHp = 新兵种基础HP + hpBonus`

**实现钩子**：`onKill(killer, victim, helpers)`

```js
onKill(killer, victim, helpers) {
    if (victim.type === killer.type || victim.type === 'mgNest') return null;
    const newConfig = UNIT_CONFIG[victim.type];
    const hpRatio = killer.hp / killer.maxHp;
    killer.type = victim.type;
    killer.config = newConfig;
    killer.maxHp = newConfig.hp + 25; // hpBonus
    killer.hp = Math.round(killer.maxHp * hpRatio);
    killer.displayHp = killer.hp;
    killer.remainingMP = 0;
    killer.canAct = false;
    helpers.spawnFx(killer.tile.x, killer.tile.y, '🎭', '幻形');
    helpers.logMessage(`魔术师【幻形】：变形为${newConfig.name}兵`);
    return { transformed: true, newType: victim.type };
}
```

### 平衡约束

- 变形后 `canAct = false` + `remainingMP = 0` 是核心制衡，防止"杀→变形→连杀"无限滚雪球。
- 玩家每回合最多发生一次有意义的变形，需要提前规划击杀目标。

---

## 二、圣骑士（Paladin）

### 设计意图

参考《博德之门3》圣武士的战斗核心——神圣斥喝（Divine Smite）消耗资源换取爆发、守护灵光（Aura of Protection）加强队友、守誓信仰作为资源管理单元。

与铁卫的区分度：

| 维度 | 铁卫 | 圣骑士 |
|------|------|--------|
| 灵光性质 | 防御+10% + 友军伤害转移 | 攻击+10% + 士气免疫 |
| 资源类型 | 自动护盾（被动） | 信仰值（主动管理） |
| 战术定位 | 龟缩绞肉、友军保护盾 | 主动出击、信仰爆发 |
| 克制关系 | 被集火 / 高伤突破 | 被谋士降士气（勇气灵光可抵消） |

### 基础属性

```js
id: 'paladin'
name: '圣骑士'
skill: '神圣斥喝'
hpBonus: 40
atkBonus: 10
spdBonus: 0
```

### 资源：【信仰值】

- 部署时初始值：**1点**
- 每回合开始 +1（`onTurnStart` 钩子）
- 击杀敌方单位时 +1（`onKill` 钩子）
- 上限：**3点**
- 存储字段：`unit._faith`（部署时初始化）

### 主动技能：【神圣斥喝】

**消耗**：1点信仰值  
**效果**：为单位挂载一个"待命斥喝"标记（`unit._smiteReady = true`）  
**触发**：该单位下一次发起攻击时，额外附加 **+30 神圣伤害**（不参与防御、克制、浮动乘数计算，直接叠加在最终伤害上）  
**暴击联动**：若该次攻击触发强击（`isCrit === true`），神圣伤害翻倍至 **+60**（对应BG3暴击时伤害骰翻倍的设计）  
**冷却**：无硬性冷却，受信仰值数量天然限制（每回合最多1点，上限3点）

实现位置：在 `triggerCommanderOnAttack` 之后、伤害文字生成之前注入神圣伤害。

```js
// 在 onAttack 钩子中
onAttack(attacker, target, dmg, helpers) {
    // 信仰值自动累积在 onTurnStart / onKill 中处理
    if (!attacker._smiteReady || dmg <= 0) return null;
    attacker._smiteReady = false;
    const smiteDmg = helpers.isCrit ? 60 : 30; // isCrit 由调用方传入
    target.hp = Math.max(0, target.hp - smiteDmg);
    helpers.spawnFx(attacker.tile.x, attacker.tile.y, '✝️', '神圣斥喝');
    helpers.logMessage(`圣骑士【神圣斥喝】：附加${smiteDmg}神圣伤害${helpers.isCrit ? '（强击翻倍）' : ''}`);
    return { smiteDmg };
}
```

### 被动：【勇气灵光】

覆盖范围：自身及相邻6格内友军。

**效果一**：士气下限锁定为 **2**（免疫"士气下降"和"混乱"状态）
- 实现：在 `recalcAllFlankingMorale()` 之后，遍历灵光范围内友军，将 `unit.morale = Math.max(2, unit.morale)`
- 注意：该效果对谋士【攻心】形成天然克制

**效果二**：攻击力 +10%
- 实现：新增 `getAuraAttackBonus(allyUnit)` 接口，返回 `0.10`
- 在 `Unit.getEffectiveAttack()` 中加入灵光攻击加成的加算

```js
// commanderInterface.js 新增
export function getCommanderAuraAttackBonus(unit) {
    // 检查相邻是否有己方圣骑士
    // 返回 0.10 或 0
}

// Unit.getEffectiveAttack() 修改
getEffectiveAttack() {
    const baseAtk = this.config.attack + (this._atkBonus || 0) + getCommanderAttackBonus(this);
    const auraAtk = getCommanderAuraAttackBonus(this); // 新增
    return Math.round(baseAtk * (1 + auraAtk) * MORALE_CONFIG[this.morale].atkMulti);
}
```

---

## 三、牧师（Priest）

### 设计意图

纯辅助定位，但具备以下设计感：
1. **智能选目标**：自动选 HP 百分比最低的友军，而非固定位置，避免治疗浪费。
2. **链式传导**：治疗从最需要的目标"流向"次需要的目标，形成视觉和机制上的链接。
3. **代价爆发**：主动技能消耗自身血量换取大范围急救，制造"奶妈舍命救场"的戏剧张力。

与吸血鬼的区分：吸血鬼是"输出转自疗"的独狼，牧师是"消耗自身换群体续航"的辅助核心。

### 基础属性

```js
id: 'priest'
name: '牧师'
skill: '圣链'
hpBonus: 60
atkBonus: 0
spdBonus: 0
```

> **精算说明**：纯辅助定位需要足够生存力（步260 / 骑185 / 炮160），HP+60 对标铁卫和殉道者，保证牧师不会在治疗队友前先被秒。

### 被动：【圣链】

**触发时机**：每回合**结束时**（`onTurnEnd` 钩子）

**第一段**：
- 扫描相邻6格内所有友军（包括自身）
- 选取 `unit.hp / unit.maxHp` 最低的目标
- 若其 HP < maxHp，治疗 **45 HP**

**第二段（传导）**：
- 以第一段目标为中心，扫描其2格内的其他友军
- 选取 HP 百分比次低的目标
- 若其 HP < maxHp，治疗 **30 HP**
- 若第一段没有触发（周围无受伤友军），第二段同样跳过

**每回合最大产出**：45 + 30 = **75 HP** 群疗

```js
onTurnEnd(gameState, camp, helpers) {
    const unit = helpers.findCommanderUnit(camp, 'priest');
    if (!unit || !unit.tile) return;
    const tileMap = gameState.tileMap;
    const dirs = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];

    // 第一段：相邻6格，HP%最低
    let firstTarget = null, lowestRatio = 1;
    const range1 = [unit, ...dirs.map(([dq,dr]) => tileMap.get(`${unit.tile.q+dq},${unit.tile.r+dr}`)?.unit).filter(u => u && u.camp === camp && u.hp < u.maxHp)];
    for (const ally of range1) {
        const ratio = ally.hp / ally.maxHp;
        if (ratio < lowestRatio) { lowestRatio = ratio; firstTarget = ally; }
    }
    if (firstTarget) {
        firstTarget.heal(45);
        helpers.logMessage(`牧师【圣链·一段】治疗${firstTarget.config.name}兵 +45HP`);

        // 第二段：以firstTarget为中心，2格内HP%次低
        const range2Tiles = new Set();
        for (const [dq,dr] of dirs) {
            const nb = tileMap.get(`${firstTarget.tile.q+dq},${firstTarget.tile.r+dr}`);
            if (nb?.unit && nb.unit.camp === camp && nb.unit !== firstTarget && nb.unit.hp < nb.unit.maxHp) range2Tiles.add(nb.unit);
            for (const [dq2,dr2] of dirs) {
                const nb2 = tileMap.get(`${firstTarget.tile.q+dq+dq2},${firstTarget.tile.r+dr+dr2}`);
                if (nb2?.unit && nb2.unit.camp === camp && nb2.unit !== firstTarget && nb2.unit.hp < nb2.unit.maxHp) range2Tiles.add(nb2.unit);
            }
        }
        let secondTarget = null, secondLowest = 1;
        for (const ally of range2Tiles) {
            const ratio = ally.hp / ally.maxHp;
            if (ratio < secondLowest) { secondLowest = ratio; secondTarget = ally; }
        }
        if (secondTarget) {
            secondTarget.heal(30);
            helpers.logMessage(`牧师【圣链·传导】治疗${secondTarget.config.name}兵 +30HP`);
        }
    }
}
```

### 主动技能：【神圣涌现】

**触发条件**：玩家手动激活（主动技能按钮，与狂战士同类接口）

**代价**：消耗自身**当前HP的15%**（向上取整，最少扣1点，扣后HP不低于1）

**效果**：对以牧师为中心**2格内所有其他友军**，各治疗其 `maxHp × 25%`（向上取整）

**冷却**：4回合

**为什么自损有意义**：
- 触发后牧师自身变为残血，成为下一回合【圣链】的第一优先治疗目标，形成"急救→自愈"的内循环。
- 强迫玩家在"牧师当前HP是否撑得住自损"上做决策，而不是无脑释放。

```js
activeSkill: {
    name: '神圣涌现',
    desc: '消耗自身15%当前HP，治疗2格内所有友军其最大HP的25%',
    duration: 0,   // 瞬发，无持续
    cooldown: 4,
    buffs: {},

    onActivate(unit, helpers) {
        const cost = Math.max(1, Math.ceil(unit.hp * 0.15));
        unit.hp = Math.max(1, unit.hp - cost);
        const tileMap = helpers.gameState.tileMap;
        // 收集2格内友军
        const healed = [];
        for (let dq = -2; dq <= 2; dq++) {
            for (let dr = Math.max(-2,-dq-2); dr <= Math.min(2,-dq+2); dr++) {
                if (dq === 0 && dr === 0) continue;
                const nb = tileMap.get(`${unit.tile.q+dq},${unit.tile.r+dr}`);
                if (nb?.unit && nb.unit.camp === unit.camp) {
                    const healAmt = Math.ceil(nb.unit.maxHp * 0.25);
                    nb.unit.heal(healAmt);
                    healed.push(nb.unit.config.name);
                }
            }
        }
        helpers.spawnFx(unit.tile.x, unit.tile.y, '🕊️', '神圣涌现');
        helpers.logMessage(`牧师【神圣涌现】消耗${cost}HP，治疗：${healed.join('、')}兵`);
    }
}
```

---

## 实现清单

### 需要新建的文件

- `commander/magician.js`
- `commander/paladin.js`
- `commander/priest.js`

### 需要修改的文件

| 文件 | 修改内容 |
|------|----------|
| `commander/index.js` | 注册三位新将领 |
| `js/commanderInterface.js` | 新增 `getCommanderAuraAttackBonus()` 接口 |
| `js/Unit.js` | `getEffectiveAttack()` 加入灵光攻击加成 |
| `js/gameLogic.js` | 招募/感化/士气计算处新增魔术师克制系数覆盖逻辑 |
| `.ai/grok.js` | 新增三位将领的 `COMMANDER_STRATEGY` 权重配置 |

### 新增的 Unit 字段

| 字段 | 归属将领 | 类型 | 说明 |
|------|----------|------|------|
| `_faith` | 圣骑士 | number | 信仰值（0-3） |
| `_smiteReady` | 圣骑士 | boolean | 是否已激活待命斥喝 |

### 序列化注意事项

联机模式下，以下字段需加入网络同步：
- `magician`：变形后的 `type`、`maxHp`、`hp`
- `paladin`：`_faith`、`_smiteReady`
- `priest`：`activeSkillCD`（已有）

---

## 平衡参数速查

| 将领 | 参数 | 数值 |
|------|------|------|
| 魔术师 | 克制系数（顺克） | 1.5× |
| 魔术师 | 克制系数（逆克） | 0.6× |
| 魔术师 | 变形后行动限制 | 本回合 canAct=false, MP=0 |
| 圣骑士 | 信仰值上限 | 3 点 |
| 圣骑士 | 神圣斥喝基础 | +30 神圣伤害（无视防御） |
| 圣骑士 | 神圣斥喝暴击 | +60 神圣伤害 |
| 圣骑士 | 勇气灵光攻击加成 | +10% |
| 圣骑士 | 勇气灵光士气下限 | morale ≥ 2 |
| 牧师 | 圣链一段治疗 | 45 HP |
| 牧师 | 圣链传导治疗 | 30 HP |
| 牧师 | 神圣涌现代价 | 当前HP × 15%（最少1） |
| 牧师 | 神圣涌现治疗 | maxHP × 25%（每目标） |
| 牧师 | 神圣涌现冷却 | 4 回合 |
| 牧师 | 神圣涌现范围 | 以牧师为中心2格 |
