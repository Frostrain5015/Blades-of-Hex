# 《Blades of Hex》战役 JSON 创作 Agent 完整规范

版本：Schema v2

本文是面向大模型与自动化创作 Agent 的规范性文档。目标是：即使模型没有接触过本项目代码，也能只依据本文生成可被当前战役编辑器导入、通过编译并完整运行的关卡 JSON。

本文中的“必须”是生成约束；未列出的字段、条件和动作一律视为非公开接口，不要猜测或创造。

## 1. 输出契约

Agent 必须输出一个 UTF-8、严格 JSON、顶层为对象的文件：

- 不得包含注释、尾随逗号、`undefined`、`NaN` 或函数。
- `schemaVersion` 必须是 `2`。
- 所有引用必须使用配置中已经声明的 ID。
- 所有坐标必须在棋盘半径内。
- 只使用本文列出的 30 种条件和 19 种动作。
- 不得生成旧 `steps` 表、旧 `showStep.step` 引用或内部 `_id`。
- 不得使用 `levelStarted`、`sendMessage`、`flagSet`、`flagUnset`、`turnAtLeast`、`unitAlive`、`unitDead`、`eventCardIs`、`delay`、`setPhase` 等遗留或内部接口。开场立即执行使用 `enabled:true, once:true, when:[]`。

## 2. 顶层对象

推荐始终输出下列全部字段，即使部分字段为空：

| 字段 | 类型 | 必须 | 规则 |
|---|---|---:|---|
| `schemaVersion` | number | 是 | 固定为 `2` |
| `id` | string | 是 | 仅字母、数字、连字符；例如 `bi-t2-rescue` |
| `title` | string | 是 | 关卡显示名 |
| `chronicleId` | string | 是 | 所属传记 ID |
| `seed` | number | 是 | 整数随机种子 |
| `turnLimit` | number | 是 | 非负整数；`0` 表示不限回合。当前不自动裁决，不能作为唯一失败条件 |
| `intro` | object | 是 | 开场标题对象，见下文 |
| `weather` | string | 是 | `cycle/clear/rain/fog/wind` |
| `localPlayerCamp` | string | 是 | 唯一玩家阵营 ID |
| `factions` | array | 是 | 动态阵营定义，至少一个 |
| `turnOrder` | string[] | 是 | 所有启用且参与回合的阵营，各出现一次 |
| `diplomacy` | object | 是 | 对称外交矩阵 |
| `mechanics` | object | 是 | 九个机制的布尔开关 |
| `aiOpponentCamp` | string | 是 | 兼容字段；通常写 `""`，战役 AI 由 faction.controller 决定 |
| `aiDifficulty` | number | 是 | 建议 `0.1` 到 `3.0` |
| `gold` | object | 是 | `{阵营ID: 非负数字}` |
| `commanders` | object | 是 | 传统阵营主将映射；动态阵营通常在单位上绑定将领 |
| `hands` | object | 是 | `{阵营ID: [卡牌ID...]}` |
| `storyCommanders` | array | 是 | 剧情将领身份库；无内容时写 `[]` |
| `board` | object | 是 | 棋盘定义 |
| `units` | array | 是 | 开场单位 |
| `unitGroups` | array | 是 | 单位 ID 集合 |
| `areas` | array | 是 | 命名地块集合 |
| `interactables` | array | 是 | 调查点 |
| `variables` | array | 是 | 本关/战役变量 |
| `objectives` | object | 是 | 目标字典 |
| `triggers` | array | 是 | 触发器数组 |
| `result` | object | 是 | 结算文本、兼容选项和星级条件 |

`intro` 的完整形状：

```json
{
  "campaignTitle": "染血的鸢尾花",
  "chapterTitle": "北境风雪",
  "scenarioSubtitle": "T2 王冠失窃"
}
```

编辑器公开编辑 `chapterTitle`；当前运行时的主关卡标题会由关卡 ID/标题生成，因此不要依赖自定义 `scenarioSubtitle` 承担脚本逻辑。

## 3. 最小可运行完整模板

下面的对象可以直接作为新关卡起点。它包含两阵营、两座城市、一个主要目标、开场对白和占城胜利触发器。

```json
{
  "schemaVersion": 2,
  "id": "sample-level",
  "title": "样例关卡",
  "chronicleId": "community",
  "seed": 4660,
  "turnLimit": 0,
  "intro": {
    "campaignTitle": "社区战役",
    "chapterTitle": "第一章",
    "scenarioSubtitle": "样例关卡"
  },
  "weather": "clear",
  "localPlayerCamp": "player1",
  "factions": [
    {
      "id": "player1",
      "name": "王国军",
      "color": "red",
      "controller": "human",
      "participatesInTurns": true,
      "active": true
    },
    {
      "id": "north_guard",
      "name": "北境守军",
      "color": "blue",
      "controller": "ai",
      "participatesInTurns": true,
      "active": true
    }
  ],
  "turnOrder": ["player1", "north_guard"],
  "diplomacy": {
    "player1": { "north_guard": "enemy" },
    "north_guard": { "player1": "enemy" }
  },
  "mechanics": {
    "tacticalCards": false,
    "recruitment": false,
    "reinforcement": true,
    "commanderSkills": true,
    "weatherEffects": true,
    "morale": true,
    "fortifications": true,
    "fogOfWar": false,
    "alliedVision": false
  },
  "aiOpponentCamp": "",
  "aiDifficulty": 1,
  "gold": { "player1": 4, "north_guard": 4 },
  "commanders": {},
  "hands": { "player1": [], "north_guard": [] },
  "storyCommanders": [],
  "board": {
    "radius": 2,
    "cities": [
      { "q": -1, "r": 0, "districtId": 1, "camp": "player1" },
      { "q": 1, "r": 0, "districtId": 2, "camp": "north_guard" }
    ],
    "terrain": [],
    "villages": [],
    "fortifications": [],
    "districts": []
  },
  "units": [
    {
      "id": "player_vanguard",
      "type": "infantry",
      "camp": "player1",
      "q": -1,
      "r": 1,
      "commander": "centurion",
      "hpPct": 100,
      "morale": 2,
      "canAct": true
    }
  ],
  "unitGroups": [],
  "areas": [],
  "interactables": [],
  "variables": [],
  "objectives": {
    "capture_north_city": {
      "title": "攻占北境城",
      "detail": "占领坐标（1,0）的敌方城市。",
      "active": true,
      "main": true
    }
  },
  "triggers": [
    {
      "id": "opening_dialogue",
      "title": "开场对白",
      "note": "关卡开始 800ms 后播放",
      "enabled": true,
      "once": true,
      "when": [{ "kind": "timer", "value": 800 }],
      "do": [
        {
          "kind": "showStep",
          "speaker": { "name": "马库斯", "portrait": "centurion" },
          "text": "前方就是北境城。夺下它。",
          "boardLock": false,
          "dialogLock": false
        }
      ]
    },
    {
      "id": "north_city_captured",
      "title": "占领北境城",
      "note": "完成主要目标并自动结算",
      "enabled": true,
      "once": true,
      "when": [
        { "kind": "cityCaptured", "q": 1, "r": 0, "camp": "player1" }
      ],
      "do": [
        {
          "kind": "setObjectiveStatus",
          "objective": "capture_north_city",
          "status": "completed"
        }
      ]
    }
  ],
  "result": {
    "winText": "北境城已被攻克。",
    "loseText": "部队未能完成任务。",
    "eliminateEnemy": false,
    "starRules": []
  }
}
```

## 4. 坐标、棋盘和地图对象

### 4.1 坐标合法性

六边形轴坐标为 `{ "q": 整数, "r": 整数 }`。半径为 `R` 时必须满足：

```text
max(abs(q), abs(r), abs(q + r)) <= R
```

`board.radius` 允许 `2` 到 `7`。

### 4.2 board

```json
{
  "radius": 4,
  "cities": [{ "q": 0, "r": 0, "districtId": 1, "camp": "player1" }],
  "terrain": [{ "q": 1, "r": 0, "type": "forest" }],
  "villages": [{ "q": 0, "r": 1, "districtId": 1 }],
  "fortifications": [{ "q": 1, "r": -1, "type": "trench" }],
  "districts": [{ "q": 2, "r": -1, "districtId": 1 }]
}
```

字段规则：

- `cities`：每项必须有坐标、`districtId` 和已声明的 `camp`。
- 一个 `districtId` 必须只有一座城市；城市是整个行政区的归属和颜色来源。
- `terrain`：只需列出覆盖项；未列出的格子默认 `plains`。
- `villages`：不能与城市重叠。
- `fortifications`：每格最多一个。
- `districts`：覆盖自动 Voronoi 行政区，用于手绘边界；每个被使用的 `districtId` 应有城市。

枚举与规则：

| 类别 | ID | 含义 |
|---|---|---|
| 地形 | `plains` | 平原，移动消耗 2 |
| 地形 | `forest` | 森林，移动消耗 3，防御 +5% |
| 地形 | `mountain` | 山地，移动消耗 6，防御 +5% |
| 工事 | `trench` | 战壕，对近战防御 +25% |
| 工事 | `flak` | 高射机枪，对远程防御 +25%，自身防空 |

天气：

| ID | 含义 |
|---|---|
| `cycle` | 标准循环，从晴天开始 |
| `clear` | 晴，无特殊效果 |
| `rain` | 雨：城市驻军每回合恢复 15%；步兵守城防御 +10%；骑兵每步额外消耗 1 |
| `fog` | 雾：炮兵射程 -1；骑兵伤害 +20%，冲锋每格额外 +5% |
| `wind` | 风：炮兵射程 +1、伤害 +20%；步兵防御 -15% |

天气规则只有在 `mechanics.weatherEffects` 为 `true` 时生效。

## 5. 动态阵营完整规范

Faction 对象：

```json
{
  "id": "royal_guard",
  "name": "王家卫队",
  "note": "仍向失踪的老国王效忠",
  "color": "purple",
  "controller": "scripted",
  "participatesInTurns": false,
  "active": true
}
```

约束：

- `id` 必须以字母开头，后续只允许字母、数字、`_`、`-`，最长 32 字符。
- `neutral` 是系统保留 ID，禁止在 `factions` 中声明。
- `controller` 只能为 `human`、`ai`、`scripted`。
- `note` 是可选的剧情备注字符串；非空时显示为局内阵营列表的第二行，留空或省略则不显示。不要在这里填写“AI 控制”“参与回合”等规则信息。
- 全关必须恰好一个 `human`，且其 ID 等于 `localPlayerCamp`。
- `active !== false && participatesInTurns !== false` 的每个阵营必须恰好出现于 `turnOrder`。
- `scripted` 适合剧情控制阵营；若参与回合，引擎会跳过其自动决策。

`color` 只能选择下列规范 ID。Agent 不得输出任何十六进制色值，也不得分别编写旗色、地块色、深色或亮色；规则层会由一个 ID 统一解析所有表现形式。

| ID | 颜色 |
|---|---|
| `red` | 红 |
| `orange` | 橙 |
| `yellow` | 黄 |
| `green` | 绿 |
| `cyan` | 青 |
| `blue` | 蓝 |
| `purple` | 紫 |
| `gray` | 深灰 |
| `white` | 白 |

外交关系只能为 `ally`、`neutral`、`enemy`。必须双向写成相同值：

```json
{
  "diplomacy": {
    "player1": { "villagers": "ally", "raiders": "enemy" },
    "villagers": { "player1": "ally", "raiders": "neutral" },
    "raiders": { "player1": "enemy", "villagers": "neutral" }
  }
}
```

中立单位会阻挡移动；主动攻击中立单位后，双方自动变为敌对。联盟共享视野不由关系自动决定，而由 `mechanics.alliedVision` 单独控制。

## 6. 玩法机制

`mechanics` 必须只包含下列布尔字段：

```json
{
  "tacticalCards": true,
  "recruitment": true,
  "reinforcement": true,
  "commanderSkills": true,
  "weatherEffects": true,
  "morale": true,
  "fortifications": true,
  "fogOfWar": true,
  "alliedVision": false
}
```

它们依次表示：对策卡、招募、补员、将领主动技、天气规则、士气、工事、战争迷雾、联盟共享视野。触发器可用 `setMechanicEnabled` 动态改变任一项。

## 7. 单位、主将和卡牌枚举

### 7.1 开场单位对象

```json
{
  "id": "marcus_unit",
  "type": "infantry",
  "camp": "player1",
  "q": 0,
  "r": 0,
  "storyCommander": "marcus",
  "hpPct": 100,
  "morale": 2,
  "canAct": true
}
```

规则：

- `id` 非空、全关唯一，不要以 `__` 开头。
- `camp` 必须已在 `factions` 中声明。
- 同一坐标不能放多个单位。
- `hpPct` 为 `1..100`；也可使用绝对 `hp`，但不要同时写两者。
- `morale`：`0` 混乱、`1` 下降、`2` 正常、`3` 上升。
- `canAct` 只表示初始本回合能否行动。
- `storyCommander` 引用下述剧情将领身份；不要与 `commander` 同时出现。
- `commander` 是兼容用的标准玩法将领直挂字段。正式战役中有姓名的人物优先使用 `storyCommander`，否则战场只会显示“百夫长”“尚书”等原型名。

### 7.2 剧情将领身份

```json
{
  "storyCommanders": [
    {
      "id": "marcus",
      "name": "马库斯",
      "archetype": "centurion"
    },
    {
      "id": "gate_captain",
      "name": "佩特拉守备队长",
      "portrait": "npcMale"
    }
  ]
}
```

- `id`：字母开头，仅字母、数字、`_`、`-`，全关唯一。
- `name`：剧情显示名，覆盖玩法原型的名字，用于战场名牌与阵亡日志。
- `archetype`：可选的标准将领 ID；决定属性、技能和玩法规则。省略后为纯剧情将领，仍显示将领旗与立绘，但没有技能或属性加成。
- `portrait`：可选。省略时自动使用玩法原型立绘；没有玩法原型时应明确写 `npcMale` 或 `npcFemale`。
- 一个剧情将领不能在开场同时绑定到多个单位。

兵种：

| ID | 显示名 | 基础生命 | 基础行动力 | 基础射程 |
|---|---|---:|---:|---:|
| `infantry` | 步 | 200 | 5 | 1 |
| `cavalry` | 骑 | 150 | 8 | 1 |
| `archer` | 炮 | 100 | 3 | 2 |
| `mgNest` | 碉堡 | 200 | 0 | 2 |
| `drone` | 无人机 | 75 | 8 | 2 |

将领 ID：

| ID | 名称 | ID | 名称 |
|---|---|---|---|
| `advisor` | 谋士 | `astrologer` | 占星者 |
| `berserker` | 狂战士 | `centurion` | 百夫长 |
| `colonel` | 空军上校 | `diplomat` | 纵横家 |
| `engineer` | 工程师 | `fallenAngel` | 堕天使 |
| `ironGuard` | 铁卫 | `magician` | 魔术师 |
| `martyr` | 殉道者 | `minister` | 尚书 |
| `necromancer` | 亡灵法师 | `paladin` | 圣骑士 |
| `priest` | 牧师 | `staller` | 停滞者 |
| `tianyan` | 天眼 | `vampire` | 吸血鬼 |

卡牌 ID：`heal`、`lightning`、`mgNest`、`airdrop`、`imprison`、`forceMarch`、`scout`、`airstrike`、`shield`、`landmine`、`commanderDeploy`。

`hands` 的每个值是卡牌 ID 数组。若 `tacticalCards` 为 `false`，可以保留空数组。

## 8. 引用集合与状态对象

### 8.1 TargetRef

所有“单个单位或单位组”字段使用二选一形状：

```json
{ "unit": "marcus_unit" }
```

或：

```json
{ "group": "north_patrol" }
```

不得同时写 `unit` 和 `group`。

### 8.2 unitGroups

```json
{
  "unitGroups": [
    { "id": "north_patrol", "unitIds": ["guard_1", "guard_2"] }
  ]
}
```

所有成员必须是 `units` 中存在的开场单位 ID。运行中生成的单位不会自动加入组。

### 8.3 areas

```json
{
  "areas": [
    {
      "id": "castle_yard",
      "tiles": [{ "q": 0, "r": 0 }, { "q": 1, "r": 0 }]
    }
  ]
}
```

区域 ID 必须唯一，`tiles` 至少一格，坐标全部合法。

### 8.4 interactables

```json
{
  "interactables": [
    {
      "id": "broken_banner",
      "q": 1,
      "r": -1,
      "label": "调查断旗",
      "enabled": true,
      "once": true
    }
  ]
}
```

运行时状态为 `disabled/available/completed`。点击可用调查点后自动变为 `completed` 并发出调查事件；要重复使用，触发器将其改回 `available`。当前 `once` 是编辑器描述字段，重复能力以状态为准。

### 8.5 variables

```json
{
  "variables": [
    { "id": "rescued_king", "scope": "level", "type": "boolean", "initial": false },
    { "id": "saved_villagers", "scope": "campaign", "type": "number", "initial": 0 },
    { "id": "chosen_route", "scope": "level", "type": "string", "initial": "" }
  ]
}
```

- `scope`：`level` 或 `campaign`。
- `type`：`number`、`boolean`、`string`。
- `initial` 的 JSON 类型必须与 `type` 完全一致。

### 8.6 objectives

```json
{
  "objectives": {
    "rescue_king": {
      "title": "救回国王",
      "detail": "在十分钟内抵达猎宫。",
      "active": false,
      "main": true,
      "highlight": {
        "unit": "king",
        "tiles": [{ "q": 2, "r": -1 }],
        "area": "safe_zone"
      }
    }
  }
}
```

`active:false` 表示初始 `hidden`；否则初始 `active`。目标运行时状态只能是 `hidden/active/completed/failed`。全部可见主要目标完成会胜利；任一可见主要目标失败会失败。

可选的 `highlight` 是目标级常驻提示光圈，只在该目标状态为 `active` 时显示：

- `unit`：开场单位 ID；单位移动时光圈随单位移动，单位离场后不再显示。
- `tiles`：一个或多个合法坐标，适合调查点、城门等独立位置。
- `area`：已在 `areas` 中声明的区域 ID，适合范围目标。
- 三者可以组合，重复地块会由运行时去重。没有需要提示的位置时省略整个 `highlight`，不要输出空对象。

## 9. 触发器通用语义

触发器形状：

```json
{
  "id": "unique_trigger_id",
  "title": "给作者看的标题",
  "note": "设计备注",
  "enabled": false,
  "once": true,
  "when": [{ "kind": "..." }],
  "do": [{ "kind": "..." }]
}
```

规则：

- `id` 非空且全关唯一。
- `enabled:false` 表示开场关闭；由 `setTriggerEnabled` 启动。
- `once:true` 表示一生只执行一次；省略 `once` 等价于可重复，但 Agent 必须显式写出。
- 顶层 `when` 是 AND。`when:[]` 是公开的 AoE 式无条件触发器：开场启用时在关卡开始执行；开场关闭时，一旦 `setTriggerEnabled` 将其启用便立即执行，且不依赖触发器数组顺序。一次性阶段动作通常配合 `once:true`。
- `all/any/not` 可嵌套；同层 `any` 应扁平化，不要无意义嵌套。
- 事件条件只在对应事件派发时为真；状态条件在任何派发和计时轮询中都可被检查。
- `do` 必须至少包含一个动作；无动作触发器是编译错误。
- 同一触发器的动作按数组顺序调用，但所有非对白动作会立刻执行，不等待玩家点完对白。
- 触发器递归派发超过 32 层会被中止。不要形成 A 启用 B、B 立即反向触发 A 的循环。

## 10. 计时器规范

条件：

```json
{ "kind": "timer", "value": 600000 }
```

`value` 是大于零的毫秒数。语义是“本触发器本次启用后经过 value 毫秒”。

- 开场启用的触发器从关卡开始时计时。
- 开场关闭的触发器从 `setTriggerEnabled(..., true)` 动作执行时计时。
- 每次显式启用都会重新计时，包括原本已启用的触发器。
- 禁用取消当前计时。
- 到期信号在每次启用周期只消费一次；显式再次启用可重新装填。
- 触发器 `once:true` 后即使再次启用也不会再次执行；需要重复计时则用 `once:false` 并显式再次启用。
- 计时器可与状态条件 AND：到期后等待其他状态成立。
- 计时器可与事件条件 AND：只响应计时成熟之后发生的该事件。
- 计时器不适合作为星级条件；结算时不会重新等待。

“国王被劫后十分钟失败”完整片段：

```json
[
  {
    "id": "king_abducted",
    "enabled": true,
    "once": true,
    "when": [
      { "kind": "eventInteractionIs", "interactable": "empty_carriage" }
    ],
    "do": [
      { "kind": "setObjectiveStatus", "objective": "rescue_king", "status": "active" },
      { "kind": "setTriggerEnabled", "trigger": "rescue_king_timeout", "enabled": true }
    ]
  },
  {
    "id": "rescue_king_timeout",
    "enabled": false,
    "once": true,
    "when": [{ "kind": "timer", "value": 600000 }],
    "do": [
      { "kind": "setObjectiveStatus", "objective": "rescue_king", "status": "failed" }
    ]
  },
  {
    "id": "king_rescued",
    "enabled": true,
    "once": true,
    "when": [
      { "kind": "unitMovesToTile", "target": { "unit": "rescue_unit" }, "tiles": [{ "q": 2, "r": -1 }] }
    ],
    "do": [
      { "kind": "setTriggerEnabled", "trigger": "rescue_king_timeout", "enabled": false },
      { "kind": "setObjectiveStatus", "objective": "rescue_king", "status": "completed" }
    ]
  }
]
```

## 11. 全部公开条件：30 种

比较操作符：数字通常支持 `<`、`<=`、`==`、`!=`、`>=`、`>`；具体以各条件说明为准。

### 11.1 逻辑条件

| kind | 精确形状 | 语义 |
|---|---|---|
| `all` | `{"kind":"all","conditions":[条件,...]}` | 非空，全部满足 |
| `any` | `{"kind":"any","conditions":[条件,...]}` | 非空，任一满足 |
| `not` | `{"kind":"not","condition":条件}` | 子条件不满足 |

### 11.2 事件条件

| kind | 必须字段 | 可选字段 | 语义 |
|---|---|---|---|
| `unitSelected` | `target:TargetRef` | `camp` | 指定单位/组成员被选中 |
| `unitMovesToTile` | `target:TargetRef`、`tiles:[Coord...]` | `camp` | 指定单位/组移动到任一目标格；`tiles` 必须非空 |
| `unitAttacksUnit` | `attacker:TargetRef`、`defender:TargetRef` | `attackerCamp`、`defenderCamp` | 指定攻击者攻击指定目标；双方 TargetRef 都必须提供 |
| `unitKilled` | `target:TargetRef` | `camp` | 指定单位/组成员被击败 |
| `cityCaptured` | `q`、`r` | `camp` | 指定城市被占领；`camp` 是新归属筛选 |
| `turnStarted` | 无 | `camp`、`turn` | 指定阵营回合开始；camp 空表示回合顺序首阵营。`turn:N` 表示从首次匹配起延后 N 轮 |
| `cardUsed` | `value:卡牌ID` | `camp` | 使用指定对策卡 |
| `skillUsed` | `target:TargetRef` | `camp`、`skill`、`skillType`、`stacks`、`stackOp` | 指定单位使用技能；`skillType` 为 `active/passive`；叠层比较用 `>=/<=/==` |
| `eventNextIs` | `value` | 无 | 接收 `showStep.next` 的跳转值 |
| `eventChoiceIs` | `value` | 无 | 接收对话选择结果；当前内联编辑器主要公开 next 跳转，通常优先用 `eventNextIs` |
| `eventInteractionIs` | `interactable` | 无 | 指定调查点被完成 |

示例：

```json
{
  "kind": "unitAttacksUnit",
  "attacker": { "group": "royal_units" },
  "defender": { "unit": "enemy_captain" },
  "attackerCamp": "player1",
  "defenderCamp": "rebels"
}
```

### 11.3 时间与状态条件

| kind | 精确主要字段 | 语义 |
|---|---|---|
| `timer` | `value:number > 0` | 触发器启用后等待毫秒数，详见第 10 节 |
| `cityOwnedBy` | `q,r,camp` | 指定坐标必须是城市且当前属于阵营 |
| `unitExists` | `unit,alive:boolean` | `true`=仍在场；`false`=阵亡或不存在 |
| `unitHpCompare` | `unit,mode,op,value` | `mode` 为 `percent/value`；op 为 `<,<=,==,>=,>` |
| `factionUnitCount` | `camp,op,value` | 存活单位数；op 使用 `<=,==,>=` |
| `goldCompare` | `camp,op,value` | 金币比较；op 使用 `<,<=,==,>=,>` |
| `variableCompare` | `scope,variable,op,value` | scope 为 `level/campaign`；数字支持六种比较，布尔/文本只用 `==/!=` |
| `tileOwnedBy` | `q,r,camp` | 任意地块当前归属 |
| `relationIs` | `camp,targetCamp,relation` | 两个不同阵营当前关系；relation 为 `ally/neutral/enemy` |
| `weatherIs` | `weather` | 当前天气；使用 `cycle` 没有意义，运行时 cycle 从 `clear` 开始 |
| `objectiveStatusIs` | `objective,status` | status 为 `hidden/active/completed/failed` |
| `interactionStateIs` | `interactable,state` | state 为 `disabled/available/completed` |
| `groupState` | `group,state` | state 为 `anyAlive/allAlive/allDead/casualty` |
| `unitsInArea` | `area,op,value` | 可选 `camp`；统计区域格上的单位数；op 为 `<=,==,>=` |
| `mechanicEnabled` | `mechanic,enabled` | 指定机制当前是否启用 |
| `triggerEnabled` | `trigger,enabled` | 指定触发器当前是否启用 |

完整对象示例：

```json
{ "kind": "unitHpCompare", "unit": "boss", "mode": "percent", "op": "<=", "value": 25 }
```

```json
{ "kind": "unitsInArea", "area": "evac_zone", "camp": "villagers", "op": ">=", "value": 3 }
```

```json
{ "kind": "variableCompare", "scope": "campaign", "variable": "saved_scout", "op": "==", "value": true }
```

## 12. 全部公开动作：19 种

### 12.1 对白与输入控制

#### showStep

```json
{
  "kind": "showStep",
  "mode": "character",
  "speaker": { "name": "马库斯", "portrait": "centurion" },
  "text": "守住这里。",
  "next": "__hold_the_gate",
  "highlight": {
    "unit": "marcus_unit",
    "tiles": [{ "q": 1, "r": 0 }],
    "hint": "选择马库斯并移动到城门"
  },
  "boardLock": true,
  "dialogLock": true
}
```

字段：

- `text` 必须非空。
- `mode` 使用 `narrator` 或 `character`；有 speaker 时运行时按人物对白显示。
- `speaker.name` 为人物对白必需；`speaker.portrait` 可为将领 ID，或通用 NPC 立绘 `npcMale`（男性）、`npcFemale`（女性），也可省略。对有姓名但无专属立绘的配角，必须优先选择对应性别的 NPC 立绘；省略时运行时会以男性兜底图防止破图。
- `next` 可省略；自定义阶段跳转建议使用唯一、以 `__` 开头的值。
- `highlight.unit` 是一个开场单位 ID；`highlight.tiles` 是允许并高亮的地块；`highlight.hint` 是错误操作提示。
- `boardLock:true` 会限制棋盘操作；必须提供真实可执行的 `unit` 或 `tiles`，最好两者都有。
- `dialogLock:true` 禁止点击对白推进，要求玩家完成棋盘操作。

同一触发器内多张内联 `showStep` 按 `do` 顺序自动串联；只显示第一张，其余由自动 next 推进。不要写旧 `steps` 表。非 `showStep` 动作会在触发器触发时立刻执行，不等待对白结束。

#### unlockInput

```json
{ "kind": "unlockInput" }
```

关闭严格引导并清除棋盘白名单。

#### lockInput

```json
{
  "kind": "lockInput",
  "highlight": {
    "unit": "marcus_unit",
    "tiles": [{ "q": 1, "r": 0 }],
    "hint": "按指引行动"
  }
}
```

只设置白名单，不产生对白高亮。`highlight.unit` 也可为字符串 `all` 放行所有单位；正常剧情优先写具体 ID。

### 12.2 生成与单位操作

#### spawnUnits

```json
{
  "kind": "spawnUnits",
  "units": [
    {
      "id": "reinforcement_1",
      "type": "cavalry",
      "camp": "player1",
      "commander": "paladin",
      "q": -2,
      "r": 1,
      "hpPct": 100
    }
  ]
}
```

生成格必须存在且当时为空，否则该单位被跳过。ID 不得与开场单位或同一次生成重复；为避免运行时歧义，所有生成动作之间也必须全局唯一。

#### changeUnitHp

```json
{ "kind": "changeUnitHp", "target": { "unit": "boss" }, "operation": "subtract", "mode": "percent", "value": 10 }
```

- `operation`：`set/add/subtract`。
- `mode`：`value/percent`；percent 以最大生命为基准。
- `value` 必须非负。

#### changeUnitFaction

```json
{ "kind": "changeUnitFaction", "target": { "group": "defectors" }, "camp": "player1" }
```

只改变单位阵营，不改变城市归属。

#### setUnitState

```json
{ "kind": "setUnitState", "target": { "unit": "king" }, "state": "targetable", "value": false }
```

`state` 枚举：

- `canAct`：本回合能否行动，并作为战役持久行动许可。
- `canMove`：允许移动。
- `canAttack`：允许攻击。
- `targetable`：允许成为目标。
- `invulnerable`：无敌。
- `canCounterattack`：允许反击。

#### applyEffect

```json
{
  "kind": "applyEffect",
  "target": { "group": "royal_units" },
  "effectId": "royal_blessing",
  "name": "王家祝福",
  "desc": "攻击提高20%，行动力提高1。",
  "emoji": "✨",
  "duration": 2,
  "statMods": { "atkPct": 20, "spdFlat": 1 }
}
```

字段：

- `duration` 为非负整数回合；`0` 表示永久。
- `effectId` 可选；相同 ID 会更新已有同名效果，建议稳定填写。
- `statMods` 允许：`atkPct`、`atkFlat`、`defPct`、`meleeDefPct`、`rangeDefPct`、`spdFlat`、`hpPct`、`hpFlat`，值必须是数字。
- 特殊规则 `rule` 可为 `minHp`、`maxHp`、`godMode`。
- `minHp/maxHp` 必须同时提供 `rulePercent`，范围 `1..100`。
- `godMode` 不需要 `rulePercent`。
- 必须至少提供名称、特殊规则或一个属性修正。

#### assignCommander

```json
{ "kind": "assignCommander", "target": { "unit": "marcus_unit" }, "commander": "centurion" }
```

正式剧情人物优先写：

```json
{ "kind": "assignCommander", "target": { "unit": "marcus_unit" }, "storyCommander": "marcus" }
```

`commander` 与 `storyCommander` 二选一；两者都省略或为空表示移除将领。`storyCommander` 会同时挂载身份库中声明的玩法原型、剧情名字和立绘。

#### removeUnits

```json
{ "kind": "removeUnits", "target": { "group": "escaping_units" }, "mode": "despawn" }
```

`mode`：`despawn` 直接离场、不算阵亡；`kill` 处决并触发阵亡逻辑。

### 12.3 状态、阶段和结算动作

| kind | 精确主要字段 | 说明 |
|---|---|---|
| `setVariable` | `variable,operation,value` | number 操作为 `set/add/subtract/multiply/divide/min/max`；boolean/string 只能 `set` |
| `setTriggerEnabled` | `trigger,enabled` | 启用/禁用；`enabled:true` 每次都会重置目标触发器计时器 |
| `setObjectiveStatus` | `objective,status` | status 为 `hidden/active/completed/failed` |
| `changeGold` | `camp,operation,value` | operation 为 `set/add/subtract`，结果不低于 0 |
| `setDiplomacy` | `camp,targetCamp,relation` | 两阵营不同；关系对称更新，并取消当前单位选择 |
| `setWeather` | `weather` | `cycle` 会重置为晴；其他值直接切换 |
| `setInteractionState` | `interactable,state` | state 为 `disabled/available/completed` |
| `setMechanicEnabled` | `mechanic,enabled` | 动态开关机制并刷新界面 |
| `endScenario` | `result` | result 为 `win/lose`；失败可写 `reason`，胜利可写 `ending` |

示例：

```json
{ "kind": "setVariable", "variable": "saved_villagers", "operation": "add", "value": 1 }
```

```json
{ "kind": "setDiplomacy", "camp": "player1", "targetCamp": "villagers", "relation": "ally" }
```

```json
{ "kind": "endScenario", "result": "lose", "reason": "国王未能获救。" }
```

## 13. AoE 式阶段门控标准模板

未来阶段监听器必须默认关闭，并由上一阶段显式开启：

```json
[
  {
    "id": "start_story",
    "enabled": true,
    "once": true,
    "when": [{ "kind": "timer", "value": 1200 }],
    "do": [
      {
        "kind": "showStep",
        "speaker": { "name": "马库斯", "portrait": "centurion" },
        "text": "第一课：让每一种兵器在该出现的位置出现。"
      },
      {
        "kind": "showStep",
        "text": "准备好后，点击继续。",
        "next": "__infantry_ready"
      },
      { "kind": "setTriggerEnabled", "trigger": "infantry_ready", "enabled": true }
    ]
  },
  {
    "id": "infantry_ready",
    "enabled": false,
    "once": true,
    "when": [{ "kind": "eventNextIs", "value": "__infantry_ready" }],
    "do": [
      {
        "kind": "showStep",
        "text": "选择步兵并移动到高亮地块。",
        "boardLock": true,
        "dialogLock": true,
        "highlight": {
          "unit": "training_infantry",
          "tiles": [{ "q": 1, "r": 0 }],
          "hint": "选择步兵并移动到指定地块"
        }
      },
      { "kind": "setTriggerEnabled", "trigger": "infantry_arrived", "enabled": true }
    ]
  },
  {
    "id": "infantry_arrived",
    "enabled": false,
    "once": true,
    "when": [
      {
        "kind": "unitMovesToTile",
        "target": { "unit": "training_infantry" },
        "tiles": [{ "q": 1, "r": 0 }]
      }
    ],
    "do": [
      { "kind": "unlockInput" },
      { "kind": "showStep", "text": "很好。下一课。", "next": "__cavalry_ready" },
      { "kind": "setTriggerEnabled", "trigger": "cavalry_ready", "enabled": true }
    ]
  }
]
```

关键事实：`start_story` 的第三个动作会在第一张对白出现时立即启用 `infantry_ready`，不是等对白结束才启用。因为它只监听精确的 `__infantry_ready`，提前启用是安全且必要的。

## 14. result 与星级

```json
{
  "result": {
    "winText": "任务完成。",
    "loseText": "任务失败。",
    "eliminateEnemy": false,
    "starRules": [
      {
        "label": "国王存活",
        "when": [{ "kind": "unitExists", "unit": "king", "alive": true }]
      },
      {
        "label": "至少救出三名村民",
        "when": [
          { "kind": "variableCompare", "scope": "level", "variable": "saved_villagers", "op": ">=", "value": 3 }
        ]
      }
    ]
  }
}
```

胜利基础 1 星，每满足一条星级规则 +1，最多 3 星。星级条件必须是结算时可查询的状态条件，不要使用事件条件或计时器。

当前 `eliminateEnemy` 与 `turnLimit` 是公开兼容配置，但不应作为生产关卡唯一裁决。请用触发器完成/失败主要目标，或使用 `endScenario`。

## 15. 编译器硬性约束摘要

生成后逐项检查：

1. 关卡 ID 只含字母、数字、连字符。
2. 半径 `2..7`，所有地图、单位、区域、调查点和触发器坐标在棋盘内。
3. 每个行政区只有一座城市；每座城市和每个单位引用已声明阵营。
4. 单位坐标不重叠；单位 ID 唯一；兵种、玩法将领与剧情将领 ID 合法。
5. faction ID 合法、唯一且不是 `neutral`；`color` 是九个规范 ID 之一，不含任何手写颜色值。
6. 恰好一个 `human`，等于 `localPlayerCamp`。
7. `turnOrder` 无重复，完整覆盖所有启用且参与回合的阵营。
8. 外交引用合法、关系合法、双向对称。
9. 单位组、区域、调查点、变量、触发器 ID 非空且各自唯一。
10. 所有 TargetRef、变量、目标、触发器、机制、调查点、区域及目标提示光圈引用存在。
11. `all/any` 非空，`not` 有子条件；每个触发器至少一个动作。空 `when` 表示“启用即执行”，既可用于开场启用，也可用于中途启用。
12. 变量初始值、比较值和写入值类型一致。
13. `showStep.text` 非空；人物模式有 `speaker.name`；操作锁有真实高亮目标。
14. 生成单位类型、阵营、坐标、ID、玩法/剧情将领和生命值合法。
15. `applyEffect` 字段、持续回合、特殊规则和修正值合法。

## 16. 编译命令与交付流程

在项目根目录运行下列命令，将最后一个参数替换为关卡 JSON 路径：

```powershell
node --input-type=module -e "import fs from 'node:fs'; import {normalizeLevel,validateLevel} from './campaign/runtime/schema.js'; const p=process.argv[1]; const c=normalizeLevel(JSON.parse(fs.readFileSync(p,'utf8'))); const r=validateLevel(c); console.log(JSON.stringify(r,null,2)); if(r.errors.length) process.exit(1)" .\your-level.json
```

Agent 的验收顺序必须是：

1. 生成完整 JSON，不省略根字段。
2. 用 JSON 解析器确认语法有效。
3. 运行 `validateLevel`，必须达到 `errors: []`。
4. 对每条 warning 逐项修复；只有已知兼容限制才允许保留并写明原因。
5. 人工复核所有 `__next` 都有接收者，且接收触发器会在按钮点击前启用。
6. 人工计算每条操作锁移动路线的行动力、地形、天气、阻挡和目标占用。
7. 测试开场、错误点击、正常路线、失败路线、胜利结算、退出后再次测试。

## 17. 生成前的 Agent 自检提示词

可以在最终输出前执行以下自检：

```text
我只使用 Schema v2 的公开根字段、30 种条件和 19 种动作。
我没有创建 steps 表、内部 _id 或未公开 kind。
所有 ID 唯一，所有引用存在，所有坐标满足六边形半径公式。
未来阶段触发器默认关闭，并由上一阶段显式启用。
每个中途倒计时触发器初始关闭，在剧情节点启用，在成功路线禁用。
每张 boardLock 对白都有具体单位、可达地块和错误提示。
同一触发器中的非对白动作按立即执行理解。
所有主要目标都有明确完成/失败路径，不只依赖 turnLimit 或 eliminateEnemy。
JSON 已通过 validateLevel，errors 为 0。
```

只要严格遵守本文，不需要读取游戏引擎实现即可生成编辑器可导入、编译可通过、运行时不会因未知接口或缺失引用报错的战役配置。剧情是否好玩仍需要人工试玩，但数据契约和脚本骨架应当是确定的。
