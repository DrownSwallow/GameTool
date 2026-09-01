# GameTool

基于 **Capacitor + Material Design 3** 的桌游运行框架，可打包为 Android APK。不含内置游戏 —— 游戏以插件形式动态安装接入。

## 特性

- 插件化架构：游戏经 `GameFramework.register()` 注册，动态加载/卸载，框架不硬编码任何游戏
- 插件安装：URL 加载脚本，或本地 zip 包（解压 → 解析 `manifest.json` → 注册）
- 联机：WebSocket/UDP 双通道、房间制大厅、密码、断线重连、托管投票
- 存档：多槽位读写管理，插件实现 `saveState`/`loadState` 接入
- 游戏记录、标准日志（INFO/DEBUG/WARN/ERROR）
- 主题：Material Design 3、亚克力材质、多主题色、浅色模式、自定义颜色

## 快速开始

### 浏览器试玩

```bash
npx serve public        # 或直接打开 public/index.html
```

### 构建 Android APK

```bash
npm install
npx cap sync android
cd android
gradlew assembleDebug
# 产物: android/app/build/outputs/apk/debug/app-debug.apk
```

环境要求：**JDK 17+**、Android SDK（`platforms;android-34`、`build-tools;34.0.0`）。

## 插件开发

每个游戏是一个 JS 文件，通过 `window.GameFramework.register()` 自我注册。最小示例见 [docs/plugin-development.md](docs/plugin-development.md)。

### 生命周期钩子

| 钩子 | 触发时机 | 必选 |
|------|----------|:---:|
| `setup()` | 点击游戏卡片 | 是 |
| `startLocal()` | 开始本机游戏 | 是 |
| `enter()` | 进入游戏渲染 | 是 |
| `exit()` | 返回键 / 菜单返回主菜单 | 可选 |
| `restart()` | 菜单「再来一局」 | 可选 |
| `saveState()` | 存档（返回可序列化对象，`null`=不可存） | 可选 |
| `loadState(state)` | 读档恢复 | 可选 |
| `onLanMsg(msg)` | 客户端收到联机消息 | 可选 |
| `onHostMsg(connId, msg)` | 房主收到联机消息 | 可选 |
| `startHost()` | 联机开局 | 可选 |

### 通用能力接口

| 接口 | 用途 |
|------|------|
| `GameFramework.back()` | 通用返回处理 |
| `GameFramework.openMenu(gameId)` | 通用菜单（存档/再来一局/返回） |
| `GameFramework.confirmExit(gameId)` | 退出确认 |
| `GameFramework.openSaveMenu(gameId)` | 存档管理弹窗 |
| `GameFramework.logEvent(level, module, desc, params)` | 标准日志 |
| `GameFramework.logGame(id, text, level)` | 游戏运行日志 |
| `GameFramework.getGameLogs(id)` / `clearGameLogs(id)` | 游戏日志读取/清空 |
| `GameFramework.registerPlayerActions(gameId, {info, emoji})` | 玩家卡互动 |
| `GameFramework.openPlayerInfo(name)` | 玩家信息面板 |
| `GameFramework.openEmojiPanel(gameId, name, cb)` | emoji 面板 |
| `__dshTools.getSetting(key)` | 读取系统设置 |

### 联机消息

消息 `t` 必须以 `插件id_` 为前缀，平台按前缀自动转发到对应插件：

```js
__dshTools.sendLan({ t: 'mygame_action', ... })        // 客户端 → 房主
__dshTools.hostSend(connId, { t: 'mygame_state', ... }) // 房主 → 单客户端
__dshTools.broadcastHost({ t: 'mygame_public', ... })   // 房主 → 全部客户端
```

### 打包与安装

zip 结构：

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

无 `manifest.json` 时，平台取根级首个 `.js` 为入口，插件 id 取文件名。安装入口：应用内「插件安装」页 → 本地 zip 或 URL 加载。

## 项目结构

```
public/                # 平台前端源码
  index.html           # 页面结构
  style.css            # Material Design 3 样式
  client.js            # 平台框架（联机/存档/日志/主题/插件安装）
  vendor/              # 第三方库（jszip 等）
android/               # Capacitor Android 工程
docs/                  # 开发文档
capacitor.config.json  # Capacitor 配置
```

## 版本管理

语义化版本 `主.次.修订`。**每次代码改动（含 bug 修复）必须递增版本号**，三处保持一致：

| 位置 | 字段 |
|------|------|
| `public/client.js` | `APP_VERSION` |
| `android/app/build.gradle` | `versionName`、`versionCode`（单调递增，`主×10000+次×100+修订`） |
| `package.json` | `version` |

每次更新同时：更新 `CHANGELOG.md`、`npx cap sync android` 同步 web 资源、构建验证。

## 文档

- [开发接口清单](docs/interface-reference.md) — 全部框架接口 + 大富翁示例
- [插件开发指南](docs/plugin-development.md)
- [开发规范](docs/DEVELOPMENT.md)
- [更新日志](CHANGELOG.md)

## 许可

[Apache License 2.0](LICENSE)
