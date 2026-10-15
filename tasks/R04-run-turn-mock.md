# R04 Run/Turn 状态机与 Mock 执行实施任务计划

> 当前状态见 [STATUS](../docs/STATUS.md)。原模块及联合候选已按用户批准合main，并通过2026-10-16本次主线验收，状态verified；不得自动启动后续任务。
> 执行时按工程规范选择已授权的执行方式；各项以复选框记录进度，不能因任务文件存在而标完成。

**Goal:** 把 Mock 调度、Run/Turn 命令、请求尝试和真实停止限制统一到可持久重建的状态机。

**Architecture:** RunService 是唯一调度 owner，状态变更统一经过状态机并事务持久化。公共上下文由 R05 模块提供；本任务预留已批准注入边界，总控负责联合接线。

**Tech Stack:** Electron、React、TypeScript strict、electron-vite、SQLite、Zod；Renderer Zustand 已由 R06 接入，后续扩展仍须核对已合入契约。

**Spec:** [SPEC](../SPEC.md)，[V0 审查](../docs/V0_AUDIT.md)。

## 目标与当前证据

- [src/main/services/RunService.ts](../src/main/services/RunService.ts) 第 145–192,224–248 行 部分命令绕过状态机；step/maxTurns:1 后可能仍 paused，下一步零回合才完成。
- [src/main/services/RunService.ts](../src/main/services/RunService.ts) 第 225–231,276–277 行 Resume 会重新计时，长单回合不能及时超时，delta 数量被当 Token。
- [src/main/services/RunService.ts](../src/main/services/RunService.ts) 第 264–272,322–324 行 turn_started 落库但未 notify，Main 与 Mock 各生成 requestId，通知读取全事件。
- [src/main/services/RunService.ts](../src/main/services/RunService.ts) 第 195–221,327–330 行 重试/续写/恢复 retry 仍抛错；重启后没有旧进程 context。

以上源码与原始 README 证据来自基线 `135bf82c6462ade6dd5300717d6f0102ce4a660c`；治理文档引用指向 R00 文件。行号不代表当前 README 的更新位置。未声明本任务测试已经通过，执行时须重新核对基线和函数。

## 范围与明确不做

Run/Turn 转换与命令幂等/互斥、全局活动锁、软暂停/Abort/一步一回合/续调度；正常/异常后的显式恢复、请求尝试历史；累计执行时长和 Provider 输出上限传递；准确提交后事件通知。

明确不做：不实现 Provider 网络、上下文裁剪/摘要、UI/设置、完整消息编辑分支（R12）；不自动重发 interrupted，不宣称 delta 计数等于 Token，不直接改 R05/R06 模块。

## 前置与必读

R03 数据接口、完整执行记录及恢复分类已合入；R02 契约可用；R04 获实施授权。

每个执行线程先读 [AGENTS](../AGENTS.md)、[SPEC](../SPEC.md)、[CONTRACTS](../docs/CONTRACTS.md)、[DECISIONS](../docs/DECISIONS.md)、[STATUS](../docs/STATUS.md)、[VALIDATION](../docs/VALIDATION.md)；重新检查 Git 状态、真实文件和依赖提交。具体 wire shape 以总控已合入的 Shared 为准，本文不冻结第二套协议。

## 文件归属

下列路径均相对仓库根；现存/拟新增以原始 `135bf82` 为准，拟新增路径尚不是已实现能力。共享文件由总控实施接线，不属于子项目自由修改范围。

| 状态 | 路径 | 写入负责人 | 责任 |
| --- | --- | --- | --- |
| 现存（135bf82） | src/main/services/RunService.ts；src/main/orchestrator/stateMachine.ts；src/main/providers/mock/MockProvider.ts | R04 | 唯一 RunService/状态机 owner；Mock 支持固定行为、故障/超时 fixture |
| 现存（135bf82） | tests/unit/stateMachine.test.ts；tests/unit/mockProvider.test.ts；tests/integration/runControls.test.ts；tests/integration/mockRun.test.ts | R04 | 本模块排他控制/执行测试 |
| 拟新增 | tests/unit/run/**；tests/integration/run/** | R04 | 恢复、计时、事件和请求尝试场景 |
| 现存（135bf82） | src/shared/**；src/main/database/Database.ts；src/main/ipc/registerIpc.ts；src/main/index.ts | 总控 | 已批准契约/数据扩展和上下文/Provider 接线 |

## Worktree 可独立与可并行

可独立 codex/r04-run-turn-mock Worktree。R04/R05/R06 在 R03 后可并行，但 R05 不改 RunService，R06 不改 Main，联合接线由总控串行完成。新集成 fixture 各用独立 DB。

## 共享依赖与接线规则

消费 R03 的完整执行记录与尝试接口、R02 Provider 和 Run 事件；上下文只经 R05 的已批准接口注入。后续 R11/R12/R13 向 R04 owner 提交调度接线需求，不自行编辑 RunService 或状态机。

子项目提供契约需求、调用方、兼容性、migration/版本、测试与安全影响；总控先合入共享变化再允许消费。一份文件仅一个写入人，不用分支隔离掩盖同文件争用。共享迁移、IPC/Preload 注册、Main/App 组装及 package/lock 归总控；R04 负责 RunService 状态机模块；R06 阶段由总控登记唯一负责人完成状态拆分/store，之后 App 公共组装由总控维护；后继模块只提交接线申请。

## 实施步骤

- [ ] 补充控制、计时、通知及磁盘恢复的失败行为测试。
- [ ] 统一状态变更、持久执行记录和请求尝试，修复 Mock 对应协议。
- [ ] 总控连接 R05 上下文和 R06 投影，执行三模块联合场景。
- [ ] 交付状态转换表、限制语义、事件样例和未支持路径。

## 详细验收

- [ ] 所有状态变化遵守已登记转换；非法/重入命令无重复 Turn、重复请求或泄露活动锁，终态不能再误调度。
- [ ] Pause 只请求回合结束后停；Stop 在当前请求 Abort 后保留部分文本；Step 恰好新建一个 Turn，达到 maxTurns 同步 completed。
- [ ] Resume 续用累计已执行时长，暂停不计时；活动请求到超时即取消并保留证据，无重新获得整段时限。
- [ ] Provider 获得明确输出上限；Mock 计数语义有标签，真实 Token 由 Provider 参数与 usage 处理，限制命中不误写正常完成。
- [ ] 每个 Turn Main requestId 唯一且传到 Provider；turn_started 在事务提交后立即准确通知；事件严格递增且没有漏序号。
- [ ] 重启只重建状态与允许的显式命令；retry/continue 新建尝试保留旧输出，中断默认不重发；丢失 context 不把 UI 困在不可操作 paused。
- [ ] 一个全局活动 Run 锁，paused 仍持有，终结/正常退出释放；总控与 R05/R06 的三 Agent 联合验收可观察输入/控制/投影/落库。

## 具体测试情景

| 情景 | 操作/输入 | 必须观察的结果 |
| --- | --- | --- |
| 单步边界 | 三成员 maxTurns:1，step 模式执行 | 一次请求、一条 Turn，直接 completed，无零回合补步 |
| 软暂停与停止 | 流中 Pause；另例第 N 个 delta 后 Stop | Pause 完成当前回合后停；Stop 部分输出 retained/aborted |
| 时间限制 | 长单回合+虚拟时钟；多次暂停/Resume | 超时能中止；累计值续用，暂停间隔不增加 |
| 通知顺序 | onEvent 首字前观察事件序列 | turn_started 可见且连续；requestId 与 Provider 输入相同 |
| 重启显式决策 | 磁盘 Run 关闭后创建新 service，inspect/retry/discard | inspect 零请求；retry 新 requestId；旧输出与尝试保留 |
| 重复/竞争命令 | 连点 Start/Step/Resume/Stop 和跨房间启动 | 只有合法一次调度；锁正确释放或保持 |

pnpm run test -- tests/unit/stateMachine.test.ts tests/unit/mockProvider.test.ts tests/unit/run tests/integration/runControls.test.ts tests/integration/mockRun.test.ts tests/integration/run；pnpm run typecheck。

依照 [VALIDATION](../docs/VALIDATION.md) 记录真实结果。未运行、失败、条件性验证分别说明；不得把静态证据、Mock、构建或截图互相替代。

## 交付格式

交付包含：任务 ID 与基线/分支；逐项文件清单；行为和操作说明；精确测试命令、日期、退出码、关键输出与未运行项；契约申请和数据库影响；遗留问题；本模块 Commit SHA；总控接线与集成建议。只提交本任务获准文件，不向 main 自行合并。总控集成后复验才更新 merged/verified。


## 2026-10-15 联合候选交付

原模块提交和排他 Worktree 均保留。本次共享文件/Main/跨模块适配由总控唯一写入，任务原 Worktree 不修改；不是并发回写子项目。旧步骤/基线证据保留历史含义，当前实现与验收范围以[联合报告](../docs/verification/2026-10-15-r04-r05-r06-integration.md)、[共享登记](../docs/CONTRACTS.md)和 STATUS 的 review 行为准。三模块真实输入、状态/恢复/订阅/持久化须联合运行，不相加原模块历史测试。C类数据库/公开协议扩展及R07以后不在本轮授权。


## 2026-10-16 最终主线验收

用户批准候选d4a0d274后本次fast-forward合main；534完整/265专项及原生、页面/退出等实际复验通过，当前verified。上节保留原候选历史，不再代表当前授权或状态。见[本次主线报告](../docs/verification/2026-10-16-r04-r05-r06-main.md)；本轮未继续修改业务实现，未启动后续任务。
