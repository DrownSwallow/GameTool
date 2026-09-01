# 开发规范

GameTool 是纯框架，不含内置游戏，游戏以插件形式安装接入。这里记录目录结构、构建方式和版本规则。

## 目录结构

```
GameTool/
├── public/               # 平台前端源码
│   ├── index.html        # 页面结构
│   ├── style.css         # Material Design 3 样式
│   ├── client.js         # 平台框架（联机/存档/日志/材质/菜单/插件安装）
│   └── vendor/           # 第三方库（如 jszip）
├── android/              # Capacitor Android 工程
├── docs/                 # 开发文档
└── capacitor.config.json # Capacitor 配置
```

## 构建

### 浏览器运行

```bash
npx serve public          # 或直接打开 public/index.html
```

### 构建安卓 APK

```bash
npm install
npx cap sync android      # 同步 web 资源到 android/assets
cd android
gradlew assembleDebug
```

环境要求：JDK 17+、Android SDK（`platforms;android-34`、`build-tools;34.0.0`）。

## 版本管理

用语义化版本 `主.次.修订`。主版本是架构/不兼容变更，次版本加功能，修订号修 bug。

版本号在 **client.js、build.gradle、package.json** 三处都有，改代码时一起改，别漏。`versionCode` 必须单调递增（Android 靠它判断能否覆盖安装），2.x 起用 `主×10000 + 次×100 + 修订`，如 2.3.19 → 20319。

几件事按习惯来：

- 每次代码改动都递增版本号，**包括修 bug 和调试**——不然 Android 装不上新包
- 递增位置：`client.js` 的 `APP_VERSION`、`build.gradle` 的 `versionName`/`versionCode`、`package.json` 的 `version`
- 同步更新 `CHANGELOG.md`，然后 `npx cap sync android` 再构建验证
- 改了插件，`manifest.json` 的 `version` 和 zip 也要重打

> 例子：现在 2.3.21，修个 bug 就升 2.3.22（`versionCode` 20322），再修再升，别跳过。

## 插件架构

所有游戏都走 `window.GameFramework.register()` 注册，框架只调度不内置任何具体游戏。插件可动态安装/卸载。

- 生命周期钩子：`setup` / `startLocal` / `enter` / `exit` / `restart` / `saveState` / `loadState` / `onLanMsg` / `onHostMsg` / `startHost`，具体看 [plugin-development.md](plugin-development.md)
- 安装方式两种（见 `client.js`）：`GameFramework.loadScript(url)` 加载脚本；`UI.installZipPlugin()` 解压 zip → 解析 `manifest.json` → 执行入口注册
- 联机消息 `t` 以插件 id 开头（如 `mygame_`），框架按前缀转给对应插件的 `onLanMsg`/`onHostMsg`；插件用 `__dshTools.sendLan`/`hostSend`/`broadcastHost` 收发

## 代码规范

- JS 用 IIFE 包裹并 `'use strict'`，避免全局污染
- 文件 UTF-8 无 BOM
- 改完用 `node --check <file>` 过一遍语法
- 新插件脚本放 `public/` 或走平台安装机制分发，别直接改框架文件
