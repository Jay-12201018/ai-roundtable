# R02 环境阻塞修复与可复现性验证报告

2026-10-14，Asia/Shanghai，ENV-R02-INSTALL-01。**阻塞已解决，建议R02进入最终合并审核；未合main、未标R02 verified、未启动R03。** 本轮只更新治理/验证文档，没有改业务、已有tests、package/lock、pnpm版本或系统Node。

## 1. 真实Git与执行边界

开始时重新核对三个工作区全部干净：main `b690a1e2cefb485e81b35292bfb875bd19b88a2b`，原R02 `14f07a22b44bcd2459dd44f579230792033d9301`，集成 `8ec1d2b834ba94a5df60a21e0615d1fcb21fd48f` / `codex/integrate-r02`。沿用集成Worktree；未新增Worktree、删除分支、合并或重写历史。

完整阅读AGENTS/SPEC/STATUS/VALIDATION/ENVIRONMENT/上轮完整审核/R02任务；网络与pnpm内部路径由两个协作者独立只读/独有tmp实验，总控统一写文档。原生ObjectWrap风险与本次安装参数错误分别处理，不重复归因R02功能。

## 2. 已证实的根因，纠正上一轮结论

总控上一轮为设置超时，引入 `--config.fetch-timeout=60000`。**这个诊断参数被pnpm11.25.0保留为string，而非Number Schema转换后的number**；不是原项目需求或依赖声明的问题。

源码路径为已核验官方同版 `pnpm/dist/pnpm.mjs`：

| 行/阶段 | 本轮证据 |
| --- | --- |
| 326181–326198 | 通用 `--config.*` 用无数值类型表的nopt解析；独立parser探针证实rawTimeout为string；正式install `--fetch-timeout=5000`为number |
| 182043/182070 | Cafs读取已返回，队列已启动；本轮646返回verified=false，646入队，64实际开始fetch，pending64/size581，paused=false |
| 88527/88533 | async retry callback在try前调用AbortSignal.timeout(timeout)；115次下载/metadata的timeout为string，全部未到undici调用；唯一update-check使用默认number60000并成功HTTP200 |
| 88428–88431 | retry.attempt调用callback但不消费返回Promise；string导致ERR_INVALID_ARG_TYPE，外层fetch Promise没有完成 |
| 109391/109412/328773 | 未处理拒绝缓存到退出时才显示；空闲worker的MessagePort维持进程，形成无socket/无下载的长期等待 |

独立最小自检保留上述retry结构，断言number成功、string抛ERR_INVALID_ARG_TYPE、outer Promise仍未结：exit0。raw config get输出JSON字符串"5000"，正式install parser输出number5000（随后诊断主动停止exit1，不能算安装成功）。根因由源码、运行时取证、最小复现与修正后的两次完整安装共同确认。

这修正了上一轮“具体环境原因未定”的结论：错误参数由总控引入，不应继续把已排除的store/网络假设当阻塞。上轮失败退出码保留为真实历史，不能改写成PASS。

### 排除与区分的原因

- worker：648请求均有648回复；单/12worker原Cafs探针39/50–66ms成功。原PQueue提交646个stub全部完成，不代表业务下载成功，但排除简单worker无回复/基础queue死锁。
- 不是仅metadata200：better-sqlite3、electron npm包、esbuild两版及darwin-arm64两版共6个实际tarball，curl/官方24.18.1 https.get/内建fetch各6/6全量HTTP200、SHA512与lock匹配，共18次下载；落盘复核通过。完整安装也实际下载并成功。
- 已安装pnpm11.25.0的bin入口、主bundle、worker、package.json与官方同版5,116,259B tarball逐字节一致，官方SHA512通过；不支持本地工具损坏假设。
- 项目/用户/实际pnpm全局候选配置未发现显式registry认证或进程proxy/extra CA设置；有效registry为官方npm。宿主系统代理127.0.0.1:7890存在，curl实际proxy_used=0，Node TLS authorized=true；没有修改代理/DNS/证书。沙箱内curl6/Node ENOTFOUND与获准后成功分别记录，不能混同宿主故障。
- 默认shell pnpm为Codex fallback，硬编码其Node，单改PATH不保证pnpm runtime。取证boot和最终临时shim均明确使用官方24.18.1；本次没有错用fallback Node。
- pnpr-server无显式配置，同版packageManager直接跳过版本切换；未发现pnpr panic的关联证据。没有关闭年龄/完整性策略或扩大并发。

## 3. 最小修复与受控版本

只纠正验证命令：省略raw数值覆盖，或使用正式 `--fetch-timeout=60000 --fetch-retries=1`。不用registry绕法、不开额外并发、不升级任何版本。正式规则写入ENVIRONMENT与VALIDATION。

| 项目 | 本轮真实受控值/来源 |
| --- | --- |
| 平台 | macOS27.0.1/build26A434，arm64，Apple clang21.0.0 |
| Node工具runtime | nodejs.org官方24.18.1 darwin-arm64，ABI137；上轮已核官方archive SHA，本轮明确选择并检查实际process版本/编译日志 |
| Node headers/config | 同一个完整24.18.1 runtime/include/node/common.gypi；gyp日志/arm64/ABI137实际确认，不跨补丁混用 |
| pnpm | 11.25.0，官方同版4文件字节/hash复核；packageManager不改，lock格式9.0 |
| Corepack/npm | 官方runtime中的Corepack0.35.0/npm11.16.0，--version exit0；未enable/prepare/全局安装，本轮不通过Corepack调度 |
| better-sqlite3 | 12.11.1，原锁版本，Node与Electron分别编译 |
| Electron | 38.8.6，实际嵌入Node22.22.0、ABI139/arm64；从源码重建，config.nodedir指向38.8.6 headers |
| 验证依赖 | TypeScript5.9.3、Vitest3.2.7、electron-vite4.0.1、electron-builder26.15.3，均来自原lock |

已确认Node24.21.0 ObjectWrap异常的历史5/5独立复现仍保留，本轮不宣称修复上游Node，也不把它当业务缺陷；受控环境选择24.18.1。

原文件SHA256两次安装前后均相同：

- package.json：`2e1cde38189630518c7ba60eb66495e0c4c6a4871a31f1590c5b475c27fd0335`
- pnpm-lock.yaml：`3752425b23f83898811def6f289a3154733e71a981a47d08840e841b7c6b7ba3`
- pnpm-workspace.yaml：`77832f09aa15f28c96d01acf7e613a6ed5052335213af2a15793ee17cbdf8276`

## 4. 干净安装与完整复验的实际命令/退出码

本轮验证根为 `/private/tmp/roundtable-r02-env-4v7f8io7`，以下简写R02_TMP；日志和逐命令JSON均在该根。第一安装目录clean-project、第二repro-project，起点仅上述3个原文件，node_modules/store/cache均不存在。**从未复制旧node_modules**；第二安装成功后才复制受检8ec1d2b的其余Git tracked源文件。两次native文件与集成旧依赖inode各不相同。

实际PATH最前为临时shim：exec官方24.18.1 Node和已核验pnpm11.25.0/bin/pnpm.mjs，确保递归pretest也是该runtime。最终第二次安装/测试无NODE_OPTIONS诊断hook。Node阶段另设完整runtime的npm_config_nodedir/build_from_source=true，npm/Electron缓存在验证根；Electron阶段清除Node nodedir，以Electron38.8.6 headers编译。目录包设独立ELECTRON_BUILDER_CACHE、CSC_IDENTITY_AUTO_DISCOVERY=false和identity=-，不使用用户证书。

外部Python subprocess timeout逐命令监督，超时记124，不把预期值当执行结果。

```sh
# 第一次，300s上限；监控worker/HTTP但不改pnpm行为，使用默认数字超时。
pnpm --config.store-dir=$R02_TMP/clean-store --config.cache-dir=$R02_TMP/clean-cache --config.state-dir=$R02_TMP/clean-state install --frozen-lockfile --reporter=append-only
# 第二次，300s上限；没有诊断注入，正式数值选项。
pnpm --config.store-dir=$R02_TMP/repro-store --config.cache-dir=$R02_TMP/repro-cache --config.state-dir=$R02_TMP/repro-state install --frozen-lockfile --fetch-timeout=60000 --fetch-retries=1 --reporter=append-only
```

| cwd=第二次全新安装目录；实际命令 | 上限s | Exit/实际结果 | 日志 |
| --- | --- | --- | --- |
| 第一次上述frozen install | 300 | 0，22.79s，全部安装脚本启用 | clean-install.log |
| 第二次上述frozen install | 300 | 0，37.01s，全部安装脚本启用 | repro-install.log |
| `pnpm list --depth=0 --json`及原3文件字节/self-check | 20 | 0，32个直接依赖齐全，SQLite/Electron准确版本、lock不变 | clean-dependency-list.log/repro-manifest-integrity.json |
| `pnpm run native:node` | 120 | 0，11.316s，源码编译/严格同版headers，ABI137 | clean-native-node.log/node-build-config.gypi |
| `node $R02_TMP/sqlite-probe.cjs` | 30 | 0，内存建表/写/读/close | clean-sqlite-memory.log |
| `node $R02_TMP/sqlite-probe.cjs --stress`重复5次 | 每次30 | 每次0，300000次prepare/get，均正常退出 | clean-sqlite-stress-1…5.log/sqlite-checks.json |
| `pnpm exec vitest run tests/unit/contracts --reporter=dot` | 60 | 0，6文件94/94 | clean-contracts.log |
| `pnpm run test --reporter=dot`（含源码重编译pretest） | 120 | 0，18文件228/228，无skip/errors，默认pool | clean-full-regression.log |
| `pnpm run typecheck` | 60 | 0，1.897s | clean-typecheck.log |
| `pnpm run build` | 60 | 0，3.14s，Main/CJS Preload/Renderer | clean-build.log |
| `pnpm run native:electron --build-from-source` | 150 | 0，14.494s，Electron源码重建/ABI139 | clean-native-electron.log/electron-build-config.gypi |
| `ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron $R02_TMP/sqlite-probe.cjs` | 30 | 0，实际Electron38.8.6/ABI139/内存SQL | clean-electron-abi.log |
| `./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r01-electron.cjs`（未设RunAsNode） | 45 | 0，1.73s，实际生产页面/Preload/IPC | clean-electron-startup.log |
| `ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r01-sqlite.cjs /var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-r01-electron-GwZOrr/probe-result.json` | 30 | 0，退出后只读临时DB | clean-electron-shutdown-sqlite.log |
| `pnpm exec electron-builder --dir --mac --arm64 --config.mac.identity=-` | 240 | 0，18.166s，beforeBuild/afterPack，Packaged SQLite PASS ABI139，ad-hoc签名 | clean-directory-pack.log |
| `node $R02_TMP/check-asar.cjs`（修正工具模块解析后） | 30 | 0，Main/Renderer/CJS Preload与out字节一致、entry正确/unpacked SQLite存在 | clean-asar-paths-corrected.log |
| `ELECTRON_RUN_AS_NODE=1 "$R02_TMP/repro-project/dist/mac-arm64/AI Roundtable.app/Contents/MacOS/AI Roundtable" $R02_TMP/packaged-sqlite.cjs` | 30 | 0，最终签名后从app.asar内require SQLite、内存读写，38.8.6/ABI139/arm64 | clean-packaged-sqlite.log |

SQL临时脚本只用:memory:，所有压力过程均断言每次SELECT结果并finally close，记录最终进程退出，不只采最后一条PASS。包内SQL脚本从process.execPath计算Resources/app.asar/node_modules/better-sqlite3，无Main导入。

## 5. 数据隔离、安全及未验证项

实际Probe在ready/Main导入前将userData/sessionData/logs设为本次新目录roundtable-r01-electron-GwZOrr，所有网络阻断，仅Mock。sandbox/contextIsolation/webSecurity=true、NodeIntegration=false，App真实渲染、Node globals缺失；12个事件接收、重复取消订阅后无事件；无Preload/console/CSP错误/网络请求。构建及ASAR路径为唯一out/preload/index.cjs。实际quit后只读DB核对paused→cancelled，messages/turns/requestId不变、Key/Provider表为空。未访问真实用户DB/Key或付费Provider。

首次/失败检查也保留：60秒普通trace、40秒内存阶段trace、12秒网络阶段trace均124，对应错误raw数值配置；离线控制0.52秒exit1/ERR_PNPM_NO_OFFLINE_META表明policy启动，不证明store或网络故障。独立parser人为停止exit1、string/number自检exit0分别记录，不算真实安装。ASAR临时guard初次exit1为错误从electron-builder虚拟入口寻找其间接@electron/asar；按pnpm真实包路径转到app-builder-lib依赖后exit0，未改任何业务/依赖/断言。不是打包产物失败。源码编译有libc++平台/函数指针告警，构建有Zod PURE注解告警，Probe有sandbox_extension文件提示；实际断言与最终exit通过。目录包有默认icon、依赖重复引用、ad-hoc签名/公证跳过提示，如实保留。

正式Electron E2E、打包主入口完整GUI/安装/升级、Windows/Linux、受信发布签名/公证、真实Provider/Key未验证。有限开发目录Probe和目录包内SQL不能外推以上项目。本机两次干净安装通过不保证未来网络总可用，外部超时/真实来源与版本核验仍需保留。

## 6. 文件、提交与集成建议

仅5文档：docs/ENVIRONMENT.md、docs/VALIDATION.md、docs/STATUS.md、docs/verification/2026-10-14-r02-integration.md（历史更正指针）及本报告。没有源码/测试/Shared/数据库Schema/迁移/package/lock改动；临时diagnostic、下载、依赖、DB/profile、out/dist与原始日志不入库。

ENV-R02-INSTALL-01关闭，R02为review，**建议进入最终合并审核**；无需用户批准依赖升级/全局配置修改，因为没有提出或执行这些变更。最终合main仍需用户授权，合并后须main新鲜复验；R03继续blocked/未授权。本轮文档独立Commit SHA与main/原R02/集成工作区最终状态在交付现场Git报告中给出，不能将8ec1d2b当本轮文档提交。

## 7. 证据索引与重现条件

根目录的每个*-result.json记录实际argv/cwd/timeout/mode/exit/耗时；日志在logs，阶段取证为trace.jsonl/memory-trace.jsonl/network-stage-trace.jsonl。网络独立证据在 `/private/tmp/roundtable-r02-network-v5u3mpn0`：report.md、execution-manifest.json、metadata-results/curl-download-results/node-download-results/node-fetch-results.json、pnpm-provenance-comparison.json。内部最小复现在 `/private/tmp/roundtable-pnpm-internals-3Fg8ow`：timeout-type-probe.mjs、worker-probe.mjs、queue-probe.mjs、parse-type-trace.mjs。它们为本轮现场证据，未来不依赖临时目录永久存在，应按ENVIRONMENT在新的隔离目录重新验证。

官方pnpm同版主bundle SHA256 `ddc64218bc85fb88d28b5def06eb01fafb39cb67f7a9465ce736456658cc7f11`，bin入口 `ff3224d46b47fbb24a7e9fe15fededef7e00892d07d4e376b6762d4899906bfd`；公开Node archive SHA与原生上游风险保留在ENVIRONMENT。实际环境来源/版本和本文命令构成受检边界，不依赖Downloads或历史PASS。
