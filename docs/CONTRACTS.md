# 共享接口登记与变更规则

## DEEPSEEK-PROXY-01 共享接线（2026-10-19）

用户正式授权后，获批04bf8a20已从1c4d2af严格ff-only合main，本轮[独立主线验收](verification/2026-10-19-deepseek-loopback-proxy-main.md)通过；以下接口不再是未合main候选。无新wire shape、migration或发送权限；原真实费用/严格计数/Keychain/发布限制保留。

总控在 `codex/deepseek-loopback-proxy` 独占 Main transport/Registry/装配、受控启动器及本轮公共测试。`readLoopbackProxy` 仅读 Main 显式 `ROUNDTABLE_CONNECT_PROXY` 和 `ROUNDTABLE_TRUST_PROXY_DNS=1`；启动器仅从 `open --connect-proxy ... --trust-proxy-dns` 注入，不采用环境/系统自动代理。可选 `LoopbackProxy` 仅规范回环 HTTP 地址/端口；默认无值维持原直连 DNS/pinning。

`createSafeFetch` 第四参数为可选 Main-only proxy；不进入 Shared、IPC、Renderer 或 DB。代理目标首期固定 POST `https://api.deepseek.com/chat/completions`，其他目标在 Key 读取前拒绝。用户明确信任本机代理负责远端 DNS，客户端不能证明其实际远端 IP 公网；固定目标及有效 TLS 验证约束凭据目的地。不得把本机 Fake-IP 加入公网白名单，不能向任意兼容端点开放代理或在失败时回退。

诊断只增加白名单阶段 `proxy` 和类别 `proxy_failed/proxy_rejected`；代理响应不提升服务商 `http_response`/`httpStatus`，没有原始异常、代理响应或凭据字段。旧记录兼容，新枚举记录不能降级给旧 strict reader。无 SQL/migration1–4、普通 DTO、Key/费用算法或真实模型权限变化；详见[候选报告](verification/2026-10-19-deepseek-loopback-proxy.md)。

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

## R01-SHARED-01 集成接线登记（2026-10-13）

总控在 `codex/integrate-r01` 引入子项目 `d956279949baa0992be5e0cb093f59ef96a9e205` 并实施以下接线，集成提交为 `0ad1701a47222315158e7be00d29afe1c9ef1767`。用户批准后以 `4149590d28296ab3520b70606dcb161ba16a6b39` 正式合入 main，主线本轮复验通过，规则已生效；证据见 [合并后验收](verification/2026-10-13-r01-main.md)。上文 `135bf82` 接口表为历史基线，其来源检查由下面规则取代。此次验收不新增 wire shape/Schema/migration，也不实施 R02。

- 所有现有 invoke channel 使用窗口模块的 `isTrustedIpcSender(window, event)`：活窗口、活 webContents、创建时固定的准确页面 URL、同 sender、非空且等于当前 mainFrame 的 senderFrame；子 frame 和不可信页面拒绝。仅 fragment 可变，不接受 credentials。
- 生产页面只信任构建相对位置 `../renderer/index.html`；已打包应用忽略 `ELECTRON_RENDERER_URL`。开发地址固定到本次窗口创建时配置，集成开发服务为 `http://127.0.0.1:5173/`，端口占用明确失败，不自动换端口。
- `run.event` 仅在注册未释放且当前页面仍受信时推送。disposer 幂等、旧注册先释放、部分注册失败回滚；旧 disposer 不删除新 handler。取消 Renderer listener 仍通过原 `onEvent` 返回函数完成。
- Main 在退出标记之后同步释放 IPC/销毁自身窗口，通过一次 Promise 屏障等待 RunService，再仅关闭一次数据库。每次 before-quit 都阻止默认退出；退出中不再响应建窗/聚焦。同步启动失败及清理错误退出码为 1；窗口异步加载失败由既有窗口错误提示触发 app.quit，正常收尾保持退出码 0。
- RunService.shutdown 在 abort/等待后重新读取 Run 状态，将仍 paused 的 Run 用既有 `finishRun(cancelled)` 终结；不覆写 completed/error，不删除消息、Turn、请求 ID 或部分输出，释放活动锁。服务仍可供现有 Mock 测试复用，不增加永久 closed 状态。
- Preload 输出单文件 `../preload/index.cjs`，仅运行时 `require('electron')`；有限 Bridge 方法和 wire shape 原样保留，启用 sandbox/contextIsolation，关闭 Node integration。生产 CSP 禁止连接/frame/object/base；开发只增加脚本 nonce 和准确 HMR 地址。

调用方为 Main 生命周期、窗口工厂、现有全部 IPC handler/event、RunService.shutdown 和 Renderer Bridge。无 DTO、Shared Schema、数据库 SQL/migration、Provider 协议、package/lock 变更；正常退出 paused 新增 cancelled 终态与既有事件类型。完整状态机/异常恢复/契约漂移仍交 R02/R03/R04。证据和限制见 [R01 集成验证](verification/2026-10-13-r01-integration.md)。

## R02 独立实施登记（2026-10-14，待总控审核，未合 main）

用户已明确授权 R02；沿用用户创建的 Worktree `/Users/zhangwenjie/.codex/worktrees/0af5/AI交互`，基线 `b690a1e2cefb485e81b35292bfb875bd19b88a2b`，分支 `codex/r02-contracts`。上文的 R02 未授权表述是 main 历史阶段事实；本登记仅描述本分支，不自行修改总控状态看板或标记 merged/verified。

唯一写入负责人为 R02 主代理；协作代理仅做只读审查，不拆分共享文件写入。排他范围包括 Shared 全部契约/类型/Schema、Provider types 与 Mock、IPC 注册、Preload、RunService、Renderer env 和协议测试。现有测试 fixture 接线限定为 `tests/unit/stateMachine.test.ts`、`tests/unit/mockProvider.test.ts`、`tests/unit/rendererSync.test.tsx`、`tests/unit/lifecycle/ipcSource.test.ts` 和 `tests/integration/shutdown.test.ts`；保留全部原测试。

R02-CONSUMER-01：独立审查实际复现未落库的 `snapshot_required` 标记造成 Renderer 无限重同步。作为本次必要消费接线，由同一负责人在 `src/renderer/App.tsx` 的事件循环仅删除已消费的控制标记后抓权威快照，并在 rendererSync 添加游标不变测试；不改视觉、store、批处理或调度。此项随本分支交总控审核，不实施 R06。

### R02 协议 v1 与消费规则

Schema 是 DTO 的事实来源，Run/Turn/MessageSnapshot、StartRunInput、InterruptedRunDecision、RoomMessage 和 Provider 类型均由 Schema 派生。状态枚举沿用原值。`src/main/providers/types.ts` 只重导出 Shared Provider 契约；Shared 仅依赖 Zod 和自身，不依赖 Electron、SDK、DB 或 Node。ID 是 1–256 个无空白字符，不强制 UUID（保留既有 ID）；cursor/sequence/token 计数为非负安全整数，事件 sequence 必须正数；时间是 UTC ISO datetime。workflowSnapshot 仅保留 JSON 配置，不能携带函数/undefined/非有限数；后续配置结构及权限扩展仍需总控批准。

Renderer Bridge 仍仅暴露 `room`/`run`，方法和 Promise 返回行为保留；`RoundtableApiContract` 是完整 API 来源，Renderer 类型从 Shared 导入。room.getMessages 返回显式 RoomMessage[]（id/roomId/runId/可选turnId/senderType/senderName/content/status）；无 CRUD、成员或设置实现。

IPC 参数仍为原单参数形状，所有对象 strict，多余位置参数也拒绝。输出改为 `{version:1,ok:true,data}` 或 `{version:1,ok:false,error}`，void 操作 data 为 undefined。Preload 检查版本、严格响应及请求/响应 ID 对应后解包，所以 Renderer 不消费 envelope。旧 Main/新 Preload 或新 Main/旧 Preload 不兼容，必须将同一构建的 Main/Preload/Renderer 一起交付；不静默降级或复制旧协议。来源拒绝继续在参数解析前同步抛出固定 Unauthorized IPC sender，Preload 将传输拒绝归一化；R01 准确 URL/mainFrame 来源及 disposer 不变。

错误只有受控 code/message/retryable 和 invalid_input 可选 field。field 仅允许契约已知顶层名，未知字段及位置参数记 arguments，不回显未知字段名、输入值、堆栈、SDK/数据库异常。code 包括 invalid_input、invalid_response、forbidden、unsupported、not_found、invalid_state、internal_error、transport_error、authentication_failed、rate_limited、timeout、cancelled、network_error。仅 transport_error/rate_limited/timeout/network_error 的 retryable=true，含义是用户可考虑新尝试，绝不授权自动重发。Main 连结构化异常也先校验；未知异常归 internal_error；Preload生成的拒绝错误也不包含本地路径或内部调用栈。普通 DTO、Provider 输入和响应无明文 Key 字段，未来设置只能引用 Main 保护的 Key/状态，不通过 workflowSnapshot、SDK 原始对象或开放 IPC 绕过。

恢复决策 inspect/resume/retry/discard 在 Schema、API、Preload、IPC、RunService 一致：interrupted 的 inspect/discard 保留现有行为；resume/retry 明确 unsupported，不自动发请求；retryTurn/continueMessage 也统一 unsupported，不实现请求恢复或消息续写。

### RunEvent 与持久化兼容

传输事件为严格判别联合：`version:1,runId,sequence,type,payload,timestamp`；回合事件另有必需 `turnId,requestId`。runId 标识一次执行；turnId 标识一个回合；requestId 由 Main 在每次请求尝试前分配，持久化在 Turn，并原样交给 Provider；供应商请求号只放 Provider start 的 providerRequestId，不能覆盖 Main ID。保留既有 payload.turnId/messageId 以兼容 App；重复身份必须相等。

| type | payload（所有对象 strict） |
| --- | --- |
| run_state_changed | status；可选 reason 仅既有最大时长/丢弃中断原因 |
| turn_started | turnId、messageId、agentId、requestId |
| text_delta / reasoning_summary_delta | turnId、messageId、senderName、text |
| usage_updated | turnId、inputTokens、outputTokens |
| turn_completed | turnId、messageId |
| turn_aborted / turn_failed | turnId、messageId、受控 error |
| snapshot_required | reason：invalid_event / incompatible_version / sequence_gap；无回合/请求 ID |

sequence 在每个 Run 内持久化递增，以 DB 原始序号为准，不重编号或跨 Run 比较。subscribe 返回 `cursor < sequence <= snapshot.sequence` 的历史事件；nextCursor 等于 snapshot.sequence，快照已经覆盖这些事件，Renderer 不重复附加文本。两端检查 Run、游标、连续性以及事件与快照中的 Turn.requestId/messageId/agentId 关联；未知/矛盾/有内部缺口时返回权威快照、events=[]、resyncRequired=true。

SQLite SQL/migration/已有行均不改。Main 对 v0 可解析记录只在输出时由 payload/Turn/Message 补齐身份，并将历史失败字符串换成公开错误；不生成新的历史 requestId，不重写原错误/部分输出。新事件写入前也验证，并填既有 turn_id 列。v1 是当前传输版本，数据库事件仍沿用既有字段；未来持久化版本须由 R03 向总控申请，不能把未知 payload 当 v0 强行接受。损坏 JSON 在 DB 解析阶段抛错的恢复留 R03，本轮会拒绝响应，不能凭空恢复。

Main 推送仅发送合法事件，畸形且有安全 runId/sequence 外壳时改成 snapshot_required，否则丢弃。Preload 再校验；未知版本/类型或畸形事件只为已知 Run 合成控制标记，不把原内容传入 Renderer。合成序号是触发刷新的临时标记，绝不落库/推进权威 cursor；App 消费后先删标记，再读取快照，避免快照序号不变时无限同步。未认识任何 Run 时丢弃，首次 start/subscribe 自带快照恢复。

Zod 解释执行（jitless）保证 Preload 的校验不触发动态代码/CSP 探测；没有启用 unsafe-eval 或改 sandbox。

### Provider v1

ProviderAdapter 的 listModels、testConnection、streamChat 共用 requestId 与可选 AbortSignal；stream 输入必需 modelId/messages，可选 outputTokenLimit，agentRole/turnIndex 仅现有 Mock 提示。没有 SDK 原始类型、Key 或通用网络能力进入契约。分级测试：configuration 仅本地配置；authentication 可做明确触发的只读认证；generation 必须明确模型，未来真实实现可能收费，仍需用户触发；本轮各级只用确定性 Mock。

NormalizedChunk 覆盖 start、text_delta、reasoning_summary_delta、usage、finish、error，每条带相同 Main requestId。正常流 start 恰好一次，finish 恰好一次且为终态；error 可在 start 前终结，也可在部分输出后终结，不得跟 finish 共存或继续输出。finish.reason 为 stop/length/content_filter。Main 校验格式、ID、顺序及终结，标准 error 转回合失败/取消并保留已有部分输出，不自动重试。公开 reasoning_summary_delta 仅转发 Provider 真正给出的内容，不生成隐藏推理。

Mock 补齐模型列表/分级测试、使用 Main requestId、输出限制及取消 error。Mock usage 仍按字符/片段作确定性估算，现有 RunService 的增量计数守卫也保留；真实 Token、累计超时、完整 Step/状态机策略留 R04/R05/R13，不能据此声称真实模型支持或完整限制已实现。

### 后续模块接入

沿用任务索引排他归属：Shared、IPC/Preload 注册、Provider 公共协议/registry、Main/App 组装、package/lock 和 migration 编号由总控；R04 接管 RunService/stateMachine 的状态机，R06 接管 store/subscriptions 状态拆分，完成后 App 组装恢复总控。R03 用现有 DTO 并申请任何持久化/migration 变化；R05/R11/R12/R13 只申请 Run 输入/调度接线；R07/R08 申请房间/成员/配置/安全 Key 引用契约；R09/R10A/R10B 仅在自己的供应商目录消费同一 Adapter；R14/R15 申请产物/导出可信命令；R16 消费状态与组件接口；R17 消费统一 Bridge 但须另获授权；R18 在 V1 完成后单独授权。

任何新增可选字段、事件、枚举或能力均提交任务 ID、需求、调用方、兼容版本、migration、测试、安全影响；总控批准并先合入共享变更、登记唯一写入人，再由模块消费。未知新增事件和版本默认拒绝/重同步；不得在模块内复制 Schema、抢 migration 号或另开通用 invoke。没有因本轮定义而启动 R03–R18。

## R02 集成审核补充（2026-10-14，未合 main）

总控在 `codex/integrate-r02` 引入原交付 `14f07a22b44bcd2459dd44f579230792033d9301`，等价提交 `bafa84f55b6c77aeaffe26b27caae56fb67cbcf0`。发现 workflowSnapshot 的任意 JSON record 可携带明确凭据字段，经普通输入持久化并随快照返回；当前 UI 不主动传 Key，因此不声称已经泄漏真实密钥。

R02-INTEGRATION-01：同一 Shared workflowSnapshotSchema 递归拒绝 apiKey、accessToken、refreshToken、authToken、bearerToken、token、password、secret、clientSecret、apiSecret、credentials、authorization、privateKey、secretKey；字段比较忽略大小写及 `-`/`_`，包括嵌套对象和数组。保留普通 JSON 配置及 keyReference 等引用字段，不扫描任意文本内容，也不声称具备通用秘密识别能力。新输入在落库前拒绝，输出 Schema 同样拒绝旧敏感配置，保留原数据库记录；本轮不做 R03 历史恢复/迁移或自动删除。未来真实 Key 输入只能走专用可信 KeyService 链路，配置扩展仍需统一批准。

DTO 红测已实际出现19失败，修复后48项通过；随后严格配对Node24.18.1执行全部契约94项及全单元/集成228项通过，包括新增service持久化/旧记录保护测试。类型、构建、SQLite压力和Electron隔离验证也通过；干净安装可靠性仍待确认，不把现有环境PASS外推完整发布验收。原生环境及本次失败记录见 [本轮审核记录](verification/2026-10-14-r02-integration.md)，当前不标 merged/verified，不启动 R03。

## R02 main 生效登记（2026-10-14）

上述独立实施、集成审核段落保留各自交付时的历史状态。环境阻塞随后解决，用户批准候选 `5b8f771bfa0fd1823b7efe6488179e15aea436a5`，以 `6aff174e6cf397eb49b9b4ceadb3387f207b84a6` 合入 main。合并树与候选完全一致；main 本次 94 项契约、228 项全回归、类型/生产构建、Node/Electron SQLite 及隔离生产 Preload/IPC/退出验证通过，R02 verified，证据见[主线验收](verification/2026-10-14-r02-main.md)。

本次合并/验收没有继续改变 wire shape、数据库 Schema/migration、依赖版本或业务逻辑。后续模块应消费已合入 Shared v1 和同构建 Main/Preload/Renderer，不混用原 v0 Bridge。R03 为 ready，尚未获实施授权；任何持久化契约或 migration 扩展仍由总控审批、分配版本及登记唯一写入人，不能因 ready 自行修改公共文件。

## R03-SHARED-01 总控集成候选（2026-10-15，未合 main）

本节保留集成阶段登记；下面的“未合 main/未 verified”仅指当时阶段。当前已按用户批准合入并完成主线复验，生效信息见末尾“R03 主线生效登记”。

上段是 R02 验收时的历史状态。用户现已授权 R03 总控接线；本节对应 `codex/integrate-r03`，依赖 main `be37fad9d05050a9bad1847e5008bc67752523f6`。共享写入人为本聊天总控，子项目原提交及 Worktree 保留。完整证据见 [R03 集成报告](verification/2026-10-15-r03-integration.md)。本候选未标 verified，后续模块不得提前实施或消费尚未合入的接口。

| 唯一来源/接口 | 规则与调用方 |
| --- | --- |
| Shared `schemas/persistence.ts` | Run 执行元数据、成员快照、Main 私有 StoredRun/RequestAttempt、安全 Attempt 投影和分页输入；DTO 由 Zod 派生，请求输入复用 R02 provider Schema |
| migration 2 | 总控分配；v1 SQL 不变。旧缺失 task/members/progress/elapsed/input/time 为 NULL；仅唯一可证明的旧请求关联回填 Attempt，不伪造历史 |
| `Database.initialize()` | 返回 void 或 Promise<void>；所有调用方都可 await，Main 必须等待已开始的磁盘升级。失败关闭资源但保留原库及验证备份，禁止边迁移边创建服务 |
| `insertRun/getRun/updateRunProgress` | Main 完整持久记录；实际生产者写完整任务/冻结成员/限制。低层旧调用兼容未知元数据，已知进度单调，未知历史不能伪造起点 |
| `createAttempt/getAttempt/listAttempts/updateAttempt` | Main-only 输入证据；requestId 全局唯一、(turnId,attemptIndex) 唯一、messageId 唯一，首请求等于 Turn 原 requestId；身份/输入不可变，终态不重开；新重试须新请求/消息 |
| `appendRunEvent` | 返回确切 PersistedRunEvent 对象，包含 sequence/timestamp/protocolVersion/requestId；事务分配序号并验证 v1 Attempt 身份，调用方不可再当 number 使用 |
| `transaction/afterCommit` | 状态、消息、Attempt、事件共同提交；最外事务成功后才通知；回滚丢弃相应通知，禁止异步事务回调 |
| `listRunMessages(runId,{after,limit})` | after={runId,sequence}，全局稳定消息键，limit1..500；返回 messages/nextCursor/hasMore；同一页在同一读事务，拒绝跨 Run 游标 |
| `listRunEvents(runId,{cursor,throughSequence,limit})` | cursor 排除/固定上界包含，limit1..500；返回 events/nextCursor/throughSequence/hasMore。数字游标旧入口仍兼容；不存在的 Run/非法上界拒绝 |
| `readRunSnapshot/readRunSubscription` | 一次读事务返回完整 Run/Turn/消息/Attempt/sequence；增量超过500或有缺序/坏 JSON 时使用权威快照重同步，不截断后伪称同步完成 |
| `RunSnapshot.execution/attempts` | Shared 可选字段兼容现有 fixture，当前生产者始终返回；legacy 未知为 NULL。普通投影排除私有 inputSnapshot/providerRequestId/lastError，workflow 仍走 R02 敏感字段守卫 |
| 事件 | 新写 protocolVersion1，与 wire version1 一致，requestId 绑定该次 Attempt；v0 仅输出时安全适配，未知协议/未知事件触发重同步，不改写原文 |
| `prepareRegisteredRestore(id)` | 可信 Main-only；仅已验证 catalog 且路径/文件类型/哈希/恢复数据有效才返回独立候选。旧目录行或任意发现文件不可自动信任，不替换现用数据库 |

恢复只作用于 running/pausing/paused/cancelling 父 Run 及其未终结证据；清指针并追加一次 interrupted，保留文本和请求。idle 保持 idle，终态不变，不产生 Provider 调用。Main 启动/退出等待与 R01 幂等屏障一致。

R04 负责后续显式调度/重试与累计限制；R05 在 Main 形成真实上下文并保存 Attempt 输入；R06 消费安全快照/重同步信号。新增消息分页 Bridge、真实模型配置或恢复命令仍需独立总控申请。本次未修改 IPC 注册、Preload API、Renderer App 或 ProviderAdapter，也没有第二套 repository。

## R03 主线生效登记（2026-10-15）

用户批准候选 `439e3c6cb58437298e94fe2536f26e22eae66f6c` 后，实际以 `e642b96a8dded195be44749dd6f267798de95198` 合入 main；本次主线313全回归、Node/Electron各85专项、类型/构建/原生/隔离Bridge与退出数据均通过，见[主线证据](verification/2026-10-15-r03-main.md)。以上 R03-SHARED-01 和 migration2 现在生效，原 migration1 不变；本轮没有继续修改任何 wire shape/SQL/业务实现。

R04/R05/R06 可在各自另获实施授权后消费这些接口，同构建 Main/Preload/Renderer 一起交付，不能提前开启模块或增加 IPC。后续公共变更仍由总控独占、先登记兼容性及测试再接线，不共享可变依赖/数据库/userData。


## R04/R05/R06 联合集成候选（2026-10-15，尚未合 main）

本节为原候选历史阶段；用户随后已批准合入，当前生效登记见文末2026-10-16主线验收。

本次用户已授权联合适配，总控为唯一共享文件写入人。三个原模块完整引入一次；状态为 review，后续模块不得将候选视为主线已验收。完整验证见[联合报告](verification/2026-10-15-r04-r05-r06-integration.md)。Shared Schema、IPC 注册、Preload、Database 和 migration1/2 均未改变。

| Main 私有接线 | 规则与调用方 |
| --- | --- |
| `RunMessagesBuilder(..., preparation)` | 保留原三参数 callback 兼容；第四参数给出真实候选 turn/request/message/agent/index 及 R03 一致快照。Retry/Continue 附原请求身份和最终重放/追加 messages。禁止生成假 Turn 适配 R05 |
| `RunService.executeTurn` | 同一同步数据库事务内读快照→构建/校验最终输入→时限和 Abort 校验→写 Turn/Message/Attempt/事件；afterCommit 才通知，事务成功后才调用 Provider。Attempt.inputSnapshot 与实际请求同一已解析 DTO，signal 不持久化 |
| `createPublicMessagesBuilder` | Main 生产装配唯一预算门禁；新 Turn 投影 R03 安全字段进入 R05，Repeat 验证真实最新来源并保留原冻结输入，最终完整消息用同一 `countModelTokens` 校验。拒绝不产生候选记录/turn_started |
| Mock 模型计数 | 仅 `modelId=mock` 的玩具词法：文本每最多4个 Unicode 标量一单元；请求2封装单元，每条消息4封装/角色单元加文本单元。Mock生成/usage同一定义；32768上下文窗为该测试模型能力，不能用于真实模型或计费。未知能力/模型/不可信计数器拒绝发送 |
| 可信指令与历史 | application/host 持续指令数组生产暂为空；边界规则、冻结 Agent 角色/提示、任务、已完成公开历史依 R05 顺序。workflow JSON/普通模型文本不取得指令权限；不传私有错误、非公开推理或 Attempt 输入给其他 Agent |
| Retry/Continue | 同一逻辑 Turn、新 requestId/messageId/Attempt；Retry 重放原输入，Continue 追加来源最新部分正文和固定续写提示，新消息只存后缀。下个 Agent 只使用最新 completed Attempt 的新正文；旧 partial 保留检查，不自动拼成完整回复 |
| Renderer | session `repeat`/`recover` 仅调用既有 typed API；pending 隔离世代/命令身份，Main running 快照可确认长命令以允许 Stop。结构变化取权威快照，旧请求流、重复事件、缺口与切换仍走 R06 守卫 |
| 失败语义 | length/content_filter 采用既有 invalid_response，Run error、消息/Attempt failed，保留部分输出；timeout 为 Run error、请求/消息 aborted。公开失败事件映射中文，running 单调屏障和冲突重同步丢弃不可信旧原因；缺安全历史原因时只显示通用提示，不返回 lastError |

共享申请分类：A 已接候选身份/事务顺序/最终预算/Main组装/既有恢复命令/同Turn多Attempt；B 延期可信持续指令生产来源、无Run房间发现、裁剪报告/usage展示；C 来源报告持久化、migration3、公开专用完成原因/持久失败投影必须另获用户批准。R05来源/裁剪报告当前只在构建器返回值中瞬时存在，适配器不保存、不暴露；只能审计最终 Attempt 输入，不能宣称完整来源审计已持久化。

RunService 的缺省三参数 fixture builder 继续支持旧低层测试；实际 Main 必须显式注入本门禁。未来真实 Provider 接入前须登记模型可靠计数能力，不得复用 Mock 词法或移除门禁。本轮不新增 Provider 网络调用。


## R04/R05/R06 主线生效登记（2026-10-16）

完整联合候选d4a0d2742eb28d2441e4d06e8154b8cdd6955336已按用户批准由37766666 fast-forward合main；没有重复合原模块、新merge commit、协议或migration修改。本次main534全回归/265专项/112 Electron专项、类型/构建/双ABI/隔离页面/退出数据均实际通过，见[主线报告](verification/2026-10-16-r04-r05-r06-main.md)，三模块及联合集成verified。上节私有builder/可靠计数/Repeat/Renderer接线现已主线生效，A类已完成，B/C延期边界不因verified自动取消。

上一阶段R04/R05/R06合并时，R07/R08仅ready；当时Room/Agent/History、Provider设置/Key引用等DTO/Schema/数据库/IPC仍待授权总控统一处理。共享前置的最新主线状态见下一节；生产IPC接线仍待联合集成。现有Adapter协议不等于设置CRUD或通用Key IPC已存在，子项目不能自行扩展公共接口或复用Mock词法发真实请求。


## SHARED-R07-R08-01 — 配置与历史共享前置（2026-10-16，已合main验收）

用户已批准共享前置正式合并；1e1f971已fast-forward合main并通过[本轮主线验收](verification/2026-10-16-r07-r08-shared-main.md)。共享前置merged/verified不能用于声明R07/R08功能完成。唯一源码为 `src/shared/schemas/configuration.ts` 及派生 `src/shared/contracts/configuration.ts`，两个 index 导出。完整参数/结果、Database 与 typed API 的差别、文件归属、错误/安全边界见[共享调用手册](R07_R08_SHARED.md)。这取代任务书中待申请的 Room/Agent/Provider/Key/History wire shape，不另建协议。

| 契约 | 消费方 | 冻结规则 |
| --- | --- | --- |
| RoomConfiguration / AgentConfiguration 与 CRUD 输入 | R07 room服务/rooms feature；总控 Database | Main 生成新 ID；新成员 Provider/model 成对，旧半配置可读可修；归档保留历史身份，引用阻止硬删 |
| ProviderConfiguration / ProviderSummary / ProviderModel | R08 settings、R07 摘要选择、后续 Main resolver | providerId 为配置实例；模型身份为(providerId,modelId)；显式Mock/真实/失效区分，禁止隐式回退 |
| KeyReference / KeyStorageStatus / ProviderKeyState | R08与Main KeyService | 替换/删除/目标变更撤销旧引用；session不持久化；仅独立setKey请求带明文，不入普通DTO/日志/历史 |
| RoomMessagePage / RoomRunPage 与 cursor | R07历史服务/feature | 房间作用域、固定首次上界、稳定升序；Run加rowid插入上界，末页null；输入/响应都严格校验 |
| RoomManagementApiContract / ProviderSettingsApiContract | Main服务与将来的Preload | input/output map可执行但尚未注册IPC；沿用既有envelope/error/source验证，不添加通用invoke |
| RoomsFeatureProps / SettingsFeatureProps | 两个独立feature与总控App组装 | api及显式actions注入；R07只收安全Provider摘要和加载状态，不直接引用settings/Key |

本次改变 Main-only KeyService.resolveKey 签名为(providerId,reference)，deleteKey改为providerId，并新增受保护deleteProvider；所有现有调用测试同步，生产唯一调用方目前仅getStatus。Database 旧运行投影形状不变；listAgents增加配置启动门禁。既有 RunEvent.version=1、Run/Turn/Attempt DTO和注册IPC集合不变。migration3只追加配置字段/索引，1/2原文不改。

待联合集成：真实 room/settings 服务实现后由总控注册双端handler/Preload、组装Main/App、刷新Provider摘要及R06选择投影，敏感命令独立脱敏。未接线方法不能假报可用。真实网络/factory能力留R09/R10，自动化仅Mock/fixture；真实配置当前明确unsupported且不创建请求。


## R07/R08 联合接线（2026-10-17，已合 main、补充验收完成）

获批候选d3205b2c3fba2061437150e87a87508d44fbb660已从c1b5bea按授权ff-only合main，两个模块各引入一次。下列契约实现已合入；前次验证脚本失败已保留，本次仅修验证入口并实际完成18/18真桥断言及退出审计，现verified；见[主线及补充记录](verification/2026-10-17-r07-r08-main.md)。Database、配置Schema、migration1/2/3、package/lock与原main字节一致。

- 完整 RoundtableApiContract 保留 room/run，增加 rooms/settings；RunSessionApiContract 仅投影所需 room/run。38 条受限 invoke 直接引用同一 input/output 契约，无通用 invoke/send、Key resolve 或文件能力。
- 同一 Database 注入 RunService、RoomService、KeyService 和 ProviderSettingsService。Main 为唯一数据写入者；真实网络未接入时明确 unsupported，没有空成功 handler。
- Main/Preload 都验证输入/输出及实体、Provider、房间和分页固定上界。异步成功和失败返回前重新校验 sender、senderFrame 与可信顶层页面；失信来源不能收到迟到响应或敏感事件。
- **Bridge Promise 拒绝值为严格 ApiError 普通 DTO**（code、固定 message、retryable、可选白名单 field），不再依赖 Error/ContractError 实例、detail 或 stack。Main 内部 ContractError 保留，成功值和 IPC envelope 不变。真实 contextBridge 会剥离自定义 Error 字段；plain DTO 经候选阶段实际 Electron 实验证明能保留安全字段且不带内部路径/堆栈；本次补充授权已另行实际完成invalid_input/not_found两路径18项精确字段断言，不以该历史实验替代。
- IpcDisposer 立即撤注册/订阅，drain 等待已接受的 rooms/settings 操作结算。Main 关库前等待当前与已关闭窗口的配置操作；来源撤销不回滚、不重试已接受写入。Run 控制不加入此集合；后端永不结算时仍会等待，不能提前关库造成迟到写入。
- RoomsFeatureProps 增加可选 onClearRoom()、initialRoomId。App 先恢复 Run 再挂 Rooms，找回归档房间，恢复失败保留重同步；末房删除/归档/过滤清除旧 Run、订阅投影和恢复位置。
- Provider 创建/修改/删除、存 Key/删 Key 在结算后统一刷新安全摘要，离开设置仍有效。历史身份通过 Attempt→Turn→Run 冻结成员读取，未知显示未记录，不查当前配置覆盖。
- RunService 统一 schedule 在任何状态修改前重新校验冻结 Provider/model，真实、禁用或失效配置禁止用当前 MockAdapter 执行。旧 Demo 只兼容 null Provider + mock model。R09 必须统一实现真实 resolver，不能仅删除门禁。

共享文件仍归总控独占。上一阶段补充验收时R07/R08及联合集成merged/verified，R09仅ready、未授权；R09当前状态以下节主线登记为准。补充真桥实际验证普通对象/原型、精确code/固定message/retryable、严格自有字段与白名单field、无Error内部字段/堆栈/秘密回显。invalid_input是Preload拒绝到Renderer，not_found是Main→IPC→Preload→Renderer；未新增或修改产品契约，真实网络与系统Keychain仍未验证。


## R09 主线：Provider 实例、会话目标与生成门禁（2026-10-17）

本节协议已随获批f3a8fee以ff-only合main，本轮[主线fixture验收](verification/2026-10-17-r09-main.md)通过；不覆盖 R07/R08 的稳定引用、Key 修订/CAS 及冻结成员规则。真实公网模型/计数/费用与系统Keychain未验收。

- 唯一新增 IPC 为 `settings.confirmTarget({providerId, baseUrl, confirmed:true}) -> {providerId}`；Shared Schema strict，Main/Preload 双向校验并核对返回 providerId。普通 Bridge 不含 resolveKey、通用 invoke/send 或策略注入能力。现有 `settings.testConnection` 仅增加可选 `allowGeneration:true`；真实生成测试必须显式提供，缺失即拒绝。configuration 为本地校验，获取列表/鉴权均不证明生成可用。
- Main `ProviderRegistry` 以稳定 providerId 读取当前配置及 KeyService 引用。会话确认绑定规范化目标、kind、key_revision；重启、目标/类型变更、Key 更换/撤销/删除重建后不能沿用旧确认。Key 异步读取后、DNS 后、TCP/TLS 连接完成发送前复核；stream 每个结果、列表与鉴权结果完成后再复核，防迟到成功。已发出的请求不能被解释为未发生或未收费。
- `RunService` 新增可选第四构造参数 Registry；生产 Main 必须提供同一实例给 RunService 与 ProviderSettingsService。按冻结成员 providerId/modelId 选实际 Adapter，绑定模型的 Adapter 不接受其他 modelId。R05 resolver 增加 member 参数，预算按实例与模型查询。Database.listAgents 的可选可信 Main 验证回调只开启已校验的真实引用；不提供回调时保留旧 Mock 门禁。旧 null Demo 兼容只适用于原始未配置记录。
- Main 专属 `ApprovedModelPolicy` 必须有可追溯计数方法（exact/upper_bound、模型身份匹配）、上下文窗口、输出上限、明确输出参数、输入/输出费率依据及单请求费用上界。计数/窗口/输出能力/费用任一未知或超限，在 Key/网络调用前拒绝。手动模型不以列表作为白名单。生产默认目录没有获审真实模型规则，真实生成明确 unsupported；不得拿 Mock 词法或厂商名称补数据。fixture 仅注入自有本地模型与零费用，不是官方模型计数或定价证据。完整费用账本仍留 R13。
- 兼容端点不推测 capabilities，默认列表/鉴权/生成都 unsupported；官方列表/鉴权遵循现有 OpenAI 路由声明，但具体模型生成仍受独立规则门禁。真实网络操作只由用户显式动作触发，不自动重试或回退 Mock。
- Node 原生 transport 对全部 DNS 结果检查，HTTPS 仅公共地址、HTTP 仅显式 loopback；固定地址/家族、禁代理复用和重定向，保持 TLS 主机名/证书验证。凭据直到连接完成并复核后才发送；支持取消和流关闭。只请求 identity 编码并拒绝压缩响应，不宣称支持 gzip/br。
- 共享错误 `forbidden` 的固定 message 改为 `Permission denied`，code/retryable 不变；IPC 来源拒绝自身的内部异常保留，不将 Provider 403 错报成 IPC 来源错误。没有新增事件版本、usage 字段或 migration；usage 继续按已有带身份事件持久化，providerRequestId 缺失保持 null，不用 SSE completion id 伪造。

## DeepSeek 安全准备主线（2026-10-18）

总控在`codex/deepseek-safety-prep`独占Main策略/Adapter/专项接线；本节不改变公开Shared DTO、IPC/Preload、事件版本或数据库。用户批准的30d5783已从dc387146以ff-only合main，本轮[独立主线复验](verification/2026-10-18-deepseek-main.md)通过；只验收安全准备。实际范围和未解除阻塞仍见[原准备报告](verification/2026-10-17-deepseek-preparation.md)，本轮不注册counter或续期价格。

- Main-only ApprovedModelPolicy.price保留既有USD字段，新增明确`currency:'CNY'`分支：inputMicroCnyPerToken/outputMicroCnyPerToken/maxRequestMicroCny均非负安全整数；reviewedAt/expiresAt/evidence必须有效且当前在审查窗口内。同币种整数比较，无汇率/缓存折扣猜测；已有guard会重新校验。新增可选maxInputTokens与真实模型contextWindowTokens分开，未知计数仍拒绝。
- ChatCompletionCapabilities新增唯一受限字面字段thinkingDisabledForModel:'deepseek-flash'，只能由可信Main提供；SDK只对该modelId加入thinking.disabled，无通用extra_body或Renderer扩展能力。默认cap仅匹配openai-compatible+规范化后精确https://api.deepseek.com，列表/鉴权仍unsupported。
- deepSeekFlashReview只是2026-10-17官方证据和候选1024输入/128输出、¥0.05限制，不是已批准counter。生产没有注册DeepSeek ModelPolicy；完整1017 API Token/隐式封装对应性未证实，DEEPSEEK-TOKEN-01保持blocked，生成先于Key/请求拒绝。单Agent限制仅验证本地fixture，不扩展调度契约或默认开放真实调用。
- 本轮没改Mock价格/词法、RunService、状态机、KeyService、Shared或migration1/2/3。后续启用仍需计数证据、重新核价、独立审核/合入及用户明确的真实调用授权。

## DeepSeek 单次受控测试候选（2026-10-18，未合 main）

用户另行授权“请求前估算＋费用预留＋响应 usage 核算”，本候选由总控独占 Main、Database、migration4 及公共测试。完整证据见[交付报告](verification/2026-10-18-deepseek-controlled-trial.md)和[命令台账](verification/2026-10-18-deepseek-controlled-trial-commands.md)。这是独立试验入口，不将估算注册为普通 Run 的 `ApprovedModelPolicy` 或 R05 计数器；Shared DTO、IPC、Preload、Renderer、事件协议及 Mock 预算不变。

| Main 私有接口 | 冻结规则 |
| --- | --- |
| `estimateDeepSeekInput(messages)` | `estimated` / `unknown`；单条短 ASCII user 文本使用官方英文字符比例加未校准封装余量。`strictUsable:false`，不是本地 Tokenizer、精确值或可证明上界；响应 `provider_usage` 单独区分 |
| `ControlledTrialService.prepare(providerId)` / `execute(quoteId)` | 精确 DeepSeek 配置与会话目标确认；固定 `Reply OK.`、单 Agent/请求、输出128、20秒。报价至多2分钟且不超过价格有效期；报价不读 Key/不发请求。执行消耗单次报价并等待 Main 原生逐次确认，取消/Stop/退出不可被迟到确认复活 |
| `ProviderRegistry.controlledTrialTarget` / `streamControlledTrial` | Main-only；绑定稳定 Provider ID、Key 修订、精确 root/model。保留原有 Key 归属、目标确认、DNS/连接后守卫、禁止重定向/自动重试；固定请求形状，真实参数 `max_tokens:128`、`thinking:{type:'disabled'}`。普通真实 Run 仍无获审策略而拒绝 |
| Database `reserveControlledTrial` / `updateControlledTrialProgress` / `finishControlledTrial` / `listControlledTrials` / `recoverControlledTrials` | 权威 SQLite 唯一仓储；先事务预留50000 micro-CNY（¥0.05）再解析 Key。只在完整终结流＋合法 usage 后核算；中断/错误/缺 usage 保持 `unknown`、实际费用 NULL、完整预留及部分文本/已观察 usage，不填零、不重发。启动 `reserved→unknown/interrupted` 幂等 |
| `RunService` 可选第五参数 `assertGenerationAllowed` | 生产 Main 双向注入互斥：普通 Run 活动时试验拒绝，试验等待确认/请求中时新建及恢复普通 Run 拒绝。默认 callback 保持既有调用兼容；不改 R04 状态机 |
| Main 原生“受控测试”菜单 | 仅此入口申请逐次确认；普通 Bridge 无试验权限、无 `resolveKey`。关窗检查试验忙碌状态，退出屏障等待 Run 和试验全部结算再关闭 DB |

新增 migration4 仅建立 `controlled_trials` 及全局唯一未结预留索引；migration1/2/3 原文不变。request_id 唯一，JSON/身份/关键索引在恢复校验中检查。记录不外键绑定可删除 Provider，保存历史证据；不存明文 Key，不提供清零未知预留的通用接口。后续 migration 编号由总控重核主线后分配，其他分支不得同时占用4。

本候选价格快照核验于北京时间2026-10-18，高峰未命中输入¥2/M、总输出¥8/M（推理 Token 属输出，不另加一遍），有效至北京时间2026-10-19 00:00；过期拒绝，不自动续期。¥0.05 是客户端预留而非服务商账单绝对硬上限。原 DEEPSEEK-TOKEN-01 的严格上界证明仍 blocked；本轮未获真实请求授权，main 未改变，候选等待用户审核及合并授权。

### 单次受控测试主线生效登记（2026-10-18）

以上候选已按用户最终授权，从 `ae5c24c6dd1410aedba6ef31894470b7cb668c8a` 严格ff-only合入完整 `db97b95c8d7ce279d76d304d9f4c9ea64259d16a`；本次main独立必要检查通过后，DEEPSEEK-TRIAL-01仅在本地fixture范围merged/verified，见[主线证据](verification/2026-10-18-deepseek-controlled-trial-main.md)。上述Main-only契约/migration4现已生效；本轮没有继续修改源码、Schema、IPC或测试。严格计数blocked、逐次明确确认、过期拒绝、unknown不释放、Key/目标/DNS安全规则及未验收边界不变。合并授权不是付费授权。

## DEEPSEEK-DIAG-01：受控测试安全诊断候选（2026-10-19）

本节仅为独立候选，未合 main，不授予真实请求或解除未知费用的权限。

- 自定义 `transportFactory(guard, diagnostics?)` / `createTransport(guard, diagnostics?)` 覆写须原样转发可选observer，不能保证丢弃observer的外部临时包装器具有底层分阶段诊断。
- Main-only `DiagnosticObserver` 从 `ProviderRegistry.streamControlledTrial` 经 Adapter 到 `createSafeFetch` 传递。普通 Shared DTO、IPC、Preload、Renderer 和 Run 协议不扩展，通用错误 DTO 保持固定脱敏语义。
- `TrialRecord.diagnostics?` 是严格白名单 JSON：版本1、阶段、类别、开始/更新时间、可选客户端调用/HTTP响应时间和100–599整数状态码。禁止异常文本/堆栈、原生 errno 任意字符串、请求头、凭据、URL 和原始响应。仅观察已发生的阶段，首个失败保留；持久化失败单独归费用核算/记录失败。
- 证据单调升级：`not_started` 未开始网络调用；`client_invoked` 已调用网络客户端、服务商是否收到未知；`http_response` 已观察到HTTP响应，仍不证明生成或计费结果。SDK、TCP连接或 `.end()` 不能升级为服务商收到。
- 沿用 migration4 表的 `data_json` 可选扩展，不新增 SQL 列/索引/migration，不改变 migration1–4。新代码读取旧记录时保留诊断缺失，不从历史 `network_error` 推测原因。旧版 strict reader 不认识新诊断字段，因此不承诺旧二进制读取新记录；不能将新数据交给旧版应用或旧版恢复校验器。升级前须保留兼容备份，未来降级另行审查。
- `updateControlledTrialProgress` 和 `finishControlledTrial` 接受经 Schema 验证的可选诊断；结算只在完整流及合法 usage 时执行。诊断/进度/结算写入失败不清零费用或释放预留；持续写失败保持原预留供启动恢复，不伪称已成功保存最终诊断。终态后不接收迟到网络诊断。
- 原生最近记录和结果显示固定中文诊断；查看记录不读 Key、不联网。旧 unknown 与 ¥0.05 预留须保留，只有真实服务商账单证据可供人工核对，本候选没有核销/清除权限或新自动重试入口。

### DEEPSEEK-DIAG-01 主线生效登记（2026-10-19）

用户最终授权后已从524f505严格ff-only合入完整7599949087e0fc0a09c6ca99a33a376eaba9d3f7，main必要独立验收全部通过，诊断仅在本地fixture/安全边界范围merged/verified；见[本次主线报告](verification/2026-10-19-deepseek-diagnostics-main.md)。上述候选契约已生效，migration1–4及普通Shared/IPC不变。当前App未部署本候选；unknown/完整预留、计数阻塞、过期拒绝和每次原生确认保持，没有核销或新联网许可。新代码不能追溯首次失败，不能证明真实Key或网络正常。

### DEEPSEEK-LAUNCH-01 主线生效（2026-10-19）

获批f04候选已严格ff-only合main并通过[独立验收](verification/2026-10-19-deepseek-launcher-main.md)。受控包装器必须转发streamControlledTrial第四参数和createTransport第二参数diagnostics；不记录原异常、请求头或凭据。仓库内prepare/open绑定最新干净main及产物/关键依赖；保留原profile/data/appName/Keyguard身份，拒绝活动旧进程，默认cancel-only且不claim旧许可。Shared/IPC、数据库migration1–4及预算协议未改变；新诊断不能倒推旧network_error。原unknown/¥0.05只读核对一致，无核销/新授权。


## DeepSeek 最终收尾契约（2026-10-19）

本次总控独占 migration5、Database、原生菜单与启动器；不增加通用IPC、resolveKey、普通Run豁免或新Provider能力。

- migration1–4原文保持。migration5新增 controlled_trials.reservation_released（默认0）和 controlled_trial_reconciliations；保留原trial state/data_json。全局未处理预留唯一索引改为 reserved/unknown且marker0；每trial最多一个release，审计append-only。旧unknown默认继续阻塞，迁移本身不释放。
- Database.hasUnresolvedControlledTrials()直接查询全部未处理预留，不依赖最近100条；reserve与Service共同使用。reconcileControlledTrial仅Main原生明确操作调用，严格校验trial/request/provider/Keyrevision、固定页面证据枚举、决定及uncertainty acknowledgement；DB生成时间/id并原子写audit/marker。listControlledTrialReconciliations用于只读展示；不给Renderer写入口。
- 控制台0用量仅是用户页面核对声明，非provider_usage或绝对零费用证明。不得把unknown变成settled或填usage0。固定证据说明不接受自由文本、请求头、凭据或异常堆栈。30天证据不应用于范围外记录。
- 启动器默认未授权。仅原生准备入口捕获生产Service的结构化quote，双原生确认后建立session内绑定providerId/requestId/Keyrevision/报价期限的lease；固定目标/body/TLS/proxy门禁继续检查。取消/Stop/关窗/退出撤销；无自动retry/恢复，普通真实Run严格门禁不变。
- 重新核价于2026-10-19T11:08:06Z，deepseek-flash=DeepSeek-V4.1-Flash-1017；CNY高峰缓存未命中输入2/百万、总completion输出8/百万，不使用缓存或闲时折扣。官方缓存命中高峰0.04/百万仅记录证据不折算费用；24小时快照，2026-10-20T11:08:06Z到期拒绝。新的报价不是付费授权。

本节已随实施715c2ebe获授权ff-only合入main，并通过独立主线验收；状态merged/verified仅限本地fixture和安全操作路径，真实模型调用仍未经本轮授权。人工决定不能改写首次历史结论。


## Provider Catalog 契约规划边界（2026-10-20，未实施）

[目录增强规划](PROVIDER_CATALOG_PLAN.md) 只登记未来要求，本轮不新增已生效 DTO/IPC、Schema、ProviderKind 值、migration 或政策。品牌/平台是目录元数据，kind 沿用协议类别；Provider 实例仍是稳定 providerId，Model 是 (providerId, modelId)，预设标识不得代替它们或串用 Key。目录数据不能自动生成可用计数/价格政策、网络授权或通用请求入口。

未来由总控冻结 preset 身份/修订、协议/鉴权白名单、经核实默认 URL、模型/能力/证据/有效期的概念到正式 wire shape 的映射；Registry 能力与模型政策继续 Main-only，未知/过期不伪造、不静默回退 Mock。具体目录/API/存储变化先完成兼容性及必要迁移审查，再分配唯一文件归属。目录更新不覆盖用户配置/Key 或历史成员快照；目标变更沿用撤销/重新确认。

当前 R10A/R10B/R11 的 Shared/Registry/Main/IPC/Preload/App 接线申请仍按各自原任务执行，不因目录规划争用文件；三模块不负责实现目录或大量预设 UI。目录不改变现有 DeepSeek 单次许可、限定目标/代理、费用未知保留及普通真实 Run 的安全门禁。

## R12 主持人命令与消息版本（2026-10-21，子会话候选，未合 main）

总控授权 R12 子会话（分支 `codex/r12-host-message-versions`）直接修改本节列出的共享文件；共享改动以 `contract:`/`wire:` 提交与模块提交分开，等待总控审查合并。决策依据见 [DECISIONS](DECISIONS.md) D081–D088。

| 层 | 变化 | 兼容性 |
| --- | --- | --- |
| Shared `schemas/host.ts`（新） | `hostCommandSchema`：strict 判别联合，`kind` ∈ interject/setOverride/cancelOverride/setInstruction/clearInstruction/editMessage/regenerateMessage/selectVersion/abortGeneration，统一带 `runId`、`clientRequestId`；文本原样保留、拒绝纯空白（消息 ≤20000、指令 ≤4000 字符）。结果 `{runId,actionId,kind,duplicate}`。`messageVersionSchema`、`hostStateSchema`（pending override、指令最新修订、最近 200 条动作、进行中的版本生成） | 新增文件 |
| Shared `schemas/run.ts` | `turnSnapshot.overrideActionId?`；`runSnapshot.versions?`/`host?`（superRefine：每槽恰一个有效版本、父版本与依据都在快照内、请求身份与 Attempt 一致）；新增 run 级事件 `host_updated {actionId,kind}`（无 turnId/requestId），订阅校验按 run 级事件处理 | 只增可选字段/事件；旧 Renderer 遇未知事件按既有规则重同步，但同构建交付 |
| Shared `schemas/error.ts` | `ErrorField` 增加 clientRequestId/kind/agentId/instructionId/content | 只增枚举值 |
| Shared `contracts/ipc.ts`、`app.ts` | 新通道 `host.command`（输出须与请求 runId、kind 一致）；`RoundtableApiContract.host.command` | 新增通道；无通用 invoke |
| Preload | `window.roundtable.host.command` 仅转发该 typed 通道 | Bridge 键集合变为 host/room/rooms/run/settings |
| Main IPC/装配 | `registerIpc` 服务参数增加 `host`；`host.command` 计入关窗前待完成写入；`main/index.ts` 组装 `HostService(database, runService)` | — |
| Database / migration6 | 新表 `host_actions`（每 run 的 clientRequestId 唯一、同一 run 至多一个 pending Override、身份不可变、仅 pending→consumed/superseded/cancelled/expired、run 存在时禁删）、`host_instruction_revisions`（不可变修订，content NULL 表示清除）、`message_versions`（槽、序号、来源、动作、依据 basis_json）、`message_slots`（每槽当前有效版本）；`turns.override_action_id`；回填既有消息为版本（Turn 一槽、最新 Attempt 有效、续写按固定提示识别、basis 为空），`messages.parent_version_id` 开始使用 | migration1–5 原文不变；validateDatabase 增加 v6 结构与一致性检查；启动时把任何遗留 running/pending Attempt 标为 interrupted、streaming 消息标为 aborted |
| RunService（Main 私有） | `assertOverrideAllowed`、`applyHostChange`（变更与 `host_updated` 同事务）、`regenerateMessage`、`abortGeneration`、`isRegenerating/isExecuting`；调度先消费 pending Override；计划进度只计非点名 Turn；结算/证据改为"每个 Turn 的有效版本"；retry/continue/recover 在已有执行上下文时拒绝（invalid_state） | 无 Override/编辑时行为与原 R04/R11 相同，原测试全部通过 |
| R05 context（Main 私有） | `contextInput.snapshot.versions?`（缺省仍按最新 Attempt）；`current.mode: 'regenerate'`；非有效版本 `inactive_version`；主持人修改版本以 `editedByHost:true`、受影响内容以 `basedOnRevisedHistory:true` 标注；后续版本保持其槽的原位置；有效持续指令作为 host 指令进入 system 段 | 新增可选输入 |

安全影响：主持人权限只来自 `host.command` 可信通道；模型文本、引用和历史从不被解析为命令。命令不读取 Key、不新增网络能力；重新生成复用原成员冻结的 Provider/Model 与既有生成门禁和预算，只在显式命令后发送，不自动重发。

## R13A 真实模型（DeepSeek）启用与运行预算（2026-10-22，子会话候选，未合 main）

R13A 子会话（分支 `codex/r13a-real-model-enable`，基线 R12 `15e2e30`）经总控授权直接修改本节列出的共享文件；共享改动以 `contract:`/`wire:` 提交与模块提交分开，等待总控审查合并。决策依据见 [DECISIONS](DECISIONS.md) D089–D094。

| 层 | 变化 | 兼容性 |
| --- | --- | --- |
| Shared `schemas/budget.ts`（新） | `requestChargeSchema`（状态 reserved/settled/unknown/not_sent；superRefine：settled 的 accountedMicro 必须等于用量×冻结单价，chargedMicro 由状态决定，unknown 不能为 0）、`runBudgetSchema`（CNY 上限、已结算/未知/在途预留/剩余/超出）、`budgetBlockSchema`（insufficient/overrun）、`runBudgetInputSchema`（1–1,000,000,000 micro-CNY）、默认 ¥1、`formatYuan`、`budgetBlockMessage`（中文拒绝原因，Main 与 Renderer 共用） | 新文件 |
| Shared `schemas/run.ts` | `startRunInput.budgetMicroCny?`；`runSnapshot.budget?`/`charges?`（superRefine：charge requestId 唯一且都对应快照内 Attempt） | 只增可选字段 |
| Shared `schemas/error.ts` | 新错误码 `budget_exceeded`（不可重试）；`ErrorField` 增加 `budgetMicroCny` | 只增枚举值；Renderer 设置页补中文文案 |
| IPC / Preload | 无新通道；`run.start` 输入与 `run.*` 快照随 Schema 自动带上新字段 | — |
| Database / migration7 | `run_budgets`（每 run 一行，CNY，上限不可变、禁删；`blocked_json` 记录拦截原因；迁移时为已有 run 回填 ¥1）；`request_charges`（主键 request_id → request_attempts；插入只能是 reserved；单价/上界/预留/证据不可变；状态只能 reserved→settled/unknown/not_sent 一次；结算后用量与金额不可改；禁删；CHECK 保证 reserved = 输入上界×输入单价 + 输出上限×输出单价、settled 金额与用量一致、非 CNY 只允许零单价）。启动恢复把残留 reserved 改为 unknown。`validateDatabase` 对 v7 校验表、7 个触发器、每个 run 都有预算行、charge 身份与证据 | migration 1–6 原文未改；当前 schema 版本 6→7，相关测试断言同步 +1 |
| ProviderRegistry（Main 私有） | `quoteRequest(providerId, input)`：先做 `checkGeneration`，返回本次最高花费（CNY 整数；非零 USD 价格 → unsupported，不做汇率换算）；`getAdapter(…, onDispatch?)`：真实 adapter 唯一的 fetch 出口在发出前回调，用于证明"未发出"；`createTransport(guard, diagnostics, proxyKind?)`；回环代理按 kind 选择固定目标（deepseek/anthropic/gemini），其他 Provider 在代理模式下 forbidden。默认构造仍不批准任何模型，生产 `main/index.ts` 注入 `deepSeekModelPolicy` | `transportFactory` 回调多一个可选参数 |
| RunService（Main 私有） | 请求准备事务内：quote → 剩余额度检查（等于可发）→ 写 Attempt 后预留 charge；终态 usage → settled；已发出但无 usage/中断/停止 → unknown（全额预留）；从未到达网络 → not_sent；用量超出上界 → 记 overrun 并停止调度；预算不足 → 不建 Turn、run 以 error 结束、lastError 为中文原因 | 公开命令不变 |
| Renderer | `features/usage/**`：每条消息的用量与花费、运行预算栏；输入框旁"本次预算（元）"；预算拦截的页头与错误文案；设置页"本次会话尚未确认请求目标"提醒；启动失败按 forbidden/unsupported 给出原因 | — |

安全影响：真实生成只对精确 `openai-compatible` + `https://api.deepseek.com` + `deepseek-flash` 放行，且仍需本次会话确认目标、Key 和未过期的价格审核；花费上界在读取 Key 和发出请求前计算并预留，账本只能按证据结算，未知费用永不记 0。Key 处理、IPC 白名单和 Renderer 权限不变。

## 合并前质量修复（2026-10-23，子会话候选，未合 main）

分支 `codex/r13a-premerge-quality`（基线 `b3e3324`）。总控授权本子会话直接修改共享文件；共享与接线改动以 `contract:` / `wire:` 提交。决策见 [DECISIONS](DECISIONS.md) D095–D098。

| 层 | 变化 | 兼容性 |
| --- | --- | --- |
| Main `context/**` | 新增 `transcript.ts`；`buildPublicContext` 输出改为 D095 格式（system：边界、发言要求、阶段指引、持续指令、成员身份；随后 user/assistant 交替并以 user 结束）；`ContextSource` 新增 application 来源 `discussion-rules-v1`、`turn-cue-v1`，多个 history 来源可共用同一 `providerMessageIndex`；计数对最终消息进行，加入历史须严格增大计数 | Provider DTO（role/content）不变；已冻结的 `input_snapshot` 不改写，retry/continue 仍按冻结输入重放 |
| Main `workflow/definition.ts` | 十个阶段指引改写为"本轮阶段：…"并写明本阶段应新增的内容 | 文案变化 |
| Shared `schemas/common.ts` | 新增 `looksLikeApiKey`、`modelIdSchema` | 新导出 |
| Shared `schemas/configuration.ts` | `defaultModelId`、`customModels[].id`、`agent.modelId`、连接测试 `modelId` 改用 `modelIdSchema`；`providerConfigurationSchema.withheldModelIds?: true`、`agentConfigurationSchema.withheldModelId?: true`；`providerKeyStateSchema.sessionTargetConfirmed?: boolean` | 只增可选字段；输入新增拒绝条件（类密钥值） |
| Shared `schemas/provider.ts` | `streamChatInputSchema.modelId` 改用 `modelIdSchema` | 类密钥模型 ID 在发送前被拒 |
| Database | 读取 Provider / 成员时隐藏类密钥模型 ID 并打标；`validateModelSelection` 用 `modelIdSchema` | 无 migration，不改存量数据 |
| ProviderRegistry / ProviderSettingsService | `isTargetConfirmed(id)`；`getProviderKeyState` 在有注册表时附带 `sessionTargetConfirmed` | IPC 通道不变 |
| Renderer | 设置页接入进度、Key 输入框就近原因与一键操作、模型 ID 示例与类密钥提示；成员编辑器同样提示；App 主持人控制把停止分开并就地确认，重试/续写提示可能再次计费 | — |

安全影响：防注入边界从"JSON 字段 + 角色"变为"应用标签 + 全行引用"，可信指令仍只在 system 段；Key 不再可能以模型 ID 的形式进入请求、Renderer 或日志；会话目标确认机制与失效规则不变。
