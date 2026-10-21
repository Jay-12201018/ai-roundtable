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

在目标目录内依次执行（`package.json` 已经内置 Electron 运行方式）：

1. 类型检查：`pnpm run typecheck 2>&1 | tail -n 20`
2. 测试：`pnpm test [过滤] --reporter=dot 2>&1 | tail -n 25`
   - `pretest` 会运行 `scripts/ensure-native.cjs`：better-sqlite3 在 Electron 里加载不了时，才会重建 Electron ABI 版本。重建失败时如实报告错误原文，不要改用宿主 Node 跑测试来绕过。
   - 结果为 0 个测试文件，就算失败。
   - 出现 `listen EPERM`，说明测试根本没执行，不算通过。
3. 构建：`pnpm run build 2>&1 | tail -n 15`
4. 涉及 Main/Preload/Renderer 接线或 Provider 时，再跑隔离生产探针：先 `./node_modules/.bin/electron tests/probes/r10-r11-electron.cjs`，再用输出里的 manifest 执行 `--restart <manifest>`。结束后删掉它自己创建的 `roundtable-r10r11-production-*` 临时目录。

## 构建报 Team ID / code signature 错误

这说明宿主 `node` 是带签名的应用内置 Node（交接时 `/opt/homebrew/bin/node` 指向 ChatGPT.app）。解决办法是改用正常的 Node：`PATH=/opt/homebrew/opt/node@24/bin:$PATH pnpm run build`；或者经用户同意后修正那个符号链接。不要再复制 Node 重新签名来绕过。

## 报告格式

用一张表列出每项检查：命令、退出码、关键数字（文件数和测试数）。失败的项附上最多 10 行错误原文和初步判断。最后一句说明没有覆盖的范围，例如：没有桌面 E2E、没有真实 Provider、只验证了 macOS arm64。
