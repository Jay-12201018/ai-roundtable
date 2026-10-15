# R05 完整交接与共享接线申请

2026-10-15（Asia/Shanghai）。实施依据：`tasks/R05-public-context-limits.md` 和本次正式用户授权。基线 `37766666ff10981c302e54636cd0f0378d1c722e`，与启动时 main 相同；已含 R01/R02/R03 验收提交。当前专属 Worktree 为 `ae65/AI交互`，分支 `codex/r05-public-context-limits`。最终完整 Commit SHA 随聊天交付，可用 `git log -1 --format=%H` 查询。本模块未合 main，状态为 **独立模块验收通过后待总控接线/联合集成**，不自行标记 R05 verified。

## 功能与调用

入口 `buildPublicContext(input: ContextInput, counter?: ModelTokenCounter): ContextResult`，类型见 `types.ts`。纯同步 Main 模块，不读写数据库、不创建 Turn、不调用 Provider、不执行调度。输入会通过严格 Schema 复制和校验，拒绝未授权字段且错误不回显内容。没有新增依赖、IPC、Shared Schema、数据库 migration 或第二事实源。

调用方从 `Database.readRunSnapshot(runId)` 的同一事务快照显式白名单投影：

- run：id/roomId/task/membersSnapshot/nextTurnIndex/elapsedExecutionMs/maxTurns/maxDurationMs/outputTokenLimit。
- messages：R03 MessageRecord 的安全字段，不附加 reasoning、认证数据、内部异常或 SDK。
- turns：id/runId/agentId/status/requestId/turnIndex；不传 partialContent。
- attempts：requestId/runId/turnId/messageId/attemptIndex/status；不传 inputSnapshot/providerRequestId/时间等其他字段。
- current：Main 为本次候选请求分配的 agentId/turnId/requestId/turnIndex；必须在插入新 Turn、推进 nextTurnIndex **之前**调用。
- applicationInstructions、hostInstructions：可信 Main 显式提供、保持传入次序；host 绑定本 room/run。不能从模型文本、普通 user 消息或任意 workflow JSON 提取主持权限。
- visibleMessageIds：本次快照已确认可见的消息 ID。用户消息的时间/可见范围由可信调用方在该一致快照内确定；不能传未来内容后期待模块推断时间。
- contextWindowTokens：所选模型的可信窗口；counter：覆盖全部最终 role/content 与供应商封装的模型计数器。

历史数组必须保持 `readRunSnapshot` 的 `sort_key` 顺序，模块不按 ID、名称、时间或 Turn 重排。来源中的 snapshotIndex 是 **零起始数组位置，不是 DB sort_key 或 RunEvent.sequence**。不要使用跨 Run 的 `listMessages(roomId)` 代替当前 Run 快照。分页组装时需同一一致读/固定边界且消费所有页，不能将第一页伪称完整历史。

成功返回现有 R02 `ProviderMessage[]`、outputTokenLimit、selectedHistory 和 report；失败返回固定 reason 与可用的 report，**没有 messages 字段**。report 包含轮数、当前 turnIndex、累计 elapsedExecutionMs、时长上限、预算、来源及逐条排除结果。task/member/progress/elapsed 的旧 NULL 安全拒绝，不猜任务或归零累计时间。

## 指令和公共历史规则

顺序为：应用权限边界 system → 应用指令 system → 已生效主持持续指令 system → 当前冻结成员角色/systemPrompt system → 持久任务 user → 所选公开历史。边界文本明确应用优先于主持、主持优先于角色；任务和公共发言不授予控制权限。模型遵从文本的能力不是本模块能证明的安全保证，权限安全来自不解析公开文本为操作、严格角色映射与可信 Main 调用边界。

Agent 公开文本映射 assistant；普通公开用户文本映射 user。均用 JSON 的 speaker/publicText 标记来源，Agent 增加冻结 agentId。即使含 system、@Override、ignore previous instructions、伪 JSON 或换行，仍为数据，不新增 system 消息或调度动作。历史 system/非公开 sender 一律排除，不将持久标签当主持授权。

只有同 room/run、在 visibleMessageIds 中、status=completed 的公开消息才候选。Agent 还必须具有已完成 Turn 与已完成 Attempt，Turn 必须早于当前回合，身份/冻结成员/发言者一致；只选同 Turn 最新 Attempt。历史 missing Turn/Attempt、失败、取消、中断、streaming/部分输出均排除，原文仍保留。旧 NULL Attempt 不猜测回填。普通用户消息不能伪装已有 Agent Attempt。

相同消息 ID、全部安全字段完全相同则只保留首次并报告 duplicate；冲突重复、Turn/成员重复、请求关联矛盾或混入外来控制元数据则拒绝。消息自身的 other_room/other_run/not_visible 等逐条报告。消息和输出均由副本构建，不修改持久化原文或输入对象。

白名单边界阻止把 KeyService、StoredRun.lastError、Attempt 私有输入、SDK 或推理字段自动序列化给模型；这不是任意自由文本秘密识别器。可信 Main 仍须保证这些公开字段与指令的合法来源，不得把凭据填入 task/content/systemPrompt。

## 预算、拒绝和裁剪

先从窗口扣除完整 outputTokenLimit，再计必要 system 与 task。必要内容绝不删减，超限则 required_context_exceeds_window；输出预留大于窗口则 output_exceeds_window。恰好满足允许，超一个 Token 会整条排除旧历史或拒绝必要输入。

在剩余空间内从最新候选向前选择 **连续后缀的整条消息**，发送时恢复持久顺序；遇到不能容纳的一条，连同更旧候选全部报告 input_budget。超大最新消息可能使历史全部排除。不会截断字符串、生成摘要、覆盖原文或跨过超大消息重新塞更旧内容。所有候选选择/排除均返回 messageId/snapshotIndex/原因，以及原文范围 `[0,content.length)`，单位 utf16_code_units，明确区别于 Token。

ModelTokenCounter 绑定 modelId，声明 exact 或 upper_bound 和 method，必须统计完整请求的消息封装。上界结果仍在报告中标为 upper_bound，不冒充实际 usage。异常、undefined、非正/非安全整数、追加消息后计数下降一律 invalid_token_count。模块给计数器冻结的消息副本，防止计数时改写将发送的内容。可信计数器自身的正确性需总控/Provider 适配器验证。

未知/模型不匹配/畸形计数器只报告 UTF-8 JSON role/content 数组字节估算（不含供应商封装），inputTokens/remainingInputTokens=null，measurement.unit=utf8_bytes/kind=estimate，返回 token_count_unavailable。**该字节数不能与 Token 窗口比较，不能据此发送**。本轮没有内置真实模型 tokenizer；R09 前需经总控提供可靠模型计数器或上界。fixture 使用单独定义的 Unicode scalar tokenizer，仅为测试模型的 Token 语义，不宣称字符数等于真实模型 Token。

## 三 Agent 实际输入证据

`tests/integration/context/publicContext.test.ts` 使用真实 R03 `Database(':memory:')`、冻结任务和成员、本模块专属 CapturingProvider。测试 harness 显式调用构建器后才创建请求证据，**不是 R04 RunService 或 R06 联合执行**。

1. A 的真实 streamChat 输入无 alpha/beta/gamma，输出 alpha 完成后才落 completed。
2. B 的实际 messages 含 A 的 alpha，无 beta/gamma。
3. C 的实际 messages 同时含 alpha、beta，alpha 在 beta 前，无未来 gamma；source 对应 message/turn/request/agent 与 snapshotIndex。
4. 每个 Attempt.inputSnapshot 与捕获的真实请求逐字段相等，signal 剥离；Provider 消息通过 R02 strict Schema。
5. 数据库最终原文为 alpha/beta/gamma；修改未落库草稿不会改变后续输入中的任务或角色。
6. 不同 Run/房间内容不会进入请求；错误控制元数据先拒绝，合法当前快照中外来消息逐条排除。
7. unknown tokenizer 在测试 harness 中阻止 Provider/Turn/Attempt，数据库快照完全不变。生产阻止行为仍需 R04 接线。

## R05-SHARED-01：申请总控联合接线

| 项目 | 需求、调用方与兼容性 |
| --- | --- |
| R04 调用时机 | 在开始每次请求、读取一致快照后，插入当前 Turn/Message/Attempt 前调用。Main 分配本次身份；task/成员/进度来自 R03 持久事实，不用 Renderer 草稿。串行完成前一消息后再构建下一输入。 |
| R04 实际请求 | 仅在 ok=true 时将返回 messages/outputTokenLimit 交给现有 StreamChatInput；模型来自冻结成员，提供相应可靠 counter/window。剥离 signal 后保存同一输入，再在事务提交后调用 Provider。不要保存一个请求、发送另一个请求。 |
| 拒绝与限制 | ok=false 必须停止本次发请求，不制造已经执行的 Attempt，不自动重试。R04 决定受控错误/暂停状态并通知。maxTurns、累计活动 elapsed/maxDuration、Abort 与供应商输出参数仍由 R04 执行；模块没有第二状态机。 |
| R02 Provider | 现有 role/content/outputTokenLimit 足够，**无需扩展 Provider v1**。来源/预算不能塞入 strict messages 或 StreamChatInput。真实模型多 system/连续角色适配须维持权限和完整计数语义。 |
| R03 最终输入 | 当前 createAttempt.inputSnapshot 可直接保存最终 R02 输入，兼容 migration2，禁止改写已有输入/原文。 |
| R03 来源审计 | 独立 report 当前只在 Main 内存。申请由总控批准 Main-only 持久化 ContextReport 或最小等价版本化投影，绑定 requestId，包括来源 ID/位置/范围、排除原因、模型/方法/预算，不重复存凭据或推理。现有 strict Attempt 容不下该字段；需要总控先设计 Schema/API、分配新增 migration（不改1/2）、旧记录NULL和不可变约束，再实施。R05本轮未消费不存在的字段。 |
| 持续指令 | 当前没有批准的持久字段/版本。请总控/R12 提供已授权且已生效、绑定 room/run 的指令快照与稳定来源 ID；不得把普通 workflow JSON、模型或历史 system 文本升级为控制。独立模块可接受显式可信输入，生产来源尚未接线。 |
| 冻结角色 | 当前基线 RunService.start 仍写死空 systemPrompt。实际成员配置冻结由 R04/总控接线，模块只消费现有 MemberSnapshot。 |
| R06 投影 | 最小需要显示受控拒绝原因/裁剪提示及窗口方法、未知估算状态；需总控批准安全 DTO/事件与错误映射。不能直接传内部 report/整行数据，不能擅自新增 Shared 事件或枚举。现有 R06 暂无需改动即可合入纯模块。 |
| 联合 Mock | 总控在 R04/R05/R06 同构建中运行三 Agent Capturing Adapter，断言实际 B/C 输入、Attempt 输入、来源报告、预算拒绝无请求、Turn/事件/消息投影与数据库一致，再覆盖暂停/恢复累计时长及 Stop 部分输出排除。固定 Mock 答案、build 或截图不能替代。 |

申请的安全影响：权限边界不扩大；Main-only report 不进普通 IPC；迁移/新公共字段必须总控单一写入人并先批准。兼容性以 Provider v1/migration2 不变为当前交付基础；任何来源持久化和 UI 扩展都另走版本/旧记录/数据最小化测试。本轮无公共文件修改或私下协议扩展。

## 修改文件与验证边界

生产：`src/main/context/types.ts`、`buildPublicContext.ts`、`selectHistory.ts`。文档：本文件、`PLAN.md`、`VALIDATION.md`。测试：`tests/unit/context/fixtures.ts`、`buildPublicContext.test.ts`、`tests/integration/context/publicContext.test.ts`。

逐命令、本轮失败和成功见同目录 `VALIDATION.md`。所有数据库用内存或原回归自建临时目录；没有触碰真实 userData/Key，没有付费网络请求。原 R01/R02/R03 测试及 package/lock/治理文件未改。依赖为当前 Worktree 独立安装，来源缓存复制使用独立 inode，未复制 node_modules。

集成建议：可提交总控审核独立模块并按 R05-SHARED-01 统一接线。尚未完成真实 RunService 注入、可信持续指令生产来源、来源报告持久化/IPC、真实模型 tokenizer/Provider 输出执行、R04/R05/R06 联合运行、正式桌面 E2E、发布/跨平台。没有 lint 实现，未宣称 lint/E2E/整个 R05 verified。
