# 独立受控桌面启动器

这是已合入 main 并通过本地主线验收的启动器，不会替换或重启已运行的旧窗口。验收证据见 [主线报告](../../docs/verification/2026-10-19-deepseek-launcher-main.md)。main 的审核状态仍由项目治理流程决定，启动器不能自动证明某次提交已经获得人工验收。

## 构建与打开

在已验收且干净的 main 仓库内执行；build-root 使用物理绝对路径（例如 `/private/tmp/...`），不接受符号链接及其祖先；`<node>` 必须是 `docs/ENVIRONMENT.md` 规定、已核验的 Node 24.18.1 darwin-arm64 二进制。依赖必须已安装且 SQLite 已为 Electron ABI139 编译；本启动器只验证，不安装或重编译依赖。

```sh
python3 scripts/controlled-desktop/launcher.py prepare \
  --node '<node>/bin/node' \
  --build-root '<独立临时目录或仓库内被忽略的.cache>/<本次新构建目录>'

python3 scripts/controlled-desktop/launcher.py open \
  --build-root '<上一步的新构建目录>' \
  --profile-root '<原独立受控应用目录>'
```

`prepare` 进行 strict 类型检查、真实 Main/CJS Preload/Renderer 生产构建及 Electron ABI139 内存 SQLite 读写；输出到全新目录，不覆盖仓库 `out` 或旧 `app-out`。manifest 绑定构建时的 main HEAD/tree、启动脚本、全部输出及关键 Electron/SQLite/安装锁散列。依赖仅符号链接至同一仓库已验证的 `node_modules`，不会共享其他 Worktree 的可变依赖。main 更新后须重新 prepare；不会继续运行过时产物。

`open` 再次要求当前分支是干净 main，校验来源与产物散列；旧进程尚存或无法检查时拒绝启动，需要用户自行正常关闭旧窗口。保留原 profile 的 appName、userData/sessionData 和 Keyguard 服务/账号身份，校验原 owner/guard 散列，不读取或复制 API Key。旧 owner 的 `main` 字段仅保留为历史来源，不能覆盖新 manifest 的实际代码版本。

## 不授予真实请求权限

当前入口默认**未授权发送**：不读取、迁移、claim 或继承旧许可。原「DeepSeek 单次测试…」在没有本会话许可时仅可取消；新增显式准备入口、最终原生确认及失效规则见下节。普通真实 Run、TLS、DNS、目标限制、禁止重定向、脱敏和 unknown 保护保留；没有自动续价、重试或真实发送。启动或代码更新本身不是付费授权。

本次合并不自动部署到真实 profile；当前运行窗口及其数据保持原样。新诊断数据不支持旧二进制读取，更新后的 profile 不得回退交给旧应用。第一次请求的 unknown/¥0.05 仍需用户核对页面并明确决定；新增人工对账菜单只记录独立审计，不自动处理旧预留。

## 本地测试

```sh
PYTHONDONTWRITEBYTECODE=1 python3 tests/probes/controlled-launcher.test.py
```

生产 launcher 固定 `ROUNDTRIAL_DRY=0` 且拒绝 `fixtureOnly` 身份。生产入口 probe 如使用 `ROUNDTRIAL_DRY=1`，必须是自建 `fixtureOnly:true` 临时 profile，并开启 Chromium mock-keychain 与全 fake safeStorage；这不改变真实启动路径的加密身份。

测试只创建临时 Git 仓库、虚构产物、虚构 profile 元数据；不加载真实应用、Keychain 或用户数据库，不发网络请求。

本地Finder辅助文件为仓库`.cache/controlled-desktop-main/打开最新版AI圆桌.command`（本地生成，不是发布包）。当前旧窗口不自动退出；用户以后自行正常退出后双击。标题显示实际main短SHA及“未授权发送”，完整SHA见其build-manifest.json。main更新后须重新prepare并指向新快照，不能复用过时构建。


## DeepSeek 单次许可与人工对账（2026-10-19）

启动始终未授权；没有 CLI 自动许可开关。保留既有 profile/appName/Keychain 身份与明确回环代理参数。

1. 原生菜单「受控测试 → 人工对账与预留处理…」选择旧 unknown 请求；核对同账号/同 API Key/覆盖请求的最近30天控制台0请求、0 Tokens、¥0.00，勾选实际核对确认。可以只记录并保留预留；只有第二层明确批准才能释放该笔客户端预留。
2. 原 unknown/usage/error 历史不改；「查看人工对账记录…」查看处理时间、固定安全证据说明及决定。页面未显示消费不证明绝对无费用；本地释放也不是服务商账单结清。记录超过30天或将来时间拒绝套用此证据。
3. 在设置中确认精确目标；目标确认不跨进程继承。使用「受控测试 → 准备本会话单次许可…」选择 DeepSeek Provider，先确认仅准备这一次许可，再亲自点击最终「授权并发送这一次请求」。旧「DeepSeek 单次测试…」入口不自动领取许可。
4. 固定 Reply OK.、单 Agent、max_tokens128、thinking.disabled、¥0.05预留，费用是未校准估算且非账单硬上限。仅一次 POST /chat/completions；取消/停止/关窗/退出/过期撤销，不自动重试；重新启动无继承许可。普通真实Run保持严格拒绝。
5. 本轮实现不代表已授予真实请求许可；自动化只有假Key及本地fixture。当前真实旧记录不由安装/迁移自动核销。
