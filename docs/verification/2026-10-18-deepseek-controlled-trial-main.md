# DeepSeek 单次受控测试：main最终验收（2026-10-18）

本次仅完成用户已批准候选的ff-only合并、main独立复验与治理状态更新。**DEEPSEEK-TRIAL-01 merged/verified仅限受控入口/本地fixture；严格模式DEEPSEEK-TOKEN-01继续blocked，真实公网模型请求0。**

## Git与环境

- 合并前main：`ae5c24c6dd1410aedba6ef31894470b7cb668c8a`；获批候选及实际ff目标：`db97b95c8d7ce279d76d304d9f4c9ea64259d16a`。候选是唯一直接后继，17个WT合并前干净、29文件范围/原基线祖先/敏感文件检查通过。
- 实际`git merge --ff-only codex/deepseek-controlled-trial` exit0，北京时间2026-10-18 13:06:46；无新merge commit/冲突/重复引入/历史重写。合并后src/tests/package/lock/build配置与获批候选相同；本次只新增此报告并更新STATUS/CONTRACTS/DECISIONS，独立治理Commit即本文所在提交，完整最终main SHA见交付消息和Git历史。
- 新证据根：`/private/tmp/roundtable-deepseek-trial-main-g07g7i7p`，真实argv、cwd、UTC、环境覆盖、源码/测试指纹与日志SHA均存`<label>.json`/`logs/<label>.log`。缓存/gyp/XDG/TMPDIR/userData/SQLite全部本轮独立；临时证据可能被系统清理，以下持久记录本次命令和结果。
- 官方Node24.18.1/darwin-arm64/ABI137及同发行headers重新比对2727文件；新解包pnpm11.25.0比对455文件。main复用自己的独立依赖，没有安装/复制node_modules、升级依赖、改全局Node或使用错误raw数值fetch参数。Electron38.8.6/内嵌Node22.22.0/ABI139/arm64，125个严格对应headers独立复制；Node检查完成后才串行重建Electron，最终native保留139。Node24.21.0上游风险保持。

## 实际命令与结果

cwd为原main仓库。以下缩写仅为可读性，receipt保留精确绝对argv及环境；每条实际由`python3 "$R/run-check.py" <label> <timeout秒> <mode> <argv...>`有界执行。`node`模式指向24.18.1完整runtime的nodedir；`electron`指向38.8.6 headers；`electron-node`只设置ELECTRON_RUN_AS_NODE=1。

```sh
R=/private/tmp/roundtable-deepseek-trial-main-g07g7i7p
P="$R/bin/pnpm"
E=node_modules/electron/dist/Electron.app/Contents/MacOS/Electron
```

| label / 北京时间开始 | mode / 上限 | 实际子进程命令 | exit | 结果 |
| --- | --- | --- | ---: | --- |
| dependency-inventory / 13:07:16 | tool / 45s | `python3 $R/env-direct-inventory.py` | **0** | 32直接依赖版本/安装锁与仓库一致；没有新install；0.119s |
| isolation / 13:07:16 | tool / 90s | `python3 $R/isolation-audit.py` | **0** | main23555物理依赖inode与其他WT共享0；17WT；12.579s |
| electron-headers / 13:07:16 | tool / 45s | `python3 $R/env-prepare-electron-headers.py` | **0** | 125文件与38.8.6缓存逐字匹配，独立inode，目标ABI139/arm64；0.169s |
| main-node-full / 13:07:46 | node / 180s | `$P run test --reporter=dot` | **0** | Node24.18.1同版headers源码编译后81文件1168/1168；35.503s |
| main-typecheck / 13:07:47 | node / 90s | `$P run typecheck` | **0** | TypeScript strict；2.258s |
| main-build / 13:07:40 | node / 120s | `$P run build` | **0** | Main241.00kB/CJS Preload232.20kB/Renderer964.20kB；6.644s |
| main-node-native / 13:09:52 | node / 45s | `"$R/bin/node" tests/probes/r09-native.cjs` | **0** | ABI137/arm64；100内存DB/10000行，自然退出；0.081s |
| main-electron-rebuild / 13:09:59 | electron / 180s | `$P run native:electron` | **0** | 严格对应38.8.6 headers源码重建SQLite；10.855s |
| main-electron-native / 13:10:26 | electron-node / 45s | `$E tests/probes/r09-native.cjs` | **0** | Electron38.8.6/Node22.22.0/ABI139/arm64；100DB/10000行，自然退出；3.351s |
| main-electron-full / 13:10:39 | electron-node / 150s | `$E node_modules/vitest/vitest.mjs run --reporter=dot` | **0** | Electron-node 81文件1168/1168；21.127s |
| main-controlled-production / 13:10:53 | electron / 90s | `$E tests/probes/deepseek-trial-electron.cjs` | **0** | 42条具名断言，2次自有HTTP fixture，公网0；0.844s |
| main-controlled-restart / 13:11:01 | electron / 90s | `$E tests/probes/deepseek-trial-electron.cjs --restart $R/test-tmp/roundtable-deepseek-trial-HaKDCP/trial-manifest.json` | **0** | 新进程24条具名断言、HTTP0；unknown阻止新确认/Key读取；0.496s |
| main-controlled-exit / 13:11:17 | electron-node / 30s | `$E -e <下附只读审计原文> "$R/test-tmp/roundtable-deepseek-trial-HaKDCP/userData/ai-roundtable.db"` | **0** | 只读v4/完整性/外键；结算206micro、未知预留50000；无明文fakeKey/隐式Run；0.111s |
| main-r09-production / 13:11:24 | electron / 120s | `$E tests/probes/r09-electron.cjs` | **0** | 原生产链路58条断言、12次自有HTTP，三Agent公共上下文/partial/显式Repeat；4.709s |
| main-r09-exit / 13:11:52 | electron-node / 30s | `$E tests/probes/r09-sqlite.cjs $R/test-tmp/roundtable-r09-production-7krXH8/r09-first.json` | **0** | 只读SQLite15检查，3完成Attempt+3显式Repeat；0.108s |
| main-r09-restart / 13:11:59 | electron / 90s | `$E tests/probes/r09-electron.cjs --restart $R/test-tmp/roundtable-r09-production-7krXH8/r09-manifest.json` | **0** | 新进程5断言/HTTP0；0.72s |
| main-r09-restart-exit / 13:12:06 | electron-node / 30s | `$E tests/probes/r09-sqlite.cjs $R/test-tmp/roundtable-r09-production-7krXH8/r09-restart.json` | **0** | 只读SQLite9检查，历史保留；0.113s |
| main-r78-production / 13:12:12 | electron / 150s | `$E tests/probes/r07r08-electron.cjs` | **0** | 原房间/成员/设置/三Mock/历史/亮暗窄窗及18条真桥错误断言；12.54s |
| main-r78-exit / 13:13:07 | electron-node / 30s | `$E tests/probes/r07r08-sqlite.cjs $R/test-tmp/roundtable-r78-production-BPz5Ea/r78-first.json` | **0** | 只读v4/完整性/配置历史/Key密文归属、3原Attempt+3显式Repeat；0.115s |
| main-r78-restart / 13:13:13 | electron / 120s | `$E tests/probes/r07r08-electron.cjs --restart $R/test-tmp/roundtable-r78-production-BPz5Ea/r78-manifest.json` | **0** | 新进程配置/历史恢复及18条真桥错误断言；网络0；6.737s |
| main-r78-restart-exit / 13:13:53 | electron-node / 30s | `$E tests/probes/r07r08-sqlite.cjs $R/test-tmp/roundtable-r78-production-BPz5Ea/r78-restart.json` | **0** | 同轮重启退出只读SQLite审计，历史及公共上下文保留；0.118s |
| final-audit-field-red / 13:15:32 | tool / 30s | `python3 $R/final-audit-isolation-field-red.py` | **1** | 临时汇总脚本误用isolationBeforeReady字段，KeyError；保留真实失败；0.452s |
| final-audit-field-green / 13:15:38 | tool / 30s | `python3 $R/final-audit.py` | **0** | 仅汇总脚本按三探针真实字段显式映射，3个profile、6份GUI运行结果/18次业务检查/原WT和native逐一重验；0.528s |

21项必要环境/产品检查全部exit0；另有临时汇总字段检查RED exit1→GREEN exit0，不能写成从无失败。最终全回归不含skip或删除用例；数据库/安全专项为完整1168的子集，不机械重复或累加两运行时。

其中完整回归实际覆盖：v3→v4重复初始化、升级前v3备份、注入失败逐字回滚且保留已有备份、v4备份恢复、请求身份/未结唯一索引损坏拒绝、历史缺失元数据保留、unknown幂等重启；逐次确认/报价与Key变更/目标过期、400/401/429/断流/usage缺失/20秒超时、Abort及迟到批准、双向Run互斥与关窗退出屏障。原1/2/3迁移SQL逐字核对不变。

受控退出审计的实际`-e`原文（仅将已拥有的临时路径白名单替换为本轮根，不改产品或仓库探针）：

```js
const assert=require('node:assert/strict');const fs=require('node:fs');const p=process.argv.at(-1);assert.ok(p.startsWith('/private/tmp/roundtable-deepseek-trial-main-g07g7i7p/test-tmp/roundtable-deepseek-trial-'));const D=require('./node_modules/better-sqlite3');const d=new D(p,{readonly:true,fileMustExist:true});try{assert.equal(process.versions.modules,'139');assert.deepEqual(d.pragma('integrity_check'),[{integrity_check:'ok'}]);assert.deepEqual(d.pragma('foreign_key_check'),[]);assert.equal(d.prepare('SELECT MAX(version) FROM schema_migrations').pluck().get(),4);const rs=d.prepare('SELECT data_json FROM controlled_trials ORDER BY rowid').pluck().all().map(JSON.parse);assert.equal(rs.length,2);assert.deepEqual(rs.map(v=>[v.state,v.outcome,v.reservedMicroCny,v.accountedMicroCny]),[['settled','completed',50000,206],['unknown','cancelled',50000,null]]);assert.deepEqual(rs[0].observedUsage,{inputTokens:71,outputTokens:8});assert.equal(rs[0].estimatedInputTokens,67);assert.equal(rs[1].text,'partial controlled fixture');assert.equal(d.prepare("SELECT COUNT(*) FROM controlled_trials WHERE state='reserved'").pluck().get(),0);assert.equal(d.prepare('SELECT COUNT(*) FROM workflow_runs').pluck().get(),0);assert.ok(!JSON.stringify(rs).includes('deepseek-trial-fake-key-only'));for(const f of [p,p+'-wal'])if(fs.existsSync(f))assert.ok(!fs.readFileSync(f).includes(Buffer.from('deepseek-trial-fake-key-only')));console.log('Controlled trial exit SQLite PASS: ABI139, integrity, v4, settled206/unknown50000, no implicit Run/retry or plaintext Key');}finally{d.close();}
```

## 真实生产入口与安全结论

- 受控profile：`test-tmp/roundtable-deepseek-trial-HaKDCP`。生产Main/CJS Preload/App和原生菜单实际加载，sandbox/contextIsolation/禁Node的Bridge验证通过。确认默认取消；取消时HTTP0/新增Key解密0/预留记录0。批准后仅1次固定`Reply OK.` user消息，`deepseek-flash`、`max_tokens:128`、`thinking:{type:"disabled"}`，绑定精确目标和当前Key revision；HTTP只映射自有fixture。
- 成功fixture的67输入估算与71/8回报usage分列，按冻结费率核算206micro-CNY，非真实账单。第二次独立批准后Stop确实关闭socket，部分文本保留、实际费用NULL、unknown全额50000micro预留；新进程零HTTP且在新确认/Key读取前拒绝下一次试验。没有自动重试、续写、恢复发送或未知预留清零。
- 普通严格DeepSeek生成在Key/网络前unsupported；未注入/注册counter或ModelPolicy。原生确认期间/请求期间普通Run互斥，报价后状态变化重核，纯受控活动关窗取消保持窗口，退出等待保存后再关DB。原R07/R08/R09全回归及生产恢复分别验证，不用Mock宣称真实Provider可用。
- 原R09 profile为`test-tmp/roundtable-r09-production-7krXH8`；58断言/12次本地HTTP，新进程5断言/HTTP0，退出审计15/9检查。R07/R08为`test-tmp/roundtable-r78-production-BPz5Ea`，首轮/重启均18条真桥字段断言＋原功能操作，配置/历史/公共上下文和假Key归属保持；退出只读完整性审计均通过。窄窗/主题只算原有限探针实际操作，不外推正式桌面E2E/跨平台。
- 6次GUI运行全部ready前隔离userData/sessionData/logs，启用mock-keychain并替换safeStorage全部方法为fake；Node/Chromium越界网络尝试均空，仅自有fixture可达。真实API Key/个人DB未访问，公网模型请求0；原离线预览的网络隔离和数据未操作。

## 失败与限制

本轮产品测试/构建/生产探针失败0。收尾增强临时汇总脚本时，误将三类探针的隔离字段统一为`isolationBeforeReady`，而受控探针实际为`isolatedBeforeReady`，真实KeyError/exit1。保留失败脚本与日志，按实际格式显式映射，严格要求true及mock-keychain/零真实Keychain计数后重新审计exit0；没有宽松默认、删除断言或改业务/测试，不机械重跑同版本1168。较早路径探查误读Node可执行文件、尝试不存在的额外rebuild脚本均非产品验证，后续实际使用package已有脚本，未改文件。

既有Xcode/FSEvents/clang、Zod/Rollup注解和macOS sandbox_extension警告保留于日志，不当作零警告或跨平台证据。候选历史失败/Keychain清理审批记录保持原样，不当本轮新执行。

首次治理提交因自动审批服务用量限制无法完成审查，Git命令未执行，没有进程退出码；这不是安全否决。用户明确“继续”后重新核对main仍为db97b95、仅原4份治理文档暂存、业务无变化，再通过原审批路径重试，不绕过审查。

本轮没有再次访问真实OS Keychain。此前28条自有服务/假Key后端证据仍仅覆盖旧KeyService/DBv3单模块；不能证明当前v4整App的真实后端、签名ACL连续性、锁定登录Keychain、OS授权对话框或用户真实凭据。真实公网调用、实际模型计数与账单、正式E2E/安装包/签名/公证/跨平台仍未验证，不实施R10/R11/R17或GitHub发布。

## 收尾与下一次授权

`python3 /private/tmp/roundtable-deepseek-trial-main-g07g7i7p/final-audit.py`最终exit0：18次主线业务检查源码/测试指纹与当前候选一致，原migration1–3和配置不变，3个隔离profile的6次GUI运行结果全部隔离且无越界网络，生产out（含原有.DS_Store记录）未再变化，17WT及非main HEAD/工作区/native inode/SHA与合并前一致。独立治理提交只改变4份文档；提交后再确认main干净及父为db97b95。

受控测试merged/verified仅说明获批实现与本轮fixture主线验收闭环；严格DEEPSEEK-TOKEN-01继续blocked。估算不是精确Token数，¥0.05预留不是服务商账单绝对硬上限；unknown不自动解除。价格窗口保持获批值：北京时间2026-10-19 00:00到期，未重新续期，过期必须另行核价审核。

第一次真实请求仍需要：用户另行明确批准精确官方目标/模型、单Agent、固定`Reply OK.`、流式/max_tokens128及¥0.05客户端预留风险；在专用测试profile确认可用Key保护后由用户自行在UI提供Key、确认endpoint/归属且无未知预留，再在原生菜单逐次确认。原离线预览不解除网络隔离，不能把本轮合并或原生菜单存在当付费授权。到此停止等待下一次授权。

## 日志SHA-256

| label | SHA-256 |
| --- | --- |
| dependency-inventory | `0d0f9b69c44f7426def79dcdeaeec744d00688c1648195f87f21c5ac82052908` |
| isolation | `b4ec76bf4306c38715c16a145f4308b0be98b196f1d201903a37120655a2f3c8` |
| electron-headers | `182c5b7679e940f9519ddc758dab22f83feee67b8e54e45fdafe67a44028b31d` |
| main-node-full | `d62c8d2e31860352243766a110a5609bd8ecd0b6114f2acfafa1cdc4f874c882` |
| main-typecheck | `072d84b3aeca2c2388fda023ba92238e18e00efb6d1f62e7e4fbf59670d88821` |
| main-build | `4ecebc27559b4309495e73cd3f78f5e01b5bb0d029d5d5f92305dc7591beb981` |
| main-node-native | `1b58a2e85e5dd0f96cf40f5816d64f49f27e773585ebfc92f81087b3d807f134` |
| main-electron-rebuild | `1f9faa3edbda53904eba7c852108c318279540fb646ad1bada7a0b74adafa4f7` |
| main-electron-native | `c2b6b2e7b27ba1b78a961237e43f68192a638b10d2bb5091f9c83ea2ae014e23` |
| main-electron-full | `30da99b3a1eaa910feab83ea21c2ec8ff24f653528f99714ce2ed2cbb0251ffe` |
| main-controlled-production | `63748f5eb555f1b74e70ea36024ecc03b368d51ed2542d4646dda8317f27d794` |
| main-controlled-restart | `03c8b2a6c6094460a31aa2630cfd21bb4dd20139a4554ae7e35dc2d35ef571b0` |
| main-controlled-exit | `2eb28df8313a36462bc1477c443fea6f116d3cdf88165206330469543bb3355b` |
| main-r09-production | `9b2d7170898f23271ae7d5431af957efcb3fea0c15ffa3b52c7d89ece0b5fb1f` |
| main-r09-exit | `e3ffc6fcbf6b8945d2ee6c5ed959684e86dc632d17e2b3ec78b3f9c236b56816` |
| main-r09-restart | `3e081472005fab5aead232424be2db5088b0d06818e767575a4a7b8f67bd76ef` |
| main-r09-restart-exit | `6d56740199857ff8a2266b638e3e9888731877fd75dfafa9d9c0a7efd1648c14` |
| main-r78-production | `ec65e39c322b185bb61cc7d2f549e0164a31f655119e11667dfc365dccf53bef` |
| main-r78-exit | `9501d685aa694eb6049ace25065557ff5787082423a7ab0b4b2f4b89b1de572b` |
| main-r78-restart | `e9aa58baa7806b5bba70d3e6944f0cb54693920cd15114e448978ea39c7d5a8b` |
| main-r78-restart-exit | `b4570e38c95322c9123fb1fb2da88afbd84d5ec76582369521ee698e87f1b27a` |
| final-audit-field-red | `3e804c3087ad21a76609c5096b13840e7604ddf7c99d89ecebe3e9913fe05dba` |
| final-audit-field-green | `82b0b138076c1f33f0878a37e4b956a355844e3fa53fc43bcbd2444d56f6b53e` |
