# DeepSeek 单次受控测试：实际命令台账

2026-10-18；候选 `codex/deepseek-controlled-trial`，基线 `ae5c24c6dd1410aedba6ef31894470b7cb668c8a`。本台账只记录本轮实际执行，不用中间 PASS 替代最终结果。完整交付见[报告](2026-10-18-deepseek-controlled-trial.md)。

## 受控执行环境

- cwd：`/Users/zhangwenjie/.codex/worktrees/deepseek-controlled-trial/AI交互`。临时证据根目录：`/private/tmp/roundtable-deepseek-trial-20261018`；原始日志、私有 SQLite 和 JSON receipt 仅留临时目录，未提交仓库。临时证据未来可能被系统清理。
- Node24.18.1/darwin-arm64/ABI137，runtime 与同一发行包 headers；pnpm11.25.0。Electron38.8.6/内嵌Node22.22.0/ABI139使用严格对应 headers，串行重建，不共享其他 Worktree 可变依赖。
- 独立 store/cache/gyp/TMPDIR/XDG、空 npmrc；`run-check.py` 明确清理旧 Node 编译变量。node模式设同版 runtime nodedir/build_from_source；electron模式设38.8.6 headers；electron-node模式只设置 ELECTRON_RUN_AS_NODE=1。每份 receipt 保存精确环境覆盖、argv、时间、外部上限、退出码、日志 SHA 和执行前后源码指纹。
- 原始 package/lock/workspace 不变；空 node_modules、冻结离线安装646包（copy模式、side-effects-cache=false）。不是复制 node_modules；不是本轮冷缓存公网下载验收。没有 raw 数字 fetch 配置、全局 Node 更改或依赖升级。
- 生产探针 ready 前隔离 userData/sessionData/logs，mock-keychain及全 fake safeStorage，Node/Chromium双网络阻断；受控生产链路只把精确官方目标映射到本任务 localhost HTTP fixture。未调用真实模型。OS Keychain 特例另见下表，只有新 UUID 服务和假 Key。

## 最终版本结果

| receipt label | 实际结果 | exit |
| --- | --- | ---: |
| node-final-2 | 81文件1168/1168，含新专项；pretest严格Node源码重编译 | 0 |
| type-final-3 / build-final-2 | strict；Main/CJS Preload/Renderer生产构建 | 0 / 0 |
| node-native-final-2 | ABI137，100内存DB/10000行，自然退出 | 0 |
| electron-rebuild-final-2 / electron-native-final-2 | 源码重建ABI139；100内存DB/10000行，自然退出 | 0 / 0 |
| electron-final-2 | 81文件1168/1168，无skip | 0 |
| controlled-production-final-3 | 42条具名断言，2次本地fixture请求；逐次取消/确认、真实菜单/桥、互斥、关窗、Stop、核算和部分输出 | 0 |
| controlled-restart-final-2 / controlled-exit-final-2 | 重启24断言/HTTP0；只读v4完整性、206micro结算/50000未知预留、无明文Key | 0 / 0 |
| r09-production-final-2 / r09-exit-final-2 | 原生产R09链路57断言/12次本地HTTP；退出只读SQLite15检查 | 0 / 0 |
| r09-restart-final-2 / r09-restart-audit-final-2 | 新进程5断言/HTTP0；退出只读SQLite9检查 | 0 / 0 |
| mutual-green | 两文件39/39；最终全量包含相同回归输入 | 0 |
| r78-production-regression / r78-exit-version-red / r78-exit-version-green | 原生产UI/18真桥断言通过；旧审计硬编码v3真实失败；只改精确ledger期望为v4后同profile完整退出审计通过 | 0 / 1 / 0 |
| r78-restart-final / r78-restart-exit-final | 新进程生产UI/18真桥断言及配置历史恢复；只读退出审计 | 0 / 0 |

新DeepSeek专项5文件共59个新增用例（estimate21/service19/API2/migration11/mutual6），均在最终完整回归执行；旧DeepSeek32及生命周期新增4也包含在1168中。重叠组不相加。旧中间Node/Electron1160为历史，不当最终成绩。

## 原始逐命令清单（按实际UTC开始时间）

下列命令由 `python3 <证据根>/run-check.py <label> <timeoutSeconds> <mode> <argv...>` 有界执行。表内 command 是实际子进程argv的 shell 引用表示；包含脚本体的 `-e` 命令原样保留。UTC记录不改写成伪造的当前时间。

### env-cache

UTC `2026-10-17T20:22:39.985622+00:00` → `2026-10-17T20:22:43.755581+00:00`；mode `tool`，上限180.0秒，耗时3.71秒；exit **0**，timedOut `false`。

```sh
python3 /private/tmp/roundtable-deepseek-trial-20261018/env-seed-cache.py
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/env-cache.json`；log SHA-256 `c0f9b81f9ea1dcf8a63a97219e23c30f388671877091d2b0b3f1bfbdb728337e`。

### env-install

UTC `2026-10-17T20:23:04.793541+00:00` → `2026-10-17T20:23:21.374422+00:00`；mode `node`，上限300.0秒，耗时16.534秒；exit **0**，timedOut `false`。

```sh
/private/tmp/roundtable-deepseek-trial-20261018/bin/pnpm install --frozen-lockfile --offline --package-import-method=copy --side-effects-cache=false --reporter=append-only
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/env-install.json`；log SHA-256 `2b2397c62373939349cc580ec31a1d36e1842fcc717eb34d95298300cc699305`。

### controlled-red

UTC `2026-10-17T20:23:53.700965+00:00` → `2026-10-17T20:23:59.758365+00:00`；mode `node`，上限150.0秒，耗时6.012秒；exit **1**，timedOut `false`。

```sh
/private/tmp/roundtable-deepseek-trial-20261018/bin/pnpm exec vitest run --reporter=dot
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/controlled-red.json`；log SHA-256 `78735c4ed0e91154393d8dff65f6d37f34241a298d3f792361540796abf3c9cc`。

实际关键输出：

```text
Test Files  2 failed | 76 passed (78)
Tests  2 failed | 1105 passed (1107)
Duration  5.53s (transform 1.52s, setup 0ms, collect 10.41s, tests 17.59s, environment 6.88s, prepare 3.55s)
```

### trial-typecheck-1

UTC `2026-10-17T20:26:55.299673+00:00` → `2026-10-17T20:26:57.461822+00:00`；mode `node`，上限90.0秒，耗时2.111秒；exit **2**，timedOut `false`。

```sh
/private/tmp/roundtable-deepseek-trial-20261018/bin/pnpm run typecheck
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/trial-typecheck-1.json`；log SHA-256 `21da3df211f7db7081d4377ee11c3b8c1a860292abbc96b69711b97a0e8d0b6f`。

### trial-green-1

UTC `2026-10-17T20:27:51.304491+00:00` → `2026-10-17T20:27:52.819688+00:00`；mode `node`，上限120.0秒，耗时1.466秒；exit **0**，timedOut `false`。

```sh
/private/tmp/roundtable-deepseek-trial-20261018/bin/pnpm exec vitest run tests/integration/deepseek --reporter=dot
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/trial-green-1.json`；log SHA-256 `683dbbad745e9888ccf8994d5bde9bcc2fdaeab5051348f9da80e2ac33334076`。

实际关键输出：

```text
Test Files  3 passed (3)
Tests  55 passed (55)
Duration  968ms (transform 164ms, setup 0ms, collect 334ms, tests 484ms, environment 216ms, prepare 113ms)
```

### migration-v4-red

UTC `2026-10-17T20:29:05.659419+00:00` → `2026-10-17T20:29:07.164026+00:00`；mode `node`，上限90.0秒，耗时1.456秒；exit **1**，timedOut `false`。

```sh
/private/tmp/roundtable-deepseek-trial-20261018/bin/pnpm exec vitest run tests/integration/deepseek/migrationV4.test.ts --reporter=dot
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/migration-v4-red.json`；log SHA-256 `bfc34986dd7ba9597e914b0e72db03d8249ab94d0eb8c332228873ec453290ac`。

实际关键输出：

```text
Test Files  1 failed (1)
Tests  6 failed | 3 passed (9)
Duration  1000ms (transform 54ms, setup 0ms, collect 108ms, tests 713ms, environment 0ms, prepare 56ms)
```

### pending-authorization-red

UTC `2026-10-17T20:29:14.872851+00:00` → `2026-10-17T20:29:45.755734+00:00`；mode `node`，上限40.0秒，耗时30.834秒；exit **1**，timedOut `false`。

```sh
/private/tmp/roundtable-deepseek-trial-20261018/bin/pnpm exec vitest run tests/integration/deepseek/controlledService.test.ts -t 'Stop invalidates|shutdown does not' --reporter=dot
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/pending-authorization-red.json`；log SHA-256 `0cc5b9819bb0cc7bedc77ae2f20a0c37f1c5e2b4106ea62db49072ade0afee04`。

实际关键输出：

```text
Test Files  1 failed (1)
Tests  2 failed | 17 skipped (19)
Duration  30.36s (transform 80ms, setup 0ms, collect 147ms, tests 30.02s, environment 0ms, prepare 62ms)
```

### migration-v4-red-confirmed

UTC `2026-10-17T20:29:41.691406+00:00` → `2026-10-17T20:29:43.468705+00:00`；mode `node`，上限90.0秒，耗时1.738秒；exit **1**，timedOut `false`。

```sh
/private/tmp/roundtable-deepseek-trial-20261018/bin/pnpm exec vitest run tests/integration/deepseek/migrationV4.test.ts --reporter=dot
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/migration-v4-red-confirmed.json`；log SHA-256 `8d2a220f535383a9649160085bbc5936fde7e26a1b7cfd463788f86b44d1af1f`。

实际关键输出：

```text
Test Files  1 failed (1)
Tests  4 failed | 5 passed (9)
Duration  1.27s (transform 53ms, setup 0ms, collect 117ms, tests 969ms, environment 0ms, prepare 57ms)
```

### controlled-service-green-1

UTC `2026-10-17T20:30:04.502502+00:00` → `2026-10-17T20:30:25.665546+00:00`；mode `node`，上限90.0秒，耗时21.118秒；exit **1**，timedOut `false`。

```sh
/private/tmp/roundtable-deepseek-trial-20261018/bin/pnpm exec vitest run tests/integration/deepseek/controlledService.test.ts --reporter=dot
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/controlled-service-green-1.json`；log SHA-256 `c8147eca9a80ad2eb8c35557e9889de78509903503950d77a40002330ec3f10b`。

实际关键输出：

```text
Test Files  1 failed (1)
Tests  1 failed | 18 passed (19)
Duration  20.54s (transform 80ms, setup 0ms, collect 147ms, tests 20.19s, environment 0ms, prepare 55ms)
```

### migration-v4-red-schema

UTC `2026-10-17T20:30:14.837666+00:00` → `2026-10-17T20:30:16.608337+00:00`；mode `node`，上限90.0秒，耗时1.73秒；exit **1**，timedOut `false`。

```sh
/private/tmp/roundtable-deepseek-trial-20261018/bin/pnpm exec vitest run tests/integration/deepseek/migrationV4.test.ts --reporter=dot
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/migration-v4-red-schema.json`；log SHA-256 `6b7fbf35909ee4997472c2ef0952dfa3e8de358ac8c84fc5725fc61a9cd608ef`。

实际关键输出：

```text
Test Files  1 failed (1)
Tests  2 failed | 7 passed (9)
Duration  1.28s (transform 54ms, setup 0ms, collect 104ms, tests 987ms, environment 0ms, prepare 64ms)
```

### migration-existing-green

UTC `2026-10-17T20:30:27.914486+00:00` → `2026-10-17T20:30:29.354644+00:00`；mode `node`，上限90.0秒，耗时1.4秒；exit **0**，timedOut `false`。

```sh
/private/tmp/roundtable-deepseek-trial-20261018/bin/pnpm exec vitest run tests/unit/database.test.ts tests/unit/persistence/integrity.test.ts tests/integration/persistence/legacyMigration.test.ts tests/integration/persistence/migrationV2.test.ts tests/integration/configuration/migrationV3.test.ts --reporter=dot
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/migration-existing-green.json`；log SHA-256 `42f02c48fed05a1a225714bb66f8d1e3c5648559b72d77796d790602ebeec00b`。

实际关键输出：

```text
Test Files  5 passed (5)
Tests  43 passed (43)
Duration  963ms (transform 196ms, setup 0ms, collect 648ms, tests 1.69s, environment 257ms, prepare 179ms)
```

### trial-typecheck-2

UTC `2026-10-17T20:30:52.223478+00:00` → `2026-10-17T20:30:54.218354+00:00`；mode `node`，上限90.0秒，耗时1.955秒；exit **0**，timedOut `false`。

```sh
/private/tmp/roundtable-deepseek-trial-20261018/bin/pnpm run typecheck
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/trial-typecheck-2.json`；log SHA-256 `072d84b3aeca2c2388fda023ba92238e18e00efb6d1f62e7e4fbf59670d88821`。

### migration-v4-red-index-shape

UTC `2026-10-17T20:31:01.685146+00:00` → `2026-10-17T20:31:03.946671+00:00`；mode `node`，上限90.0秒，耗时2.217秒；exit **0**，timedOut `false`。

```sh
/private/tmp/roundtable-deepseek-trial-20261018/bin/pnpm exec vitest run tests/integration/deepseek/migrationV4.test.ts --reporter=dot
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/migration-v4-red-index-shape.json`；log SHA-256 `245ce61d0b3566dbc4c651965f2c29f341098f586bbd4b78ac2115d836af140c`。

实际关键输出：

```text
Test Files  1 passed (1)
Tests  11 passed (11)
Duration  1.81s (transform 53ms, setup 0ms, collect 103ms, tests 1.52s, environment 0ms, prepare 45ms)
```

### migration-all-green

UTC `2026-10-17T20:31:16.464628+00:00` → `2026-10-17T20:31:19.291931+00:00`；mode `node`，上限90.0秒，耗时2.778秒；exit **0**，timedOut `false`。

```sh
/private/tmp/roundtable-deepseek-trial-20261018/bin/pnpm exec vitest run tests/unit/database.test.ts tests/unit/persistence/integrity.test.ts tests/integration/persistence/legacyMigration.test.ts tests/integration/persistence/migrationV2.test.ts tests/integration/configuration/migrationV3.test.ts tests/integration/deepseek/migrationV4.test.ts --reporter=dot
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/migration-all-green.json`；log SHA-256 `9c60b524af048bd9a00826bc0fc43c7027d80d3ba8d02230b38cab23f5adc755`。

实际关键输出：

```text
Test Files  6 passed (6)
Tests  54 passed (54)
Duration  2.32s (transform 246ms, setup 0ms, collect 939ms, tests 4.10s, environment 166ms, prepare 258ms)
```

### node-full-1

UTC `2026-10-17T20:32:42.259687+00:00` → `2026-10-17T20:33:03.540935+00:00`；mode `node`，上限150.0秒，耗时21.228秒；exit **0**，timedOut `false`。

```sh
/private/tmp/roundtable-deepseek-trial-20261018/bin/pnpm exec vitest run --reporter=dot
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/node-full-1.json`；log SHA-256 `4a3579fef375fab52cb5779f48c63f4500a76862f9e4ea781da4d52f1505b1ba`。

实际关键输出：

```text
Test Files  80 passed (80)
Tests  1160 passed (1160)
Duration  20.71s (transform 1.46s, setup 0ms, collect 9.79s, tests 38.86s, environment 6.55s, prepare 3.35s)
```

### final-build

UTC `2026-10-17T20:33:35.213831+00:00` → `2026-10-17T20:33:38.413329+00:00`；mode `node`，上限150.0秒，耗时3.153秒；exit **0**，timedOut `false`。

```sh
/private/tmp/roundtable-deepseek-trial-20261018/bin/pnpm run build
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/final-build.json`；log SHA-256 `0436baed40770ca4565aff37e419609a5e0e20c9515001e1c5bd7da17f6c940c`。

### final-node-native

UTC `2026-10-17T20:33:37.035840+00:00` → `2026-10-17T20:33:37.219591+00:00`；mode `node`，上限45.0秒，耗时0.085秒；exit **0**，timedOut `false`。

```sh
/private/tmp/roundtable-deepseek-trial-20261018/bin/node tests/probes/r09-native.cjs
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/final-node-native.json`；log SHA-256 `1b58a2e85e5dd0f96cf40f5816d64f49f27e773585ebfc92f81087b3d807f134`。

实际关键输出：

```text
{"status":"PASS","runtime":"node","node":"24.18.1","abi":"137","arch":"arm64","databases":100,"rows":10000,"naturalExit":true}
```

### final-typecheck

UTC `2026-10-17T20:33:37.078100+00:00` → `2026-10-17T20:33:39.187993+00:00`；mode `node`，上限90.0秒，耗时2.063秒；exit **0**，timedOut `false`。

```sh
/private/tmp/roundtable-deepseek-trial-20261018/bin/pnpm run typecheck
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/final-typecheck.json`；log SHA-256 `072d84b3aeca2c2388fda023ba92238e18e00efb6d1f62e7e4fbf59670d88821`。

### final-electron-headers

UTC `2026-10-17T20:33:51.125809+00:00` → `2026-10-17T20:33:51.337477+00:00`；mode `tool`，上限45.0秒，耗时0.171秒；exit **0**，timedOut `false`。

```sh
python3 /private/tmp/roundtable-deepseek-trial-20261018/env-prepare-electron-headers.py
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/final-electron-headers.json`；log SHA-256 `23e706efab21eed33d7f04bb61140b5d8f5e73a7314ff58322d710a88c916075`。

### final-electron-rebuild

UTC `2026-10-17T20:33:59.956343+00:00` → `2026-10-17T20:34:10.844241+00:00`；mode `electron`，上限180.0秒，耗时10.846秒；exit **0**，timedOut `false`。

```sh
/private/tmp/roundtable-deepseek-trial-20261018/bin/pnpm run native:electron
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/final-electron-rebuild.json`；log SHA-256 `1f9faa3edbda53904eba7c852108c318279540fb646ad1bada7a0b74adafa4f7`。

### final-electron-native

UTC `2026-10-17T20:34:56.196672+00:00` → `2026-10-17T20:34:57.389999+00:00`；mode `electron-node`，上限45.0秒，耗时1.143秒；exit **0**，timedOut `false`。

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r09-native.cjs
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/final-electron-native.json`；log SHA-256 `c2b6b2e7b27ba1b78a961237e43f68192a638b10d2bb5091f9c83ea2ae014e23`。

实际关键输出：

```text
{"status":"PASS","runtime":"electron","node":"22.22.0","electron":"38.8.6","abi":"139","arch":"arm64","databases":100,"rows":10000,"naturalExit":true}
```

### final-electron-full

UTC `2026-10-17T20:35:07.728065+00:00` → `2026-10-17T20:35:28.901326+00:00`；mode `electron-node`，上限150.0秒，耗时21.126秒；exit **0**，timedOut `false`。

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron node_modules/vitest/vitest.mjs run --reporter=dot
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/final-electron-full.json`；log SHA-256 `0d44ce6eb272e5de6746ad2a22d611e920810d69008bf09dbb2456fba54a5672`。

实际关键输出：

```text
Test Files  80 passed (80)
Tests  1160 passed (1160)
Duration  20.68s (transform 1.43s, setup 0ms, collect 7.42s, tests 34.57s, environment 5.25s, prepare 2.83s)
```

### r09-production-regression

UTC `2026-10-17T20:35:32.558879+00:00` → `2026-10-17T20:35:37.395593+00:00`；mode `electron`，上限270.0秒，耗时4.788秒；exit **0**，timedOut `false`。

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r09-electron.cjs
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/r09-production-regression.json`；log SHA-256 `0cdb071bfd7c4bcfcbae7b8f61359c174be4f792d030c5cee258ad77de0700b1`。

实际关键输出：

```text
R09_PRODUCTION_PASS {"resultPath":"/private/tmp/roundtable-deepseek-trial-20261018/test-tmp/roundtable-r09-production-a085rd/r09-first.json","manifestPath":"/private/tmp/roundtable-deepseek-trial-20261018/test-tmp/roundtable-r09-production-a085rd/r09-manifest.json","requests":12,"assertions":59,"liveApi":false}
```

### controlled-production-1

UTC `2026-10-17T20:36:05.774402+00:00` → `2026-10-17T20:36:06.433639+00:00`；mode `electron`，上限180.0秒，耗时0.614秒；exit **1**，timedOut `false`。

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/deepseek-trial-electron.cjs
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/controlled-production-1.json`；log SHA-256 `da2c95b3d33513638610883669c93881786081b538d6b174d783ee23d6e23465`。

### r09-restart

UTC `2026-10-17T20:36:22.339846+00:00` → `2026-10-17T20:36:23.111943+00:00`；mode `electron`，上限120.0秒，耗时0.726秒；exit **0**，timedOut `false`。

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r09-electron.cjs --restart /private/tmp/roundtable-deepseek-trial-20261018/test-tmp/roundtable-r09-production-a085rd/r09-manifest.json
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/r09-restart.json`；log SHA-256 `4823a9f8b5eaa4b53eb6780c88d890b860c6c8661df2a25b04a4b32e5861323e`。

实际关键输出：

```text
R09_PRODUCTION_PASS {"resultPath":"/private/tmp/roundtable-deepseek-trial-20261018/test-tmp/roundtable-r09-production-a085rd/r09-restart.json","manifestPath":"/private/tmp/roundtable-deepseek-trial-20261018/test-tmp/roundtable-r09-production-a085rd/r09-manifest.json","requests":0,"assertions":5,"liveApi":false}
```

### r09-exit-audit

UTC `2026-10-17T20:36:24.452776+00:00` → `2026-10-17T20:36:24.609857+00:00`；mode `electron-node`，上限45.0秒，耗时0.111秒；exit **0**，timedOut `false`。

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r09-sqlite.cjs /private/tmp/roundtable-deepseek-trial-20261018/test-tmp/roundtable-r09-production-a085rd/r09-first.json
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/r09-exit-audit.json`；log SHA-256 `e3ffc6fcbf6b8945d2ee6c5ed959684e86dc632d17e2b3ec78b3f9c236b56816`。

实际关键输出：

```text
{"status":"PASS","phase":"first","checks":15,"completedAttempts":3,"explicitRepeatAttempts":3,"actualElectronAbi":"139","readOnlyAudit":true}
```

### controlled-production-2

UTC `2026-10-17T20:36:31.689300+00:00` → `2026-10-17T20:36:32.358717+00:00`；mode `electron`，上限180.0秒，耗时0.618秒；exit **0**，timedOut `false`。

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/deepseek-trial-electron.cjs
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/controlled-production-2.json`；log SHA-256 `e939ccd73a923fdbbccd6c9562e90f58402cf31a790e03f57c35cad0b9c59a36`。

实际关键输出：

```text
DEEPSEEK_TRIAL_PRODUCTION_PASS {"resultPath":"/private/tmp/roundtable-deepseek-trial-20261018/test-tmp/roundtable-deepseek-trial-OxKo6E/trial-first.json","manifestPath":"/private/tmp/roundtable-deepseek-trial-20261018/test-tmp/roundtable-deepseek-trial-OxKo6E/trial-manifest.json","assertions":39,"localFixtureRequests":2,"liveApi":false}
```

### controlled-restart-1

UTC `2026-10-17T20:36:38.420761+00:00` → `2026-10-17T20:36:38.970577+00:00`；mode `electron`，上限180.0秒，耗时0.511秒；exit **0**，timedOut `false`。

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/deepseek-trial-electron.cjs --restart /private/tmp/roundtable-deepseek-trial-20261018/test-tmp/roundtable-deepseek-trial-OxKo6E/trial-manifest.json
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/controlled-restart-1.json`；log SHA-256 `e4dd77b36d2c9d1c9da39d48477e0dabb01d92d70fe37bb9b0b985d4fb6cae22`。

实际关键输出：

```text
DEEPSEEK_TRIAL_PRODUCTION_PASS {"resultPath":"/private/tmp/roundtable-deepseek-trial-20261018/test-tmp/roundtable-deepseek-trial-OxKo6E/trial-restart.json","manifestPath":"/private/tmp/roundtable-deepseek-trial-20261018/test-tmp/roundtable-deepseek-trial-OxKo6E/trial-manifest.json","assertions":24,"localFixtureRequests":0,"liveApi":false}
```

### controlled-exit-sqlite

UTC `2026-10-17T20:37:09.657821+00:00` → `2026-10-17T20:37:09.822943+00:00`；mode `electron-node`，上限30.0秒，耗时0.112秒；exit **0**，timedOut `false`。

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron -e 'const assert=require('"'"'node:assert/strict'"'"');const fs=require('"'"'node:fs'"'"');const p=process.argv.at(-1);assert.ok(p.startsWith('"'"'/private/tmp/roundtable-deepseek-trial-20261018/test-tmp/roundtable-deepseek-trial-'"'"'));const D=require('"'"'./node_modules/better-sqlite3'"'"');const d=new D(p,{readonly:true,fileMustExist:true});try{assert.equal(process.versions.modules,'"'"'139'"'"');assert.deepEqual(d.pragma('"'"'integrity_check'"'"'),[{integrity_check:'"'"'ok'"'"'}]);assert.deepEqual(d.pragma('"'"'foreign_key_check'"'"'),[]);assert.equal(d.prepare('"'"'SELECT MAX(version) FROM schema_migrations'"'"').pluck().get(),4);const rs=d.prepare('"'"'SELECT data_json FROM controlled_trials ORDER BY rowid'"'"').pluck().all().map(JSON.parse);assert.equal(rs.length,2);assert.deepEqual(rs.map(v=>[v.state,v.outcome,v.reservedMicroCny,v.accountedMicroCny]),[['"'"'settled'"'"','"'"'completed'"'"',50000,206],['"'"'unknown'"'"','"'"'cancelled'"'"',50000,null]]);assert.deepEqual(rs[0].observedUsage,{inputTokens:71,outputTokens:8});assert.equal(rs[0].estimatedInputTokens,67);assert.equal(rs[1].text,'"'"'partial controlled fixture'"'"');assert.equal(d.prepare("SELECT COUNT(*) FROM controlled_trials WHERE state='"'"'reserved'"'"'").pluck().get(),0);assert.equal(d.prepare('"'"'SELECT COUNT(*) FROM workflow_runs'"'"').pluck().get(),0);assert.ok(!JSON.stringify(rs).includes('"'"'deepseek-trial-fake-key-only'"'"'));for(const f of [p,p+'"'"'-wal'"'"'])if(fs.existsSync(f))assert.ok(!fs.readFileSync(f).includes(Buffer.from('"'"'deepseek-trial-fake-key-only'"'"')));console.log('"'"'Controlled trial exit SQLite PASS: ABI139, integrity, v4, settled206/unknown50000, no implicit Run/retry or plaintext Key'"'"');}finally{d.close();}' /private/tmp/roundtable-deepseek-trial-20261018/test-tmp/roundtable-deepseek-trial-OxKo6E/userData/ai-roundtable.db
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/controlled-exit-sqlite.json`；log SHA-256 `2eb28df8313a36462bc1477c443fea6f116d3cdf88165206330469543bb3355b`。

实际关键输出：

```text
Controlled trial exit SQLite PASS: ABI139, integrity, v4, settled206/unknown50000, no implicit Run/retry or plaintext Key
```

### r09-restart-audit

UTC `2026-10-18T04:07:15.046189+00:00` → `2026-10-18T04:07:15.328642+00:00`；mode `electron-node`，上限45.0秒，耗时0.215秒；exit **0**，timedOut `false`。

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r09-sqlite.cjs /private/tmp/roundtable-deepseek-trial-20261018/test-tmp/roundtable-r09-production-a085rd/r09-restart.json
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/r09-restart-audit.json`；log SHA-256 `6d56740199857ff8a2266b638e3e9888731877fd75dfafa9d9c0a7efd1648c14`。

实际关键输出：

```text
{"status":"PASS","phase":"restart","checks":9,"completedAttempts":3,"explicitRepeatAttempts":3,"actualElectronAbi":"139","readOnlyAudit":true}
```

### mutual-red

UTC `2026-10-18T04:11:30.159728+00:00` → `2026-10-18T04:11:32.916489+00:00`；mode `electron-node`，上限90.0秒，耗时2.694秒；exit **1**，timedOut `false`。

```sh
'/Users/zhangwenjie/.codex/worktrees/deepseek-controlled-trial/AI交互/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron' node_modules/vitest/vitest.mjs run tests/integration/deepseek/mutualExclusion.test.ts tests/unit/appLifecycle.test.ts --reporter=dot
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/mutual-red.json`；log SHA-256 `c9adbfd59f49cb2cfbd37e0d05b947fc7449f40fe23407e69fc4b4b8d1d02b64`。

实际关键输出：

```text
Test Files  2 failed (2)
Tests  9 failed | 30 passed (39)
Duration  2.17s (transform 154ms, setup 0ms, collect 204ms, tests 1.89s, environment 0ms, prepare 67ms)
```

### mutual-green

UTC `2026-10-18T04:12:36.071101+00:00` → `2026-10-18T04:12:38.686620+00:00`；mode `electron-node`，上限90.0秒，耗时2.569秒；exit **0**，timedOut `false`。

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron node_modules/vitest/vitest.mjs run tests/integration/deepseek/mutualExclusion.test.ts tests/unit/appLifecycle.test.ts --reporter=dot
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/mutual-green.json`；log SHA-256 `b83ce1339938019f5f83331205d6d8e1bf631a627d8ed16c9261f45cefd4696f`。

实际关键输出：

```text
Test Files  2 passed (2)
Tests  39 passed (39)
Duration  2.21s (transform 140ms, setup 0ms, collect 185ms, tests 1.95s, environment 0ms, prepare 53ms)
```

### type-final-3

UTC `2026-10-18T04:13:00.757981+00:00` → `2026-10-18T04:13:02.875467+00:00`；mode `node`，上限90.0秒，耗时2.072秒；exit **0**，timedOut `false`。

```sh
/private/tmp/roundtable-deepseek-trial-20261018/bin/pnpm run typecheck
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/type-final-3.json`；log SHA-256 `072d84b3aeca2c2388fda023ba92238e18e00efb6d1f62e7e4fbf59670d88821`。

### node-final-2

UTC `2026-10-18T04:13:03.264270+00:00` → `2026-10-18T04:13:36.258818+00:00`；mode `node`，上限240.0秒，耗时32.948秒；exit **0**，timedOut `false`。

```sh
/private/tmp/roundtable-deepseek-trial-20261018/bin/pnpm run test --reporter=dot
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/node-final-2.json`；log SHA-256 `ab41073be4b1675a13b8b79a500482017091db90930642add451de15fc04cc2e`。

实际关键输出：

```text
Test Files  81 passed (81)
Tests  1168 passed (1168)
Duration  20.82s (transform 1.36s, setup 0ms, collect 10.78s, tests 39.37s, environment 6.59s, prepare 3.54s)
```

### build-final-2

UTC `2026-10-18T04:13:03.383064+00:00` → `2026-10-18T04:13:06.601171+00:00`；mode `node`，上限150.0秒，耗时3.174秒；exit **0**，timedOut `false`。

```sh
/private/tmp/roundtable-deepseek-trial-20261018/bin/pnpm run build
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/build-final-2.json`；log SHA-256 `adf6f365917399035cd2fb7e081fb5f30c8776410e3533478dcf9c598ace3cc2`。

### node-native-final-2

UTC `2026-10-18T04:16:41.089380+00:00` → `2026-10-18T04:16:41.262762+00:00`；mode `node`，上限45.0秒，耗时0.078秒；exit **0**，timedOut `false`。

```sh
/private/tmp/roundtable-deepseek-trial-20261018/bin/node tests/probes/r09-native.cjs
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/node-native-final-2.json`；log SHA-256 `1b58a2e85e5dd0f96cf40f5816d64f49f27e773585ebfc92f81087b3d807f134`。

实际关键输出：

```text
{"status":"PASS","runtime":"node","node":"24.18.1","abi":"137","arch":"arm64","databases":100,"rows":10000,"naturalExit":true}
```

### electron-rebuild-final-2

UTC `2026-10-18T04:16:48.520185+00:00` → `2026-10-18T04:16:59.018185+00:00`；mode `electron`，上限180.0秒，耗时10.453秒；exit **0**，timedOut `false`。

```sh
/private/tmp/roundtable-deepseek-trial-20261018/bin/pnpm run native:electron
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/electron-rebuild-final-2.json`；log SHA-256 `1f9faa3edbda53904eba7c852108c318279540fb646ad1bada7a0b74adafa4f7`。

### electron-native-final-2

UTC `2026-10-18T04:17:11.368674+00:00` → `2026-10-18T04:17:11.650528+00:00`；mode `electron-node`，上限45.0秒，耗时0.238秒；exit **0**，timedOut `false`。

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r09-native.cjs
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/electron-native-final-2.json`；log SHA-256 `c2b6b2e7b27ba1b78a961237e43f68192a638b10d2bb5091f9c83ea2ae014e23`。

实际关键输出：

```text
{"status":"PASS","runtime":"electron","node":"22.22.0","electron":"38.8.6","abi":"139","arch":"arm64","databases":100,"rows":10000,"naturalExit":true}
```

### electron-final-2

UTC `2026-10-18T04:17:17.469954+00:00` → `2026-10-18T04:17:38.611077+00:00`；mode `electron-node`，上限150.0秒，耗时21.101秒；exit **0**，timedOut `false`。

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron node_modules/vitest/vitest.mjs run --reporter=dot
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/electron-final-2.json`；log SHA-256 `444e8f9bbd71ffae87cd6ca5a4492a3962a61f382a373f42ebda56419eaadc4d`。

实际关键输出：

```text
Test Files  81 passed (81)
Tests  1168 passed (1168)
Duration  20.68s (transform 1.79s, setup 0ms, collect 8.48s, tests 34.79s, environment 5.30s, prepare 2.70s)
```

### controlled-production-final-3

UTC `2026-10-18T04:18:36.041833+00:00` → `2026-10-18T04:18:36.926519+00:00`；mode `electron`，上限90.0秒，耗时0.836秒；exit **0**，timedOut `false`。

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/deepseek-trial-electron.cjs
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/controlled-production-final-3.json`；log SHA-256 `321105a87d3002efcee6d54547d035bf9d777c3757ab5c9b5a54fc15c5ea7bb3`。

实际关键输出：

```text
DEEPSEEK_TRIAL_PRODUCTION_PASS {"resultPath":"/private/tmp/roundtable-deepseek-trial-20261018/test-tmp/roundtable-deepseek-trial-8JesoJ/trial-first.json","manifestPath":"/private/tmp/roundtable-deepseek-trial-20261018/test-tmp/roundtable-deepseek-trial-8JesoJ/trial-manifest.json","assertions":42,"localFixtureRequests":2,"liveApi":false}
```

### controlled-restart-final-2

UTC `2026-10-18T04:18:44.003628+00:00` → `2026-10-18T04:18:44.568133+00:00`；mode `electron`，上限90.0秒，耗时0.516秒；exit **0**，timedOut `false`。

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/deepseek-trial-electron.cjs --restart /private/tmp/roundtable-deepseek-trial-20261018/test-tmp/roundtable-deepseek-trial-8JesoJ/trial-manifest.json
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/controlled-restart-final-2.json`；log SHA-256 `dccccd3d79d1e89ce01beb9eed77dcaf70f7b8456e1cb5bdb168dbc497a44e88`。

实际关键输出：

```text
DEEPSEEK_TRIAL_PRODUCTION_PASS {"resultPath":"/private/tmp/roundtable-deepseek-trial-20261018/test-tmp/roundtable-deepseek-trial-8JesoJ/trial-restart.json","manifestPath":"/private/tmp/roundtable-deepseek-trial-20261018/test-tmp/roundtable-deepseek-trial-8JesoJ/trial-manifest.json","assertions":24,"localFixtureRequests":0,"liveApi":false}
```

### controlled-exit-final-2

UTC `2026-10-18T04:18:54.897481+00:00` → `2026-10-18T04:18:55.072031+00:00`；mode `electron-node`，上限30.0秒，耗时0.127秒；exit **0**，timedOut `false`。

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron -e 'const assert=require('"'"'node:assert/strict'"'"');const fs=require('"'"'node:fs'"'"');const p=process.argv.at(-1);assert.ok(p.startsWith('"'"'/private/tmp/roundtable-deepseek-trial-20261018/test-tmp/roundtable-deepseek-trial-'"'"'));const D=require('"'"'./node_modules/better-sqlite3'"'"');const d=new D(p,{readonly:true,fileMustExist:true});try{assert.equal(process.versions.modules,'"'"'139'"'"');assert.deepEqual(d.pragma('"'"'integrity_check'"'"'),[{integrity_check:'"'"'ok'"'"'}]);assert.deepEqual(d.pragma('"'"'foreign_key_check'"'"'),[]);assert.equal(d.prepare('"'"'SELECT MAX(version) FROM schema_migrations'"'"').pluck().get(),4);const rs=d.prepare('"'"'SELECT data_json FROM controlled_trials ORDER BY rowid'"'"').pluck().all().map(JSON.parse);assert.equal(rs.length,2);assert.deepEqual(rs.map(v=>[v.state,v.outcome,v.reservedMicroCny,v.accountedMicroCny]),[['"'"'settled'"'"','"'"'completed'"'"',50000,206],['"'"'unknown'"'"','"'"'cancelled'"'"',50000,null]]);assert.deepEqual(rs[0].observedUsage,{inputTokens:71,outputTokens:8});assert.equal(rs[0].estimatedInputTokens,67);assert.equal(rs[1].text,'"'"'partial controlled fixture'"'"');assert.equal(d.prepare("SELECT COUNT(*) FROM controlled_trials WHERE state='"'"'reserved'"'"'").pluck().get(),0);assert.equal(d.prepare('"'"'SELECT COUNT(*) FROM workflow_runs'"'"').pluck().get(),0);assert.ok(!JSON.stringify(rs).includes('"'"'deepseek-trial-fake-key-only'"'"'));for(const f of [p,p+'"'"'-wal'"'"'])if(fs.existsSync(f))assert.ok(!fs.readFileSync(f).includes(Buffer.from('"'"'deepseek-trial-fake-key-only'"'"')));console.log('"'"'Controlled trial exit SQLite PASS: ABI139, integrity, v4, settled206/unknown50000, no implicit Run/retry or plaintext Key'"'"');}finally{d.close();}' /private/tmp/roundtable-deepseek-trial-20261018/test-tmp/roundtable-deepseek-trial-8JesoJ/userData/ai-roundtable.db
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/controlled-exit-final-2.json`；log SHA-256 `2eb28df8313a36462bc1477c443fea6f116d3cdf88165206330469543bb3355b`。

实际关键输出：

```text
Controlled trial exit SQLite PASS: ABI139, integrity, v4, settled206/unknown50000, no implicit Run/retry or plaintext Key
```

### r09-production-final-2

UTC `2026-10-18T04:19:01.150941+00:00` → `2026-10-18T04:19:05.971490+00:00`；mode `electron`，上限150.0秒，耗时4.78秒；exit **0**，timedOut `false`。

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r09-electron.cjs
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/r09-production-final-2.json`；log SHA-256 `3e461ef967c6ed1c88510f464c630c812b23d162d96b161eea0107efc1ac81b2`。

实际关键输出：

```text
R09_PRODUCTION_PASS {"resultPath":"/private/tmp/roundtable-deepseek-trial-20261018/test-tmp/roundtable-r09-production-0pGUwo/r09-first.json","manifestPath":"/private/tmp/roundtable-deepseek-trial-20261018/test-tmp/roundtable-r09-production-0pGUwo/r09-manifest.json","requests":12,"assertions":57,"liveApi":false}
```

### r09-exit-final-2

UTC `2026-10-18T04:19:20.429844+00:00` → `2026-10-18T04:19:20.600936+00:00`；mode `electron-node`，上限30.0秒，耗时0.128秒；exit **0**，timedOut `false`。

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r09-sqlite.cjs /private/tmp/roundtable-deepseek-trial-20261018/test-tmp/roundtable-r09-production-0pGUwo/r09-first.json
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/r09-exit-final-2.json`；log SHA-256 `e3ffc6fcbf6b8945d2ee6c5ed959684e86dc632d17e2b3ec78b3f9c236b56816`。

实际关键输出：

```text
{"status":"PASS","phase":"first","checks":15,"completedAttempts":3,"explicitRepeatAttempts":3,"actualElectronAbi":"139","readOnlyAudit":true}
```

### r09-restart-final-2

UTC `2026-10-18T04:19:26.780815+00:00` → `2026-10-18T04:19:27.533047+00:00`；mode `electron`，上限90.0秒，耗时0.71秒；exit **0**，timedOut `false`。

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r09-electron.cjs --restart /private/tmp/roundtable-deepseek-trial-20261018/test-tmp/roundtable-r09-production-0pGUwo/r09-manifest.json
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/r09-restart-final-2.json`；log SHA-256 `9749a7d905b832341f57687d68e69f842ea9896a5e4668f57af0513b3fe82a1f`。

实际关键输出：

```text
R09_PRODUCTION_PASS {"resultPath":"/private/tmp/roundtable-deepseek-trial-20261018/test-tmp/roundtable-r09-production-0pGUwo/r09-restart.json","manifestPath":"/private/tmp/roundtable-deepseek-trial-20261018/test-tmp/roundtable-r09-production-0pGUwo/r09-manifest.json","requests":0,"assertions":5,"liveApi":false}
```

### r09-restart-audit-final-2

UTC `2026-10-18T04:19:35.220891+00:00` → `2026-10-18T04:19:35.393306+00:00`；mode `electron-node`，上限30.0秒，耗时0.122秒；exit **0**，timedOut `false`。

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r09-sqlite.cjs /private/tmp/roundtable-deepseek-trial-20261018/test-tmp/roundtable-r09-production-0pGUwo/r09-restart.json
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/r09-restart-audit-final-2.json`；log SHA-256 `6d56740199857ff8a2266b638e3e9888731877fd75dfafa9d9c0a7efd1648c14`。

实际关键输出：

```text
{"status":"PASS","phase":"restart","checks":9,"completedAttempts":3,"explicitRepeatAttempts":3,"actualElectronAbi":"139","readOnlyAudit":true}
```

### r78-production-regression

UTC `2026-10-18T04:23:11.475259+00:00` → `2026-10-18T04:23:24.574906+00:00`；mode `electron`，上限150.0秒，耗时13.059秒；exit **0**，timedOut `false`。

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r07r08-electron.cjs
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/r78-production-regression.json`；log SHA-256 `b2a23b0b7ee2197514c42ac7db7836b91c78406fe2928bf76690e238f6593ecc`。

### r78-exit-version-red

UTC `2026-10-18T04:23:31.778726+00:00` → `2026-10-18T04:23:31.934704+00:00`；mode `electron-node`，上限30.0秒，耗时0.117秒；exit **1**，timedOut `false`。

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r07r08-sqlite.cjs /private/tmp/roundtable-deepseek-trial-20261018/test-tmp/roundtable-r78-production-fnxKyU/r78-first.json
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/r78-exit-version-red.json`；log SHA-256 `f3a9ee321761f766b9d490d671746b18dce05f5df72355867beefc56abf27e90`。

### r78-exit-version-green

UTC `2026-10-18T04:23:48.886097+00:00` → `2026-10-18T04:23:49.052257+00:00`；mode `electron-node`，上限30.0秒，耗时0.127秒；exit **0**，timedOut `false`。

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r07r08-sqlite.cjs /private/tmp/roundtable-deepseek-trial-20261018/test-tmp/roundtable-r78-production-fnxKyU/r78-first.json
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/r78-exit-version-green.json`；log SHA-256 `3cc9a54916a140f579e1527219a4a0793a3e98f56eb1fe9854b2146856d43df1`。

实际关键输出：

```text
{"status":"PASS","phase":"first","sqlite":"139","privateProfile":"/private/tmp/roundtable-deepseek-trial-20261018/test-tmp/roundtable-r78-production-fnxKyU","completedRun":"91392f36-f0bf-4187-a385-88630a388937","attempts":3,"repeatAttempts":3,"keyRecords":1,"fakeBackendOnly":true,"publicContext":true,"historicalDataPreserved":true}
```

### r78-restart-final

UTC `2026-10-18T04:23:56.254950+00:00` → `2026-10-18T04:24:03.021023+00:00`；mode `electron`，上限150.0秒，耗时6.725秒；exit **0**，timedOut `false`。

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r07r08-electron.cjs --restart /private/tmp/roundtable-deepseek-trial-20261018/test-tmp/roundtable-r78-production-fnxKyU/r78-manifest.json
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/r78-restart-final.json`；log SHA-256 `c375cd4e3c7bd31280de0fe1127ef75c6654f4b3c01672604278cc7a12aa581d`。

### r78-restart-exit-final

UTC `2026-10-18T04:24:40.751148+00:00` → `2026-10-18T04:24:40.903902+00:00`；mode `electron-node`，上限30.0秒，耗时0.112秒；exit **0**，timedOut `false`。

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r07r08-sqlite.cjs /private/tmp/roundtable-deepseek-trial-20261018/test-tmp/roundtable-r78-production-fnxKyU/r78-restart.json
```

receipt `/private/tmp/roundtable-deepseek-trial-20261018/r78-restart-exit-final.json`；log SHA-256 `94043d1f4603a5dda2f110509750fd63e6c7968465e27c9e74748a02c41cbedd`。

实际关键输出：

```text
{"status":"PASS","phase":"restart","sqlite":"139","privateProfile":"/private/tmp/roundtable-deepseek-trial-20261018/test-tmp/roundtable-r78-production-fnxKyU","completedRun":"91392f36-f0bf-4187-a385-88630a388937","attempts":3,"repeatAttempts":3,"keyRecords":1,"fakeBackendOnly":true,"publicContext":true,"historicalDataPreserved":true}
```

## 协作代理直接执行的补充元数据

这3条早于统一runner；`agent-commands.json`从当时真实工具输出补录argv/cwd/环境覆盖/退出码和日志SHA，不补造未捕获的准确时间、全部继承环境或源码指纹。初始未提权estimate执行在Vite配置启动阶段EPERM，未运行断言且无独立文件日志，不记PASS。

- `estimate-special`：exit 0；21 passed (21)；上限60秒。PATH=`/private/tmp/roundtable-deepseek-trial-20261018/bin:/usr/bin:/bin`，TMPDIR=`/private/tmp/roundtable-deepseek-trial-20261018/tmp/`；log SHA `8cdc0387bd7749a0f0147251da11c875cd5fd75be9b44a1b5bc310612941d4a0`。

```sh
/private/tmp/roundtable-deepseek-trial-20261018/bin/pnpm exec vitest run tests/integration/deepseek/estimate.test.ts --reporter=dot
```

- `controlled-lifecycle-red`：exit 1；2 failed | 29 passed (31)；上限60秒。PATH=`/private/tmp/roundtable-deepseek-trial-20261018/bin:/usr/bin:/bin`，TMPDIR=`/private/tmp/roundtable-deepseek-trial-20261018/tmp/`；log SHA `03300b0d693641543d12dbb924a0151ce35a335eba65a68e405ca6aaf7d0d12b`。

```sh
/private/tmp/roundtable-deepseek-trial-20261018/bin/pnpm exec vitest run tests/unit/appLifecycle.test.ts --reporter=dot
```

- `controlled-lifecycle-green`：exit 0；31 passed (31)；上限60秒。PATH=`/private/tmp/roundtable-deepseek-trial-20261018/bin:/usr/bin:/bin`，TMPDIR=`/private/tmp/roundtable-deepseek-trial-20261018/tmp/`；log SHA `06c820aabb6b5239e908b865c978234769efe448db5fadb8266b687240e5b775`。

```sh
/private/tmp/roundtable-deepseek-trial-20261018/bin/pnpm exec vitest run tests/unit/appLifecycle.test.ts --reporter=dot
```

## macOS真实safeStorage / 自有Keychain项

详细依据：`/private/tmp/roundtable-owned-oskeychain-jr1foei1/KEYCHAIN-RESULT.md`，临时guard/probe源码、命令receipt及日志均保留。KeyService/DBv3模块为未改主线版本，未等同候选v4整App的OS后端验收。无mock-keychain；native interpose只允许已知UUID服务，其他OS调用转发前拒绝，UI关闭，不改默认Keychain/search list。

| phase | 检查 | exit |
| --- | ---: | ---: |
| dry（不转发OS） | 3 | 0 |
| save | 8 | 0 |
| restart | 13 | 0 |
| revoked-restart | 7 | 0 |

真实后端28断言不与dry/清理相加。以下保留全部早期失败及最终命令，-6/-11均为临时guard故障，不是业务测试PASS。

- UTC `2026-10-17T20:33:06.757141+00:00`，phase `dry`，exit **-6**，timedOut `false`；receipt `/private/tmp/roundtable-owned-oskeychain-bnddoq_l/dry-command.json`；log SHA `7e001e77cf92732eba44dcf85531f88c952f7063e3eb5e817d96943c750daa91`。

```sh
'/Users/zhangwenjie/Documents/ChatGPT/AI交互/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron' /private/tmp/roundtable-owned-oskeychain-bnddoq_l/probe.cjs dry
```

- UTC `2026-10-17T20:33:29.122378+00:00`，phase `dry`，exit **0**，timedOut `false`；receipt `/private/tmp/roundtable-owned-oskeychain-bnddoq_l/dry-2-command.json`；log SHA `1d06c9f6eae23b3d0e03fa8a40f0c95f81e0f4607bb97f314820b05c70466600`。

```sh
'/Users/zhangwenjie/Documents/ChatGPT/AI交互/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron' /private/tmp/roundtable-owned-oskeychain-bnddoq_l/probe.cjs dry
```

- UTC `2026-10-17T20:33:42.364327+00:00`，phase `save`，exit **-11**，timedOut `false`；receipt `/private/tmp/roundtable-owned-oskeychain-bnddoq_l/save-command.json`；log SHA `d993478145edeeef30c776d97a9dd7fbdd439e24e157ddfb40ee4ebe01fd8062`。

```sh
'/Users/zhangwenjie/Documents/ChatGPT/AI交互/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron' /private/tmp/roundtable-owned-oskeychain-bnddoq_l/probe.cjs save
```

- UTC `2026-10-17T20:34:31.678701+00:00`，phase `dry`，exit **0**，timedOut `false`；receipt `/private/tmp/roundtable-owned-oskeychain-bnddoq_l/dry-3-command.json`；log SHA `d767eea25a5fee32648e7889a27a212a125ef5bc3b86ee1c469d2b2e3e3df701`。

```sh
'/Users/zhangwenjie/Documents/ChatGPT/AI交互/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron' /private/tmp/roundtable-owned-oskeychain-bnddoq_l/probe.cjs dry
```

- UTC `2026-10-17T20:34:59.519576+00:00`，phase `save`，exit **0**，timedOut `false`；receipt `/private/tmp/roundtable-owned-oskeychain-bnddoq_l/save-2-command.json`；log SHA `26e34ad71f284957a0e2e09ab2907cc4d82abed11005e405fd159e61f480c093`。

```sh
'/Users/zhangwenjie/Documents/ChatGPT/AI交互/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron' /private/tmp/roundtable-owned-oskeychain-bnddoq_l/probe.cjs save
```

- UTC `2026-10-17T20:35:10.995560+00:00`，phase `restart`，exit **1**，timedOut `false`；receipt `/private/tmp/roundtable-owned-oskeychain-bnddoq_l/restart-command.json`；log SHA `d993478145edeeef30c776d97a9dd7fbdd439e24e157ddfb40ee4ebe01fd8062`。

```sh
'/Users/zhangwenjie/Documents/ChatGPT/AI交互/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron' /private/tmp/roundtable-owned-oskeychain-bnddoq_l/probe.cjs restart
```

- UTC `2026-10-17T20:36:13.058460+00:00`，phase `dry`，exit **0**，timedOut `false`；receipt `/private/tmp/roundtable-owned-oskeychain-jr1foei1/dry-command.json`；log SHA `d9e78382dbf58f4fa5d5892333cc47ef4bf704c9318fec5ceb1ba9c50597385a`。

```sh
'/Users/zhangwenjie/Documents/ChatGPT/AI交互/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron' /private/tmp/roundtable-owned-oskeychain-jr1foei1/probe.cjs dry
```

- UTC `2026-10-17T20:36:20.452520+00:00`，phase `save`，exit **0**，timedOut `false`；receipt `/private/tmp/roundtable-owned-oskeychain-jr1foei1/save-command.json`；log SHA `0d51e111bdafc2a0a3aa0bfd43461ada10b915711239329385fba73b5d798cf4`。

```sh
'/Users/zhangwenjie/Documents/ChatGPT/AI交互/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron' /private/tmp/roundtable-owned-oskeychain-jr1foei1/probe.cjs save
```

- UTC `2026-10-17T20:36:27.240483+00:00`，phase `restart`，exit **0**，timedOut `false`；receipt `/private/tmp/roundtable-owned-oskeychain-jr1foei1/restart-command.json`；log SHA `e3f55151c0e4d1ab44c54a3f281d3b3cfff9327838f9a9f318ef364a2321380e`。

```sh
'/Users/zhangwenjie/Documents/ChatGPT/AI交互/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron' /private/tmp/roundtable-owned-oskeychain-jr1foei1/probe.cjs restart
```

- UTC `2026-10-17T20:36:32.411939+00:00`，phase `revoked-restart`，exit **0**，timedOut `false`；receipt `/private/tmp/roundtable-owned-oskeychain-jr1foei1/revoked-restart-command.json`；log SHA `a8211fca798dfbc06af7219a336fdcba7a2c3e98cd6502eaa24fa0b495d78906`。

```sh
'/Users/zhangwenjie/Documents/ChatGPT/AI交互/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron' /private/tmp/roundtable-owned-oskeychain-jr1foei1/probe.cjs revoked-restart
```

native guard编译（exit0；准确开始时间未单独捕获）：

```sh
/usr/bin/clang -dynamiclib -arch arm64 -Wno-deprecated-declarations -framework Security -framework CoreFoundation /private/tmp/roundtable-owned-oskeychain-jr1foei1/keyguard.c -o /private/tmp/roundtable-owned-oskeychain-jr1foei1/keyguard.dylib
```

首次C清理客户端精确自有项lookup返回errSecAuthFailed(-25293)，exit1，删除0；原因可能为客户端ACL身份差异，未独立完全证明。后续同Electron N-API清理曾被自动审批拒绝，未执行因而没有进程退出码；原拒绝和失败不删除。人类明确批准“允许仅清理这些自建测试项”后才执行原范围清理。

```sh
python3 /private/tmp/roundtable-owned-oskeychain-jr1foei1/cleanup-electron-authorized.py
```

上述supervisor exit0，精确子进程如下；只允许两个所有权已证明的UUID服务、总计3项，上限2+1，没有枚举其他项。

`cleanup-0-command.json`：

```json
{
  "argv": [
    "/private/tmp/roundtable-owned-oskeychain-jr1foei1/cleanup"
  ],
  "startedUtc": "2026-10-17T20:38:32.954859+00:00",
  "timedOut": false,
  "exit": 1,
  "elapsed": 0.039,
  "logSha256": "52ff3fe6a08987fd28856b2bda8148955f735bd2acc610e020072f6bcffb92c3"
}
```

`cleanup-electron-authorized-0-command.json`：

```json
{
  "argv": [
    "/Users/zhangwenjie/Documents/ChatGPT/AI交互/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
    "/private/tmp/roundtable-owned-oskeychain-jr1foei1/cleanup-electron.cjs",
    "/private/tmp/roundtable-owned-oskeychain-bnddoq_l/owner.json"
  ],
  "startedUtc": "2026-10-18T04:12:23.752386+00:00",
  "timedOut": false,
  "exit": 0,
  "elapsed": 0.348,
  "logSha256": "6f6e9487fd56c8986387b5ed426fa9f74070350834c8367ef39d734080270940"
}
```

`cleanup-electron-authorized-1-command.json`：

```json
{
  "argv": [
    "/Users/zhangwenjie/Documents/ChatGPT/AI交互/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
    "/private/tmp/roundtable-owned-oskeychain-jr1foei1/cleanup-electron.cjs",
    "/private/tmp/roundtable-owned-oskeychain-jr1foei1/owner.json"
  ],
  "startedUtc": "2026-10-18T04:12:24.101755+00:00",
  "timedOut": false,
  "exit": 0,
  "elapsed": 0.183,
  "logSha256": "fd3570e333cd8006e92bc78e2e37194f81810b45f0034264b3ee753be956103b"
}
```

最终 `cleanup-final.json`：删除3、精确不存在检查4、两个子进程exit0、无超时/OS授权UI/其他服务调用/网络请求。临时证据保留；未删除任何真实API Key。

## 失败修复和未验证边界

- 初始RED：新模块/API缺失；基线1105可通过。pending-authorization-red暴露确认等待不可取消，2失败；修复报价消耗/Abort竞态，未降低断言。
- controlled-service-green-1：测试spy递归错误，1失败/18通过；改为调用原prototype，保留原日志。trial-typecheck-1：summary无baseUrl，exit2；改为查询现有配置接口。
- migration早期RED保留；v4-red-schema实际7通过/2失败证明恢复索引约束缺失；追加准确结构校验后通过。旧测试只把当前最新schema期望更新4、新版本拒绝样例更新5，v1/v2/v3原fixture和回滚断言保留。
- shutdown RED 2失败/29通过证明双退出屏障缺失；mutual-red 9失败/30通过证明普通Run/受控请求互斥和关窗提醒缺失。针对性修复后重新执行最终双运行时1168，而非沿用中间1160。
- controlled-production-1：探针自身safeStorage方法清单计数断言不兼容，exit1；修复为完整原方法覆盖及所有当前方法逐一fake，不减少隔离范围。最终42条具名断言实际执行。
- r78-exit-version-red：旧审计精确期望[1,2,3]而实际[1,2,3,4]，exit1；只将当前最新ledger期望更新4，同一profile只读审计exit0；生产UI与18真桥断言已通过。业务、构建、单元集成输入与原生产GUI探针未改，不机械重跑全回归。
- OS guard早期-6/-11/exit1、C清理exit1和自动审批拒绝均留档；获人类明确批准后清理成功，不算之前已成功。一次环境自动审批服务临时失败的审计命令未执行，后来相同授权范围实际执行exit0。
- 成功GUI日志仍有sandbox_extension_issue_file_to_process警告，断言与自然退出均实测；没有把警告消除或桌面打包称为通过。build有既有Zod/Rollup注释警告。
- 真实公网API请求0；严格Token上界仍未知。完整Tokenizer/API模板映射、真实账单、正式签名/锁定登录Keychain、全量E2E、跨平台/发布均未验证；无lint配置，不宣称lint通过。

## 最终范围审计

`python3 /private/tmp/roundtable-deepseek-trial-20261018/final-audit.py` 实际exit0：main保持ae5c24c且干净；当前17个注册Worktree，其他全部干净；migration1内嵌SQL及migration2/3、package/lock/workspace/build配置逐字不变，Shared/Preload/Renderer/KeyService/context/Mock无diff；候选与main原生文件inode独立。10份最终执行receipt的业务源码/单元集成输入SHA与提交前实际文件一致；唯一后改的旧r78审计脚本有明确单行diff与修后真实exit0 receipt。详见 `/private/tmp/roundtable-deepseek-trial-20261018/final-audit.json`。

该审计在文档补录期间执行；只变更治理文档不机械重跑同一业务版本测试。提交前另行执行git diff --check、完整暂存diff/敏感文件清单检查。候选提交后状态以交付消息和该提交定位，不自动合main。
