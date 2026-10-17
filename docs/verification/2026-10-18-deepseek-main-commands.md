# DeepSeek 安全准备合并后 main 命令台账（2026-10-18）

本轮所有结果在原main目录 `/Users/zhangwenjie/Documents/ChatGPT/AI交互` 重新执行，不引用候选历史PASS。验证业务版本为`30d578356d283a55b1c15a122c0a37465c6e4b25`，没有修改业务或验证代码。

证据根 `/private/tmp/roundtable-deepseek-main-20261018`；日志、JSON receipt、缓存/gyp/XDG、测试SQLite/userData均在仓库外。临时目录可能由系统清理，本文持久保存命令/退出码/摘要。

## 合并及环境

实际main=dc387146e1535a596508a5b58ea8bfe3903fc658、候选=30d578356d283a55b1c15a122c0a37465c6e4b25，候选直接父提交为main；18WT干净、11个获批文本文件，祖先/原135bf82历史/范围/无二进制检查通过。pre-merge.json保留精确HEAD/文件/WT/native inode与SHA。

`git merge --ff-only codex/deepseek-safety-prep` 实际exit0，2026-10-17T16:09:21.036629+00:00（北京时间2026-10-18 00:09）；main直接推进30d5783，无新merge commit/冲突/历史重写。merge.json保留真实stdout和退出码。

`python3 /private/tmp/roundtable-deepseek-main-20261018/env-bootstrap.py` exit0：官方缓存24.18.1 runtime/严格同版headers及pnpm11.25.0来源重新核验（2727 runtime/include文件、455 pnpm文件），新解包独立pnpm执行树。main复用自己的既有独立node_modules，没有新install/复制其他依赖/改全局Node。

下表命令实际经 `python3 /private/tmp/roundtable-deepseek-main-20261018/run-check.py <label> <timeout秒> <mode> <argv...>` 执行；记录UTC、真实argv、退出码、source/test指纹和日志SHA。node模式为24.18.1/ABI137，electron模式固定38.8.6对应headers，electron-node模式清除目标后只设置ELECTRON_RUN_AS_NODE=1（内置Node22.22.0/ABI139）。各自cache/gyp/TMPDIR独立，Node检查完成后才重建Electron，最终main native留139；以下均未超时。

## 实际检查

| label / UTC | mode / 超时 | 实际argv | exit | 结果 |
| --- | --- | --- | --- | --- |
| dependency-inventory<br>2026-10-17T16:09:22.444400+00:00 | tool / 45s | `python3 /private/tmp/roundtable-deepseek-main-20261018/env-direct-inventory.py` | **0** | 32直接版本/安装锁与原锁匹配；非新安装；0.074s |
| isolation<br>2026-10-17T16:09:22.600042+00:00 | tool / 90s | `python3 /private/tmp/roundtable-deepseek-main-20261018/isolation-audit.py` | **0** | main23555依赖inode与其他WT共享0，18WT；13.672s |
| main-build<br>2026-10-17T16:09:45.303299+00:00 | node / 150s | `/private/tmp/roundtable-deepseek-main-20261018/bin/pnpm run build` | **0** | Main218.84kB/CJS Preload232.20kB/Renderer964.20kB；7.129s |
| main-typecheck<br>2026-10-17T16:09:45.303417+00:00 | node / 90s | `/private/tmp/roundtable-deepseek-main-20261018/bin/pnpm run typecheck` | **0** | TypeScript strict通过；5.881s |
| main-node-full<br>2026-10-17T16:09:47.242424+00:00 | node / 300s | `/private/tmp/roundtable-deepseek-main-20261018/bin/pnpm run test --reporter=dot` | **0** | Node24.18.1同版headers源码重建后，76文件1105/1105；20.656s |
| main-node-native<br>2026-10-17T16:10:23.460801+00:00 | node / 45s | `/private/tmp/roundtable-deepseek-main-20261018/bin/node tests/probes/r09-native.cjs` | **0** | 实际ABI137/arm64；100内存DB/10000行，自然退出；0.08s |
| main-electron-headers<br>2026-10-17T16:10:23.672379+00:00 | tool / 90s | `python3 /private/tmp/roundtable-deepseek-main-20261018/env-prepare-electron-headers.py` | **0** | 125个匹配38.8.6 headers，独立inode；0.174s |
| main-deepseek-special<br>2026-10-17T16:10:25.975675+00:00 | node / 90s | `/private/tmp/roundtable-deepseek-main-20261018/bin/pnpm exec vitest run tests/integration/deepseek --reporter=dot` | **0** | 1文件32/32；参数、CNY/过期/超限/Key前拒绝/HTTP/Attempt；1.307s |
| main-electron-rebuild<br>2026-10-17T16:10:39.845492+00:00 | electron / 240s | `/private/tmp/roundtable-deepseek-main-20261018/bin/pnpm run native:electron` | **0** | 匹配38.8.6 headers源码重建SQLite至ABI139；13.54s |
| main-electron-native<br>2026-10-17T16:11:06.028326+00:00 | electron-node / 45s | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r09-native.cjs` | **0** | 实际38.8.6/Node22.22.0/ABI139/arm64，100DB/10000行自然退出；0.272s |
| main-electron-full<br>2026-10-17T16:11:06.373794+00:00 | electron-node / 180s | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron node_modules/vitest/vitest.mjs run --reporter=dot` | **0** | 76文件1105/1105，全部回归；6.947s |
| main-production-entry<br>2026-10-17T16:11:09.479312+00:00 | electron / 270s | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r09-electron.cjs` | **0** | 真实生产入口本地fixture12请求；DeepSeek9断言及拒绝区间解密29→29；5.146s |
| main-exit-sqlite<br>2026-10-17T16:11:48.112621+00:00 | electron-node / 60s | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r09-sqlite.cjs /private/tmp/roundtable-deepseek-main-20261018/test-tmp/roundtable-r09-production-yY2gmK/r09-first.json` | **0** | 退出只读审计通过，3完成Attempt/3显式重复Attempt/公共输入/usage/partial；0.119s |
| main-production-restart<br>2026-10-17T16:11:48.311812+00:00 | electron / 270s | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r09-electron.cjs --restart /private/tmp/roundtable-deepseek-main-20261018/test-tmp/roundtable-r09-production-yY2gmK/r09-manifest.json` | **0** | 新进程HTTP0；DeepSeek9断言及解密3→3；0.731s |
| main-restart-sqlite<br>2026-10-17T16:12:19.358132+00:00 | electron-node / 60s | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r09-sqlite.cjs /private/tmp/roundtable-deepseek-main-20261018/test-tmp/roundtable-r09-production-yY2gmK/r09-restart.json` | **0** | 新进程退出只读SQLite审计通过；0.113s |

本轮15个受控检查全部exit0，失败0，无skip/exclude或安全断言修改。专项为完整回归子集，两种运行时也重叠，不累加为独立用例总数。候选原始RED和两次GUI脚本失败仍完整保留在原候选报告及台账，不删除或改写。Xcode缓存/FSEvents、编译及Zod/Rollup、macOS sandbox_extension warning按原日志保留，不因此升级依赖。

## 安全与收尾

生产探针ready前隔离userData/sessionData/logs，启用mock-keychain并替换safeStorage全部方法；Renderer/Node外网阻断，只有自有HTTP fixture可达。DeepSeek名称不匹配R09 fixture策略注入条件，使用默认未注册counter路径；首轮和重启各9条严格Bridge断言，setup保存假Key后拒绝区间分别29→29和3→3解密。DeepSeek默认鉴权/生成/单Agent启动拒绝，未留下Run；模型列表拒绝在本轮专项覆盖。

最终Python scope audit实际exit0，final-audit.json保留：171个src/tests文件与本轮Electron回归一致；原DB/迁移/KeyService/Mock/RunService/package/lock/构建配置与合并前main相同；18WT仍登记且非main HEAD/工作区未变，其他native inode/SHA未变。全部日志SHA重新计算匹配。本轮未注册计数policy、未改价格有效期、未开发Tokenizer、未读取真实Key/用户DB或调用公网模型。

提交前git diff --check、逐项docs diff和暂存清单实际核对；状态提交后再次核对main及18WT。主线最终SHA为独立状态提交，由交付消息及本报告Git历史定位，不编造自身提交hash。

## 日志SHA256

| label | SHA256 |
| --- | --- |
| dependency-inventory | `0d0f9b69c44f7426def79dcdeaeec744d00688c1648195f87f21c5ac82052908` |
| isolation | `4305e00a2207a20b06f71fa6c09345647330ca36d965034cbb00be31a3098efc` |
| main-build | `e75fca434743314c4e694220c453fd56edd7ac98eeb24f4a5f8e6e74dd53fdd0` |
| main-typecheck | `072d84b3aeca2c2388fda023ba92238e18e00efb6d1f62e7e4fbf59670d88821` |
| main-node-full | `60e8d9620b965ffdfd88300de63fd71836a14a0a93e5dd4ef013be9f4ee449b8` |
| main-node-native | `1b58a2e85e5dd0f96cf40f5816d64f49f27e773585ebfc92f81087b3d807f134` |
| main-electron-headers | `30590ebb9c76d13e99084245ade1b229ed381d8bb294841f4b3611f9f7520658` |
| main-deepseek-special | `8713b274e588e8eaf9535bbc0acc3971fd8a58285e1686abcd50697e20cf2ebb` |
| main-electron-rebuild | `1f9faa3edbda53904eba7c852108c318279540fb646ad1bada7a0b74adafa4f7` |
| main-electron-native | `c2b6b2e7b27ba1b78a961237e43f68192a638b10d2bb5091f9c83ea2ae014e23` |
| main-electron-full | `3cd0119c01e69b0b779d5ee1cd1fd85faf61e7871ecdc741b9761e4a027095c0` |
| main-production-entry | `20805d4a763b77b69150556c2b5ab8701eabe628bc3a90c7eb19a275914fe60c` |
| main-exit-sqlite | `e3ffc6fcbf6b8945d2ee6c5ed959684e86dc632d17e2b3ec78b3f9c236b56816` |
| main-production-restart | `264c23df7b79e525efef517e4e969b8de96ed3980d954507b345a2eb4f7646c2` |
| main-restart-sqlite | `6d56740199857ff8a2266b638e3e9888731877fd75dfafa9d9c0a7efd1648c14` |
