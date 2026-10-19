# 架构与工程决策


## 多服务商目录产品决定（2026-10-20，规划已记录、实现未启动）

用户明确最终支持多服务商官方/兼容 API 和用户自定义服务，保留原生 OpenAI/Anthropic/Gemini 并复用 R09 兼容实现。目录作为 R08/R09 后续增强，不按品牌复制 Adapter，不新增 R 编号或扩充当前 R10A/R10B/R11 文件范围；其原已批准研发顺序不变。预设是带证据/有效期的配置元数据，不是 API 权益或付费授权，未知能力/价格须如实保留。

独立 providerId/(providerId,modelId)、Main-only Key、用户目标确认、TLS/网络/预算门禁与冻结历史继续沿用。推荐三模块必要集成后单独安排增强，非 R11 当前前置；R13/R16/R17 分别承接费用、体验及最终验证，不自动启动这些任务。详见[对应关系及验收规划](PROVIDER_CATALOG_PLAN.md)。


## DeepSeek 三项最终收尾（2026-10-19）

总控获授权一次实现报价刷新、人工预留处理、会话单次许可及必要验证后ff-only合main，不再拆独立纯审查任务。人工决定与服务商usage分开：新增migration5/audit+marker保留原unknown证据，不能伪造0用量或由升级自动释放。菜单只接受固定安全证据并由用户两层确认；准备本轮不操作实际旧预留。

真实生成仅可在明确Provider选择、会话许可和最后原生确认后走既有固定HTTPS网络通道；配置、报价、迁移或打开软件均不构成发送授权。生产wrapper可读取可信构建导出的Service/报价绑定quote，不解析展示文本、不读取真实Key。旧原生入口维持无许可不能发，普通真实Run继续blocked。

使用官方当前高峰缓存未命中价格，24小时有效；保守usage核算不宣传为实际账单或绝对上限。真实请求/Keychain/当前用户profile完全不参与本轮验证。详细证据见[收尾验收](verification/2026-10-19-deepseek-final-readiness.md)。

## DEEPSEEK-PROXY-01：正式合并（2026-10-19）

用户明确批准后从1c4d2af严格ff-only合入04bf8a20，并在main上新跑本地代理/诊断/启动器、完整回归、strict、独立生产构建及隔离生产/重启后，登记merged/verified。没有业务修补、重建main原生文件或覆盖运行中构建；复用有效原生环境，但不把候选历史成绩当新PASS。详细[主线证据](verification/2026-10-19-deepseek-loopback-proxy-main.md)。实际代理/公网验证和新发送许可须另行授权；以下为保留的候选设计记录。

## DEEPSEEK-PROXY-01：显式受限回环 CONNECT 候选（2026-10-19，历史）

- 直连安全策略不变；不放行198.18/15。仅用户显式信任的回环 HTTP 代理可代为解析固定 DeepSeek HTTPS 域名；不自动采用系统/环境代理，不支持代理凭据、任意兼容域名或失败降级。
- 普通域名 CONNECT 不能证明远端 IP 公网；信任用户指定代理及 OS CA，凭据仅在固定 origin 的 TLS 证书/SNI/主机名验证后发送。要求远端公网 IP 证明时继续拒绝，不能宣称已有证明。
- 受控 gate 绑定同一 CONNECT/tunnel/TLS socket 和一次固定 POST。代理状态不作为服务商响应证据；原生确认/预算/未知保留/普通严格模式门禁不变。
- 本候选不改 migration/Shared/价格，不部署/重启用户 App、不访问原 Key/DB、不发送公网模型请求。测试、失败与限制见[报告](verification/2026-10-19-deepseek-loopback-proxy.md)。状态 review，等待用户合并授权。

2026-10-13 R00 建立。每条记录日期、决定、理由、影响和验证边界；改变决定须追加替代记录，不能把目标改写为历史事实。

D001–D015 为 R00 阶段记录，后续落地与授权变化见追加决策及 [STATUS](STATUS.md)，保留历史阶段事实。

| ID | 决定 | 理由与影响 | 当前状态 |
| --- | --- | --- | --- |
| D001 | 保留 main 原始提交 135bf82；渐进升级现有工程 | 保留可回溯基线、源码和测试，不重新初始化 | 已执行基线核对；R00 在 main 文档提交是用户明确例外 |
| D002 | Main 为 Run/Turn、Provider、DB、Key、写盘权威 | Renderer 只投影和发命令，模型文本不能控制调度 | 现有基础；状态机强约束与完整 IPC 待 R02/R04 |
| D003 | 本地单用户 BYOK，Agent 串行生成，Mock-first | 不引入云账号、云同步或 Agent 并行生成；先建立可测协作输入 | 已批准目标；当前仅固定 Mock |
| D004 | Shared、migration、IPC/Preload 注册、组装和依赖由总控管理 | 消除独立 Worktree 抢公共文件/迁移号；按模块审查合并 | R00 治理生效；当前不创建 Worktree |
| D005 | 保留 SQLite 与参数化事务；已发布 migration 不改写 | 维持数据历史；一致性备份、执行元数据和恢复由 R03 补齐 | 当前仅基础持久化，不能称完整恢复 |
| D006 | 不自动重发中断请求；重试创建新请求证据 | 避免重复收费，保留部分输出和消息版本 | 已批准目标；重试入口当前仍占位 |
| D007 | 正常退出终结活动 Run；异常非终态转 interrupted | 解决 paused 上下文丢失；跨进程恢复须显式决定 | 待 R01/R03/R04 实现，不在 R00 修复 |
| D008 | maxDurationMs 为累计执行时长，暂停不计，Resume 不清零 | 统一限制语义；活动请求必须能因超时取消 | 待 R04；当前循环会重新计时 |
| D009 | 真实输出限制由 Provider 参数落实，费用为估算并设置调度守卫 | 增量数不是 Token；未知价格且设置费用上限时不自动调度 | 基本限制 R04/R05，费用 R13；当前缺失 |
| D010 | Key 系统保护或会话内存；普通响应不返回明文 | safeStorage 不可靠时不持久化；表单明文短暂保留 | 当前 KeyService 模块存在，完整链路待 R08 |
| D011 | 代码候选先预览/diff/路径验证/逐文件确认，不执行代码 | 文件写盘是可信 Main 操作，防越界与覆盖竞态 | 待 R14/R15 |
| D012 | 功能决定布局，体验决定交互，参考产品仅提供视觉审美 | 不照搬页面；宽窗口可三职责，窄窗口折叠；统一双主题 | 设计规范建立，现有 UI 不变，后续 UI 验收执行 |
| D013 | 不把 sandbox:false 当最终安全设计 | 当前 ESM Preload 为临时兼容选择；收紧导航与 sender，验证可行 sandbox | 当前临时状态，待 R01；R00 不切换构建格式 |
| D014 | 每次验证独立记录，空测试集失败，测试隔离用户数据 | 类型、测试、build、ABI、桌面与跨平台分别报告 | R00 收紧配置；证据见本次验证记录 |
| D015 | 首个真实闭环默认 OpenAI 与兼容端点，随后 Anthropic/Gemini | 先验证共用接口，再并行供应商适配；四类 Provider 目标保留 | 已批准路线中的默认排序；未执行网络调用 |

## R00 约束与实施记录

- 原始 SPEC 可读取后纳入根目录；仅按用户新指令更新固定三栏表述，并加仓库内导航，不自行增加完整产品需求。
- 只改文档、忽略规则和两处空测试配置；不改 src、已有测试、lockfile、原生脚本和业务逻辑。
- native 重编译仅用于已安装依赖的 Node/Electron ABI 切换，不安装或升级依赖。其结果必须独立验证；build 本身不证明 ABI。
- 主提交为 a17c649422c69696da91df081cb21d6d260a54cb，已在 STATUS 固定。提交后发现原主题查询的末尾锚点无法匹配提交消息，追加仅文档修正提交并在最终交付报告其 SHA；保留已创建提交和原始历史，不 amend/reset。

## R01 集成候选决策（2026-10-13，待最终审核）

| ID | 决定 | 理由与影响 | 验证边界 |
| --- | --- | --- | --- |
| D016 | R01 在最新 main `462a43a` 的独立 `codex/integrate-r01` 集成，保留原子项目提交/Worktree；本轮不合 main | 用户本轮明确授权共享接线、回归修复和验证；R02 未启动 | 总控单一文件归属；候选保持 review，需用户后续合并授权 |
| D017 | 以单文件 CJS Preload 取代 R00 的 `.mjs + sandbox:false` 临时方案（D013） | Electron sandboxed preload 不支持 ESM；bundle 后仅依赖 electron，Bridge wire shape 不变 | build、实际 file/Bridge 与 macOS 未签名目录包路径分别验证，不等于签名发布或跨平台 |
| D018 | 正常退出使用同步门禁、一次清理 Promise 和逐实例 disposer；paused 在等待后转 cancelled | 补齐 D007 的正常退出部分，避免重复关库、旧窗口释放新资源、晚到加载再显示及活动锁遗留 | 原消息/Turn/请求 ID 保留；异常退出恢复仍 R03，完整调度与不响应 abort 的 Provider 收尾策略仍 R04 |
| D019 | 统一准确 URL/mainFrame IPC 来源，并在每次推送前重新验证；外链仅 HTTPS 且原生确认 | 只比较 webContents 不足以保护页面导航后的敏感信息；不把模型文本或 popup disposition 当授权 | 全部 channel、子/空 frame、伪装地址、事件与 disposer 回归；真实系统浏览器未打开 |
| D020 | 生产 CSP 禁网络/frame/object/base，开发仅精确 loopback/HMR 与脚本 nonce | 生产不保留开发通配来源；现有 React 内联样式暂保留 style-src unsafe-inline | 开发固定 127.0.0.1:5173/strictPort，端口占用明确失败；脚本无 unsafe-inline/unsafe-eval，实际开发连接另验证 |

官方依据：[Electron ESM](https://www.electronjs.org/docs/latest/tutorial/esm)、[Process Sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox)、[Vite html.cspNonce](https://vite.dev/config/shared-options.html#html-cspnonce)。实现与运行证据以本仓库 Electron 38.8.6 / Vite 7.3.7 和 [本轮记录](verification/2026-10-13-r01-integration.md)为准。

## D021 — R01 正式合并与主线验收（2026-10-13 合并验证，2026-10-14 收尾）

用户批准集成提交 `0ad1701a47222315158e7be00d29afe1c9ef1767` 后，总控仅合并 `codex/integrate-r01`，实际合并提交 `4149590d28296ab3520b70606dcb161ba16a6b39`；保留原子项目分支/Worktree，不重复合原分支，不重写历史。此授权取代 D016 的候选阶段停止边界。

main 的实际合并文件树与获批集成候选一致；本轮在 main 重新运行类型、133 项全套回归、生产构建、Electron SQLite ABI139、隔离生产页面/Preload 与退出后只读 SQLite，均通过，再将 R01 verified、R02 ready。具体命令见 [主线验收证据](verification/2026-10-13-r01-main.md)。状态更新为独立文档提交，业务代码、协议、Schema、migration 和依赖不另改。

R01 验收不表示 V1 发布完成。正式 E2E、跨平台、签名/公证、真实模型/Key 等限制继续保留；不响应 abort 的收尾策略留 R04。R02 ready 仅表示依赖满足，未授权创建 Worktree/实施，不自动开展其他任务。

## R02 分支接口决策（2026-10-14，待总控审核）

| ID | 决定 | 理由与影响 | 验证边界 |
| --- | --- | --- | --- |
| D022 | 用户授权当前独立 codex/r02-contracts；R02 主代理独占共享文件，协作者只读 | 基于已验收 R01 的 b690a1e；沿用已有 Worktree，不合 main、不改总控状态看板 | 本分支交付待审核，不能标 merged/verified |
| D023 | Schema 派生 DTO；IPC 成功/错误 envelope 和 RunEvent.version=1，Preload 双端校验后保持原 Bridge API | 消除重复输入/恢复定义、unknown payload；拒绝未知字段及错误身份，固定错误消息/field | Main/Preload/Renderer 必须同构建交付，非混合版本兼容；无 DB migration |
| D024 | 保留 v0 数据，RunService 只在输出边界补关联/脱敏；无法安全适配就快照重同步 | 不重写原文、请求 ID、部分输出或序号，不自动重试 | 损坏 JSON 恢复仍 R03；一行 App 控制标记消费修复记录 R02-CONSUMER-01 |
| D025 | Provider 全部方法与六类事件统一；Main requestId 贯穿，error 也是终态 | Mock 可替换为未来四类供应商，标准化取消/可重试性；不新增真实 API | fixture/编译期/Mock 只证明协议；真实 Token/调度/计费留后续任务 |
| D026 | Shared Zod jitless，保持 R01 CSP/sandbox/有限 Bridge | 校验不生成动态代码；不放宽 unsafe-eval 或 Node 能力 | 单文件 CJS 构建与隔离 Electron 另验证；Node ObjectWrap 原生回归独立记录，不归因于 Zod |

本轮实际命令、环境失败及限制见 [R02 验证与交接](verification/2026-10-14-r02-contracts.md)。总控须审查以上 wire shape 和必要消费接线，再集成复验。本分支未授权其他模块实施。

## R02 集成审核追加（2026-10-14）

| ID | 决定 | 理由与影响 | 验证边界 |
| --- | --- | --- | --- |
| D027 | workflowSnapshot 同一 Schema 递归拒绝明确凭据字段，保留普通配置/Key 引用 | 修复普通 JSON 可明文落库/普通快照返回 apiKey 等的 P1 边界；不实施历史数据迁移或任意文本秘密识别 | DTO红绿、持久化/历史记录保护和228项全回归通过；不实现任意文本秘密识别或R03数据迁移 |
| D028 | 不将同 ABI 跨补丁头文件绕法作为常规环境；受控验证必须完整 runtime/headers/平台匹配，再做 SQLite GC/全回归/Electron检查 | 官方24.21.0严格配对的独立ObjectWrap 5/5崩溃；24.18.1严格配对5/5通过，ABI均137。证明仅ABI号不足、仅版本匹配也不自动证明稳定 | 严格24.18.1项目SQLite重编译/压力5/5、94项契约/228项全回归、类型/构建、Electron ABI139/隔离Bridge通过；默认干净安装尚未证明，ENVIRONMENT记录约束，不升级依赖/全局Node |

本次只读契约/服务审查及实际验证见 [R02 集成审核](verification/2026-10-14-r02-integration.md)，环境复现条件见 [ENVIRONMENT](ENVIRONMENT.md)。main 与原子项目 Worktree/分支保持不变，R02 不标 verified，不启动 R03。

## R02 正式合并与主线验收（2026-10-14）

上述未合入/干净安装待证明为各阶段历史状态；ENV 专项已解决安装阻塞，用户随后批准最终合并。

| ID | 决定 | 理由与影响 | 验证边界 |
| --- | --- | --- | --- |
| D029 | 只将获批集成候选 5b8f771 以 non-ff merge 6aff174 合入 main，保留原分支/Worktree；主线复验通过后登记 R02 verified、R03 ready | 完整保留 bafa84f/8ec1d2b/5b8f771 历史，不重复合原子项目，不覆盖 R01；无新的 wire shape/migration/业务修改 | main 本次94契约/228全回归、类型/构建、严格Node原生/压力、Electron ABI139/隔离IPC/退出数据通过；R03仍未获实施授权 |
| D030 | 保留辅助 pnpm list 的真实失败，以只读安装 manifest/锁文件盘点依赖，不为清单扩大全局 store 写权限 | pnpm11.25.0 list 固定打开 modules.storeDir 的可写 StoreIndex，CLI store 覆盖无效；trace与只读索引查询支持沙箱限制解释 | 主线32直接依赖实际版本/锁文件匹配；list未通过，不把辅助诊断失败改写为安装或业务测试 PASS |

完整本次命令、退出码、数据隔离和限制见[主线验收](verification/2026-10-14-r02-main.md)。D028 的上游 Node 24.21.0 风险保留；继续使用官方 24.18.1/严格同版 headers 和独立依赖，正式 E2E/跨平台/发布/真实模型能力不在本轮验证结论内。

## R03 总控共享接线候选（2026-10-15，待最终合并审核）

| ID | 决定 | 理由与影响 | 验证边界 |
| --- | --- | --- | --- |
| D031 | 在最新 main be37fad 独立创建 codex/integrate-r03，引入原 R03 一次；总控独占共享文件，不合 main | 保留原始/R01/R02 历史、原 R03 分支及 Worktree；不把集成通过当主线 verified | 候选验证与主线验收分开；本轮不启动 R04/R05/R06 |
| D032 | 追加 migration2；完整执行事实与独立 Attempt 持久化，历史缺失保持 NULL | 请求身份不能等同 Turn 身份；只为唯一可证明旧关联回填 Attempt，拒绝编造输入/时长/任务 | 原 v1 字节核对、原始 v1 fixture 升级、真实失败回滚、双 Attempt 备份/恢复及磁盘重开 |
| D033 | SQLite 在线备份、验证独立恢复候选后迁移及登记；恢复文件不自动替换原库 | checkpoint 后文件复制可能丢 WAL；随机排他发布、私有目录及哈希证据防止误信任 | WAL busy、取消/篡改、旧备份拒绝、真实 migration 失败保护；断电/Windows ACL 未验证 |
| D034 | immediate 事务分配事件/消息顺序；固定上界分页、一致读事务及 afterCommit 通知 | 避免并发跨视图、回滚幽灵事件和多 Attempt 身份混淆；保留现有订阅重同步机制 | WAL 读写/写锁、回滚、跨 Run 游标、>500 与未知协议重同步；未实施 Renderer store |
| D035 | 启动只将4类父 Run（含 paused）归 interrupted；idle 保持原值；退出等待已开始的初始化 | idle 不能证明已发请求；终态/原文本/输入保留，初始化不能绕过 R01 退出屏障 | 重复恢复、9类父状态桌面探针、延迟初始化成功/失败测试；无自动付费请求或完整恢复调度 |
| D036 | 受控 Node24.18.1 严格配对、独立缓存离线冻结安装；Electron另编译 | 不升级 package/lock，不把缓存安装当冷下载，也不采用跨补丁 headers | 本次完整回归/类型/构建/原生/隔离桌面；24.21.0 上游风险及 R02 原失败证据保留 |

具体契约与所有实际命令见 [R03 集成报告](verification/2026-10-15-r03-integration.md)。这些是集成候选决策，用户最终合 main 后仍须主线复验，当前 R03 为 review。

## R03 正式合并与主线验收（2026-10-15）

| ID | 决定 | 理由与影响 | 验证边界 |
| --- | --- | --- | --- |
| D037 | 按用户最终授权只将候选439e3c6以non-ff merge e642b96合main；本轮必要复验后R03 verified，R04/R05/R06 ready | 保留原R03分支及两个Worktree、原始历史和完整候选；不重复合子项目、不改业务代码，不因ready自动启动 | main 本次313全回归、Node/Electron各85专项、类型/构建、严格Node原生/压力5次、Electron ABI139/隔离恢复/IPC/退出数据通过；正式E2E/发布/跨平台仍未验证 |

D031–D036 的候选停止边界是前一阶段历史，本次用户授权取代“未授权合 main”，其数据、安全与环境规则继续生效。完整本轮命令、真实 merge SHA、源树一致性及剩余覆盖限制见[主线验证报告](verification/2026-10-15-r03-main.md)。状态更新独立提交，仅文档变更。


## R04/R05/R06 联合集成候选（2026-10-15）

| ID | 决定 | 理由与影响 | 验证边界 |
| --- | --- | --- | --- |
| D038 | 最新 main 37766666 独立联合 Worktree，总控独占全部共享接线；各原模块只引入一次 | 原分支/Worktree保留，main不变；当前只提交 review 候选，不把联合 PASS 当主线验收 | 见[联合报告](verification/2026-10-15-r04-r05-r06-integration.md)和命令台账 |
| D039 | 候选 UUID 与一致快照在请求记录之前交给同步builder；读/构建/校验/写在同一事务 | 拒绝不产生假执行记录，afterCommit通知后才调用Provider；Repeat同样必经门禁 | 实际三Agent输入捕获、Attempt逐字DTO比较、拒绝/超时/重入Stop零请求记录 |
| D040 | Repeat 保留原冻结输入语义，直接校验最终完整输入；不伪造未来Turn让R05接受旧Turn | Retry重放、Continue仅新后缀；预算缺失/超窗不发送，旧证据保留 | 同Turn多Attempt、精确预算边界、Renderer Stop和迟到事件隔离 |
| D041 | Mock拥有明确测试词法及上下文窗；未知模型没有可靠计数能力就拒绝 | 字符/字节/delta不被称为真实模型Token，Mock词法由生成/计数/usage共用 | Unicode/换行/消息封装计数、实际usage、未知默认resolver拒绝 |
| D042 | 沿用invalid_response处理非完整finish；安全事件给中文提示，缺历史安全原因则通用失败 | 不引入新公开枚举/DTO，部分输出与失败事实保留；不泄漏私有lastError | length/filter/timeout、乱序和冲突失败重同步；重开后详细失败原因未持久投影 |
| D043 | 来源审计持久化/新migration或公开协议为C类；可信指令生产来源和无Run发现延期 | 不改已发布migration1/2；普通文本/workflow不能伪造主持人指令，无R07扩张 | 最终输入已存Attempt；来源报告仅瞬时返回，未持久化/展示；正式E2E/发布范围另行授权 |


## R04/R05/R06 最终合并与主线验收（2026-10-16）

| ID | 决定 | 理由与影响 | 验证边界 |
| --- | --- | --- | --- |
| D044 | 按用户批准将完整d4a0d274以--ff-only从37766666合main，本次主线必要复验后R04/R05/R06及联合集成verified；R07/R08仅ready | 11个WT合并前干净，三模块各一次完整引入；无需额外merge commit；原分支/WT与历史保留，不自动启动后续模块 | main本次534完整/265专项/112 Electron、类型/构建、Node严格同版原生/压力5次、Electron ABI139/真实隔离UI/恢复/退出通过；C类扩展及正式E2E/发布/真实模型未实施 |

D038的review/未合main为历史阶段，用户本次最终授权已取代停止边界；D039–D043的数据、安全、可靠计数和延期规则继续生效。本轮只改治理文档，具体命令和证据见[主线报告](verification/2026-10-16-r04-r05-r06-main.md)。

## 发布与授权规划确认（2026-10-16）

| ID | 决定 | 理由与影响 | 验证边界 |
| --- | --- | --- | --- |
| D045 | 用户确认免费、Source Available、非商业授权；未来个人 GitHub 公开源码、Releases 提供桌面安装包，用户 BYOK；优先 PolyForm Noncommercial 1.0.0，正式发布前再次核对并由用户确认 | 不默认 MIT/Apache-2.0，不称 OSI 标准开源，不增加收费/订阅/激活/支付/反盗版；保留全部技术功能、依赖与 Worktree 路线 | 仅规划；当前不设置正式 LICENSE、不修改 package、不创建或公开仓库、不启动 R17；细则见[发布政策](RELEASE_POLICY.md) |
| D046 | R17 最终验收补充许可证全文、版权/第三方及贡献权利、README 双语说明、拟公开完整历史敏感信息、GitHub 准备与跨平台 Releases；公共文件和发布归总控统一负责 | 外部贡献不自动转移版权，入站授权须与最终出站许可衔接；DCO/CLA 适用性及署名由用户确认，第三方许可独立保留 | 各项仍未执行；检查失败停止公开，不擅自重写历史，公开/上传仍须明确授权，不因文档调整推进任务状态 |


## R07/R08 共享前置候选（2026-10-16，待用户审核）

| ID | 决定 | 理由与影响 | 验证边界 |
| --- | --- | --- | --- |
| D047 | 从最新已验收main510f58a独立共享分支，总控独占Shared/Database/migration/公共测试，候选review后停止 | 不与未来R07/R08争文件，不合main、不创建功能WT；模块需同一新main基线后再授权 | [本次报告](verification/2026-10-16-r07-r08-shared.md)和[接口手册](R07_R08_SHARED.md)；main不变 |
| D048 | Provider实例ID稳定，模型身份成对；真实/显式Mock/失效配置分开，新配置不得落旧Demo兜底 | 目前真实resolver未实现，启动前unsupported优于生成虚假Mock成功；仅未编辑旧Demo保留兼容 | 配置三Mock实际公共输入/Attempt、真实及禁用零Mock/零Run、旧快照保留；真实网络未验证 |
| D049 | 追加migration3配置/归档/Key revision与索引，沿用单Database和已验收在线备份恢复，1/2不改 | 不伪造历史配置/时间；新ledger与实际列同时验证；历史引用禁止硬删 | 新建/1→3/2→3/幂等/实际DDL失败字节回滚/旧版可恢复备份/WAL busy与v3恢复 |
| D050 | Provider拥有Key，每实例串行+revision CAS；更换目标撤销密文，会话仅内存；异步解密返回前再校验 | 解决迟到加解密、ID重用和跨Provider取Key；活动冻结引用禁止改Key/配置 | fake secure/memory、失败保留、延迟竞态与泄漏断言；真实系统后端未验证 |
| D051 | 消息sortKey、Run(createdAt,id)+首次rowid上界分页；Shared比较遵从SQLite BINARY | 避免updatedAt漂移与同时间戳后插入较小ID混页；cursor绑定房间且校验实际边界 | 固定上界/并发插入/Unicode/跨房/错误cursor；跨页可变流式文本不冻结 |
| D052 | 冻结纯typed API和input/output表及feature props，生产handler/Preload/App等真实组装延至联合集成 | 不建空handler、不把接口存在当功能完成；两个feature可用注入API独立测试 | 原Bridge/CSP/sandbox和旧Run联合回归通过；R07/R08UI及真实模型未实现 |


## R07/R08 共享前置最终合并与主线验收（2026-10-16）

| ID | 决定 | 理由与影响 | 验证边界 |
| --- | --- | --- | --- |
| D053 | 按用户正式授权将共享候选1e1f971从510f58a以ff-only合main，本轮必要主线复验后SHARED-R07-R08-01 merged/verified；R07/R08仍ready未启动 | 12个WT合并前干净；候选单提交、原migration1/2及历史保留；没有新merge commit，不创建功能WT或启动R09/R17 | main本次612全回归/78共享/190 Electron、strict/build、双ABI/Node压力5次、隔离UI/恢复/退出数据全部exit0；[本轮报告](verification/2026-10-16-r07-r08-shared-main.md) |

D047的候选停止边界已由本次正式合并授权取代；D048–D052的引用/Key/分页/分工与延期接线规则不变。新typed API尚未生产注册，旧Bridge探针通过不代表R07/R08功能或真实模型可用。后续两个模块需从同一最终main完整SHA并另获创建/实施授权。


## R07/R08 联合候选（2026-10-17）

| ID | 决定 | 理由与影响 | 验证边界 |
| --- | --- | --- | --- |
| D054 | c1b5bea 上建立唯一联合 Worktree，两模块各 cherry-pick -x 一次，总控完成公共接线后交 review | main、原分支/Worktree 保留，不重复引入、不启动 R09/R17 | 精确 SHA、patch-id、本轮结果见联合报告/台账 |
| D055 | 受限 rooms/settings Bridge 直接消费统一契约，拒绝值为 ApiError 普通 DTO | contextBridge 剥离 Error 自定义字段；DTO 保留 code/retryable 且无 stack，不靠错误字符串推断权限 | 真桥实验、严格单元及生产错误反馈；Main 内部 ContractError 不变 |
| D056 | 撤来源后等待已接受配置操作结算再关 DB | 避免 Key/配置迟到写关闭数据库；不回滚或重试已接受写入，旧 disposer 不影响新注册 | 延迟 fake 加密、来源失信、配置 drain 与退出屏障回归；不等待 Run 长控制 |
| D057 | 所有新执行/重试/续写/恢复统一检查冻结 Provider 引用仍有效且显式 Mock | 旧 Run 终态后配置可变更，不能绕过新建门禁继续把真实/失效配置当 Mock | RED 复现后证明拒绝且历史/Attempt/锁不变；真实 Adapter 留 R09 |
| D058 | 先恢复后挂 Rooms、空选择清投影、设置结算刷新摘要、历史读取冻结身份 | 防首房吞恢复、离开设置丢刷新、末房遗留旧 Run、当前配置污染历史 | Renderer 联合及生产操作分别验证；亮暗/窄窗以实际功能布局，最小800×600 |
| D059 | 有限桌面探针 ready 前隔离数据、全部 safeStorage 方法 fake、Chromium mock-keychain、Node/Chromium 网络阻断 | userData 隔离本身不能隔离 Keychain；只用假 Key，不触发付费 Provider | fake 密文持久化不证明真实 OS 加密；不等于正式 E2E、跨平台或发布验收 |

## R07/R08 正式合并与验收停止（2026-10-17）

| ID | 决定 | 理由与影响 | 验证边界 |
| --- | --- | --- | --- |
| D060 | 按用户最终授权从c1b5bea严格ff-only合入d3205b2c3fba2061437150e87a87508d44fbb660；补充桥脚本失败后停止验收，R07/R08仅merged、未verified | 无冲突/新merge commit，原历史/分支/15WT保留；不因验证脚本错误改业务、重写历史或隐藏失败 | main846/292/111/393及UI重启退出已通过；补充脚本在生产Main加载前导入错误，精确桥字段断言未执行；[实际记录](verification/2026-10-17-r07-r08-main.md)；R09仍blocked未授权 |

D054的未合main边界已由用户授权取代；D055–D059协议与安全规则不变。未将失败脚本算成功，不自动修复重跑或继续验收，不启动后续任务。

## R07/R08 补充探针修复授权与验收（2026-10-17）

| ID | 决定 | 理由与影响 | 验证边界 |
| --- | --- | --- | --- |
| D061 | 根据用户新授权，只将失败wrapper内的新增断言顺序接入原生产探针，既有隔离/真实Main后await，通过后才写PASS | npm包入口与Electron内置模块不同；复用正确require('electron')及现有FAIL/exit1，无新事件竞态、不改业务/构建/依赖 | 两路径18/18精确真桥安全断言、自然exit0及退出SQLite审计通过；源/既有输入/构建/native不变后按用户授权复用原主线证据，R07/R08最终verified，R09仅ready未授权 |

D060的停止记录与原失败日志保留；仅本次授权及真实补充证据解除验收阻塞，不开始后续开发。


## R09 联合集成候选（2026-10-17；未合 main）

| ID | 决定 | 理由与影响 | 验证边界 |
| --- | --- | --- | --- |
| D062 | 从验收 main e9cf24e 独立创建 codex/integrate-r09，以 cherry-pick -x 引入原 2d97af5 一次，入站 f5baaf07e1603a7c356fb0c9cedeb131977307ba | 不改原 main、分支/WT/历史；本轮仅候选，不自动启动后续模块 | 引入树与原模块相同，完整提交与文件检查见 R09 报告 |
| D063 | Main 会话确认绑定 providerId/kind/规范化URL/Key修订，异步边界及返回结果复核 | Renderer checkbox 不替代 Main 目标确认；旧 Key/目标鉴权不得迟到误报成功 | Key/target/disable 竞态有实际 RED→GREEN；不回溯撤销已发生请求 |
| D064 | 默认真实模型无获审计数/窗口/输出参数/费用规则时明确拒绝 | 不复用 Mock 词法，不按供应商名称猜模型能力，不把 R13 账本提前做进来 | 本轮只为本地 fixture 注入有依据零成本规则；live API 未验证 |
| D065 | 标准库 transport：全部 DNS 校验、固定地址、连接后再 guard 发凭据、无重定向/自动重试 | 关闭 DNS 重绑定及连接等待期间的失效引用窗口，保留 TLS 校验 | identity 编码；压缩、真实 TLS/公网能力不外推 |
| D066 | RunService 使用冻结 Provider/Model 实例和 R05 实例预算，保留原 Attempt/partial/usage 事件语义 | 真实 Provider 不静默回退；只有显式重试/续写/中断决策允许再调用 | 不改 migration 1/2/3，不伪造上游请求 ID |
| D067 | 真实生产入口 fixture 烟测与 live API/OS Keychain/发布验收分列 | fixture 使用真实 App/Preload/IPC/Main 与 HTTP，但可信策略及官方目标 transport 受控替换 | 必须自然 exit0 加同轮退出 SQLite 审计；仅完成本轮授权，不标 main verified |

## R09 正式合并与主线 fixture 验收（2026-10-17）

| ID | 决定 | 理由与影响 | 验证边界 |
| --- | --- | --- | --- |
| D068 | 用户最终授权后，从e9cf24e严格ff-only合入完整f3a8fee，本次main独立必要验证完成后仅R09 fixture merged/verified | 原模块只引入一次，原分支/17个当时登记WT及历史保留；不重复merge、不自动启动后续模块 | Node/Electron各1073、R09专项227、strict/build、严格双ABI/SQL、真实生产fixture12请求/重启HTTP0、原Mock/恢复/退出审计通过；[主线报告](verification/2026-10-17-r09-main.md) |
| D069 | 旧恢复探针仅补已批准的confirmTarget精确白名单，保留原失败；业务/构建、既有回归及R09/R78探针输入不变，不机械重跑无关检查 | 实际失败发生于Bridge集合检查、恢复断言前；补一项后新profile实际恢复及只读审计通过，未放宽安全要求 | 首次Node sandbox EPERM及旧探针exit1完整保留[台账](verification/2026-10-17-r09-main-commands.md)；无产品修改 |

D062的候选未合main边界已由用户本次授权取代，D063–D067的数据/网络/可靠计数及未验收限制继续有效。生产真实生成仍因缺获审model policy而unsupported；R10A/B仅ready、R11有限计划/Mock准备仍需冻结共享协议和另获实施授权，真实API/Keychain/E2E/发布未验证。

## DeepSeek 首次真实调用前的安全准备候选（2026-10-17）

| ID | 决定 | 理由与影响 | 验证边界 |
| --- | --- | --- | --- |
| D070 | 从dc387146建立独立codex/deepseek-safety-prep，仅补Main受限参数能力、同币种CNY整数预算及候选有效期 | 不把人民币写进USD字段，不按厂商/模型名猜计数；保留Mock、既有R09网络/Key/取消及历史语义 | 本轮32专项、Node/Electron各1105、strict/build、双ABI、真实隔离入口/退出通过，见[报告](verification/2026-10-17-deepseek-preparation.md)/[台账](verification/2026-10-17-deepseek-preparation-commands.md) |
| D071 | DEEPSEEK-TOKEN-01未解决前不注册真实DeepSeek model policy，准备候选review，真实生成blocked | 官方离线V4.1工具存在，但未证明1017生产API完整计费封装对应；不造字符/字节上界或用fixture计数解锁 | 默认生产Key前unsupported；真实API/Keychain/实际账单未验证，无合main或付费授权，不启动其他任务 |

## DeepSeek 安全准备正式合并（2026-10-18）

| ID | 决定 | 理由与影响 | 验证边界 |
| --- | --- | --- | --- |
| D072 | 按用户授权从dc387146严格ff-only合入获批30d5783，主线独立复验后仅DEEPSEEK-PREP-01 merged/verified；TOKEN-01仍blocked | 不注册未经证明counter、不续期价格、不读取真实Key/用户DB、不调用公网模型；原18WT/分支/历史保留 | 本轮Node/Electron各1105、32专项、strict/build、双ABI、生产拒绝/重启HTTP0/退出审计均exit0，见[主线报告](verification/2026-10-18-deepseek-main.md)及台账 |

D070/D071的候选未合main边界由本次合并授权取代，其计数阻塞、真实调用禁令及未验收限制保持。本轮不实施Tokenizer或其他任务。

## DeepSeek Token 估算与单次受控测试候选（2026-10-18）

| ID | 决定 | 理由与影响 | 验证边界 |
| --- | --- | --- | --- |
| D073 | 严格计数门禁保持；另设 Main 原生逐次确认的固定短文本试验，不注册估算为 ModelPolicy | 官方 Tokenizer 工具与1017生产API隐式计费封装的完整对应仍未证明。官方字符比例加64封装余量仅为未校准启发式；明确 estimated/unknown/provider_usage，不能冒充精确值或绝对账单上限 | 单 Provider/固定目标和模型、固定提示词、输出128、一次请求、无自动重试/恢复；本轮仅本地 fixture，不含真实 API 授权 |
| D074 | migration4 以权威 SQLite 事务持久预留¥0.05；未知费用保留全额预留并阻止后续试验 | 内存锁不能跨重启保护；缺 usage/Abort/断流/异常终结不等于零费用。只在完整终结及合法 usage 后按冻结费率核算，不把观察到的片段 usage 当结算 | 原 migration1–3不变；唯一未结索引、备份恢复/失败回滚、部分证据及幂等恢复验证。普通 Run/试验双向互斥，退出等待两者结算 |
| D075 | OS Keychain 证据仅覆盖本任务随机服务名与假 Key，签名/锁定登录环境分别标未验证 | userData 隔离不能隔离系统 Keychain；原生调用守卫只允许测试自建服务，不读取既有用户项。28条真实后端断言与候选生产 fake 后端探针分列，用户明确批准后清理自建3项并精确复核不存在 | 不把旧 KeyService/DBv3 单模块 OS 测试宣传为候选 DBv4 整App或正式签名验收；失败与审批拒绝记录保留 |

本节只描述 `codex/deepseek-controlled-trial` 候选，基线 main `ae5c24c6dd1410aedba6ef31894470b7cb668c8a` 未改。见[交付报告](verification/2026-10-18-deepseek-controlled-trial.md)及[实际命令](verification/2026-10-18-deepseek-controlled-trial-commands.md)；不提前实施 R13/R17、不启动其他任务或真实模型调用。

## DeepSeek 单次受控测试主线验收（2026-10-18）

| ID | 决定 | 理由与影响 | 验证边界 |
| --- | --- | --- | --- |
| D076 | 用户最终授权后从ae5c24c严格ff-only合入获批db97b95，main独立必要复验通过后仅DEEPSEEK-TRIAL-01 merged/verified | 17个Worktree/原历史保留；合并后无业务/测试修改，原migration1–3不变；独立治理提交记录状态，不启动其他任务或真实请求 | main Node/Electron各1168、strict/build、双ABI、42/24受控生产/重启及退出审计、原R09/R07/R08生产回归均exit0；[本次证据](verification/2026-10-18-deepseek-controlled-trial-main.md) |

D073–D075的候选未合main边界由本次合并授权取代；估算性质、严格TOKEN阻塞、未知费用保护及有限Keychain证据边界仍有效。正式真实API、实际账单、v4整App真实后端、签名/锁定登录Keychain及跨平台发布未验收。

## DeepSeek 受控失败诊断候选（2026-10-19）

| 决策 | 依据和实施边界 | 验证和限制 |
| --- | --- | --- |
| D077：保留公开错误 DTO，另在 Main-only 受控记录增加白名单诊断 | SDK/ContractError 脱敏会丢弃不同底层错误。通过凭据、DNS、TCP、TLS、HTTP、SSE、usage/核算阶段采集固定类别/时间/数字状态，不保留敏感异常和原始响应 | 三种证据区分网络未开始、客户端已调用但收取未知、HTTP响应已观察；均不能代替账单。仅解释未来请求，不追溯第一次 network_error |
| D078：复用 v4 JSON 可选字段，不分配无 SQL 变化的 migration | 新 reader 兼容原无诊断记录，migration1–4原文不动；原未结唯一索引/预留保护保持 | 旧 strict reader 不能读取新扩展，明确不支持降级读取；独立候选不连接真实 profile。诊断/结算失败、晚到事件、重复恢复、备份恢复均须验证 |
| D079：真实价格过期仍拒绝；生产诊断验证使用明确标识的本地 fixture 测试时钟 | 本轮无核新价或真实请求授权，不延长/修改价格窗口。测试 wrapper 只在生产 Main 导入前注入已知快照时钟、隔离数据和网络 | 这不是当前价格验证，也不是付费授权、真实 Keychain 或正式 E2E。源 main、旧未知记录及 ¥0.05 预留不动 |

## DeepSeek 诊断最终主线验收（2026-10-19）

| 决策 | 实施与证据 | 边界 |
| --- | --- | --- |
| D080：按明确授权ff-only合入7599949，main新鲜必要证据通过后登记DIAG merged/verified | 完整1255在main自身ElectronABI139运行，Node66专项/strict；正式--outDir独立生产构建及49/30真实入口/重启、35只读退出检查全部exit0。复用有效原生压力/Node候选历史而不冒充新PASS | 不切main ABI或覆盖当前out；原out/.node SHA和inode审计不变，不重启部署当前App。真实unknown/¥0.05不访问不核销，无新联网许可，价格过期仍拒绝；[主线证据](verification/2026-10-19-deepseek-diagnostics-main.md) |

D077–D079的候选未合main边界由本次最终授权取代；白名单诊断、送达证据级别、旧reader不支持降级、严格计数与未知费用限制继续生效。本轮只完成主线验收，不启动真实API或其他任务。
