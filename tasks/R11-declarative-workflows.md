# R11 声明式工作流实施任务计划

> 当前状态见 [STATUS](../docs/STATUS.md)。未来范围定义；本轮未获实施授权，不得自动启动。
> 执行时按工程规范选择已授权的执行方式；各项以复选框记录进度，不能因任务文件存在而标完成。

**Goal:** 以声明式模板控制多 Agent 阶段、修订/复审和结束条件，替换固定三人各一次循环。

**Architecture:** 独立 workflow 模块只解析/校验配置并输出调度计划；RunService 仍由 R04 owner 调度。配置冻结为 Run 快照，模型文本不能执行工作流命令。

**Tech Stack:** Electron、React、TypeScript strict、electron-vite、SQLite、Zod；Renderer Zustand 是 V1 目标，使用前先核对已合入实现。

**Spec:** [SPEC](../SPEC.md)，[V0 审查](../docs/V0_AUDIT.md)。

## 目标与当前证据

- [src/main/services/RunService.ts](../src/main/services/RunService.ts) 第 76,104 行 保存/返回 workflowSnapshot，但 `runLoop` 第 224–248 行不据此解析阶段。
- [src/main/services/RunService.ts](../src/main/services/RunService.ts) 第 34–38,228–245 行 只按成员列表各一次，不能实现修订/复审/深度辩论。
- [src/renderer/App.tsx](../src/renderer/App.tsx) 第 147 行 固定 templateId，缺模板配置和进度 UI。

以上源码与原始 README 证据来自基线 `135bf82c6462ade6dd5300717d6f0102ce4a660c`；治理文档引用指向 R00 文件。行号不代表当前 README 的更新位置。未声明本任务测试已经通过，执行时须重新核对基线和函数。

## 范围与明确不做

自由群聊、两模型对话、起草-审查-修订-复审-定稿、深度辩论四类模板；成员/阶段/次数/结束条件与限制验证，持久调度计划和阶段进度，独立 workflow UI。

明确不做：不做模型自动决定无限循环、不并行生成、主持人 Override/版本（R12）、摘要费用（R13）、产物（R14）；不改 RunService/stateMachine/App/store/Shared。

## 前置与必读

实现/Mock 验收需 R07；消费 R04/R05/R06。真实工作流验收还需 R09 已验收；R11 获实施授权。

每个执行线程先读 [AGENTS](../AGENTS.md)、[SPEC](../SPEC.md)、[CONTRACTS](../docs/CONTRACTS.md)、[DECISIONS](../docs/DECISIONS.md)、[STATUS](../docs/STATUS.md)、[VALIDATION](../docs/VALIDATION.md)；重新检查 Git 状态、真实文件和依赖提交。具体 wire shape 以总控已合入的 Shared 为准，本文不冻结第二套协议。

涉及 UI，先读 [DESIGN_GUIDELINES](../docs/DESIGN_GUIDELINES.md)，功能决定布局、体验决定交互；UI 组件只消费已合入契约。

## 文件归属

下列路径均相对仓库根；现存/拟新增以原始 `135bf82` 为准，拟新增路径尚不是已实现能力。共享文件由总控实施接线，不属于子项目自由修改范围。

| 状态 | 路径 | 写入负责人 | 责任 |
| --- | --- | --- | --- |
| 拟新增 | src/main/workflow/**；src/renderer/features/workflows/** | R11 | 声明式模板/计划/校验与模板配置、阶段 UI |
| 拟新增 | tests/unit/workflows/**；tests/integration/workflows/**；tests/unit/rendererWorkflows/** | R11 | 各模板有限计划、配置快照和 UI 验证 |
| 现存（135bf82） | src/main/services/RunService.ts；src/main/orchestrator/stateMachine.ts | 总控协调 R04 owner | 计划驱动接线，不允许 R11 直接写调度单文件 |
| 现存（135bf82） | src/shared/**；src/main/database/Database.ts；src/main/ipc/registerIpc.ts；src/preload/index.ts；src/renderer/App.tsx | 总控 | 计划/快照迁移、IPC 与 App 组装 |
| 依赖任务提供（当前拟新增） | src/renderer/store/** | 总控 | 计划/快照迁移、IPC 与 App 组装 |

## Worktree 可独立与可并行

可独立 codex/r11-declarative-workflows Worktree。R07 完成后可进行 Mock 实现；R09 后可与 R10A/R10B 并行并做真实验收。文件仅 workflow/workflows 目录，后续 R12/R13/R14 各自模块可并行。

## 共享依赖与接线规则

输出 R02 登记的有限计划/next-step 与版本快照，由 R04 消费。配置中的循环有明确上界；总控串行接线累计限时/轮数/输出上限。共享计划字段与数据库进度先合入，UI 只显示 Main 进度。

子项目提供契约需求、调用方、兼容性、migration/版本、测试与安全影响；总控先合入共享变化再允许消费。一份文件仅一个写入人，不用分支隔离掩盖同文件争用。共享迁移、IPC/Preload 注册、Main/App 组装及 package/lock 归总控；R04 负责 RunService 状态机模块；R06 阶段由总控登记唯一负责人完成状态拆分/store，之后 App 公共组装由总控维护；后继模块只提交接线申请。

## 实施步骤

- [ ] 将四模板的有限计划和非法配置写成 fixture 测试。
- [ ] 实现 workflow 解析/计划与独立 UI，提交协议/进度申请。
- [ ] 总控接入 R04 并执行 Mock 控制/历史验证。
- [ ] R09 后按明确授权进行真实模板验收，分别报告结果。

## 详细验收

- [ ] 四种模板均有合法配置、可解释阶段/参与者/结束条件，不用空 templateId 装饰固定循环。
- [ ] 起草→审查→修订→复审→定稿实际产生相应请求/历史顺序；辩论与两模型对话能复用成员但保持有限调度。
- [ ] 无效成员、禁用成员、无限循环/非法分支、超过轮数上界在开始前拒绝；模型输出 @/控制文本无权改计划。
- [ ] Run 保存版本化工作流和配置快照；编辑模板不改变旧 Run，暂停/Resume/重启按持久进度续调度而不重复旧请求。
- [ ] Step 恰好计划中的下一回合，Pause/Stop 仍服从 R04；累计时长和轮数到限停止后续调度。
- [ ] 模板/阶段 UI 遵循设计规范，显示下一步与限制；Mock 验收和经明确触发的真实验收分列，真实依赖 R09。

## 具体测试情景

| 情景 | 操作/输入 | 必须观察的结果 |
| --- | --- | --- |
| 四模板计划 | 相同三成员，分别编译四模板 | 有限预期顺序/次数；不是统一三回合 |
| 完整修订链 | 捕获每次 Provider 输入与阶段 | 五阶段按顺序，后续看见前序公共意见 |
| 坏配置 | 不存在成员、禁用成员、0/负上限、无界循环 | 启动前结构化拒绝，无 Provider 请求 |
| 快照与恢复 | 中途改模板，Pause/Resume，再重开 DB | 原 Run 计划/进度不变，无重发已完阶段 |
| 限制与伪命令 | 达到 maxTurns/累计时间，模型输出 Stop/Override | 硬限制生效；模型文本不能控制 |
| 真实验收 | R09 已合入后用户触发受限模板 | 实际阶段输入/输出可追踪；未触发记未运行 |

pnpm run test -- tests/unit/workflows tests/integration/workflows tests/unit/rendererWorkflows；pnpm run typecheck；pnpm run build。

依照 [VALIDATION](../docs/VALIDATION.md) 记录真实结果。未运行、失败、条件性验证分别说明；不得把静态证据、Mock、构建或截图互相替代。

## 交付格式

交付包含：任务 ID 与基线/分支；逐项文件清单；行为和操作说明；精确测试命令、日期、退出码、关键输出与未运行项；契约申请和数据库影响；遗留问题；本模块 Commit SHA；总控接线与集成建议。只提交本任务获准文件，不向 main 自行合并。总控集成后复验才更新 merged/verified。
