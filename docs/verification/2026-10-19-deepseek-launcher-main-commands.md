# DeepSeek启动器main独立验收命令（2026-10-19）

获批ff-only入站f04ed4873066eefd7161dd721f104caf4ad1ac30，原main7900a4fbc75aca6c9c4aedb330636bbbea128490。环境根`/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-main-z2frmufy`；Node24.18.1官方完整runtime/include经本轮存在性/版本复核，不安装或重编译main依赖。Electron38.8.6/内嵌Node22.22.0/ABI139实际内存SQL验证。每条runner JSON记录完整argv/UTC/timeout/退出码/受检文件与日志SHA。

合并命令：`git merge --ff-only codex/deepseek-launcher-network-fix`，exit0；详情`merge.json`。以下是本次main执行，非候选历史结果。

## strict

```sh
/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru/runtime/node-v24.18.1-darwin-arm64/bin/node node_modules/typescript/bin/tsc --noEmit --pretty false
```

mode `node`；exit **0**；timeout `False`；2.939s；UTC 2026-10-19T06:04:47.293380+00:00。

日志 `/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-main-z2frmufy/logs/strict.log`；SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。

## launcher-python

```sh
python3 -B tests/probes/controlled-launcher.test.py
```

mode `tool`；exit **1**；timeout `False`；5.767s；UTC 2026-10-19T06:04:47.298020+00:00。

日志 `/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-main-z2frmufy/logs/launcher-python.log`；SHA256 `6ee8a141059f2bdc09d8ae6aac8252d782c8dcbc216d13ceffe89723de1123f7`。

## electron-forwarding

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/controlled-network.cjs
```

mode `electron-node`；exit **0**；timeout `False`；0.532s；UTC 2026-10-19T06:04:47.298871+00:00。

日志 `/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-main-z2frmufy/logs/electron-forwarding.log`；SHA256 `4adfd5d1452e8264b0889ee83cf0cf4a2294351c8ce90c30a49f1642e4925481`。

## electron-affected

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron node_modules/vitest/vitest.mjs run tests/unit/providers/diagnosticsTransport.test.ts tests/unit/providers/controlledTrialMenu.test.ts tests/integration/deepseek --reporter=dot
```

mode `electron-node`；exit **1**；timeout `False`；21.397s；UTC 2026-10-19T06:04:47.300671+00:00。

日志 `/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-main-z2frmufy/logs/electron-affected.log`；SHA256 `ddbfadbec5a14cc5a043852a6bf8abd9c5e30091ede2d8876008939a0d992b9c`。

## node-forwarding

```sh
/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru/runtime/node-v24.18.1-darwin-arm64/bin/node tests/probes/controlled-network.cjs
```

mode `node`；exit **0**；timeout `False`；0.355s；UTC 2026-10-19T06:04:47.303019+00:00。

日志 `/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-main-z2frmufy/logs/node-forwarding.log`；SHA256 `4adfd5d1452e8264b0889ee83cf0cf4a2294351c8ce90c30a49f1642e4925481`。

## electron-tls

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/controlled-network-tls.cjs
```

mode `electron-node`；exit **1**；timeout `False`；0.571s；UTC 2026-10-19T06:04:47.305410+00:00。

日志 `/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-main-z2frmufy/logs/electron-tls.log`；SHA256 `abe782dbb9e73c3d4ee07ef0a3ac4613ed77d7bfb51988adca5f00c81e89cf19`。

## build-isolated

```sh
/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru/runtime/node-v24.18.1-darwin-arm64/bin/node node_modules/electron-vite/bin/electron-vite.js build --outDir /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-main-z2frmufy/production/out
```

mode `node`；exit **0**；timeout `False`；2.221s；UTC 2026-10-19T06:04:47.310948+00:00。

日志 `/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-main-z2frmufy/logs/build-isolated.log`；SHA256 `3aa964552b3e6fa2e41ff8e06bbe145c098abf628adb4afc23205fbb26021ca2`。

## electron-tls-permitted

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/controlled-network-tls.cjs
```

mode `electron-node`；exit **0**；timeout `False`；0.277s；UTC 2026-10-19T06:05:18.643553+00:00。

日志 `/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-main-z2frmufy/logs/electron-tls-permitted.log`；SHA256 `04d623a9c1125acdf264463acf4c45bb0e3e45ba983a6fb2bb7b7e31e8b40604`。

## launcher-python-permitted

```sh
python3 -B tests/probes/controlled-launcher.test.py
```

mode `tool`；exit **0**；timeout `False`；2.95s；UTC 2026-10-19T06:05:23.463098+00:00。

日志 `/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-main-z2frmufy/logs/launcher-python-permitted.log`；SHA256 `134bab3dfbd4cdf2d4e6a6b3228a9e1d394a539ae217b36bec9863570790702a`。

## electron-native

```sh
'/Users/zhangwenjie/Documents/ChatGPT/AI交互/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron' /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-main-z2frmufy/native-smoke.cjs
```

mode `electron-node`；exit **0**；timeout `False`；0.112s；UTC 2026-10-19T06:06:03.249720+00:00。

日志 `/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-main-z2frmufy/logs/electron-native.log`；SHA256 `b650993c8725d61603fab60c42b01cbb7d9a086e329b091d9319062f418b2dfc`。

## production-first

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-main-z2frmufy/with-source-git.py '/Users/zhangwenjie/Documents/ChatGPT/AI交互/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron' /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-main-z2frmufy/production/tests/probes/controlled-launcher-electron.cjs
```

mode `tool`；exit **0**；timeout `False`；0.564s；UTC 2026-10-19T06:06:11.131484+00:00。

日志 `/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-main-z2frmufy/logs/production-first.log`；SHA256 `1639fc1efb2e682900e27e662442637fad82a5ba6aac42cb0d7431e858337be3`。

## electron-affected-permitted

```sh
'/Users/zhangwenjie/Documents/ChatGPT/AI交互/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron' node_modules/vitest/vitest.mjs run tests/unit/providers/diagnosticsTransport.test.ts tests/unit/providers/controlledTrialMenu.test.ts tests/integration/deepseek --reporter=dot
```

mode `electron-node`；exit **0**；timeout `False`；21.172s；UTC 2026-10-19T06:06:30.832563+00:00。

日志 `/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-main-z2frmufy/logs/electron-affected-permitted.log`；SHA256 `004a00efe5bad2ff79a8952ea109af1a897b5ac45c30e56b9118082422f16be4`。

## production-restart

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-main-z2frmufy/with-source-git.py '/Users/zhangwenjie/Documents/ChatGPT/AI交互/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron' /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-main-z2frmufy/production/tests/probes/controlled-launcher-electron.cjs --restart /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-main-z2frmufy/test-tmp/roundtable-launcher-probe-D7rn8u/probe-manifest.json
```

mode `tool`；exit **0**；timeout `False`；0.684s；UTC 2026-10-19T06:06:32.575155+00:00。

日志 `/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-main-z2frmufy/logs/production-restart.log`；SHA256 `df8b430a5b9e72c1a5e31620428d06d77b0f6b9a3f3a0ec3f1cef0daccbc2c92`。

## prepare-main

```sh
python3 scripts/controlled-desktop/launcher.py prepare --node /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-fix-7ufw92ru/runtime/node-v24.18.1-darwin-arm64/bin/node --build-root /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-main-z2frmufy/validated-main-build
```

mode `node`；exit **0**；timeout `False`；3.281s；UTC 2026-10-19T06:07:26.522323+00:00。

日志 `/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-launcher-main-z2frmufy/logs/prepare-main.log`；SHA256 `025507815f2382505b41e904c41078455579a461e5689cc330d150034a758f19`。

## 失败与非侵入性审计

未加本地权限的launcher-python为21项中2个ps PermissionError（exit1）；electron-tls为listen EPERM（exit1）；electron-affected为33失败/4异常（exit1），原因均为沙箱本地端口限制。原日志保留；permitted后缀为相同输入/断言的实际重跑：21/21、30断言、178/178 exit0，不称初次失败为PASS。

原controlled_trials安全投影SQL保存在本轮根billing-query.sql，以Python sqlite3 URI mode=ro+query_only事务执行，前后SHA一致。post-validation-audit.json记录unknown1条/50000保留/实际费用NULL，以及原启动器/owner/out/native和当前PID未变；无Key表、真实Key或系统Keychain调用。

最终治理提交后的Finder快照prepare与manifest检查回执继续保留在同一本轮根（prepare-final-main.json与finder-check.json），该部分不修改已提交的业务或治理文件。若最终快照失败，交付必须报告失败而非宣称可打开。当前Finder入口只准备、不执行，不会替换正在运行的应用。
