# AI Roundtable

AI Roundtable 是一个基于 Electron、React 和 TypeScript 的本地桌面应用。当前版本提供固定 Mock 三 Agent 的流式演示、同进程运行控制与 SQLite 持久化；真实多模型协作和完整执行恢复尚未实现。用户界面默认使用简体中文，源码中的标识符和技术术语使用官方 English terminology。

## 发布与授权方向 / Distribution and licensing direction

**免费、源码公开（Source Available）、非商业授权。** 未来将在作者个人 GitHub 公开仓库发布源码，通过 GitHub Releases 提供桌面安装包。软件本身免费，用户自行提供模型厂商 API Key 并承担厂商调用费用；不增加收费、会员订阅、激活码、商业支付或反盗版系统。优先考虑 **PolyForm Noncommercial 1.0.0**，禁止未经授权的商业使用；正式发布前须再次核对全文并由作者确认，当前尚未设置正式许可证。不得将此定位称为 OSI 标准开源；MIT、Apache-2.0 不作为项目默认候选。

**Free of charge, source available, licensed for noncommercial use.** Source code is planned for the author's personal public GitHub repository, with desktop installers distributed through GitHub Releases. Users supply their own model-provider API keys and pay any provider fees. No software fees, subscriptions, activation keys, commercial payment or DRM systems are planned. **PolyForm Noncommercial 1.0.0** is the preferred license, subject to review of its full text and the author's confirmation before release; no final license has been adopted yet. Unauthorized commercial use is outside the intended licensing scope. This is not OSI open source; MIT and Apache-2.0 are not default project-license candidates.

完整规划及外部贡献权利要求见 [发布与授权政策 / Release policy](docs/RELEASE_POLICY.md)。本轮只调整文档，不创建或公开 GitHub 仓库、不发布安装包；现有 R00–R18 技术路线与 Worktree 模式保持不变。

## 模块化开发入口

原始基线为 main / `135bf82c6462ade6dd5300717d6f0102ce4a660c`。R00 只建立治理和验证基线，保留业务逻辑与原有测试；后续任务需逐项授权。

- [V1 产品规格](SPEC.md)与[工程规则](AGENTS.md)
- [V0 实际状态与问题](docs/V0_AUDIT.md)、[任务清单](tasks/README.md)和[状态看板](docs/STATUS.md)
- [接口登记](docs/CONTRACTS.md)、[架构决策](docs/DECISIONS.md)
- [UI/UX 设计规范](docs/DESIGN_GUIDELINES.md)
- [隔离验证规则](docs/VALIDATION.md)及[本次 R00 结果](docs/verification/2026-10-13-r00-baseline.md)

以上文件均在本仓库；不依赖外部工具包路径。总控管理共享契约、迁移和主分支合并，后续模块使用获授权的独立 Worktree。

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
pnpm build
```

macOS 打包后可直接双击 `dist/mac-arm64/AI Roundtable.app`，或运行：

```bash
open "dist/mac-arm64/AI Roundtable.app"
```

`pnpm dev` 和 `pnpm preview` 会先为 Electron 重编译 SQLite；`pnpm test` 会先为当前 Node.js 重编译。不要把普通 `pnpm rebuild better-sqlite3` 当作 Electron ABI 修复命令，需要单独重编译时运行 `pnpm native:electron`。

## 当前 M1 交付边界

原型路径是：创建任务 → Mock Agent A 固定起草文案 → Mock Agent B 固定审查文案 → Mock Agent C 固定定稿文案 → Renderer 流式展示 → SQLite 持久化。Main Process 是运行状态权威。Preload API 受限且部分输入由 Zod 校验；响应/事件 Schema 尚未接入运行时。后续 Agent 尚不接收前序输出，因此这不是已完成的共享历史协作。

源码已有 Mock 三 Agent、同进程 Play/Pause/Stop/Step/Resume、消息快照、SQLite 基础迁移、KeyService 和生命周期处理。暂停后重启、退出等待、限制和接口一致性仍有缺陷；备份未形成完整恢复方案，重试/续写入口占位。KeyService 尚未接 UI/IPC/Provider。真实 Provider、CRUD、声明式工作流、产物、安全代码导出和跨平台发布按任务清单升级。R00 不修复这些业务问题。

当前没有 lint 命令或 Electron E2E 测试；`pnpm e2e` 指向的测试目录尚不存在。打包和桌面运行不属于 R00，本次只执行隔离验证规则规定的检查。

## 设计决策

- 使用 `pnpm` 并提交 `pnpm-lock.yaml`，让本地和 CI 使用可重复的依赖解析。
- `better-sqlite3` 只在 Main Process 使用，Electron、SQLite、electron-builder 和 `@electron/rebuild` 固定为本次验证版本。打包前强制按 Electron 重编译，同时保留 electron-builder 的生产依赖收集；打包后用包内 Electron 执行 SQLite 创建、写入、读取自检，ABI 错配会直接使构建失败。原因及 hook API 见 [Electron native modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules) 和 [electron-builder v26 hooks](https://www.electron.build/v26/docs/features/hooks/)。
- SQLite 数据库写入 Electron `app.getPath('userData')`，不写入只读的应用安装目录。
- Electron 窗口使用 `contextIsolation` 和 `nodeIntegration: false`；IPC 输入已有部分 Zod 校验，来源与完整契约待 R01/R02 收紧，sandbox 兼容性决策见下条。
- 当前 Preload 由 `electron-vite` 输出为 ESM；由于 Electron sandboxed preload 不支持 ESM import，M1 保留 `contextIsolation: true` 和 `nodeIntegration: false`，将窗口 `sandbox` 设为 `false`，并把该兼容性决策限制在受信任的本地 Renderer。
- OpenAI、Anthropic 和 Gemini SDK 已声明为依赖，适配器尚未实现；目标是在 Main Provider 模块隔离 SDK，以 Mock 先验证运行链路。
- API Key 由 Main Process 的 `KeyService` 处理，密文或引用才可持久化，明文不进入日志、导出文件、模型上下文或 Renderer 持久化状态。
- V1 要求自定义 OpenAI-Compatible `Base URL` 经过 HTTPS/loopback 校验；连接测试分别报告 endpoint/key 有效性、模型列表和真实生成能力。当前这些入口尚未实现。
- Main Process 在同一 SQLite transaction 中返回 Run 消息快照和游标。Renderer 先注册监听，再缓冲同步期间的事件；只应用快照游标之后的事件，按 Run 过滤、去重并检测缺口，流式显示按 32ms 批处理。刷新仅订阅现有 Run，不重新调用模型；恢复快照之前禁用 Play。
- Main Process 对所有房间共用一个活动 Run 锁；paused 也持有锁，Stop、完成或退出后释放。模型文本不参与工作流控制。
- 已有同步初始化失败对话框、单实例聚焦和窗口重开逻辑。页面异步加载拒绝和重复退出等待仍需 R01 修复；不能据已有生命周期代码称这些边界已经稳定。

## 验证记录

历史窗口故障检查保留在 [原验证记录](docs/verification/2026-10-13-window-fix.md)，其中目录包不等于安装验证。R00 本轮命令与结果见 [R00 验证记录](docs/verification/2026-10-13-r00-baseline.md)，历史 PASS 不替代本次执行。
