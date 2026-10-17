# R07/R08 main 独立验收逐命令台账

前次主线与停止阶段（2026-10-17；本次补充授权见文末）：cwd=`/Users/zhangwenjie/Documents/ChatGPT/AI交互`；本轮检查gitHead=`d3205b2c3fba2061437150e87a87508d44fbb660`。原始收据/日志根=`/private/tmp/roundtable-r78-main-7o0obscb`；本页永久登记实际命令及摘要，临时目录不保证永久存在。历史候选台账不回写。

## 隔离与运行器

每项实际包装形式：`python3 /private/tmp/roundtable-r78-main-7o0obscb/run-check.py <label> <timeoutSeconds> <mode> <argv...>`。runner SHA256=`98882da6463ccb663609821424d13802170176f012b231ce1c6578f1f852b33d`；各JSON含UTC、精确argv、exit、elapsed、输入/命令文件哈希、HEAD/tree及源码指纹。外部进程组超时TERM/KILL；本轮无超时；补充脚本失败后进程定向SIGTERM，详见末节，不能算自然退出成功。

mode=node：受控Node24.18.1完整发行包及同版include，source build；mode=electron：本轮38.8.6 headers及source build；mode=electron-node：ELECTRON_RUN_AS_NODE=1、不继承Node的nodedir；tool仅受控工具。全部清除继承NODE_OPTIONS/原生配置，独立npm/user/global配置与cache/store/state/gyp/XDG/TMPDIR；pnpm shim显式exec已核验runtime+pnpm入口，仅额外传store/cache/state路径，不传raw数值fetch参数。

Node dist=`/private/tmp/roundtable-r02-integration-b0c3ktgt/runtime-24.18.1/node-v24.18.1-darwin-arm64`；pnpm=`/Users/zhangwenjie/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pnpm/bin/pnpm.mjs`；SQLite12.11.1、Electron38.8.6/内嵌Node22.22.0。main既有独立依赖，不是本轮干净安装。

## 实际 Git 与静态检查

- 合并前：git status --porcelain=v1 --untracked-files=all（全部15WT空）；git rev-parse main/集成/原模块；git merge-base --is-ancestor；git rev-list --reverse；git show --format=fuller；原/引入 git patch-id --stable；git diff --name-status/--stat；逐文件范围/敏感项/不变文件SHA核对。断言通过。
- `git merge --ff-only codex/integrate-r07-r08`：exit0，c1b5bea→d3205b2c3fba2061437150e87a87508d44fbb660，Fast-forward；merge.json与preflight.json存原始记录。无新merge commit。
- 前次阶段所有运行前后业务/测试/配置指纹均 `31d853b241a0bff1fcc631b27090ca69c284a4020ef7cc435c35948e6acac88e`；package/lock/workspace SHA分别 `2e1cde38189630518c7ba60eb66495e0c4c6a4871a31f1590c5b475c27fd0335` / `3752425b23f83898811def6f289a3154733e71a981a47d08840e841b7c6b7ba3` / `77832f09aa15f28c96d01acf7e613a6ed5052335213af2a15793ee17cbdf8276`。

## 每次实际执行

下列每项对应同名JSON和logs/<label>.log；不同专项重叠，不相加。

### source-verify-01

- mode=tool；外部上限60s；exit=0；实际1.505s；UTC=2026-10-17T01:32:50.661598+00:00。
- 精确argv：`python3 /private/tmp/roundtable-r78-main-7o0obscb/setup.py`
- 原始日志SHA256：`8a623d0c7a66c680b34b3b2ff41a86c9a7eac88d1bb1afd230e115a7d78499b2`。

### electron-headers-prepare-01

- mode=tool；外部上限60s；exit=0；实际0.139s；UTC=2026-10-17T01:32:50.661597+00:00。
- 精确argv：`python3 /private/tmp/roundtable-r78-main-7o0obscb/prepare-electron-headers.py`
- 原始日志SHA256：`2af38815c3b6e4f1dbe84bdc89c96e2eeb9a3abf7a8401364b69b14491c4d75c`。

### main-environment-audit-01

- mode=tool；外部上限60s；exit=0；实际2.799s；UTC=2026-10-17T01:33:29.599314+00:00。
- 精确argv：`python3 /private/tmp/roundtable-r78-main-7o0obscb/environment-audit.py`
- 原始日志SHA256：`3d024f8583e1d91b4d44aace029db693bdfe6bb94f85deca1193ed48cd0c0b79`。

### main-full-node-01

- mode=node；外部上限300s；exit=0；实际20.824s；UTC=2026-10-17T01:34:12.369848+00:00。
- 精确argv：`pnpm run test --reporter=dot`
- 原始日志SHA256：`26384adde68458c0660d917e1c7fb0b5dfcd2e8c08d735cbdaf20099ce36acbc`。
- 关键输出：Test Files  61 passed (61)；Tests  846 passed (846)。

### main-typecheck-01

- mode=tool；外部上限90s；exit=0；实际1.968s；UTC=2026-10-17T01:34:15.476195+00:00。
- 精确argv：`pnpm run typecheck`
- 原始日志SHA256：`072d84b3aeca2c2388fda023ba92238e18e00efb6d1f62e7e4fbf59670d88821`。

### main-r07r08-node-02

- mode=node；外部上限120s；exit=0；实际2.791s；UTC=2026-10-17T01:34:54.689277+00:00。
- 精确argv：`pnpm exec vitest run tests/unit/rooms tests/integration/rooms tests/unit/rendererRooms tests/unit/settings tests/integration/settings tests/unit/rendererSettings tests/unit/keyService.test.ts tests/unit/configuration tests/integration/configuration tests/unit/contracts/configuration.test.ts tests/unit/contracts/configurationIpc.test.ts tests/unit/contracts/preload.test.ts tests/integration/r07r08 --reporter=dot`
- 原始日志SHA256：`3b0e1a4bf89c04f0979fae788aa749908b136ef895801c50fa653f0fd3244fc8`。
- 关键输出：Test Files  23 passed (23)；Tests  292 passed (292)。

### main-ipc-security-node-03

- mode=node；外部上限90s；exit=0；实际0.931s；UTC=2026-10-17T01:35:03.058567+00:00。
- 精确argv：`pnpm exec vitest run tests/unit/contracts/ipc.test.ts tests/unit/contracts/preload.test.ts tests/unit/contracts/configurationIpc.test.ts tests/unit/lifecycle/ipcSource.test.ts tests/integration/r07r08/ipcConfiguration.test.ts --reporter=dot`
- 原始日志SHA256：`3425cc5e5c86fe3a3ab6b906d74f6eaf8f52e536c5fd51b07cedee8d0b628a1c`。
- 关键输出：Test Files  5 passed (5)；Tests  111 passed (111)。

### main-build-04

- mode=tool；外部上限120s；exit=0；实际2.815s；UTC=2026-10-17T01:35:47.473258+00:00。
- 精确argv：`pnpm run build`
- 原始日志SHA256：`8c30c58713cb0dea6821c35c419667fba19f133edb81407863c2209bc5c3da75`。

### main-node-stress-1

- mode=node；外部上限60s；exit=0；实际0.359s；UTC=2026-10-17T01:35:05.785167+00:00。
- 精确argv：`node /private/tmp/roundtable-r78-main-7o0obscb/sqlite-probe.cjs --stress`
- 原始日志SHA256：`8d2efa3f7ab37c9f3b38584f01e0966287465cd70b787d1b269cfaa1cb3f33f3`。
- 关键输出：{"result":"PASS","stress":true,"iterations":300000,"node":"v24.18.1","abi":"137"}。

### main-node-stress-2

- mode=node；外部上限60s；exit=0；实际0.452s；UTC=2026-10-17T01:35:03.633619+00:00。
- 精确argv：`node /private/tmp/roundtable-r78-main-7o0obscb/sqlite-probe.cjs --stress`
- 原始日志SHA256：`8d2efa3f7ab37c9f3b38584f01e0966287465cd70b787d1b269cfaa1cb3f33f3`。
- 关键输出：{"result":"PASS","stress":true,"iterations":300000,"node":"v24.18.1","abi":"137"}。

### main-node-stress-3

- mode=node；外部上限60s；exit=0；实际0.360s；UTC=2026-10-17T01:35:12.522493+00:00。
- 精确argv：`node /private/tmp/roundtable-r78-main-7o0obscb/sqlite-probe.cjs --stress`
- 原始日志SHA256：`8d2efa3f7ab37c9f3b38584f01e0966287465cd70b787d1b269cfaa1cb3f33f3`。
- 关键输出：{"result":"PASS","stress":true,"iterations":300000,"node":"v24.18.1","abi":"137"}。

### main-node-stress-4

- mode=node；外部上限60s；exit=0；实际0.410s；UTC=2026-10-17T01:35:05.850596+00:00。
- 精确argv：`node /private/tmp/roundtable-r78-main-7o0obscb/sqlite-probe.cjs --stress`
- 原始日志SHA256：`8d2efa3f7ab37c9f3b38584f01e0966287465cd70b787d1b269cfaa1cb3f33f3`。
- 关键输出：{"result":"PASS","stress":true,"iterations":300000,"node":"v24.18.1","abi":"137"}。

### main-node-stress-5

- mode=node；外部上限60s；exit=0；实际0.362s；UTC=2026-10-17T01:35:05.075622+00:00。
- 精确argv：`node /private/tmp/roundtable-r78-main-7o0obscb/sqlite-probe.cjs --stress`
- 原始日志SHA256：`8d2efa3f7ab37c9f3b38584f01e0966287465cd70b787d1b269cfaa1cb3f33f3`。
- 关键输出：{"result":"PASS","stress":true,"iterations":300000,"node":"v24.18.1","abi":"137"}。

### main-native-electron-05

- mode=electron；外部上限300s；exit=0；实际10.933s；UTC=2026-10-17T01:37:32.642479+00:00。
- 精确argv：`pnpm run native:electron`
- 原始日志SHA256：`1f9faa3edbda53904eba7c852108c318279540fb646ad1bada7a0b74adafa4f7`。

### main-electron-native-06

- mode=electron-node；外部上限60s；exit=0；实际0.748s；UTC=2026-10-17T01:37:53.392103+00:00。
- 精确argv：`node_modules/electron/dist/Electron.app/Contents/MacOS/Electron /private/tmp/roundtable-r78-main-7o0obscb/sqlite-probe.cjs --stress`
- 原始日志SHA256：`1914576ff7d3c860db985bc6101af2eb1639f14bce063c46a1c4fcc9c94ec57c`。
- 关键输出：{"result":"PASS","stress":true,"iterations":300000,"node":"v22.22.0","electron":"38.8.6","abi":"139"}。

### main-special-electron-07

- mode=electron-node；外部上限300s；exit=0；实际3.028s；UTC=2026-10-17T01:37:53.677817+00:00。
- 精确argv：`node_modules/electron/dist/Electron.app/Contents/MacOS/Electron node_modules/vitest/vitest.mjs run tests/unit/database.test.ts tests/unit/persistence tests/integration/persistence tests/unit/configuration tests/integration/configuration tests/unit/rooms tests/integration/rooms tests/unit/settings tests/integration/settings tests/integration/r07r08/ipcConfiguration.test.ts tests/integration/r07r08/providerAdmission.test.ts tests/unit/contracts --reporter=dot`
- 原始日志SHA256：`e2d542e73f7ab8b2fe70a2db485194b54fcc4a2ca2675543119f5b262d2179bf`。
- 关键输出：Test Files  29 passed (29)；Tests  393 passed (393)。

### main-production-ui-first-08

- mode=electron；外部上限270s；exit=0；实际13.015s；UTC=2026-10-17T01:38:06.168651+00:00。
- 精确argv：`node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r07r08-electron.cjs`
- 原始日志SHA256：`e9880aec36ad12e7c507eb034f1f32338e0a5a991cd0ec8c6d252e5f78aa3531`。
- 关键输出：R78_PRODUCTION_RESULT {"status":"PASS","resultPath":"/private/tmp/roundtable-r78-main-7o0obscb/test-tmp/roundtable-r78-production-1C0GHw/r78-first.json","manifestPath":"/private/tmp/roundtable-r78-main-7o0obscb/test-tmp/roundtable-r78-production-1C0GHw/r78-manifest.json","phase":"first"}。

### main-production-first-audit-09

- mode=electron-node；外部上限60s；exit=0；实际0.097s；UTC=2026-10-17T01:38:30.739389+00:00。
- 精确argv：`node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r07r08-sqlite.cjs /private/tmp/roundtable-r78-main-7o0obscb/test-tmp/roundtable-r78-production-1C0GHw/r78-first.json`
- 原始日志SHA256：`684cc15960d76913c4935961bc09e69c7c1a2eb6142be37c98c0fe718e4d4c13`。
- 关键输出：{"status":"PASS","phase":"first","sqlite":"139","privateProfile":"/private/tmp/roundtable-r78-main-7o0obscb/test-tmp/roundtable-r78-production-1C0GHw","completedRun":"b75b1a79-8f58-48c9-a5b7-c58dac17cebc","attempts":3,"repeatAttempts":3,"keyRecords":1,"fakeBackendOnly":true,"publicContext":true,"historicalDataPreserved":true}。

### main-production-restart-10

- mode=electron；外部上限270s；exit=0；实际6.690s；UTC=2026-10-17T01:38:37.813339+00:00。
- 精确argv：`node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r07r08-electron.cjs --restart /private/tmp/roundtable-r78-main-7o0obscb/test-tmp/roundtable-r78-production-1C0GHw/r78-manifest.json`
- 原始日志SHA256：`de2b5e38c7653b55949a4e68a2cae813e65736767179f7d25b5707553fce9bd3`。
- 关键输出：R78_PRODUCTION_RESULT {"status":"PASS","resultPath":"/private/tmp/roundtable-r78-main-7o0obscb/test-tmp/roundtable-r78-production-1C0GHw/r78-restart.json","manifestPath":"/private/tmp/roundtable-r78-main-7o0obscb/test-tmp/roundtable-r78-production-1C0GHw/r78-manifest.json","phase":"restart"}。

### main-production-restart-audit-11

- mode=electron-node；外部上限60s；exit=0；实际0.091s；UTC=2026-10-17T01:39:10.833486+00:00。
- 精确argv：`node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r07r08-sqlite.cjs /private/tmp/roundtable-r78-main-7o0obscb/test-tmp/roundtable-r78-production-1C0GHw/r78-restart.json`
- 原始日志SHA256：`d213e850102eb0e585cb37317eac3db536d7de2245d165f8a509f35214e04d99`。
- 关键输出：{"status":"PASS","phase":"restart","sqlite":"139","privateProfile":"/private/tmp/roundtable-r78-main-7o0obscb/test-tmp/roundtable-r78-production-1C0GHw","completedRun":"b75b1a79-8f58-48c9-a5b7-c58dac17cebc","attempts":3,"repeatAttempts":3,"keyRecords":1,"fakeBackendOnly":true,"publicContext":true,"historicalDataPreserved":true}。

### main-legacy-joint-ui-12

- mode=electron；外部上限70s；exit=0；实际3.966s；UTC=2026-10-17T01:39:17.561799+00:00。
- 精确argv：`node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r01-electron.cjs --joint-ui`
- 原始日志SHA256：`476f47de3914dad9e1d72c2b090f7754a357a20b546c69e0f54b9b48b669fa6f`。
- 关键输出：{"status":"PASS","development":false,"runId":"0fa9317a-1d72-4eef-beac-7e7ee7e1f167","userData":"/private/tmp/roundtable-r78-main-7o0obscb/test-tmp/roundtable-r01-electron-AvJnLQ/userData","metadataPath":"/private/tmp/roundtable-r78-main-7o0obscb/test-tmp/roundtable-r01-electron-AvJnLQ/probe-result.json","hmrConnected":false}。

### main-legacy-joint-audit-13

- mode=electron-node；外部上限60s；exit=0；实际0.090s；UTC=2026-10-17T01:39:33.771459+00:00。
- 精确argv：`node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r01-sqlite.cjs /private/tmp/roundtable-r78-main-7o0obscb/test-tmp/roundtable-r01-electron-AvJnLQ/probe-result.json`
- 原始日志SHA256：`6261f53659c986edd3e1f218223002c14f91aa6bf5ff24a351f979df5f1ea017`。
- 关键输出：R01 shutdown SQLite PASS: cancelled, messages/turns/requests preserved, keys/providers empty；Joint desktop UI/refresh/Pause/Step/Resume/Stop/Retry/Continue and durable inputs PASS; actual Provider-input capture is independently asserted in joint Vitest tests。

### main-legacy-recovery-ui-14

- mode=electron；外部上限70s；exit=0；实际1.711s；UTC=2026-10-17T01:39:39.871228+00:00。
- 精确argv：`node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r01-electron.cjs --r03-recovery`
- 原始日志SHA256：`d78673d5631add0bddc34db938f2b87e1af0afcd9644376db219864037aa7125`。
- 关键输出：{"status":"PASS","development":false,"runId":"6093b35e-3c7f-495a-b734-f0e7cbad3ca3","userData":"/private/tmp/roundtable-r78-main-7o0obscb/test-tmp/roundtable-r01-electron-AJuUwe/userData","metadataPath":"/private/tmp/roundtable-r78-main-7o0obscb/test-tmp/roundtable-r01-electron-AJuUwe/probe-result.json","hmrConnected":false}。

### final-environment-check-01

- mode=tool；外部上限120s；exit=0；实际1.943s；UTC=2026-10-17T01:39:46.459763+00:00。
- 精确argv：`python3 /private/tmp/roundtable-r78-main-7o0obscb/final-environment-audit.py`
- 原始日志SHA256：`25d85314b93a9dc84af93f272772149373b51e00a48042f297398c7c1fbaa3fe`。

### main-legacy-recovery-audit-15

- mode=electron-node；外部上限60s；exit=0；实际0.088s；UTC=2026-10-17T01:40:00.871186+00:00。
- 精确argv：`node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r01-sqlite.cjs /private/tmp/roundtable-r78-main-7o0obscb/test-tmp/roundtable-r01-electron-AJuUwe/probe-result.json`
- 原始日志SHA256：`ea591380f0b99af22a73c59346191d399fc3ce6cf3354034fabf5bea89375b53`。
- 关键输出：R01 shutdown SQLite PASS: cancelled, messages/turns/requests preserved, keys/providers empty；R03 startup recovery/verified v1 backup/legacy unknown inputs PASS: 9 Runs, 4 interrupted, terminal/idle evidence preserved。

## 本轮失败、警告与边界

前列25项检查exit0；随后补充真桥脚本失败，最终验收未通过/未完成。无skip/删测试/放宽安全断言。一次人工读取错误文件名main-environment-audit-details.json exit1，真实文件environment-audit-details.json随后读取成功；不将该辅助read失败当PASS或产品故障。候选历史RED/修复另见候选报告，不混为本轮结果。

Xcode fs-event/cache、GUI stderr sandbox_extension_issue_file_to_process Operation not permitted及Rollup/Zod注释位置提示原样留日志；实际类型/构建/页面偏好/Preload/退出检查通过。补充包装器的失败单列，不归因于产品测试也不写为PASS。

真实首进程profile=/private/tmp/roundtable-r78-main-7o0obscb/test-tmp/roundtable-r78-production-1C0GHw，首/重启manifest/result仅本轮所有权目录。4×2×3布局每进程24项，1600×1000实际1600×868；完整1000高度未验证。旧联合profile=/private/tmp/roundtable-r78-main-7o0obscb/test-tmp/roundtable-r01-electron-AvJnLQ；旧v1恢复profile=/private/tmp/roundtable-r78-main-7o0obscb/test-tmp/roundtable-r01-electron-AJuUwe；只读退出审计均在相应进程exit0后执行。

最终环境审计确认15WT/14非mainHEAD保留、15状态空、独立native inode与main ABI139；没有所有native合并前SHA基线，不宣称全体哈希前后不变。治理提交后的最终Git核对在交付前另行执行，最终SHA以本报告提交及交付消息定位。

未运行：新干净/冷缓存联网安装、真实Key/OS Keychain、真实网络模型、正式E2E/跨平台/发布包/签名公证；没有lint命令，不宣称lint通过。无R09/R10/R17实施或新Worktree。

## 补充字段核验失败与停止

本次只读复核发现真实生产探针只直接断言错误code，不能宣称精确message/retryable/no-stack已通过真桥。新增包装器首次执行即因npm包路径/内置模块混淆失败；没有修复重跑。

### main-docs-precommit-16

- 实际命令：`python3 /private/tmp/roundtable-r78-main-7o0obscb/run-check.py main-docs-precommit-16 60 tool python3 /private/tmp/roundtable-r78-main-7o0obscb/check-main-docs.py`。
- UTC=2026-10-17T01:46:02.016398+00:00；elapsed=0.099s；子进程exit=0；日志SHA256=`3f8276835645ee3f56643e1a03de9c12d5066c74c30dd71f15ad54f4da0b792e`。
- 只校验当时尚未提交的治理草稿/链接/源码指纹，exit0；失败停止后的最终文档另行校验，不能用这项给产品最终验收打PASS。

### main-real-bridge-17

- 实际命令：`python3 /private/tmp/roundtable-r78-main-7o0obscb/run-check.py main-real-bridge-17 270 electron node_modules/electron/dist/Electron.app/Contents/MacOS/Electron /private/tmp/roundtable-r78-main-7o0obscb/check-real-bridge.cjs`。
- UTC=2026-10-17T01:47:51.777926+00:00；elapsed=55.205s；子进程exit=-15；日志SHA256=`901538328b201809ffcb3ae7ae233db3f66b6e370df6bb22f254fae04ed9eaf5`。
- 外层runner exit=241；原始TypeError在check-real-bridge.cjs:7的app.once，绝对包路径导出二进制字符串，app undefined。未导入生产探针/Main，新增桥断言与该进程隔离断言未运行。
- 随后只对本轮核验PID77915/UID/独立进程组发SIGTERM；termination收据main-real-bridge-17-termination.json。包装器SHA256=`86b594629d10331b52a0cf2a495b070fc484cf77d2bfa34c22e5d18d9b2cf874`。

状态：R07/R08及联合集成仅merged、验收停止、未verified；R09仍blocked/未授权。没有修复重跑、reset、业务改动、隐藏失败或启动下一阶段。修复方向与边界见主线报告；本次治理提交记录实际结果，不表示最终验收成功。

### main-stop-docs-check-18（只检查停止记录，不继续产品验收）

- `python3 /private/tmp/roundtable-r78-main-7o0obscb/run-check.py main-stop-docs-check-18 60 tool python3 /private/tmp/roundtable-r78-main-7o0obscb/check-main-stop-docs.py`：exit=0，0.097s；11个治理文件范围/链接/敏感模式/源码不变与merged、R09blocked状态校验通过。
- 日志SHA256=`3f8276835645ee3f56643e1a03de9c12d5066c74c30dd71f15ad54f4da0b792e`；不将文档检查当作补充真桥运行成功。

## 补充修复授权后的真实命令与结果（2026-10-17）

本节为用户另行批准后的补充执行，起始main28cb2f7，业务版本仍d3205b2；前文失败记录保留。修复方式为把新增断言顺序接入原生产探针，不再执行错误wrapper。实际命令均由原受控runner执行，Electron模式移除继承ELECTRON_RUN_AS_NODE，审计模式仅设置ELECTRON_RUN_AS_NODE=1；不重建native或构建。

### bridge-repair-baseline-19

- 实际命令：`python3 /private/tmp/roundtable-r78-main-7o0obscb/run-check.py bridge-repair-baseline-19 60 tool python3 /private/tmp/roundtable-r78-main-7o0obscb/freeze-bridge-repair.py`。
- UTC=2026-10-17T03:10:56.201293+00:00；exit=0；0.090s；日志SHA256=`6214051678c91e483298b0dffea7a760a06f30542522966d94661bd36b4ac835`。

### bridge-repair-syntax-20

- 实际命令：`python3 /private/tmp/roundtable-r78-main-7o0obscb/run-check.py bridge-repair-syntax-20 30 tool node --check tests/probes/r07r08-electron.cjs`。
- UTC=2026-10-17T03:11:14.216234+00:00；exit=0；0.211s；日志SHA256=`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。

### bridge-repair-production-21

- 实际命令：`python3 /private/tmp/roundtable-r78-main-7o0obscb/run-check.py bridge-repair-production-21 270 electron node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r07r08-electron.cjs`。
- UTC=2026-10-17T03:11:24.454798+00:00；exit=0；12.609s；日志SHA256=`7ba8d24dcd3d5f58759558deb182726a3ff174947ba680673d5aae0725ee76e2`。

### bridge-repair-exit-audit-22

- 实际命令：`python3 /private/tmp/roundtable-r78-main-7o0obscb/run-check.py bridge-repair-exit-audit-22 60 electron-node node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r07r08-sqlite.cjs /private/tmp/roundtable-r78-main-7o0obscb/test-tmp/roundtable-r78-production-8Le12w/r78-first.json`。
- UTC=2026-10-17T03:12:17.276573+00:00；exit=0；0.080s；日志SHA256=`2e000438a05bbc317656760b6a5cc51ee4bf931c9771d2d975cfdd632dd6da56`。

### bridge-repair-scope-23

- 实际命令：`python3 /private/tmp/roundtable-r78-main-7o0obscb/run-check.py bridge-repair-scope-23 60 tool python3 /private/tmp/roundtable-r78-main-7o0obscb/audit-bridge-repair.py`。
- UTC=2026-10-17T03:12:31.484082+00:00；exit=0；0.049s；日志SHA256=`87a07eba7123b7430caf83748cc425b20692fa520039407b8364743a749bba92`。

修复前：原Electron+check-real-bridge.cjs启动错误，0条新增断言，定向终止子进程-15/外层241；原记录未修改。修复后：Electron+tests/probes/r07r08-electron.cjs，18/18实际具名断言、2错误结果，正常自然exit0；实际生产Main/Preload/Renderer和原UI操作完成，退出后只读SQLite审计exit0。不是空测试或提前退出。

本次额外辅助清单初次将out共5文件当假设而exit1，实际多一份旧Finder .DS_Store；随后完整冻结6文件，运行时5文件时间窗分别校验，未删文件/降安全断言。该清单错误不是生产探针失败，独立保留说明；本次生产探针与退出审计均首跑exit0。

探针SHA从45cb65c60a81d1be3797d7e1f7463119dbe52937889ccde6dedc14311a528223变为1360a0798bae38405c83df3cf88eb70b911cac2a3e4b67c07851eabbb2034514；全源码/测试/配置指纹从31d853b...变为7213ac04de0ba52397b9c95cfd22f81d8f512a0193d8bd47cee4d8e87a6608c4，唯一可执行输入差异为新增验证断言，不是业务代码变化。

原846/292/111/393、strict/build及重启证据依据用户授权复用，未再次执行，不写成本轮新PASS。修复前后构建/native/原回归输入的SHA核对见bridge-repair-baseline.json及bridge-repair-scope.json；没有旧全量out哈希快照，不杜撰旧哈希对比。18条断言完整具名列表与两错误DTO记录在本次新profile/r78-first.json的bridgeErrors，所有网络/console/preload错误数组空。

补充验收通过后R07/R08及联合集成最终verified，R09仅ready且未授权启动；停止历史保留。未运行真实Provider/Keychain/正式E2E/发布或新Worktree。

### bridge-repair-delivery-24

- `python3 /private/tmp/roundtable-r78-main-7o0obscb/run-check.py bridge-repair-delivery-24 60 tool python3 /private/tmp/roundtable-r78-main-7o0obscb/check-bridge-repair-delivery.py`：exit=0，0.145s；12文件边界、190本地链接、状态/授权、旧失败/业务输入/out/native保留核对通过。
- 日志SHA256=`4f8e5c408d4662625a0e5fab39232069ab00f51da8ecf378bfa4bd5a2bb100bc`；这是交付一致性检查，不代替18项真桥实际执行。
