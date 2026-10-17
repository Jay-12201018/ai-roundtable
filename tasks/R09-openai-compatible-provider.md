# R09 OpenAI 与兼容端点真实闭环实施任务计划

> 当前状态见 [STATUS](../docs/STATUS.md)。未来范围定义；本轮未获实施授权，不得自动启动。
> 执行时按工程规范选择已授权的执行方式；各项以复选框记录进度，不能因任务文件存在而标完成。

**Goal:** 用 OpenAI 与用户确认的兼容端点完成首个真实流式协作闭环，验证公共协议和安全调用边界。

**Architecture:** 两类适配器共用 R02 Provider 协议和 Main-only factory/Key 引用；差异在明确的能力与解析配置中表达。Renderer 不接触 SDK、网络或明文 Key。

**Tech Stack:** Electron、React、TypeScript strict、electron-vite、SQLite、Zod；Renderer Zustand 是 V1 目标，使用前先核对已合入实现。

**Spec:** [SPEC](../SPEC.md)，[V0 审查](../docs/V0_AUDIT.md)。

## 目标与当前证据

- [src/main/index.ts](../src/main/index.ts) 第 38 行 固定创建 MockProvider；[src/main/providers/types.ts](../src/main/providers/types.ts) 第 20–22 行 只有 streamChat，无真实实现。
- [src/main/services/RunService.ts](../src/main/services/RunService.ts) 第 272–287 行 现有输入缺模型/真实上限，仅处理文本和 usage；R02/R04/R05 是本任务前置。
- [package.json](../package.json) 第 32 行 声明 openai SDK 只是依赖，不是生成能力证据；[README.md](../README.md) 第 51 行的兼容端点规则尚是设计目标。

以上源码与原始 README 证据来自基线 `135bf82c6462ade6dd5300717d6f0102ce4a660c`；治理文档引用指向 R00 文件。行号不代表当前 README 的更新位置。未声明本任务测试已经通过，执行时须重新核对基线和函数。

## 范围与明确不做

OpenAI 与 OpenAI-Compatible 两类 adapter、模型列表/自定义模型、分级 testConnection、流式规范化、Abort/超时、实际输出限制、usage/公开推理信息、脱敏错误；fixture 自动化与授权真实 smoke。

明确不做：不默认发付费请求、不把所有兼容端点能力假设一致、不伪造公开推理或真实 Token；不改 Key 设置/RunService/公共上下文/Renderer/App，也不做 Anthropic/Gemini。

## 前置与必读

R07/R08 已合入；R04/R05/R06 的公共历史、限制和状态联合 Mock 验收通过；R09 获实施授权。真实生成另需用户明确触发。

每个执行线程先读 [AGENTS](../AGENTS.md)、[SPEC](../SPEC.md)、[CONTRACTS](../docs/CONTRACTS.md)、[DECISIONS](../docs/DECISIONS.md)、[STATUS](../docs/STATUS.md)、[VALIDATION](../docs/VALIDATION.md)；重新检查 Git 状态、真实文件和依赖提交。具体 wire shape 以总控已合入的 Shared 为准，本文不冻结第二套协议。

## 文件归属

下列路径均相对仓库根；现存/拟新增以原始 `135bf82` 为准，拟新增路径尚不是已实现能力。共享文件由总控实施接线，不属于子项目自由修改范围。

| 状态 | 路径 | 写入负责人 | 责任 |
| --- | --- | --- | --- |
| 拟新增 | src/main/providers/openai/**；src/main/providers/openai-compatible/** | R09 | 供应商适配、能力与流解析；不写其他 Provider 目录 |
| 拟新增 | tests/unit/providers/openai/**；tests/unit/providers/openai-compatible/**；tests/integration/providers/openai/** | R09 | 流 fixture、能力/错误/取消及协议消费 |
| 现存（135bf82） | src/main/providers/types.ts；src/main/index.ts；src/shared/** | 总控 | 共享能力/注册/工厂和消费接线 |
| 拟新增 | src/main/providers/ProviderRegistry.ts | 总控 | 共享能力/注册/工厂和消费接线 |
| 现存（135bf82） | src/main/services/RunService.ts | 总控协调相应 owner | 真实模型选择与测试结果接线，R09 不跨模块编辑 |
| 依赖任务提供（当前拟新增） | src/main/settings/**；src/renderer/features/settings/** | 总控协调相应 owner | 真实模型选择与测试结果接线，R09 不跨模块编辑 |

## Worktree 可独立与可并行

可独立 codex/r09-openai-compatible-provider Worktree；在 R07/R08 后串行完成首个真实接口闭环。R09 后 R10A/R10B/R11 可并行；它们不得修改本任务目录或注册共享文件。

## 共享依赖与接线规则

复核已安装 SDK 类型/供应商官方资料后实现，记录 API/能力差异而不凭模型名猜测。总控注册两类 Provider、将 Model/Key 引用和上下文限制传入。真实 smoke 记录目标模型、端点与限额，fixture 与真实结果分列。

子项目提供契约需求、调用方、兼容性、migration/版本、测试与安全影响；总控先合入共享变化再允许消费。一份文件仅一个写入人，不用分支隔离掩盖同文件争用。共享迁移、IPC/Preload 注册、Main/App 组装及 package/lock 归总控；R04 负责 RunService 状态机模块；R06 阶段由总控登记唯一负责人完成状态拆分/store，之后 App 公共组装由总控维护；后继模块只提交接线申请。

## 实施步骤

- [ ] 建立 OpenAI/兼容端点流与错误 fixture，核对协议和 SDK。
- [ ] 实现两个 adapter，提交 factory/能力注册申请。
- [ ] 总控完成真实链路接线，运行 fixture 与公共历史联合检查。
- [ ] 仅在明确触发时做受限真实 smoke，分别交付两类能力证据。

## 详细验收

- [ ] 两类 adapter 满足同一已合入协议，model 列表失败仍允许用户显式输入模型；分级测试各自报告。
- [ ] stream 标准事件包含 Main requestId、文本、可用公开推理摘要、usage、finish/error；终止原因与不完整输出有准确语义，不把 SDK 原对象暴露。
- [ ] Abort/长流/网络超时/用户 Stop 能终止调用；不自动重试不确定已收费请求；保存部分输出与原错误分类。
- [ ] 真实输出限制传到所选 API 的实际限制参数；未知不支持能力在调用前报告，不以片段数伪装上限。
- [ ] 兼容 Base URL 经 R08 校验并由用户确认，Key 只在 Main 注入；日志/错误/IPC 无敏感 header/Key。
- [ ] 公共历史和成员 role/system prompt 进入真实请求；总控统一计时、限制与投影，不能只证明单模型能回应。
- [ ] 自动化 fixture 覆盖协议；至少一项用户明确触发的真实 smoke 分别核对真实和兼容端点，未触发项记未运行，不外推其他厂商。

## 具体测试情景

| 情景 | 操作/输入 | 必须观察的结果 |
| --- | --- | --- |
| 正常/分片流 | SSE 字节跨边界、Unicode、空增量、正常结束 | 顺序/文本完整，start/finish 一次，usage 正确 |
| 半流中断 | 部分文本后 Abort/断连/超时 | 保留 partial；错误分类明确，不重发 |
| 能力差异 | 无列表接口、usage 缺失、输出参数不支持 | 明确降级/拒绝；费用/Token 不伪报 |
| HTTP/鉴权错误 | fixture 401/403/429/500/畸形响应 | 结构化脱敏错误，可重试性明确但不自行重试 |
| 模型参数 | 捕获 model/context/max output/requestId | 与 R07/R08/R05 配置一致 |
| 授权真实 smoke | 用户明确测试指定模型/已确认端点+小限额 | 记录实际生成与停止、消息落库；无授权则未运行 |

pnpm run test -- tests/unit/providers/openai tests/unit/providers/openai-compatible tests/integration/providers/openai；pnpm run typecheck；pnpm run build。自动化不访问公网或使用真实 Key。

依照 [VALIDATION](../docs/VALIDATION.md) 记录真实结果。未运行、失败、条件性验证分别说明；不得把静态证据、Mock、构建或截图互相替代。

## 交付格式

交付包含：任务 ID 与基线/分支；逐项文件清单；行为和操作说明；精确测试命令、日期、退出码、关键输出与未运行项；契约申请和数据库影响；遗留问题；本模块 Commit SHA；总控接线与集成建议。只提交本任务获准文件，不向 main 自行合并。总控集成后复验才更新 merged/verified。
