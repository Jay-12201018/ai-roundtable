# R09 联合集成与验收报告（2026-10-17）

## 结论与授权边界

本轮 **fixture 联合集成候选通过必要验收，建议交用户进行最终合并审核**。R09登记为 `review`，没有合main，没有标主线verified，没有启动R10A/R10B/R11/R17或发布仓库。真实模型API、模型profile与系统Keychain不在本轮验收结论中。

- 集成分支：`codex/integrate-r09`；唯一集成工作区：`/Users/zhangwenjie/.codex/worktrees/integrate-r09/AI交互`。
- 业务/测试接线提交：`da512e7a64a6ec4a596b0f7fda820b3d62b04e42`。最终候选还含本文及治理记录的独立提交，以交付消息及该分支最终HEAD为准，不在文档中虚构自身SHA。
- main起点与本轮结束核验均为 `e9cf24e99d09a460f4d8cd0a3a8b7ec4aacf285a`，干净；原始135bf82仍为祖先。
- 原模块 `codex/r09-openai-compatible-provider` / `2d97af571debf106aadad708a2c0418f299c6eef`，父提交严格等于main基线；仅以 `git cherry-pick -x` 引入一次为 `f5baaf07e1603a7c356fb0c9cedeb131977307ba`，引入树逐字等于原模块树。原模块及其他分支、18个WT全部保留。

## 共享接线及最小适配

| 范围 | 实际实现与消费链 |
| --- | --- |
| Main/factory | 同一ProviderRegistry实例注入ProviderSettingsService和RunService；按稳定providerId读取实际配置和KeyService引用，注册两个真实Adapter，不按模型名缓存，不静默回退Mock |
| Shared/IPC/Preload | 新增strict settings.confirmTarget输入/结果、providerId输出关联；generation增加显式allowGeneration:true；真实handler沿用可信sender/frame校验、输入输出Schema和固定脱敏错误，Preload仅限typed方法，无resolveKey或通用invoke |
| R05/RunService | 冻结成员providerId/modelId、system prompt、公共上下文、requestId、outputTokenLimit流入真实Adapter；预算resolver增加member，防同名真实model误用Mock词法；start/step/resume/retry/continue/recovery复核引用；Stop/deadline保留partial和原Attempt，不自动重试 |
| Settings/App | 真实模型列表与configuration/authentication/generation分级语义接factory；用户勾选并显式确认本次会话目标，每次远程操作重新绑定目标；Key改变清UI确认，关闭期间迟到确认不会触发生成；App开始按钮改为“开始协作”并同步原测试/探针 |
| 结果与错误 | stream逐结果、models/auth完成后复核，迟到鉴权失效不报成功；403保留forbidden code，固定message为Permission denied，避免错误归因IPC；原IPC来源内部拒绝不变 |
| 数据库 | 仅listAgents增加可信Main选择验证回调，不传时保留旧Mock门禁；原migration1数组及migration2/3字节不变，无新Schema或迁移；usage沿已有身份事件落库，上游request ID未知保持null，不拿SSE id冒充 |

真实调用链为：生产Renderer按钮 → typed Preload →可信IPC/Schema → 房间/Settings服务 → Main Registry/KeyService/R05/RunService → 原R09 SDK Adapter → 新受控Node transport → 本地HTTP fixture → 规范化事件/Attempt/SQLite → R06投影。

### Token、预算与网络安全

生成需要Main侧有来源的model policy：模型匹配的exact/upper_bound完整请求计数、上下文窗口、输出上限、明确输出参数、输入/输出费率依据和单请求费用上界。缺失/未知/超限都在读取Key和发请求前拒绝；手动model不依赖列表白名单。**默认产品没有获审真实model policy，真实生成保持unsupported**，不能把本轮fixture计数或零成本说成真实模型精度。兼容端点未知capabilities默认也拒绝列表/鉴权/生成，不能按厂商名称猜参数。

目标确认只在Main内存，绑定provider实例、kind、规范化URL与key_revision，重启/Key替换撤销/端点变更后失效。Key在异步解析后和发送前复查；全部DNS地址必须合规且固定连接IP/家族。HTTPS仅公共地址，HTTP仅明确loopback；agent:false、保持TLS主机名/证书校验，不跟随redirect，不自动重试。HTTP/TLS连接完成后再次guard才end发送凭据，等待期间失效不会发送。Abort/cancel释放response/socket；只请求identity编码，压缩响应明确拒绝。完整费用账本留R13。

## 真实执行结果

详细argv/UTC/超时/退出码/日志hash见[逐命令台账](2026-10-17-r09-commands.md)。结果来自本轮集成工作区，不使用原模块123项或以前的主线结果冒充。

| 检查 | 最终实际结果 |
| --- | --- |
| 独立冻结离线安装与环境 | 646缓存复用/0下载，copy导入，32直接依赖与锁匹配；23031文件inode与其他环境共享0；不是本轮冷缓存联网安装 |
| Node完整回归 | Node24.18.1 ABI137，75文件 **1073/1073**，exit0；含本轮原生重编译 |
| R09专项 | 14文件 **227/227**，exit0；含原Adapter、network64项、Registry/Settings/Run/契约及撤销竞态 |
| TypeScript strict /生产构建 | 均exit0，实际Main217.03kB、CJS Preload232.20kB、Renderer964.20kB构建；未升级依赖解决既有Zod注释warning |
| Node SQLite | 五个独立进程各100内存DB/10000行关闭自然exit0；最终重编译后另实际复核exit0；runtime与headers严格24.18.1，无24.21混用 |
| Electron原生与完整回归 | 对应38.8.6 headers源码重编译exit0；真实内置Node22.22.0/ABI139/arm64内存读写压力exit0；75文件 **1073/1073**，exit0 |
| R09真实生产UI | 自有loopback HTTP fixture **12次交互**；实际设置创建两种Provider/模型、fake Key、列表/鉴权/显式生成测试、房间三成员、stream公共上下文、pause/refresh/step/resume、Stop/显式retry/continue；自然exit0 |
| R09退出/新进程 | 初次只读SQLite审计exit0；新进程恢复配置/历史/假密文Key、旧会话确认失效，拒绝未确认start，HTTP请求0，exit0；再次退出只读审计exit0 |
| 原R00–R08生产回归 | 原生产探针本轮初次/新进程均exit0，各18/18精确真实Bridge错误断言；Mock三人、冻结历史、切房、删除/归档保护、Key保存/更换/撤销/跨实例拒绝、主题/尺寸及两轮退出审计实际通过 |
| 安全/差异审计 | main干净未变；158个业务/单元/集成文件与最终回归指纹相同；migration/manifest/lock/构建配置未变，无真实DB/Key/日志/构建产物进入提交 |

专项是完整回归的子集，两套运行时也有重叠，不相加为独立用例总数。无skip/删测试/弱化安全断言。原生重建串行，候选依赖最终停在Electron ABI139；之后运行Node测试必须先用严格24.18.1重建native:node。

### 生产探针证据边界

ready前隔离userData/sessionData/logs、mock-keychain开关、全部safeStorage方法替换为fake加密，Renderer sandbox/contextIsolation/webSecurity开启且NodeIntegration关闭。Chromium外网阻断，Node仅允许探针拥有的HTTP目标；没有读取用户DB/Keychain或发送真实模型请求。

探针动态加载真实 `out/main/index.js`，随后仅在可信Main替换自有fixture的model policy/capabilities及官方URL的transport映射；兼容端点仍运行生产safeFetch。此替换没有产品环境开关、没有Renderer注入能力，必须明确：这是**生产调用链的受控fixture证据**，不是默认真实模型profile或OpenAI公网TLS调用验收。

退出后read-only SQLite审计逐项核对三个实际HTTP body与对应input_snapshot、冻结成员与system prompt、公共输出顺序、1024输出限制、三条usage事件、原partial和三次显式Attempt、foreign_key/integrity、无活动锁及普通表无fake Key明文。新进程HTTP0且历史/Key状态恢复，证明不会自动重发可能收费的旧请求。

原Mock生产探针同轮还实际检查800×600、1024×768、1280×800、1600×1000（受显示器工作区高度限制）×亮暗主题×三个页面的可达性/横向溢出；不是静态截图替代功能操作。

## 失败、定位与修复记录

1. 初始 Registry/Run RED 为缺新module，测试未收集，不能记功能执行通过；完成真实接线后专项实际运行。新测试曾错误按随机turn_id排序对应执行顺序、把未知providerRequestId当undefined；改为turn关联及既有null语义，未改DB去配合错误测试。
2. Settings服务5项/UI4项曾实际RED，补确认、分级测试、Key后清确认及迟到确认关闭保护后GREEN。原测试同步新增受限API、共享Registry构造参数、Key后重新确认及allowGeneration:true，无放宽能力门禁。
3. network测试先修ESM spy夹具；随后实际取消/空响应Abort复现未处理异常，采用done门禁流桥和统一error监听修复，最终64/64。strict揭示一个it.each数组展开的假阳性，改显式records对象表后再全回归/build；没有保留假阳性宣称成功。
4. 独立复审发现迟到鉴权缺完成后guard，实际RED为1pass/3fail（Key/target/disable均错误ok:true）；最小testConnection前后guard修复后4/4，重新执行Node/Electron全部1073及strict/build。
5. 新生产UI探针首次未识别input在前的checkbox label，exit1，生产Main已加载但未完成流程；仅补已有R78定位方式的完整label匹配，业务和构建不变，再跑生产入口自然exit0。
6. 初次重启命令把manifest原 `/private/var` 字符串改成等价 `/var`，严格owner校验在Main前拒绝；保留错误，核实本轮PID/命令后SIGTERM子进程exit=-15（runner shell241）。不放松安全断言，按原规范路径重跑自然exit0。该失败没有生产Main/DB/Key调用；不能算重启通过。
7. 初始化工具/沙箱EPERM、临时副本审查的预期mutant失败、超时监督自检及原生/打包注释warning均保留台账。副本仅证明撤销测试能击穿无guard版本，不算默认网络验收。

## 实际修改文件

下面为基线至业务提交的完整源码/测试模块清单（包含原模块12文件和总控36文件，路径交集为0）。

```text
M	src/main/context/wirePublicContext.ts
M	src/main/database/Database.ts
M	src/main/index.ts
M	src/main/ipc/registerIpc.ts
A	src/main/providers/ProviderRegistry.ts
A	src/main/providers/network.ts
A	src/main/providers/openai-compatible/OpenAICompatibleProvider.ts
A	src/main/providers/openai/ChatCompletionProvider.ts
A	src/main/providers/openai/OpenAIProvider.ts
A	src/main/providers/openai/R09_DELIVERY.md
A	src/main/providers/openai/sse.ts
M	src/main/services/RunService.ts
M	src/main/settings/ProviderSettingsService.ts
M	src/preload/index.ts
M	src/renderer/App.tsx
M	src/renderer/features/settings/SettingsFeature.tsx
M	src/shared/contracts/configuration.ts
M	src/shared/contracts/ipc.ts
M	src/shared/schemas/configuration.ts
M	src/shared/schemas/error.ts
M	tests/integration/joint/renderer.test.tsx
A	tests/integration/providers/openai/http.test.ts
A	tests/integration/providers/openai/protocol.test.ts
M	tests/integration/r07r08/rendererSelection.test.tsx
A	tests/integration/r09/authenticationRace.test.ts
A	tests/integration/r09/contracts.test.ts
A	tests/integration/r09/registry.test.ts
A	tests/integration/r09/registryRaces.test.ts
A	tests/integration/r09/run.test.ts
A	tests/integration/r09/settings.test.ts
M	tests/integration/settings/settingsFeature.test.tsx
M	tests/probes/joint-ui.cjs
M	tests/probes/r07r08-electron.cjs
M	tests/probes/r07r08-ui.cjs
A	tests/probes/r09-electron.cjs
A	tests/probes/r09-native.cjs
A	tests/probes/r09-sqlite.cjs
A	tests/probes/r09-ui.cjs
M	tests/unit/appLifecycle.test.ts
A	tests/unit/providers/network.test.ts
A	tests/unit/providers/openai-compatible/adapter.test.ts
A	tests/unit/providers/openai/adapter.test.ts
A	tests/unit/providers/openai/deadline.test.ts
A	tests/unit/providers/openai/fixtures.ts
A	tests/unit/providers/openai/sse.test.ts
M	tests/unit/rendererSettings/SettingsFeature.test.tsx
A	tests/unit/rendererSettings/r09SessionTarget.test.tsx
M	tests/unit/rendererSync.test.tsx
```

本次治理补充：docs/CONTRACTS.md、docs/DECISIONS.md、docs/STATUS.md、tasks/R09-openai-compatible-provider.md（修正实际Registry路径）及本报告/命令台账。不更改其他任务路线。

## 尚未实现/未验证与后续授权条件

- **真实生成尚未开放**：默认无获审真实模型规则，不能因为保存Key或模型列表成功就声称可生成。后续需为准确providerId/endpoint/model建立可追溯能力、计数/上下文和费用证据，并重新做安全审核；不得用fixture模型规则替代。
- 真实OpenAI或第三方认证/生成、真实TLS握手/证书错误路径、真实系统Keychain、正式跨平台E2E、ASAR/安装包/签名/发布均未验证。HTTPS网络专项用最低层fixture验证TLS选项与pin，不冒充公网TLS。
- 压缩响应目前拒绝；没有自动重试、自动恢复调用、工具执行、R13高级费用账本。上游request ID未提供则保持未知。
- 真实付费smoke另需用户明确批准目标/模型、次数、输出及金额上界，由用户在软件输入真实Key；不得在聊天/报告收集或记录Key。授权前不发真实请求。
- 当前无未解决的本轮fixture集成安全/生命周期阻塞。建议审核本候选后再明确授权最终合main及主线独立复验；本报告不替代那次主线验收。

## Git与停止点

完整历史/原分支/18个WT保留，原main与R09原模块干净且HEAD未变；集成分支代码已提交，交付文档另提交后应干净。只读核对其他WT状态，不覆盖他人内容。R09为review，R10A/R10B/R11/R17未开始。本轮交付到候选停止，不自动merge。

