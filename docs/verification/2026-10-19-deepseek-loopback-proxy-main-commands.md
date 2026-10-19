# 回环代理合并后 main 命令台账

2026-10-19，受检main为04bf8a20e047f3c46cb3017921ddac049ba9f5ae；从1c4d2afb1afbae288ac1201c618ffd9cc39999bb执行git merge --ff-only codex/deepseek-loopback-proxy，实际exit0、Fast-forward。下列均为合并后新执行，不引用候选成绩。

cwd：`/Users/zhangwenjie/Documents/ChatGPT/AI交互`；隔离验证根目录：`/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-proxy-main-zrfhcul0`。
有界监督器SHA-256：`d34833fb79ca8a43bddcdb63599bb2e154d47d64c31d1279e228f41d6e398c07`。

Node模式固定官方24.18.1/arm64（本轮ABI137只跑纯网络/类型/构建）；electron-node设置ELECTRON_RUN_AS_NODE=1，实际Electron38.8.6/Node22.22.0/ABI139。使用main已有匹配原生文件，不安装/重建/压力测试。每条有独立JSON、log、源指纹及外部时限。

|label|mode|exit|上限秒|耗时秒|timeout|
|---|---|---:|---:|---:|---|
|main-typecheck|node|0|60.0|1.972|False|
|main-proxy-tls-node|node|0|90.0|0.612|False|
|main-build|node|0|90.0|2.156|False|
|main-full-regression|electron-node|0|180.0|21.183|False|
|main-proxy-gate-node|node|0|60.0|0.089|False|
|main-launcher-python|tool|0|60.0|8.515|False|
|main-diagnostics-special|electron-node|0|90.0|21.04|False|
|main-production-proxy|electron|0|90.0|0.831|False|
|main-proxy-tls-electron|electron-node|0|90.0|0.776|False|
|main-direct-diagnostics|electron-node|0|60.0|0.287|False|
|main-proxy-gate-electron|electron-node|0|60.0|0.18|False|
|main-production-restart|electron|0|90.0|0.554|False|
|main-runtime-node|node|0|30.0|0.169|False|
|main-native-abi|electron-node|0|30.0|0.113|False|

## main-typecheck — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-proxy-main-zrfhcul0/run-check.py main-typecheck 60.0 node node node_modules/typescript/bin/tsc --noEmit --pretty false
```
开始UTC：`2026-10-19T10:27:10.190674+00:00`；日志SHA：`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`；receipt SHA：`d7f84fa3f986f6b9a2cbc9875b4a1624a13d8d4fcd9d95ab1159c0ed64bc2b1f`。

## main-proxy-tls-node — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-proxy-main-zrfhcul0/run-check.py main-proxy-tls-node 90.0 node node tests/probes/controlled-proxy-tls.cjs
```
开始UTC：`2026-10-19T10:27:12.155346+00:00`；日志SHA：`72f0510ad68f5af0094d47ee33be193d94f31d748d09ed50a0bb7af5a34e85dc`；receipt SHA：`3a3a35a1088ec5a749bbb33bcaa2e81356f8b194e86a7f8fbf26745725cf93b0`。

## main-build — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-proxy-main-zrfhcul0/run-check.py main-build 90.0 node node node_modules/electron-vite/bin/electron-vite.js build --outDir /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-proxy-main-zrfhcul0/production/out
```
开始UTC：`2026-10-19T10:27:12.249046+00:00`；日志SHA：`84bb8f25c27bd367a220b0aae495ac6cf0404f0d28e5b9bd0f729c4d39cb5128`；receipt SHA：`e4802a744d378ad0de1fe1cd06c158576e2efc39e6b5308ba69328803976ca1f`。

## main-full-regression — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-proxy-main-zrfhcul0/run-check.py main-full-regression 180.0 electron-node node_modules/electron/dist/Electron.app/Contents/MacOS/Electron node_modules/vitest/vitest.mjs run --reporter=dot
```
开始UTC：`2026-10-19T10:27:12.743541+00:00`；日志SHA：`1932d05dc2d40aa773502c188d586fa16109ec0b451a472b20f3282575d0ddc9`；receipt SHA：`3406d71243c306c17415f0be9c83b9dacfc5d934cebb70128f1ce851e3c45bbc`。

## main-proxy-gate-node — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-proxy-main-zrfhcul0/run-check.py main-proxy-gate-node 60.0 node node tests/probes/controlled-proxy-gate.cjs
```
开始UTC：`2026-10-19T10:27:12.828097+00:00`；日志SHA：`ec385446afc4966b67d95ebf43b2424dbe797a5b4d70100bbb1c07c9cd5a521b`；receipt SHA：`9025f5e0ee60cc8d7a0191ba9270340d4458eb74d5bf9c003f359ba17d25f60f`。

## main-launcher-python — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-proxy-main-zrfhcul0/run-check.py main-launcher-python 60.0 tool python3 -B tests/probes/controlled-launcher.test.py
```
开始UTC：`2026-10-19T10:27:12.990204+00:00`；日志SHA：`03880fc349f03fc446de820720440444ed5124f204c055ab28033abbeae63929`；receipt SHA：`08cd1a3412824347b9869f78019e36f71635406b95c4726408413718b3e69c5a`。

## main-diagnostics-special — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-proxy-main-zrfhcul0/run-check.py main-diagnostics-special 90.0 electron-node node_modules/electron/dist/Electron.app/Contents/MacOS/Electron node_modules/vitest/vitest.mjs run tests/unit/providers/network.test.ts tests/unit/providers/diagnosticsTransport.test.ts tests/unit/providers/controlledTrialMenu.test.ts tests/unit/providers/loopbackProxy.test.ts tests/unit/providers/loopbackProxyTransport.test.ts tests/integration/deepseek --reporter=dot
```
开始UTC：`2026-10-19T10:28:11.153733+00:00`；日志SHA：`bfeeb6498c7dc2197f6dc17504306a093679af020aa9781d9f514707c39634d2`；receipt SHA：`0fbaffbc65afe5af91093388f01a4d91862faa83a8836abeab6365fbd55ba55f`。

## main-production-proxy — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-proxy-main-zrfhcul0/run-check.py main-production-proxy 90.0 electron node_modules/electron/dist/Electron.app/Contents/MacOS/Electron /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-proxy-main-zrfhcul0/production-probe.cjs --proxy-mode
```
开始UTC：`2026-10-19T10:28:11.770033+00:00`；日志SHA：`a66c58720c4d93b3eba30d9411616de195b7deb7bb2d74d97db19547a5437db8`；receipt SHA：`c79aa6dde7afb374cce3054e6cdabb5b36b5376df6d73f8c1dce3faebaadd787`。

## main-proxy-tls-electron — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-proxy-main-zrfhcul0/run-check.py main-proxy-tls-electron 90.0 electron-node node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/controlled-proxy-tls.cjs
```
开始UTC：`2026-10-19T10:28:13.056085+00:00`；日志SHA：`288ded535651d78190f147862fd6acba6e3c37e0e9a3057d095be68116c1fb50`；receipt SHA：`fd55405b221ada4bec0b0edffa34352e7c20f42d8ce6ea9e264496f157569289`。

## main-direct-diagnostics — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-proxy-main-zrfhcul0/run-check.py main-direct-diagnostics 60.0 electron-node node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/controlled-network.cjs
```
开始UTC：`2026-10-19T10:28:13.933152+00:00`；日志SHA：`4adfd5d1452e8264b0889ee83cf0cf4a2294351c8ce90c30a49f1642e4925481`；receipt SHA：`2c3f8aece950d66b98881e0739227aaa54c674242a309f0752fc9a2a2385385d`。

## main-proxy-gate-electron — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-proxy-main-zrfhcul0/run-check.py main-proxy-gate-electron 60.0 electron-node node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/controlled-proxy-gate.cjs
```
开始UTC：`2026-10-19T10:28:14.309522+00:00`；日志SHA：`ec385446afc4966b67d95ebf43b2424dbe797a5b4d70100bbb1c07c9cd5a521b`；receipt SHA：`230cd86142dd7977f102e943c5ac50fe16a6e56cedb82fcff4d740b8b9437508`。

## main-production-restart — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-proxy-main-zrfhcul0/run-check.py main-production-restart 90.0 electron node_modules/electron/dist/Electron.app/Contents/MacOS/Electron /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-proxy-main-zrfhcul0/production-probe.cjs --proxy-mode --restart /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-proxy-main-zrfhcul0/test-tmp/roundtable-launcher-probe-eKrqXv/probe-manifest.json
```
开始UTC：`2026-10-19T10:28:42.467675+00:00`；日志SHA：`c17ec11628a8843cd6484d51da833edb4d657c06ae9a6e0bd8a54b8f98d9fc25`；receipt SHA：`0b3720b2b9f7a94d76b90fdacd69355b045bd1b19f207071cb84a5b6bf125c18`。

## main-runtime-node — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-proxy-main-zrfhcul0/run-check.py main-runtime-node 30.0 node node -p 'JSON.stringify({node:process.version,abi:process.versions.modules,arch:process.arch})'
```
开始UTC：`2026-10-19T10:28:43.090658+00:00`；日志SHA：`98f21ccb0c9f62f2c6536b02694f7990de7f2dc23f96587deff261b1fdf7da4e`；receipt SHA：`847548b2e4333e5a607daac59535fe2cbc8b6f1f9605a75c8006e7c50a0858e6`。

## main-native-abi — exit 0

```sh
python3 /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-proxy-main-zrfhcul0/run-check.py main-native-abi 30.0 electron-node node_modules/electron/dist/Electron.app/Contents/MacOS/Electron -e 'const assert=require("node:assert/strict");assert.equal(process.versions.electron,"38.8.6");assert.equal(process.versions.modules,"139");const Sqlite=require("better-sqlite3");const db=new Sqlite(":memory:");db.exec("CREATE TABLE owned_probe(value TEXT)");db.prepare("INSERT INTO owned_probe VALUES(?)").run("safe");assert.equal(db.prepare("SELECT value FROM owned_probe").get().value,"safe");assert.equal(db.pragma("integrity_check",{simple:true}),"ok");db.close();console.log(JSON.stringify({electron:process.versions.electron,node:process.versions.node,abi:process.versions.modules,assertions:4,closed:true}));'
```
开始UTC：`2026-10-19T10:28:43.323290+00:00`；日志SHA：`9a0a45210b4387cb57f2732cf868623ca2ec6f45ce838674cd339e78234fe0d0`；receipt SHA：`04bc2f1b8fa4b3a516d415c1cf2a2c4fc005863b8f8ecea1cab81bace0d1c4e8`。

## 输出与边界

- main-full-regression：86文件1292/1292；main-diagnostics-special：12文件279/279。专项含在完整组，不累加。
- main-proxy-tls-node/electron：各10场景121断言，Fake-IP拒绝、真实本地CONNECT/TLS/SSE成功、证书/主机名/407/502/302/429和无授权/无lease拒绝。公共DNS/API、真实Key读取0。
- main-proxy-gate-node/electron：各13场景57断言，模拟原生调用，无socket；main-direct-diagnostics：8场景。
- main-launcher-python：24/24；启动模拟pid999999及随机Git测试main不是实际启动用户App。
- main-typecheck/main-build：strict和三个生产输出通过，outDir仅新临时目录。
- main-production-proxy/main-production-restart：31/24断言，自建profile/fake safeStorage/假Key，实际Main/Preload/App及原生菜单、代理注入、unknown/¥0.05恢复/退出SQLite审计。API/真实Keychain0。
- main-runtime-node：v24.18.1/ABI137/arm64；main-native-abi：Electron38.8.6/Node22.22.0/ABI139，4项内存SQL/证据断言及关闭。

本轮无检查失败或超时。保留Zod PURE注释/临时outDir警告、Electron sandbox_extension/task_policy系统警告；真实sandbox/Bridge/自然退出/DB审计断言通过。未复制或触碰真实profile/Key/费用记录。

production-probe.cjs仅在新fixture进程设置GIT_DIR/GIT_WORK_TREE指向真实仓库并加载逐字节复制的生产探针/包装器；独立构建和main依赖只读链接，不覆盖out/native。辅助脚本与原始日志在验证根目录，SHA见本节。

- `production-probe.cjs` SHA-256：`075d22310459499b076cff948e0118f376ba33e5a8ef55ae1637339dde78919d`。
- `production-copied-files.json` SHA-256：`f0155ad0b355c47c55ec4eea86875cf899a8eda97dc209ecef9955f9332326b7`。
- `protected-main-artifacts-before.json` SHA-256：`469148be40a49ed122e5c79026e5167e50c9dd541f64c02d9aaf39c691c432f8`。
- `protected-main-artifacts-after.json` SHA-256：`469148be40a49ed122e5c79026e5167e50c9dd541f64c02d9aaf39c691c432f8`。

受保护main out/native共7文件SHA及inode前后完全一致。Database/迁移1–4、Shared/Preload/Renderer及package/lock对原main git diff exit0。只追加治理证据，不修改合并后业务或测试输入。没有重复Node完整测试、冷缓存安装或原生压力，不将这些未执行项写PASS。

真实FClash协议/端口、公共DNS/TCP/TLS/CONNECT与系统Keychain本轮未验证；下一步仅握手诊断须另获授权，不能发送隧道内任何HTTP/API字节、读Key、创建Trial、释放unknown或开启发送lease。
