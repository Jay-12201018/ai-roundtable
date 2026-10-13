# R12 主持人指令与消息版本实施任务计划

> 当前状态见 [STATUS](../docs/STATUS.md)。未来范围定义；本轮未获实施授权，不得自动启动。
> 执行时按工程规范选择已授权的执行方式；各项以复选框记录进度，不能因任务文件存在而标完成。

**Goal:** 让主持人能点名下一位、插话、维护持续指令和修改/重生指定消息，同时保留完整版本与分支证据。

**Architecture:** 独立 host 模块接收可信 IPC 命令，生成下一调度/上下文变更请求；R04/R11 owner 落实调度，R05 owner 落实上下文。版本关系持久化，原消息不可静默覆盖。

**Tech Stack:** Electron、React、TypeScript strict、electron-vite、SQLite、Zod；Renderer Zustand 是 V1 目标，使用前先核对已合入实现。

**Spec:** [SPEC](../SPEC.md)，[V0 审查](../docs/V0_AUDIT.md)。

## 目标与当前证据

- [src/main/services/RunService.ts](../src/main/services/RunService.ts) 第 195–221 行 retry/continue 仍抛错，尚无可信 Override/插话/持续指令。
- [src/main/database/Database.ts](../src/main/database/Database.ts) 第 121,293–313 行 预留 parent_version_id，但存取 DTO/方法没有版本链功能。
- [src/renderer/App.tsx](../src/renderer/App.tsx) 第 162–198 行 只有 Run 控制，缺主持人消息、点名和指定消息操作。

以上源码与原始 README 证据来自基线 `135bf82c6462ade6dd5300717d6f0102ce4a660c`；治理文档引用指向 R00 文件。行号不代表当前 README 的更新位置。未声明本任务测试已经通过，执行时须重新核对基线和函数。

## 范围与明确不做

可信 @Override 下一位、主持人插话/持续指令、编辑/重生指定消息、版本/分支浏览与有效上下文选择；显式重试/续写 UI 与请求尝试追踪，重复命令防护。

明确不做：不抢占当前回合、不让模型文本执行命令、不静默覆盖历史、不自动付费重试；不改 RunService/workflow/context/App/store，不做产物和导出。

## 前置与必读

R11 有限工作流和持久进度已合入；R04/R05/R06 接口可消费；R12 获实施授权。

每个执行线程先读 [AGENTS](../AGENTS.md)、[SPEC](../SPEC.md)、[CONTRACTS](../docs/CONTRACTS.md)、[DECISIONS](../docs/DECISIONS.md)、[STATUS](../docs/STATUS.md)、[VALIDATION](../docs/VALIDATION.md)；重新检查 Git 状态、真实文件和依赖提交。具体 wire shape 以总控已合入的 Shared 为准，本文不冻结第二套协议。

涉及 UI，先读 [DESIGN_GUIDELINES](../docs/DESIGN_GUIDELINES.md)，功能决定布局、体验决定交互；UI 组件只消费已合入契约。

## 文件归属

下列路径均相对仓库根；现存/拟新增以原始 `135bf82` 为准，拟新增路径尚不是已实现能力。共享文件由总控实施接线，不属于子项目自由修改范围。

| 状态 | 路径 | 写入负责人 | 责任 |
| --- | --- | --- | --- |
| 拟新增 | src/main/host/**；src/renderer/features/host/** | R12 | 可信主持人操作、版本服务和点名/指令/版本 UI |
| 拟新增 | tests/unit/host/**；tests/integration/host/**；tests/unit/rendererHost/** | R12 | 权限、排队、版本分支和 UI |
| 现存（135bf82） | src/shared/**；src/main/database/Database.ts；src/main/ipc/registerIpc.ts；src/preload/index.ts | 总控 | 命令/版本契约、migration 和 IPC |
| 现存（135bf82） | src/main/services/RunService.ts；src/renderer/App.tsx | 总控协调 R04/R11/R05/R06 owner | 调度、上下文与 feature 组装；R12 只申请接线 |
| 依赖任务提供（当前拟新增） | src/main/workflow/**；src/main/context/**；src/renderer/store/** | 总控协调 R04/R11/R05/R06 owner | 调度、上下文与 feature 组装；R12 只申请接线 |

## Worktree 可独立与可并行

可独立 codex/r12-host-message-versions Worktree，与 R13/R14 并行，host/** 与 usage/artifact 目录不重叠。版本/摘要/产物来源共享字段先由总控合入；调度/上下文接线串行。

## 共享依赖与接线规则

登记可信命令与有效消息版本/分支选择，不以文本识别主持人权限。Override 的优先级、一次性消费和禁用成员处理先在 CONTRACTS/DECISIONS 明确；总控接线 R04/R11 next step 与 R05 active branch。

子项目提供契约需求、调用方、兼容性、migration/版本、测试与安全影响；总控先合入共享变化再允许消费。一份文件仅一个写入人，不用分支隔离掩盖同文件争用。共享迁移、IPC/Preload 注册、Main/App 组装及 package/lock 归总控；R04 负责 RunService 状态机模块；R06 阶段由总控登记唯一负责人完成状态拆分/store，之后 App 公共组装由总控维护；后继模块只提交接线申请。

## 实施步骤

- [ ] 写可信来源、下一位排队和版本链行为测试。
- [ ] 实现 host 服务/独立 UI，申请版本 migration 和命令协议。
- [ ] 总控接入调度/context 与下游引用失效通知。
- [ ] 验证分支/重试/输入法和重启，交付可追踪实例。

## 详细验收

- [ ] 主持人 @Override 仅来自可信 UI/IPC，排到当前回合之后下一位，反馈可见；普通 Agent 文本相同字样没有作用。
- [ ] 插话作为可追踪主持人消息进入公共历史；持续指令有显式生效/修改/清除状态，影响后续回合而不改已开始请求。
- [ ] 指定消息编辑/重生创建新版本和请求尝试，原文/partial/失败仍可查看；版本父子和分支有效性可追踪。
- [ ] 修订早期消息后对下游消息/摘要/产物明确标记受影响，不把旧后续输出伪装基于新版本；有效分支输入规则确定。
- [ ] 中断/取消/失败重试显式触发，旧 requestId 不复用，不自动重发；权限与状态不允许时返回明确错误。
- [ ] UI 显示下一位、指令状态、版本关系及受影响分支；键盘/中文输入法、pending 防重入与 Main 状态一致。

## 具体测试情景

| 情景 | 操作/输入 | 必须观察的结果 |
| --- | --- | --- |
| 可信点名 | 回合中主持人选择 C，Agent 回复也含 @Override B | 当前回合不停；下一位 C；Agent 文本无效 |
| 指令生效时点 | 流中添加/清除持续指令 | 当前请求输入不变，下一回合使用批准的新状态 |
| 消息重生 | 重生失败/aborted 消息与编辑已完消息 | 新版本/尝试和 requestId；原文不覆盖 |
| 旧分支后果 | 编辑第 1 条，已有第 2/3 条及摘要/产物 | 下游引用可追溯且失效/分支状态明确 |
| 坏引用/重复操作 | 跨房间 messageId、禁用 Agent、连点同操作 | 结构化拒绝/一次排队，无跨房间修改 |
| 重启版本 | 临时 DB 写多分支后重开 | 版本关系/当前选择/partial 保持，零自动 Provider 请求 |

pnpm run test -- tests/unit/host tests/integration/host tests/unit/rendererHost；pnpm run typecheck；pnpm run build。

依照 [VALIDATION](../docs/VALIDATION.md) 记录真实结果。未运行、失败、条件性验证分别说明；不得把静态证据、Mock、构建或截图互相替代。

## 交付格式

交付包含：任务 ID 与基线/分支；逐项文件清单；行为和操作说明；精确测试命令、日期、退出码、关键输出与未运行项；契约申请和数据库影响；遗留问题；本模块 Commit SHA；总控接线与集成建议。只提交本任务获准文件，不向 main 自行合并。总控集成后复验才更新 merged/verified。
