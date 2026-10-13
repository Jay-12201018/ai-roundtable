# R10A Anthropic Provider实施任务计划

> 当前状态见 [STATUS](../docs/STATUS.md)。未来范围定义；本轮未获实施授权，不得自动启动。
> 执行时按工程规范选择已授权的执行方式；各项以复选框记录进度，不能因任务文件存在而标完成。

**Goal:** 在既有 Key、上下文、限制和流协议下加入 Anthropic，不把供应商差异泄漏到调度/UI。

**Architecture:** 只新增 Anthropic adapter 与独立 fixture。适配消息角色、system 内容、usage 与公开推理能力；不修改其他 Provider、RunService 或 registry。

**Tech Stack:** Electron、React、TypeScript strict、electron-vite、SQLite、Zod；Renderer Zustand 是 V1 目标，使用前先核对已合入实现。

**Spec:** [SPEC](../SPEC.md)，[V0 审查](../docs/V0_AUDIT.md)。

## 目标与当前证据

- [package.json](../package.json) 第 26 行 声明 @anthropic-ai/sdk；src/main/providers 当前只有 Mock 目录，尚无 Anthropic 实现。
- [src/main/providers/types.ts](../src/main/providers/types.ts) 第 1–22 行 原始协议窄于 V1，执行时需消费 R02/R09 已合入扩展，而非改回基线。
- [src/main/index.ts](../src/main/index.ts) 第 38 行 基线固定 Mock；SDK 声明不能作为鉴权/生成/四 Provider 完成证据。

以上源码与原始 README 证据来自基线 `135bf82c6462ade6dd5300717d6f0102ce4a660c`；治理文档引用指向 R00 文件。行号不代表当前 README 的更新位置。未声明本任务测试已经通过，执行时须重新核对基线和函数。

## 范围与明确不做

Anthropic model 列表或显式自定义输入、分级连接测试、流事件映射、文本/真正公开摘要/usage/finish/error、Abort 和输出限制、脱敏错误。

明确不做：不改 OpenAI/Gemini/registry/Shared/Key/DB/RunService/UI；不引入自动收费重试，不获取或伪造私有推理，不在 fixture 测试使用真实 Key。

## 前置与必读

R09 公共真实链路已合入并验收；R10A 获实施授权。真实请求必须明确触发。

每个执行线程先读 [AGENTS](../AGENTS.md)、[SPEC](../SPEC.md)、[CONTRACTS](../docs/CONTRACTS.md)、[DECISIONS](../docs/DECISIONS.md)、[STATUS](../docs/STATUS.md)、[VALIDATION](../docs/VALIDATION.md)；重新检查 Git 状态、真实文件和依赖提交。具体 wire shape 以总控已合入的 Shared 为准，本文不冻结第二套协议。

## 文件归属

下列路径均相对仓库根；现存/拟新增以原始 `135bf82` 为准，拟新增路径尚不是已实现能力。共享文件由总控实施接线，不属于子项目自由修改范围。

| 状态 | 路径 | 写入负责人 | 责任 |
| --- | --- | --- | --- |
| 拟新增 | src/main/providers/anthropic/** | R10A | 唯一 Anthropic adapter/解析/能力 |
| 拟新增 | tests/unit/providers/anthropic/**；tests/integration/providers/anthropic/** | R10A | 独立 fixture 与协议/取消/角色转换 |
| 依赖任务提供（当前拟新增） | src/main/providers/registry.ts | 总控 | 注册与能力/配置契约扩展 |
| 现存（135bf82） | src/main/providers/types.ts；src/shared/**；src/main/index.ts | 总控 | 注册与能力/配置契约扩展 |
| 依赖任务提供（当前拟新增） | src/main/settings/**；src/renderer/features/settings/** | 总控协调 R08 owner | UI 接线与分级测试展示 |

## Worktree 可独立与可并行

可独立 codex/r10a-anthropic-provider Worktree，与 R10B/R11 并行。仅 anthropic/** 对应模块目录和测试；注册文件由总控串行接线，不能与 R10B 共同编辑。

## 共享依赖与接线规则

先核对已安装 SDK 和供应商官方资料，确定可用能力/参数；向总控报告协议差异。公有 DTO 的可选能力也必须先登记合入，Provider 不返回 SDK 事件。真实 Key 解析由总控 Main factory 统一。

子项目提供契约需求、调用方、兼容性、migration/版本、测试与安全影响；总控先合入共享变化再允许消费。一份文件仅一个写入人，不用分支隔离掩盖同文件争用。共享迁移、IPC/Preload 注册、Main/App 组装及 package/lock 归总控；R04 负责 RunService 状态机模块；R06 阶段由总控登记唯一负责人完成状态拆分/store，之后 App 公共组装由总控维护；后继模块只提交接线申请。

## 实施步骤

- [ ] 核对 SDK/官方协议并建立供应商独立 fixture。
- [ ] 实现 adapter，提交注册与能力差异申请。
- [ ] 总控合入注册后运行模块与共用 Provider 契约测试。
- [ ] 交付真实 smoke 状态与未验证模型，停止在模块范围。

## 详细验收

- [ ] 可通过已登记配置选择 Anthropic，model 输入/列表与 Key 状态正确；各级连接测试不混淆。
- [ ] system/用户/Agent 公共历史按供应商语义转换，角色和消息顺序不丢；输出上限与 signal 传入实际 SDK/API。
- [ ] 流 fixture 中文本、合法公开摘要、usage、停止/截断/error 映射正确，不把私有推理返回 UI。
- [ ] Stop/超时后请求收尾并保留 partial；失败不触发自动重发或覆盖旧尝试。
- [ ] Key/header/原始敏感响应不进日志、错误和 IPC；未知模型/不支持能力有明确错误。
- [ ] fixture 自动检查通过才请求真实 smoke；真实验收记录指定模型/限额/结果，未做真实调用就写未验证。

## 具体测试情景

| 情景 | 操作/输入 | 必须观察的结果 |
| --- | --- | --- |
| 内容块 | 多个文本/允许公开摘要块交错，含空块 | 顺序正确，非公开字段不进入标准事件 |
| 角色转换 | system+主持人+两 Agent 历史 | 捕获请求保持权限和公共历史 |
| 结束与 usage | 正常/长度截断/usage 缺失 | 标准终止原因准确，未知计量不伪造 |
| 取消与错误 | 流中 Abort、401、429、网络断开 | partial retained，脱敏结构化错误，无重试 |
| 能力/UI接线 | fixture model list 与生成能力不同结果 | 设置显示分项；自定义 model 仍可显式测试 |

pnpm run test -- tests/unit/providers/anthropic tests/integration/providers/anthropic；pnpm run typecheck。共享 Provider 契约测试由总控在注册后复验。

依照 [VALIDATION](../docs/VALIDATION.md) 记录真实结果。未运行、失败、条件性验证分别说明；不得把静态证据、Mock、构建或截图互相替代。

## 交付格式

交付包含：任务 ID 与基线/分支；逐项文件清单；行为和操作说明；精确测试命令、日期、退出码、关键输出与未运行项；契约申请和数据库影响；遗留问题；本模块 Commit SHA；总控接线与集成建议。只提交本任务获准文件，不向 main 自行合并。总控集成后复验才更新 merged/verified。
