# 共享接口登记与变更规则

本文先记录 `135bf82` 的实际接口，再列 V1 目标；R00 不修改运行时代码。产品要求见 [SPEC](../SPEC.md)，已知风险见 [V0 审查](V0_AUDIT.md)。

## 现有运行接口

| 层 | 实际来源 | 已存在内容 |
| --- | --- | --- |
| Preload | `src/preload/index.ts` | room.createDemo/getMessages；run.getSnapshot/subscribe/start/pause/stop/step/resumeRun/retryTurn/continueMessage/recoverInterruptedRun/onEvent |
| Shared | `src/shared/contracts/run.ts` | StartRunInput、RunApiContract；room 契约仅 createDemo，未覆盖 getMessages |
| IPC | `src/main/ipc/registerIpc.ts` | 独立 start/cursor 参数 Schema，sender 仅比较 webContents；部分对象不 strict |
| 数据快照 | `src/shared/types/run.ts` | Run/Turn/MessageSnapshot、sequence、workflowSnapshot、RunSubscription |
| Schema | `src/shared/schemas/run.ts` | 快照、订阅、事件和命令 Schema；响应/事件 Schema 未接入实际 Preload 校验，payload 为 unknown |
| Provider | `src/main/providers/types.ts` | 仅 streamChat(input): AsyncIterable<NormalizedChunk>；只有 Mock 实现 |

StartRunInput 当前字段：roomId、task、workflowSnapshot；可选 mode(automatic/step)、maxTurns、maxDurationMs、outputTokenLimit。Main 中另有重复定义，R02 统一。

Run 状态：idle/running/pausing/paused/cancelling/cancelled/completed/error/interrupted。Turn 状态：queued/pending/running/completed/failed/aborted/interrupted/cancelled。消息状态：streaming/completed/failed/aborted。

现有 RunEvent：runId、可选 turnId、sequence、type、unknown payload、timestamp。类型包括 run_state_changed、turn_started、text_delta、reasoning_summary_delta、usage_updated、turn_completed/aborted/failed、snapshot_required。当前服务把回合信息放在 payload，顶层 turnId 未统一填充。

现有 Provider 输入：agentRole、turnIndex、messages(role/content)、可选 signal。事件有 start(requestId)、text_delta、reasoning_summary_delta、usage、finish(stop)，没有标准 error 事件或模型/连接测试。RunService 仅处理 text_delta 和 usage，且各 Agent 仅接收原始任务。

## 当前漂移与能力限制

- Shared 的恢复决策允许 inspect/resume/retry/discard，实际 Preload/IPC/service 仅 inspect/retry/discard。
- retryTurn、continueMessage 和 recovery retry 不是可用功能；合法参数仍抛错。inspect/discard 只处理有限路径。
- Preload 的 api 没有受 RunApiContract 约束，getMessages 返回值也没有显式共享 DTO。
- 状态转换纯函数与服务直接写状态分离；outputTokenLimit 当前按增量片段计数，不能作为真实 Token 上限。
- KeyService 只有 Main 内部接口，没有设置 IPC；启动创建后未注入 Provider。
- 数据库有 Provider/Agent 配置预留字段，但当前存取方法未实现完整配置链路。没有 Artifact/摘要/费用契约。

## V1 目标契约：需要后续任务实现

1. Schema 与 TypeScript 类型共用定义；Preload API 明确满足契约；输入、输出、事件和错误验证一致。
2. Run 保存任务身份、执行配置/成员快照、调度进度、请求尝试和限制；Main 统一状态变更。快照与事件游标一致，重连不重新生成。
3. 事件按 type 判别 payload；统一 runId/turnId/requestId/sequence。单回合事务提交后通知准确事件，不依赖读取全部事件找最后一条。
4. Provider 支持 listModels、分级 testConnection、streamChat；输入含模型、Main requestId、上下文、输出上限、AbortSignal；标准流事件覆盖 start/text_delta/reasoning_summary_delta/usage/finish/error。
5. room/agent/provider/message/artifact 使用受限 DTO 与显式命令；系统 prompt、历史角色和配置语义统一。密钥仅传引用与配置状态，不在普通 DTO 返回明文。
6. 主持人 Override、插话、持续指令和消息重生显式授权；模型文本不触发调度。重试新增尝试，不覆盖旧部分输出。
7. Artifact 包含类型、来源消息、版本及 validationStatus；导出预览、确认和文件写入分为可信命令。

以上是语义登记，尚不是已冻结的具体 wire shape；R02 负责将其落实为可执行契约和兼容性测试，不在 R00 承诺不存在的方法可用。

## 统一变更流程

子项目向总控提供任务 ID、当前接口、拟议变化、受影响调用方、版本/迁移策略、验证场景和安全影响。总控在本文件和 DECISIONS 中记录批准内容，安排共享定义及 migration 的独立变更，依赖合入后再允许模块消费。

共享修改的负责人是总控；新增可选字段、事件及错误语义也需测试。禁止静默替换状态值、复用字段表达新含义、让多个分支抢 migration 号或复制新契约。
