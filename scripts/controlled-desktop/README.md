# 独立受控桌面启动器

这是可追踪的启动器候选，不会替换或重启已运行的旧窗口。先由总控审核合入 main，并在主线验收后使用。main 的审核状态仍由项目治理流程决定，启动器不能自动证明某次提交已经获得人工验收。

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

本候选入口明确为**未授权发送**：不读取、迁移、claim 或新建旧的一次性发送许可，原生受控确认仅可取消，网络 gate 无可用 lease。普通真实 Run 门禁、TLS、DNS、目标限制、禁止重定向、诊断脱敏、预算与 unknown 预留规则均保留；没有价格续期或自动重试。今后实际单次发送许可须另行审核并获得用户明确授权，不能以启动器更新代替付费授权。

本轮不自动部署到真实 profile；当前运行窗口及其数据保持原样。新诊断数据不支持旧二进制读取，更新后的 profile 不得回退交给旧应用。第一次请求的 unknown/¥0.05 仍需账单证据人工核对，本启动器不提供释放预留的入口。

## 本地测试

```sh
PYTHONDONTWRITEBYTECODE=1 python3 tests/probes/controlled-launcher.test.py
```

生产 launcher 固定 `ROUNDTRIAL_DRY=0` 且拒绝 `fixtureOnly` 身份。生产入口 probe 如使用 `ROUNDTRIAL_DRY=1`，必须是自建 `fixtureOnly:true` 临时 profile，并开启 Chromium mock-keychain 与全 fake safeStorage；这不改变真实启动路径的加密身份。

测试只创建临时 Git 仓库、虚构产物、虚构 profile 元数据；不加载真实应用、Keychain 或用户数据库，不发网络请求。
