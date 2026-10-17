# R09 合并后 main 逐命令台账（2026-10-17）

本台账只记录本轮 main 的实际结果，不引用候选分支 PASS。工作目录均为 `/Users/zhangwenjie/Documents/ChatGPT/AI交互`；验证业务版本为获批 `f3a8fee38f5b7d75b5144c2997d72373fda6ddd6`。本轮仅有旧验证探针一行白名单修复，没有业务/构建配置修改。

## 执行器与隔离

原始证据根：`/private/tmp/roundtable-r09-main-fgltw4x0`。原始日志/JSON receipt/临时数据库均留在仓库外；本文件持久保存命令、退出码和日志摘要哈希。临时目录可能被系统清理，不把其存在作为未来验收的唯一依据。

每条命令实际通过 `python3 /private/tmp/roundtable-r09-main-fgltw4x0/run-check.py <label> <timeout秒> <mode> <argv...>` 执行，表内列出完整 argv。执行器清理 NODE_OPTIONS/ELECTRON_RUN_AS_NODE 及遗留原生目标，PATH指向本轮受控node/pnpm shim，独立cache/gyp/TMPDIR/XDG；子进程组有界终止并记录真实状态。以下均未超时。

- `node`：官方24.18.1 darwin-arm64 runtime及严格同版headers，ABI137；npm_config_nodedir固定为对应完整发行目录。
- `electron`：38.8.6严格对应的独立headers、build_from_source=true；真实Electron GUI入口。
- `electron-node`：清除原生目标后仅设置ELECTRON_RUN_AS_NODE=1，实际Electron内置Node22.22.0/ABI139。
- `tool`：无Node/Electron原生目标覆盖。Node检查结束后才重建Electron，最终main native为ABI139。
- loopback fixture测试和GUI在明确允许本地回环/桌面的执行权限下运行；第一次默认沙箱失败保留，不改测试断言。
- 所有生产探针ready前隔离userData/sessionData/logs、mock-keychain及全fake safeStorage，外网禁用；R09只允许自有HTTP fixture。

## Git与准备命令

合并前执行git rev-parse、git status --porcelain、git worktree list --porcelain、git log、git diff --name-status/--check、git merge-base --is-ancestor，并核对引入树及唯一原提交trailer；实际main与candidate完全匹配用户批准SHA。完整前态与差异见证据根pre-merge.json。

`git merge --ff-only codex/integrate-r09`：exit **0**，2026-10-17T15:08:06.136774+00:00，e9cf24e→f3a8fee，Fast-forward，无额外merge commit；merge.json保留stdout及reflog。没有再次合原模块分支。

环境引导实际执行 `python3 /private/tmp/roundtable-r09-main-fgltw4x0/env-bootstrap.py`（exit0）：核对缓存官方Node runtime/archive/同版headers（含node二进制2727文件）及pnpm11.25.0官方包455文件，新解包独立pnpm执行树；复用main自身独立已安装依赖，不执行install。结果见env-bootstrap.json、env-source-verification.json。未重新验证冷缓存下载；不使用raw数字fetch参数，也不运行会写原store的pnpm list。

## 实际检查

| label / UTC起点 | mode / 超时 | 实际argv | exit | 结果 |
| --- | --- | --- | --- | --- |
| main-dependency-inventory<br>2026-10-17T15:09:00.441059+00:00 | tool / 30s | `python3 /private/tmp/roundtable-r09-main-fgltw4x0/env-direct-inventory.py` | **0** | 32直接依赖与锁匹配；非新安装；耗时0.08s |
| main-electron-headers<br>2026-10-17T15:09:00.606121+00:00 | tool / 90s | `python3 /private/tmp/roundtable-r09-main-fgltw4x0/env-prepare-electron-headers.py` | **0** | 125文件与对应38.8.6源及缓存逐字一致，独立inode；耗时0.171s |
| main-isolation<br>2026-10-17T15:09:00.856985+00:00 | tool / 90s | `python3 /private/tmp/roundtable-r09-main-fgltw4x0/isolation-audit.py` | **0** | main 23555个物理依赖inode，与其他WT共享0；耗时12.244s |
| main-build<br>2026-10-17T15:10:21.370981+00:00 | node / 120s | `/private/tmp/roundtable-r09-main-fgltw4x0/bin/pnpm run build` | **0** | Main/Preload CJS/Renderer生产构建通过；Zod注释warning保留；耗时4.077s |
| main-typecheck<br>2026-10-17T15:10:21.370981+00:00 | node / 90s | `/private/tmp/roundtable-r09-main-fgltw4x0/bin/pnpm run typecheck` | **0** | TypeScript strict通过；耗时2.758s |
| main-node-full<br>2026-10-17T15:10:21.370982+00:00 | node / 300s | `/private/tmp/roundtable-r09-main-fgltw4x0/bin/pnpm run test --reporter=dot` | **1** | 原生源码编译成功；1073测试中1058通过/15失败，均listen EPERM；保留失败；耗时21.461s |
| main-node-full-permitted<br>2026-10-17T15:11:02.171712+00:00 | node / 180s | `/private/tmp/roundtable-r09-main-fgltw4x0/bin/pnpm exec vitest run --reporter=dot` | **0** | 允许loopback后相同业务/测试：75文件1073/1073；耗时5.874s |
| main-r09-special<br>2026-10-17T15:11:26.347293+00:00 | node / 100s | `/private/tmp/roundtable-r09-main-fgltw4x0/bin/pnpm exec vitest run tests/unit/providers/openai tests/unit/providers/openai-compatible tests/unit/providers/network.test.ts tests/integration/providers/openai tests/integration/r09 tests/unit/rendererSettings/r09SessionTarget.test.tsx --reporter=dot` | **0** | 14文件227/227（完整回归子集）；耗时1.768s |
| main-node-native-2<br>2026-10-17T15:11:27.531921+00:00 | node / 45s | `/private/tmp/roundtable-r09-main-fgltw4x0/bin/node tests/probes/r09-native.cjs` | **0** | 严格24.18.1/ABI137/arm64，100内存DB/10000行，关闭后自然退出；耗时0.139s |
| main-node-native-1<br>2026-10-17T15:11:27.533943+00:00 | node / 45s | `/private/tmp/roundtable-r09-main-fgltw4x0/bin/node tests/probes/r09-native.cjs` | **0** | 严格24.18.1/ABI137/arm64，100内存DB/10000行，关闭后自然退出；耗时0.139s |
| main-node-native-3<br>2026-10-17T15:11:27.548670+00:00 | node / 45s | `/private/tmp/roundtable-r09-main-fgltw4x0/bin/node tests/probes/r09-native.cjs` | **0** | 严格24.18.1/ABI137/arm64，100内存DB/10000行，关闭后自然退出；耗时0.129s |
| main-node-native-5<br>2026-10-17T15:11:27.553489+00:00 | node / 45s | `/private/tmp/roundtable-r09-main-fgltw4x0/bin/node tests/probes/r09-native.cjs` | **0** | 严格24.18.1/ABI137/arm64，100内存DB/10000行，关闭后自然退出；耗时0.088s |
| main-node-native-4<br>2026-10-17T15:11:27.555650+00:00 | node / 45s | `/private/tmp/roundtable-r09-main-fgltw4x0/bin/node tests/probes/r09-native.cjs` | **0** | 严格24.18.1/ABI137/arm64，100内存DB/10000行，关闭后自然退出；耗时0.131s |
| main-electron-rebuild<br>2026-10-17T15:11:53.289378+00:00 | electron / 240s | `/private/tmp/roundtable-r09-main-fgltw4x0/bin/pnpm run native:electron` | **0** | 匹配38.8.6 headers源码重建SQLite成功；耗时11.187s |
| main-electron-native<br>2026-10-17T15:12:23.488587+00:00 | electron-node / 45s | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r09-native.cjs` | **0** | Electron38.8.6/Node22.22.0/arm64/ABI139，100内存DB/10000行，自然退出；耗时0.274s |
| main-electron-full<br>2026-10-17T15:12:25.703572+00:00 | electron-node / 180s | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron node_modules/vitest/vitest.mjs run --reporter=dot` | **0** | Electron ABI139：75文件1073/1073；耗时6.679s |
| main-r09-production<br>2026-10-17T15:12:28.918378+00:00 | electron / 270s | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r09-electron.cjs` | **0** | 真实生产Main/App/Preload/IPC，本地HTTP12次；UI计数58，非固定安全断言总数；耗时5.333s |
| main-r09-sqlite-first<br>2026-10-17T15:15:36.433094+00:00 | electron-node / 60s | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r09-sqlite.cjs /private/tmp/roundtable-r09-main-fgltw4x0/test-tmp/roundtable-r09-production-5FmXVz/r09-first.json` | **0** | 退出只读审计；3完成Attempt/3显式重试续写Attempt，checks15；耗时0.154s |
| main-r09-restart<br>2026-10-17T15:15:52.227778+00:00 | electron / 270s | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r09-electron.cjs --restart /private/tmp/roundtable-r09-main-fgltw4x0/test-tmp/roundtable-r09-production-5FmXVz/r09-manifest.json` | **0** | 新进程恢复，HTTP0、UI计数5、自然退出；耗时0.709s |
| main-r09-sqlite-restart<br>2026-10-17T15:16:07.918597+00:00 | electron-node / 60s | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r09-sqlite.cjs /private/tmp/roundtable-r09-main-fgltw4x0/test-tmp/roundtable-r09-production-5FmXVz/r09-restart.json` | **0** | 新进程退出只读审计，checks9；耗时0.117s |
| main-r78-production<br>2026-10-17T15:16:10.358384+00:00 | electron / 270s | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r07r08-electron.cjs` | **0** | 原房间/设置/Mock真实UI；18/18具名Bridge错误断言，24尺寸主题页面组合；耗时12.725s |
| main-r78-sqlite-first<br>2026-10-17T15:16:37.245702+00:00 | electron-node / 60s | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r07r08-sqlite.cjs /private/tmp/roundtable-r09-main-fgltw4x0/test-tmp/roundtable-r78-production-Cco1aD/r78-first.json` | **0** | 退出后SQLite公共上下文/历史/Key归属与保密审计通过；耗时0.12s |
| main-r78-restart<br>2026-10-17T15:16:40.289234+00:00 | electron / 270s | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r07r08-electron.cjs --restart /private/tmp/roundtable-r09-main-fgltw4x0/test-tmp/roundtable-r78-production-Cco1aD/r78-manifest.json` | **0** | 新进程配置/历史恢复；18/18真实Bridge断言，24尺寸主题页面组合；耗时6.777s |
| main-r03-recovery<br>2026-10-17T15:16:53.020185+00:00 | electron / 60s | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r01-electron.cjs --r03-recovery` | **1** | 旧探针settings白名单漏confirmTarget，exit1；恢复断言未运行，保留失败；耗时0.528s |
| main-r78-sqlite-restart<br>2026-10-17T15:17:01.651443+00:00 | electron-node / 60s | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r07r08-sqlite.cjs /private/tmp/roundtable-r09-main-fgltw4x0/test-tmp/roundtable-r78-production-Cco1aD/r78-restart.json` | **0** | 新进程退出只读审计通过；耗时0.117s |
| main-r03-recovery-fixed<br>2026-10-17T15:17:14.464838+00:00 | electron / 60s | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r01-electron.cjs --r03-recovery` | **0** | 仅补精确白名单后真实Main恢复/生命周期/退出通过，9旧Run分类；耗时1.804s |
| main-r03-sqlite<br>2026-10-17T15:17:39.323131+00:00 | electron-node / 60s | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r01-sqlite.cjs /private/tmp/roundtable-r09-main-fgltw4x0/test-tmp/roundtable-r01-electron-Mp7uYx/probe-result.json` | **0** | 4非终态interrupted，终态/idle/partial/原v1可恢复备份保留，关库审计通过；耗时0.118s |

完整回归、R09专项以及两种运行时存在重叠，不相加为独立用例总数。SQL脚本还有未计入checks的assert；UI计数含轮询deadline，不用58/5冒充固定安全断言数量。

## 原失败及处理

1. main-node-full：Node pretest以正确24.18.1源码编译SQLite成功；75文件中3文件15个本地HTTP用例因 `listen EPERM: operation not permitted 127.0.0.1` 失败。检查完整日志后以允许loopback的权限重跑同一完整测试集，1073/1073；没有改业务、用例或断言，也没有无限重试。重跑使用pnpm exec vitest，保留前一步已正确完成的native编译，不重复混ABI。
2. main-r03-recovery：真实Main及Preload已加载，旧探针在严格settings方法集合检查处报 `Unexpected settings API`，恢复断言未执行。对照R09 Shared/Preload与已通过R78探针确认唯一差异为已获批confirmTarget；仅tests/probes/r01-electron.cjs白名单增加该方法，保持精确集合、私有能力拒绝和全部恢复断言。新私有profile重跑exit0，再独立只读审计exit0。没有产品源码/构建/原生修改；既有1073/227/strict/build与R09/R78真实页面输入不变，不将旧失败说成通过。
3. macOS sandbox_extension_issue_file_to_process提示和Zod/Rollup注释warning完整保留；GUI均真实加载生产Main/沙箱Preload并自然exit0，不能据warning宣称跨平台或发布已验证。

## 独立收尾核验

`python3 /private/tmp/roundtable-r09-main-fgltw4x0/final-audit.py`：exit0。167个src/tests文件与本轮Electron完整回归指纹一致；唯一验证改动为r01-electron.cjs精确增加confirmTarget。migration1与原始135bf82原文一致，migration2/3及package/lock/workspace/构建配置与合并前主线逐字一致；17WT清单及其非main HEAD/工作区保持不变；16个已有native文件inode各独立，其他WT native inode/SHA与合并后重建前快照相同。无依赖目录的detached WT未虚报原生可用。收尾结果见final-audit.json；后续治理文档不改变已测业务版本。

提交前另执行git diff --check、逐项diff/暂存文件清单及敏感产物路径扫描；状态提交后重新git status和17WT核对，最终完整main SHA以交付消息和本记录所在提交为准。

## 日志SHA256

下列为各receipt记录且收尾实际重新计算匹配的原始日志摘要；失败日志同样保留。

| label | SHA256 |
| --- | --- |
| main-dependency-inventory | `0d0f9b69c44f7426def79dcdeaeec744d00688c1648195f87f21c5ac82052908` |
| main-electron-headers | `29213a5c5b33cb31ddeb991826c3a9f8dbfbedcd805e26c8754c23ec206aa00d` |
| main-isolation | `b097f04fe9a477e409d453e0f7010ad327cf1a973e949d9d104b463bff6fac23` |
| main-build | `6daed3a5ac9836566f0b8b4375b57bdf205e3dde085697f43cbcbb65235a53d3` |
| main-typecheck | `072d84b3aeca2c2388fda023ba92238e18e00efb6d1f62e7e4fbf59670d88821` |
| main-node-full | `ba53713615c22ce7a8b97f608d4196f4b00f1cc2f59326a207dbef795d061d8d` |
| main-node-full-permitted | `1c8a6074741739d54e07b47fec0ddeefd845d698821983068110b178c0958742` |
| main-r09-special | `3da7325fd47754f4130a0dcdb70d59bcb9052f1f80d5d2808fd9c1b36e5e6621` |
| main-node-native-2 | `1b58a2e85e5dd0f96cf40f5816d64f49f27e773585ebfc92f81087b3d807f134` |
| main-node-native-1 | `1b58a2e85e5dd0f96cf40f5816d64f49f27e773585ebfc92f81087b3d807f134` |
| main-node-native-3 | `1b58a2e85e5dd0f96cf40f5816d64f49f27e773585ebfc92f81087b3d807f134` |
| main-node-native-5 | `1b58a2e85e5dd0f96cf40f5816d64f49f27e773585ebfc92f81087b3d807f134` |
| main-node-native-4 | `1b58a2e85e5dd0f96cf40f5816d64f49f27e773585ebfc92f81087b3d807f134` |
| main-electron-rebuild | `1f9faa3edbda53904eba7c852108c318279540fb646ad1bada7a0b74adafa4f7` |
| main-electron-native | `c2b6b2e7b27ba1b78a961237e43f68192a638b10d2bb5091f9c83ea2ae014e23` |
| main-electron-full | `ee8504314b2c6bd68373910e8ffd5e328401b355c5c45580b7728575e1ca180b` |
| main-r09-production | `91b99560fe977d97a6a8a29fd87d4551d046e84c3da785a55b2684ef41a9b8b5` |
| main-r09-sqlite-first | `e3ffc6fcbf6b8945d2ee6c5ed959684e86dc632d17e2b3ec78b3f9c236b56816` |
| main-r09-restart | `17cd8b31742d4f3bdc5f1541b38954e2dafe30a83dc526a26a074f1cccda8fc8` |
| main-r09-sqlite-restart | `6d56740199857ff8a2266b638e3e9888731877fd75dfafa9d9c0a7efd1648c14` |
| main-r78-production | `5bf72fa41b2f5508cac8074f4570808e9cc2524947f046b703fea5b5b77f9599` |
| main-r78-sqlite-first | `1517d8889244b5677d6810e3d2b551e04e9254426c58acb6ad5091bc6ea69dca` |
| main-r78-restart | `75967a5718dcdb983e7118903ce11018a246a7b2cd1d823dfdc17a7c3cd8bdd6` |
| main-r03-recovery | `cd24f899eac2d8113d648640818db91226be6415d4feada387204f5dce279723` |
| main-r78-sqlite-restart | `097e97c0a001d311ba6c5d9ee8eec7a10ffaebfa58684cee6043783e452c6d5d` |
| main-r03-recovery-fixed | `d51ef29a700a19c054d6c08391f8f1b1e3bdfd491e87f2e43265a18d170a1546` |
| main-r03-sqlite | `ea591380f0b99af22a73c59346191d399fc3ce6cf3354034fabf5bea89375b53` |

## 停止边界

本轮没有真实API smoke、真实Keychain、正式E2E、ASAR/安装包、签名、Windows/Linux或发布检查，不记PASS；没有新建/删除Worktree、重写历史、安装/升级依赖、启动后续模块或公开GitHub。
