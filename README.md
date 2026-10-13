# AI Roundtable

AI Roundtable 是一个基于 Electron、React 和 TypeScript 的本地桌面应用，用于运行可恢复、可持久化的多 Agent 协作工作流。用户界面默认使用简体中文，源码中的标识符和技术术语使用官方 English terminology。

## 开发环境

- Node.js 22 或更高版本
- pnpm 11（项目通过 `packageManager` 固定为 `pnpm@11.25.0`）
- macOS、Windows 或 Linux

安装依赖并启动开发模式：

```bash
pnpm install --frozen-lockfile
pnpm dev
```

常用检查：

```bash
pnpm typecheck
pnpm test
pnpm e2e
pnpm build
pnpm run pack --dir
```

macOS 打包后可直接双击 `dist/mac-arm64/AI Roundtable.app`，或运行：

```bash
open "dist/mac-arm64/AI Roundtable.app"
```

`pnpm dev` 和 `pnpm preview` 会先为 Electron 重编译 SQLite；`pnpm test` 会先为当前 Node.js 重编译。不要把普通 `pnpm rebuild better-sqlite3` 当作 Electron ABI 修复命令，需要单独重编译时运行 `pnpm native:electron`。

## 当前 M1 交付边界

M1 的首个可运行闭环是：创建任务 → Mock Agent A 起草 → Mock Agent B 审查 → Mock Agent C 定稿 → Renderer 流式展示 → SQLite 持久化。Main Process 是运行状态的唯一权威来源；Renderer 通过受限、带 schema 校验的 Preload IPC 读取快照和订阅事件。

现已实现 Mock 三 Agent、Play/Pause/Stop/Step/Resume、Run 快照恢复、SQLite 迁移与备份、KeyService 和应用生命周期处理。真实 Provider、完整 CRUD、正式安装包与跨平台验证按后续里程碑进行；M1 的恢复重试入口尚未全部实现，不应视为完整发布版。

## 设计决策

- 使用 `pnpm` 并提交 `pnpm-lock.yaml`，让本地和 CI 使用可重复的依赖解析。
- `better-sqlite3` 只在 Main Process 使用，Electron、SQLite、electron-builder 和 `@electron/rebuild` 固定为本次验证版本。打包前强制按 Electron 重编译，同时保留 electron-builder 的生产依赖收集；打包后用包内 Electron 执行 SQLite 创建、写入、读取自检，ABI 错配会直接使构建失败。原因及 hook API 见 [Electron native modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules) 和 [electron-builder v26 hooks](https://www.electron.build/v26/docs/features/hooks/)。
- SQLite 数据库写入 Electron `app.getPath('userData')`，不写入只读的应用安装目录。
- Electron 窗口使用 `contextIsolation` 和 `nodeIntegration: false`；所有跨进程参数由 Zod schema 校验，sandbox 兼容性决策见下条。
- 当前 Preload 由 `electron-vite` 输出为 ESM；由于 Electron sandboxed preload 不支持 ESM import，M1 保留 `contextIsolation: true` 和 `nodeIntegration: false`，将窗口 `sandbox` 设为 `false`，并把该兼容性决策限制在受信任的本地 Renderer。
- OpenAI、Anthropic 和 Gemini SDK 在 Provider adapter 中隔离；Mock Provider 先于真实网络 Provider 用于端到端验证。
- API Key 由 Main Process 的 `KeyService` 处理，密文或引用才可持久化，明文不进入日志、导出文件、模型上下文或 Renderer 持久化状态。
- 自定义 OpenAI-Compatible `Base URL` 必须经过 HTTPS/loopback 校验；连接测试分别报告 endpoint/key 有效性、模型列表和真实生成能力。
- Main Process 在同一 SQLite transaction 中返回 Run 消息快照和游标。Renderer 先注册监听，再缓冲同步期间的事件；只应用快照游标之后的事件，按 Run 过滤、去重并检测缺口，流式显示按 32ms 批处理。刷新仅订阅现有 Run，不重新调用模型；恢复快照之前禁用 Play。
- Main Process 对所有房间共用一个活动 Run 锁；paused 也持有锁，Stop、完成或退出后释放。模型文本不参与工作流控制。
- 启动失败会显示中文错误对话框并退出。第二次启动聚焦已有窗口；macOS 普通关闭窗口后保留应用，重新激活会创建窗口并重新绑定 IPC；生成中确认退出会复用取消、持久化与 SQLite 关闭流程。

## 验证记录

本次窗口故障的命令、实际结果和未验证项目记录在 `docs/verification/2026-10-13-window-fix.md`。构建成功、安装成功、窗口实际启动和 Mock 端到端结果分别记录。
