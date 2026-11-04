# R05 本轮真实验证台账

日期：2026-10-15（Asia/Shanghai）。基线 `37766666ff10981c302e54636cd0f0378d1c722e`；所有结果来自本 Worktree 当次执行，未复用旧 PASS。

最终结果：原基线 26文件/313项；R05 2文件/58项（55单元+3集成）；完整回归28文件/371项；typecheck/build均exit0；Electron38.8.6/ABI139实际SQLite内存读写关闭及58项R05专项均exit0。独立只读审查发现user/Attempt关联绕过，经红测修复后复核无其他阻断项。

## 受控环境与执行方法

- macOS/darwin arm64；官方Node24.18.1/ABI137，完整同发行包include/config；pnpm11.25.0，better-sqlite3 12.11.1，Vitest3.2.7。Node归档SHA256 `eb02f7fab96d3d67de40c5ec8566096fcb4c2026728787683ae5a97eb612b941`；headers归档SHA256 `bee7344a7fc6e3252c4822ca916a50cd6ddda9bb39374d6140a8046d9238fded`。runtime二进制及include/node2726文件与归档逐字节相同，pnpm来源及入口/bundle/worker/package逐项核验。
- 当前Worktree从无node_modules起点冻结离线安装，646 reused/0 downloaded；来源内容缓存20980文件与metadata661文件为独立inode，源索引immutable只读备份且源哈希未变。未复制node_modules、升级依赖、关闭供应链策略或修改全局Node。32直接依赖清单exit0；锁文件、workspace、27原测试/fixture哈希未变。
- 本轮独立根：`/private/tmp/roundtable-r05-environment-7h3d6evw`。JSON逐命令退出记录位于根目录，完整输出位于`logs/<label>.log`。临时目录可能被系统清理，本文件保留命令和结论。
- 所有表内命令以`python3 <root>/run-check.py <label> 300 <mode> <命令>`执行，外部300秒上限，当前cwd固定为R05 Worktree。`node`固定同版nodedir/build_from_source；`electron`固定独立38.8.6 headers源码重编译；`electron-node`设置ELECTRON_RUN_AS_NODE=1。每种模式先清除继承目标变量，隔离TMPDIR/npm/gyp/XDG/cache/store/state/user/global npmrc，PATH临时shim只指向以下固定Node和pnpm，不修改HOME。

```text
Node: /private/tmp/roundtable-r02-integration-b0c3ktgt/runtime-24.18.1/node-v24.18.1-darwin-arm64/bin/node
pnpm CLI: /private/tmp/roundtable-r02-network-v5u3mpn0/pnpm-11.25.0-official-source/package/bin/pnpm.mjs
Electron headers: /private/tmp/roundtable-r05-environment-7h3d6evw/electron-headers/38.8.6
```

node_modules原生目标切换严格串行，最终保留Electron ABI139。后续Node数据库测试必须先按ENVIRONMENT用受控环境native:node重编译；不能直接使用默认Node或在同一依赖上并发重编译。

## 全部有界命令记录

| label / 本地开始时间 | mode | 实际命令 | exit | 关键输出 |
| --- | --- | --- | ---: | --- |
| seed-cache / 12:22:18 | tool | `python3 /private/tmp/roundtable-r05-environment-7h3d6evw/seed-cache.py` | 0 | 见独立日志/退出记录 |
| install-offline / 12:22:32 | node | `pnpm install --frozen-lockfile --offline --package-import-method=copy --side-effects-cache=false --reporter=append-only` | 0 | 646 reused / 0 downloaded; scripts executed |
| native-node / 12:22:56 | node | `pnpm run native:node` | 0 | 见独立日志/退出记录 |
| baseline-313 / 12:23:13 | node | `pnpm exec vitest run --reporter=dot --exclude 'tests/unit/context/**' --exclude 'tests/integration/context/**'` | 0 | 26 passed (26); 313 passed (313) |
| sqlite-memory / 12:23:31 | node | `node /private/tmp/roundtable-r05-environment-7h3d6evw/sqlite-probe.cjs` | 0 | SQLite :memory: write/read/close; ABI137 |
| dependency-list / 12:23:47 | tool | `pnpm list --depth=0 --json` | 0 | 32 direct dependencies |
| sqlite-stress-1 / 12:23:47 | node | `node /private/tmp/roundtable-r05-environment-7h3d6evw/sqlite-probe.cjs --stress` | 0 | SQLite :memory: write/read/close; ABI137 |
| sqlite-stress-2 / 12:23:47 | node | `node /private/tmp/roundtable-r05-environment-7h3d6evw/sqlite-probe.cjs --stress` | 0 | SQLite :memory: write/read/close; ABI137 |
| sqlite-stress-3 / 12:23:47 | node | `node /private/tmp/roundtable-r05-environment-7h3d6evw/sqlite-probe.cjs --stress` | 0 | SQLite :memory: write/read/close; ABI137 |
| sqlite-stress-4 / 12:23:48 | node | `node /private/tmp/roundtable-r05-environment-7h3d6evw/sqlite-probe.cjs --stress` | 0 | SQLite :memory: write/read/close; ABI137 |
| sqlite-stress-5 / 12:23:48 | node | `node /private/tmp/roundtable-r05-environment-7h3d6evw/sqlite-probe.cjs --stress` | 0 | SQLite :memory: write/read/close; ABI137 |
| context-red / 12:24:14 | node | `pnpm exec vitest run tests/unit/context --reporter=dot` | 1 | 1 failed (1); 43 failed / 6 passed (49) |
| context-green-1 / 14:26:38 | node | `pnpm exec vitest run tests/unit/context --reporter=dot` | 1 | 1 failed (1); no tests |
| context-green-2 / 14:26:58 | node | `pnpm exec vitest run tests/unit/context tests/integration/context --reporter=dot` | 1 | 1 failed / 1 passed (2); 1 failed / 51 passed (52) |
| context-green-3 / 14:27:40 | node | `pnpm exec vitest run tests/unit/context tests/integration/context --reporter=dot` | 0 | 2 passed (2); 52 passed (52) |
| typecheck-1 / 14:27:41 | node | `pnpm run typecheck` | 0 | tsc noEmit |
| edge-red / 14:28:04 | node | `pnpm exec vitest run tests/unit/context --reporter=dot` | 1 | 1 failed (1); 2 failed / 52 passed (54) |
| context-green-4 / 14:28:17 | node | `pnpm exec vitest run tests/unit/context tests/integration/context --reporter=dot` | 0 | 2 passed (2); 57 passed (57) |
| regression-1 / 14:28:35 | node | `pnpm exec vitest run --reporter=dot` | 0 | 28 passed (28); 370 passed (370) |
| typecheck-2 / 14:28:35 | node | `pnpm run typecheck` | 0 | tsc noEmit |
| build-1 / 14:28:53 | node | `pnpm run build` | 0 | build complete |
| electron-rebuild / 14:29:17 | electron | `pnpm run native:electron --build-from-source` | 0 | build complete |
| review-red / 14:29:31 | node | `pnpm exec vitest run tests/unit/context --reporter=dot` | 1 | 1 failed (1); 1 failed / 54 passed (55) |
| review-green / 14:29:44 | node | `pnpm exec vitest run tests/unit/context --reporter=dot` | 0 | 1 passed (1); 55 passed (55) |
| electron-memory / 14:29:44 | electron-node | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron /private/tmp/roundtable-r05-environment-7h3d6evw/sqlite-probe.cjs` | 0 | SQLite :memory: write/read/close; ABI139 |
| electron-context / 14:29:45 | electron-node | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron node_modules/vitest/vitest.mjs run tests/unit/context tests/integration/context --reporter=dot` | 0 | 2 passed (2); 58 passed (58) |
| native-node-final / 14:31:55 | node | `pnpm run native:node` | 0 | 见独立日志/退出记录 |
| regression-final / 14:32:19 | node | `pnpm exec vitest run --reporter=dot` | 0 | 28 passed (28); 371 passed (371) |
| context-final / 14:32:19 | node | `pnpm exec vitest run tests/unit/context tests/integration/context --reporter=dot` | 0 | 2 passed (2); 58 passed (58) |
| typecheck-final / 14:32:20 | node | `pnpm run typecheck` | 0 | tsc noEmit |
| build-final / 14:32:42 | node | `pnpm run build` | 0 | build complete |
| electron-rebuild-final / 14:32:43 | electron | `pnpm run native:electron --build-from-source` | 0 | build complete |
| electron-memory-final / 14:33:06 | electron-node | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron /private/tmp/roundtable-r05-environment-7h3d6evw/sqlite-probe.cjs` | 0 | SQLite :memory: write/read/close; ABI139 |
| electron-context-final / 14:33:06 | electron-node | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron node_modules/vitest/vitest.mjs run tests/unit/context tests/integration/context --reporter=dot` | 0 | 2 passed (2); 58 passed (58) |

## 失败、警告与修复事实

- 在首次启动红测时，误把`exec`作为wrapper的子程序，FileNotFoundError，外层exit1且没有启动Vitest；随后用`pnpm exec ...`正确运行。该次不是测试PASS，也不是实现缺陷。
- context-red：空实现43失败/6通过，exit1，证实正常构建/预算/隔离等断言能失败。
- context-green-1：Zod禁止对含refinement的RequestAttempt Schema直接pick，suite收集错误/no tests，exit1；改为复用其shape字段构造Main内部白名单，不改Shared。
- context-green-2：集成fixture将其他Run控制元数据也当合法快照，1失败/51通过，exit1。保留非法元数据应拒绝且无请求的断言，并另测合法控制快照中外来消息逐条排除；没有弱化安全边界。
- edge-red：speaker与冻结身份冲突未拒绝、畸形counter.method抛异常，2失败/52通过；补校验后context-green-4为57通过。
- review-red：既有Agent Attempt可被伪装user无turnId绕过未来回合检查，1失败/54通过；user有Attempt关联时拒绝，review-green55单元通过。最终专项58与全回归371均通过。
- Node原生编译有libc++目标平台与Node addon函数类型警告；build有Zod依赖注释注解被Rollup移除的警告。命令均exit0；不修改依赖掩盖警告。
- 独立集成测试代理在写完fixture后遇到账户usage limit，主代理接管其文件，补完验证和审查；不把代理未完成的验证当PASS。

## 文件与数据检查

最终提交前检查完整源码/测试/文档、`git diff --check`、暂存清单及敏感模式扫描。只新增context授权目录内9文件；不提交数据库、备份、环境文件、Key或日志。既有源码、治理、Shared、package/lock与原测试均无改动。提交后检查HEAD、main未移动和工作区干净。

## 未执行 / 限制

没有启动真实应用入口，未访问真实userData/数据库/Key，未调用付费Provider。未验证R04/R05/R06联合执行、持续指令生产链路、来源报告持久化/UI投影、真实模型tokenizer/输出限制、正式桌面E2E、发布/跨平台或签名。当前没有lint实现，未宣称lint/E2E通过。构建尚不会将未接线R05用在RunService，不能视为整个应用公共上下文已生效。
