# R02 统一契约与排他文件归属实施任务计划

> 本分支已获用户明确授权实施 R02；基线 b690a1e，当前 codex/r02-contracts，待总控审核且未合 main。总控 [STATUS](../docs/STATUS.md)保留 main 历史状态，本轮不自行标 merged/verified。
> 执行时按工程规范选择已授权的执行方式；各项以复选框记录进度，不能因任务文件存在而标完成。

**Goal:** 让 Main、Preload、Renderer、Provider 与持久化边界消费一份可校验契约，冻结后续模块归属。

**Architecture:** Shared 只包含纯 DTO、类型与 Zod Schema；运行时输入/响应/事件统一验证。公共装配和迁移由总控管理，模块仅消费已合入协议。

**Tech Stack:** Electron、React、TypeScript strict、electron-vite、SQLite、Zod；Renderer Zustand 是 V1 目标，使用前先核对已合入实现。

**Spec:** [SPEC](../SPEC.md)，[V0 审查](../docs/V0_AUDIT.md)。

## 目标与当前证据

- [src/main/services/RunService.ts](../src/main/services/RunService.ts) 第 7–15 行 与 [src/shared/contracts/run.ts](../src/shared/contracts/run.ts) 第 8–16 行 重复 StartRunInput。
- [src/shared/types/run.ts](../src/shared/types/run.ts) 第 103 行 允许 recovery resume；[src/preload/index.ts](../src/preload/index.ts) 第 20 行 与 [src/main/ipc/registerIpc.ts](../src/main/ipc/registerIpc.ts) 第 26 行 不允许该值。
- [src/shared/schemas/run.ts](../src/shared/schemas/run.ts) 第 44–50 行 payload 是 unknown；[src/main/ipc/registerIpc.ts](../src/main/ipc/registerIpc.ts) 第 6–8,24–26 行 自建 Schema，部分输入非 strict。
- [src/shared/contracts/app.ts](../src/shared/contracts/app.ts) 第 1–3 行 仅 createDemo；[src/preload/index.ts](../src/preload/index.ts) 第 8,31 行 有 getMessages 和推导 API，未显式满足共享契约。

以上源码与原始 README 证据来自基线 `135bf82c6462ade6dd5300717d6f0102ce4a660c`；治理文档引用指向 R00 文件。行号不代表当前 README 的更新位置。未声明本任务测试已经通过，执行时须重新核对基线和函数。

## 范围与明确不做

统一输入、输出、错误和判别事件；正式 Provider 契约、房间/成员/设置/上下文/工作流扩展规则与兼容版本；登记 owner 表与 migration 申请流程。仅提供后续必需协议，不宣称后续实现存在。

明确不做：不实现 Provider 网络调用、房间 CRUD、调度、产物、UI、备份或迁移业务数据；不复制第二份接口，不冻结无人消费的额外框架。

## 前置与必读

R01 已由总控合入并验收；R02 获实施授权。

每个执行线程先读 [AGENTS](../AGENTS.md)、[SPEC](../SPEC.md)、[CONTRACTS](../docs/CONTRACTS.md)、[DECISIONS](../docs/DECISIONS.md)、[STATUS](../docs/STATUS.md)、[VALIDATION](../docs/VALIDATION.md)；重新检查 Git 状态、真实文件和依赖提交。具体 wire shape 以总控已合入的 Shared 为准，本文不冻结第二套协议。

## 文件归属

下列路径均相对仓库根；现存/拟新增以原始 `135bf82` 为准，拟新增路径尚不是已实现能力。共享文件由总控实施接线，不属于子项目自由修改范围。

| 状态 | 路径 | 写入负责人 | 责任 |
| --- | --- | --- | --- |
| 现存（135bf82） | src/shared/contracts/**；src/shared/types/**；src/shared/schemas/**；src/main/providers/types.ts | 总控（R02） | 共享协议唯一写入者 |
| 现存（135bf82） | src/main/ipc/registerIpc.ts；src/preload/index.ts；src/main/services/RunService.ts；src/renderer/env.d.ts | 总控（R02 接线） | 替换重复定义、连接 schema；保持现有行为边界 |
| 拟新增 | src/shared/contracts/provider.ts；src/shared/schemas/provider.ts；tests/unit/contracts/** | 总控（R02） | Provider/能力/分级测试/错误契约及编译/运行 fixture |
| R00 已建立（原基线新增） | docs/CONTRACTS.md；docs/DECISIONS.md | 总控 | 协议变更、归属和兼容策略登记 |
| 拟新增 | tasks/README.md | 总控 | 协议变更、归属和兼容策略登记 |

## Worktree 可独立与可并行

可独立 codex/r02-contracts Worktree；与 R01 串行。共享文件由本轮用户授权的 R02 主代理单一写入，不拆给多线程；协作代理仅只读审查。R17 仅在本任务接口合入后单独获授权才可创建 E2E 骨架。

## 共享依赖与接线规则

明确每个 wire shape、错误码/可重试性、状态与 requestId 语义。尚未实现的命令返回明确 unsupported，不留下类型允许但运行拒绝的静默漂移。后续模块新增字段/事件也先经总控更新本登记，再消费。

子项目提供契约需求、调用方、兼容性、migration/版本、测试与安全影响；总控先合入共享变化再允许消费。一份文件仅一个写入人，不用分支隔离掩盖同文件争用。共享迁移、IPC/Preload 注册、Main/App 组装及 package/lock 归总控；R04 负责 RunService 状态机模块；R06 阶段由总控登记唯一负责人完成状态拆分/store，之后 App 公共组装由总控维护；后继模块只提交接线申请。

## 实施步骤

- [x] 列出现有重复、漂移和受影响调用方，建立协议 fixture。
- [x] 总控实现共享 schema/type/契约和现有消费接线。
- [x] 运行正负输入、响应、事件和 Provider 契约测试。
- [x] 登记固定文件归属、迁移规则和后续扩展流程，交付公共接口基线。

## 详细验收

- [x] StartRunInput、恢复决策、Room DTO 和 API 没有重复事实来源；Preload 编译期满足完整共享契约。
- [x] IPC 输入严格验证；响应和事件以公共 Schema 校验；非法 payload 不直接进入 Renderer。
- [x] RunEvent 按 type 判别，runId/turnId/requestId/sequence 关系明确；未知/版本不兼容事件可触发安全重同步。
- [x] Provider 契约覆盖 listModels、分级 testConnection、streamChat 和 start/text_delta/reasoning_summary_delta/usage/finish/error；Main requestId、输出上限、AbortSignal 可传递。
- [x] 明文 Key 不属于普通 DTO；配置仅含引用/状态，错误脱敏；Shared 不依赖 Electron/SDK/DB。
- [x] 文件归属准确到单文件或不重叠子目录，明确 RunService/stateMachine→R04、App/store→R06；migration 编号仅总控分配。

## 具体测试情景

| 情景 | 操作/输入 | 必须观察的结果 |
| --- | --- | --- |
| 恢复决策一致 | 对所有已批准决策遍历 schema/preload/handler | 一致接受或显式 unsupported；无编译/runtime 分歧 |
| 额外参数与错误类型 | 输入未知字段、负 cursor、空 ID、错误 enum | 统一拒绝且错误可定位，不返回敏感堆栈/Key |
| 事件判别 | turn_started/text_delta/finish/error 的有效与畸形 fixture | 正确类型接受，错 payload/ID 关系拒绝 |
| Provider 协议 | Mock 与未来 Provider compile fixture | 同一接口可替换，不使用 SDK 原始对象跨 IPC |
| 边界污染 | Shared import 检查与 Renderer build | 无 Electron、SDK、SQLite 运行依赖进入 Shared/Renderer |

pnpm run test -- tests/unit/contracts；pnpm run typecheck；pnpm run build。保留原有 Mock 行为检查，不以契约 PASS 宣称业务功能实现。

依照 [VALIDATION](../docs/VALIDATION.md) 记录真实结果。未运行、失败、条件性验证分别说明；不得把静态证据、Mock、构建或截图互相替代。

## 交付格式

交付包含：任务 ID 与基线/分支；逐项文件清单；行为和操作说明；精确测试命令、日期、退出码、关键输出与未运行项；契约申请和数据库影响；遗留问题；本模块 Commit SHA；总控接线与集成建议。只提交本任务获准文件，不向 main 自行合并。总控集成后复验才更新 merged/verified。

## 本轮实施与最小兼容接线（2026-10-14）

按既有任务书执行 Schema/fixture → IPC/Preload → Provider/RunService → 治理/回归/提交的步骤，不另建功能路线。源文件唯一写入人为 R02 主代理，范围和 R02-CONSUMER-01 的 App 一行修复见 [契约登记](../docs/CONTRACTS.md)。既有五份测试文件只更新新协议 fixture，保留原 133 项测试，并新增 Renderer 控制标记消费回归；新增 tests/unit/contracts 六份测试覆盖 DTO、IPC、Preload、Provider、持久化适配与层依赖。

验收结论必须读取 [本轮验证与完整交接](../docs/verification/2026-10-14-r02-contracts.md)，尤其 Node ObjectWrap 原生构建环境失败与隔离头文件绕法，不能只看复选框或历史 PASS。未来 R03 状态应由总控合入 R02 并完成新鲜复验后更新；本轮停止在 R02 提交边界。
