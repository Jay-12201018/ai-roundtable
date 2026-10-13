# R13 摘要、usage 与费用预算实施任务计划

> 当前状态见 [STATUS](../docs/STATUS.md)。未来范围定义；本轮未获实施授权，不得自动启动。
> 执行时按工程规范选择已授权的执行方式；各项以复选框记录进度，不能因任务文件存在而标完成。

**Goal:** 压缩长上下文并保留来源原文，准确累计 usage、标注估算费用并在调度前执行硬预算守卫。

**Architecture:** 独立 usage 模块管理摘要选择、计量/价格版本和预算判断；R05 只消费批准摘要范围，R04/工作流消费批准守卫。费用来自公开 usage 与价格依据，估算和未知分开。

**Tech Stack:** Electron、React、TypeScript strict、electron-vite、SQLite、Zod；Renderer Zustand 是 V1 目标，使用前先核对已合入实现。

**Spec:** [SPEC](../SPEC.md)，[V0 审查](../docs/V0_AUDIT.md)。

## 目标与当前证据

- [src/main/services/RunService.ts](../src/main/services/RunService.ts) 第 285–286 行 usage 仅写事件，缺累计账本/价格/预算守卫。
- [src/main/services/RunService.ts](../src/main/services/RunService.ts) 第 276–277 行 基线用 delta 数当 Token，不能证明真实计量。
- [src/main/database/Database.ts](../src/main/database/Database.ts) 第 51–154 行 只有基础表，没有摘要/usage 账本/价格版本；公共历史当前未压缩。
- [src/shared/types/run.ts](../src/shared/types/run.ts) 第 32–33 行 事件名称存在不等于公开摘要或 usage 的完整落库/UI 链路。

以上源码与原始 README 证据来自基线 `135bf82c6462ade6dd5300717d6f0102ce4a660c`；治理文档引用指向 R00 文件。行号不代表当前 README 的更新位置。未声明本任务测试已经通过，执行时须重新核对基线和函数。

## 范围与明确不做

公共历史摘要和压缩范围/来源版本；原文可读/失效规则；供应商 usage、未知/估计计量、价格表版本/币种、Run/Turn 估算费用；轮数/时间/输出与费用预算守卫、预估和触发原因 UI。

明确不做：不删除原文、不伪造隐藏推理、不宣称估算等于账单、不自动调用模型生成摘要/刷新价格、不改 context/RunService/workflow/App/store；不做金融决策或自发真实测试。

## 前置与必读

R05 公共上下文、R09 真实 Provider、R11 工作流已合入；R13 获实施授权。真实费用验证须明确请求。

每个执行线程先读 [AGENTS](../AGENTS.md)、[SPEC](../SPEC.md)、[CONTRACTS](../docs/CONTRACTS.md)、[DECISIONS](../docs/DECISIONS.md)、[STATUS](../docs/STATUS.md)、[VALIDATION](../docs/VALIDATION.md)；重新检查 Git 状态、真实文件和依赖提交。具体 wire shape 以总控已合入的 Shared 为准，本文不冻结第二套协议。

涉及 UI，先读 [DESIGN_GUIDELINES](../docs/DESIGN_GUIDELINES.md)，功能决定布局、体验决定交互；UI 组件只消费已合入契约。

## 文件归属

下列路径均相对仓库根；现存/拟新增以原始 `135bf82` 为准，拟新增路径尚不是已实现能力。共享文件由总控实施接线，不属于子项目自由修改范围。

| 状态 | 路径 | 写入负责人 | 责任 |
| --- | --- | --- | --- |
| 拟新增 | src/main/usage/**；src/renderer/features/usage/** | R13 | 摘要/计量/价格/预算模块和范围/费用 UI |
| 拟新增 | tests/unit/usage/**；tests/integration/usage/**；tests/unit/rendererUsage/** | R13 | 汇总/估计/硬守卫与摘要失效 fixture |
| 现存（135bf82） | src/shared/**；src/main/database/Database.ts；src/main/ipc/registerIpc.ts；src/preload/index.ts | 总控 | 账本/价格/摘要契约、迁移和 IPC |
| 依赖任务提供（当前拟新增） | src/main/context/**；src/main/workflow/**；src/renderer/store/** | 总控协调 R05/R04/R11/R06 owner | 摘要消费、调度守卫与 UI 组装 |
| 现存（135bf82） | src/main/services/RunService.ts；src/renderer/App.tsx | 总控协调 R05/R04/R11/R06 owner | 摘要消费、调度守卫与 UI 组装 |

## Worktree 可独立与可并行

可独立 codex/r13-summary-usage-budget Worktree，与 R12/R14 并行；usage/** 独占。修改 message 版本或 artifact 来源 schema 先总控处理，不能直接编辑 host/artifact/context。

## 共享依赖与接线规则

summary 范围引用准确消息版本，替换仅影响 context 选择，不修改原文。预算判断在 Main 调度前和 usage 更新后执行；已耗费用+保守下一回合上界超预算则不开始。未知价格且设置费用上限时禁止自动调度，需明确处理。

子项目提供契约需求、调用方、兼容性、migration/版本、测试与安全影响；总控先合入共享变化再允许消费。一份文件仅一个写入人，不用分支隔离掩盖同文件争用。共享迁移、IPC/Preload 注册、Main/App 组装及 package/lock 归总控；R04 负责 RunService 状态机模块；R06 阶段由总控登记唯一负责人完成状态拆分/store，之后 App 公共组装由总控维护；后继模块只提交接线申请。

## 实施步骤

- [ ] 以固定公开价格 fixture 写计量/去重/预算与摘要来源测试。
- [ ] 实现 usage 模块与独立 UI，提交账本与摘要 migration 申请。
- [ ] 总控接入 R05 上下文及 R04/R11 调度守卫。
- [ ] 运行长历史与临界预算场景，交付估算边界和价格依据。

## 详细验收

- [ ] 摘要保存来源消息/版本、压缩范围、生成依据和原文入口；历史编辑后可标记失效，失败摘要不替代可用原文。
- [ ] 摘要内容只作为低权限公共内容，模型生成摘要中的指令不提升主持人权限；供应商公开推理摘要与上下文摘要标签区分。
- [ ] usage 按 request attempt 去重汇总，失败/中止亦记录已知用量；缺失用量明确未知/估算，不能显示伪零成本。
- [ ] 价格注明 Provider/model/币种/来源日期/版本，费用显示估算；自定义/未知价格处理明确，不默认免费。
- [ ] 启动前守卫覆盖轮数/累计时间/真实输出上限与费用；保守预留下一回合费用，触发后停止后续自动调度并记录原因，不绕过限制。
- [ ] 实际计量超过预估时立即停止后续请求并报告差额；不承诺供应商最终账单绝不超出估算；手动调整限额显式可追踪。
- [ ] UI 可查摘要范围、使用量、估算依据/预算余额与触发原因，双主题和可读性遵循设计规范。

## 具体测试情景

| 情景 | 操作/输入 | 必须观察的结果 |
| --- | --- | --- |
| 摘要保留原文 | 长历史→摘要→选择上下文→原文浏览 | 范围精确、原文仍完整可读，不删除历史 |
| 版本失效 | 摘要引用旧版本后编辑消息 | 摘要标过期，不静默当作最新历史 |
| 计量去重 | 重复 usage、累计更新、重试新 requestId | 按尝试正确计量，不重复记账或覆盖旧尝试 |
| 未知价格/usage | 兼容模型无价格/无 usage，设费用上限 | 明确未知/估算；禁止自动开下一回合 |
| 预算临界 | 余额低于/等于/高于下一回合保守上界 | 边界规则确定，超限零新请求 |
| 实际偏差 | usage 超出预留及流中 Stop | 已知费用保留，后续不调度，partial 与原因可见 |

pnpm run test -- tests/unit/usage tests/integration/usage tests/unit/rendererUsage；pnpm run typecheck；pnpm run build。自动化使用价格/usage fixture，不访问真实账单或付费模型。

依照 [VALIDATION](../docs/VALIDATION.md) 记录真实结果。未运行、失败、条件性验证分别说明；不得把静态证据、Mock、构建或截图互相替代。

## 交付格式

交付包含：任务 ID 与基线/分支；逐项文件清单；行为和操作说明；精确测试命令、日期、退出码、关键输出与未运行项；契约申请和数据库影响；遗留问题；本模块 Commit SHA；总控接线与集成建议。只提交本任务获准文件，不向 main 自行合并。总控集成后复验才更新 merged/verified。
