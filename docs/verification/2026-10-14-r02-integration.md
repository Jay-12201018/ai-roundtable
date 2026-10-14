# R02 总控集成审核记录（历史阻塞阶段，未合main）

> 后续更正：ENV-R02-INSTALL-01已定位为总控临时raw数值参数类型错误，并完成两次干净安装及全套复验；见[环境修复报告](2026-10-14-r02-environment.md)。下面保留原阶段失败命令/退出码，原“暂不建议合main”结论仅代表当时状态；raw `--config.fetch-timeout` 示例不得复用。R02当前待最终合并审核，尚未合main或verified。

2026-10-14，Asia/Shanghai。本轮只审查/补齐/验证R02，未合main，未启动R03。代码审核与现有隔离依赖的适用检查通过；默认干净安装复现未完成，**暂不建议合main，不标verified**。

## Git与范围

开始时实际main为 `b690a1e2cefb485e81b35292bfb875bd19b88a2b`，干净、R01 verified。原 `codex/r02-contracts` / `14f07a22b44bcd2459dd44f579230792033d9301` 干净，直接父提交就是该main。原始135bf82历史保留。

原生工具创建 `/Users/zhangwenjie/.codex/worktrees/integrate-r02/AI交互`，分支 `codex/integrate-r02`。cherry-pick引入为 `bafa84f55b6c77aeaffe26b27caae56fb67cbcf0`，文件树与原交付完全一致，保持原分支/Worktree。原交付37文件，未改变package/lock、Database/SQL/migration、Main生命周期及窗口/CSP。

总控补充8文件：`src/shared/schemas/common.ts`、`tests/unit/contracts/dto.test.ts`、`tests/unit/contracts/service.test.ts`、`docs/CONTRACTS.md`、`docs/DECISIONS.md`、`docs/STATUS.md`、`docs/ENVIRONMENT.md`及本记录。本记录与补充修复一同提交，实际SHA由最终Git交付列出；不能将bafa84f冒充覆盖后续修复的提交。无新增真实Provider/业务模块、依赖升级或全局Node修改。

## 实际源码审核

完整读取AGENTS、SPEC、STATUS、CONTRACTS、DECISIONS、VALIDATION、R02任务和完整原交接。两路独立只读审查追踪Schema/IPC/Preload和RunService/Mock/Renderer/原tests；最终补充代码也经只读复核，未确认其他P0/P1/P2阻塞。静态结论不替代测试。

- DTO/输入/输出/事件类型从Shared Schema派生，Shared不依赖Electron/SDK/DB。Main、Preload严格单参数、v1 envelope、requestId响应关联及事件/快照身份校验；Renderer消费Shared，Bridge保留有限方法。公开错误/field白名单/stack处理不暴露原始异常。
- RunEvent判别、版本、run/turn/request/message/agent关联、序号/游标及unknown安全重同步均有实现。v0可解析记录只在输出边界适配，不改原数据/错误/部分输出/requestId，不自动重发可能收费请求；损坏JSON恢复仍留R03。
- RunService正常shutdown paused的R01逻辑保留。Provider检查顺序、身份、公开错误、部分输出保存；Mock无网络。Provider协议不提前实现真实网络。App仅一行消费snapshot_required控制标记，避免未持久化标记导致无限重同步，配套游标不变回归；未扩大视觉/store/调度。原tests保留，无删/skip/放宽安全断言。
- **P1已补齐：workflowSnapshot任意JSON可绕过凭据边界。** 原Schema接受apiKey等并原样持久化、普通快照返回；当前UI不主动传Key，不声称真实用户发生泄漏。同一Schema递归拒绝14类明确凭据字段（忽略大小写、-、_，覆盖数组），普通JSON/引用保留，不扫描任意文本。新输入写盘前拒绝，旧敏感配置拒绝输出，原数据库记录不删改。红测19失败，DTO绿测48项；实际service测试证明无run/message/活动锁落地及旧记录保留。见R02-INTEGRATION-01。

## 隔离与受控环境

独立复制main现有锁定node_modules，lock字节一致、2475个symlink在原依赖目录内、SQLite inode不同；不共享可变依赖。新增测试用:memory:，已有tests使用Mock/fixture/临时数据。实际桌面probe在ready/Main导入前隔离userData/sessionData/logs且阻断网络；没有访问真实用户DB/Key或付费模型。临时日志与依赖不入库。

临时根 `/private/tmp/roundtable-r02-integration-b0c3ktgt`。官方Node24.21.0、24.18.1 runtime/header archive均从nodejs.org下载并逐项验证官方SHA。最终项目测试使用**官方24.18.1 runtime与同一darwin-arm64 runtime include/config严格配对**：pnpm11.25.0、node-gyp12.3.0、Python3.14.5、Apple clang21.0.0、TypeScript5.9.3、Vitest3.2.7、SQLite12.11.1、Electron38.8.6。实际gyp日志确认node_root_dir/common.gypi，build/config.gypi为arm64/ABI137。未用24.21 runtime+24.18 headers混合绕法。

## 本次实际命令与结果

下面命令cwd均为集成Worktree，除干净安装注明的临时副本。最终Node命令统一前缀 `PATH=/private/tmp/roundtable-r02-integration-b0c3ktgt/bin-24.18.1:$PATH`；凡含native:node/pretest，另设 `npm_config_nodedir=/private/tmp/roundtable-r02-integration-b0c3ktgt/runtime-24.18.1/node-v24.18.1-darwin-arm64 npm_config_build_from_source=true npm_config_cache=/private/tmp/roundtable-r02-integration-b0c3ktgt/npm-cache-24.18.1`。日志文件均位于临时根logs，CPP复现另在objectwrap-repro。

| 实际命令/检查 | Exit | 结果/日志 |
| --- | --- | --- |
| 修复前 `PATH=<临时diagnostic-bin>:$PATH pnpm exec vitest run tests/unit/contracts/dto.test.ts --reporter=dot` | 1 | 48项，19失败/29通过；workflow-secret-red.log |
| 同临时Node运行真实schema、仅DTO临时config/cacheDir | 0 | 修复后48/48；workflow-secret-green.log |
| 同临时Node运行5个无SQL契约文件临时config | 0 | 81/81，不含service，不当完整验收；pure-contracts.log |
| 严格配对 `pnpm run native:node` | 0 | 从源码编译既有SQLite；native-node-24.18.1.log |
| `<24.18.1>/bin/node <临时根>/sqlite-allocation.cjs`，每次:memory:300000次prepare/get，重复5次 | 0×5 | 最终正常退出/结果断言，sqlite-allocation-results.json及5份日志 |
| `pnpm exec vitest run tests/unit/contracts --reporter=dot` | 0 | **6文件94/94**，含service新测试；contracts-matched.log |
| `pnpm run test --reporter=dot`，含严格配对pretest原生重编译 | 0 | **18文件228/228**，默认pool，无skip/errors；full-regression-matched.log |
| `pnpm run typecheck` | 0 | TypeScript无错；typecheck-matched.log |
| `pnpm run build` | 0 | Main/Renderer/CJS Preload生产产物；production-build-matched.log |
| `npm_config_cache=<临时根>/npm-cache-electron pnpm run native:electron` | 0 | 固定Electron强制重建完成；native-electron.log |
| `ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron -e '<VALIDATION内存建表/写/读/关闭断言>'` | 0 | **Electron38.8.6、ABI139**；electron-abi-rebuilt.log |
| `env -u ELECTRON_RUN_AS_NODE ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r01-electron.cjs` | 0 | **实际生产页面/Bridge/Mock IPC通过**；electron-startup.log |
| `ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/r01-sqlite.cjs /var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-r01-electron-kPJxkp/probe-result.json` | 0 | 退出后只读核对cancelled，messages/turns/requestId保留，Key/Provider为空；electron-shutdown-sqlite.log |

Probe实际偏好sandbox/contextIsolation/webSecurity=true、nodeIntegration=false；window.require/process不存在，App已渲染。构建路径仅 `../preload/index.cjs` 且目录只有该产物。12个事件实际接收、取消订阅两次后不再接收；生产CSP无dev来源，无preload/console/CSP错误及网络请求。仅有限生产探针，不冒充正式E2E或打包应用安装验收。

## 原生兼容性专项

独立C++ node::ObjectWrap最小addon**不导入SQLite、Zod、Vitest或R02**。编译命令为 `clang++ -std=c++20 -fPIC -shared -Wl,-undefined,dynamic_lookup -I<该官方runtime>/include/node -DNODE_GYP_MODULE_NAME=sample -o <tmp>/sample-<version>.node <tmp>/sample.cc`，随后严格同版runtime执行allocate.cjs，300000个Wrapped对象及普通对象自然分配GC，禁core dump。两版编译均exit0。

| runtime + headers/config | ABI | 5次实际退出 |
| --- | --- | --- |
| 官方24.21.0 + 同版darwin-arm64 include/config | 137 | **5/5 SIGABRT**（Python-6，shell等效134），RemoveEnvironmentCleanupHook(env=null)断言 |
| 官方24.18.1 + 同版darwin-arm64 include/config | 137 | **5/5 exit0** |

与 [Node官方issue #65446](https://github.com/nodejs/node/issues/65446) 的ObjectWrap回补问题相符；独立审查者另一次严格24.21复现同断言。本轮证明这一断言不需要R02业务；SQLite的Database/Statement等继承ObjectWrap，有源码关联。严格24.18项目SQLite压力/全回归及Electron也通过，支持将已观察的原生断言归入上游环境风险，而非R02业务缺陷。仍不声称排除所有未来原生故障。

ABI相同不代表跨补丁headers兼容，本次没有依赖原交接混用头文件。runtime/include关键node_version.h/node_object_wrap.h与同版headers archive字节相同；generic headers config.gypi的平台/CPU/compiler flags与darwin runtime不同，不能简单要求全部gypi字节相同。官方hash和治理要求见[ENVIRONMENT](../ENVIRONMENT.md)。默认24.21.0编译环境仍有风险，不能只因同ABI接受。

## 初次失败与干净安装待项

- 两次runtime下载初次curl28/60秒超时，续传后完整SHA核验通过；未执行不完整文件。初次把平台config.gypi全字节相同当条件的诊断断言失败，检查diff后纠正为对应平台版本核对。
- 早先原生提权请求自动审批账号额度失败，**动作未执行**，非不安全判断；未绕过。独立生产构建审批恢复后，新的严格配对原生请求获准并通过。代理后续额度失败未算新审查；恢复后完成只读候选复核。
- 默认沙箱 `pnpm run build` exit1，electron-vite不能在受保护Worktree写配置临时mjs；获准重试exit0，随后严格24.18构建也exit0。SQLite编译有libc++平台/函数指针告警，生产构建有Zod PURE注解位置告警；构建成功不将告警隐藏。Electron启动有sandbox_extension文件提示，实际probe与最终退出exit0、隔离断言均通过。
- 干净安装全新副本、独立store/cache、固定lock/allowBuilds；Node24.18.1默认安装停在646 resolved/0 downloaded。只读确认其无网络连接、打开临时pnpm store SQLite；结束仅核对过的本任务进程（exit143）。curl HEAD及Node GET官方registry均exit0/HTTP200，具体停滞原因未定。不能单凭打开store SQLite文件就认定其造成停滞。
- 24.21.0新store `pnpm install --frozen-lockfile --ignore-scripts`（用于定位，不算可运行安装）同样无下载，180秒有界执行exit124。24.18.1另一个新store、`PNPM_MAX_WORKERS=1`、保留安装脚本的180秒试验同样0 downloaded、exit124。不是修改Vitest pool、放宽测试或更改项目配置；不能按安装目录存在宣布成功。

安装完整参数记录如下（R02_TMP表示上述本轮临时根，PATH分别为bin-24.18.1与bin-24.21.0，不改项目配置）：

```sh
pnpm --config.cache-dir=$R02_TMP/clean-pnpm-cache --config.state-dir=$R02_TMP/clean-pnpm-state --config.store-dir=$R02_TMP/clean-pnpm-store --config.fetch-timeout=60000 --config.fetch-retries=1 install --frozen-lockfile
pnpm --config.cache-dir=$R02_TMP/clean21-pnpm-cache --config.state-dir=$R02_TMP/clean21-pnpm-state --config.store-dir=$R02_TMP/clean21-pnpm-store --config.fetch-timeout=60000 --config.fetch-retries=1 install --frozen-lockfile --ignore-scripts
PNPM_MAX_WORKERS=1 pnpm --config.cache-dir=$R02_TMP/clean1-pnpm-cache --config.state-dir=$R02_TMP/clean1-pnpm-state --config.store-dir=$R02_TMP/clean1-pnpm-store --config.fetch-timeout=60000 --config.fetch-retries=1 install --frozen-lockfile
```

两个24.18.1安装另设完整对应runtime的npm_config_nodedir/build_from_source，npm/Electron缓存均在临时根；两个有界实验由Python subprocess.run(timeout=180)执行并记录124，首个经核对PID后SIGTERM返回143。结果JSON为clean-install-24.21-result.json与clean-install-single-worker-result.json。

**干净依赖安装/测试/打包可复现性尚未通过，保留ENV-R02-INSTALL-01环境阻塞。** 无依赖/全局Node升级，未用历史206/206或copied-module初次ABI PASS代替最终重建结果。本机现有依赖的原生稳定证据与干净安装可靠性分开。

## 集成建议与停止

代码与当前受控隔离环境检查通过，P1凭据边界已补齐；但干净安装仍阻塞，**暂不建议正式合main**。先按ENV-R02-INSTALL-01定位并完成固定lock安装/严格编译/回归/构建/Electron链路，再提环境固定方案及合并请求。

main保持b690a1e、原R02分支/Worktree及R01历史保留；R02为blocked/待最终集成审核，未merged/verified，R03未授权、未创建Worktree。正式桌面E2E、打包应用安装/升级、Windows/Linux、签名/公证、真实Provider/Key仍未验证。本记录与修复提交后的main/原子项目/集成工作区状态由交付现场Git核查报告，不预先宣称干净。
