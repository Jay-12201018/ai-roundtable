# AI Roundtable 任务索引

原始基线：main / `135bf82c6462ade6dd5300717d6f0102ce4a660c`。本文列出批准路线的 **20 个任务**（R00–R18，R10 拆为 R10A/R10B）。R00/R01 已验收，R01 已合 main；R02 已由用户在独立 Worktree 授权实施，本分支交付待总控审核，未合 main；总控状态看板保留 main 历史状态。其他任务仍是范围/归属/验收定义，不代表已启动。状态、授权和真实结果以 [STATUS](../docs/STATUS.md) 及 [R01 主线验证](../docs/verification/2026-10-13-r01-main.md) 为准，历史 R00/R01 集成记录保留。

## 入口与共同约束

每个线程先读 [AGENTS](../AGENTS.md)、[SPEC](../SPEC.md)、[CONTRACTS](../docs/CONTRACTS.md)、[DECISIONS](../docs/DECISIONS.md)、[STATUS](../docs/STATUS.md)、[VALIDATION](../docs/VALIDATION.md)，再读自己的任务文件；涉及 UI 另读 [DESIGN_GUIDELINES](../docs/DESIGN_GUIDELINES.md)。重新核对 Git 状态、依赖 Commit 和实际源码，不能假定另一聊天的状态就是本分支状态。

每份任务的源码/原始 README 行号来自 `135bf82` 静态审查；执行时须重新定位。治理文档链接指向 R00 当前文件。任务里的复选框和命令是未来验收，不表示已执行或已通过。

Main 是调度、SQLite、Key 与写盘权威；Renderer 只投影。Agent 串行生成。普通模型文本、摘要和产物没有主持人权限。自动化用 Mock/fixture；未配置 Key 或未经明确触发不能发送付费请求。中断不自动重发。代码候选仅在预览、路径校验与逐文件确认后写盘，不执行生成代码。

## 任务与依赖表

| ID / 固定文件 | 目标 | 前置 | 并行与验收门槛 |
| --- | --- | --- | --- |
| [R00-baseline-governance.md](R00-baseline-governance.md) | 基线治理与真实验证 | 无 | 已 verified；原始治理提交保留 |
| [R01-startup-lifecycle-security.md](R01-startup-lifecycle-security.md) | 启动、退出与窗口安全边界 | R00 审核 | 已合 main、主线复验后 verified |
| [R02-contracts.md](R02-contracts.md) | 统一契约与排他文件归属 | R01 | 本分支已授权实施，交付待审核；未合 main，见 R02 任务与验证记录 |
| [R03-persistence-backup-recovery.md](R03-persistence-backup-recovery.md) | 持久化、可靠备份与恢复数据 | R02 | 数据接口/迁移先合入 |
| [R04-run-turn-mock.md](R04-run-turn-mock.md) | Run/Turn 状态机与 Mock 执行 | R03 | 可与 R05/R06 并行 |
| [R05-public-context-limits.md](R05-public-context-limits.md) | 公共上下文与基本限制 | R03 | 可与 R04/R06 并行；不改 RunService |
| [R06-renderer-subscriptions.md](R06-renderer-subscriptions.md) | Renderer 状态与一致订阅 | R03 | 可与 R04/R05 并行；统一投影 |
| [R07-rooms-agents-history.md](R07-rooms-agents-history.md) | 房间、成员与公共历史 | R04/R05/R06 | 联合 Mock 验收后；可与 R08 并行 |
| [R08-key-provider-settings.md](R08-key-provider-settings.md) | Key 与 Provider 设置 | R04/R05/R06 | 联合 Mock 验收后；可与 R07 并行 |
| [R09-openai-compatible-provider.md](R09-openai-compatible-provider.md) | OpenAI 与兼容端点真实闭环 | R07/R08 | 真实调用前确认公共历史/限制/安全链路 |
| [R10A-anthropic-provider.md](R10A-anthropic-provider.md) | Anthropic Provider | R09 | 可与 R10B/R11 并行 |
| [R10B-gemini-provider.md](R10B-gemini-provider.md) | Gemini Provider | R09 | 可与 R10A/R11 并行 |
| [R11-declarative-workflows.md](R11-declarative-workflows.md) | 声明式工作流 | R07；真实验收另需 R09 | 先 Mock，再经明确触发真实验收 |
| [R12-host-message-versions.md](R12-host-message-versions.md) | 主持人指令与消息版本 | R11 | 可与 R13/R14 分模块并行 |
| [R13-summary-usage-budget.md](R13-summary-usage-budget.md) | 摘要、usage 与费用预算 | R05/R09/R11 | 可与 R12/R14 分模块并行 |
| [R14-structured-artifacts.md](R14-structured-artifacts.md) | 结构化产物 | R11 | 可与 R12/R13 分模块并行 |
| [R15-safe-code-export.md](R15-safe-code-export.md) | 安全代码导出 | R14 | 可与 R16 分目录并行 |
| [R16-chat-ui-usability.md](R16-chat-ui-usability.md) | 聊天 UI 与可用性 | R06；主要交互稳定 | 整体 UI 在房间/设置/主持人/产物等语义稳定后实施 |
| [R17-e2e-release.md](R17-e2e-release.md) | Electron E2E 与发布验收 | 骨架 R02；最终 R07–R16（含 R10A/R10B） | 骨架与最终 V1 验收分开授权/报告 |
| [R18-v1-1-evaluations-adrs.md](R18-v1-1-evaluations-adrs.md) | V1.1 评测与 ADR 决策追踪 | R17 最终 V1 验收 | V1.1 可选，须另行明确选择与授权 |

## 实施顺序与联合门槛

1. R00 → R01 → R02 → R03 串行。R01 会涉及 IPC 来源与 Preload 构建，R02 随后统一契约，不能同时写这些公共文件。
2. R03 数据/迁移接口先合入后，R04/R05/R06 可分模块并行。总控联合验收三个 Agent 的实际公共输入、限制、控制、状态投影与落库；固定 Mock 回答本身不足以证明协作。
3. R07/R08 可并行，建立可配置房间/成员与 Key/Provider 设置。真实调用前必须确认公共历史、累计时长/输出上限、来源与密钥边界。
4. R09 先完成 OpenAI/兼容端点真实接口闭环；R10A/R10B 供应商适配可与 R11 并行。R11 在 R07 后可先做 Mock；真实验收需 R09。
5. R12/R13/R14 按 host/usage/artifact 独立目录并行；R15/R16 可并行，但 R16 全面 UI 在主要交互语义稳定后实施。
6. R17 在 R02 后可单独授权建立隔离 E2E 骨架；完整 V1 验收等待 R07–R16（含两项 R10）全部合入，并核对 R01–R06 基础。骨架完成不等于 V1 发布完成。
7. R18 只有 R17 最终 V1 验收后才可考虑；评测/ADR/动态复审均为另行选择的 V1.1 范围。

ready 只表示前置满足；执行授权须用户明确给出。总控完成一项后停止在当前授权边界，不自动开始下一项。

## 排他文件归属

路径均相对仓库根；模块目录中只允许本任务已登记文件，不因目录拥有权扩展产品范围。下面的拟新增目录不是当前功能声明。

| 文件/目录 | 唯一责任 | 其他模块如何接入 |
| --- | --- | --- |
| `src/shared/**`、`src/main/providers/types.ts`、所有 migration 编号/定义 | 总控 | 提交契约/兼容性/迁移/测试/安全申请，合入后消费 |
| `src/main/database/Database.ts` | 总控协调数据负责人 | R03 建立数据基础；后续新增 repository/API 仍排队总控接线，不争同文件 |
| `src/main/ipc/registerIpc.ts`、`src/preload/index.ts`、`src/main/index.ts`、Provider registry、`src/renderer/env.d.ts` | 总控 | 单独登记唯一执行负责人和接线变更 |
| `src/main/services/RunService.ts`、`src/main/orchestrator/stateMachine.ts` | R04 负责状态机模块；总控登记唯一执行人 | R05/R11/R12/R13 只提交调度接线需求，禁止直接编辑 |
| `src/main/context/**` | R05 | R04/R13 提交输入/摘要接线申请 |
| `src/renderer/App.tsx` | R06 阶段总控登记状态拆分负责人；之后公共组装由总控维护 | 后续 UI 只交 feature 组件、props/action 需求，不修改 App |
| `src/renderer/store/**`、`src/renderer/subscriptions/**` | R06 状态模块负责人；总控协调扩展 | feature 消费已批准 selector/action，新增能力先申请 |
| `src/main/room/**`、`src/renderer/features/rooms/**` | R07 | 与 R08 settings 目录分开，公共引用先总控处理 |
| `src/main/security/**`、`src/main/settings/**`、`src/renderer/features/settings/**` | R08 | Provider 解析 Key 仅通过 Main factory |
| `src/main/providers/openai/**`、`src/main/providers/openai-compatible/**` | R09 | registry/共享协议由总控，供应商目录排他 |
| `src/main/providers/anthropic/**` / `src/main/providers/gemini/**` | R10A / R10B | 两项不改对方模块或共用 registry |
| `src/main/workflow/**`、`src/renderer/features/workflows/**` | R11 | 向 R04 请求计划消费接线 |
| `src/main/host/**`、`src/renderer/features/host/**` | R12 | 版本/下一位/上下文/来源影响由总控协调 |
| `src/main/usage/**`、`src/renderer/features/usage/**` | R13 | 摘要和预算先有共享接口，再接 R05/R04/R11 |
| `src/main/artifact/**`、`src/renderer/features/artifacts/**` | R14 | R15 只消费有效候选，不修改产物服务 |
| `src/main/export/**`、`src/renderer/features/codeExport/**` | R15 | 预览/确认/写盘分命令，文件系统只在 Main |
| `src/renderer/features/timeline/**`、`src/renderer/theme/**`、`src/renderer/components/ui/**`、`src/renderer/styles.css` | R16 | 原 feature owner 消费公共组件；同文件不并行 |
| `tests/e2e/**`、`tests/fixtures/e2e/**`、发布报告 | R17 | 业务缺陷回原 owner；启动开关/CI/脚本/打包归总控审核接线 |
| `src/main/evaluations/**`、`src/renderer/features/evaluations/**` | R18 | V1.1 独立授权，总控协调复审计划 |
| `package.json`、`pnpm-lock.yaml`、验证配置/规则、状态看板、决策与契约登记 | 总控 | 不擅自升级依赖，不自行标 merged/verified |

每任务的测试目录详见任务文件；允许修改的现有测试也逐项列出。测试不得横跨他人目录或让多个线程修改同一集成测试。公共/联合测试由总控安排一次集成验证。

## Worktree、提交与共享接线

R00 本次在 main 建立文档/治理并创建一个独立提交，是用户明确例外，不创建 Worktree，不改 src/原有测试，不启动后续任务。最新实际执行结果引用 verification，任务文件不复制硬编码测试数量。

后续任务在明确获准创建后使用独立 Worktree 和 `codex/rxx-<topic>` 分支，R10A/R10B 分开。先核对依赖已合入与 wire shape 可用；不得共享可变 node_modules、测试数据库、userData 或系统 Key，避免原生 ABI 与测试状态互相覆盖。

子项目需要公共修改时提交：任务 ID、需求、现有/拟议接口、调用方、兼容策略、migration、测试与安全影响。总控统一更新契约与迁移，再接线 Main/IPC/Preload/App。新可选字段或事件同样走此流程，不能静默复制协议。

子项目只提交获准模块/测试给总控，不能直接合 main、force push 或改写历史。提交后报告 Commit SHA 与实际命令；总控审查并合入、执行集成验证，再更新 merged/verified。一份文件只有一个写入负责人，不同分支不能消除同文件冲突。

## 统一交付格式

每项交付按以下顺序呈现：

1. 任务 ID、基线/分支/Commit SHA、文件变更清单。
2. 用户可观察行为与使用方法，关联详细验收项。
3. 精确命令、日期/平台/版本、退出码、关键输出、失败与未运行项。
4. 契约/数据/migration/安全影响；共享变化申请与已合入依赖。
5. 遗留问题、总控接线/集成建议及当前授权边界。

PASS 必须来自本次实际执行。静态审查、历史测试、fixture、真实 smoke、build、ABI、Electron E2E、打包、安装和三平台运行分别报告。缺少验证环境就说明未运行；不能把任务范围定义当完成证据。

## R02 本分支交接与文件接线

R02 唯一写入人为主代理，其他协作者仅做只读审查。基线 `b690a1e2cefb485e81b35292bfb875bd19b88a2b`，分支 `codex/r02-contracts`；没有建立第二个 Worktree。新增契约/协议测试和既有 fixture 的排他集合，以及一行 App `snapshot_required` 消费接线，详见 [R02 登记](../docs/CONTRACTS.md#r02-独立实施登记2026-10-14待总控审核未合-main)。

未来契约/migration 变更仍先提交需求、调用方、兼容性、迁移、测试与安全申请，由总控分配版本并合入，再允许模块消费；本轮没有把 R03–R18 的 ready 当实施授权。R02 [验证与完整交接](../docs/verification/2026-10-14-r02-contracts.md)独立记录本次实际命令和失败原因；总控应在自己的隔离依赖/测试数据上重新集成验证，不共享本 Worktree 的 node_modules。
