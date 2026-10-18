# DeepSeek 诊断最终主线验收命令（2026-10-19）

cwd：`/Users/zhangwenjie/Documents/ChatGPT/AI交互`。实际证据根：`/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-diagnostics-main-5mmwji4e`。所有命令有外部超时，receipt记录argv、环境、UTC、退出码、前后Git/文件指纹与日志SHA；本轮无命令超时。

本轮使用已有获审Node24.18.1/arm64（bin SHA再次核对）做strict、构建和无SQLite的66项Node专项；完整1255项在main自身现有Electron38.8.6/Node22.22.0/ABI139运行，内存加载已核验。不运行pretest、不重建main原生模块、不重复压力、不安装依赖。没有将候选Node完整回归记为本轮main新PASS。

## main-abi

UTC `2026-10-18T16:29:59.846061+00:00`，模式 `electron-node`，exit **0**，timeout `False`，0.17秒。
测试摘要：无Vitest成绩；按具体输出判断，不作空集PASS。
日志 SHA-256：`9a456e55d1e946355bc70b76e5d9c5cdf35baf804aceb59ce9483ddf3e6c9a74`

```sh
'/Users/zhangwenjie/Documents/ChatGPT/AI交互/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron' -e 'const assert=require("node:assert/strict");const D=require("./node_modules/better-sqlite3");assert.equal(process.versions.electron,"38.8.6");assert.equal(process.versions.modules,"139");const db=new D(":memory:");try{db.exec("CREATE TABLE check_native(value TEXT)");db.prepare("INSERT INTO check_native VALUES (?)").run("owned-memory");assert.equal(db.prepare("SELECT value FROM check_native").pluck().get(),"owned-memory");console.log(JSON.stringify({electron:process.versions.electron,node:process.version,abi:process.versions.modules,sql:"PASS",pressureRepeated:false}));}finally{db.close();}'
```

## merge

UTC `2026-10-18T16:30:09.455129+00:00`，模式 `tool`，exit **0**，timeout `False`，0.085秒。
测试摘要：无Vitest成绩；按具体输出判断，不作空集PASS。
日志 SHA-256：`c23b1e7653be31ad04597a6fa5e85ec73286b27e01d1dc88009468b2700d3e13`

```sh
git merge --ff-only codex/deepseek-trial-diagnostics
```

## main-full

UTC `2026-10-18T16:30:32.811283+00:00`，模式 `electron-node`，exit **0**，timeout `False`，21.45秒。
测试摘要：1255 passed (1255)
日志 SHA-256：`ec7155f112317426339b43f4328c440ac3307e0c6e6f86fb94848b06cdab5569`

```sh
'/Users/zhangwenjie/Documents/ChatGPT/AI交互/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron' node_modules/vitest/vitest.mjs run --reporter=dot
```

## main-diagnostic-node

UTC `2026-10-18T16:30:36.053188+00:00`，模式 `node`，exit **0**，timeout `False`，2.62秒。
测试摘要：66 passed (66)
日志 SHA-256：`f2c9d0bf2b89b33dfdadf5a2f0130069e591bd4e87d1a36e805c253433054bf7`

```sh
/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-trial-diagnostics-73bseq9v/runtime/node-v24.18.1-darwin-arm64/bin/node node_modules/vitest/vitest.mjs run tests/unit/providers/diagnosticsTransport.test.ts tests/unit/providers/controlledTrialMenu.test.ts --reporter=dot
```

## main-typecheck

UTC `2026-10-18T16:30:39.297835+00:00`，模式 `node`，exit **0**，timeout `False`，2.879秒。
测试摘要：无Vitest成绩；按具体输出判断，不作空集PASS。
日志 SHA-256：`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`

```sh
/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-trial-diagnostics-73bseq9v/runtime/node-v24.18.1-darwin-arm64/bin/node node_modules/typescript/bin/tsc --noEmit --pretty false
```

## main-build

UTC `2026-10-18T16:30:44.997830+00:00`，模式 `node`，exit **0**，timeout `False`，1.134秒。
测试摘要：无Vitest成绩；按具体输出判断，不作空集PASS。
日志 SHA-256：`8fd7f11d2e2acfcb4aa8c968e3c2da09915afeb18982ed8ae37ea8b0c9d1a954`

```sh
/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-trial-diagnostics-73bseq9v/runtime/node-v24.18.1-darwin-arm64/bin/node node_modules/electron-vite/bin/electron-vite.js build --outDir /var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-diagnostics-main-5mmwji4e/probe/out
```

## main-production

UTC `2026-10-18T16:31:50.204080+00:00`，模式 `tool`，exit **0**，timeout `False`，0.78秒。
测试摘要：无Vitest成绩；按具体输出判断，不作空集PASS。
日志 SHA-256：`61931d1b0a16c7d764644ee66c368ccdb8240d042fd13e9af955886742c9d2b3`

```sh
'/Users/zhangwenjie/Documents/ChatGPT/AI交互/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron' /var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-diagnostics-main-5mmwji4e/probe/tests/probes/deepseek-diagnostics-electron.cjs
```

## main-restart

UTC `2026-10-18T16:32:03.991748+00:00`，模式 `tool`，exit **0**，timeout `False`，0.511秒。
测试摘要：无Vitest成绩；按具体输出判断，不作空集PASS。
日志 SHA-256：`8e6387af4ad88ac10bc8e725b2b218723378519997afd4aafe27884a3fc74c1e`

```sh
'/Users/zhangwenjie/Documents/ChatGPT/AI交互/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron' /var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-diagnostics-main-5mmwji4e/probe/tests/probes/deepseek-diagnostics-electron.cjs --restart /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-diagnostics-main-5mmwji4e/test-tmp/roundtable-deepseek-trial-0Rlr2w/trial-manifest.json
```

## main-exit-audit

UTC `2026-10-18T16:32:46.362342+00:00`，模式 `electron-node`，exit **0**，timeout `False`，0.111秒。
测试摘要：无Vitest成绩；按具体输出判断，不作空集PASS。
日志 SHA-256：`efeffc3162d682f917686b2bba9f4291cf9468f57bec3e6fea9730ec8623bef9`

```sh
'/Users/zhangwenjie/Documents/ChatGPT/AI交互/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron' /var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-diagnostics-main-5mmwji4e/exit-audit.cjs
```

## 文件、安全与执行边界

- 合并前main524f505和候选7599949精确匹配授权，两个工作树干净，merge-base为main，仅一个18文件候选提交；扫描无数据库/密钥/构建产物或敏感模式命中。migrations1–4、KeyService、预算策略与RunService逐字保持。独立只读安全审查无合并阻塞。
- `main-build`使用electron-vite正式`--outDir`，输出本轮新临时目录，保留Main/Preload/Renderer相对目录；strict独立执行。探针两份CJS及package.json从本次main逐字复制到此构建根，未改断言；node_modules仅只读引用main自身现有依赖。没有创建新Worktree或复制node_modules。
- ready前独立userData/sessionData/logs、所有safeStorage方法fake、Chromium mock-keychain、Node/Chromium公网封锁；只允许自建loopback HTTP。测试wrapper使用明确标识的历史价格fixture时钟，实际墙钟另记，不更新生产价或发真实API。
- `main-production`自然exit0：49具名断言（6条诊断）/2次本地fixture；`main-restart`新进程30条（5条诊断）/HTTP0；`main-exit-audit`退出后仅本轮DB只读35检查。
- `acceptance-audit.json`确认各最终命令受检文件指纹未变，用户当前App原out全文件哈希、原生.node哈希/inode均与合并前一致；原18个Worktree/分支保留。未访问真实profile/Keychain/Key，未写新联网许可。
- 本轮所有必要验证一次通过，无业务修复或断言删改。查找工具入口时先试不存在的.mjs、合并前main尚无diagnostics.ts的读取失败仅为辅助路径定位，不是测试结果；改查实际.js入口/候选后继续。
- 构建已有Zod注释annotation、外部输出目录不清空提示及Electron启动sandbox_extension警告保留；临时输出目录首次创建为空，没有强制清空。没有将警告、截图或build替代真实具名断言。
- 历史候选失败仍完整保存在候选报告/台账；本报告无历史PASS冒充main新PASS。没有重跑冷安装、Node全量/双ABI切换/压力、正式E2E、跨平台、发布、真实Keychain、公网模型或账单核销。
