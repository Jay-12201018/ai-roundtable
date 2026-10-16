# 真实验证与数据隔离

最新共享前置主线验收：用户批准1e1f971后已ff-only合main，本次612完整/78共享/190 Electron与双ABI、类型/构建、隔离UI/恢复/退出核验见[2026-10-16主线报告](verification/2026-10-16-r07-r08-shared-main.md)。以下阶段记录按历史保留；任何历史PASS不替代新任务实际运行。

R04/R05/R06已按用户批准fast-forward合main，最新实际主线验证见[本次主线报告](verification/2026-10-16-r04-r05-r06-main.md)；R03等历史结果仍保留。原[集成报告](verification/2026-10-15-r03-integration.md)和[集成命令台账](verification/2026-10-15-r03-commands.md)保持历史身份，不代替主线新鲜结果；下列历史阶段规则/结果保留。

## 证据要求

每次记录执行日期、基线/受检文件、平台、架构、实际 Node/pnpm/Electron 版本、精确命令、退出码、关键输出、失败原因和未运行项。PASS 仅来自本轮对应命令；历史报告不得替代。预期失败测试只有确认预期原因时才算守卫通过。

类型、单元、集成、build、native ABI、应用启动、Electron E2E、打包、安装和跨平台分别判断。截图不证明交互正确，build 不证明 SQLite 能在 Electron 加载，Mock 不证明真实模型协作。

## 隔离与命令安全

- 当前 DB 测试使用 `:memory:` 或每例独立临时目录，appLifecycle mock app/DB，rendererSync mock IPC/localStorage，集成测试使用 MockProvider；执行前检查新增测试未破坏此边界。
- 文件数据库/导出测试只能用测试创建的临时目录；关闭后仅清理本测试创建的数据，不操作真实 userData 或密钥链。
- 桌面 E2E 必须先实现独立 userData 配置并证明隔离；当前 tests/e2e 不存在，R00 不启动 app/dev/preview/包内主入口。
- 自动网络测试用 fixture/Mock；真实模型验收由用户明确触发并记录模型和限制，不打印 Key。
- 如检查会运行真实应用入口、访问用户 DB/Key 或不明路径，停止该项，记录原因和触发路径。

R03 新增专项为 `tests/unit/database.test.ts tests/unit/persistence tests/integration/persistence`。先使用 [ENVIRONMENT](ENVIRONMENT.md) 的严格 Node24.18.1 运行 `pnpm run test --reporter=dot`，独立记录 `pnpm run typecheck` 和 `pnpm run build`；切到 Electron 源码重编译后，以 `ELECTRON_RUN_AS_NODE=1 <Electron> node_modules/vitest/vitest.mjs run <上述专项> --reporter=dot` 验证实际 ABI139。两类原生构建不得并行操作同一 node_modules。

有限桌面探针 `tests/probes/r01-electron.cjs --r03-recovery` 会在 ready 前隔离全部应用路径、用原 v1 fixture 执行真实迁移/恢复并阻断外部网络；仅在确认这些防护仍存在后运行。退出后 `ELECTRON_RUN_AS_NODE=1 <Electron> tests/probes/r01-sqlite.cjs <本次新生成的 probe-result.json>` 只读验证自己的临时数据库/备份。不可沿用历史 metadata 路径当新证据，不将有限探针称为正式 E2E 或打包验收。

## R00 检查顺序

在仓库根目录执行，每项独立记录退出码；shell 不以最后一个命令成功掩盖前项失败。

```bash
pnpm --version
pnpm exec node -p 'JSON.stringify({node:process.version,modules:process.versions.modules,platform:process.platform,arch:process.arch})'
pnpm run typecheck
pnpm run test --reporter=dot
pnpm exec vitest run __r00_no_test_should_match__
pnpm run build
pnpm run native:electron
```

`pnpm test` 的 pretest 会重编译已安装 better-sqlite3 为 Node ABI；一次运行包含 tests/unit 和 tests/integration，不重复执行相同测试。空筛选应明确输出 No test files found 且 exit 1。package test 与 Vitest 配置均禁止 passWithNoTests。

native:electron 强制重编译为 Electron ABI，恢复开发环境。缺少 headers/toolchain、平台签名限制或下载失败必须记录；不擅自 install/upgrade，不静默使用历史临时 runtime。若选用其他已安装 Node 解决 ABI/签名问题，应先核实版本/来源，显式指定 PATH 并记录新命令和第一次失败。

macOS arm64 当前依赖可用时，重编译后独立内存自检：

```bash
ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron -e 'const assert = require("node:assert/strict"); const Database = require("./node_modules/better-sqlite3"); const db = new Database(":memory:"); try { db.exec("CREATE TABLE smoke (value TEXT)"); db.prepare("INSERT INTO smoke VALUES (?)").run("sqlite-ready"); assert.equal(db.prepare("SELECT value FROM smoke").get().value, "sqlite-ready"); console.log("Electron SQLite PASS: Electron " + process.versions.electron + ", ABI " + process.versions.modules); } finally { db.close(); }'
```

该命令不导入 Main 入口，不启动桌面，不接触用户 DB/Provider/Key；它只验证已安装 Electron 加载 SQLite 并进行内存读写。其他平台使用其安装的 Electron 可执行文件，不把 macOS 结果外推。

当前没有 lint 脚本、Electron E2E 测试和 CI，不运行假命令或自动补业务实现；R17 负责完善。R00 不运行 pack/dist/应用 launch，也不验证安装或签名。

## 文档、范围与提交检查

- SPEC 来源必须实际可读；若无法读原文停止导入并报告，不凭记忆造完整需求。
- Markdown 仓库内链接和 task/STATUS 清单对应；不依赖外部 Downloads 路径。
- 核对 R00–R18/R10A/R10B 依赖无环、文件归属明确、未把后续 ready 当授权。
- git diff --check；确认 src、原有 tests、lockfile、原生脚本无差异。
- 查看暂存清单和完整 diff；敏感扫描仅输出文件名/数量，不输出匹配明文。
- 核对无数据库、备份、Key、环境文件或敏感日志入库；.env.example 若出现须人工确认只有占位值。

```bash
git diff --check
git diff --cached --name-only
git ls-files -- '*.db' '*.db-*' '*.sqlite' '*.sqlite-*' '*.sqlite3' '*.sqlite3-*' '.env' '.env.*' '*.pem' '*.p12' '*.pfx' '*.key'
git grep -Il -E '(BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY|sk-[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{25,}|gh[pousr]_[A-Za-z0-9_]{20,})'
```

扫描无命中时 git grep exit 1 是正常结果，不等于业务测试失败；模式扫描不能证明所有秘密形式都不存在，仍须查看文件归属和内容。

## 失败与任务结论

R00 只修自身文档、配置和验证环境问题。业务失败保留证据交给对应任务，不修改 Agent 逻辑；不隐藏失败或只展示后一次成功。R00 交付可记录基线缺陷，但适用检查未通过时不能称验证全部通过。

STATUS 的 review 表示交付待用户检查，verified 表示总控已确认任务验收；两者不等于发布就绪。R00 建立时后续任务均未启动；当前授权和阶段以 [STATUS](STATUS.md) 为准。R01 合并后重新运行的主线证据见 [本次验收](verification/2026-10-13-r01-main.md)，不复用集成分支历史 PASS。R02 ready 不等于创建/实施授权。

## ENV-R02-INSTALL-01：干净环境复验规则（2026-10-14）

按[ENVIRONMENT](ENVIRONMENT.md)固定runtime与pnpm真实执行入口，先核对版本/来源/headers/arch，再准备独立store/cache和冻结锁文件。默认Codex pnpm入口可能硬编码另一Node，PATH中的node版本不能替代实际pnpm进程证据。不得以复制node_modules作为干净安装。

数值设置使用正式 `--fetch-timeout=60000 --fetch-retries=1` 或经实际类型校验的配置，不能使用本轮已证实保留string的 `--config.fetch-timeout=60000`。安装原生脚本的npm_config_nodedir必须对应完整同版Node runtime；Electron阶段清除此Node设置，以目标Electron headers重建。保持全部安装脚本、年龄/完整性策略与测试断言。

有界执行并分别记录：冻结安装/lock字节与依赖清单→Node SQLite源码重编译/内存/压力及正常退出→契约/默认pool全回归→类型/生产构建→Electron源码重编译/ABI→ready前隔离的有限生产页面/Bridge/退出后只读数据核对。适用时构建目录包、查ASAR Main/CJS Preload/Renderer及unpacked SQLite，并在最终签名后再跑包内内存SQLite。pack PASS不能替代正式E2E/安装/跨平台/发布签名。

本轮全部新鲜结果见[环境修复与可复现性报告](verification/2026-10-14-r02-environment.md)；旧228项和上一轮blocked记录保持历史身份，不能充当本次复验。未修改package/lock、源码或既有tests。

## R02 合并后证据

获批集成候选已以 `6aff174e6cf397eb49b9b4ceadb3387f207b84a6` 合入 main；[本次主线验收](verification/2026-10-14-r02-main.md)单独记录重新执行的命令/退出码，不能复用上节环境专项 PASS。R02 verified；R03 ready 仅表示依赖满足，不是实施授权。

pnpm11.25.0 的辅助 list 会按已安装 `.modules.yaml` 的 storeDir 写打开索引，即使 CLI 覆盖 store 也不改变该路径。受限环境下失败须保留，不为盘点清单擅自写全局 store；可只读比较已安装锁文件与仓库锁文件及全部直接依赖的实际版本，明确该核对不等于新干净安装。主线有限 Electron probe仍须在ready前隔离，并在实际退出后只读核对本次临时数据库。


## R04/R05/R06 联合候选验证入口

联合专项为`tests/integration/joint`，贯穿真实RunService、R05 builder、R06 session/App及临时SQLite，捕获实际Provider输入而不是相加各模块历史测试。`tests/probes/r01-electron.cjs --joint-ui`在既有ready前数据/网络隔离上增加真实DOM控件及刷新验证；退出后用同轮metadata执行r01-sqlite，只读核对自己的新profile。`--r03-recovery`仍独立运行旧迁移/恢复/安全回归。不得以Bridge暴露私有Attempt输入来取证，实际入口捕获在联合测试中断言。

本次534完整/265专项/27新联合、类型/构建、压力/双ABI/有限桌面真实结果及所有中间失败见[联合报告](verification/2026-10-15-r04-r05-r06-integration.md)。这是review候选证据，不是主线verified；仍无正式tests/e2e，不把DOM脚本探针当跨平台或发布验收。


## R04/R05/R06 主线验收（2026-10-16）

本次main实际重新执行534全回归、265三模块/联合专项、112 Electron数据库/联合专项、类型/生产构建、Node严格配对压力及ElectronABI139，两个新的ready前隔离profile完成真实页面/刷新/Preload/IPC/退出与恢复/备份核对后才更新verified。具体精确argv/exit与指纹见[本次台账](verification/2026-10-16-r04-r05-r06-main-commands.md)，不能以10月15日候选PASS代替。

新部署后复验仍按Node检查→Electron重建→实际ABI/隔离页面→退出后只读本轮profile顺序，禁止同时重建同一依赖树的两个ABI。本次有限DOM控件探针不是正式E2E；没有更新测试、删除失败或放宽安全断言。R07/R08 ready仍须分别获实施/Worktree授权。
