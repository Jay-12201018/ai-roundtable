# FClash 回环 CONNECT 正式合并与主线验收

2026-10-19。**DEEPSEEK-PROXY-01 merged/verified，仅本地 fixture、安全接线与启动器。** 不代表实际FClash、公网DeepSeek或真实Keychain验证，不授予真实发送权限。

## Git 与安全门禁

- 原main：`1c4d2afb1afbae288ac1201c618ffd9cc39999bb`；获批候选：`04bf8a20e047f3c46cb3017921ddac049ba9f5ae`；分支 `codex/deepseek-loopback-proxy`。
- main/候选实际HEAD、工作区干净、祖先关系、两次提交和22文件范围重新核验；独立只读安全复核没有发现阻塞问题。
- 实际 `git merge --ff-only codex/deepseek-loopback-proxy` exit0：main直接前进到04bf8a20，无新merge commit/冲突/历史重写。20个Worktree与原分支保留。
- 本轮只追加状态及证据文档，没有修改合并后的业务/安全/构建配置/测试输入。最终main完整SHA由本报告所在治理提交及交付消息确定。
- Database、migration1–4、Shared、Preload、Renderer、package/lock与原main无差异；提交不含数据库、Key、临时日志或构建产物。

复核确认：仅显式配置的规范回环HTTP代理、无代理凭据/环境自动代理；CONNECT固定 `api.deepseek.com:443`，实际POST固定 `/chat/completions`；TLS证书/SNI/主机名、同一隧道身份、发送前权限、目标/Key修订绑定、预算和原生确认保持。无重试、重定向或失败直连回退，CONNECT不携带Key，诊断不保留原始头/响应/堆栈，也不将代理HTTP状态当成DeepSeek响应。

**远端DNS明确委托用户信任的本机代理。普通CONNECT无法证明代理实际远端IP为公网。** 固定域名/端口/路径及有效TLS约束HTTP/凭据目的地；不能信任本机代理/OS CA时不应启用，更不能向任意兼容域名开放或放行198.18/15。

## 本轮 main 实际结果

[精确命令/退出码/指纹](2026-10-19-deepseek-loopback-proxy-main-commands.md)。所有测试只使用自建回环代理、CA、假Key、临时DB和profile；真实API、真实Key读取、系统Keychain访问均为0。没有读取原unknown记录/真实数据库，也不修改其¥0.05预留。

| 检查 | 新执行结果 |
| --- | --- |
| Electron完整单元/集成回归 | 86文件1292/1292，exit0；含Mock/R07–R09/DB/迁移/受控流程 |
| 网络、代理、诊断、原生菜单与受控费用专项 | 12文件279/279，exit0；与完整组重叠，不累加 |
| Node/Electron实际Registry→Adapter→CONNECT→TLS→SSE | 各10场景121断言，exit0；Fake-IP直连拒绝、显式代理成功、无授权/无lease零Key读取、TLS错误、代理407/502及HTTP302/429拒绝/不重试 |
| Node/Electron代理gate | 各13场景57断言，exit0；错误目标/端口/代理/凭据/隧道/TLS关闭/早发正文/直连回退拒绝 |
| 原直连诊断包装器，Electron | 8场景，exit0；observer透传及安全证据不回归 |
| Python启动器 | 24/24，exit0；清除继承代理、profile身份不变、错误配置和旧快照拒绝 |
| TypeScript strict、Main/CJS Preload/Renderer生产构建 | 各exit0；正式outDir指向本轮独立临时目录 |
| ABI及原生SQLite最小自检 | Electron38.8.6/Node22.22.0/ABI139，4断言exit0；仅内存读写/完整性/关闭 |
| 隔离真实生产入口 | 31断言exit0；Main注入代理、受限Bridge、原生仅取消、普通真实生成unsupported、代理诊断与unknown展示 |
| 同一自有profile新进程重启与退出SQLite审计 | 24断言exit0；v4、完整性和unknown JSON/¥0.05完全保留 |

Node24.18.1/ABI137/arm64实际版本重新确认，只做纯网络/类型/构建；未运行本轮Node完整回归、未源码重建/安装/压力测试。main原生文件已是匹配Electron ABI139，直接实际加载；原out及.node共7文件SHA/inode前后一致，避免改动当前应用的运行文件。没有把候选1292当作本次Node PASS。

本轮检查无失败。保留构建的Zod PURE注释/outDir在仓库外警告，以及Electron sandbox_extension/task_policy系统警告；实际webPreferences、Bridge、自然exit0和退出DB有断言。生产探针复制本轮独立构建及逐字节相同的Main包装器/探针到自有目录，用GIT_DIR/GIT_WORK_TREE只定位真实main SHA；这不是更换用户应用或正式E2E。

## 最新启动器与显式代理使用

当前正在使用的窗口未关闭、重启或替换。现有Finder快捷文件仍指向旧1c4d2af构建；合并后不能把它当作最新版，严格启动器会拒绝旧快照。启动器来源为仓库 `scripts/controlled-desktop/launcher.py`。

目前**没有应用内代理设置开关**。代理是Main启动配置，只在启动器 `open` 增加 `--connect-proxy http://127.0.0.1:7890 --trust-proxy-dns`；未加参数保留直连，不能自动采用FClash/系统代理。7890须以届时用户实际配置为准，协议不符/不可连失败关闭。

以后用户手动保存并退出当前窗口后，可以在Terminal执行以下命令；**本轮未执行prepare/open，也没有更改原profile**。Node路径是本机已核验环境，若临时目录已失效，按ENVIRONMENT重新准备同版官方环境，不能换用未核验Node。

```sh
cd '/Users/zhangwenjie/Documents/ChatGPT/AI交互'
trial_main_sha="$(git rev-parse HEAD)"
trial_build="$PWD/.cache/controlled-desktop-main/builds/$trial_main_sha"
python3 scripts/controlled-desktop/launcher.py prepare \
  --node '/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/runtime/node-v24.18.1-darwin-arm64/bin/node' \
  --build-root "$trial_build"
python3 scripts/controlled-desktop/launcher.py open \
  --build-root "$trial_build" \
  --profile-root "$PWD/.cache/deepseek-v4-desktop" \
  --connect-proxy http://127.0.0.1:7890 --trust-proxy-dns
```

prepare要求干净main和全新构建目录，已存在目录不得覆盖；准备完成的快照若main再次变化必须重建。open保留原profile、数据库和appName/service/accounts，拒绝当前仍活动的同profile进程；不会代替用户退出，不复制或重写Key。代理参数不授予发送；窗口仍“未授权发送”，原生最终确认仍仅取消。

## 下一步：仅验证真实链路

须另获明确授权，可做有界、固定目标的一次DNS检查/通过原直连门禁的TCP443/TLS；若仍返回Fake-IP，记录target_rejected并不直接拨该地址。另经已确认回环代理，仅发送无凭据的 `CONNECT api.deepseek.com:443`，隧道内仅做SNI/主机名/证书验证后关闭。不得发送隧道内HTTP字节、POST/GET/鉴权/模型列表，不读取Key，不创建Trial/预算记录或新发送lease。

记录直连DNS/门禁和代理TCP/CONNECT/TLS分别的阶段、固定超时/次数及证书验证结果，不能把“隧道/TLS建立”解释为“生成API可用”。本轮没有运行上述真实网络诊断，也不能倒推首次付费失败。首次unknown/预留仍须用户以服务商账单证据人工核对；价格快照过期、普通严格TOKEN门禁和逐次原生授权限制保持。不启动后续模块。
