# Codex → Claude Code 交接记录（2026-10-21）

本文件把 Codex 私有记忆（`~/.codex/memories/MEMORY.md` 中 AI Roundtable 部分、rollout 摘要、计划和最后一次总控会话）里**仓库文档没有记录**的内容提炼进仓库。权威状态仍以 [STATUS](STATUS.md)、[DECISIONS](DECISIONS.md)、[VALIDATION](VALIDATION.md)、[ENVIRONMENT](ENVIRONMENT.md) 为准；本文件与它们冲突时，以仓库文档和实际 Git 状态为准。

## 当前进度（交接时）

- main：`b309b88 docs: plan multi-provider catalog as R08 R09 follow-on`，R00–R09 均 merged/verified（R09 仅 fixture）；DeepSeek 受控单次请求链路已合 main，但真实付费发送未验收。
- **正在进行：R10A（Anthropic）+ R10B（Gemini）+ R11（声明式工作流）联合集成**，分支 `codex/integrate-r10a-r10b-r11`（`3d119c7`，已 merge 三个模块分支，领先 main 6 个提交）。
  - 该 Worktree 有 **22 个已修改 + 10 个新增文件未提交**（约 +397/−96），内容为总控接线：原生 Provider 安全工厂（`ProviderRegistry`、`network.ts`）、工作流 Shared schema（`src/shared/schemas/workflow.ts`）、RunService 调度、IPC/Preload、Renderer `productionAdapter`、以及对应测试和 `tests/probes/r10-r11-*.cjs` 探针。
  - Codex 最后汇报：工厂接线专项、工作流预览契约、四种模板的 RunService 专项和 Renderer 接线测试已通过；**下一步是合并前代码审查 + 真实 Electron 生产入口的混合 Provider 工作流验证（fixture）**，之后才能请用户批准合 main。
  - 未审核的 Claude/Gemini 模型必须在读取 Key、发请求前被拒绝；没有获审能力/费用策略时继续拒绝真实生成。R12 未授权，不得启动。
  - STATUS 看板表格里 R10A/R10B/R11 仍写着“未创建”，以表格上方 2026-10-20 的说明为准（用户已授权三模块继续），合并后需更新看板。
- 之后的路线：R12/R13/R14 → R15/R16 → R17（E2E 与发布）→ R18，依赖见 [tasks/README](../tasks/README.md)。另有 [多服务商目录规划](PROVIDER_CATALOG_PLAN.md)（not_started）。

## 用户偏好（Codex 记忆中反复出现）

- 交付必须是可运行、可持久化、可测试的端到端切片，不要只生成目录、空接口、TODO 或静态界面；也不要停留在反复制定计划。
- 任何未实际执行的检查标记为“未验证”，不能写 PASS；模块测试通过与联合集成、主线验收、真实 Provider、E2E、跨平台分别报告。
- 只做本次授权的任务，完成后停在授权边界，不自动进入下一个 R 编号、不自行合 main。
- 不得通过删除测试、skip、修改断言掩盖问题；保留真实失败证据（RED → GREEN）。
- 真实能力未实现时明确返回 `unsupported`，Mock 成功不能冒充真实鉴权/生成；不发起任何未授权的付费 API 请求。
- 问“最新版应用在哪”时，给可点击路径并说明是否真的是最新构建（比较 `app.asar` 与 `out/` 时间、Git 状态），旧包不能称为最新版。

## 关键技术约束（摘要，细节见各 R 任务书与验证记录）

- Main 是运行状态唯一权威；Renderer 刷新走 snapshot/cursor/事件去重与缺口重同步，绝不重放模型请求。`snapshot_required` 是临时控制信号，不推进权威 cursor。
- 恢复区分 `resumeRun`/`retryTurn`/`continueMessage`/`recoverInterruptedRun`；interrupted 请求不自动重放。retry/continue 新建 requestId/messageId/Attempt 并保留历史。
- 事件仅在事务提交后经 `afterCommit` 通知；Run/Turn/Attempt 在同一收尾事务结算。
- Provider 身份是稳定 `providerId`，模型身份是 `(providerId, modelId)`；Key 只经 Main `resolveKey` 解析，不进入 Renderer、日志、事件或错误详情。
- Provider HTTP：`redirect: 'error'`、SDK `maxRetries: 0`、关闭 SDK 日志、自有总超时 + 严格 SSE；缺终态只发脱敏 error 不发 finish；usage 缺失不填零；不按模型名猜能力。
- Anthropic：具名 SSE（`message_start` … `message_stop`，缺 `message_stop` 的 EOF 无效）；R09 私有 `readSse` 只接受 `message` 事件，不能直接复用；usage 为累计值且单调；不要通用强制 `thinking: {type:'disabled'}`。
- R11 工作流：Main 可信、有限、硬校验的计划；拒绝无界循环、动态分支和非法成员；`nextWorkflowStep` 只是查询，不授权发送。
- 公共 `body min-width:1080px` 导致 800px 窄窗横向溢出，属 R16 待处理风险。

## 环境踩坑

- better-sqlite3 有 Node（ABI137）与 Electron 38.8.6（ABI139）两套原生构建，**必须串行重建**、各 Worktree 不共享 node_modules；Node ABI 结果不能证明 Electron 能加载 SQLite。`pnpm test` 的 pretest 会按当前 PATH 的 Node 重建。
- 使用官方 Node **24.18.1**（24.19/24.21 headers 触发 Node #65446 `RemoveEnvironmentCleanupHook` 崩溃），详见 [ENVIRONMENT](ENVIRONMENT.md)。
- 只跑部分测试用 `pnpm exec vitest run <路径>`；`pnpm run test -- <路径>` 在 pnpm 11 会跑全量，并可能在沙箱触发 `listen EPERM`（`EPERM` 表示测试未执行，不能记 PASS）。
- 在线安装可能 DNS/网络超时，使用已核验离线缓存安装并如实记录失败。
- Electron rebuild 可能因 `~/.electron-gyp` 不可写失败；Rollup 原生模块可能因 macOS Team ID 不匹配失败（用临时签名 Node 副本绕过）。
- 桌面探针必须先隔离 userData/sessionData/logs；真实用户数据库在 `~/Library/Application Support/ai-roundtable/ai-roundtable.db`，测试不得接触。
- 旧安装包路径 `dist/mac-arm64/AI Roundtable.app`，看最新效果用 `pnpm dev` 或重新 `pnpm pack`。

## Worktree 与分支

交接前除主仓库外有 16 个 Worktree，都在 `~/.codex/worktrees/<名字>/AI交互`。2026-10-21 迁移处理：

- `codex/integrate-r10a-r10b-r11`（原目录名 `deepseek-final-readiness`，历史遗留命名）有未提交改动，已用 `git worktree move` 移出 `~/.codex`；移动后 32 项改动完整，`./node_modules/.bin/tsc --noEmit` exit 0。
- 其余 15 个 Worktree 无未提交改动，已用 `git worktree remove`（不带 `--force`）删除目录；全部分支保留在主仓库，包括 detached `9684` 指向的 `e9cf24e`（已被 `codex/deepseek-*` 分支包含）。需要时可用 `git worktree add <路径> <分支>` 重新检出。
- `codex/r01`…`codex/r09` 原子项目分支显示“领先 main 1 个提交”，是因为总控以重新引入（cherry-pick）方式合入，内容已在 main，见 STATUS 的“原/引入/接线”提交列。

### 仓库位置（2026-10-21 迁移）

- **2026-10-22 起的当前位置：`~/Claude code/AI roundtable`**（先改名为 `AI roundtable`，再整体移出 iCloud 同步的"文稿"文件夹）；手动 Worktree 在同级 `~/Claude code/AI交互-worktrees/`。下面几条是当时的迁移记录。

- 主仓库从 `~/Documents/ChatGPT/AI交互` 整体移到 **`~/Documents/Claude/AI交互`**；Worktree 目录移到 **`~/Documents/Claude/AI交互-worktrees/`**（当前只有 `integrate-r10a-r10b-r11`），已执行 `git worktree repair`，两处 `tsc --noEmit` exit 0、`node_modules` 无断链。
- 新的 Worktree 统一放在 `~/Documents/Claude/AI交互-worktrees/`，不再依赖 `~/.codex`。
- `docs/verification/` 历史记录中的 `Documents/ChatGPT/AI交互` 是当时证据，保持原样不改。
- 受控桌面启动器的 `build-manifest.json` 绑定构建时的仓库绝对路径和 main HEAD；旧 `.cache/controlled-desktop-main` 构建已过期（路径和 HEAD 都变了），使用前须按 `scripts/controlled-desktop/README.md` 重新 `prepare`。

## Codex 原始资料位置（只读参考，不要提交进仓库）

- 记忆：`~/.codex/memories/MEMORY.md`（AI Roundtable 两个 Task Group）、`~/.codex/memories/rollout_summaries/*roundtable*`、`*r0[1-4]_*`
- 计划：`~/.codex/plans/01a13112-…/` 与 `~/.codex/plans/01a13432-…/` 下的 `PLAN.md`
- 总控会话完整记录：`~/.codex/sessions/2026/10/13/rollout-2026-10-13T15-38-38-01a13432-f814-7480-9376-eacbc445e1e0.jsonl`（线程名“审查 AI 圆桌并规划升级”）
- `~/.codex/auth.json` 等凭证不迁移。
