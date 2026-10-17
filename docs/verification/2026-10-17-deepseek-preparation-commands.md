# DeepSeek 安全准备逐命令台账（2026-10-17）

只记录本次候选Worktree的实际执行结果。工作目录 `/Users/zhangwenjie/.codex/worktrees/deepseek-safety-prep/AI交互`，基线main `dc387146e1535a596508a5b58ea8bfe3903fc658`。main原目录未改。

## 环境和执行方式

证据根 `/private/tmp/roundtable-deepseek-prep-7db13`；所有日志、receipt、cache/gyp、XDG及临时SQLite/userData在仓库外，不提交数据库/Key/构建产物。日志可能随系统临时目录清理；下表持久记录命令、结果和摘要。

`python3 /private/tmp/roundtable-deepseek-prep-7db13/env-bootstrap.py` 实际exit0：缓存官方Node24.18.1 darwin-arm64 runtime+严格同版headers来源及2727文件（含node二进制）核对、pnpm11.25.0官方包455文件核对及独立解包。没有升级依赖/修改全局Node或复制node_modules。原缓存内容以独立inode克隆、只读索引备份后冻结离线copy安装，不是冷缓存公网安装。

表中每条实际调用 `python3 /private/tmp/roundtable-deepseek-prep-7db13/run-check.py <label> <timeout秒> <mode> <argv...>`；执行器记录UTC、前后tracked/untracked输入hash、stdout/stderr/log hash及退出码，有界进程组监督，均未超时。

- node模式：固定官方24.18.1完整目录为npm_config_nodedir、build_from_source=true，ABI137。
- electron模式：固定本轮38.8.6 headers；electron-node模式只保留ELECTRON_RUN_AS_NODE=1，实际内嵌Node22.22.0/ABI139。先完成Node检查，才串行重建Electron；最终候选native留139。
- 所有loopback和GUI命令用已授权执行权限；HTTP fixture自有端口，fake Key/临时DB；真实公网API数量0。GUI在ready/Main导入前隔离userData/sessionData/logs、全fake safeStorage和Chromium mock-keychain，Node/Chromium外网阻断。
- 测试把Date.now固定到价格review有效区间，各用例另验证未来/过期；产品不伪造时钟，固定期限到期必拒绝。

## 实际命令

| label / UTC | mode / 超时 | 实际argv | exit | 实际结果 |
| --- | --- | --- | --- | --- |
| env-cache-seed<br>2026-10-17T15:42:20.783163+00:00 | tool / 180s | `python3 /private/tmp/roundtable-deepseek-prep-7db13/env-seed-cache.py` | **0** | 独立内容缓存/只读SQLite索引备份；不复制node_modules；3.658s |
| env-install<br>2026-10-17T15:43:01.619215+00:00 | node / 300s | `/private/tmp/roundtable-deepseek-prep-7db13/bin/pnpm install --frozen-lockfile --offline --package-import-method=copy --side-effects-cache=false --reporter=append-only` | **0** | 原锁冻结离线copy安装，646 reused/0 downloaded；源码编译SQLite；16.32s |
| deepseek-red<br>2026-10-17T15:44:23.704164+00:00 | node / 90s | `/private/tmp/roundtable-deepseek-prep-7db13/bin/pnpm exec vitest run tests/integration/deepseek --reporter=dot` | **1** | 新专项28项中15失败/13通过，能力与CNY门禁未实现；另发现一个测试updateProvider参数不完整；0.92s |
| baseline-full<br>2026-10-17T15:44:29.900794+00:00 | node / 180s | `/private/tmp/roundtable-deepseek-prep-7db13/bin/pnpm exec vitest run --exclude 'tests/integration/deepseek/**' --reporter=dot` | **0** | 实施前既有75文件1073/1073；只在基线盘点阶段排除尚未实现的新专项；5.693s |
| deepseek-green-1<br>2026-10-17T15:45:19.550258+00:00 | node / 90s | `/private/tmp/roundtable-deepseek-prep-7db13/bin/pnpm exec vitest run tests/integration/deepseek --reporter=dot` | **0** | 28/28，参数/CNY/HTTP/持久化通过；1.187s |
| deepseek-green-2<br>2026-10-17T15:46:15.445718+00:00 | node / 90s | `/private/tmp/roundtable-deepseek-prep-7db13/bin/pnpm exec vitest run tests/integration/deepseek --reporter=dot` | **0** | 32/32，增加Key前预算拒绝/跨端点隔离/元数据/列表鉴权拒绝；1.178s |
| strict-1<br>2026-10-17T15:46:35.544514+00:00 | node / 90s | `/private/tmp/roundtable-deepseek-prep-7db13/bin/pnpm run typecheck` | **0** | TypeScript strict通过；1.967s |
| env-inventory<br>2026-10-17T15:46:38.285031+00:00 | tool / 45s | `python3 /private/tmp/roundtable-deepseek-prep-7db13/env-direct-inventory.py` | **0** | 32直接依赖与原锁及安装锁一致；0.089s |
| full-node-1<br>2026-10-17T15:46:39.461235+00:00 | node / 180s | `/private/tmp/roundtable-deepseek-prep-7db13/bin/pnpm exec vitest run --reporter=dot` | **0** | 全部76文件1105/1105，无exclude/skip；5.72s |
| build<br>2026-10-17T15:48:02.752810+00:00 | node / 150s | `/private/tmp/roundtable-deepseek-prep-7db13/bin/pnpm run build` | **0** | Main218.84kB、CJS Preload232.20kB、Renderer964.20kB；既有Zod警告；2.936s |
| node-native<br>2026-10-17T15:48:06.125209+00:00 | node / 45s | `/private/tmp/roundtable-deepseek-prep-7db13/bin/node tests/probes/r09-native.cjs` | **0** | Node24.18.1/ABI137/arm64，100内存DB/10000行，自然退出；0.073s |
| electron-headers<br>2026-10-17T15:48:06.310041+00:00 | tool / 90s | `python3 /private/tmp/roundtable-deepseek-prep-7db13/env-prepare-electron-headers.py` | **0** | 125文件与对应38.8.6源及官方缓存一致，独立inode；0.173s |
| electron-rebuild<br>2026-10-17T15:48:18.070835+00:00 | electron / 240s | `/private/tmp/roundtable-deepseek-prep-7db13/bin/pnpm run native:electron` | **0** | Electron38.8.6/ABI139源码重建SQLite；10.886s |
| electron-native<br>2026-10-17T15:48:46.172937+00:00 | electron-node / 45s | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r09-native.cjs` | **0** | 实际Electron38.8.6/Node22.22.0/ABI139/arm64，100DB/10000行自然退出；1.253s |
| electron-full<br>2026-10-17T15:48:47.498184+00:00 | electron-node / 180s | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron node_modules/vitest/vitest.mjs run --reporter=dot` | **0** | 全部76文件1105/1105，无exclude/skip；6.986s |
| production-entry<br>2026-10-17T15:48:49.527913+00:00 | electron / 270s | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r09-electron.cjs` | **1** | exit1：探针把setKey返回Key状态的既有解密计入了拒绝操作区间，29!=28；原失败保留；5.025s |
| production-entry-2<br>2026-10-17T15:50:03.923623+00:00 | electron / 270s | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r09-electron.cjs` | **1** | exit1：拆分探针setup时漏声明api，生产Main加载后脚本失败；保留；4.826s |
| production-entry-3<br>2026-10-17T15:50:15.412708+00:00 | electron / 270s | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r09-electron.cjs` | **0** | 新profile生产入口通过；DeepSeek9断言+拒绝区间29→29解密；原R09本地fixture12请求；4.817s |
| isolation<br>2026-10-17T15:50:37.647817+00:00 | tool / 90s | `python3 /private/tmp/roundtable-deepseek-prep-7db13/isolation-audit.py` | **0** | 新WT23051物理依赖inode，与其他WT共享0；当前18WT；12.614s |
| production-sqlite<br>2026-10-17T15:50:58.197312+00:00 | electron-node / 60s | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r09-sqlite.cjs /private/tmp/roundtable-deepseek-prep-7db13/test-tmp/roundtable-r09-production-g9MVbn/r09-first.json` | **0** | 退出只读审计通过：公共输入/usage/partial/Attempt、完整性、密钥不泄漏；0.247s |
| production-restart<br>2026-10-17T15:50:58.510172+00:00 | electron / 270s | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r09-electron.cjs --restart /private/tmp/roundtable-deepseek-prep-7db13/test-tmp/roundtable-r09-production-g9MVbn/r09-manifest.json` | **0** | 新进程HTTP0；DeepSeek9断言+拒绝区间3→3解密；配置/历史/确认失效；0.892s |
| restart-sqlite<br>2026-10-17T15:51:57.829425+00:00 | electron-node / 60s | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r09-sqlite.cjs /private/tmp/roundtable-deepseek-prep-7db13/test-tmp/roundtable-r09-production-g9MVbn/r09-restart.json` | **0** | 重启后只读SQLite审计通过；0.113s |
| mock-production<br>2026-10-17T15:51:58.018205+00:00 | electron / 270s | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r07r08-electron.cjs` | **0** | 原Mock真实UI/配置/控制/历史/Key及18/18真桥断言通过；13.051s |
| mock-sqlite<br>2026-10-17T15:52:54.040033+00:00 | electron-node / 60s | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r07r08-sqlite.cjs /private/tmp/roundtable-deepseek-prep-7db13/test-tmp/roundtable-r78-production-kZjlUK/r78-first.json` | **0** | 原Mock退出只读SQLite审计通过；0.113s |

完整回归与专项、两种运行时存在重叠，不相加为独立用例总数。基线命令只盘点尚未改动的既有测试；最终Node/Electron均收集全部1105，无跳过失败。GUI的59/5等计数含轮询，不冒称固定安全断言总数；DeepSeek每阶段9条具名断言及Main侧解密计数比较独立核对。

## 失败和实际修复

1. deepseek-red的真实失败确认默认cap缺thinking/max_tokens及价格仅USD。完成Main-only字面参数能力、CNY整数和有效期门禁后28/28。测试中updateProvider最初只给id/baseUrl而缺必需name/kind，按既有契约补齐；重复负价用例改为小数价以覆盖整数约束，不改产品去迎合错误fixture。
2. production-entry在全部9个Bridge断言完成后，Main侧fake解密总量29!=28。完整源码追踪为ProviderSettingsService.setKey→getProviderKeyState→resolveKey，保存后安全状态确认本就会解密一次；不属于被拒生成的Key读取。探针拆为setup和实际拒绝区间，保存完成后才取严格计数基线，不删除零解密断言。
3. production-entry-2拆分时漏api局部声明，真实Main已加载但新增流程失败。仅补window.roundtable声明后新profile重跑exit0，再完成新进程和两次只读审计；业务与构建产物未改。两个失败profile/log保留，不当成PASS。
4. 既有Xcode缓存/FSEvents、macOS sandbox_extension与Zod/Rollup注释warning保留；没有为警告升级依赖，不把它们隐瞒或当作发布通过。

## 收尾核验

实际Python只读scope核验exit0（scope-audit.json）：main仍dc387146且干净；16个原WT native inode/SHA与上轮main验收快照一致，自己的node_modules inode不共享；Shared/Database/security/Mock预算、RunService、migration、package/lock/构建配置逐字未改。Git状态/逐文件diff、git diff --check及提交清单另实际核对；最终候选SHA见交付消息及本记录所在提交，不编造自身hash。

## 原始日志SHA256

每个摘要已实际重新计算匹配receipt；原始失败同样保留。

| label | SHA256 |
| --- | --- |
| env-cache-seed | `80d48c2b783270bceb9619a7d05d7f4700c7f158973a4f49318ca718ff1ee384` |
| env-install | `bd624f19b35a1a3b5b3b9ec6baacdfe788b529cc884467eda1b95b083560ffc8` |
| deepseek-red | `ebcf59f483ba1e7e3905fca0d7ca25b48e5d4b96f5e1b1c7ff8c556f19a3fd3a` |
| baseline-full | `205926a9f782699339754460247d66090c9b3dd5b53e67fe2a5d6e1eaf2bb0e5` |
| deepseek-green-1 | `72a0cc50a139e8bfe4c237840848c564470605777e07626df35db41ffecb867a` |
| deepseek-green-2 | `e7595c6702f42f120f450eacb50baeaa9f205a82fcac5bea85233ae8580126b0` |
| strict-1 | `072d84b3aeca2c2388fda023ba92238e18e00efb6d1f62e7e4fbf59670d88821` |
| env-inventory | `0d0f9b69c44f7426def79dcdeaeec744d00688c1648195f87f21c5ac82052908` |
| full-node-1 | `5a98bf6b909043893689fc80ded516d8d88ce105f7f36757963a421f3d88fcd4` |
| build | `a42d400daea2296050a3ee35891d6f7983c860ca56fd9a3f2bbcddd99323a144` |
| node-native | `1b58a2e85e5dd0f96cf40f5816d64f49f27e773585ebfc92f81087b3d807f134` |
| electron-headers | `d55aad181b0ce14707829d5762256f1980d12a31d793b7b8ebbf8a8148edc781` |
| electron-rebuild | `1f9faa3edbda53904eba7c852108c318279540fb646ad1bada7a0b74adafa4f7` |
| electron-native | `c2b6b2e7b27ba1b78a961237e43f68192a638b10d2bb5091f9c83ea2ae014e23` |
| electron-full | `7bcb4f4b2fe46e8aa14ff683e9098cc8ac1aef16c437863eb345b66b965b1ed0` |
| production-entry | `dd036f4370963a2a61aed75900d7855395f5c6c7bf3b179f445c3d74fd46c8c3` |
| production-entry-2 | `abb4b22ab911142270faadae6515568872b24f2d7d6b873fc2e844d6693c08ff` |
| production-entry-3 | `fca412c21eedff1206f489ef21cf390c425cc710e35cb94b9bdd025451566204` |
| isolation | `1255cf258fb3c35b5de7b34610ba9382eff2102d668556cc927d472a3db49460` |
| production-sqlite | `e3ffc6fcbf6b8945d2ee6c5ed959684e86dc632d17e2b3ec78b3f9c236b56816` |
| production-restart | `bd3359871f9c63e935e2d2f97e36df5ab689a2138be83f1630794e4095e7fa94` |
| restart-sqlite | `6d56740199857ff8a2266b638e3e9888731877fd75dfafa9d9c0a7efd1648c14` |
| mock-production | `3795f2805778d919cdcc21e2eed73416786ec24ff1c8d8bafac1d4548680789b` |
| mock-sqlite | `ea81bc222168e63bff61fec7c57878e19c0c5a1e8294f301859bedb9655045b5` |

真实模型能力/计费/公网调用、真实Keychain、正式E2E、打包/ASAR/签名/跨平台未执行，不记PASS。完整token证明阻塞仍在，未合main、未启动其他模块或GitHub发布。
