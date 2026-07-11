# rules/ — 规则与展示数据层

本目录是游戏数值、定义与文案的**唯一来源**。所有导出在模块加载时深度冻结
（`freeze.js`），运行时写入会在严格模式下抛 `TypeError`，用来保证
「逻辑与展示读同一规则键」的约定不被破坏。

## 模块一览

| 模块 | 内容 | 依赖 |
| --- | --- | --- |
| `freeze.js` | `deepFreeze` 只读保障 | 无 |
| `format.js` | `percent`/`rangeText` 统一文案格式化 | 无 |
| `symbols.js` | `EMOJI`、`EMOJI_FONT_STACK`（全部图标符号） | freeze |
| `hex.js` | `HEX_NEIGHBORS`、`hexDistance`（纯几何，无 Canvas） | freeze |
| `turns.js` | `getFactionCount/getRoundIndex/getRound` | 无 |
| `constants.js` | `BOARD_RULES`、`GAME_RULES`（经济/卡牌系统/天气循环/牌堆/选将/遭遇战视野）、`COMBAT_BALANCE`、`calcIncome` 及常用别名 | freeze, hex |
| `camps.js` | `CAMP`/`CAMP_DATA`、`CAMP_FLAG_COLORS`、`campToKey` | symbols |
| `units.js` | `UNIT_CONFIG`、`COUNTER_RELATION` | freeze |
| `terrain.js` | `TERRAIN_CONFIG`、`FORTIFICATION_CONFIG`、`MORALE_CONFIG`、`WEATHER_CONFIG` | constants, format, symbols |
| `cards.js` | `TACTICAL_CARD_DATA/CONFIG`、`COLONEL_CARD_DATA/CARDS/GOLD`（数据+执行函数） | units, camps, turns, symbols, format |
| `commanders.js` | `COMMANDER_CONFIG`（18 位将领 definition + balance） | cards, terrain, format |
| `uiText.js` | `FRONTEND_TEXT`（兵种被动/效果栏文案/图标映射） | commanders, constants, symbols, format |

## 约定

- **百分比用小数**：`0.25` 表示 25%；距离、回合、金币、HP、ATK 用实际数值。
- **唯一规则键**：每个数值只在一个 `balance`/常量里出现一次。描述文字一律在
  定义模块内通过 `format.js` 从同一键派生，**禁止在字符串里手写第二份数字**。
- **无导入顺序副作用**：派生（拼描述、算 goldCost）全部发生在定义模块内部、
  冻结之前；不存在跨模块的初始化改写。
- **执行函数无 DOM**：`cards.js` 的 `execute` 只操作传入的
  `targetTile/gameState/helpers`，可在 Node（服务器权威）与浏览器下同样运行。

## 常见改动怎么做

- **调平衡数值**：改对应模块里的 `balance`/常量键即可，技能详情、卡牌描述、
  状态栏与选将卡会在下次加载时同步更新。
- **新增将领**：在 `commanders.js` 添加 `buildXxx()`（definition + balance +
  派生描述），在 `COMMANDER_CONFIG` 注册；行为钩子放 `commander/xxx.js` 并在
  `commander/index.js` 注册；图标加到 `uiText.js` 的 `icons.commander`。
- **新增对策卡**：`cards.js` 中加数据与 `execute`；图标加到 `symbols.js` 的
  `EMOJI.cards`；若进牌堆，更新 `constants.js` 的 `deckComposition`。
- **改文案/图标**：只动 `uiText.js` / `symbols.js`；涉及数值的部分保持从
  balance 派生。

## 兼容层（过渡期）

`js/config.js`（画布运行时 + 再导出）与 `js/gameData.js`（纯再导出，已无
导入方）仍保留原有导出名，供尚未迁移的旧路径使用。新代码一律直接从
`rules/` 导入；后续阶段会逐步删除兼容层。
