# R01 总控集成验证记录

2026-10-13，Asia/Shanghai。本轮完成独立集成准备、R01-SHARED-01 接线、回归修复与验证；状态为 **review，待用户最终集成审核**。未合 main、未启动 R02。本文和共享接线代码同一提交，最终交付报告提供该提交的固定 SHA。

历史阶段说明：上述“本轮”为集成候选交付轮。随后用户批准正式合 main，实际合并提交 `4149590d28296ab3520b70606dcb161ba16a6b39`；重新执行的主线验证见 [合并后验收](2026-10-13-r01-main.md)。保留本报告原始命令/结果，不用其 PASS 替代主线复验。

## 基线、范围与环境

- 开始时实际 main 为 `462a43a5cd0d341d91c64e28cfc2a903479ecd77`，工作区干净；原始基线 `135bf82c6462ade6dd5300717d6f0102ce4a660c` 保留。
- 原子项目 `codex/r01-startup-lifecycle-security` / `d956279949baa0992be5e0cb093f59ef96a9e205` 保留；原 Worktree 未修改或删除。
- 原生工具创建独立 `/Users/zhangwenjie/.codex/worktrees/integrate-r01/AI交互`，从实际 main 创建 `codex/integrate-r01`，cherry-pick 得到 `79b6666d52e3459077de818c10b42a1dd17b3154`；未直接覆盖 main。
- 共享接线为 Main 生命周期、IPC、RunService 最小退出协调、Preload/CSP/window 联动及对应测试。无新增运行依赖，无 package/lock、Shared DTO/Schema、SQL/migration、Provider、UI 业务逻辑修改。来源/兼容性见 [CONTRACTS](../CONTRACTS.md) 和 [DECISIONS](../DECISIONS.md)。
- 平台 darwin/arm64；Node v24.21.0 / ABI 137；pnpm 11.25.0；Electron 38.8.6 / ABI 139；TypeScript 5.9.3、Vitest 3.2.7、Vite 7.3.7、better-sqlite3 12.11.1。

## 隔离证据与命令前缀

两份 lockfile 字节一致；遍历源 node_modules 的 2475 个 symlink，全部目标在源依赖目录内，然后完整复制为集成 Worktree 独立目录。SQLite 文件 inode 不同，不共享可变 node_modules；没有 install、升级或 lockfile 更新。native:node/native:electron 仅切换本 Worktree 的原生 ABI。

当前 Node 实际来源为 `/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node`（`/opt/homebrew/bin/node` 是其链接）。沿用已定位的 hardened-runtime 环境限制处理方式，但本轮重新复制当前 Node、先校验 SHA-256 字节一致，再仅对新临时副本 ad-hoc 签名；未改系统 Node。临时 pnpm wrapper 用现有 pnpm.mjs 并传 `--config.verify-deps-before-run=false`，防止复制目录元信息触发安装/清除。仓库和全局配置不变。

下面 pnpm/node 命令均在集成 Worktree 执行，使用精确前缀：

```sh
PATH=/private/tmp/roundtable-integrate-r01-runtime-ba_gz5jm/bin:$PATH
```

它指向本轮新建环境，未来复验应重新确认当前 runtime/版本，不把这个临时路径当永久依赖。日志保存在该目录 `logs/`，本文保留命令与关键结果。

Vitest DB 全部为 `:memory:`，Main/Electron/Key/backend 测试使用 Mock；新 shutdown 用 fixture Provider，未调用真实模型。桌面探针先 mkdtemp，设置独立 userData/sessionData/logs 并 assert app 尚未 ready，再 import 实际 built Main。生产禁全部 HTTP/HTTPS/WS/WSS；开发只允许准确 loopback 127.0.0.1:5173，未调用真实 Provider。

## 失败基线、红测与修复记录

| 实际命令（以上 PATH 前缀） | Exit | 结果与原因 |
| --- | --- | --- |
| `pnpm run test --reporter=dot`（刚引入子项目，pretest 重编译 Node SQLite） | 1 | 10 文件 / 103 项：88 通过、15 失败，完整复现交接；5 生命周期、1 paused 收尾、9 IPC 来源/事件失败 |
| `pnpm exec vitest run tests/unit/lifecycle/ipcSource.test.ts tests/integration/shutdown.test.ts --reporter=dot`（新增测试后红测） | 1 | 29 项：2 通过、27 失败；旧 disposer、部分注册、取消订阅、全部 channel 守卫与 step 收尾竞态均实际暴露 |
| 同上（最小 IPC/RunService 修复后） | 0 | 29/29 通过 |
| `pnpm exec vitest run tests/unit/appLifecycle.test.ts tests/unit/lifecycle/preloadBuild.test.ts --reporter=dot`（补充错误路径红测） | 1 | 25 项：11 通过、14 失败，另 2 个未处理拒绝；缺失错误收尾、旧窗口隔离及 CSP nonce 等 |
| `pnpm exec vitest run tests/unit/appLifecycle.test.ts --reporter=dot`（首轮 Main 修复） | 1 | 24 项：20 通过、4 失败；测试在新的异步清理开始前释放未赋值的 finish，或检查过早。改为等待 shutdown 开始/exit，不修改安全断言 |
| `pnpm exec vitest run tests/unit/appLifecycle.test.ts -t 'late successful' --reporter=dot` | 1 | 单一退出/晚到加载竞态红测失败；其余 24 项因临时定位筛选未选。随后退出时销毁所属窗口；最终全套无跳过 |
| `pnpm exec vitest run --reporter=dot`（上述修复后） | 0 | 12 文件 / 132 项通过 |
| `pnpm exec vitest run tests/unit/lifecycle/windowSecurity.test.ts --reporter=dot`（生产环境来源追加红测） | 1 | 31 项：30 通过、1 失败；已打包应用继承开发环境 URL 会误信任远程页面。仅增加 app.isPackaged 分流，未放宽来源断言 |

独立 Preload 专项最初因 Worktree Vite 缓存写权限 EPERM 未执行，精准必要权限重试后通过；不把环境错误当测试失败，也不把它当 PASS。

## 最终自动化验证

| 实际命令 | Exit | 本轮结果 |
| --- | --- | --- |
| `pnpm run typecheck` | 0 | tsc --noEmit --pretty false，无类型错误 |
| `pnpm exec vitest run --reporter=dot` | 0 | **12 文件 / 133 项通过，0 失败、0 跳过、无未处理错误**；含 Main 25、窗口 31、IPC 28、开发 CSP 1 项专项及全部既有回归 |
| `pnpm run build` | 0 | tsc 与正式 Main/Preload/Renderer 构建；out/preload/index.cjs 单文件 1.45 kB，只有 require("electron")，不再生成 index.mjs |
| `pnpm run native:electron` | 0 | Rebuild Complete；本 Worktree SQLite 恢复 Electron ABI |
| `node --check tests/probes/r01-electron.cjs` | 0 | 探针外层语法检查 |
| `node --check tests/probes/r01-sqlite.cjs` | 0 | 临时数据只读校验语法检查 |

SQLite 独立内存自检实际命令（不加载 Main）：

```sh
ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron -e 'const assert = require("node:assert/strict"); const Database = require("./node_modules/better-sqlite3"); const db = new Database(":memory:"); try { db.exec("CREATE TABLE smoke (value TEXT)"); db.prepare("INSERT INTO smoke VALUES (?)").run("sqlite-ready"); assert.equal(db.prepare("SELECT value FROM smoke").get().value, "sqlite-ready"); console.log("Electron SQLite PASS: Electron " + process.versions.electron + ", ABI " + process.versions.modules); } finally { db.close(); }'
```

Exit 0：`Electron SQLite PASS: Electron 38.8.6, ABI 139`。构建成功没有被用来替代 ABI 证据。

## 实际生产/开发页面与 Preload 验证

生产探针首次 exit 1，原因是验证工具错误地假定 Electron 38 的 getLastWebPreferences 返回公开 preload 字段，实际该字段 undefined。四项运行时隔离标志已通过，无 preload-error。修正为读取真实 built Main 的唯一 preload 相对引用、解析准确路径并检查 Preload 目录仅 index.cjs；保留全部隔离标志、有限 API、实际 IPC/订阅与 CSP 断言。未改业务代码以迁就探针。

修正后实际运行：

```sh
./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r01-electron.cjs
```

Exit 0，`R01_PROBE_RESULT status:PASS, development:false`。实际加载 `out/renderer/index.html`，非 fixture/data 页面；sandbox/contextIsolation/webSecurity:true、nodeIntegration:false；页面 require/process undefined；Bridge 顶层只有 room/run，方法与原 API 完全一致；实际 App 渲染、Mock 单步、snapshot/subscribe/getMessages、取消 listener 后第二步事件不再到达，CSP/Preload/Renderer 错误为零，生产策略无开发来源。

开发仅启动 Vite 服务，不使用会直接运行未隔离入口的 electron-vite dev：

```sh
PATH=/private/tmp/roundtable-integrate-r01-runtime-ba_gz5jm/bin:$PATH node --input-type=module -e 'import { resolveConfig } from "electron-vite"; import { createServer } from "vite"; const resolved = await resolveConfig({}, "serve"); const server = await createServer({ ...resolved.config.renderer, configFile: false }); await server.listen(); console.log("R01_VITE_READY " + JSON.stringify(server.resolvedUrls)); process.on("SIGTERM", async () => { await server.close(); process.exit(0); });'
./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r01-electron.cjs --development http://127.0.0.1:5173/
```

服务实际监听 `http://127.0.0.1:5173/`。开发探针 exit 0：同样 Bridge/IPC/退出断言通过，脚本 nonce 匹配、无 script unsafe-inline/unsafe-eval、实际 `[vite] connected.` 与允许的 HMR WebSocket 均确认，CSP/Renderer 错误为零。验证后核对 PID/cwd/命令，仅停止本任务临时服务；后台 shell 返回 143 为主动 SIGTERM 收尾，不是验证失败。

两次探针在 readiness 前输出 isolationBeforeReady:true，分别创建：

- 生产：`/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-r01-electron-Idtb5j`。
- 开发：`/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-r01-electron-uGBWHm`。

探针完成后通过真实 Main app.quit 收尾。随后仅打开各自产生的临时数据库为 readonly；脚本校验 metadata 在系统临时目录、userData 为其子目录、隔离记录和 PASS 状态，拒绝任意真实用户路径。

```sh
ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r01-sqlite.cjs /var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-r01-electron-Idtb5j/probe-result.json
ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r01-sqlite.cjs /var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-r01-electron-uGBWHm/probe-result.json
```

两命令 exit 0：Run cancelled 且 finished_at 非空；退出前后消息全文、Turn 文本/status/request ID 完全一致；最终 run_state_changed 为 cancelled；key_records/providers 均 0。未导入真实 Key、没有 encrypt/decrypt/store/resolve 调用；实际 Main 仅查询 safeStorage 可用状态。

macOS 仍打印 sandbox extension 环境警告，开发还有 console-message 参数弃用提示。已明确保留，探针全部 assert 与 exit code 通过；不由此推断所有 OS 版本的沙箱行为或正式签名发布均有效。

## 未签名 macOS 目录包与真实 ASAR 路径

使用本 Worktree 已安装 Electron，不生成安装器，不触发签名 Key 搜索：

```sh
PATH=/private/tmp/roundtable-integrate-r01-runtime-ba_gz5jm/bin:$PATH CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --dir --mac --arm64 --config.electronDist=node_modules/electron/dist --config.mac.identity=null --config.npmRebuild=false
```

Exit 0，生成忽略目录下 `dist/mac-arm64/AI Roundtable.app`；既有 afterPack 独立内存 SQLite hook 输出 `Packaged SQLite PASS: Electron ABI 139`。package/lock/build hook 未改，未安装升级依赖。author/default icon/duplicate dependency references 为打包警告，未隐藏。

随后以目录包 Electron 的 Node 模式只读核验实际 app.asar，不启动包内用户应用：

```sh
ELECTRON_RUN_AS_NODE=1 './dist/mac-arm64/AI Roundtable.app/Contents/MacOS/AI Roundtable' -e 'const assert=require("node:assert/strict"); const fs=require("node:fs"); const path=require("node:path"); const root=path.resolve("dist/mac-arm64/AI Roundtable.app/Contents/Resources/app.asar"); for(const name of ["out/main/index.js","out/preload/index.cjs","out/renderer/index.html"]){const packed=path.join(root,name); assert.ok(fs.existsSync(packed)); assert.deepEqual(fs.readFileSync(packed),fs.readFileSync(name));} assert.ok(fs.readFileSync(path.join(root,"out/main/index.js"),"utf8").includes("../preload/index.cjs")); assert.equal(fs.existsSync(path.join(root,"out/preload/index.mjs")),false); console.log("Packaged Main/Preload/Renderer paths and bytes PASS; index.cjs present; no index.mjs");'
```

Exit 0，三个真实路径与产物字节一致，Main 相对 Preload 路径正确；只有 CJS，没有遗留 ESM。这不等于目录包完整桌面启动、安装/升级或签名验收。

## 审查、未解决事项和停止边界

独立只读审查核对完整 R01 源码/测试及实际构建上下文，未发现可确认 P0/P1/P2 代码问题；审查不是测试替代。变更和敏感文件提交检查另在交付时实际执行；数据库、probe metadata、日志、node_modules、out/dist 不提交。

本轮未发现上述验证范围内未解决的退出重入、paused 锁、IPC 来源或 CJS/sandbox 接线问题。Provider 永不响应 AbortSignal 时关闭屏障仍可能长期等待；强制结束可能丢输出，完整 Provider 超时/调度策略明确留 R04，不擅自扩展。异常退出恢复留 R03。

**未验证**：正式桌面 E2E 全场景、打包应用桌面启动/安装/升级、macOS 签名/公证、Windows/Linux、真实系统浏览器打开、真实 Provider/Key/付费请求。有限探针通过不替代这些验收。开发端口固定 5173，已有服务占用时明确失败；生产内联 style 保留现有需要，脚本策略未放宽。

建议用户审核通过后再授权总控合入 main；R01 保持 review，不能直接标 merged/verified。main 原样、原子项目历史/Worktree 保留，R02 未启动。
