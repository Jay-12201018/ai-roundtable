# R07 实际验证命令台账

交付日期 2026-10-17；逐条实际 UTC 时间保留如下，不把中间失败或历史基线当最终 PASS。

证据根：`/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-r07-2xxu9vfz`。原始 JSON、logs、取证脚本与截图为本次临时证据，可被系统清理；不是产品运行依赖。固定测试已留在仓库授权路径。

## 受控执行入口

```sh
R07_CHECK_ROOT=/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-r07-2xxu9vfz
python3 "$R07_CHECK_ROOT/run-check.py" <唯一label> <上限秒> <mode> <argv...>
```

runner 以官方 Node24.18.1 完整 runtime 调用已核验的 pnpm11.25.0，临时 bin/pnpm 固定独立 store/cache/state；Node 模式使用同版 include/config，Electron 模式只使用独立38.8.6 headers，electron-node 模式设置 ELECTRON_RUN_AS_NODE=1。HOME 未修改，TMPDIR 使用规范化 private 路径；独立 npm/gyp/electron/XDG 目录，禁 core、进程组超时 TERM/KILL、后期加唯一 label 保护和清理继承编译目标。

Node runtime：`/private/tmp/roundtable-r02-integration-b0c3ktgt/runtime-24.18.1/node-v24.18.1-darwin-arm64`；pnpm：`/Users/zhangwenjie/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pnpm/bin/pnpm.mjs`。缓存官方 archive/runtime/headers/pnpm 字节由本轮 source-verification 与 environment-audit 重新验证。后续复验应按 docs/ENVIRONMENT.md 重新准备，不能依赖这些临时路径永久存在。

## 完整运行记录

| UTC 开始 / label | 模式 / 上限秒 | 实际 argv | exit / 耗时秒 | 测试输出摘要 |
| --- | --- | --- | --- | --- |
| 2026-10-16T07:25:24.163683+00:00<br>`install` | node / 300.0 | `pnpm install --frozen-lockfile --offline --package-import-method=copy --side-effects-cache=false --reporter=append-only` | 0 / 19.733 | 非 Vitest 或编译/探针；见结果与失败说明 |
| 2026-10-16T07:25:48.857579+00:00<br>`service-red` | node / 60.0 | `pnpm exec vitest run tests/unit/rooms --reporter=dot` | 1 / 0.751 | Test Files  1 failed (1); Tests  no tests |
| 2026-10-16T07:26:12.526096+00:00<br>`service-green` | node / 60.0 | `pnpm exec vitest run tests/unit/rooms --reporter=dot` | 0 / 0.685 | Test Files  1 passed (1); Tests  18 passed (18) |
| 2026-10-16T07:27:33.825788+00:00<br>`integration-first` | node / 60.0 | `pnpm exec vitest run tests/integration/rooms --reporter=dot` | 1 / 0.795 | Test Files  1 failed (1); Tests  2 failed \| 15 passed (17) |
| 2026-10-16T07:29:04.928378+00:00<br>`ui-red` | node / 60.0 | `pnpm exec vitest run tests/unit/rendererRooms --reporter=dot` | 1 / 0.949 | Test Files  1 failed (1); Tests  no tests |
| 2026-10-16T07:32:42.999454+00:00<br>`modules-first` | node / 60.0 | `pnpm exec vitest run tests/unit/rooms tests/integration/rooms tests/unit/rendererRooms --reporter=dot` | 1 / 0.83 | Test Files  1 failed \| 2 passed (3); Tests  35 passed (35) |
| 2026-10-16T07:32:50.825371+00:00<br>`ui-first` | node / 60.0 | `pnpm exec vitest run tests/unit/rendererRooms --reporter=dot` | 0 / 1.105 | Test Files  1 passed (1); Tests  11 passed (11) |
| 2026-10-16T07:32:51.941636+00:00<br>`typecheck-first` | tool / 60.0 | `pnpm typecheck` | 2 / 1.554 | 非 Vitest 或编译/探针；见结果与失败说明 |
| 2026-10-16T07:34:03.159311+00:00<br>`edge-tests` | node / 60.0 | `pnpm exec vitest run tests/unit/rendererRooms --reporter=dot` | 0 / 1.059 | Test Files  2 passed (2); Tests  21 passed (21) |
| 2026-10-16T07:37:47.772728+00:00<br>`integration-ui` | node / 60.0 | `pnpm exec vitest run tests/integration/rooms --reporter=dot` | 0 / 1.314 | Test Files  2 passed (2); Tests  18 passed (18) |
| 2026-10-16T07:38:08.866945+00:00<br>`renderer-dialog-red` | node / 60.0 | `pnpm exec vitest run tests/unit/rendererRooms/dialogErrors.test.tsx --reporter=dot` | 1 / 4.077 | Test Files  1 failed (1); Tests  6 failed (6) |
| 2026-10-16T07:38:59.437424+00:00<br>`preview-build` | tool / 60.0 | `pnpm exec vite build --config /var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-r07-2xxu9vfz/preview/vite.config.mjs` | 1 / 0.835 | 非 Vitest 或编译/探针；见结果与失败说明 |
| 2026-10-16T07:39:02.415619+00:00<br>`renderer-dialog-green` | node / 60.0 | `pnpm exec vitest run tests/unit/rendererRooms --reporter=dot` | 0 / 1.331 | Test Files  3 passed (3); Tests  27 passed (27) |
| 2026-10-16T07:39:10.153372+00:00<br>`preview-build-canonical` | tool / 60.0 | `pnpm exec vite build --config /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-r07-2xxu9vfz/preview/vite.config.mjs` | 0 / 0.828 | 非 Vitest 或编译/探针；见结果与失败说明 |
| 2026-10-16T16:30:58.445587+00:00<br>`browser-ui` | tool / 90.0 | `node /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-r07-2xxu9vfz/ui-probe.cjs` | 1 / 5.079 | 非 Vitest 或编译/探针；见结果与失败说明 |
| 2026-10-16T16:31:12.260618+00:00<br>`final-full` | node / 180.0 | `pnpm test --reporter=dot` | 1 / 18.036 | Test Files  4 failed \| 47 passed (51); Tests  11 failed \| 667 passed (678) |
| 2026-10-16T16:31:20.831026+00:00<br>`final-typecheck` | tool / 60.0 | `pnpm typecheck` | 0 / 1.611 | 非 Vitest 或编译/探针；见结果与失败说明 |
| 2026-10-16T16:31:23.094925+00:00<br>`browser-ui-authorized` | tool / 90.0 | `node /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-r07-2xxu9vfz/ui-probe.cjs` | 1 / 33.266 | 非 Vitest 或编译/探针；见结果与失败说明 |
| 2026-10-16T16:31:59.863351+00:00<br>`final-full-canonical` | node / 180.0 | `pnpm test --reporter=dot` | 0 / 15.847 | Test Files  51 passed (51); Tests  678 passed (678) |
| 2026-10-16T16:32:16.718341+00:00<br>`select-label-red` | node / 60.0 | `pnpm exec vitest run tests/unit/rendererRooms/dialogErrors.test.tsx --reporter=dot` | 0 / 1.112 | Test Files  1 passed (1); Tests  7 passed (7) |
| 2026-10-16T16:32:52.620130+00:00<br>`browser-ui-semantic` | tool / 90.0 | `node /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-r07-2xxu9vfz/ui-probe.cjs` | 0 / 2.113 | 非 Vitest 或编译/探针；见结果与失败说明 |
| 2026-10-16T16:32:53.747194+00:00<br>`final-modules` | node / 60.0 | `pnpm exec vitest run tests/unit/rooms tests/integration/rooms tests/unit/rendererRooms --reporter=dot` | 0 / 1.974 | Test Files  7 passed (7); Tests  67 passed (67) |
| 2026-10-16T16:32:53.747425+00:00<br>`final-build` | tool / 90.0 | `pnpm build` | 2 / 2.427 | 非 Vitest 或编译/探针；见结果与失败说明 |
| 2026-10-16T16:33:21.632621+00:00<br>`final-regression` | node / 120.0 | `pnpm exec vitest run --reporter=dot` | 0 / 5.301 | Test Files  51 passed (51); Tests  679 passed (679) |
| 2026-10-16T16:33:21.632646+00:00<br>`final-typecheck-complete` | tool / 60.0 | `pnpm typecheck` | 0 / 4.457 | 非 Vitest 或编译/探针；见结果与失败说明 |
| 2026-10-16T16:33:21.635434+00:00<br>`final-build-complete` | tool / 90.0 | `pnpm build` | 0 / 5.867 | 非 Vitest 或编译/探针；见结果与失败说明 |
| 2026-10-16T16:33:49.532029+00:00<br>`electron-rebuild` | electron / 180.0 | `pnpm native:electron` | 0 / 11.238 | 非 Vitest 或编译/探针；见结果与失败说明 |
| 2026-10-16T16:34:42.596177+00:00<br>`electron-sqlite` | electron-node / 30.0 | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-r07-2xxu9vfz/sqlite-electron.cjs` | 0 / 1.151 | 非 Vitest 或编译/探针；见结果与失败说明 |
| 2026-10-16T16:34:43.732235+00:00<br>`electron-rooms` | electron-node / 90.0 | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron node_modules/vitest/vitest.mjs run tests/unit/rooms tests/integration/rooms tests/unit/rendererRooms --reporter=dot` | 0 / 1.356 | Test Files  7 passed (7); Tests  67 passed (67) |
| 2026-10-16T16:35:31.947837+00:00<br>`preview-final` | tool / 60.0 | `pnpm exec vite build --config /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-r07-2xxu9vfz/preview/vite.config.mjs` | 0 / 0.833 | 非 Vitest 或编译/探针；见结果与失败说明 |
| 2026-10-16T16:35:52.984465+00:00<br>`browser-final` | tool / 90.0 | `node /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-r07-2xxu9vfz/ui-probe.cjs` | 1 / 1.05 | 非 Vitest 或编译/探针；见结果与失败说明 |
| 2026-10-16T16:35:54.116253+00:00<br>`build-final-reviewed` | tool / 90.0 | `pnpm build` | 0 / 3.205 | 非 Vitest 或编译/探针；见结果与失败说明 |
| 2026-10-16T16:35:54.116391+00:00<br>`electron-rooms-final` | electron-node / 90.0 | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron node_modules/vitest/vitest.mjs run tests/unit/rooms tests/integration/rooms tests/unit/rendererRooms --reporter=dot` | 0 / 1.685 | Test Files  7 passed (7); Tests  67 passed (67) |
| 2026-10-16T16:36:07.406457+00:00<br>`preview-public-styles` | tool / 60.0 | `pnpm exec vite build --config /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-r07-2xxu9vfz/preview/vite.config.mjs` | 0 / 0.786 | 非 Vitest 或编译/探针；见结果与失败说明 |
| 2026-10-16T16:36:34.459005+00:00<br>`browser-public-styles` | tool / 90.0 | `node /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-r07-2xxu9vfz/ui-probe.cjs` | 0 / 1.701 | 非 Vitest 或编译/探针；见结果与失败说明 |
| 2026-10-16T16:40:06.100164+00:00<br>`legacy-model-red` | electron-node / 60.0 | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron node_modules/vitest/vitest.mjs run tests/unit/rendererRooms/dialogErrors.test.tsx --reporter=dot` | 1 / 1.006 | Test Files  1 failed (1); Tests  1 failed \| 7 passed (8) |
| 2026-10-16T16:40:16.035652+00:00<br>`legacy-model-green` | electron-node / 60.0 | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron node_modules/vitest/vitest.mjs run tests/unit/rendererRooms/dialogErrors.test.tsx --reporter=dot` | 0 / 1.05 | Test Files  1 passed (1); Tests  8 passed (8) |
| 2026-10-16T16:40:17.157067+00:00<br>`delivery-node-full` | node / 180.0 | `pnpm test --reporter=dot` | 0 / 15.673 | Test Files  51 passed (51); Tests  680 passed (680) |
| 2026-10-16T16:40:18.320398+00:00<br>`delivery-build` | tool / 90.0 | `pnpm build` | 0 / 2.984 | 非 Vitest 或编译/探针；见结果与失败说明 |
| 2026-10-16T16:40:18.320398+00:00<br>`delivery-typecheck` | tool / 60.0 | `pnpm typecheck` | 0 / 1.856 | 非 Vitest 或编译/探针；见结果与失败说明 |
| 2026-10-16T16:40:47.401708+00:00<br>`delivery-preview-build` | tool / 60.0 | `pnpm exec vite build --config /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-r07-2xxu9vfz/preview/vite.config.mjs` | 0 / 1.265 | 非 Vitest 或编译/探针；见结果与失败说明 |
| 2026-10-16T16:40:47.401708+00:00<br>`delivery-node-rooms` | node / 60.0 | `pnpm exec vitest run tests/unit/rooms tests/integration/rooms tests/unit/rendererRooms --reporter=dot` | 0 / 1.542 | Test Files  7 passed (7); Tests  68 passed (68) |
| 2026-10-16T16:40:57.866399+00:00<br>`delivery-electron-rebuild` | electron / 180.0 | `pnpm native:electron` | 0 / 11.065 | 非 Vitest 或编译/探针；见结果与失败说明 |
| 2026-10-16T16:41:02.008731+00:00<br>`delivery-browser` | tool / 90.0 | `node /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-r07-2xxu9vfz/ui-probe.cjs` | 0 / 1.915 | 非 Vitest 或编译/探针；见结果与失败说明 |
| 2026-10-16T16:41:23.680556+00:00<br>`delivery-electron-rooms` | electron-node / 90.0 | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron node_modules/vitest/vitest.mjs run tests/unit/rooms tests/integration/rooms tests/unit/rendererRooms --reporter=dot` | 0 / 1.423 | Test Files  7 passed (7); Tests  68 passed (68) |
| 2026-10-16T16:41:24.858640+00:00<br>`delivery-electron-sqlite` | electron-node / 30.0 | `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-r07-2xxu9vfz/sqlite-electron.cjs` | 0 / 0.203 | 非 Vitest 或编译/探针；见结果与失败说明 |

## 未经 runner 的辅助命令

- 初始 pwd / git branch / rev-parse / status / worktree list 为只读检查，基线匹配；第一次 git switch 因公共 Git 元数据沙箱写权限 exit128，获环境授权后在当前 Worktree 建分支 exit0。未重置历史。
- setup.py：exit0；官方归档 SHA、runtime/headers/pnpm 字节与实际版本。seed-cache.py：exit0，20979 内容文件 + 661 metadata 文件独立 inode、只读 immutable SQLite 备份索引，源 SHA 不变，无 node_modules 复制。
- audit-environment.py：exit0，完整 runtime4703文件/headers2726文件/32直接依赖/安装锁/独立 inode/Node ABI137 实际内存 SQL；JSON 为 environment-audit.json。
- prepare-electron-headers.py：exit0，125文件字节一致且独立 inode；38.8.6/Node22.22.0/ABI139/arm64。
- contrast assert 脚本：exit0，四类最低对比度均达到文档阈值，见 contrast-check.json；不等于全应用无障碍审计。
- 初次 python3 -m http.server 5197 --bind 127.0.0.1：沙箱 bind 被拒 exit1；获权限后只服务本轮 preview-dist。Chrome 新临时 profile，无真实浏览器会话/数据库，网络仅 loopback。
- 最终 git diff --check、文件范围/敏感模式/暂存清单/代码指纹检查及 commit 操作见交付审核；不把这些计为业务测试。

## 失败定位与处置

- service-red / ui-red：预期模块不存在，exit1；后续服务18项、界面11项实际通过。空测试不被算成功。
- integration-first：15通过/2失败；新fixture误用 Provider列kind且消息无合法Run。改用实际type列并插入合法Run，不改Database或断言。
- modules-first：两服务/数据文件35通过，UI导入目录多一层；修正 rooms 相对 Shared 路径。
- typecheck-first：新测试fixture map参数两个隐式any；补准确string/number类型。
- renderer-dialog-red：新增6项反馈/空态测试实际失败；修复 modal内服务错误/单一alert/校验清理后27项通过。
- final-full：667通过/11失败。10项既有迁移测试由runner的/var路径别名触发realpath安全校验，改runner规范TMPDIR，不改公共代码/安全守卫；1项新UI测试点击尚未加载完成的禁用控件，改等待成员加载完成，不改断言。canonical重跑678通过。
- final-build：新增测试误用Testing Library ByRoleOptions不支持的exact键，tsc exit2；删除该键（name字符串本身精确匹配）后strict及build成功，完整集679通过。
- preview-build：Vite根路径/var与/private/var解析差异导致资源路径无效；临时fixture配置改规范路径后成功。
- browser-ui：沙箱内Chrome启动SIGABRT，exit1；获权限后采用新临时profile。browser-ui-authorized：probe的getByLabel exact与浏览器label文本匹配不符，定位超时exit1；改用精确可访问combobox角色后通过。select-label-red仅是label名称，其7项实际通过，没有将其伪称为RED。
- browser-final：加载公共样式后800px实际scrollWidth1080，exit1，确认既有body最小宽度边界；临时fixture显式覆盖该公共约束以单独验feature，最终browser-public-styles通过。生产窄窗仍待总控修复，不隐藏该失败。
- 编译出现既有libc++/函数指针与Zod PURE注释提示；相关最终命令exit0。没有升级依赖、skip、todo测试或降低安全断言。

- legacy-model-red：旧半配置（Provider=null、model=legacy且摘要为空）无法清模型，新增回归实际1失败/7通过；只调整Model禁用条件，允许用户主动清空遗留值，legacy-model-green 8项通过。之后重新Node源码重编译/全680/专项68/strict/build，再串行重建Electron/专项68/内存SQL；没有用旧67/679证据替代最终结果。

## 源码身份与结论

早期Node679及Electron67均为阶段结果，实际标签保留。最终交付的 Node680、Node68专项、strict、生产构建、独立fixture构建/浏览器、Electron38.8.6源码重建/68专项/ABI139内存SQL在相同受检组合摘要 `25eb9594ccacf6ab40a31b5fc1cb78800749c86a6c7e3131e161dada8bdacbfc` 上执行，前后不变。此摘要包含当时的模块文档；之后仅更新交接与台账，不改变业务/测试/CSS文件，另保存delivery-source-manifest.json逐文件核对。

最终 native 为 Electron ABI139。再次执行 Node测试必须先按受控Node/同版headers重建；不要用当前native直接跑Node24。正式生产UI/IPC/App闭环、全应用缩放/辅助技术、正式E2E、真实Key/Provider、发布/跨平台均未验证。
