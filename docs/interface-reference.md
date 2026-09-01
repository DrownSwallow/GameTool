# GameTool 开发接口清单

本文档是给插件开发者的**接口速查手册**，列出插件可用的全部框架接口。所有示例取自真实插件 [大富翁（monopoly）](../../GameTool-插件包/monopoly.js)，可直接对照阅读。

> 约定：`T` = `window.__dshTools`；`UI` = `window.UI`；`GF` = `window.GameFramework`。

## 1. 三大全局命名空间

| 命名空间 | 作用 |
|----------|------|
| `window.GameFramework` | 注册插件、通用能力（返回/菜单/存档/日志/玩家互动） |
| `window.__dshTools` | 底层工具集（弹窗/联机/保存/日志/主题读取） |
| `window.UI` | 界面方法（框架内置 + 插件自行扩展） |

## 2. 插件注册协议（`GF.register`）

插件必须调用 `GF.register({...})` 自我注册。大富翁的注册（实际代码）：

```js
window.GameFramework.register({
  id: 'monopoly',            // 唯一 id，也是联机消息前缀
  name: '大富翁',
  icon: 'dice',
  desc: '掷骰买地 · 2-6人',
  version: '1.2',
  canLan: true,              // 是否可联机（影响大厅游戏列表）
  setup: function () { showLocalSetup(); },
  startLocal: function () { startLocalGame(); },
  enter: function () { enterGame(); },
  exit: function () { promptExitGame(); },
  saveState: function () { return G.state; },
  loadState: function (state) { /* 恢复存档并 enterGame() */ },
  screenIds: ['screen-game', 'screen-local-setup'],  // 活动检测用屏幕
  isGameActive: function () { /* 返回本插件是否处于进行中 */ },
  startHost: function () { startMonopolyHost(); },
  onGameStarted: function () { enterGame(); },
  onLanMsg: function (msg) { return handleMonoLanMsg(msg); },
  onHostMsg: function (connId, m) { /* ... */ }
});
```

### 注册字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|:---:|------|
| `id` | string | ✅ | 插件唯一标识；也是联机消息 `t` 的前缀 |
| `name` | string | ✅ | 游戏卡片显示名 |
| `icon` | string | ✅ | 卡片图标名（框架内置图标集） |
| `desc` | string | - | 卡片副标题 |
| `version` | string | - | 插件版本 |
| `canLan` | boolean | - | 是否参与联机大厅，默认 true |
| `setup` | function | ✅ | 点击卡片后显示设置界面 |
| `startLocal` | function | ✅ | 开始本机游戏 |
| `enter` | function | ✅ | 进入游戏渲染 |
| `exit` | function | - | 退出确认 |
| `restart` | function | - | 再来一局 |
| `saveState` | function | - | 返回可序列化存档；`null`=不可存档 |
| `loadState` | function | - | 恢复存档（配 `saveState` 才可存档） |
| `startHost` | function | - | 联机开局（房主侧） |
| `onGameStarted` | function | - | 联机各方开局回调（可复用 `enter`） |
| `onLanMsg` | function | - | 客户端收到联机消息；返回 `true` 表示已消费 |
| `onHostMsg` | function | - | 房主收到联机消息；返回 `true` 表示已消费 |
| `screenIds` / `screenId` | array/string | - | 活动检测兜底用的屏幕 id |
| `isGameActive` | function | - | 自定义活动检测，覆盖 `screenIds` 兜底 |
| `isGameOver` | function | - | 对局是否结束（菜单据此显示「再来一局」） |

## 3. 生命周期钩子

| 钩子 | 触发时机 | 大富翁示例 |
|------|----------|-----------|
| `setup()` | 点击游戏卡片 | `showLocalSetup()` 显示本地设置（选人数 2~6） |
| `startLocal()` | 开始本机游戏 | `startLocalGame()` 初始化 `G.state` 并 `enterGame()` |
| `enter()` | 进入游戏渲染 | `enterGame()` 渲染棋盘、玩家、UI |
| `exit()` | 返回键/菜单返回 | `promptExitGame()` 退出确认弹窗 |
| `restart()` | 菜单「再来一局」 | 重置对局并重新 `enter` |
| `saveState()` | 存档 | 返回 `G.state`（整个对局状态） |
| `loadState(state)` | 读档恢复 | 赋值 `G.state` → 重置联机字段 → `enterGame()` |
| `onLanMsg(msg)` | 客户端收到消息 | `handleMonoLanMsg(msg)` |
| `onHostMsg(connId, m)` | 房主收到消息 | 按 `m.t` 分发处理并 `return true` |
| `startHost()` | 联机开局 | `startMonopolyHost()` 初始化房主房间 |

## 4. 框架通用接口（`GameFramework.*`）

| 接口 | 用途 | 大富翁中的使用 |
|------|------|---------------|
| `GF.register(plugin)` / `unregister(id)` | 注册/卸载插件 | 注册入口 |
| `GF.get(id)` / `list()` | 查询插件/列表 | - |
| `GF.back()` | 通用返回：关弹窗→活动插件 exit→主菜单 | 菜单「返回」 |
| `GF.confirmExit(id)` | 退出确认（本机可存档时含「保存并退出」） | - |
| `GF.openMenu(id)` | 通用菜单：继续/存档管理/再来一局/返回 | - |
| `GF.isGameActive(id)` / `findActiveGame()` | 活动插件检测 | 由框架在返回键时调用 |
| `GF.isGameOver(id)` | 对局结束检测 | 菜单据此显示「再来一局」 |
| `GF.startGameEntry(id)` | 卡片点击统一入口（含存档检测） | 框架自动调用 |
| `GF.canSave(id)` | 是否可存档（有 `saveState`+`loadState`） | 框架据此显示存档按钮 |
| `GF.openSaveMenu(gameId)` | 存档管理弹窗 | - |
| `GF.logGame(id, text, level)` | 游戏运行日志 | - |
| `GF.getGameLogs(id)` / `clearGameLogs(id)` | 日志读取/清空 | - |
| `GF.logEvent(level, module, desc, params)` | 标准日志 `info/debug/warn/error` | `T.logEvent(...)` |
| `GF.setDebugLog(on)` / `debugLog()` | DEBUG 开关 | - |
| `GF.registerPlayerActions(gameId, {info,emoji})` | 启用玩家卡互动 | - |
| `GF.openPlayerInfo(gameId, name)` | 玩家信息面板 | - |
| `GF.openEmojiPanel(gameId, targetName, cb)` | emoji 面板，`cb(emoji)` 回传 | - |
| `GF.getSetting(key)` | 读设置 `theme/light/acrylic/acrylicOpacity` | 主题适配 |
| `GF.getThemeSnapshot()` | 读主题快照对象 | 初始化样式 |
| `GF.loadScript(url)` | 动态加载插件脚本（返回 Promise） | 用于 URL 安装 |

## 5. 工具集（`__dshTools` = `T`）

大富翁在文件开头统一取用（实际代码）：

```js
var modal = T.modal, toast = T.toast, escapeHtml = T.escapeHtml, icon = T.icon,
    fmt = T.fmt, playerById = T.playerById, onAvatarClick = T.onAvatarClick,
    floatMsg = T.floatMsg, sendLan = T.sendLan, hostSend = T.hostSend,
    broadcastHost = T.broadcastHost, copyText = T.copyText, logEvent = T.logEvent;
var saveGame = T.saveGame, listSaves = T.listSaves, loadSave = T.loadSave,
    deleteSave = T.deleteSave, saveSlots = T.saveSlots, formatSaveTime = T.formatSaveTime;
```

| 接口 | 用途 |
|------|------|
| `T.modal({title, body, buttons, dismissable})` | 通用弹窗（`buttons: [{label, cls, onClick}]`） |
| `T.toast(text, color?)` | 轻提示 |
| `T.floatMsg(text, color?)` | 浮动消息 |
| `T.escapeHtml(s)` | HTML 转义 |
| `T.icon(name, size)` | 图标 HTML |
| `T.fmt(n)` | 数字格式化 |
| `T.$` / `$(id)` | 取 DOM |
| `T.playerById(state, id)` | 按 id 找玩家 |
| `T.onAvatarClick(p)` | 头像点击（联机互动） |
| `T.copyText(text, label)` | 复制到剪贴板 |
| `T.sendLan(msg)` | 客户端 → 房主 |
| `T.hostSend(connId, obj)` | 房主 → 单客户端 |
| `T.broadcastHost(obj)` | 房主 → 全部客户端 |
| `T.getMode()` / `setMode(m)` | 读写当前模式 `local/host/lan` |
| `T.saveGame(gameId, slot)` / `loadSave` / `listSaves` / `deleteSave` / `formatSaveTime` / `saveSlots` | 存档全套 |
| `T.recordHistory(gameId)` | 记录游玩历史 |
| `T.logEvent(level, module, desc, params)` | 标准日志 |
| `T.log(text, level)` / `logs()` / `logClear()` | 系统运行日志 |
| `T.logGame(game, text, level)` / `gameLogs(game)` | 游戏运行日志 |
| `T.getSetting(key)` / `acrylicOn()` / `themeOn()` | 主题/浅色/亚克力读取 |
| `T.versionScore(v)` | 版本号转分数（比较用） |
| `T.leaveLan()` | 退出联机 |

## 6. UI 界面方法

**框架内置（可直接调用）：** `UI.showMenu()`、`UI.exitToMenu()`、`UI.openSaveMenu(gameId)`、`UI.openInGameSaveMenu()`。

**插件自行扩展**：大富翁把自己的界面函数挂到 `UI` 上（实际代码）：

```js
UI.showLocalSetup = showLocalSetup;
UI.addLocalSeat = addLocalSeat;
UI.startLocalGame = startLocalGame;
UI.toggleStockPanel = toggleStockPanel;
UI.openMenuPanel = openMenuPanel;
UI.showPlayers = showPlayers;
UI.showResult = showResult;
UI.toggleLogPanel = toggleLogPanel;
UI.promptExitGame = promptExitGame;
UI.openChat = openChat;
UI.sendChat = sendChat;
UI.showHistory = showHistory;
```

这些方法通过 `onclick="UI.xxx()"` 供插件生成的 HTML 按钮调用。

## 7. 联机消息协议

**路由规则：** 消息 `t` 以 `插件id_` 为前缀时，框架自动转发给对应插件的 `onLanMsg`/`onHostMsg`。大富翁的所有消息均以 `monopoly_` 开头。

| 方向 | 调用 | 消息示例 |
|------|------|---------|
| 客户端 → 房主 | `sendLan({ t: 'monopoly_action', action })` | 玩家操作 |
| 客户端 → 房主 | `sendLan({ t: 'monopoly_chat', text })` | 聊天 |
| 房主 → 单客户端 | `hostSend(connId, { t: 'monopoly_init', state, playerId, seat })` | 开局下发 |
| 房主 → 全部 | `broadcastHost({ t: 'monopoly_state', state, events })` | 状态广播 |

大富翁房主端 `onHostMsg` 按 `m.t` 分发（实际代码）：

```js
onHostMsg: function (connId, m) {
  if (m.t === 'monopoly_action')        { handleHostMonoAction(connId, m.action); return true; }
  if (m.t === 'monopoly_chat')          { /* 转发聊天 */ return true; }
  if (m.t === 'monopoly_vote_takeover') { /* 托管投票 */ return true; }
  if (m.t === 'monopoly_emoji')         { /* 转发 emoji */ return true; }
  return false;   // 未消费 → 框架不处理
}
```

## 8. 插件打包（zip + manifest）

```
plugin.zip
├── manifest.json
└── monopoly.js        # 入口脚本，调用 GF.register
```

`manifest.json`（大富翁实际）：

```json
{
  "id": "monopoly",
  "name": "大富翁",
  "version": "1.2",
  "icon": "dice",
  "desc": "掷骰买地 · 2-6人",
  "canLan": true,
  "entry": "monopoly.js"
}
```

无 `manifest.json` 时，平台取根级首个 `.js` 为入口，插件 id 取文件名。

## 9. 最小插件骨架

```js
(function () {
  'use strict';
  var T = window.__dshTools, UI = window.UI;
  if (!T || !UI || !window.GameFramework) return;

  window.GameFramework.register({
    id: 'mygame',
    name: '我的游戏',
    icon: 'dice',
    desc: '示例',
    canLan: false,
    setup: function () { /* 设置界面 */ },
    startLocal: function () { /* 开局 */ },
    enter: function () { /* 渲染 */ },
    saveState: function () { return stateObj; },
    loadState: function (state) { /* 恢复 */ }
  });
})();
```

## 10. 关键约定与踩坑

- 联机消息 `t` **必须**以 `插件id_` 为前缀，否则框架不转发。
- `onLanMsg`/`onHostMsg` 处理完**返回 `true`**；返回 `false` 表示未消费。
- 联机模式下**不调用存档接口**（`GF.confirmExit` 只在 `mode === 'local'` 时提供「保存并退出」）。
- `screenIds` 或 `isGameActive` 至少提供其一，否则返回键无法识别该插件处于进行中。
- 插件文件需在 `client.js` 之后加载，才能访问 `GameFramework`。
