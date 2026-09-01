# 贡献指南

感谢你对 GameTool 的关注！欢迎提交 Issue、Pull Request 或参与讨论。

## 如何开始

1. Fork 本仓库
2. Clone 到本地，按 [README](README.md) 的快速开始跑通项目
3. 创建你的功能分支：`git checkout -b feature/xxx`

## 开发环境

- Node.js 18+（用于 Capacitor 构建与脚本验证）
- JDK 17+ 与 Android SDK（仅构建安卓 APK 时需要）
- 浏览器（Chrome/Edge）用于本地试玩

## 提交规范

- 代码位于 `public/`，遵循 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) 的目录结构与规范
- 改动前先阅读 `client.js` 与插件文件，理解插件协议（[docs/plugin-development.md](docs/plugin-development.md)）
- 每次改动更新 `CHANGELOG.md`

### Commit Message

建议遵循常规提交风格：

```
type(scope): description
```

- `feat`：新功能
- `fix`：Bug 修复
- `refactor`：重构
- `docs`：文档
- `style`：样式/格式
- `perf`：性能

## 提交流程

1. 保证改动可运行（浏览器打开 `public/index.html` 基本验证）
2. `node --check` 检查改动的 JS 文件语法
3. 提交并推送到你的分支
4. 发起 Pull Request，描述改动内容与验证方式

## 新增游戏插件

欢迎为项目贡献新游戏插件！请阅读 [docs/plugin-development.md](docs/plugin-development.md) 了解插件协议。建议遵循：

- 插件注册与 UI 放在一个独立的插件脚本文件（调用 `GameFramework.register`）
- 引擎逻辑可打包进插件 zip（含 `manifest.json` + 入口 `.js`）
- 支持本机对战（人类 + AI）
- 可选支持联机（`canLan: true` + 插件联机钩子）

## 行为准则

请保持友善、尊重，聚焦于技术与产品讨论。
