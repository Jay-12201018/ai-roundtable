# R04/R05/R06 本次 main 合并与验收命令台账

执行日期：2026-10-16（Asia/Shanghai）；下表起始时间为UTC。主线受检目录 `/Users/zhangwenjie/Documents/ChatGPT/AI交互`。`candidate-*`是本轮合并前独立集成Worktree复验，不能代替`main-*`。此前10月15日联合台账仍是历史。

## 环境及监督

实际外层命令：`python3 /private/tmp/roundtable-r456-main-9z3bgq6i/run-check.py <label> <上限秒> <mode> <argv>`。每项保存真实exit、起止源指纹、Git HEAD/tree、UTC起点、耗时、stdout/stderr；超时TERM后5秒KILL，core关闭。各项均实际正常退出，没有超时。

root为本轮独立临时目录，不是应用依赖。node模式用官方24.18.1/darwin-arm64的完整runtime/include/config、build_from_source=true；electron模式清除宿主Node目标，指向本轮独立38.8.6 headers；electron-node设置ELECTRON_RUN_AS_NODE=1且不带宿主headers；tool只保留受控PATH。每模式清继承NODE_OPTIONS/ELECTRON_RUN_AS_NODE/nodedir/build_from_source，使用自己的空user/global npmrc和npm/electron/builder/gyp/XDG/TMPDIR目录，不改HOME或系统Node。

Node路径 `/private/tmp/roundtable-r02-integration-b0c3ktgt/runtime-24.18.1/node-v24.18.1-darwin-arm64`；pnpm入口 `/Users/zhangwenjie/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pnpm/bin/pnpm.mjs`。临时pnpm shim显式exec该Node和pnpm11.25.0，并附独立store/cache/state路径配置，不带raw数字fetch参数。

本轮`python3 <root>/setup.py`实际exit0，重新验证Node官方runtime/headers tar SHA及本地bin/node、node_version.h、node_object_wrap.h/config.gypi字节；pnpm入口/bundle/worker/package与官方缓存tar一致。只读复用已核验runtime，Electron同版headers复制到本轮root，不共享可变依赖。没有执行install、升级依赖或复制node_modules，不声明本轮干净安装/冷下载PASS。

## 实际命令

| label / UTC开始 | 工作区 | mode / 上限秒 | exit / 耗时秒 | 输出摘要 | argv |
| --- | --- | --- | --- | --- | --- |
| `candidate-full` 16:44:33 | 集成WT | node / 180 | 0 / 16.675 | Tests 534 passed (534) | `pnpm test --reporter=dot` |
| `candidate-restore-electron` 16:45:16 | 集成WT | electron / 180 | 0 / 11.068 | 正常退出；范围见主线报告 | `pnpm native:electron` |
| `merge-main` 16:45:56 | main | tool / 30 | 0 / 0.36 | 正常退出；范围见主线报告 | `python3 /private/tmp/roundtable-r456-main-9z3bgq6i/merge-main.py` |
| `main-full` 16:46:10 | main | node / 180 | 0 / 16.295 | Tests 534 passed (534) | `pnpm test --reporter=dot` |
| `main-build` 16:46:13 | main | tool / 90 | 0 / 2.927 | 正常退出；范围见主线报告 | `pnpm build` |
| `main-typecheck` 16:46:13 | main | tool / 60 | 0 / 1.688 | 正常退出；范围见主线报告 | `pnpm typecheck` |
| `candidate-abi139-check` 16:46:41 | 集成WT | electron-node / 30 | 0 / 0.655 | 正常退出；范围见主线报告 | `./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron /private/tmp/roundtable-r456-main-9z3bgq6i/sqlite-probe.cjs` |
| `main-node-stress-2` 16:47:04 | main | node / 60 | 0 / 0.353 | 正常退出；范围见主线报告 | `node /private/tmp/roundtable-r456-main-9z3bgq6i/sqlite-probe.cjs --stress` |
| `main-node-stress-1` 16:47:06 | main | node / 60 | 0 / 0.361 | 正常退出；范围见主线报告 | `node /private/tmp/roundtable-r456-main-9z3bgq6i/sqlite-probe.cjs --stress` |
| `main-node-stress-4` 16:47:06 | main | node / 60 | 0 / 0.358 | 正常退出；范围见主线报告 | `node /private/tmp/roundtable-r456-main-9z3bgq6i/sqlite-probe.cjs --stress` |
| `main-node-stress-5` 16:47:07 | main | node / 60 | 0 / 0.364 | 正常退出；范围见主线报告 | `node /private/tmp/roundtable-r456-main-9z3bgq6i/sqlite-probe.cjs --stress` |
| `main-node-stress-3` 16:47:07 | main | node / 60 | 0 / 0.357 | 正常退出；范围见主线报告 | `node /private/tmp/roundtable-r456-main-9z3bgq6i/sqlite-probe.cjs --stress` |
| `main-installed` 16:47:08 | main | node / 30 | 0 / 0.053 | 正常退出；范围见主线报告 | `node /private/tmp/roundtable-r456-main-9z3bgq6i/installed-probe.cjs` |
| `main-r456` 16:47:10 | main | node / 90 | 0 / 2.17 | Tests 265 passed (265) | `pnpm exec vitest run tests/unit/stateMachine.test.ts tests/unit/mockProvider.test.ts tests/integration/run tests/integration/runControls.test.ts tests/integration/mockRun.test.ts tests/unit/context tests/integration/context tests/unit/rendererStore tests/unit/rendererSubscriptions tests/unit/rendererSync.test.tsx tests/integration/joint --reporter=dot` |
| `main-node-sqlite` 16:47:10 | main | node / 30 | 0 / 0.055 | 正常退出；范围见主线报告 | `node /private/tmp/roundtable-r456-main-9z3bgq6i/sqlite-probe.cjs` |
| `main-native-electron` 16:47:36 | main | electron / 180 | 0 / 11.271 | 正常退出；范围见主线报告 | `pnpm native:electron` |
| `main-electron-sqlite` 16:48:19 | main | electron-node / 30 | 0 / 0.582 | 正常退出；范围见主线报告 | `./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron /private/tmp/roundtable-r456-main-9z3bgq6i/sqlite-probe.cjs` |
| `main-electron-tests` 16:48:24 | main | electron-node / 90 | 0 / 2.265 | Tests 112 passed (112) | `./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron node_modules/vitest/vitest.mjs run tests/unit/database.test.ts tests/unit/persistence tests/integration/persistence tests/integration/joint --reporter=dot` |
| `main-ui` 16:48:26 | main | tool / 60 | 0 / 4.073 | 正常退出；范围见主线报告 | `./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r01-electron.cjs --joint-ui` |
| `main-recovery` 16:49:00 | main | tool / 60 | 0 / 1.76 | 正常退出；范围见主线报告 | `./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r01-electron.cjs --r03-recovery` |
| `main-ui-exit` 16:49:05 | main | electron-node / 30 | 0 / 0.094 | 正常退出；范围见主线报告 | `./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r01-sqlite.cjs /private/tmp/roundtable-r456-main-9z3bgq6i/test-tmp/roundtable-r01-electron-pcE3de/probe-result.json` |
| `main-recovery-exit` 16:49:41 | main | electron-node / 30 | 0 / 0.096 | 正常退出；范围见主线报告 | `./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r01-sqlite.cjs /private/tmp/roundtable-r456-main-9z3bgq6i/test-tmp/roundtable-r01-electron-phseY9/probe-result.json` |


## 额外只读检查、诊断和警告

- 合并前两次Python断言式Git核查均exit0：main仍37766666，候选d4a0d27，全部11个WT/HEAD/未跟踪文件干净；main没有候选未包含提交；仅4个新线性提交，三个原模块与引入patch-id各一次完全相同。`git diff --check` exit0；57变更文件未发现数据库头/Key形状/二进制/构建/原始日志/环境文件。Shared/Database/migration/IPC/Preload/windows/package/lock不变。
- 一次辅助inode盘点实际exit1：与candidate Electron rebuild并发读取时，原生文件正被重建移除，stat得到FileNotFoundError。确认重建exit0后串行重跑同一盘点exit0，11份原生文件inode独立；没有重试业务失败，也未碰真实数据库。此诊断失败保留，不写成所有命令从未失败。
- 合并后Python主线环境核对exit0：Node原生config137/arm64与匹配runtime，之后Electron config/header139/arm64；测试后Electron原生SHA不变。installed-probe只读32直接依赖版本、安装锁与仓库锁字节一致，不调用会写全局store的pnpm list。
- 主线恢复/真实UI的metadata均逐项检查PASS、ready前隔离、preload/console/CSP错误及网络请求数组为空；读取的都是本轮新临时profile。
- 原生编译有libc++平台支持及函数指针转换警告，构建有Zod PURE注释Rollup警告；Electron stderr有sandbox_extension_issue_file_to_process诊断。均保留原输出、命令exit0，没有弱化sandbox/CSP、断言或跳过测试。

## 源树一致性

fast-forward前main源指纹`b506872f341446ba2b7a8f1e321602fde826f9154b868650d4b7004a3fe603e3`，合入后为`052b5b9509a0daaa5036971322390ea0cc8d34c5166b4030841e4851752a934e`。merge-main是预期源树变化，不能当测试期间变化。全部main检查的前后指纹均为后者，Git HEAD为d4a0d2742eb28d2441e4d06e8154b8cdd6955336、tree362bb1da8746634b5d2c0940a1ec87d1b8eceba6。

指纹算法为git ls-files --cached --others --exclude-standard -z排序去重，选src/**、tests/**与package/lock/workspace/tsconfig/vitest/electron.vite配置，以路径字节+内容连续SHA256。验证完成后的治理文档更新不改变业务源码/测试/配置，提交后再次核对同一指纹。

本轮sqlite-probe仅:memory:写读/close，--stress每进程300000次prepare/get及自然分配，五进程正常退出；不是大数据/断电/跨平台试验。原始JSON/log、config及新profile只留root，仓库仅提交报告和本台账。下一次验证应新建自己的root并按ENVIRONMENT核验来源，不能把这些临时路径当长期依赖。


## 治理提交前复审

实际Python文档/敏感模式/范围/源指纹核对exit0：10份既有治理文档+2份报告，无业务/测试/配置差异，无断链、敏感模式或禁止数据文件；git diff --check exit0。只读协作者直接核对本轮JSON/log/metadata和报告中的requestId/数量/隔离事实后复审通过，未将其称作另一次测试执行。主控提交后仍检查全部WT和原分支、main父提交、完整SHA及同一源指纹。
