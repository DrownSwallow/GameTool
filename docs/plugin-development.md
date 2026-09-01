# 插件开发指南

GameTool 采用插件化架构：每个游戏作为独立插件，通过系统框架 `GameFramework` 的注册协议接入。本文档介绍如何开发一个游戏插件。

## 接入方式

游戏插件是一个普通 JavaScript 文件，在页面加载时调用 `window.GameFramework.register()` 自我注册。系统框架通过注册表统一调度，**不硬编码任何游戏**。

### 最小插件示例

```js
// mygame-plugin.js
(function () {
  'use strict';
  var T = window.__dshTools; // 系统工具
  var UI = window.UI;
  if (!T || !UI || !window.GameFramework) return;

  window.GameFramework.register({
    id: 'mygame',
    name: '我的游戏',
    icon: 'dice',
    desc: '一段描述',
    canLan: true,
    setup: function () { /* 显示本机设置界面 */ },
    startLocal: function () { /* 开始本机游戏 */ },
    enter: function () { /* 进入游戏渲染（本机/联机共用） */ },
    exit: function () { /* 游戏内退出确认 */ },
    restart: function () { /* 再来一局 */ },
    saveState: function () { /* 返回可序列化存档，null 表示不可存档 */ },
    loadState: function (state) { /* 恢复存档 */ },
    onLanMsg: function (msg) { /* 客户端联机消息处理 */ },
    onHostMsg: function (connId, msg) { /* 房主联机消息处理 */ },
    startHost: function () { /* 联机开局 */ }
  });
})();
```

在 `index.html` 的 `<head>` 或 `</body>` 前加入：

```html
<script src="mygame-plugin.js"></script>
```

## 生命周期钩子

| 钩子 | 触发时机 | 必选 |
|------|----------|------|
| `setup()` | 点击游戏卡片 | 是 |
| `startLocal()` | 开始本机游戏 | 是 |
| `enter()` | 进入游戏渲染 | 是 |
| `exit()` | 返回键/菜单「返回主菜单」 | 可选 |
| `restart()` | 菜单「再来一局」 | 可选 |
| `saveState()` | 存档 | 可选 |
| `loadState(state)` | 读档恢复 | 可选 |
| `onLanMsg(msg)` | 客户端收到联机消息 | 可选 |
| `onHostMsg(connId, msg)` | 房主收到联机消息 | 可选 |
| `startHost()` | 联机开局 | 可选 |

## 通用能力接口

插件可直接调用以下通用接口，获得与内置游戏一致的系统能力：

| 接口 | 用途 |
|------|------|
| `GameFramework.back()` | 通用返回处理 |
| `GameFramework.openMenu(gameId)` | 打开通用菜单（含存档管理/再来一局/返回） |
| `GameFramework.confirmExit(gameId)` | 退出确认（联机不调用存档） |
| `GameFramework.openSaveMenu(gameId)` | 存档管理弹窗 |
| `GameFramework.logEvent(level, module, desc, params)` | 标准日志 |
| `GameFramework.logGame(id, text, level)` | 游戏运行日志 |
| `GameFramework.getGameLogs(id)` / `clearGameLogs(id)` | 游戏日志读取/清空 |
| `GameFramework.registerPlayerActions(gameId, {info, emoji})` | 启用玩家卡互动 |
| `GameFramework.openPlayerInfo(name)` | 玩家信息面板 |
| `GameFramework.openEmojiPanel(gameId, name, cb)` | emoji 选择面板 |
| `__dshTools.getSetting(key)` | 读取系统设置（主题/浅色/亚克力） |

## 联机开发

系统框架提供联机基础设施（UDP/WebSocket 双通道、房间制大厅、房主权威）。插件通过 `onLanMsg`/`onHostMsg`/`startHost` 收发游戏专属消息：

- **客户端 → 房主**：`__dshTools.sendLan({ t: 'mygame_action', ... })`
- **房主 → 单个客户端**：`__dshTools.hostSend(connId, { t: 'mygame_state', ... })`
- **房主 → 全部客户端**：`__dshTools.broadcastHost({ t: 'mygame_public', ... })`

系统框架的消息分发规则：消息 `t` 以 `插件id_` 为前缀（如 `mygame_`）时会自动转发给对应插件的 `onLanMsg`/`onHostMsg`。因此插件消息前缀需与插件 id 一致。

## 插件打包与安装

插件可打包为 zip 供本地安装。zip 标准结构：

```
plugin.zip
├── manifest.json   插件清单（可选）
└── <entry>.js      插件入口脚本
```

`manifest.json`：

```json
{
  "id": "mygame",
  "name": "我的游戏",
  "version": "1.0.0",
  "icon": "dice",
  "desc": "描述",
  "canLan": true,
  "entry": "mygame.js"
}
```

若无 `manifest.json`，平台自动取根级首个 `.js` 文件作为入口，插件 id 取文件名。安装方式见 [README](../README.md) 的「安装游戏插件」。

## 主题与材质适配

插件可通过 `GameFramework.getSetting('theme'|'light'|'acrylic'|'acrylicOpacity')` 或 `getThemeSnapshot()` 读取当前主题，实现风格自动接入。CSS 使用 Material Design 3 设计令牌（CSS 变量 `--md-*`）。

## 加载顺序

`index.html` 中脚本加载顺序：

1. 平台框架（`client.js`）
2. 插件脚本（运行时通过 URL 或 zip 动态安装）

插件需在 `client.js` 之后加载，才能访问 `GameFramework`。
