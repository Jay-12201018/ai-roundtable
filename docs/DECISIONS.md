# 架构与工程决策

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
