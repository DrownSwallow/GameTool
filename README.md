# 🎲 GameTool 桌游平台

一个基于 **Capacitor + Material Design 3** 的可扩展桌游平台框架，可打包为安卓 APK。本平台本身**不含任何内置游戏**——它是一套完整的桌游运行框架，游戏以插件形式动态安装接入。

## ✨ 特性

- **插件化架构**：游戏通过 `GameFramework.register()` 协议接入，支持动态加载/卸载，框架不依赖任何具体游戏
- **插件安装**：支持从 URL 加载插件脚本，或从**本地选择 zip 插件包**安装（解压 → 解析清单 → 执行注册）
- **局域网联机**：WebSocket/UDP 双通道、房间制大厅、密码、断线重连、托管投票
- **存档系统**：多槽位存档/读档/管理，通用协议（插件实现 `saveState`/`loadState`）
- **游戏记录**：自动记录游玩历史
- **运行日志**：标准格式日志（INFO/DEBUG/WARN/ERROR），筛选、导出、DEBUG 开关
- **材质与主题**：Material Design 3、毛玻璃（亚克力）材质、多主题色、浅色模式、自定义颜色选择器
- **通用能力接口**：返回键、菜单、存档入口、退出确认、日志、玩家互动等均已接口化

## 🚀 快速开始

### 浏览器试玩（无需安装）

直接用浏览器打开 `public/index.html`。此时平台运行，但无任何游戏——请先安装游戏插件。

### 构建安卓 APK

```bash
npm install
npx cap sync android
cd android
gradlew assembleDebug
```

产物：`android/app/build/outputs/apk/debug/app-debug.apk`

**环境要求**：JDK 17+、Android SDK（platforms;android-34、build-tools;34.0.0）。

## 📦 安装游戏插件

平台不含内置游戏，游戏全部通过插件安装。

### 方式一：从本地 zip 安装

1. 准备插件包（zip），标准结构如下
2. 进入应用的「插件安装」页 →「从文件安装（zip）」→ 选择 zip 文件 → 安装

### 方式二：从 URL 安装

在「插件安装」页的地址栏填入插件脚本 URL（`.js`），点击「下载并安装」。

## 🔌 插件包标准（zip）

插件 zip 包结构：

```
plugin.zip
├── manifest.json   插件清单（可选）
└── <entry>.js      插件入口脚本（调用 GameFramework.register）
```

### manifest.json

```json
{
  "id": "mygame",
  "name": "我的游戏",
  "version": "1.0.0",
  "icon": "dice",
  "desc": "一段描述",
  "canLan": true,
  "entry": "mygame.js"
}
```

> 若 zip 无 `manifest.json`，平台会自动取根级首个 `.js` 文件作为入口，插件 id 取文件名。

### 插件脚本

```js
window.GameFramework.register({
  id: 'mygame',
  name: '我的游戏',
  icon: 'dice',
  desc: '描述',
  canLan: true,
  setup: function () { /* 显示设置界面 */ },
  startLocal: function () { /* 开始本机游戏 */ },
  enter: function () { /* 进入游戏渲染 */ },
  exit: function () { /* 退出确认 */ },
  restart: function () { /* 再来一局 */ },
  saveState: function () { /* 返回存档 */ },
  loadState: function (state) { /* 恢复存档 */ },
  onLanMsg: function (msg) { /* 客户端联机消息 */ },
  onHostMsg: function (connId, msg) { /* 房主联机消息 */ },
  startHost: function () { /* 联机开局 */ }
});
```

## 📁 项目结构

```
GameTool/
├── public/               # 平台前端源码
│   ├── index.html        # 页面结构
│   ├── style.css         # Material Design 3 样式
│   ├── client.js         # 平台框架（联机/存档/日志/材质/菜单/插件安装）
│   └── vendor/           # 第三方库（如 jszip 用于 zip 解压）
├── android/              # Capacitor Android 工程
├── docs/                 # 开发文档
└── capacitor.config.json # Capacitor 配置
```

## 📄 文档

- [插件开发指南](docs/plugin-development.md) — 开发接入新游戏的插件
- [开发规范](docs/DEVELOPMENT.md) — 目录结构、构建流程、版本管理
- [更新日志](CHANGELOG.md) — 版本历史

## 📜 许可

[MIT](LICENSE)
