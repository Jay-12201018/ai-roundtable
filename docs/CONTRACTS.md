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
