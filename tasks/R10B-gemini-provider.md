# R10B Gemini Provider实施任务计划

> 2026-11-17：这是历史任务书。Gemini 适配器已于 2026-11-03 删除，不恢复。现行模型只来自内置目录的 8 家。见 `docs/STATUS.md` 文首。

> 当前状态见 [STATUS](../docs/STATUS.md)。未来范围定义；本轮未获实施授权，不得自动启动。
> 执行时按工程规范选择已授权的执行方式；各项以复选框记录进度，不能因任务文件存在而标完成。

**Goal:** 加入 Gemini 流适配并保持共用上下文、限制、取消、usage 和脱敏协议。

**Architecture:** Gemini adapter 独占目录，映射供应商角色/parts/candidate 语义到公共协议；不能让 UI 或 RunService 依赖 Gemini 原始事件。

**Tech Stack:** Electron、React、TypeScript strict、electron-vite、SQLite、Zod；Renderer Zustand 是 V1 目标，使用前先核对已合入实现。

**Spec:** [SPEC](../SPEC.md)，[V0 审查](../docs/V0_AUDIT.md)。

## 目标与当前证据

- [package.json](../package.json) 第 27 行 声明 @google/genai；src/main/providers 尚无 Gemini adapter。
- [src/main/providers/types.ts](../src/main/providers/types.ts) 第 13–21 行 原始 chunk 仅固定 finish(stop)；执行时消费 R02/R09 扩展的安全/错误语义。
- [src/main/services/RunService.ts](../src/main/services/RunService.ts) 第 272 行 基线仅同一 user task，不足以证明 Gemini 角色/历史已接入。

以上源码与原始 README 证据来自基线 `135bf82c6462ade6dd5300717d6f0102ce4a660c`；治理文档引用指向 R00 文件。行号不代表当前 README 的更新位置。未声明本任务测试已经通过，执行时须重新核对基线和函数。

## 范围与明确不做

Gemini 模型列表/自定义输入、分级连接测试、角色/system/parts 转换、文本/供应商实际公开摘要/usage/finish/error、Abort/超时/输出限制；安全过滤与空候选可解释。

明确不做：不改 OpenAI/Anthropic/registry/Shared/RunService/Key/UI，不扩多模态产品范围，不伪造隐藏推理，不自动付费重试。

## 前置与必读

R09 公共真实链路已合入并验收；R10B 获实施授权。真实请求必须明确触发。

每个执行线程先读 [AGENTS](../AGENTS.md)、[SPEC](../SPEC.md)、[CONTRACTS](../docs/CONTRACTS.md)、[DECISIONS](../docs/DECISIONS.md)、[STATUS](../docs/STATUS.md)、[VALIDATION](../docs/VALIDATION.md)；重新检查 Git 状态、真实文件和依赖提交。具体 wire shape 以总控已合入的 Shared 为准，本文不冻结第二套协议。

## 文件归属

下列路径均相对仓库根；现存/拟新增以原始 `135bf82` 为准，拟新增路径尚不是已实现能力。共享文件由总控实施接线，不属于子项目自由修改范围。

| 状态 | 路径 | 写入负责人 | 责任 |
| --- | --- | --- | --- |
| 拟新增 | src/main/providers/gemini/** | R10B | 唯一 Gemini adapter、能力和流解析 |
| 拟新增 | tests/unit/providers/gemini/**；tests/integration/providers/gemini/** | R10B | 候选/parts/usage/过滤/取消 fixture |
| 依赖任务提供（当前拟新增） | src/main/providers/registry.ts | 总控 | 注册、共享能力及 factory 接线 |
| 现存（135bf82） | src/main/providers/types.ts；src/shared/**；src/main/index.ts | 总控 | 注册、共享能力及 factory 接线 |
| 依赖任务提供（当前拟新增） | src/main/settings/**；src/renderer/features/settings/** | 总控协调 R08 owner | 配置与测试展示 |

## Worktree 可独立与可并行

可独立 codex/r10b-gemini-provider Worktree，与 R10A/R11 并行；只编辑 gemini/** 和自身测试。注册/schema/migration 依然串行总控，别的 Provider 目录排除。

## 共享依赖与接线规则

核对已安装 SDK 和供应商官方文档，明确 Abort、候选、usage/finish 能力与限制映射；无法可靠支持的能力先报告，不伪实现。总控处理公共协议变化与 registry/设置入口。

子项目提供契约需求、调用方、兼容性、migration/版本、测试与安全影响；总控先合入共享变化再允许消费。一份文件仅一个写入人，不用分支隔离掩盖同文件争用。共享迁移、IPC/Preload 注册、Main/App 组装及 package/lock 归总控；R04 负责 RunService 状态机模块；R06 阶段由总控登记唯一负责人完成状态拆分/store，之后 App 公共组装由总控维护；后继模块只提交接线申请。

## 实施步骤

- [ ] 核对 SDK/官方资料并编写 parts/candidate/取消 fixture。
- [ ] 实现 Gemini adapter 和能力映射，提交公共接线请求。
- [ ] 总控注册后复验模块与共用协议。
- [ ] 交付真实调用记录或明确未运行项，完成供应商模块边界。

## 详细验收

- [ ] 按配置选择 Gemini，列表与自定义模型可用；endpoint/key、列表和生成分级结果准确。
- [ ] 公共历史按供应商角色转换，system 内容不降为普通 Agent 权限；输出限制与 signal/取消机制可靠传入。
- [ ] 标准流事件文本/公开摘要/usage/requestId/终止准确；安全过滤、空候选、畸形 parts 明确反馈，无虚假成功消息。
- [ ] Stop/超时中止消费和请求收尾，部分文本/尝试保留，不自动重试可能收费调用。
- [ ] 错误脱敏且能区分鉴权/限流/过滤/网络；Key 不在 IPC/日志/模型上下文。
- [ ] fixture 与共享协议复验完整；真实 smoke 明确触发并单独记录，未实测不宣布全部 Gemini 模型可用。

## 具体测试情景

| 情景 | 操作/输入 | 必须观察的结果 |
| --- | --- | --- |
| parts 与候选 | 多个 parts、空候选、Unicode、不同终止原因 | 正确选择/映射或明确拒绝，无丢字伪成功 |
| 内容过滤 | fixture blocked/安全原因，无文本/有 partial | 可理解状态，partial 保留，不归正常完成 |
| 历史与限制 | 捕获角色/system/model/max output | 公共输入与配置一致 |
| usage 差异 | 累计/缺失/中途 usage fixture | 不重复计费或伪估真实 Token |
| 取消与错误 | 流中 Abort/超时/401/429/网络断开 | 无再调度、无敏感错误、旧尝试保留 |

pnpm run test -- tests/unit/providers/gemini tests/integration/providers/gemini；pnpm run typecheck。自动化只使用 fixture。

依照 [VALIDATION](../docs/VALIDATION.md) 记录真实结果。未运行、失败、条件性验证分别说明；不得把静态证据、Mock、构建或截图互相替代。

## 交付格式

交付包含：任务 ID 与基线/分支；逐项文件清单；行为和操作说明；精确测试命令、日期、退出码、关键输出与未运行项；契约申请和数据库影响；遗留问题；本模块 Commit SHA；总控接线与集成建议。只提交本任务获准文件，不向 main 自行合并。总控集成后复验才更新 merged/verified。
