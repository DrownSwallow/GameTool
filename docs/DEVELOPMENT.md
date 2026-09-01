# 开发规范

本文档描述 GameTool 桌游平台的目录结构、构建流程与版本管理规范。本平台为纯框架，不含内置游戏，游戏以插件形式安装接入。

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

## 构建流程

### 浏览器运行

```bash
# 直接打开 public/index.html，或起一个静态服务器
npx serve public
```

### 构建安卓 APK

```bash
npm install
npx cap sync android       # 同步 web 资源到 android/assets
cd android
gradlew assembleDebug
```

**环境要求**：JDK 17+、Android SDK（platforms;android-34、build-tools;34.0.0）。

## 版本管理

采用语义化版本 `主版本.次版本.修订号`（如 `2.0.0`）。

- **主版本**：重大架构重构、不兼容变更
- **次版本**：新增功能
- **修订号**：Bug 修复、优化

### 版本号定义

版本号定义于两处，**必须保持一致**：

| 位置 | 字段 |
|------|------|
| `public/client.js` | `APP_VERSION` 常量（框架版本） |
| `android/app/build.gradle` | `versionName "x.y.z"`、`versionCode`（递增整数） |

`versionCode` 用于 Android 判断是否可覆盖安装，必须**单调递增**。进入 2.x 后采用 `主×10000 + 次×100 + 修订`（如 2.3.19 → 20319）。

### ⚠️ 强制规则：每次更新/debug 都必须递增版本号

**任何一次代码改动（含 Bug 修复、调试、小优化）都必须递增版本号**，不得跳过。这是硬性要求：

- 每次修改代码 → **必须**同步递增 `APP_VERSION`（client.js）与 `versionCode`/`versionName`（build.gradle）
- 即使只是修一个 bug、一次 debug 调试，也要递增版本号（保证 Android 可覆盖安装、版本可追溯）
- 三处版本号必须一致：`client.js` 的 `APP_VERSION`、`build.gradle` 的 `versionCode`/`versionName`、`package.json` 的 `version`
- 插件 zip 修改后也应更新 `manifest.json` 的 `version`

> 示例：当前 2.3.21，修一个 bug 后应升为 2.3.22（`versionCode` 20322），再修一个再升 2.3.23，以此类推。

### 版本更新清单

- [ ] **递增版本号**（每次改动必做）：更新 `client.js` 的 `APP_VERSION`、`build.gradle` 的 `versionCode`/`versionName`、`package.json` 的 `version`
- [ ] 更新 `CHANGELOG.md`
- [ ] 同步 web 资源到 `android/app/src/main/assets/public/`
- [ ] 构建 APK 并验证
- [ ] （如改插件）更新插件 `manifest.json` 的 `version` 并重新打包 zip

## 插件架构

平台通过 `window.GameFramework` 注册协议调度所有游戏插件，框架**不硬编码任何游戏**。游戏是独立插件，可动态安装/卸载。

### 插件协议

插件通过 `GameFramework.register()` 注册，提供生命周期钩子：`setup`/`startLocal`/`enter`/`exit`/`restart`/`saveState`/`loadState`/`onLanMsg`/`onHostMsg`/`startHost`。详见 [plugin-development.md](plugin-development.md)。

### 插件安装

平台支持两种插件安装方式（见 `client.js`）：

- **URL 加载**：`GameFramework.loadScript(url)` 动态加载插件脚本
- **本地 zip 安装**：`UI.installZipPlugin()` 读取 zip → JSZip 解压 → 解析 `manifest.json` → 执行入口脚本注册

### 联机消息分发

插件消息 `t` 以插件 id 为前缀（如 `mygame_`），平台自动转发给对应插件的 `onLanMsg`/`onHostMsg`。插件通过 `__dshTools.sendLan`/`hostSend`/`broadcastHost` 收发联机消息。

## 代码规范

- JavaScript 文件使用 IIFE 包裹（避免全局污染），`'use strict'`
- 文件必须 UTF-8 无 BOM
- 改代码后用 `node --check <file>` 验证语法
- 新增插件脚本放 `public/` 或通过平台插件安装机制分发，不直接修改框架文件
