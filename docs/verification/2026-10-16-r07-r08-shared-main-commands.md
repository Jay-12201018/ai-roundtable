# R07/R08 共享前置主线验收实际命令台账

2026-10-16；工作目录 `/Users/zhangwenjie/Documents/ChatGPT/AI交互`。本次独立证据根 `/private/tmp/roundtable-r78-main-au0w4nl4`，不是候选Worktree的历史结果。合并前HEAD510f58a，ff-only后及本次全部产品检查HEAD1e1f971。共22条有界监督命令，全部exit0，无失败/skip/超时；Git/清单辅助命令另记。

## 环境与执行前缀

- 官方Node24.18.1/darwin-arm64/ABI137：`/private/tmp/roundtable-r02-integration-b0c3ktgt/runtime-24.18.1/node-v24.18.1-darwin-arm64`；同发行包include/config；runtime与headers archive SHA分别eb02f7fa…b941 / bee7344a…fded，完整SHA见ENVIRONMENT与本轮source-verification.json。
- pnpm11.25.0真实入口：`/Users/zhangwenjie/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pnpm/bin/pnpm.mjs`；临时bin/node指向上述官方运行时，bin/pnpm显式用它exec入口并固定本轮store/cache/state，未使用raw数字fetch参数。
- 所有命令经本root的run-check.py，有独立<label>.json和logs/<label>.log，记录argv/cwd/mode/上限/UTC/HEAD/tree/前后源码指纹/exit/耗时；超时TERM再KILL、禁core、label不允许覆盖。node模式严格设npm_config_nodedir=上述完整发行包、build_from_source=true；electron模式设本root/electron-headers/38.8.6，electron-node仅ELECTRON_RUN_AS_NODE=1，tool不设编译目标。
- 每种mode都清除继承NODE_OPTIONS和旧构建目标；新建npm-cache、electron-gyp、electron-cache、builder-cache、TMPDIR=test-tmp、XDG cache/config/data/state和空user/global npmrc；HOME不改。Node/Electron重建串行，所有Node检查结束才切Electron。
- 本轮没有install：使用main自身既有、独立inode的node_modules，盘点锁/32直接依赖；不复制依赖、不将历史干净安装当本次PASS。Electron38.8.6/内嵌Node22.22.0/ABI139与better-sqlite3 12.11.1沿锁文件。

```sh
R78_MAIN_ROOT=/private/tmp/roundtable-r78-main-au0w4nl4
python3 "$R78_MAIN_ROOT/run-check.py" <唯一label> <上限秒> <mode> <下表实际argv...>
# 仅示例：实际下表每条均已执行，重跑必须使用新label并重新准备环境。
# main-merge-ff-only的脚本先重查两个HEAD、所有WT干净及祖先，再执行：
git merge --ff-only codex/shared-r07-r08-foundation
```

## 按真实开始时间排列

| UTC开始 / label | 上限秒 / mode | exit / 耗时秒 | 实际argv | 结果 |
| --- | --- | --- | --- | --- |
| 2026-10-16T04:23:11.235887+00:00<br>`main-source-verify` | 60.0 / tool | 0 / 0.948 | `python3 /private/tmp/roundtable-r78-main-au0w4nl4/setup.py` | 非测试：runtime/headers/archive与pnpm字节、实际版本来源重新核验。 |
| 2026-10-16T04:23:21.441696+00:00<br>`main-electron-headers` | 30.0 / tool | 0 / 0.143 | `python3 /private/tmp/roundtable-r78-main-au0w4nl4/prepare-electron-headers.py` | 非测试：125个对应Electron头文件字节匹配，独立副本。 |
| 2026-10-16T04:24:02.680649+00:00<br>`main-merge-ff-only` | 30.0 / tool | 0 / 0.247 | `python3 /private/tmp/roundtable-r78-main-au0w4nl4/merge-ff.py` | Git操作：510f58a→1e1f971 fast-forward；树等于获批候选，未生成merge commit。 |
| 2026-10-16T04:24:13.344116+00:00<br>`main-full` | 180.0 / node | 0 / 16.682 | `pnpm test --reporter=dot` | 44文件612通过；pretest实际源码编译Node ABI137。 |
| 2026-10-16T04:24:14.882527+00:00<br>`main-typecheck` | 60.0 / tool | 0 / 1.603 | `pnpm typecheck` | strict tsc exit0。 |
| 2026-10-16T04:24:16.407537+00:00<br>`main-build` | 90.0 / tool | 0 / 2.616 | `pnpm build` | Main/单CJS Preload/Renderer生产构建exit0。 |
| 2026-10-16T04:25:02.048518+00:00<br>`main-node-sqlite` | 30.0 / node | 0 / 0.05 | `node /private/tmp/roundtable-r78-main-au0w4nl4/sqlite-probe.cjs` | Node ABI137内存SQL读写、close与正常退出。 |
| 2026-10-16T04:25:02.976818+00:00<br>`main-installed-node` | 30.0 / node | 0 / 0.05 | `node /private/tmp/roundtable-r78-main-au0w4nl4/installed-probe.cjs` | Node24.18.1/ABI137/arm64，锁字节一致，32直接依赖实际版本盘点。 |
| 2026-10-16T04:25:03.630177+00:00<br>`main-node-stress-2` | 60.0 / node | 0 / 0.357 | `node /private/tmp/roundtable-r78-main-au0w4nl4/sqlite-probe.cjs --stress` | 5轮之一：独立Node进程300000次prepare/get与自然分配，正常退出。 |
| 2026-10-16T04:25:03.737845+00:00<br>`main-node-stress-4` | 60.0 / node | 0 / 0.357 | `node /private/tmp/roundtable-r78-main-au0w4nl4/sqlite-probe.cjs --stress` | 5轮之一：独立Node进程300000次prepare/get与自然分配，正常退出。 |
| 2026-10-16T04:25:04.019134+00:00<br>`main-node-stress-3` | 60.0 / node | 0 / 0.359 | `node /private/tmp/roundtable-r78-main-au0w4nl4/sqlite-probe.cjs --stress` | 5轮之一：独立Node进程300000次prepare/get与自然分配，正常退出。 |
| 2026-10-16T04:25:05.183345+00:00<br>`main-shared-special` | 60.0 / node | 0 / 1.27 | `pnpm exec vitest run tests/unit/contracts/configuration.test.ts tests/unit/configuration tests/integration/configuration --reporter=dot` | 4文件78通过：DTO/CRUD/引用/Key/migration3。 |
| 2026-10-16T04:25:05.250539+00:00<br>`main-node-stress-5` | 60.0 / node | 0 / 0.47 | `node /private/tmp/roundtable-r78-main-au0w4nl4/sqlite-probe.cjs --stress` | 5轮之一：独立Node进程300000次prepare/get与自然分配，正常退出。 |
| 2026-10-16T04:25:07.181819+00:00<br>`main-node-stress-1` | 60.0 / node | 0 / 0.359 | `node /private/tmp/roundtable-r78-main-au0w4nl4/sqlite-probe.cjs --stress` | 5轮之一：独立Node进程300000次prepare/get与自然分配，正常退出。 |
| 2026-10-16T04:25:30.033592+00:00<br>`main-native-electron` | 180.0 / electron | 0 / 10.872 | `pnpm native:electron` | 对应38.8.6 headers强制源码重建完成。 |
| 2026-10-16T04:26:08.696525+00:00<br>`main-electron-special` | 90.0 / electron-node | 0 / 3.229 | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron node_modules/vitest/vitest.mjs run tests/unit/database.test.ts tests/unit/persistence tests/integration/persistence tests/integration/configuration tests/unit/configuration tests/unit/contracts/configuration.test.ts tests/integration/joint --reporter=dot` | 18文件190通过：数据库/持久化/配置/Key/契约/联合。 |
| 2026-10-16T04:26:10.253829+00:00<br>`main-electron-sqlite` | 30.0 / electron-node | 0 / 0.219 | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron /private/tmp/roundtable-r78-main-au0w4nl4/sqlite-probe.cjs` | 实际Electron38.8.6/Node22.22.0/ABI139内存SQL和正常退出。 |
| 2026-10-16T04:26:26.713270+00:00<br>`main-joint-ui` | 60.0 / tool | 0 / 3.924 | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r01-electron.cjs --joint-ui` | 新profile O84Uv3，生产DOM/刷新/Mock控制与有限Bridge，PASS并正常退出。 |
| 2026-10-16T04:26:36.436095+00:00<br>`main-recovery-ui` | 60.0 / tool | 0 / 1.711 | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r01-electron.cjs --r03-recovery` | 另一新profile Gj8Kfm，v1→3迁移、9状态恢复及Bridge，PASS并正常退出。 |
| 2026-10-16T04:27:02.294954+00:00<br>`main-recovery-exitdb` | 30.0 / electron-node | 0 / 0.086 | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r01-sqlite.cjs /private/tmp/roundtable-r78-main-au0w4nl4/test-tmp/roundtable-r01-electron-Gj8Kfm/probe-result.json` | 只读本轮临时DB/备份：4类interrupted、终态/idle原证据、v1备份SHA及未知输入保留。 |
| 2026-10-16T04:27:02.322002+00:00<br>`main-joint-exitdb` | 30.0 / electron-node | 0 / 0.085 | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r01-sqlite.cjs /private/tmp/roundtable-r78-main-au0w4nl4/test-tmp/roundtable-r01-electron-O84Uv3/probe-result.json` | 只读本轮临时DB：消息/Attempt、公共输入及退出cancelled持久化一致。 |
| 2026-10-16T04:27:31.522512+00:00<br>`main-post-audit` | 30.0 / tool | 0 / 1.383 | `python3 /private/tmp/roundtable-r78-main-au0w4nl4/post-main-audit.py` | 非测试：18项关键检查均exit0/同源码；12WT干净、仅main ref推进、native inode独立、v1/v2字节与profile安全配置核对。 |

## 失败记录、警告及源码身份

辅助文档生成脚本首次因把main-post-audit.json误写为post-main-audit.json而FileNotFoundError、exit1，发生在写任何项目文件前；更正同一证据路径后重新生成。它不属于产品测试，保留真实失败，不计为上述监督测试通过。

本轮截至上述22命令无非零退出、无失败测试、无skip/超时，也没有通过修改测试或实现来消除失败。候选阶段的red/权限/诊断失败原台账完整保留为历史，不改写成本轮失败或本轮PASS。构建存在既有Zod PURE注释Rollup警告，Node编译存在libc++/函数指针提示，桌面stderr有sandbox_extension诊断，post-audit的Git调用带Xcode缓存/事件流诊断；对应命令实际exit0，未改变sandbox/CSP或忽略断言。

ff操作前后源码指纹按预期改变；所有合并后产品检查均为 `56628eed121eb81ab2b93745fb605509cfcc76dbe874d69bbb402f60bdfc1502`，检查前后不变，受检Git树 `c4f3658f1f4fa7c4808199ffd9b835685732d192`。后续仅更新治理文档，不再次改变业务/测试/构建输入。

Git辅助核对实际exit0：status --porcelain=v1、rev-parse、merge-base --is-ancestor、rev-list --count、worktree list --porcelain、show-ref、diff --name-only/--check及Python premerge-audit。原始migration1逐字比较与v2字节比较通过；这些不算另一次业务测试。提交前后文档链接/敏感文件/暂存清单和所有WT的最后状态由最终交付登记。

证据profile路径：joint=`test-tmp/roundtable-r01-electron-O84Uv3/probe-result.json`，recovery=`test-tmp/roundtable-r01-electron-Gj8Kfm/probe-result.json`，均为本轮新生成，ready前隔离；退出checker只读自身临时目录。当前Main仅MockProvider，KeyService只getStatus；Chromium webRequest阻断不覆盖Node原生网络，故无付费结论还依赖已核对的Main/测试装配。没有真实Key存取/加解密。

有限探针只证明现有room/run Bridge未回归，不证明新R07/R08 API生产接线或功能UI。真实模型/系统Key后端、正式E2E、发布/跨平台、冷缓存安装和断电极限仍未验证；本轮未实施R09/R17。临时证据可能被系统清理，未来复验应按ENVIRONMENT重新准备，不把临时路径作为项目依赖。


提交前实际辅助命令：`python3 /private/tmp/roundtable-r78-main-au0w4nl4/update-main-docs.py` 首次exit1（错误证据文件名，尚未写项目文件）、更正后exit0。`git diff --check`、Python10份纯文档/119本地链接/源码指纹核对均exit0；候选及当前治理合计29个不同文件的敏感路径/凭据模式扫描exit0、无命中文件。模式扫描只覆盖此次差异，不代表完整历史或任意秘密识别；R17历史审计未实施。
