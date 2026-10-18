# DeepSeek 真实请求失败的最小诊断修复候选（2026-10-19）

本轮完成未来受控测试的安全诊断闭环，候选 **review，可供最终合并审核，未合 main**。不判断/重试第一次真实请求，不修改它的 unknown 或 ¥0.05 预留；公网模型 API 请求为 **0**。本轮未打开真实 profile、Keychain，也未关闭/重启当前用户应用。

## Git 与修改范围

- 基线和保持不变的 main：`524f5052736dd8fbb7e093873d2a1f3c2732fc82`，开始/交付前均核实干净。
- 独立分支：`codex/deepseek-trial-diagnostics`。
- Worktree：`/Users/zhangwenjie/.codex/worktrees/deepseek-trial-diagnostics/AI交互`。
- 完整候选 SHA 为包含本文的独立提交；准确值见交付消息和 Git 历史（不预填自引用 SHA）。原分支/Worktree/历史保留。

| 文件 | 修改原因 |
| --- | --- |
| `src/main/providers/diagnostics.ts`（新增） | 严格白名单 Schema、证据单调升级、首个失败保留和安全时间点 |
| `src/main/providers/network.ts` | DNS/TCP/TLS/请求/响应阶段和原生白名单错误映射，数字HTTP状态含拒绝的101；回调同步取消后复核，防止漏Abort留下连接 |
| `src/main/providers/openai/ChatCompletionProvider.ts` | 凭据读取与不可用、网络调用/HTTP、SSE解析及取消/超时诊断；通用公开错误/禁止重试不变 |
| `src/main/providers/ProviderRegistry.ts` | Main-only observer贯通；守卫拒绝不误称Keychain失败；普通真实Run能力门禁不变 |
| `src/main/providers/controlledTrial/{record,ControlledTrialService,menu}.ts` | 可选持久诊断、未知费用写入失败保护/晚到事件隔离、原生最近记录与结果中文展示 |
| `src/main/database/Database.ts` | 现有进度/收尾事务接受严格可选诊断，沿用唯一仓储 |
| `tests/integration/deepseek/diagnostics.test.ts`（新增） | 21条：凭据/HTTP/usage/会计故障、预留/撤销/晚到回调、旧记录及备份恢复 |
| `tests/unit/providers/{diagnosticsTransport,controlledTrialMenu}.test.ts`（新增） | 41+25条：真实本地HTTP/TLS证书拒绝、注入各阶段失败/超时、错误脱敏、原生展示/取消 |
| `tests/probes/deepseek-trial-electron.cjs`、新增`deepseek-diagnostics-electron.cjs` | 真实生产Main/Preload/App的诊断、菜单、重启断言；历史价格fixture时钟明确标识 |
| `docs/{CONTRACTS,DECISIONS,STATUS}.md` 与本报告/命令台账 | 统一契约、review状态、兼容性和实际证据 |

没有改 Shared/IPC/Preload/Renderer、KeyService、RunService、Main装配、业务估算/费率/计数门禁、依赖或构建配置。migration1–4原文不变。

## 最终诊断能力

- 阶段：发送前安全检查、凭据读取、网络客户端、DNS、TCP、TLS、请求、HTTP响应、SSE、usage、会计记录、完成。
- 类别：凭据不可用/读取失败、DNS失败、目标被拒、TCP失败/超时、TLS握手/证书失败、HTTP状态错误、请求超时/中断、SSE/响应不合法、usage缺失、费用核算/记录失败、取消、安全拒绝、仍无法细分的网络异常。只匹配受信ContractError或明确原生错误码白名单，不凭异常文案猜原因。
- 证据：`not_started`＝未开始网络调用；`client_invoked`＝已调用客户端、服务商是否收到未知；`http_response`＝已观察到数字HTTP响应，仍不等于生成成功/计费证明。TCP连接和SDK调用不宣称服务商收到。
- 只存版本、固定枚举、必要时间与100–599整数状态。HTTP不成功的body/header仍在SDK前丢弃；诊断不保存URL、头、Authorization、Key、原始响应、异常message/cause/stack或任意errno字符串。
- 原生“受控测试 → 查看最近测试记录…”及本次结果显示中文诊断；查看记录不解密Key、不请求。旧记录诊断缺失显示无法追溯，不将历史network_error推定为DNS、TLS、未发送或未计费。

## 数据与安全

沿用v4 `controlled_trials.data_json` 的**可选诊断**，没有SQL结构变化，故不新增migration。新代码可读所有旧无诊断记录，重复恢复不补造历史；新诊断的v4备份/恢复已实测。**旧二进制strict JSON reader不能读新增字段，不承诺降级兼容**；新记录不能交给旧版应用/旧版恢复检查器，升级前保留兼容备份。

原有完整流+合法usage才settled的规则不变。缺usage、错误、超时、Stop继续unknown、费用NULL、全额50000 micro-CNY预留且禁止后续测试。诊断/文本/usage持久失败会停止本次请求，不释放费用；结算事务失败只尝试持久化unknown，不重新调用Provider。持续写失败保留原reserved供启动恢复，无法写入时不虚称最终诊断已落库。结束前关闭observer，迟到网络事件不改终态。普通真实Run的 `DEEPSEEK-TOKEN-01` 仍blocked；无新计数策略或自动重试/续写/恢复权限。

## 实际验证

环境为官方Node24.18.1/darwin-arm64/ABI137（完整runtime/headers严格匹配）、pnpm11.25.0、better-sqlite3 12.11.1；随后串行Electron38.8.6/内嵌Node22.22.0/ABI139。独立冻结离线安装646 reused/0 downloaded，copy导入，不复制node_modules、不共享可变依赖；32直接依赖/锁文件一致。初次缓存安装不是冷缓存联网安装。

| 最终 receipt | 实际结果 | exit |
| --- | --- | --- |
| `node-rebuild-final-2` | 新私有严格同版Node runtime源码重建SQLite | 0 |
| `node-full-final-2` | **84文件1255/1255**，含87条新增诊断测试及R00–R09/受控/迁移回归 | 0 |
| `typecheck-final-3` | TypeScript strict | 0 |
| `build-final-3` | Main254.77kB、CJS Preload232.20kB、Renderer964.20kB生产构建 | 0 |
| `node-native-final` | ABI137，100内存数据库、300000次prepare/get、自然退出 | 0 |
| `electron-rebuild-final` | 严格对应38.8.6 headers源码重建 | 0 |
| `electron-native-final` | ABI139，100内存数据库、300000次prepare/get、自然退出 | 0 |
| `electron-full-final` | **84文件1255/1255** | 0 |
| `production-diagnostics` | built Main/CJS Preload/App；**49具名断言**（6条诊断）；仅2个自建HTTP请求 | 0 |
| `production-restart` | 新进程 **30具名断言**（5条诊断）；HTTP0 | 0 |
| `production-exit-audit` | 退出后只读自建SQLite **35检查**：v4、完整性/外键、费用/诊断/部分输出不变 | 0 |

组间有重叠，不累加成绩。完整精确命令、日期、退出码、源码指纹/日志SHA以及所有中间失败见[命令台账](2026-10-19-deepseek-diagnostics-commands.md)。独立审查发现并修复同步Abort悬挂、HTTP101证据遗漏、SSE unsupported误分类和TLS漏项；没有删除失败测试或降低安全断言。新增测试cleanup的TypeScript返回类型错误和旧临时工具链头文件缺失也保留失败证据；重新准备私有官方同版工具链（3次nodejs.org静态文件下载并核验SHA）后全量重跑。系统Node与main原生模块未改变。

生产探针在ready前隔离userData/sessionData/logs，Chromium mock-keychain及safeStorage全部fake，Node/Chromium公网阻断。实际生产调用链验证：取消默认零请求/零解密、固定prompt/model/max_tokens/thinking、usage结算、Stop部分输出和unknown、普通Run互斥、查看诊断不读Key/不联网、重启诊断与预留逐字段不变及阻止下一次试验。没有用截图/构建代替功能断言。

## 历史unknown、安全阻塞与合并建议

原第一次真实请求的送达、失败根因和账单仍**无法确认**，本候选只改善未来诊断。保留原unknown与¥0.05；用户需在服务商控制台人工核对对应时间的账单/usage证据，本轮不调用账单API、不清零/删除/核销。即使控制台显示无费用，也须后续明确审核核销方案，不能自动解除保护或重试。

生产价格快照已于北京时间**2026-10-19 00:00**到期。没有本轮核价/续期授权，不修改价格。新probe wrapper明确使用历史有效窗口的fixture时钟和本地HTTP，记录实际墙钟；它不是当前官方价格验证，更不能进入真实联网启动器。实际价格过期仍在读取Key/请求前拒绝。

最终文件/指纹审计通过：18个变更文件，无数据库/密钥/构建产物或敏感模式命中；187份src/tests及5份构建文件与最终测试输入逐字一致。main仍干净且原SHA不变，18个Worktree保留；可找到的16份其他Worktree原生文件inode均与本候选独立，最终候选native留ABI139。

自定义 `transportFactory/createTransport` 覆写须转发可选diagnostics参数才能保留DNS/TCP/TLS细分证据；默认生产factory已贯通，fixture覆写已适配并实测。当前用户临时联网启动器未替换/部署，新版部署前仍需审查其转发和隔离。未识别的底层异常保留network_unknown，不凭文案猜具体原因。

建议本候选进入最终合并审核，**不自动合main或替换/重启当前App**。真实Keychain、真实DNS/TLS/API、账单、正式桌面E2E/跨平台/发布未验证。下一次真实请求仍需先人工对账并另外解决未知预留、重新核价、审查候选部署/目标及一次性通道，再由用户明确授权并亲自在原生框确认；本轮不具备再次发送权限。
