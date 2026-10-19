# DeepSeek 诊断与启动器修复：正式合并与主线验收（2026-10-19）

**DEEPSEEK-LAUNCH-01 已 merged / verified，范围仅版本绑定、安全诊断和本地fixture。** 不代表真实网络、Keychain或付费请求已验收，不切换当前用户窗口。

## 合并与安全复核

原main实测`7900a4fbc75aca6c9c4aedb330636bbbea128490`，获批候选`f04ed4873066eefd7161dd721f104caf4ad1ac30`及原候选Worktree均干净，候选直接父提交就是原main。11文件差异全部在授权范围，未改src、Shared/IPC、package/lock、构建配置或migration1–4。独立只读复核无合并阻塞；敏感模式与DB/密钥/构建产物检查无命中。

实际`git merge --ff-only codex/deepseek-launcher-network-fix` **exit0**，main快进到完整f04，无merge commit、冲突、重复集成或历史重写。全部分支/Worktree保留。两处observer只透传，不读取或记录头/凭据/原异常；默认cancel-only，不读取/claim旧许可。

## 本次main新鲜证据

| 检查 | 本次真实结果 |
| --- | --- |
| Python启动器行为 | 21/21，exit0 |
| Node24.18.1及Electron38.8.6包装器 | 各8场景，exit0；真实Registry/Adapter链的DNS/TCP/TLS/HTTP、脱敏与单次限制 |
| Electron受影响诊断及受控回归 | 9文件178/178，exit0 |
| TypeScript strict | exit0 |
| Main/CJS Preload/Renderer生产构建 | 独立输出，exit0，不覆盖原out |
| 新包装器本地真实TLS | 5场景30断言，exit0；CA/SNI/强制校验拒绝仍生效 |
| Electron ABI139内存SQLite | 实际4断言写入/读取/关闭，exit0 |
| 真实隔离生产JS入口/新进程重启 | 28+21断言，均exit0；动态f04版本、实际Main/Bridge/Menu、默认取消、普通generation拒绝、unknown保留及退出v4完整性 |
| 真实main上的prepare命令 | clean main f04实际strict/三端构建/ABI/manifest登记exit0，未用临时Git fixture冒充主线 |

确切argv、退出码、时间、日志SHA与失败记录见[本次命令台账](2026-10-19-deepseek-launcher-main-commands.md)。候选Node1255等旧证据仍有效但不标成本次main全量PASS；本次未机械重跑与脚本改动无关的压力/全量/跨平台验证，没有重建main原生模块或安装依赖。

初次受限沙箱运行：Python2项因禁止ps报错，TLS因127.0.0.1监听EPERM退出1，受影响Vitest33失败/4异常均涉及loopback权限。保留原始失败，在获得本地进程/fixture权限后同代码、同断言重跑，21/30/178全部通过；未删除或放宽测试。Zod构建注释、外部outDir和Electron sandbox_extension日志警告保留，不冒充产品失败修复。

生产probe从本次main逐字复制测试与启动源码，使用main新构建输出和只读引用的同仓库ABI139依赖；GIT_DIR/GIT_WORK_TREE仅让该临时probe读取实际main SHA，不创建其他开发Worktree。所有userData/sessionData、假Key、mock-keychain、fake safeStorage与SQLite均独立，公网网络全阻断。历史时钟只用于自身取消路径，未续期生产价格；其unknown是自建临时DB测试记录，绝不是原用户记录。

## 原profile和费用证据

按本次用户明确授权，对原独立profile的controlled_trials仅进行`mode=ro`、`query_only=ON`事务查询：ID/请求身份、状态、错误码、预留、结算/usage及安全诊断字段。**没有读Key表、解密API Key或调用Key状态接口。** 前后安全投影SHA一致：1条unknown、50000 micro-CNY预留、实际费用仍NULL，原记录无诊断字段，不能补推旧失败。

原owner/manifest、四个旧启动器文件、冻结Main、原out所有文件与SQLite native SHA/inode前后一致；当前PID27099仍为10月18日20:18:36启动的原窗口。未重启/关闭/部署、未触碰系统代理/证书/FClash、未开启任何新发送许可。

## Finder打开与版本识别

仓库正式实现为`scripts/controlled-desktop/launcher.py`。本地Finder辅助入口位于`.cache/controlled-desktop-main/打开最新版AI圆桌.command`，仅调用open，指向最终干净main对应的新快照；旧`.cache/deepseek-v4-desktop`的启动文件和app-out不覆盖。最终治理文档提交后须按其实际HEAD生成匹配快照；具体完整SHA与收尾prepare回执见交付消息和该快照的build-manifest.json，不用旧f04产物绕过版本校验。

本轮不执行该Finder文件去切换真实profile。用户以后自行正常退出旧窗口后双击；旧窗口还活跃、main/依赖变化或产物不匹配时启动器拒绝。保留原appName、data目录及Keyguard service/accounts身份，不复制Key。新窗口标题为`AI 圆桌 · main <当前SHA前7位> · 未授权发送`，manifest记录完整SHA。人工验收仍由治理流程决定，哈希不能代替用户批准。

## 仍缺少的证据与阻塞

首次失败时FClash状态未知。本地代理路径差异不能证明当时公网TUN/规则、DNS实际答案、TCP/TLS连接或HTTP响应，因此真实送达/费用仍unknown。没有对DeepSeek公网做任何DNS/API探测，未添加专用代理。未来需要具体阶段证据及服务商实际账单人工核对；本轮修复不倒推旧根因。

普通真实Run的DEEPSEEK-TOKEN-01保持blocked；价格快照过期仍拒绝，unknown预留不自动解除。再次真实请求还需另行核价、明确账单/预留处理、部署及新单次许可接线授权，再由本人原生确认。真实Keychain、公网/TUN、正式E2E和跨平台发布未验证；不启动R10/R11等任务。
