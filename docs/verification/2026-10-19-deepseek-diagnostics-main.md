# DeepSeek 诊断改进最终合并与主线验收（2026-10-19）

**DEEPSEEK-DIAG-01 已 merged / verified，范围仅安全诊断、本地fixture和既有门禁。** 不代表首次失败已查明、真实联网已修复或可再次发送。

## Git 与安全合并

main实际基线 `524f5052736dd8fbb7e093873d2a1f3c2732fc82`、候选 `codex/deepseek-trial-diagnostics` / `7599949087e0fc0a09c6ca99a33a376eaba9d3f7` 均与授权一致，工作区干净，main为候选直接父提交。18个变更文件范围正确、无敏感模式命中或DB/密钥/构建产物；独立只读复核全部src差异/安全测试，没有合并阻塞。

实际 `git merge --ff-only codex/deepseek-trial-diagnostics` **exit0**，main从524f505快进到7599949，无新merge commit/冲突/历史重写。获批候选仅引入一次，原18个Worktree、分支及历史保留。最终main为包含本次验收状态的独立文档提交，完整SHA见交付消息/Git历史；业务及测试不另改。

新诊断仅固定枚举、版本、必要时间和100–599整数HTTP状态，Schema strict；不记录Key、Authorization、完整请求、未脱敏响应或原异常stack/message/cause。not_started/client_invoked/http_response不把SDK、TCP或请求写入当作服务商已收到。DNS全地址/pinned lookup、TLS证书校验、目标确认、Key归属/修订、预算/未知费用和禁止自动重试保持。

## 本次实际验收

| 检查 | 本次结果 | exit |
| --- | --- | --- |
| main现有原生加载 | Electron38.8.6/内嵌Node22.22.0/ABI139，`:memory:`建表/写/读/关闭 | 0 |
| 完整单元及集成 | **84文件1255/1255**，Electron ABI139，含R07–R09/受控/迁移/诊断 | 0 |
| Node诊断/展示专项 | Node24.18.1/arm64，**2文件66/66**（41分类传输+25菜单） | 0 |
| TypeScript strict | `tsc --noEmit --pretty false` | 0 |
| 生产构建 | Main254.77kB/CJS Preload232.20kB/Renderer964.20kB，输出独立临时根 | 0 |
| 真实生产入口 | main新构建，**49具名断言**（6诊断），2个本地HTTP fixture请求 | 0 |
| 新进程重启 | **30具名断言**（5诊断），HTTP0 | 0 |
| 退出后自建SQLite只读审计 | **35检查**，v4/完整性/外键、诊断及未知预留一致 | 0 |

分组重叠不相加。完整回归包括21条诊断持久/恢复用例，以及v3→v4升级、回滚/备份/恢复/未结唯一索引等既有用例；合并前静态核对migration1 SQL和v2/v3/v4逐字不变。取消默认不读Key/不预留/不请求；Stop保留部分输出和unknown；unknown跨进程保留50000且拒绝新授权/Key读取/请求；普通真实Run仍blocked。

实际命令、UTC、退出码及日志SHA见[主线命令台账](2026-10-19-deepseek-diagnostics-main-commands.md)。本轮所有必要检查通过，无测试失败/业务修复/删改断言；既有构建/启动警告按日志保留。[候选报告](2026-10-19-deepseek-diagnostics.md)及其失败记录维持历史身份，不代替本轮成绩。

## 不影响当前应用的验证方式

不重编译main的SQLite、不执行会切ABI的pretest，也不覆盖main原out。`electron-vite build --outDir <本轮临时根>/probe/out`使用main真实配置和源码，正式输出Main/Preload/Renderer。两份生产probe及package.json从main逐字复制，依赖只读引用main自己的既有ABI139目录。新进程在ready前隔离全部应用路径，safeStorage所有方法fake，Chromium mock-keychain，Node/Chromium公网阻断。

原main out全部文件SHA、原生.node SHA/inode在前后审计中完全一致，当前用户App没有重启、关闭、重新部署或新发送许可。受检src/tests与已授权候选完全相同。复用既有Node原生/压力证据，不再次安装/重建/压力测试；候选Node1255的历史成绩不标成本次main Node全量PASS。

价格快照已于北京时间2026-10-19 00:00过期，未续期/核新价。生产probe仅用显式历史价格fixture时钟（真实墙钟另记），不进入当前联网启动器。价格过期、严格计数不足和unknown保护仍在Key/请求前拒绝；fixture验收不授予真实请求。

## 原unknown与后续非发送检查

原首次真实请求仍unknown、根因/送达/账单无法确认。**本轮没有读写真实测试profile/DB/Keychain，不删除/核销unknown，不释放¥0.05，不据新代码倒推旧错误。** 因而未对真实DB的当前实时状态作新核验；本轮行为没有改变它。用户需通过服务商控制台人工核对实际账单，核销另行审核授权。

后续如另获授权，可以先：

1. 仅静态/只读检查当前启动器的method/path/model限制、逐次许可默认拒绝、diagnostics observer转发及目标修订绑定；核对运行时/ABI、系统时钟和脱敏后的代理/DNS/TLS配置，不对DeepSeek发鉴权/列表/生成或其他API探测。
2. 继续用自建HTTP/TLS与注入DNS/TCP/TLS错误重演网络阶段，使用假Key和独立数据；若要测真实系统Keychain，仅限另获明确授权的自建测试项。
3. 现有真实Key是否可解密，不能由fake后端成功推定，也不能在禁止读取它的条件下证明。不得以“查询Key状态”为名间接调用resolveKey。

当前窗口仍是原构建，尚未部署新诊断。自定义transport启动器需在未来部署授权时核对observer透传；旧strict reader不能读新诊断记录，降级不支持。真实模型/真实Keychain/当前公网连通性、正式E2E/跨平台发布仍未验证。DEEPSEEK-TOKEN-01继续blocked；本轮到main验收文档提交为止，不启动其他任务。
