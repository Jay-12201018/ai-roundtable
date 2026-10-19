# DeepSeek Fake-IP / 回环 CONNECT 兼容修复候选

2026-10-19。状态：**review，未合 main、未部署用户应用、未开启真实发送许可**。

- 分支：`codex/deepseek-loopback-proxy`。
- 基线/main：`1c4d2afb1afbae288ac1201c618ffd9cc39999bb`，开始及交付检查均干净、未移动。
- 实现提交：`746c4de5df871697c7975ba69bbb75c56b9d46b8`。最终候选另含本报告及治理提交，完整 SHA 见交付消息/Git；没有修改已提交业务再复用旧成绩。
- Worktree：`/Users/zhangwenjie/.codex/worktrees/deepseek-loopback-proxy/AI交互`；保留所有原分支和 Worktree。
- [逐命令台账](2026-10-19-deepseek-loopback-proxy-commands.md)。本轮只有本地 fixture，不解释首次真实请求是否送达或计费。

## 实现及信任边界

默认仍直连，原 `publicAddress` 规则原文不变，`198.18.0.0/15` 继续拒绝。新增 Main-only 回环 HTTP CONNECT 传输；没有把 Fake-IP 视作公网，没有自动采用系统代理、HTTP_PROXY、HTTPS_PROXY、SOCKS 或代理凭据。

显式配置只接受 `http://127.0.0.1:<1..65535>` 或 `http://[::1]:<1..65535>`，同时必须确认信任该代理的远端 DNS。拒绝远程代理、localhost 名称、非规范数字地址、额外路径/查询/片段、凭据、非 HTTP 和非法端口。7890 只是可配置示例；运行时要求真实有效的 CONNECT 200，无效协议/端口失败关闭，不重试、不回退直连。

本期代理 allowlist 仅 `POST https://api.deepseek.com/chat/completions`，有效端口443、无查询/片段/凭据。Registry 在读取 Key 之前拒绝其他代理目标，transport 再核验实际 URL/method；原 Provider 目标确认、Key revision 和受控固定输入门禁保持。代理配置接口是通用的，其他 Provider 的目标必须另经审查扩展白名单，本轮不开发 R10。

CONNECT 只含 `Host: api.deepseek.com:443`，不携带 API Key、Authorization 或请求正文；限制响应头8192字节、建隧道10秒超时，拒绝非200、畸形/超长响应和预先注入的数据。隧道上仍用 `rejectUnauthorized:true`、`servername:api.deepseek.com`，按系统信任库验证证书链及主机名；只有 secureConnect 后复核权限才发送 API 头/正文。不接受重定向、代理认证、关闭 TLS、关闭主机名检查或自动降级。

**代理端 DNS 是明确改变的信任边界。** 普通域名 CONNECT 无法证明代理最终连接的 IP 为公网；客户端不再将本机 Fake-IP 当作远端 IP，而是信任用户指定的回环代理解析固定目标。固定域名/端口/路径和通过认证的 TLS 约束 HTTP/凭据目的地，不能向任意兼容地址开放隧道。若不能信任本机代理或系统 CA，就不得启用此模式；如果要求客户端证明远端实际 IP 为公网，普通 CONNECT 不满足该要求，应继续拒绝，不能声称这项证明已完成。

受控包装器额外绑定“一次固定 POST → 一次回环 CONNECT → 返回的同一个隧道 → 同一已验证 TLS socket”；拒绝其他 CONNECT、替代 socket、代理凭据、早发正文及直连回退。默认仍 `sendAuthorized:false`、过期 lease、原生确认只提供取消。本候选没有提供新的真实发送许可。

## 文件与公共影响

| 文件 | 必要变化 |
| --- | --- |
| `src/main/providers/loopbackProxy.ts` | Main-only 配置校验、固定目标及 CONNECT Agent |
| `src/main/providers/network.ts` | 可选代理路由；保留直连 DNS/pinning、流/Abort/TLS 行为 |
| `src/main/providers/ProviderRegistry.ts`、`src/main/index.ts` | 显式进程配置注入同一 Registry，读 Key 前目标约束 |
| `src/main/providers/diagnostics.ts`、`controlledTrial/menu.ts` | 白名单 `proxy` 阶段、`proxy_failed/proxy_rejected` 及安全中文展示 |
| `scripts/controlled-desktop/launcher.py`、`main.cjs`、`controlled-network.cjs` | 显式参数、相同 profile 身份、无发送许可、隧道 socket gate |
| `tests/unit/providers/loopbackProxy*.test.ts` | 19项配置/目标 +18项真实回环/TLS/持久预留专项 |
| `tests/probes/controlled-proxy-gate.cjs`、`controlled-proxy-tls.cjs` | 模拟恶意调用和实际传输链验证 |
| `tests/probes/controlled-launcher.test.py`、`controlled-launcher-electron.cjs` | 显式路由、身份、生产 Main 注入/菜单/诊断/重启 |
| `docs/CONTRACTS.md`、`DECISIONS.md`、`STATUS.md`、`ENVIRONMENT.md`、`VALIDATION.md` | 本候选责任、接口、信任及验证边界 |

没有修改 Shared/IPC/Preload/Renderer 契约、Database、migration1–4、KeyService、价格、费用算法、package/lock 或依赖版本。仅扩展既有 Main-only JSON 诊断枚举，没有 SQL 变化；旧记录兼容，包含新代理枚举的记录不可降级给旧 strict reader。

## 实际验证

受控官方 Node24.18.1 / 同版完整 headers / arm64 / ABI137；pnpm11.25.0；Electron38.8.6 / Node22.22.0 / ABI139；better-sqlite3 12.11.1。新 Worktree 独立 node_modules/store/cache/TMPDIR，从原锁文件冻结离线 copy-import 安装，646 reused/0 downloaded；不是复制 node_modules，也不是本轮冷缓存公网安装。Node 编译完成测试后，串行用匹配 Electron headers 重建；最终原生文件为 ABI139。

| 检查 | 本次结果 |
| --- | --- |
| 冻结安装、Node 原生内存 SQL | exit0；10000行、sum、完整性、正常关闭、独立 inode/锁字节核对 |
| 最终 Node 完整回归 | **86文件1292/1292，exit0** |
| 最终 Electron 完整回归 | **86文件1292/1292，exit0**；包含上述37项专项，不能再累加 |
| TypeScript strict、生产 Main/Preload/Renderer 构建 | exit0；保留 Zod 纯注释标记警告 |
| 启动器 Python | **24/24，exit0** |
| 代理 gate，Node/Electron | 各13场景57断言，exit0；模拟原生，无真实 socket |
| 实际 Registry→Adapter→CONNECT→TLS→SSE，Node/Electron | 各10场景121断言，exit0；外层仅允许自建回环端口，公共 DNS/API 0 |
| 保留的直连包装器/真实 TLS，Electron | 8场景、5场景30断言，均exit0 |
| Electron 独立 ABI/SQLite | ABI139、10000行内存事务/sum/完整性/关闭，4断言exit0 |
| 实际生产 Main/CJS Preload/App 原生菜单 | 显式代理注入 Registry、sandbox/Bridge、fake Key配置、默认取消无读 Key、普通生成unsupported、代理诊断展示、unknown保留：31断言exit0 |
| 同一自建 profile 新进程重启/退出审计 | 24断言exit0；v4、integrity、原 unknown JSON 完全保留，真实Keychain/API 0 |

实际 TLS 成功使用自建 CA 签发的固定域名证书，只在测试进程的 TLS fixture 注入 CA；不改产品 TLS 参数、系统信任库或用户证书。证书错误/主机名不符均在发送 API 头/正文前拒绝。代理407/502不记作 DeepSeek HTTP 响应，只有隧道内真实观察到的HTTP数字状态才提升证据；302/429不跟随、不重试。

保留失败：缺实现时配置 suite exit1/空测试集（不是PASS）；新测试 SNI 联合类型导致 strict exit2；CONNECT 截止时间误记 cancelled 的新断言 exit1，随后修为 timeout；新增 Python Popen mock 错误拦截 Git 子进程导致2 errors/exit1，缩小测试 mock 后24/24通过。一次完整回归启动被审批服务额度耗尽阻止，命令未执行且无退出码；恢复后通过原审批路径运行，没有绕过。生产 Electron 的 sandbox_extension 警告保留，实际 webPreferences、Bridge、自然退出与 SQLite 审计均有断言，不能把警告或截图当 PASS。

## 使用及停止条件

合并/部署须另获用户授权。本候选不能从功能分支直接充当经过验收 main 的正式启动器；launcher 仍要求最新干净 main、manifest 与产物/依赖/启动脚本哈希一致，拒绝旧缓存。未来在获批 main 准备新快照后，可在原 `open --build-root ... --profile-root ...` 后显式加：

```sh
--connect-proxy http://127.0.0.1:7890 --trust-proxy-dns
```

这只选择网络路由，不授权任何发送；默认不加参数仍直连。原 profile、数据库和 appName/service/accounts 身份保持，不复制或重新保存 Key。当前已运行的应用、Finder 入口和旧离线预览本轮均未替换/重启。

结论：Fake-IP 兼容性在本地严格模拟中已解除，候选具备提交最终合并审核的条件。**不等于实际 FClash、公网 DeepSeek、真实 Keychain 或付费请求已验收**。本轮没有读取原 profile/Key/费用记录；隔离同形 unknown 记录与50000微人民币预留跨恢复/重启保持，不能据此自行核销原记录。

下一次真实测试仍需：批准合 main 及独立验收/部署；确认并信任当前回环代理及端口；人工账单核对既有 unknown/¥0.05（没有自动释放入口）；重新核实届时已过期的价格规则；另行授权新的单次许可及本人最终原生确认。普通真实生成的 DEEPSEEK-TOKEN-01 继续 blocked。本轮不进行其中任何操作，不启动后续模块。
