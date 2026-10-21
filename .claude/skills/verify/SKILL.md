---
name: verify
description: AI Roundtable 的标准本地检查（typecheck、Vitest 单元/集成、build、Electron SQLite smoke），只输出结论和失败摘要。改完代码、合并前、或用户问"测试过了吗"时使用；可传 worktree 路径和测试子路径。
---

# verify：项目本地检查

参数：`[仓库或 worktree 路径] [vitest 路径过滤...]`。不传路径就用当前目录；传了过滤就只跑这些测试，同时说明这是部分检查，不是全量。

## 原则

- 所有测试都在 **Electron 自带的 Node（ABI139）** 里跑，不在宿主 Node 里跑。better-sqlite3 只保留 Electron 这一套编译产物，彻底省掉 Node/Electron 两套 ABI 来回重建（这是 Codex 时期反复出问题的根源），也避开 Node 24.19+ 的 #65446 崩溃。
- 不调用 `pnpm test`：它的 `pretest` 会把 better-sqlite3 重新编译成宿主 Node 的 ABI。
- 命令输出只看结尾：`2>&1 | tail -n 20`。不要把整份日志读进上下文。
- 每一项单独记录退出码。用 zsh 的 `${pipestatus[1]}` 取管道里第一个命令的退出码，不能被 `tail` 的 0 掩盖。
- 不启动应用窗口、不碰 `~/Library/Application Support/ai-roundtable`、不发网络请求。

## 步骤

在目标目录内依次执行：

```bash
E=./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron
```

1. SQLite 能否被 Electron 加载（不能加载就先修复，见下文）：
   ```bash
   ELECTRON_RUN_AS_NODE=1 $E -e 'const D=require("./node_modules/better-sqlite3");const d=new D(":memory:");d.exec("create table t(v)");d.close();console.log("SQLite OK ABI "+process.versions.modules)'
   ```
2. 类型检查：`./node_modules/.bin/tsc --noEmit --pretty false 2>&1 | tail -n 20`
3. 测试：`ELECTRON_RUN_AS_NODE=1 $E node_modules/vitest/vitest.mjs run [过滤] --reporter=dot 2>&1 | tail -n 25`
   - 结果为 0 个测试文件，就算失败。
   - 如果是 `listen EPERM`，说明测试根本没执行，不算通过；需要换到允许本地监听的环境重跑。
4. 构建：`./node_modules/.bin/electron-vite build 2>&1 | tail -n 15`

## 第 1 步失败时（ABI 不匹配）

报错如果是 `NODE_MODULE_VERSION` 不匹配，执行 `./node_modules/.bin/electron-rebuild --force --which-module better-sqlite3`，然后重跑第 1 步。重建可能因 `~/.electron-gyp` 不可写或网络问题失败，这时如实报告错误原文，不要换用宿主 Node 去跑测试来绕过。

## 报告格式

用一张表列出每项检查：命令、退出码、关键数字（文件数和测试数）。失败的项附上最多 10 行错误原文和初步判断。最后一句说明没有覆盖的范围，例如：没有桌面 E2E、没有真实 Provider、只验证了 macOS arm64。
