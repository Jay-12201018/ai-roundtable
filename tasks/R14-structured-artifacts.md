# R14 结构化产物实施任务计划

> 当前状态见 [STATUS](../docs/STATUS.md)。未来范围定义；本轮未获实施授权，不得自动启动。
> 执行时按工程规范选择已授权的执行方式；各项以复选框记录进度，不能因任务文件存在而标完成。

**Goal:** 把 PRD、会议纪要、行动清单和代码候选转为经 Zod 验证、可追踪版本的独立产物。

**Architecture:** 独立 artifact 模块解析与校验模型候选，持久保存来源、版本和 validationStatus；Run 完成不等于产物有效。代码候选仅预览，文件写盘归 R15。

**Tech Stack:** Electron、React、TypeScript strict、electron-vite、SQLite、Zod；Renderer Zustand 是 V1 目标，使用前先核对已合入实现。

**Spec:** [SPEC](../SPEC.md)，[V0 审查](../docs/V0_AUDIT.md)。

## 目标与当前证据

- [src/main/database/Database.ts](../src/main/database/Database.ts) 第 51–154 行 基线没有 artifact 表；[src/shared/types/run.ts](../src/shared/types/run.ts) 第 56–75 行 只定义消息与 Run 快照。
- [src/renderer/App.tsx](../src/renderer/App.tsx) 第 185–198 行 仅原文消息与运行控制，无产物预览/来源状态。
- [src/main/providers/mock/MockProvider.ts](../src/main/providers/mock/MockProvider.ts) 第 25–28 行 固定文本没有结构化成果，不能作 Zod 产物验收。

以上源码与原始 README 证据来自基线 `135bf82c6462ade6dd5300717d6f0102ce4a660c`；治理文档引用指向 R00 文件。行号不代表当前 README 的更新位置。未声明本任务测试已经通过，执行时须重新核对基线和函数。

## 范围与明确不做

PRD、会议纪要、行动清单、代码候选四种 schema/候选生成与校验；关联 room/run/消息版本、产物版本/状态；失败错误定位、预览、结构化文本/JSON 导出准备。

明确不做：不自动写生成代码、不执行代码、不用宽松 unknown schema 伪验证；不改工作流/RunService/host/usage/App/store；不做真实请求的自动修复重试。

## 前置与必读

R11 声明式阶段已合入；R02 契约可扩展；R14 获实施授权。消费 R12 版本关联时等其契约先合入。

每个执行线程先读 [AGENTS](../AGENTS.md)、[SPEC](../SPEC.md)、[CONTRACTS](../docs/CONTRACTS.md)、[DECISIONS](../docs/DECISIONS.md)、[STATUS](../docs/STATUS.md)、[VALIDATION](../docs/VALIDATION.md)；重新检查 Git 状态、真实文件和依赖提交。具体 wire shape 以总控已合入的 Shared 为准，本文不冻结第二套协议。

涉及 UI，先读 [DESIGN_GUIDELINES](../docs/DESIGN_GUIDELINES.md)，功能决定布局、体验决定交互；UI 组件只消费已合入契约。

## 文件归属

下列路径均相对仓库根；现存/拟新增以原始 `135bf82` 为准，拟新增路径尚不是已实现能力。共享文件由总控实施接线，不属于子项目自由修改范围。

| 状态 | 路径 | 写入负责人 | 责任 |
| --- | --- | --- | --- |
| 拟新增 | src/main/artifact/**；src/renderer/features/artifacts/** | R14 | 候选解析/校验服务、来源版本与预览 UI |
| 拟新增 | tests/unit/artifacts/**；tests/integration/artifacts/**；tests/unit/rendererArtifacts/** | R14 | 四类结构、来源/版本、失败与 UI fixtures |
| 拟新增 | src/shared/schemas/artifact.ts；src/shared/contracts/artifact.ts | 总控 | 共享 schema/DTO、migration 与 IPC |
| 现存（135bf82） | src/main/database/Database.ts；src/main/ipc/registerIpc.ts；src/preload/index.ts | 总控 | 共享 schema/DTO、migration 与 IPC |
| 依赖任务提供（当前拟新增） | src/main/workflow/**；src/renderer/store/** | 总控协调相应 owner | 成果阶段与 features 组装 |
| 现存（135bf82） | src/main/services/RunService.ts；src/renderer/App.tsx | 总控协调相应 owner | 成果阶段与 features 组装 |

## Worktree 可独立与可并行

可独立 codex/r14-structured-artifacts Worktree，与 R12/R13 并行；只 artifact/artifacts 与自身测试。版本/摘要来源字段的公共协议先合入。R15 依赖产物 schema 后再实施，不并发编辑 artifact 模块。

## 共享依赖与接线规则

总控批准四类具体 schema、来源版本/validationStatus 和错误 DTO。工作流产物阶段通过显式调用生成候选；解析失败保留原候选，不覆盖原消息。R15 只消费 validated code candidate 和预览输入。

子项目提供契约需求、调用方、兼容性、migration/版本、测试与安全影响；总控先合入共享变化再允许消费。一份文件仅一个写入人，不用分支隔离掩盖同文件争用。共享迁移、IPC/Preload 注册、Main/App 组装及 package/lock 归总控；R04 负责 RunService 状态机模块；R06 阶段由总控登记唯一负责人完成状态拆分/store，之后 App 公共组装由总控维护；后继模块只提交接线申请。

## 实施步骤

- [ ] 登记四类 schema 需求并建立正负 fixtures。
- [ ] 实现 artifact 模块/预览与版本状态，申请 migration/IPC。
- [ ] 总控接入工作流成果阶段和来源版本通知。
- [ ] 验证失败保留/重启/安全预览，交付 R15 消费接口。

## 详细验收

- [ ] 四类具体 schema 有必填/类型/枚举/长度/数量约束，Zod 真实验证；不以 JSON 能 parse 代替结构通过。
- [ ] PRD 的需求/验收、纪要的结论/决策、行动项的责任/状态、代码候选的路径/内容有明确结构；未知负责人等用显式未知而不臆造。
- [ ] 候选/草稿/校验失败/有效/已导出状态区分；错误定位到字段，失败保留原始候选且不能确认代码写盘。
- [ ] 每产物关联来源 room/run/消息版本和自身版本；重生创建新版，来源历史修订后可追踪受影响状态。
- [ ] UI 能预览结构、来源、版本、错误；安全渲染模型内容，长产物有返回聊天与阅读位置。
- [ ] 临时 DB 重开后产物/版本/状态完整；导出内容不带 Key/内部上下文/私有推理。
- [ ] 代码候选没有文件系统副作用或执行，向 R15 交付明确受校验数据与状态接口。

## 具体测试情景

| 情景 | 操作/输入 | 必须观察的结果 |
| --- | --- | --- |
| 四类正负例 | 合法 fixture 与缺字段/错类型/超限/畸形 JSON | 只合法通过；错误字段可定位 |
| 未知事实 | 未提供负责人/截止时间/需求来源 | 保留未知，不编造个人/期限 |
| 失败保留 | 候选校验失败→人工/显式重生 | 原候选可查，新版本不覆旧；零自动付费重试 |
| 来源关系 | 跨 Run 来源、删除/改版消息 | 拒绝非法引用；旧版本可追踪并标受影响 |
| 预览安全 | Markdown/HTML/script/长代码内容 | 不执行；状态和内容可读 |
| 写盘边界 | 生成 code candidate 后检查临时目录 | 未确认前零写文件，提供给 R15 的 validated DTO 正确 |

pnpm run test -- tests/unit/artifacts tests/integration/artifacts tests/unit/rendererArtifacts；pnpm run typecheck；pnpm run build。

依照 [VALIDATION](../docs/VALIDATION.md) 记录真实结果。未运行、失败、条件性验证分别说明；不得把静态证据、Mock、构建或截图互相替代。

## 交付格式

交付包含：任务 ID 与基线/分支；逐项文件清单；行为和操作说明；精确测试命令、日期、退出码、关键输出与未运行项；契约申请和数据库影响；遗留问题；本模块 Commit SHA；总控接线与集成建议。只提交本任务获准文件，不向 main 自行合并。总控集成后复验才更新 merged/verified。
