# Fake-IP / CONNECT 候选逐命令台账

2026-10-19。独立分支 codex/deepseek-loopback-proxy；实现提交746c4de5df871697c7975ba69bbb75c56b9d46b8。未合main/未部署/未发送公网模型请求。

工作目录：`/Users/zhangwenjie/.codex/worktrees/deepseek-loopback-proxy/AI交互`。
独立验证根目录：`/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu`。
监督器 SHA-256：`d34833fb79ca8a43bddcdb63599bb2e154d47d64c31d1279e228f41d6e398c07`。

监督器为每条检查设置外部超时、独立环境、源码指纹和真实退出码；以下是实际argv，非预期结果。node模式固定官方24.18.1和同版headers，electron模式以38.8.6 headers重建，electron-node设置ELECTRON_RUN_AS_NODE=1。原始JSON/log保留在验证根目录；无需原用户profile、数据库或Key。

## 汇总

|label|mode|exit|上限秒|耗时秒|timeout|
|---|---|---:|---:|---:|---|
|install-frozen|node|0|300.0|17.194|False|
|node-native-smoke|node|0|60.0|0.115|False|
|proxy-config-red|node|1|60.0|0.549|False|
|proxy-config-green|node|0|60.0|0.712|False|
|typecheck-first|node|0|60.0|4.9|False|
|proxy-transport-first|node|0|90.0|0.716|False|
|node-regression-first|node|0|180.0|22.346|False|
|typecheck-second|node|2|60.0|1.94|False|
|proxy-timeout-red|node|1|60.0|0.755|False|
|proxy-timeout-green|node|0|60.0|0.761|False|
|proxy-persistence-first|node|0|60.0|0.929|False|
|typecheck-final|node|0|60.0|1.848|False|
|proxy-malformed|node|0|60.0|0.866|False|
|proxy-gate-node|node|0|60.0|0.083|False|
|launcher-python|tool|1|60.0|3.936|False|
|connect-tls-probe-first|node|0|150.0|0.631|False|
|node-regression-final|node|0|180.0|21.307|False|
|build-final|node|0|90.0|8.014|False|
|connect-tls-probe-stages|node|0|150.0|0.451|False|
|launcher-python-fixed|tool|0|60.0|4.047|False|
|rebuild-electron|electron|0|180.0|11.729|False|
|production-proxy-first|electron|0|90.0|2.786|False|
|electron-regression|electron-node|0|180.0|22.705|False|
|proxy-tls-electron|electron-node|0|150.0|1.945|False|
|production-proxy-bound|electron|0|90.0|0.614|False|
|proxy-gate-electron|electron-node|0|60.0|0.171|False|
|production-proxy-restart|electron|0|90.0|0.561|False|
|direct-wrapper-electron|electron-node|0|60.0|0.295|False|
|direct-tls-electron|electron-node|0|90.0|0.334|False|
|production-proxy-display|electron|0|90.0|0.63|False|
|production-proxy-display-restart|electron|0|90.0|0.503|False|
|electron-native-sql|electron-node|0|60.0|0.116|False|

## 精确命令与日志指纹

命令在上述工作目录执行。包含复现时失败的命令，不把RED/类型失败/空测试集写成PASS。

### install-frozen — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/run-check.py install-frozen 300.0 node /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/bin/pnpm --config.store-dir=/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/store --config.cache-dir=/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/cache --config.state-dir=/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/state install --frozen-lockfile --offline --package-import-method=copy --side-effects-cache=false --reporter=append-only
```
开始UTC：`2026-10-19T06:52:41.862812+00:00`；日志SHA-256：`9c2796801516c0cff6d49b2f51e81ad710c6cea2d16c753a0468f12057403c0f`；receipt SHA-256：`c61cbdc54d773f02f9b2ae774db561bb838587375a8c7b15bb77a4bb1f23c048`。

### node-native-smoke — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/run-check.py node-native-smoke 60.0 node /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/bin/node /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/node-native-smoke.cjs
```
开始UTC：`2026-10-19T06:53:23.679550+00:00`；日志SHA-256：`9c319b88a0e80df1a43ecefe9ae14df10401883dd61a39dca4fd5fbe9cbbc488`；receipt SHA-256：`cf0b9b72808db99b99acaa2996b2b0d28c26cbececcfb49e200cc992df288d2f`。

### proxy-config-red — exit 1

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/run-check.py proxy-config-red 60.0 node node_modules/.bin/vitest run tests/unit/providers/loopbackProxy.test.ts --reporter=dot
```
开始UTC：`2026-10-19T06:54:09.900191+00:00`；日志SHA-256：`a7a84e247520e656f9415e8624e8a2958c0f6be8f50679e3fb24153dbad32b87`；receipt SHA-256：`a3c9fdb2ad698a5ef6f9cc72dae813e7d174058a4f5a77b1974233bcdc723791`。

### proxy-config-green — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/run-check.py proxy-config-green 60.0 node node_modules/.bin/vitest run tests/unit/providers/loopbackProxy.test.ts --reporter=dot
```
开始UTC：`2026-10-19T07:22:39.709861+00:00`；日志SHA-256：`8ed9f37d758ee829f7ed0985889c00911ba82d718ce3211f1cb1d6e8a9bcf558`；receipt SHA-256：`7f5023fb537a6deeac3973b22bda4e5b76abece70b7705ff8db9b7ec09156405`。

### typecheck-first — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/run-check.py typecheck-first 60.0 node node_modules/.bin/tsc --noEmit --pretty false
```
开始UTC：`2026-10-19T07:22:40.505318+00:00`；日志SHA-256：`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`；receipt SHA-256：`ff67a6fd9359ab434e42f2c09a9ab01f03487068d84fd71ed5e93aba2f216261`。

### proxy-transport-first — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/run-check.py proxy-transport-first 90.0 node node_modules/.bin/vitest run tests/unit/providers/loopbackProxyTransport.test.ts --reporter=dot
```
开始UTC：`2026-10-19T07:24:11.073654+00:00`；日志SHA-256：`afd1e391d4703030e154244720deba9eefe7ede8c9fcd5779aa4feab4fe8b5e8`；receipt SHA-256：`41b989e9481b88abc7b0bf70e2c877a6e8a6bf2490c077e27c2f804b1cc4bee2`。

### node-regression-first — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/run-check.py node-regression-first 180.0 node node_modules/.bin/vitest run --reporter=dot
```
开始UTC：`2026-10-19T10:05:05.000714+00:00`；日志SHA-256：`c7afcd97b6c02ecaa9d7d75b9cf9cdfa066b2bd0176cb39e07d5a6b9cf6f11ab`；receipt SHA-256：`2d54fc6f60c7d9db827a0a17cfbb1169d6871af88dad4d51e3e0432ad578a7f5`。

### typecheck-second — exit 2

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/run-check.py typecheck-second 60.0 node node_modules/.bin/tsc --noEmit --pretty false
```
开始UTC：`2026-10-19T10:05:32.018149+00:00`；日志SHA-256：`97e3b2f78242ae9ea4a2f200dfdb452dff196afabae83b35cbccc18db20ffd81`；receipt SHA-256：`a0c191fd71b4d57f7f0b2f33e5d75e1539c087521214d9da9afdb651eba26229`。

### proxy-timeout-red — exit 1

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/run-check.py proxy-timeout-red 60.0 node node_modules/.bin/vitest run tests/unit/providers/loopbackProxyTransport.test.ts --reporter=dot
```
开始UTC：`2026-10-19T10:06:51.150291+00:00`；日志SHA-256：`387cb317bcf524e8be034e127f5fbfdb757ae1716769cfe1618012d10fdf6344`；receipt SHA-256：`8a7b5d15a22978397c30db86733d9194eea0e2614294ee8d970c99d2e9e87f91`。

### proxy-timeout-green — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/run-check.py proxy-timeout-green 60.0 node node_modules/.bin/vitest run tests/unit/providers/loopbackProxyTransport.test.ts --reporter=dot
```
开始UTC：`2026-10-19T10:07:09.455169+00:00`；日志SHA-256：`3cb8f0f7126a7a9194245612ab84671f7c53b87bbbed2952a613ff332ef612b5`；receipt SHA-256：`a86064c190c79f97dee9d46809b81f3c4eb180925cef98c49c348120722c6c0a`。

### proxy-persistence-first — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/run-check.py proxy-persistence-first 60.0 node node_modules/.bin/vitest run tests/unit/providers/loopbackProxyTransport.test.ts --reporter=dot
```
开始UTC：`2026-10-19T10:08:06.540788+00:00`；日志SHA-256：`92822d62405a91e9865b0bfd4a03b43a2c94cd247446fc052dc6441c5474b515`；receipt SHA-256：`64a63a7b81543c2131cb42d1697d05b3ad5084b345b9e58e283c4d2c16ea91a9`。

### typecheck-final — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/run-check.py typecheck-final 60.0 node node_modules/.bin/tsc --noEmit --pretty false
```
开始UTC：`2026-10-19T10:08:07.553458+00:00`；日志SHA-256：`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`；receipt SHA-256：`3cb05c04bca3f0b767d25b9667d8d777dd2f1dcf5be02c2392c650a59310e724`。

### proxy-malformed — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/run-check.py proxy-malformed 60.0 node node_modules/.bin/vitest run tests/unit/providers/loopbackProxyTransport.test.ts --reporter=dot
```
开始UTC：`2026-10-19T10:08:42.177171+00:00`；日志SHA-256：`c4fb014613b4e869ada5a44a0dece62d600e578fb3b4b9efd93747b1b3dd597b`；receipt SHA-256：`b19b402e168fa7e4a5ff704157a67f31491e79c5b316a29de34e3e2d9e540920`。

### proxy-gate-node — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/run-check.py proxy-gate-node 60.0 node node tests/probes/controlled-proxy-gate.cjs
```
开始UTC：`2026-10-19T10:09:15.912960+00:00`；日志SHA-256：`ec385446afc4966b67d95ebf43b2424dbe797a5b4d70100bbb1c07c9cd5a521b`；receipt SHA-256：`cba9861f3df5f2acf2043b1086abd0cd9456791e1a6569c239d7d5fc52eff233`。

### launcher-python — exit 1

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/run-check.py launcher-python 60.0 tool python3 -B tests/probes/controlled-launcher.test.py
```
开始UTC：`2026-10-19T10:09:16.130556+00:00`；日志SHA-256：`9814f5d60a8cb7c3dd41866165ffde2df34fed982ad25a602720126092639a46`；receipt SHA-256：`2896aed199f41e8c4437a6f2f73eb6cfdc1b9cab4e0fcffa55fbe787f48ae8fd`。

### connect-tls-probe-first — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/run-check.py connect-tls-probe-first 150.0 node /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/bin/node tests/probes/controlled-proxy-tls.cjs
```
开始UTC：`2026-10-19T10:09:25.203164+00:00`；日志SHA-256：`b55dd0a03e306e0810361eac520094e3fa73472ee9accdbe618838179f3ef798`；receipt SHA-256：`84d9e452f6d6c983c1a41e5939e969ea3c339241d9910c2c7745c2b37c30b924`。

### node-regression-final — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/run-check.py node-regression-final 180.0 node node_modules/.bin/vitest run --reporter=dot
```
开始UTC：`2026-10-19T10:09:31.588397+00:00`；日志SHA-256：`e9cd2767c12421da47fad32770d66a1ece0b01f22a2b91be14d4bc27d3e4f5bf`；receipt SHA-256：`1e3b5028dc2882a9803108a109ce69ff44a178da94ac1f0e1e661d6a904153a9`。

### build-final — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/run-check.py build-final 90.0 node pnpm run build
```
开始UTC：`2026-10-19T10:09:31.678196+00:00`；日志SHA-256：`3f18a8b3a39ea6b423510c761186cd82503d072f072af8b49afe67baebaf6dd9`；receipt SHA-256：`d1c1c5ce86c6a25b550f0e123cc7e29060968f11c5a81f32cf9cd8cb91d8752e`。

### connect-tls-probe-stages — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/run-check.py connect-tls-probe-stages 150.0 node /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/bin/node tests/probes/controlled-proxy-tls.cjs
```
开始UTC：`2026-10-19T10:09:50.365494+00:00`；日志SHA-256：`8a3b4e1c2f240cf87e0a061da529678b429c14f10994ad4038a4a081d044d604`；receipt SHA-256：`e06e11430f283b5f106771c91bd199461ba8a6db3cb1b91bd439583e41bc84af`。

### launcher-python-fixed — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/run-check.py launcher-python-fixed 60.0 tool python3 -B tests/probes/controlled-launcher.test.py
```
开始UTC：`2026-10-19T10:10:12.343603+00:00`；日志SHA-256：`33d9a088ac2fdb5230d7265285304c06d0ad3b84cfcc88394ce193f37d329b24`；receipt SHA-256：`9e6685ab13e48dead3a0e36e4819aac7c88b66e3f92a9a734fe622c3d0a645e1`。

### rebuild-electron — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/run-check.py rebuild-electron 180.0 electron pnpm run native:electron
```
开始UTC：`2026-10-19T10:10:47.615401+00:00`；日志SHA-256：`1f9faa3edbda53904eba7c852108c318279540fb646ad1bada7a0b74adafa4f7`；receipt SHA-256：`9c0b6aa8e77d938dc1c6274c91b2a143ee27985591953af30d7e0e3e3e377ce1`。

### production-proxy-first — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/run-check.py production-proxy-first 90.0 electron node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/controlled-launcher-electron.cjs --proxy-mode
```
开始UTC：`2026-10-19T10:11:27.523325+00:00`；日志SHA-256：`2b9209b653b8d882f1209d9052accf0caae66046325a9ce7086ff8a510bc06fa`；receipt SHA-256：`480c4323930fbcd054ef0c3791abd5989a34b4c60f1110226602dd10edfcc5f2`。

### electron-regression — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/run-check.py electron-regression 180.0 electron-node node_modules/electron/dist/Electron.app/Contents/MacOS/Electron node_modules/vitest/vitest.mjs run --reporter=dot
```
开始UTC：`2026-10-19T10:11:27.561816+00:00`；日志SHA-256：`c335a6fc43d186edb0cdb580af835bd820bbe216800799c99e62cc36d21ff49d`；receipt SHA-256：`4e451fe19db58ac35b066df55ff0959d838a88f7dd2e1b5823850ed1e6341e20`。

### proxy-tls-electron — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/run-check.py proxy-tls-electron 150.0 electron-node node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/controlled-proxy-tls.cjs
```
开始UTC：`2026-10-19T10:11:29.211208+00:00`；日志SHA-256：`f38de5a67fdceefc3d68de8556e6a3433d8db7865287e420b0ef15f48e9a2435`；receipt SHA-256：`2aade0a62129c3d2dce243835b197e5c2e475f8c8a1250e9e9ce2c1ffa7e0e21`。

### production-proxy-bound — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/run-check.py production-proxy-bound 90.0 electron node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/controlled-launcher-electron.cjs --proxy-mode
```
开始UTC：`2026-10-19T10:12:34.785201+00:00`；日志SHA-256：`7ded06ee5e792acf126a1701219b6293e7d8d8add7f648a7e2b634f093853721`；receipt SHA-256：`b504a86ea2f78992ef7cc552723050d42ecb496cba645f208f8a913ace688519`。

### proxy-gate-electron — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/run-check.py proxy-gate-electron 60.0 electron-node node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/controlled-proxy-gate.cjs
```
开始UTC：`2026-10-19T10:13:03.584147+00:00`；日志SHA-256：`ec385446afc4966b67d95ebf43b2424dbe797a5b4d70100bbb1c07c9cd5a521b`；receipt SHA-256：`1f3c73d84fca05663fd8f85a7103312b4503f8dee3963abd0831a87aac25c9d3`。

### production-proxy-restart — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/run-check.py production-proxy-restart 90.0 electron node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/controlled-launcher-electron.cjs --proxy-mode --restart /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/test-tmp/roundtable-launcher-probe-nFIn2t/probe-manifest.json
```
开始UTC：`2026-10-19T10:13:03.666132+00:00`；日志SHA-256：`d8f886d7b1fd5a6708e464a99752330738256c148eb2c52eff854bde015f738f`；receipt SHA-256：`403d7217886747dacdc51ad6790192dfa8e1461d12c9f4789652639c25f24131`。

### direct-wrapper-electron — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/run-check.py direct-wrapper-electron 60.0 electron-node node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/controlled-network.cjs
```
开始UTC：`2026-10-19T10:13:03.834443+00:00`；日志SHA-256：`4adfd5d1452e8264b0889ee83cf0cf4a2294351c8ce90c30a49f1642e4925481`；receipt SHA-256：`9eac77957e4e47e3aeda550b56182071df346caa187b9167cfc20668a14f1164`。

### direct-tls-electron — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/run-check.py direct-tls-electron 90.0 electron-node node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/controlled-network-tls.cjs
```
开始UTC：`2026-10-19T10:13:04.217272+00:00`；日志SHA-256：`37c4ec57bb1e5cfb057f6670c8a8f71a0bfdcb33f6f0bb63daa9b436ede2340e`；receipt SHA-256：`8d99b43bd276dcc6027341f6e6e9d7980caa719013d7e3e6d4b6c26289acda92`。

### production-proxy-display — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/run-check.py production-proxy-display 90.0 electron node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/controlled-launcher-electron.cjs --proxy-mode
```
开始UTC：`2026-10-19T10:13:54.890073+00:00`；日志SHA-256：`8bd328ea578e200813a69f3d1539dee7abd9142ec06e0070d6a31c2e37e88fbb`；receipt SHA-256：`d0ae4106609de9e98acb4752ad615f91095ba50d42e563a6f0245375d82b3d0a`。

### production-proxy-display-restart — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/run-check.py production-proxy-display-restart 90.0 electron node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/controlled-launcher-electron.cjs --proxy-mode --restart /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/test-tmp/roundtable-launcher-probe-OVaasU/probe-manifest.json
```
开始UTC：`2026-10-19T10:14:11.296163+00:00`；日志SHA-256：`247e164734f59bf635ee636ab2cb99cdc12c8718fa0aefa55ba2b610380bbb77`；receipt SHA-256：`d3c72aa4b1f84b9774a485719e18b1230ca35c844e8300bca4be6d6a697ce33b`。

### electron-native-sql — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-loopback-proxy-i1dgt4lu/run-check.py electron-native-sql 60.0 electron-node node_modules/electron/dist/Electron.app/Contents/MacOS/Electron -e 'const assert=require("node:assert/strict");const Sqlite=require("better-sqlite3");assert.equal(process.versions.electron,"38.8.6");assert.equal(process.versions.modules,"139");const db=new Sqlite(":memory:");db.exec("CREATE TABLE owned_fixture(n INTEGER)");const put=db.prepare("INSERT INTO owned_fixture VALUES(?)");db.transaction(()=>{for(let n=0;n<10000;n++)put.run(n)})();assert.equal(db.prepare("SELECT SUM(n) s FROM owned_fixture").get().s,49995000);assert.equal(db.pragma("integrity_check",{simple:true}),"ok");db.close();console.log(JSON.stringify({electron:process.versions.electron,node:process.versions.node,abi:process.versions.modules,rows:10000,checks:4,closed:true}));'
```
开始UTC：`2026-10-19T10:14:37.485243+00:00`；日志SHA-256：`7b217c7f44eaeb2477e5e1d6d11f5937752a46d8de0ef556ddd72e6c0663a4cc`；receipt SHA-256：`7aeb8c9cf30512ad3d088049e049a81469b683868446606a52ae3afc5ea1242f`。

## 最终结果解读

- node-regression-final / electron-regression：各86文件1292/1292，exit0；两组不累加。19配置/18传输专项已包含其中。
- typecheck-final / build-final：strict与生产构建exit0。最早typecheck-second exit2仅新增测试SNI的string|false|null类型；修正测试记录类型后通过。
- proxy-config-red：未实现模块导致suite失败、0测试，exit1；实现后19/19。proxy-timeout-red：13通过1失败、exit1，实际复现CONNECT截止时间误报cancelled；修正后14/14，再补持久化/异常头至18项。
- launcher-python：新增Popen模拟误拦截Git子进程，2 errors/24、exit1；仅收窄测试mock，launcher-python-fixed 24/24、exit0。
- proxy-gate-node / proxy-gate-electron：各13场景57断言；真实socket0。connect-tls-probe-stages / proxy-tls-electron：各10场景121断言，公共DNS/API0，只有自建回环CONNECT/TLS。
- direct-wrapper-electron：8场景；direct-tls-electron：5场景30断言，保留直连防护。
- production-proxy-display：31条；production-proxy-display-restart：24条；真实生产Main/Preload/App和新进程，fake safeStorage、自有profile/unknown，退出v4/integrity/相同JSON审计，API/真实Keychain0。
- install-frozen：646 reused/0 downloaded，独立copy-import/node_modules，非冷缓存公网安装。Node内存SQL10000行、独立inode/锁一致。Electron匹配重建及ABI139内存SQL10000行/4断言/关闭exit0。

一次完整回归启动在执行前被自动审批服务额度耗尽阻止，没有进程/退出码，不能记为失败测试或PASS；用户继续后沿同一审批路径执行成功。协作早期模拟探针发现early-body假原生未尊重destroy，收紧gate并修正fixture，最终57断言包含此拒绝。

生产Electron保留sandbox_extension_issue_file_to_process警告；实际隔离/sandbox/Bridge/自然退出与数据库审计由断言确认。构建保留Zod PURE注释警告。

本轮未复验真实FClash端口/代理协议/公网/系统Keychain，不读原unknown记录；不能反推首次network_error、费用或清除¥0.05。原价格快照已过期且未改，普通严格生成仍blocked、实际launcher未授权发送。
