# 2026-10-13 窗口启动与 Mock 恢复验证

## 本次修复

启动对话框实际报告 `better-sqlite3` 使用 Node ABI 137，而 Electron 38.8.6 要求 ABI 139。普通 Node 测试重编译会覆盖原生二进制，却可能留下 Electron rebuild 的 `.forge-meta` 标记；仅依赖自动 rebuild 会误用旧标记。

- 打包 `beforeBuild` 强制 Electron rebuild，并保留 electron-builder 的依赖收集流程。
- `afterPack` 使用包内 Electron 加载包内 SQLite，创建表、参数化写入、读取和关闭；失败时阻断构建。
- 启动异常显示错误对话框并退出；服务尚未初始化也可完成退出。
- 窗口关闭后释放 IPC，重开窗口重新绑定；生成中确认退出复用 Main shutdown。
- Main 全局活动 Run 锁覆盖 running/paused；修复 paused 后 Stop 无法释放锁。
- 快照包含当前 Run 消息与事件游标，Renderer 过滤旧 Run、去重、检测缺口、缓冲同步竞态，并按 32ms 批处理。
- 刷新恢复期间禁用 Play，新 Run 重置游标，已持久化文本不再重放追加；中文状态标签单独存放。

## 修改及新增文件

- `src/main/index.ts`、`src/main/services/RunService.ts`
- `src/shared/types/run.ts`、`src/shared/schemas/run.ts`
- `src/renderer/App.tsx`、`src/renderer/locales/zhCN.ts`
- `scripts/rebuild-native.cjs`、`scripts/verify-native.cjs`
- `package.json`、`pnpm-lock.yaml`、`electron-builder.yml`、`README.md`
- `tests/unit/appLifecycle.test.ts`、`tests/unit/rendererSync.test.tsx`
- `tests/unit/stateMachine.test.ts`、`tests/integration/mockRun.test.ts`
- 本验证记录

## 命令与真实结果

当前 Codex 提供的 Node 带有 macOS 签名约束；本地验证使用 `/private/tmp/roundtable-node` 和 `/private/tmp/roundtable-bin` 中的临时 Node harness。项目脚本、锁文件及构建产物仍使用仓库内的真实依赖，实际桌面启动使用包内 Electron。

| 检查 | 实际执行 | 结果 |
| --- | --- | --- |
| 锁文件 | `pnpm install --ignore-scripts --frozen-lockfile --store-dir /Users/zhangwenjie/Library/pnpm/store/v11` | exit 0，725 entries 通过 pnpm supply-chain policy check |
| TypeScript strict | `pnpm run typecheck`；最终 `pnpm run pack --dir` 内再次运行 `tsc --noEmit` | exit 0 |
| Vitest | `pnpm run test --reporter=dot`，先执行 `native:node` | 8 files / 52 tests PASS，exit 0 |
| 生产构建 | `pnpm run pack --dir` 内 `electron-vite build` | Main、Preload、Renderer 全部构建成功 |
| macOS arm64 目录包 | `CSC_IDENTITY_AUTO_DISCOVERY=false pnpm run pack --dir` | exit 0 |
| 包内 SQLite | 打包 `afterPack` 自检 | `Packaged SQLite PASS: Electron ABI 139` |
| 实际窗口 | `open -n "dist/mac-arm64/AI Roundtable.app"`，Computer Use 读取窗口及截图 | 主窗口显示；最终截图显示中文“已完成”及三条 Agent 消息 |
| Mock 闭环 | 在打包应用点击“开始 Mock 协作” | SQLite 中新 Run 为 completed，3 个 Turn、3 个不同 requestId，三条消息持久化 |
| Renderer 刷新 | 在打包应用执行 Command-R，检查消息及 SQLite | 恢复三条消息，文本未重复追加，未新增额外 Turn/request |

本次实际 Mock Run 为 `accbdc8c-ee26-4878-ac2a-157bada8c992`；数据库位于 `~/Library/Application Support/ai-roundtable/ai-roundtable.db`。最新中文标签构建启动后仍恢复该 Run。

回归测试先复现了同步重复文本、新 Run 游标、订阅竞态、事件缺口、Play 连点、恢复期 Play、暂停后 Stop 和中文状态问题；修复后对应测试通过。窗口生命周期测试覆盖初始化失败、未初始化退出、重开 IPC、第二实例聚焦和生成中确认退出。

## 平台结果与剩余边界

| 平台 | 构建 | 安装 | 实际启动 | Mock 端到端 |
| --- | --- | --- | --- | --- |
| 当前 macOS arm64 | 已验证 | 未验证（仅目录包） | 已验证 | 已验证 |
| Windows | 未验证 | 未验证 | 未验证 | 未验证 |
| Linux | 未验证 | 未验证 | 未验证 | 未验证 |

- 当前包未签名或 notarize，使用默认 Electron 图标；本次未制作 DMG、ZIP 或安装程序。
- Playwright 自动化桌面端到端命令未验证；本次桌面运行通过 Computer Use 与 SQLite 只读检查验证，不能替代跨平台自动化。
- 真实 Provider、第三方网络调用和付费推理未执行，当前应用使用 Mock Provider。
- `retryTurn`、`continueMessage`、interrupted 后重试仍只具备校验入口，完整实现待补齐；本次故障修复不代表整个 M1 已满足全部验收条件。
- `KeyService` 后端安全检查已有测试，但尚未完成完整密钥输入 UI/IPC 链路；不应在当前版本配置真实 Provider Key。
- 本次没有 Git commit；工作区文件保留，Git metadata 写入此前被 sandbox 拒绝。
