# 伤害浮动倍率系统 — 设计与实施方案

**版本**：针对 V3.2  
**状态**：待实施  
**涉及文件**：`js/Unit.js`

---

## 一、背景与动机

### 当前暴击机制的问题

现行系统在 `_resolveDamage` 中使用**二值分布**：

```
概率 (1 - critRate) → 伤害 × 1.0   （普通）
概率 critRate       → 伤害 × 1.5   （暴击）
反击暴击             → 伤害 × 1.8
```

这等价于一个**双峰分布**，在体验上带来以下问题：

| 问题 | 具体表现 |
|---|---|
| **"斩首彩票"** | 炮兵打步兵有 40% 概率一击必杀，大量决策被 RNG 剥夺 |
| **感知不稳定** | 相同的操作，60% 时间拿到普通结果，40% 时间拿到大跳跃结果 |
| **逆克攻击无意义** | 5% 暴击率形同虚设，偶发的暴击反而让受击方产生"彩票"受害感 |
| **防守随机性** | 步兵守城反击 50% 暴击率，使防守成功与否过度依赖运气 |

### 参考：EasyTech 系列的处理方式

《欧陆战争》《世界征服者》等作品使用**连续浮动区间**：

```
实际伤害 = 期望伤害 × (0.85 + random() × 0.30)   // 范围 [85%, 115%]
```

每次攻击都在期望值附近连续波动，玩家感知的是"打得稳"vs"打得准"，而非"未暴击"vs"暴击"的突变。这使策略判断的可预测性更高，随机性变为"纹理"而非"结果决定因素"。

---

## 二、设计目标

1. **保留随机性**：每次攻击结果仍有波动，保持战斗临场感
2. **消除"斩首彩票"**：炮兵打步兵的一击必杀概率从 40% 降至 10% 以内
3. **期望值不变**：各对局的平均伤害与现版本一致，不影响其余已调好的数值平衡
4. **克制关系仍然显著**：顺克的浮动上限高于逆克，让克制感知更稳定
5. **代码简化**：删除 `critRate` / `critMultiCrit` 两个参数，统一为一个 `floatMult`

---

## 三、数学基础

### 期望值推导

均匀分布 `[lo, hi]` 的期望值为 `(lo + hi) / 2`，标准差为 `(hi - lo) / √12`。

旧系统期望倍率（攻击端）：

| 情形 | critRate | critMult | 旧期望 |
|---|---|---|---|
| 顺克进攻 | 40% | ×1.5 | **1.20** |
| 中性进攻 | 20% | ×1.5 | **1.10** |
| 逆克进攻 | 5%  | ×1.5 | **1.025** |
| 普通反击（×0.75 base） | 33% | ×1.8 | **0.948** |
| 步兵守城反击（×0.75 base） | 50% | ×1.8 | **1.050** |

### 新区间设定（期望值对齐）

**进攻方浮动区间（替换 `critRate × critMult`）：**

| 情形 | 区间 `[lo, hi]` | 新期望 | 旧期望 | 误差 |
|---|---|---|---|---|
| 顺克 `counterCoeff > 1` | `[0.90, 1.50]` | **1.20** | 1.20 | 0% |
| 中性 `counterCoeff = 1` | `[0.85, 1.35]` | **1.10** | 1.10 | 0% |
| 逆克 `counterCoeff < 1` | `[0.85, 1.20]` | **1.025** | 1.025 | 0% |

**反击方浮动区间（替换 `critRate × 1.8`，base 仍为 0.75）：**

| 情形 | 区间 `[lo, hi]` | ×0.75 后期望 | 旧期望 | 误差 |
|---|---|---|---|---|
| 普通反击 | `[0.90, 1.70]` | **0.975** | 0.948 | +2.8% |
| 步兵守城反击 | `[1.05, 1.85]` | **1.088** | 1.050 | +3.6% |

> 反击期望值有意比旧版略高 2–4%，以弥补去掉"暴击文字"后玩家对防守有效感知的轻微下降。

---

## 四、关键对战概率变化

### 一击必杀概率对比

> 公式：`P(秒杀) = P(floatMult > 秒杀阈值)`，阈值 = 目标HP / 基础伤害

| 对局 | 基础伤害 | 目标HP | 秒杀阈值 | 旧概率 | 新概率 | 评价 |
|---|---|---|---|---|---|---|
| 炮兵 → 步兵（顺克，平原） | 68.75 | 100 | 1.455 | **40%** | **7.5%** | ✅ 大幅改善 |
| 骑兵（冲锋）→ 炮兵 | 82.5 | 70 | 0.848 | ~100% | **100%** | ✅ 不变 |
| 骑兵（不冲锋）→ 炮兵 | 68.75 | 70 | 1.018 | 40% | **80%** | 中性（骑兵更决定性） |
| 炮兵 → 骑兵（逆克） | 44.0 | 90 | 2.045 | 0% | **0%** | ✅ 不变 |
| 步兵 → 骑兵（顺克） | 36.0 | 90 | 2.500 | 0% | **0%** | ✅ 不变 |

### 解读

- **炮兵打步兵**：秒杀率 40% → 7.5%，步兵不再大量死于"运气差"，策略判断空间恢复
- **骑兵不冲锋打炮兵**：秒杀率 40% → 80%，这是**有意识的设计改变**——骑兵到达炮兵位置本身就是一次大优势，应当体现为高确定性的伤害，而非彩票式的"看脸"
- **骑兵冲锋打炮兵**：仍然必杀，符合"骑兵是炮兵的天敌"设计主题

---

## 五、特殊情形处理

### 5.1 风天步兵（原 `critRate = Math.min(critRate, 0.05)`）

旧机制：暴击率被截断至 5%。  
新机制：截断浮动区间上限。

```javascript
if (gs.weather === 'wind' && this.type === 'infantry' && !isCounter) {
    hi = Math.min(hi, 1.05);
}
```

效果：步兵在风天的浮动区间从 `[0.90, 1.50]` 变为 `[0.90, 1.05]`，极度稳定（SD ≈ 0.043），期望值 0.975（旧：1.025，轻微降低但逻辑一致）。

### 5.2 雾天骑兵冲锋（原 chargeThreshold = 1，chargeAmount = 0.30）

浮动系统不需要任何修改。`cavBonus` 仍以 `extraBonus` 形式加入 `dmgBonus`，对 `floatMult` 无影响。雾天骑兵的期望伤害提升依然有效。

### 5.3 铁卫守护

铁卫的防御加成通过 `getCommanderDefenseBonus` 进入 `dmgBonus` 计算，与 `floatMult` 独立，无需修改。

### 5.4 "强击"视觉反馈（替代 CRIT 文字）

去掉二值 `isCrit` 的语义后，可改为基于浮动值的分级判定：

```javascript
// 顶部 ~25% 区间触发"强击"特效（保留 isCrit 字段供渲染层使用）
const isCrit = floatMult > (isCounter ? 1.50 : 1.30);
```

这使"强击"出现概率约为 25%，与旧版顺克暴击率（40%）相比略低，但触发条件对双方均透明（看数值就能知道是否"打得好"）。

---

## 六、实施方案

### 6.1 改动范围

只需修改 **`js/Unit.js`** 中的三处：

| 改动 | 位置 | 说明 |
|---|---|---|
| 新增 `_calcFloat` 方法 | `Unit` 类内 | 核心浮动倍率计算 |
| 修改 `_resolveDamage` 签名与实现 | `Unit` 类内 | 删除 `critRate`/`critMultiCrit`，加入 `floatMult` |
| 修改 `calculateCounterDamage` 调用 | `Unit` 类内 | 传入 `isCounter`/`isCityCounter` 标志 |

`calculateDamage` 本身**不需要修改**（它调用 `_resolveDamage`，只需更新参数）。

### 6.2 代码实现

#### 新增方法：`_calcFloat`

```javascript
/**
 * 计算伤害浮动倍率（替代 critRate + critMult 二值系统）
 * 区间由克制关系决定，期望值与旧暴击系统严格对齐
 */
_calcFloat(counterCoeff, isCounter = false, isCityCounter = false) {
    const gs = _gameState;
    let lo, hi;

    if (isCounter) {
        // 反击区间（上限高于进攻，体现防守有效感）
        lo = isCityCounter ? 1.05 : 0.90;
        hi = isCityCounter ? 1.85 : 1.70;
    } else if (counterCoeff > 1) {
        lo = 0.90; hi = 1.50;   // 顺克  期望 1.20
    } else if (counterCoeff < 1) {
        lo = 0.85; hi = 1.20;   // 逆克  期望 1.025
    } else {
        lo = 0.85; hi = 1.35;   // 中性  期望 1.10
    }

    // 风天步兵：截断上限，使伤害极度稳定（替代旧版暴击率硬上限5%）
    if (gs && gs.weather === 'wind' && this.type === 'infantry' && !isCounter) {
        hi = Math.min(hi, 1.05);
    }

    return lo + Math.random() * (hi - lo);
}
```

#### 修改方法：`_resolveDamage`

```javascript
// 旧签名：_resolveDamage(attacker, defender, critRate, critMultiCrit, baseMulti, extraBonus)
// 新签名：_resolveDamage(attacker, defender, baseMulti, extraBonus, isCounter, isCityCounter)
_resolveDamage(attacker, defender, baseMulti = 1, extraBonus = 0,
               isCounter = false, isCityCounter = false) {
    const counterCoeff = COUNTER_RELATION[attacker.type][defender.type];

    let dmgBonus = counterCoeff - 1 + extraBonus;
    dmgBonus -= TERRAIN_CONFIG[defender.tile.terrain].defenseBonus;
    if (defender.type === 'infantry' && defender.tile.isCity) dmgBonus -= 0.20;
    dmgBonus -= (defender.config.defense || 0);
    dmgBonus -= MORALE_CONFIG[defender.morale].defBonus;
    dmgBonus -= getCommanderDefenseBonus(defender);
    dmgBonus -= getCommanderAuraDefenseBonus(defender);
    if (attacker.type === 'archer') dmgBonus += 0.10;
    const dmgMulti = Math.max(0.1, 1 + dmgBonus);

    const floatMult = attacker._calcFloat(counterCoeff, isCounter, isCityCounter);

    // isCrit 保留供渲染层判断"强击"视觉效果
    const isCrit = floatMult > (isCounter ? 1.50 : 1.30);

    return {
        dmg: attacker.getEffectiveAttack() * baseMulti * dmgMulti * floatMult,
        isCrit
    };
}
```

#### 修改方法：`calculateDamage`（调用端，签名改变）

```javascript
// 旧：this._resolveDamage(this, targetUnit, critRate, 1.5, 1, cavBonus + weatherAtkBonus)
// 新：
const result = this._resolveDamage(this, targetUnit, 1, cavBonus + weatherAtkBonus);
```

> `calculateDamage` 中的 `critRate` 计算块（约10行）可全部删除。

#### 修改方法：`calculateCounterDamage`

```javascript
calculateCounterDamage(attackerUnit) {
    if (this.counterAttackCount >= 1 || attackerUnit.type === 'archer' || this.morale === 0) {
        return { dmg: 0, isCrit: false };
    }

    const isCityCounter = this.type === 'infantry' && this.tile.isCity;

    // 旧：this._resolveDamage(this, attackerUnit, critRate, 1.8, 0.75)
    // 新：
    return this._resolveDamage(this, attackerUnit, 0.75, 0, true, isCityCounter);
}
```

### 6.3 改动量统计

| 类型 | 行数 |
|---|---|
| 删除（`critRate` 计算块、`critMultiCrit` 参数） | -18 行 |
| 新增（`_calcFloat` 方法） | +18 行 |
| 修改（签名更新、调用端） | ~6 行 |
| **净变化** | **≈ 0 行** |

---

## 七、测试清单

实施后需验证以下场景：

- [ ] **炮兵 → 步兵（平原）**：连续攻击10次，应无一击秒杀（概率7.5%，10次全无概率≈46%，可接受）
- [ ] **骑兵（冲锋）→ 炮兵**：每次应必杀
- [ ] **骑兵（不冲锋）→ 炮兵**：大多数情况秒杀，偶有存活
- [ ] **步兵守城反击骑兵**：伤害稳定在 `30 × 0.75 × 1.20 × [1.05, 1.85]` 范围内，约 24–50
- [ ] **风天步兵进攻**：伤害浮动极小，不出现超过 `×1.05` 的结果
- [ ] **吸血鬼**：lifesteal 仍正确依据 `dmg` 计算，不受影响
- [ ] **铁卫灵光转移**：转移量基于 `actualDmg`，与 `floatMult` 乘后结果一致
- [ ] **联机同步**：`damageTexts.value` 显示值与实际扣血一致（序列化不涉及 float 本身，无需特殊处理）

---

## 八、不在本次范围内的事项

- `isCrit` 渲染层的视觉样式调整（文字颜色、特效触发）——可单独处理
- 将浮动区间暴露为 `config.js` 常量以方便后续调参——视需要添加
- AI 逻辑（`js/ai.js`）中若有对 `critRate` 的引用需同步更新

---

*本文档由 Claude Code 于 V3.2 分析后生成，对应 feature branch：`claude/iron-guard-balance-bBOfb`*
