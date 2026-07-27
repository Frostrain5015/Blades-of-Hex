# 海克斯之剑 · Blades of Hex

一款运行在浏览器中的六角格回合制策略游戏。当前版本同时维护标准对战、单人战役、教学关与联机房间，并以同一套规则、状态协议和战场表现层支撑陆军、海军、空军行动及防御建筑。

在线版本：[https://boh.frostrain.tech/](https://boh.frostrain.tech/)

> 本 README 描述仓库当前代码提供的能力。兵种数值、将领技能和关卡规则仍在频繁调整，准确值请以 `rules/` 与具体战役模块为准。

## 当前内容

### 游戏模式

- **单人对战**：玩家对抗分层决策 AI，可选择难度、地图和遭遇战规则。
- **双 AI 推演**：用于观察 AI 对局和回放、统计、平衡验证。
- **本地热座**：两名玩家在同一设备轮流行动。
- **联机对战**：WebSocket 房间支持 2 人或 3 人对局、断线恢复、再战和房间聊天；三人房可由房主添加或移除 AI 席位。
- **将星列传**：数据驱动的单人战役，支持剧情对话、动态目标、教学步骤、关卡评分、收藏物与进度保存。
- **新兵训练**：独立教学入口，覆盖基础操作与核心战斗流程。

最新提交已将《染血的鸢尾花》第一章关卡正式接入，并继续开放后续章节内容。战役目录由 `campaign/catalog.js` 注册，关卡按需加载；当前可玩列表以大厅实际显示为准。

### 战场系统

- 六角格移动、射程、反击、兵种克制、士气、天气、地形与行政区控制。
- 城市、村庄、港口、机场，以及经济、招募、补给和工事建设。
- 陆军基础兵种及晋升/专精；驱逐舰、巡洋舰、潜艇、航空母舰等海军单位。
- 碉堡、岸防炮、激光塔等防御建筑，以及空袭、空降、舰载机等空军行动。
- 将领部署、被动/主动技能、对策卡和状态效果。
- 遭遇战战争迷雾、视野与侦察；标准地图同时包含纯陆战与海陆联合地图。
- 结构化对局统计、AI 复盘索引与完整日志导出。

## 快速开始

需要 Node.js 20 或更新版本。

```powershell
npm install
npm start
```

浏览器打开 [http://localhost:3000](http://localhost:3000)。同一局域网内的其他设备可访问启动日志中列出的局域网地址。

`npm start` 会启动 Node HTTP/WebSocket 服务，并直接提供源码版客户端，适合本地游玩和联调。默认 HTTP 端口为 `3000`，可通过 `PORT` 或 `HTTP_PORT` 修改。

### 前端开发与构建

```powershell
# Vite 开发服务器（默认 5173，API 代理到 3000）
npm run dev

# 类型检查与生产构建
npm run typecheck
npm run build
```

生产构建输出到被 Git 忽略的 `dist/`。让 Node 服务优先提供构建产物时，需要先构建并设置：

```powershell
$env:BOH_SERVE_DIST = '1'
npm start
```

若未设置 `BOH_SERVE_DIST=1`，服务端会继续提供仓库源码，避免误把旧的 `dist/` 当成最新客户端。PM2 配置 `ecosystem.config.js` 已默认启用构建产物。

## 测试与开发工具

```powershell
npm test                         # 全量：静态、规则、PVE、战役、联机、将领与特效
npm run test:quick               # 缩短完整对局循环的快速回归
npm run typecheck                # 渲染边界 TypeScript 检查
npm run selfplay                 # AI 自对弈
node test/run-all.mjs --suite=unit
node test/run-all.mjs --suite=campaign
node test/run-all.mjs --suite=net
```

可用测试套件为 `static`、`unit`、`campaign`、`pve`、`net`、`cmdr` 和 `fx`。浏览器测试由测试入口自动启动隔离服务器。

仓库还提供：

- `tools/runBenchmark.mjs`、`tools/aiBenchmark.mjs`：AI 与性能基准。
- `tools/generateBalanceDoc.mjs`：从当前规则生成平衡资料。
- `campaign/terrain-preview-*.html`：地形、水域、行动、目标选择和空军表现预览。
- `campaign/editor/`：数据驱动关卡编辑能力。
- `prototype/`：独立技术原型，不属于当前正式游戏入口。

## 运行架构

```text
浏览器客户端
  ├─ 大厅 / 标准对战 / 教学 / 战役
  ├─ 规则与状态模型（rules、engine、core）
  ├─ Canvas/Pixi 战场渲染与表现事件
  └─ WebSocket 联机协议
           │
Node 服务（server.js）
  ├─ 静态资源或 dist 构建产物
  ├─ 房间、席位、聊天与断线恢复
  ├─ 服务端权威状态修订
  ├─ Frost ID OAuth 回调与玩家档案 API
  └─ 管理连接与封禁接口
```

### 主要目录

| 路径 | 职责 |
| --- | --- |
| `js/` | 浏览器入口、交互、表现、网络和客户端运行时 |
| `rules/` | 兵种、将领、地图、移动、地形、海战等共享规则 |
| `engine/` | 战斗、行动、效果与回合执行引擎 |
| `core/` | 对局状态和共享领域模型 |
| `ai/` | 分层 AI：感知、任务、战术、生产、卡牌和难度策略 |
| `campaign/` | 战役目录、内容、运行时、编辑器和进度管理 |
| `protocol/` | 联机消息、动作与快照校验 |
| `server/` | 房间 AI 席位与玩家档案存储 |
| `admin/` | 独立管理后台服务和页面 |
| `test/` | Node、浏览器、PVE、战役和联机回归测试 |
| `tools/` | 自对弈、基准、资产清单和平衡文档工具 |

## 可选服务配置

### Frost ID 与玩家档案

复制 `auth-config.example.json` 为未纳入版本控制的 `auth-config.json`，或用 `BOH_AUTH_CONFIG` 指向配置文件。配置可启用 OAuth 登录；提供数据库连接后，`/api/player-profile` 会保存战役进度、收藏和其他玩家档案。未配置时游戏仍可匿名运行，进度保存在浏览器本地。

可用相关环境变量：

- `BOH_AUTH_CONFIG`：认证配置文件路径。
- `BOH_JWT_SECRET`：服务签发和验证登录令牌所用密钥。
- `BOH_ADMIN_CONFIG`：管理配置文件路径。
- `BOH_ADMIN_TOKEN`：远程管理令牌。
- `HTTP_PORT` / `PORT`：HTTP 与 WebSocket 端口。
- `HTTPS_PORT`：可选 HTTPS 端口，默认 `3443`。
- `BOH_SERVE_DIST=1`：优先提供 `dist/` 构建产物。

### HTTPS

当 `certs/key.pem` 与 `certs/cert.pem` 存在时，主服务会额外在仅本机监听的 HTTPS 端口启动。仓库当前没有 `generate-cert.js`，因此证书需由部署环境自行提供。

### 管理后台

```powershell
npm run admin
```

管理后台是独立进程，默认配置示例见 `admin-config.example.json`。它用于查看和关闭房间、查看连接、维护 IP 黑名单以及观察服务器状态；不要将真实令牌或密码提交到仓库。

## 内容与规则的权威来源

README 只保留稳定的产品和工程边界，以下文件才是当前行为的权威来源：

- 兵种、专精与克制：`rules/units.js`
- 将领配置：`rules/commanders.js` 与 `commander/`
- 标准地图：`rules/standardMaps.js`
- 海军、港口与水域：`rules/naval.js`、`rules/ports.js`、`rules/surfaces.js`
- 联机动作与快照：`protocol/messages.js`、`server.js`
- 战役列表：`campaign/catalog.js` 与 `campaign/content/*/chronicle.js`
- 战役关卡格式：`campaign/Blades of Hex战役JSON创作Agent完整规范.md`

新增或调整玩法时，应同步修改规则模块和对应测试；仅修改 README 中的数值不会改变游戏行为。

## License

[MIT](LICENSE) © 2026 Frostrain5015
