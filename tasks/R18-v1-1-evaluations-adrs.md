# R18 V1.1 评测与 ADR 决策追踪实施任务计划

> 当前状态见 [STATUS](../docs/STATUS.md)。未来范围定义；本轮未获实施授权，不得自动启动。
> 执行时按工程规范选择已授权的执行方式；各项以复选框记录进度，不能因任务文件存在而标完成。

**Goal:** 以可追溯决策和三组基线评测判断多模型协作的价值，并审查是否值得启用动态复审。

**Architecture:** 独立 evaluations 模块记录统一任务/版本/配置下的质量、时长、成本和人工介入；ADR 引用消息/证据/采纳理由。动态复审是受限可选策略，仍由既有工作流/调度 owner 接线。

**Tech Stack:** Electron、React、TypeScript strict、electron-vite、SQLite、Zod；Renderer Zustand 是 V1 目标，使用前先核对已合入实现。

**Spec:** [SPEC](../SPEC.md)，[V0 审查](../docs/V0_AUDIT.md)。

## 目标与当前证据

- `SPEC.md` 的 V1.1 列明争议/ADR、动态复审和三组基线，属于 V1 稳定后的可选差异化。
- [src/main/services/RunService.ts](../src/main/services/RunService.ts) 第 224–248 行 基线仅固定循环，当前没有评测协议/决策产物。
- [src/main/database/Database.ts](../src/main/database/Database.ts) 第 51–154 行 基线无评测/ADR 表；现有测试不能证明多模型质量优于单模型。

以上源码与原始 README 证据来自基线 `135bf82c6462ade6dd5300717d6f0102ce4a660c`；治理文档引用指向 R00 文件。行号不代表当前 README 的更新位置。未声明本任务测试已经通过，执行时须重新核对基线和函数。

## 范围与明确不做

来源消息/版本、观点/证据/最终理由的 ADR；单模型/单模型自评/多模型辩论三组同任务评测；质量人工评分、时长/估算成本/人工介入/失败率；可控动态复审实验与报告。

明确不做：不承诺多模型必然更优、不自动做付费批量评测、不补 V1 缺口、不加入云/自主终端/无限循环；不修改 RunService/workflow/App/store、V1冻结契约或未经批准模型。

## 前置与必读

R17 最终 V1 验收经总控确认；用户明确选择并授权 V1.1 可选范围。V1 未完成不得提前实施。

每个执行线程先读 [AGENTS](../AGENTS.md)、[SPEC](../SPEC.md)、[CONTRACTS](../docs/CONTRACTS.md)、[DECISIONS](../docs/DECISIONS.md)、[STATUS](../docs/STATUS.md)、[VALIDATION](../docs/VALIDATION.md)；重新检查 Git 状态、真实文件和依赖提交。具体 wire shape 以总控已合入的 Shared 为准，本文不冻结第二套协议。

## 文件归属

下列路径均相对仓库根；现存/拟新增以原始 `135bf82` 为准，拟新增路径尚不是已实现能力。共享文件由总控实施接线，不属于子项目自由修改范围。

| 状态 | 路径 | 写入负责人 | 责任 |
| --- | --- | --- | --- |
| 拟新增 | src/main/evaluations/**；src/renderer/features/evaluations/** | R18 | 评测计划/结果/ADR引用与比较 UI |
| 拟新增 | tests/unit/evaluations/**；tests/integration/evaluations/**；tests/fixtures/evaluations/** | R18 | 确定基线、公平配置、失败/评分/来源 fixture |
| 拟新增 | docs/evaluations/**；docs/adrs/** | R18 | 评测协议、实际报告和带版本证据的决策记录 |
| 拟新增 | src/shared/contracts/evaluations.ts；src/shared/schemas/evaluations.ts | 总控 | V1.1扩展协议、migration与IPC |
| 现存（135bf82） | src/main/database/Database.ts；src/main/ipc/registerIpc.ts；src/preload/index.ts | 总控 | V1.1扩展协议、migration与IPC |
| 依赖任务提供（当前拟新增） | src/main/workflow/**；src/renderer/store/** | 总控协调原 owner | 可选复审策略及入口，保持V1兼容 |
| R00 已建立（原基线新增） | docs/DECISIONS.md | 总控协调原 owner | 可选复审策略及入口，保持V1兼容 |
| 现存（135bf82） | src/main/services/RunService.ts；src/renderer/App.tsx | 总控协调原 owner | 可选复审策略及入口，保持V1兼容 |

## Worktree 可独立与可并行

可独立 codex/r18-v1-1-evaluations-adrs Worktree，须 R17 最终验收后单独授权；ADR/评测 fixture可在同任务内按文件拆分，不与 V1 修复或工作流 owner 同文件并发。

## 共享依赖与接线规则

总控批准实验协议、预算/停止条件、评分方法和 V1.1 扩展。三组基线按共同任务集/模型版本/限制记录区别，真实付费实验由用户明确触发；动态复审输出有限计划请求，不自行操纵 RunService。

子项目提供契约需求、调用方、兼容性、migration/版本、测试与安全影响；总控先合入共享变化再允许消费。一份文件仅一个写入人，不用分支隔离掩盖同文件争用。共享迁移、IPC/Preload 注册、Main/App 组装及 package/lock 归总控；R04 负责 RunService 状态机模块；R06 阶段由总控登记唯一负责人完成状态拆分/store，之后 App 公共组装由总控维护；后继模块只提交接线申请。

## 实施步骤

- [ ] 先记录R17最终V1验收引用与V1.1独立授权。
- [ ] 制定固定任务集/评分/资源/预算协议，写三基线与ADR fixtures。
- [ ] 实现独立评测/ADR模块，总控接线有限复审可选策略。
- [ ] 执行fixture与明确授权实验，交付可重复报告和采用/不采用依据。

## 详细验收

- [ ] 每 ADR 能追溯来源消息版本、争议双方、证据和采纳理由；来源修改/失效可识别，不用模型总结冒充事实证据。
- [ ] 三组基线用同一任务/输入/评分规则，模型/模板/参数/限额/版本可重放；不同资源与调用次数明确展示。
- [ ] 记录质量评分依据、时长、已知/估算成本、人工介入次数、失败与样本数量；未知项明确，不伪造显著性或改进结论。
- [ ] 报告既展示获益也展示无益/更差案例，能决定不启用多模型或复审；fixture证明流程而不证明真实质量优势。
- [ ] 动态复审启用/跳过条件可解释、上界明确，与人工主持人/费用/时间守卫兼容；保持既有V1模板行为可用。
- [ ] 评测与ADR重启后可查、无Key或私有推理泄漏；真实实验计划包含明确预算与停止条件且不自动执行。
- [ ] 最终交付可重复实验协议和实际证据；未授权/未运行真实实验明确标注，不把可选V1.1文档当完成功能。

## 具体测试情景

| 情景 | 操作/输入 | 必须观察的结果 |
| --- | --- | --- |
| 三基线一致 | 同fixture任务生成三组计划，捕获配置 | 任务/输入/评分同源，调用资源差异明确 |
| 失败/未知值 | 超时/取消、缺usage、人工未评分 | 无伪零成本/满分；失败进入统计 |
| 来源追踪 | ADR引用旧消息版本，再编辑/归档 | 历史证据仍可查，失效提示准确 |
| 复审边界 | 简单/复杂fixture，预算不够/轮数上限 | 按批准条件跳过或有限复审，不能绕过守卫 |
| 公平报告 | 质量更好但更慢/更贵，或多模型更差 | 同时呈现各指标，无单一片面胜利结论 |
| 授权实验 | 仅计划/取消/明确选择受限真实实验 | 未触发零网络请求，真实结果单独记录 |

pnpm run test -- tests/unit/evaluations tests/integration/evaluations；pnpm run typecheck；pnpm run build。真实评测另记用户触发、模型/费用限制与每组结果。

依照 [VALIDATION](../docs/VALIDATION.md) 记录真实结果。未运行、失败、条件性验证分别说明；不得把静态证据、Mock、构建或截图互相替代。

## 交付格式

交付包含：任务 ID 与基线/分支；逐项文件清单；行为和操作说明；精确测试命令、日期、退出码、关键输出与未运行项；契约申请和数据库影响；遗留问题；本模块 Commit SHA；总控接线与集成建议。只提交本任务获准文件，不向 main 自行合并。总控集成后复验才更新 merged/verified。
