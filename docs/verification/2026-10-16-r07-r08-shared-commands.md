# R07/R08 共享前置候选实际命令台账

主体扫描截止：**2026-10-16T02:25:33.460727+00:00 UTC**（Asia/Shanghai为UTC+08:00）。这是对已存在证据的整理。截止后的最终只读核对列在文末补充表，非历史 PASS 替代。

工作目录：`/Users/zhangwenjie/.codex/worktrees/r07-r08-shared-foundation/AI交互`；基线/分支：`510f58a75c676496f6e4e5960eb89553d04ab8ac` / `codex/shared-r07-r08-foundation`。下表均按真实startedUtc升序；不同阶段源码/测试数量会变化，不能把早期PASS替代最终候选证据。

本快照共 **45** 条已执行监督命令：exit0 **32** 条，exit1 **12** 条，exit2 **1** 条；其中 **18** 次具有Vitest测试统计，**10** 次含失败测试统计。非零退出包括有效red、测试误写、类型检查和权限/诊断失败，分别注明。初次安装审批deadline属于未启动调用，另列，不计为已执行命令。

## 可复现环境与监督方式

- Node发行目录：`/private/tmp/roundtable-r02-integration-b0c3ktgt/runtime-24.18.1/node-v24.18.1-darwin-arm64`（官方24.18.1/darwin-arm64、ABI137；完整同版include/config）。
- pnpm实际入口：`/Users/zhangwenjie/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pnpm/bin/pnpm.mjs`（11.25.0）；`/private/tmp/roundtable-shared-r78-xs758rt3/bin/pnpm`临时shim显式exec该Node和入口，并固定本root的store/cache/state。默认Codex fallback/pnpm不能替代此入口。
- 监督脚本：`/private/tmp/roundtable-shared-r78-xs758rt3/run-check.py`；每次命令上限为参数指定秒数（脚本允许0<上限<=600），超时TERM、5秒后KILL并记录exit124/实际进程退出，关闭core。每条保存`<label>.json`和`logs/<label>.log`，包含精确argv、cwd、mode、startedUtc、耗时、实际exit、HEAD/tree及源码指纹前后。label须唯一，避免覆盖证据。
- `node`模式清除继承的NODE_OPTIONS/ELECTRON_RUN_AS_NODE/nodedir/build_from_source，设置npm_config_nodedir为上述完整Node发行目录、npm_config_build_from_source=true。普通pnpm test的pretest会重新源码编译本WT SQLite为ABI137。
- `electron`模式先清除宿主Node目标，再设置npm_config_nodedir=`/private/tmp/roundtable-shared-r78-xs758rt3/electron-headers/38.8.6`和build_from_source=true；`electron-node`模式只设置ELECTRON_RUN_AS_NODE=1，不带宿主Node headers；`tool`模式只使用受控PATH，不设编译目标。
- 所有模式使用本root独立npm-cache、electron-gyp、electron-cache、builder-cache、test-tmp(TMPDIR)、XDG cache/config/data/state及空user/global npmrc；不改HOME、全局Node或全局配置。完整PATH保留在原JSON，本台账不重复冗长PATH。未引入raw数字config.fetch-timeout；安装使用冻结锁/离线/复制导入/禁side-effects缓存，未复制node_modules。
- Node/Electron对同一node_modules的原生重建必须串行。写本WT的命令须按当前沙箱要求显式申请同范围escalated，不能把EPERM启动失败解释成业务断言。

```sh
R78_ROOT=/private/tmp/roundtable-shared-r78-xs758rt3
python3 "$R78_ROOT/run-check.py" <唯一label> <上限秒> <node|electron|electron-node|tool> <实际argv...>
# 示例仅说明调用方式，此草稿生成过程未执行这些示例：
python3 "$R78_ROOT/run-check.py" rerun-full 180 node pnpm test --reporter=dot
python3 "$R78_ROOT/run-check.py" rerun-typecheck 60 tool pnpm typecheck
python3 "$R78_ROOT/run-check.py" rerun-native-electron 180 electron pnpm native:electron
```

## 按startedUtc排序的实际命令

| UTC开始 / label | 上限秒 / mode | exit / 耗时秒 | 实际argv | 关键输出与性质 |
| --- | --- | --- | --- | --- |
| 2026-10-15T17:39:22.215671Z<br>`source-verify` | 60.0 / `tool` | 0 / 0.849 | `python3 /private/tmp/roundtable-shared-r78-xs758rt3/setup.py` | 非测试：官方缓存 archive SHA/runtime/include/config 与 pnpm11.25.0来源重验通过。 |
| 2026-10-15T17:39:26.609422Z<br>`cache-seed` | 180.0 / `tool` | 0 / 3.456 | `python3 /private/tmp/roundtable-shared-r78-xs758rt3/seed-cache.py` | 非测试：20979内容文件、661 metadata文件独立inode；源索引immutable只读备份且SHA未变，未复制node_modules。 |
| 2026-10-15T17:45:46.887120Z<br>`install-frozen-offline` | 300.0 / `node` | 0 / 15.299 | `pnpm install --frozen-lockfile --offline --package-import-method=copy --side-effects-cache=false --reporter=append-only` | 非测试：冻结离线安装646 reused / 0 downloaded，允许的安装脚本及Node源码编译实际执行；不是冷缓存联网安装。 |
| 2026-10-15T17:46:22.302924Z<br>`baseline-full` | 180.0 / `node` | 0 / 15.885 | `pnpm test --reporter=dot` | Test Files  40 passed (40)；Tests  534 passed (534)；实际测试统计见本行。 |
| 2026-10-15T17:46:57.489030Z<br>`node-sqlite-smoke` | 30.0 / `node` | 0 / 0.054 | `node /private/tmp/roundtable-shared-r78-xs758rt3/sqlite-probe.cjs` | 非Vitest：Node24.18.1/ABI137内存SQL写/读/close后正常退出。 |
| 2026-10-15T17:46:57.489032Z<br>`installed-node` | 30.0 / `node` | 0 / 0.054 | `node /private/tmp/roundtable-shared-r78-xs758rt3/installed-probe.cjs` | 非测试：Node24.18.1/ABI137/arm64，安装锁字节一致，盘点32直接依赖。 |
| 2026-10-15T17:47:55.414397Z<br>`foundation-red` | 60.0 / `node` | 1 / 0.788 | `pnpm exec vitest run tests/integration/configuration/sharedFoundation.test.ts tests/unit/configuration/providerKeys.test.ts --reporter=dot` | Test Files  2 failed (2)；Tests  15 failed (15)；实施前行为red：Room/Provider等新增数据库方法不存在。 |
| 2026-10-15T17:48:46.710454Z<br>`contracts-red` | 60.0 / `node` | 1 / 0.356 | `pnpm exec vitest run tests/unit/contracts/configuration.test.ts --reporter=dot` | 非测试断言失败：Vitest启动前写node_modules/.vite-temp被EPERM拒绝，没有执行测试；不能作为契约red。 |
| 2026-10-15T17:48:56.006396Z<br>`contracts-red-authorized` | 60.0 / `node` | 1 / 0.794 | `pnpm exec vitest run tests/unit/contracts/configuration.test.ts --reporter=dot` | Test Files  1 failed (1)；Tests  44 failed \| 1 passed (45)；授权执行后的行为red：新增Shared Schema导出尚缺。 |
| 2026-10-15T17:50:22.049095Z<br>`contracts-green` | 60.0 / `node` | 0 / 0.793 | `pnpm exec vitest run tests/unit/contracts/configuration.test.ts --reporter=dot` | Test Files  1 passed (1)；Tests  45 passed (45)；实际测试统计见本行。 |
| 2026-10-15T17:51:09.682053Z<br>`foundation-first-green` | 60.0 / `node` | 1 / 0.783 | `pnpm exec vitest run tests/integration/configuration/sharedFoundation.test.ts tests/unit/configuration/providerKeys.test.ts --reporter=dot` | Test Files  1 failed \| 1 passed (2)；Tests  1 failed \| 14 passed (15)；名称含green但实际失败：禁用默认Provider的状态约束未拒绝，1项断言失败。 |
| 2026-10-16T02:00:59.525635Z<br>`current-typecheck` | 60.0 / `tool` | 2 / 1.544 | `pnpm typecheck` | 非测试：类型检查exit2，Shared类型/契约导出缺失、KeyService重复导入/签名及测试推断问题；详见原log。 |
| 2026-10-16T02:03:17.331924Z<br>`migration-v3-red` | 60.0 / `node` | 1 / 1.261 | `pnpm exec vitest run tests/integration/configuration/migrationV3.test.ts --reporter=dot` | Test Files  1 failed (1)；Tests  1 failed \| 5 passed (6)；行为red：声称v3但缺少列的ledger未被拒绝；原库字节保护断言失败。 |
| 2026-10-16T02:05:49.286784Z<br>`audit-red` | 60.0 / `node` | 1 / 1.277 | `pnpm exec vitest run tests/integration/configuration tests/unit/configuration --reporter=dot` | Test Files  3 failed (3)；Tests  5 failed \| 20 passed (25)；行为red：v3缺列、旧部分模型配置、分页上界及删除/延迟解密Key撤销共5项失败。 |
| 2026-10-16T02:08:41.389411Z<br>`target-unicode-red` | 60.0 / `node` | 1 / 0.924 | `pnpm exec vitest run tests/integration/configuration/sharedFoundation.test.ts tests/unit/configuration/providerKeys.test.ts --reporter=dot` | Test Files  2 failed (2)；Tests  5 failed \| 15 passed (20)；行为red：同时间Run分页、Unicode BINARY排序与三项Key并发/撤销约束失败。 |
| 2026-10-16T02:10:13.746326Z<br>`foundation-green` | 60.0 / `node` | 0 / 1.429 | `pnpm exec vitest run tests/integration/configuration tests/unit/configuration tests/unit/contracts/configuration.test.ts --reporter=dot` | Test Files  4 passed (4)；Tests  73 passed (73)；实际测试统计见本行。 |
| 2026-10-16T02:10:45.891858Z<br>`candidate-build-1` | 90.0 / `tool` | 0 / 3.38 | `pnpm build` | 非测试：类型与生产Main/Preload/Renderer构建正常退出；不替代native加载/桌面验证。 |
| 2026-10-16T02:11:14.507906Z<br>`candidate-typecheck-1` | 60.0 / `tool` | 0 / 1.339 | `pnpm typecheck` | 非测试：TypeScript检查正常退出；不替代运行验证。 |
| 2026-10-16T02:11:15.531070Z<br>`candidate-full-1` | 180.0 / `node` | 0 / 15.069 | `pnpm test --reporter=dot` | Test Files  44 passed (44)；Tests  607 passed (607)；实际测试统计见本行。 |
| 2026-10-16T02:12:07.880918Z<br>`create-selection-red` | 60.0 / `node` | 1 / 0.784 | `pnpm exec vitest run tests/unit/contracts/configuration.test.ts --reporter=dot` | Test Files  1 failed (1)；Tests  1 failed \| 46 passed (47)；测试代码误写：configurationSchemas未定义导致ReferenceError；不能作为实现缺陷的有效red。 |
| 2026-10-16T02:12:29.217705Z<br>`create-selection-red-corrected` | 60.0 / `node` | 1 / 0.786 | `pnpm exec vitest run tests/unit/contracts/configuration.test.ts --reporter=dot` | Test Files  1 failed (1)；Tests  1 failed \| 46 passed (47)；纠正变量名后有效行为red：创建成员时Provider/model不成对仍被接受。 |
| 2026-10-16T02:12:52.751266Z<br>`cursor-contract-red` | 60.0 / `node` | 1 / 0.77 | `pnpm exec vitest run tests/unit/contracts/configuration.test.ts --reporter=dot` | Test Files  1 failed (1)；Tests  1 failed \| 47 passed (48)；行为red：允许跳过持久化项目或不能前进的continuation cursor。 |
| 2026-10-16T02:13:21.814458Z<br>`foundation-final` | 60.0 / `node` | 0 / 1.208 | `pnpm exec vitest run tests/integration/configuration tests/unit/configuration tests/unit/contracts/configuration.test.ts --reporter=dot` | Test Files  4 passed (4)；Tests  75 passed (75)；实际测试统计见本行。 |
| 2026-10-16T02:14:41.092000Z<br>`delete-provider-red` | 60.0 / `node` | 1 / 0.811 | `pnpm exec vitest run tests/unit/configuration/providerKeys.test.ts --reporter=dot` | Test Files  1 failed (1)；Tests  1 failed \| 9 passed (10)；行为red：KeyService.deleteProvider协调删除入口不存在。 |
| 2026-10-16T02:15:18.387463Z<br>`candidate-build-final` | 90.0 / `tool` | 0 / 2.497 | `pnpm build` | 非测试：类型与生产Main/Preload/Renderer构建正常退出；不替代native加载/桌面验证。 |
| 2026-10-16T02:15:29.719337Z<br>`candidate-full-final` | 180.0 / `node` | 0 / 16.993 | `pnpm test --reporter=dot` | Test Files  44 passed (44)；Tests  610 passed (610)；实际测试统计见本行。 |
| 2026-10-16T02:15:31.349470Z<br>`candidate-typecheck-final` | 60.0 / `tool` | 0 / 1.664 | `pnpm typecheck` | 非测试：TypeScript检查正常退出；不替代运行验证。 |
| 2026-10-16T02:16:10.925855Z<br>`prepare-electron-headers` | 30.0 / `tool` | 0 / 0.14 | `python3 /private/tmp/roundtable-shared-r78-xs758rt3/prepare-electron-headers.py` | 非测试：125文件逐字节匹配现有官方38.8.6缓存与主线副本，inode独立；未重编译。 |
| 2026-10-16T02:16:17.093634Z<br>`candidate-full-complete` | 180.0 / `node` | 0 / 14.931 | `pnpm test --reporter=dot` | Test Files  44 passed (44)；Tests  612 passed (612)；实际测试统计见本行。 |
| 2026-10-16T02:16:22.099923Z<br>`native-isolation-final-node` | 30.0 / `tool` | 1 / 0.049 | `python3 /private/tmp/roundtable-shared-r78-xs758rt3/native-isolation-readonly.py` | 非测试诊断失败：与Node重建并发，WT native文件被暂时移除而FileNotFoundError；原执行JSON被后续证据payload覆盖，元数据取自本会话工具返回。 |
| 2026-10-16T02:16:53.317281Z<br>`native-isolation-final-node-after-rebuild` | 30.0 / `tool` | 0 / 0.049 | `python3 /private/tmp/roundtable-shared-r78-xs758rt3/native-isolation-readonly.py` | 非测试：Node重建完成后串行读取原生inode/config，WT ABI137且不与main共享文件。 |
| 2026-10-16T02:18:03.464152Z<br>`candidate-typecheck-complete` | 60.0 / `tool` | 0 / 1.385 | `pnpm typecheck` | 非测试：TypeScript检查正常退出；不替代运行验证。 |
| 2026-10-16T02:18:07.051173Z<br>`candidate-node-stress-2` | 60.0 / `node` | 0 / 0.356 | `node /private/tmp/roundtable-shared-r78-xs758rt3/sqlite-probe.cjs --stress` | 非Vitest：单独Node24.18.1/ABI137进程300000次prepare/get与自然分配，最终正常退出；五次分别记录。 |
| 2026-10-16T02:18:07.647258Z<br>`candidate-node-stress-5` | 60.0 / `node` | 0 / 0.357 | `node /private/tmp/roundtable-shared-r78-xs758rt3/sqlite-probe.cjs --stress` | 非Vitest：单独Node24.18.1/ABI137进程300000次prepare/get与自然分配，最终正常退出；五次分别记录。 |
| 2026-10-16T02:18:07.762905Z<br>`candidate-node-stress-1` | 60.0 / `node` | 0 / 0.353 | `node /private/tmp/roundtable-shared-r78-xs758rt3/sqlite-probe.cjs --stress` | 非Vitest：单独Node24.18.1/ABI137进程300000次prepare/get与自然分配，最终正常退出；五次分别记录。 |
| 2026-10-16T02:18:08.051448Z<br>`candidate-node-stress-4` | 60.0 / `node` | 0 / 0.405 | `node /private/tmp/roundtable-shared-r78-xs758rt3/sqlite-probe.cjs --stress` | 非Vitest：单独Node24.18.1/ABI137进程300000次prepare/get与自然分配，最终正常退出；五次分别记录。 |
| 2026-10-16T02:18:08.095848Z<br>`candidate-build-complete` | 90.0 / `tool` | 0 / 2.333 | `pnpm build` | 非测试：类型与生产Main/Preload/Renderer构建正常退出；不替代native加载/桌面验证。 |
| 2026-10-16T02:18:08.761539Z<br>`candidate-node-stress-3` | 60.0 / `node` | 0 / 0.408 | `node /private/tmp/roundtable-shared-r78-xs758rt3/sqlite-probe.cjs --stress` | 非Vitest：单独Node24.18.1/ABI137进程300000次prepare/get与自然分配，最终正常退出；五次分别记录。 |
| 2026-10-16T02:20:47.834336Z<br>`candidate-native-electron` | 180.0 / `electron` | 0 / 11.203 | `pnpm native:electron` | 非测试：electron-rebuild --force实际完成，不能单独替代Electron加载证明。 |
| 2026-10-16T02:21:20.549929Z<br>`candidate-electron-sqlite` | 30.0 / `electron-node` | 0 / 1.727 | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron /private/tmp/roundtable-shared-r78-xs758rt3/sqlite-probe.cjs` | 非Vitest：Electron38.8.6/内嵌Node22.22.0/ABI139内存SQL写/读/close并正常退出。 |
| 2026-10-16T02:21:23.821006Z<br>`candidate-electron-tests` | 90.0 / `electron-node` | 0 / 2.584 | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron node_modules/vitest/vitest.mjs run tests/unit/database.test.ts tests/unit/persistence tests/integration/persistence tests/integration/configuration tests/unit/configuration tests/unit/contracts/configuration.test.ts tests/integration/joint --reporter=dot` | Test Files  18 passed (18)；Tests  190 passed (190)；实际测试统计见本行。 |
| 2026-10-16T02:21:42.240144Z<br>`candidate-joint-ui` | 60.0 / `tool` | 0 / 3.967 | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r01-electron.cjs --joint-ui` | 有限生产DOM/Bridge探针：ready前隔离新profile；probe status=PASS，development=false/hmrConnected=false；不是正式E2E。 |
| 2026-10-16T02:22:11.504693Z<br>`candidate-recovery-ui` | 60.0 / `tool` | 0 / 1.766 | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r01-electron.cjs --r03-recovery` | 有限恢复探针：ready前隔离另一新profile；probe status=PASS，development=false/hmrConnected=false；退出后DB检查须单列。 |
| 2026-10-16T02:24:20.651470Z<br>`candidate-joint-exitdb` | 30.0 / `electron-node` | 0 / 0.091 | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r01-sqlite.cjs /private/tmp/roundtable-shared-r78-xs758rt3/test-tmp/roundtable-r01-electron-kCyZQ9/probe-result.json` | 退出后只读本轮临时profile数据库/备份检查；不转录DB内容，结论按此命令与日志单列。 |
| 2026-10-16T02:24:26.742667Z<br>`candidate-recovery-exitdb` | 30.0 / `electron-node` | 0 / 0.097 | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r01-sqlite.cjs /private/tmp/roundtable-shared-r78-xs758rt3/test-tmp/roundtable-r01-electron-ns99h0/probe-result.json` | 退出后只读本轮临时profile数据库/备份检查；不转录DB内容，结论按此命令与日志单列。 |

## 中间失败、证据缺口和未启动调用

- `contracts-red`：实际exit1，但日志为Vitest配置写入`.vite-temp`的EPERM，测试未启动；随后授权执行的`contracts-red-authorized`才产生44 failed / 1 passed的真实行为red。
- `create-selection-red`：变量名误写导致ReferenceError，虽然Vitest统计1 failed / 46 passed，但它不证明实现缺陷；`create-selection-red-corrected`修正测试变量后仍真实断言失败，随后最终契约/全量回归结果另列。
- `foundation-first-green`：保留原label，但实际exit1（1 failed / 14 passed），不能因名称含green宣称通过。
- `native-isolation-final-node`：2026-10-16T02:16:22.099923Z的原执行结果exit1/0.049秒，由本会话原始工具返回恢复；失败log仍在。随后成功脚本将同名`native-isolation-final-node.json`写成原生盘点证据payload，覆盖了原supervisor元数据。这里不重造或修改原JSON；表内明确保留恢复来源。`native-isolation-final-node-after-rebuild`是确认重建结束后串行重读的新命令exit0。
- 初次安装提权申请在自动审批deadline前未完成，工具明确表示不能据此判为不安全并允许一次重试。该申请没有启动安装进程、没有实际exit/本root监督JSON；一次允许的重试成功启动并对应`install-frozen-offline`。不能给未启动申请虚构退出码或测试结果。
- `current-typecheck`保留实际exit2；行为red与上述错误均由后续独立命令复验，不删除早期失败，也不把所有非零退出都称为预期守卫通过。

## 证据边界与待补项

- 本快照缺少对应日志的完整命令：无；完整JSON中前后源码指纹不一致的命令：无。每条受检HEAD/tree/指纹仍以本轮原JSON为准。
- `source-verification.json`、`electron-headers-verification.json`、`native-isolation.json`及同名原生盘点payload是证据摘要，不是另一次Vitest或又一条监督命令，不能重复计数；源码新增过程中的不同测试数量按每次实际执行分别记录。
- 测试只使用Mock/fixture、内存或私有TMPDIR。此草稿不包含临时DB内容、假Key值、公共请求全文或无意义dot输出，也没有读取临时profile数据库。
- 原生编译保留libc++平台/函数指针转换warning；生产构建保留Zod PURE注释Rollup warning；桌面log有sandbox_extension_issue_file_to_process诊断。具体命令exit见表，不能将这些stderr行自动等同失败或取消隔离。
- `candidate-joint-ui`：已纳入本截止快照。
- `candidate-recovery-ui`：已纳入本截止快照。
- 退出后只读profile检查：已纳入：`candidate-joint-exitdb`, `candidate-recovery-exitdb`。
- 有限桌面探针不等于正式tests/e2e、跨平台、安装升级、打包发布或真实Provider/Key验收；本台账不赋予R07/R08模块或main任何merged/verified结论。

## 原始证据索引

- `source-verify`：`source-verify.json`；`logs/source-verify.log`。
- `cache-seed`：`cache-seed.json`；`logs/cache-seed.log`。
- `install-frozen-offline`：`install-frozen-offline.json`；`logs/install-frozen-offline.log`。
- `baseline-full`：`baseline-full.json`；`logs/baseline-full.log`。
- `node-sqlite-smoke`：`node-sqlite-smoke.json`；`logs/node-sqlite-smoke.log`。
- `installed-node`：`installed-node.json`；`logs/installed-node.log`。
- `foundation-red`：`foundation-red.json`；`logs/foundation-red.log`。
- `contracts-red`：`contracts-red.json`；`logs/contracts-red.log`。
- `contracts-red-authorized`：`contracts-red-authorized.json`；`logs/contracts-red-authorized.log`。
- `contracts-green`：`contracts-green.json`；`logs/contracts-green.log`。
- `foundation-first-green`：`foundation-first-green.json`；`logs/foundation-first-green.log`。
- `current-typecheck`：`current-typecheck.json`；`logs/current-typecheck.log`。
- `migration-v3-red`：`migration-v3-red.json`；`logs/migration-v3-red.log`。
- `audit-red`：`audit-red.json`；`logs/audit-red.log`。
- `target-unicode-red`：`target-unicode-red.json`；`logs/target-unicode-red.log`。
- `foundation-green`：`foundation-green.json`；`logs/foundation-green.log`。
- `candidate-build-1`：`candidate-build-1.json`；`logs/candidate-build-1.log`。
- `candidate-typecheck-1`：`candidate-typecheck-1.json`；`logs/candidate-typecheck-1.log`。
- `candidate-full-1`：`candidate-full-1.json`；`logs/candidate-full-1.log`。
- `create-selection-red`：`create-selection-red.json`；`logs/create-selection-red.log`。
- `create-selection-red-corrected`：`create-selection-red-corrected.json`；`logs/create-selection-red-corrected.log`。
- `cursor-contract-red`：`cursor-contract-red.json`；`logs/cursor-contract-red.log`。
- `foundation-final`：`foundation-final.json`；`logs/foundation-final.log`。
- `delete-provider-red`：`delete-provider-red.json`；`logs/delete-provider-red.log`。
- `candidate-build-final`：`candidate-build-final.json`；`logs/candidate-build-final.log`。
- `candidate-full-final`：`candidate-full-final.json`；`logs/candidate-full-final.log`。
- `candidate-typecheck-final`：`candidate-typecheck-final.json`；`logs/candidate-typecheck-final.log`。
- `prepare-electron-headers`：`prepare-electron-headers.json`；`logs/prepare-electron-headers.log`。
- `candidate-full-complete`：`candidate-full-complete.json`；`logs/candidate-full-complete.log`。
- `native-isolation-final-node`：`原执行JSON已被摘要覆盖；元数据恢复自本会话工具返回`；`logs/native-isolation-final-node.log`。
- `native-isolation-final-node-after-rebuild`：`native-isolation-final-node-after-rebuild.json`；`logs/native-isolation-final-node-after-rebuild.log`。
- `candidate-typecheck-complete`：`candidate-typecheck-complete.json`；`logs/candidate-typecheck-complete.log`。
- `candidate-node-stress-2`：`candidate-node-stress-2.json`；`logs/candidate-node-stress-2.log`。
- `candidate-node-stress-5`：`candidate-node-stress-5.json`；`logs/candidate-node-stress-5.log`。
- `candidate-node-stress-1`：`candidate-node-stress-1.json`；`logs/candidate-node-stress-1.log`。
- `candidate-node-stress-4`：`candidate-node-stress-4.json`；`logs/candidate-node-stress-4.log`。
- `candidate-build-complete`：`candidate-build-complete.json`；`logs/candidate-build-complete.log`。
- `candidate-node-stress-3`：`candidate-node-stress-3.json`；`logs/candidate-node-stress-3.log`。
- `candidate-native-electron`：`candidate-native-electron.json`；`logs/candidate-native-electron.log`。
- `candidate-electron-sqlite`：`candidate-electron-sqlite.json`；`logs/candidate-electron-sqlite.log`。
- `candidate-electron-tests`：`candidate-electron-tests.json`；`logs/candidate-electron-tests.log`。
- `candidate-joint-ui`：`candidate-joint-ui.json`；`logs/candidate-joint-ui.log`。
- `candidate-recovery-ui`：`candidate-recovery-ui.json`；`logs/candidate-recovery-ui.log`。
- `candidate-joint-exitdb`：`candidate-joint-exitdb.json`；`logs/candidate-joint-exitdb.log`。
- `candidate-recovery-exitdb`：`candidate-recovery-exitdb.json`；`logs/candidate-recovery-exitdb.log`。


## 最终补充核对与审批设施说明

以下只读诊断不改变前述测试总数。所有业务/测试源码最终指纹为 `56628eed121eb81ab2b93745fb605509cfcc76dbe874d69bbb402f60bdfc1502`，最终612回归、类型、构建、压力及Electron验证前后均相同。后续仅写治理文档。

| UTC开始 / label | 上限秒 / mode | exit | 实际argv | 结果 |
| --- | --- | --- | --- | --- |
| 2026-10-16T02:26:42.730079+00:00<br>`candidate-final-audit` | 30.0 / `tool` | 1 | `python3 /private/tmp/roundtable-shared-r78-xs758rt3/final-audit.py` | 诊断脚本错误假定所有旧Worktree都有build/config.gypi；两个旧环境缺文件导致FileNotFoundError。不是产品测试失败，未改旧环境。 |
| 2026-10-16T02:26:53.938458+00:00<br>`candidate-final-audit-corrected` | 30.0 / `tool` | 0 | `python3 /private/tmp/roundtable-shared-r78-xs758rt3/final-audit.py` | 对旧环境缺失config标未知后完成只读盘点：12个WT保留，11个旧WT均干净；新WT与main ABI139，12个native inode独立；migration1/2、package/lock及生产接线不变，两profile隔离/错误数组通过。 |

另有一次迁移测试写入/执行申请在自动审批服务额度耗尽时被拒绝启动；未执行、无退出码，明确不作为业务失败或PASS。用户“继续”后沿正常提权审批恢复执行，未绕过审批。之前的首次安装审批deadline同样未启动，已在上文保留。当前无审批阻塞。

只读Git检查使用 git status --porcelain=v1、rev-parse HEAD、branch --show-current、worktree list --porcelain、diff --stat、diff及show；最终暂存清单/文档链接/diff --check由总控提交前核对。扫描不是完整Git历史敏感信息审计（该项仍属R17），未把Key或DB日志纳入提交。

原始JSON/log位于本机临时证据根，可能被系统清理；本仓库保留精确命令、环境、退出码、统计及失败原因，不以临时目录存在作为未来开发依赖。重跑需按ENVIRONMENT重新准备受控runtime和独立依赖。

提交前补充只读检查实际exit0：git diff --check；git status --short；git diff --numstat；Python逐项核对26个候选文件、97个本地Markdown链接及原始135bf82的migration1逐字相同。新增文件清单无数据库、native二进制、环境文件或构建/日志目录；本项是当前候选清单审查，不替代R17全历史审计。
