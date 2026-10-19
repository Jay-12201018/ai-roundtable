# DeepSeek 网络诊断与启动器最小修复候选（2026-10-19）

状态：**review，建议进入合并审核；未合 main、未部署真实 profile、未重启当前窗口。** 分支 `codex/deepseek-launcher-network-fix`，实际基线 `7900a4fbc75aca6c9c4aedb330636bbbea128490`；最终完整候选 SHA 见本文件所在提交/Git 历史及交付消息。不是付费测试授权。

## 实际修复

- 将此前只存在于忽略目录的受控网络包装器纳入 `scripts/controlled-desktop/controlled-network.cjs`。与现用版本仅四行差异：`streamControlledTrial(..., diagnostics?)` 与 `createTransport(guard, diagnostics?)` 两个边界完整透传 observer。保留全部 target/method/body/DNS/TLS/socket/redirect/一次性 lease 校验；不增加代理或任意网络能力。
- `launcher.py prepare/open` 与 `main.cjs` 取代硬编码旧 main 的方案，作为未来部署入口保存在仓库。prepare 仅接受脚本所属仓库的干净 main，在全新物理目录执行 strict、真实三端构建和 ABI139 内存检查；绑定 HEAD/tree、所有输出、启动代码以及 Electron 可执行文件、SQLite native 和安装锁散列。open 再次核对最新 main，拒绝旧构建、源码/依赖变化、产物篡改和符号链接；不会默用旧 app-out。
- owner.main 只作历史字段；保留原 profile/appName/userData/sessionData/Keyguard 服务与账号身份，校验原 owner/guard 散列。发现旧 PID 活跃或进程检查权限不明即拒绝打开，不终止旧进程、不覆盖旧构建。
- 本候选生产入口固定未授权发送、原生确认 cancel-only，不读取/claim/迁移旧许可。真实 launcher 固定 DRY=0 并拒绝 fixture 身份；探针 DRY=1 必须独立 fixtureOnly 身份、mock-keychain 和全 fake safeStorage。没有真实 Key 读取、密钥复制或新的联网许可。
- `src`、Shared/IPC、package/lock、migration1–4、价格、预算及普通 Run 代码均无变化。新增脚本/测试和本轮记录没有数据库或凭据文件。

## 真实执行结果

环境：重新验证官方 Node24.18.1 darwin-arm64 archive SHA，提取完整 runtime/include；独立原锁文件安装，独立 node_modules/store/cache。先完成 Node ABI137 测试，之后仅在候选依赖中使用严格对应的125个 Electron38.8.6 headers 重建 ABI139，实际内嵌 Node22.22.0/arm64。main 的依赖、out 和冻结 app-out 不参与重建。

| 本次检查 | 实际结果 |
| --- | --- |
| Node 完整单元/集成回归 | 84文件1255/1255，exit0 |
| TypeScript strict / 生产 Main+CJS Preload+Renderer | 各 exit0；既有 Zod 注释构建警告保留 |
| Python 启动器行为 | 21/21，exit0；涵盖新旧 main、dirty/分支、产物/native/构建中依赖变化、路径及运行进程拒绝 |
| 真实 Registry→Adapter→受控包装→诊断 | Node/Electron各8场景，exit0；DNS/TCP/TLS/中断类别、HTTP429、脱敏、未授权与单次不可重试 |
| Electron 受影响诊断/受控专项 | 9文件178/178，exit0 |
| 新包装器实际本地 TLS | 5场景30断言，exit0；可信 CA 成功，缺/错 CA、关闭校验、错 SNI 均拒绝 |
| Electron ABI139 内存 SQLite | 4断言，实际写入/读取/关闭，exit0 |
| 新 prepare 的完整命令执行 | 自建临时 main Git fixture 使用相同候选源码，strict/三端构建/ABI检查/manifest登记 exit0；未更改原 main |
| 隔离真实生产 JS 入口与新进程重启 | 28+21断言，均exit0；实际 Main/Preload/Renderer/Menu、默认取消、fake Key、普通generation拒绝、unknown阻止新确认、最近DNS安全诊断及退出SQLite v4完整性/精确证据保持 |
| Main/Chromium 本地代理对照 | 10断言，exit0；Main直接命中自建目标、Chromium经自建代理；系统代理解析为127.0.0.1:7890 |

生产探针的unknown只在自建临时DB手工植入，用于验证保留和拒绝规则，并非第二次真实网络失败。生产入口探针只证明 JS 装配：out来自候选 Worktree（业务源码与7900完全相同）、动态标签取main SHA。完整Python版本绑定另由21项行为测试及真实prepare命令验证；临时Git fixture SHA不能冒充原main提交。探针只在自身进程采用明确标注的历史价格fixture时钟以到达取消路径，受控网络gate仍过期且未arm；生产价格未续期。

本次原始命令、退出码、时间及日志散列见[逐命令台账](2026-10-19-deepseek-launcher-network-commands.md)。没有删除测试、skip或降低断言。Node完整回归后未机械重跑全部Electron1255，Electron只重跑受影响178项、实际native、包装器/TLS及生产入口。

## 失败与修复记录

- 旧离线内容缓存不全，第一次安装 ERR_PNPM_NO_OFFLINE_TARBALL exit1；后续冻结下载补齐包。随后旧临时 Node 的 include 文件已缺失，原生编译 exit1；从已核验官方同版 archive 提取完整环境后，离线冻结安装 exit0（646包、独立copy导入）。不是升级依赖，也未复用旧 node_modules。
- 首次回归探针直接 require 间接依赖 esbuild 失败 exit1；改从现有 Vite 解析，不新增依赖。真实红灯随后明确 `transport observer was dropped` exit1。第一次绿灯又暴露 fixture DTO/KeyService 不完整，补齐真实契约后8场景全部通过。所有原失败回执保留。
- 新启动器红绿测试期间发现 out/data 根符号链接和 ps 权限失败被误当无进程等问题，均在候选中修复；最终21项通过。
- 曾直接运行导出函数型 packaged-native hook，exit0但没有执行断言，**不计为原生验证**；随后新实际探针4断言通过。
- 首次生产入口 probe exit1，原因是假 safeStorage 替身没有安装 macOS 原本不存在的 getSelectedStorageBackend；仅修复测试替身，未修改业务或放宽断言，之后28/21通过。

## 网络结论与未验收范围

FClash 当前系统代理及 TUN 开启、规则出站由用户确认，但首次失败时的模式未知。当前 Main 自定义 Node 直连/pinned DNS 不自动消费系统 HTTP/SOCKS 代理；Chromium 使用代理。loopback fixture 不穿越真实公网 TUN 规则，不能证明 DeepSeek 直连不可用，也不能判定首次 network_error 根因。因此按授权条件**本轮不添加专用代理**，不改系统代理、VPN或证书。若未来确有具体阶段证据表明必须走代理，需另行审查保留目标、DNS、TLS、禁止重定向和凭据边界的最小传输，而非只继承 HTTPS_PROXY 或放开 socket。

修复后本地受控链可可靠保留白名单阶段/类别及数字HTTP状态。client_invoked仍只表示客户端被调用；http_response只表示观察到响应，不证明计费。新代码不能倒推首次请求送达与费用。

未读写原真实 profile/DB/Keychain，原 unknown 与¥0.05预留没有被触碰。再次真实请求仍受其保护、已过期价格、严格模式 DEEPSEEK-TOKEN-01、最新构建部署/人工正常关闭旧窗口及另行单次许可/原生本人确认约束。本候选不提供核销、价格续期或真实许可接线；以上操作分别待用户授权。

main 人工验收由治理流程决定，哈希只证明版本对应。last-open PID是拒绝活跃窗口的前置检查而非跨进程原子锁，生产Main在打开DB前的单实例锁继续保护仓储；本轮不扩为部署框架。真实公网DNS/TLS/TUN/账单、真实Keychain、跨平台及正式发布均未验证。

提交前最终只读审计确认：原main HEAD仍7900且干净，PID27099启动时间不变；原out全文件、冻结Main、四个现用启动文件及SQLite native哈希/inode均与本轮开始一致。11个暂存文件无DB/密钥/构建或敏感模式命中。详情见本轮临时根`final-audit.json`。
