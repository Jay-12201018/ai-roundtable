# DeepSeek 启动器候选逐命令台账（2026-10-19）

分支codex/deepseek-launcher-network-fix，基线7900a4fbc75aca6c9c4aedb330636bbbea128490。以下是本轮实际命令，不使用历史PASS替代。runner根：`/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru`，每条JSON回执包含模式、超时、UTC、退出码、源文件及日志SHA。node模式使用完整官方24.18.1，electron-node显式ELECTRON_RUN_AS_NODE=1；tool模式清除此变量。全部数据库、fake Key与fixture userData均隔离；公网模型调用0，依赖下载单独列明。

## install

```sh
/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru/bin/pnpm install --offline --frozen-lockfile --package-import-method=copy --side-effects-cache=false --reporter=append-only
```

模式 `node`；exit **1**；timeout `False`；耗时 3.624s；UTC 2026-10-19T05:43:37.143670+00:00。FAIL：旧离线缓存缺包；未称干净安装成功。

日志 `/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru/logs/install.log`；SHA256 `1a044559780491dc52b87c4a89dfc973ce434a88f9fa7aa4fbeb61108a42dbf1`。

## install-frozen

```sh
/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru/bin/pnpm install --frozen-lockfile --package-import-method=copy --side-effects-cache=false --reporter=append-only
```

模式 `node`；exit **1**；timeout `False`；耗时 62.58s；UTC 2026-10-19T05:44:52.679785+00:00。FAIL：旧临时runtime headers缺失；运行时版本正确但include不完整。

日志 `/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru/logs/install-frozen.log`；SHA256 `aa25c924fece639b1fd8203d222be9c4bfb9f042de7b9ec840a7762abf2f6c94`。

## install-paired

```sh
/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru/bin/pnpm install --offline --frozen-lockfile --package-import-method=copy --side-effects-cache=false --reporter=append-only
```

模式 `node`；exit **0**；timeout `False`；耗时 15.604s；UTC 2026-10-19T05:46:53.351493+00:00。PASS：重新提取核验官方同版runtime/include后，独立离线冻结安装646包完成。

日志 `/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru/logs/install-paired.log`；SHA256 `5c63349ce3fafbf9682c357b46c10bd59e8eb2d2f54973314be36cbd4fa6af24`。

## forwarding-red

```sh
/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru/bin/node tests/probes/controlled-network.cjs
```

模式 `node`；exit **1**；timeout `False`；耗时 0.079s；UTC 2026-10-19T05:47:27.853855+00:00。FAIL：测试中间依赖解析错误，不是产品根因。

日志 `/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru/logs/forwarding-red.log`；SHA256 `635b8aed0c457432b8b655186aa935442a7452c25920dfb4c9263a5df40e3514`。

## forwarding-red-observer

```sh
/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru/bin/node tests/probes/controlled-network.cjs
```

模式 `node`；exit **1**；timeout `False`；耗时 0.174s；UTC 2026-10-19T05:47:37.457322+00:00。预期RED：真实复现observer丢失。

日志 `/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru/logs/forwarding-red-observer.log`；SHA256 `374d806fb41db2474e6dc770bf9ba7d12af245ad2bfb204d33d43877850e5518`。

## forwarding-green

```sh
/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru/bin/node tests/probes/controlled-network.cjs
```

模式 `node`；exit **1**；timeout `False`；耗时 0.176s；UTC 2026-10-19T05:47:46.879365+00:00。FAIL：测试fixture DTO/KeyService缺字段，未删除断言。

日志 `/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru/logs/forwarding-green.log`；SHA256 `317172cc9c72ca8b84da60d0fc810ab53081c32e00a569b48ad1680becb2a45a`。

## forwarding-green-complete-fixture

```sh
/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru/bin/node tests/probes/controlled-network.cjs
```

模式 `node`；exit **0**；timeout `False`；耗时 0.168s；UTC 2026-10-19T05:48:11.227170+00:00。PASS：8场景。

日志 `/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru/logs/forwarding-green-complete-fixture.log`；SHA256 `4adfd5d1452e8264b0889ee83cf0cf4a2294351c8ce90c30a49f1642e4925481`。

## build

```sh
/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru/bin/node node_modules/electron-vite/bin/electron-vite.js build
```

模式 `node`；exit **0**；timeout `False`；耗时 1.074s；UTC 2026-10-19T05:48:41.020281+00:00。结果见实际日志。

日志 `/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru/logs/build.log`；SHA256 `c9105e0c49c6c1bded0053b40b25d4f3c0e3f5e6a4cb5bcbaff62a573eeb95f0`。

## typecheck

```sh
/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru/bin/node node_modules/typescript/bin/tsc --noEmit --pretty false
```

模式 `node`；exit **0**；timeout `False`；耗时 1.888s；UTC 2026-10-19T05:48:43.093637+00:00。结果见实际日志。

日志 `/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru/logs/typecheck.log`；SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。

## node-regression

```sh
/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru/bin/node node_modules/vitest/vitest.mjs run --reporter=dot
```

模式 `node`；exit **0**；timeout `False`；耗时 21.853s；UTC 2026-10-19T05:48:46.784992+00:00。结果见实际日志。

日志 `/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru/logs/node-regression.log`；SHA256 `e3e1e0a49561d217341be619ad221389ee10d14d4387f21cddf4642233765d86`。

## electron-rebuild

```sh
/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru/bin/pnpm run native:electron
```

模式 `electron`；exit **0**；timeout `False`；耗时 11.065s；UTC 2026-10-19T05:50:17.605244+00:00。结果见实际日志。

日志 `/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru/logs/electron-rebuild.log`；SHA256 `1f9faa3edbda53904eba7c852108c318279540fb646ad1bada7a0b74adafa4f7`。

## electron-forwarding

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/controlled-network.cjs
```

模式 `electron-node`；exit **0**；timeout `False`；耗时 1.242s；UTC 2026-10-19T05:51:56.794035+00:00。结果见实际日志。

日志 `/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru/logs/electron-forwarding.log`；SHA256 `4adfd5d1452e8264b0889ee83cf0cf4a2294351c8ce90c30a49f1642e4925481`。

## electron-diagnostics

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron node_modules/vitest/vitest.mjs run tests/unit/providers/diagnosticsTransport.test.ts tests/unit/providers/controlledTrialMenu.test.ts tests/integration/deepseek --reporter=dot
```

模式 `electron-node`；exit **0**；timeout `False`；耗时 21.094s；UTC 2026-10-19T05:52:00.806869+00:00。结果见实际日志。

日志 `/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru/logs/electron-diagnostics.log`；SHA256 `58296265493ed74011afee44c770679ce2d04505b724ca27b2c2890d1cefa65b`。

## python-launcher

```sh
python3 -B tests/probes/controlled-launcher.test.py
```

模式 `tool`；exit **0**；timeout `False`；耗时 4.05s；UTC 2026-10-19T05:52:01.099975+00:00。结果见实际日志。

日志 `/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru/logs/python-launcher.log`；SHA256 `1abb5045d85948523a739d987e8eec8e6da78ce360919034896fb4f76019d375`。

## electron-native

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron scripts/verify-native.cjs
```

模式 `electron-node`；exit **0**；timeout `False`；耗时 0.124s；UTC 2026-10-19T05:52:01.928212+00:00。无效辅助调用：函数型packaged hook未实际执行断言，不能算PASS。

日志 `/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru/logs/electron-native.log`；SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。

## electron-tls

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/controlled-network-tls.cjs
```

模式 `electron-node`；exit **0**；timeout `False`；耗时 0.323s；UTC 2026-10-19T05:52:03.865717+00:00。结果见实际日志。

日志 `/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru/logs/electron-tls.log`；SHA256 `946880c1e1db5a3a88bf3cf4a8f8c0b40d46c33769412651bac086c362ab3aa8`。

## electron-native-actual

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron /var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru/native-smoke.cjs
```

模式 `electron-node`；exit **0**；timeout `False`；耗时 0.112s；UTC 2026-10-19T05:52:30.339054+00:00。PASS：4个真实ABI/内存SQL断言。

日志 `/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru/logs/electron-native-actual.log`；SHA256 `33c11416ac22e59f23e4ae234b0820fc31276038cbff96a5f74286860960d7fe`。

## prepare-real-build

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru/prepare-fixture/scripts/controlled-desktop/launcher.py prepare --node /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru/runtime/node-v24.18.1-darwin-arm64/bin/node --build-root /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru/prepared-build
```

模式 `node`；exit **0**；timeout `False`；耗时 3.038s；UTC 2026-10-19T05:53:24.935381+00:00。PASS：自建临时main仓库的真实prepare命令；不是原main合并验收。

日志 `/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru/logs/prepare-real-build.log`；SHA256 `f21817cae5993be505cfad9b535297f2bc30ca37ce9757b3aef52ee871804772`。

## launcher-production-first

```sh
'/Users/zhangwenjie/.codex/worktrees/deepseek-launcher-network-fix/AI交互/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron' tests/probes/controlled-launcher-electron.cjs
```

模式 `tool`；exit **1**；timeout `False`；耗时 0.778s；UTC 2026-10-19T05:53:35.455256+00:00。FAIL：macOS fake safeStorage替身不完整。

日志 `/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru/logs/launcher-production-first.log`；SHA256 `60a5b4b0d45a0e0843ea2d550a493d135f974ee46c79f61aa8514c87b16ccd82`。

## launcher-production-first-fixed

```sh
'/Users/zhangwenjie/.codex/worktrees/deepseek-launcher-network-fix/AI交互/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron' tests/probes/controlled-launcher-electron.cjs
```

模式 `tool`；exit **0**；timeout `False`；耗时 0.565s；UTC 2026-10-19T05:53:56.446165+00:00。PASS：28条生产入口断言。

日志 `/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru/logs/launcher-production-first-fixed.log`；SHA256 `e63dd32549c1ecc10b91f6526d580a5641a24b6240c0476ac79219a4c9619f06`。

## launcher-production-restart

```sh
'/Users/zhangwenjie/.codex/worktrees/deepseek-launcher-network-fix/AI交互/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron' tests/probes/controlled-launcher-electron.cjs --restart /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru/test-tmp/roundtable-launcher-probe-GrNSFJ/probe-manifest.json
```

模式 `tool`；exit **0**；timeout `False`；耗时 0.499s；UTC 2026-10-19T05:54:05.335978+00:00。PASS：21条重启/退出断言。

日志 `/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru/logs/launcher-production-restart.log`；SHA256 `5f44614cfeef3ee8fb72c161ab438ccf7b7a6d89f3a4d8dd010f20d893fbbebc`。

## 协作网络与启动器复核

网络独立新证据：`/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-network-compat-fovapkpa/receipts.json`；当前Worktree network/diagnostics临时bundle、Electron系统代理解析与自建HTTP目标/代理10断言、旧gate TLS5场景30断言，各exit0。后者不替代上表新gate TLS回归。

启动器协作最终21项Python行为与main.cjs语法检查，各exit0，准确argv与日志：`/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-agent-mum1xffe/receipts.json`；总控另独立重跑Python21项见上表。开发过程红灯细节保留在协作会话，未把预期失败当PASS。

源码/功能范围未改，不再为记录文档重跑完整回归。正式主线合并及部署尚未授权；未来必须重新校验主线和准备对应manifest，不能把本表fixture成绩当真实API/Keychain/发布验收。

最终人工编排的只读审计：`final-audit.json`，exit0；核对真实main/当前PID元数据/既有启动器及构建/native SHA与inode前后一致，候选11文件清单与敏感模式仅输出名称/数量。未查询真实DB或Key状态。
