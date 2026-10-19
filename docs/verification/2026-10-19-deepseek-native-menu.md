# DeepSeek 原生许可菜单最小修复

2026-10-19；基线6c907326aaebbbb4ba44a1566af482b093f77bf4，分支codex/deepseek-native-menu-fix；复用干净独立Worktree与其独立Electron38.8.6/ABI139依赖，不安装、不重编译、不改当前用户窗口。

## 根因与改动

CUA实际读取运行中的main6c90732原生macOS菜单，只有原5项，确实没有“准备本会话单次许可…”。源码installTrialMenu先Menu.setApplicationMenu，随后启动器才向JS submenu追加许可项，没有重新安装。旧探针直接item.click，只证明JS对象存在，未验证原生菜单栏。

产品修复只有scripts/controlled-desktop/main.cjs一行：追加后对同一顶层菜单重新Menu.setApplicationMenu。没有修改Service、Shared/IPC/Preload、Key、迁移、报价、默认权限或网络门禁。Main原生入口无需新增Renderer IPC。

探针新增安装时不可变标签快照断言（不保存可变Menu对象），以及仅fixture使用的限时AX观察等待。旧代码RED自然exit1，精确失败native installation includes the session-permit item，在配置Key/生成之前退出；失败日志保留。修复后实际CUA在自有fixture窗口的原生菜单看到第6项“准备本会话单次许可…”，没有选择真实用户许可。

## 实际验证

- 安装快照RED exit1；GREEN真实新版launcher/Main/App38条具名断言，1次自有local HTTP fixture、真实API0/真实Keychain0，exit0。
- CUA真实AX先确认用户当前菜单缺项，再确认自有fixture菜单实际可见；没有点击用户的许可/发送、没有重启用户窗口。
- 独立新进程重启19断言，自动请求0，exit0。
- 会话权限22断言、菜单/互斥37测试、Python启动器24测试、TypeScript strict、diff --check均exit0。不重复无关全量回归。
- 保持单次、Provider/request/Keyrevision绑定、固定Reply OK./128/¥0.05、取消/退出/重启失效、无自动重试；普通真实Run仍blocked。

没有读取真实Key、用户SQLite、Keychain、旧unknown或人工对账记录；没有改FClash/系统网络，未授予真实发送许可。实际用户已人工处理的记录不再操作。

## 使用

用户自行正常退出旧窗口，双击最新绑定main的本地启动入口，原独立profile及显式127.0.0.1:7890代理保持。设置中重新确认精确目标后，“受控测试 → 准备本会话单次许可…”→选择DeepSeek Provider→“仅准备这一次许可”→最终“授权并发送这一次请求”（仅用户本人）。不需要重复人工对账。

## 实际命令与失败台账

监督器根：`/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-native-menu-ixqq8cmd`。每条argv/exit/timeout及日志SHA如下；stderr既有sandbox_extension提示保留，不等于正式桌面E2E或真实Keychain通过。


## 正式合并与主线复验

获本次用户直接授权后，重新确认main6c907326aaebbbb4ba44a1566af482b093f77bf4与候选68bfba571a429530dfabf90004686745e578ff51均干净、祖先关系正确，严格`git merge --ff-only codex/deepseek-native-menu-fix`，exit0。独立审核未发现门禁放宽，所有分支/Worktree保留。

主线新隔离profile实际生产38/重启19、单次权限22、菜单/互斥37和strict全部exit0，merged/verified。本次只改启动器原生菜单同步一行，业务Main/Preload/Renderer/IPC/Database无源码变化，生产复验复用字节未变的6c90732业务out、实际加载新启动器；最终另生成准确绑定main的生产启动快照。未重建main native、不覆盖原out、不访问实际Key/用户DB，不重做人工对账，也未关闭/更新当前窗口。

以下补全本轮实际argv、exit与日志指纹（RED保留）；不是历史全量测试成绩。

### native-menu-red

UTC 2026-10-19T15:26:28.402314+00:00；cwd `/Users/zhangwenjie/.codex/worktrees/deepseek-final-readiness/AI交互`；exit 1；timeout=False。

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/deepseek-final-readiness.cjs
```

日志SHA256 `e4cd116f9acdac1616dff9aea2dcf1843816113441984023dedd4c36f9e20711`。

### native-menu-green-ax

UTC 2026-10-19T15:26:45.297083+00:00；cwd `/Users/zhangwenjie/.codex/worktrees/deepseek-final-readiness/AI交互`；exit 0；timeout=False。

```sh
env ROUNDTABLE_PROBE_HOLD_NATIVE_MENU=1 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/deepseek-final-readiness.cjs
```

日志SHA256 `c31e1fc72e5b10f07e766dbefde5cb32c50a102f3a8894372d1778e5ef8c4603`。

### menu-typecheck

UTC 2026-10-19T15:27:59.339394+00:00；cwd `/Users/zhangwenjie/.codex/worktrees/deepseek-final-readiness/AI交互`；exit 0；timeout=False。

```sh
node_modules/.bin/tsc --noEmit --pretty false
```

日志SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。

### menu-progression

UTC 2026-10-19T15:27:59.472113+00:00；cwd `/Users/zhangwenjie/.codex/worktrees/deepseek-final-readiness/AI交互`；exit 0；timeout=False。

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron node_modules/vitest/vitest.mjs run tests/unit/providers/controlledTrialMenu.test.ts tests/integration/deepseek/mutualExclusion.test.ts --reporter=dot
```

日志SHA256 `7bda0628e7c7137e6d12c51c6253bb7864d43a77c53ca2089d58cf437a0f10cb`。

### menu-safety

UTC 2026-10-19T15:28:00.670529+00:00；cwd `/Users/zhangwenjie/.codex/worktrees/deepseek-final-readiness/AI交互`；exit 0；timeout=False。

```sh
node tests/probes/controlled-session-authorization.cjs
```

日志SHA256 `4f62b32684fb472671f559d673f1218bf865bfadc784e4dffce89ff9b26e3912`。

### menu-launcher-tests

UTC 2026-10-19T15:28:00.764791+00:00；cwd `/Users/zhangwenjie/.codex/worktrees/deepseek-final-readiness/AI交互`；exit 0；timeout=False。

```sh
python3 -B tests/probes/controlled-launcher.test.py
```

日志SHA256 `6c6a347446e461b4f7a59bca55c4ba027b9692ed860e4091f3b2d0f1a3024b33`。

### menu-production-restart

UTC 2026-10-19T15:28:52.669027+00:00；cwd `/Users/zhangwenjie/.codex/worktrees/deepseek-final-readiness/AI交互`；exit 0；timeout=False。

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/deepseek-final-readiness.cjs --restart /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-native-menu-ixqq8cmd/test-tmp/roundtable-final-readiness-probe-WCO9t1/manifest.json
```

日志SHA256 `950790dd6af00e0374fbcf67c7b73bf82312a38b153cda6b8f0e67c986235a30`。

### main-menu-safety

UTC 2026-10-19T15:30:38.449806+00:00；cwd `/Users/zhangwenjie/Documents/ChatGPT/AI交互`；exit 0；timeout=False。

```sh
node tests/probes/controlled-session-authorization.cjs
```

日志SHA256 `4f62b32684fb472671f559d673f1218bf865bfadc784e4dffce89ff9b26e3912`。

### main-menu-regression

UTC 2026-10-19T15:30:41.689414+00:00；cwd `/Users/zhangwenjie/Documents/ChatGPT/AI交互`；exit 0；timeout=False。

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron node_modules/vitest/vitest.mjs run tests/unit/providers/controlledTrialMenu.test.ts tests/integration/deepseek/mutualExclusion.test.ts --reporter=dot
```

日志SHA256 `88aca0010640bbf599edfb4cf96413eab733fdadc0532a9b3652189156ad101f`。

### main-menu-production

UTC 2026-10-19T15:30:42.665690+00:00；cwd `/Users/zhangwenjie/Documents/ChatGPT/AI交互`；exit 0；timeout=False。

```sh
env 'ROUNDTABLE_PROBE_OUT=/Users/zhangwenjie/Documents/ChatGPT/AI交互/.cache/controlled-desktop-main/builds/6c907326aaebbbb4ba44a1566af482b093f77bf4/out' node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/deepseek-final-readiness.cjs
```

日志SHA256 `75b0257ef9fcb024511e7da763082290497cf3b3773c8c496b9c8c7b0658f73b`。

### main-menu-restart

UTC 2026-10-19T15:31:18.074085+00:00；cwd `/Users/zhangwenjie/Documents/ChatGPT/AI交互`；exit 0；timeout=False。

```sh
env 'ROUNDTABLE_PROBE_OUT=/Users/zhangwenjie/Documents/ChatGPT/AI交互/.cache/controlled-desktop-main/builds/6c907326aaebbbb4ba44a1566af482b093f77bf4/out' node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tests/probes/deepseek-final-readiness.cjs --restart /private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-native-menu-ixqq8cmd/main/test-tmp/roundtable-final-readiness-probe-WAH5LH/manifest.json
```

日志SHA256 `8977f95cb5471be3723e2c124d32044e9409ba967ebb5ab4bc25ec67dc04c118`。

### main-menu-strict

UTC 2026-10-19T15:31:18.496735+00:00；cwd `/Users/zhangwenjie/Documents/ChatGPT/AI交互`；exit 0；timeout=False。

```sh
node_modules/.bin/tsc --noEmit --pretty false
```

日志SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。
