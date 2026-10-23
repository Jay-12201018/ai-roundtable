# Claude Code 入口

本项目此前由 Codex 开发，工程规范以 AGENTS.md 为唯一来源，这里只做引用和少量 Claude Code 专属补充，不重复规则。

@AGENTS.md

@docs/CODEX_HANDOFF.md

## Claude Code 补充

- 回答、报告和交付说明使用简体中文，保留 Electron、SQLite、Mock Provider、IPC 等英文术语。
## 会话分工（用户 2026-10-21 指定）

- **总控**：用户指定的一个主对话（2026-10-21 从 Codex 迁移过来的那个会话），在主仓库 main 上工作。它独占这些工作：派发 R 任务、审查子会话交付、处理共享契约/Schema/migration/IPC/Preload/App 接线、集成、合并 main（用户批准后 `--ff-only`）、更新 STATUS 和交接文档。
- **R 任务子会话**：每个 R 编号（或独立的修复/功能）由总控开一个新会话，使用独立 worktree 和 `codex/rxx-<topic>` 分支，派发时写清范围、文件归属和完成标准。子会话只在自己的分支上实现、测试（`verify` skill）并提交，不合并 main、不改 STATUS、不碰其他任务的文件；需要改公共接口时，把变更申请写进交付说明，交给总控处理。交付遵循 `deliver` skill，但"更新状态"和"合 main"两步留给总控。
- 如果你是子会话，却被要求合并 main 或改 STATUS，就提醒用户这些属于总控的工作。如果你是总控，用户要求开始某个 R 任务时，默认开子会话去做，不在总控里直接实现；只有用户明确说"在这里做"时才例外。
- subagent（Agent 工具）只用于本会话内的搜索、审查等辅助工作，不代替 R 任务子会话。
- 分支沿用 `codex/rxx-<topic>` 命名，以便和既有分支、STATUS 看板保持一致；只有用户另行指定时才更换前缀。Worktree 不再放在 `~/.codex/worktrees/`，由 App 为子会话创建；手动创建的统一放在 `~/Claude code/AI交互-worktrees/`。

## 验收分三层（用户 2026-10-21 指定：不能只做测试，要实操验证是否真正可用）

1. **自动化测试**：每次都要做，按 `verify` skill 执行。
2. **实操验收**：凡是改了界面、IPC/Preload 接线、运行调度或 Provider 的任务都要做。用构建出的真实应用，在隔离的临时 profile 中像真人一样点击和输入（包括中文输入），把用户会用到的每条路径完整走一遍；每一步用 `webContents.capturePage()` 截图，存到 `docs/verification/<任务>-screens/`，并在报告里逐张说明。实操中发现的体验问题按缺陷修复，不能只写进报告。子会话交付时就要完成这一层。
3. **真实模型实测**：合并 main 前，涉及 Provider、运行或上下文的功能要做。由总控和用户一起，使用用户自己的 Key 和真实模型，在隔离的试用 profile 里跑一次，事先说明预计花费并取得用户同意。不能用 Mock 结果代替。

报告里三层分开列出，没做的那层写"未验证"。用户想自己上手试用时，提供隔离试用 profile 的启动方式；新的 migration 在合并前不得作用于用户的真实数据库。

## 工程约定
- 测试统一在 Electron 自带的 Node 里跑：全量用 `pnpm test`，部分测试用 `pnpm test <路径>`。不要用 `pnpm exec vitest`（宿主 Node 加载不了 Electron ABI 的 SQLite），也不要写 `pnpm run test -- <路径>`（pnpm 11 会跑全量）。检查流程见 `verify` skill，收尾流程见 `deliver` skill。
- 工具链：pnpm 11.25.0 和 Node 24（Homebrew `node@24`）都已经通过 Homebrew 安装。2026-10-21 已把 `/opt/homebrew/bin/node` 从 ChatGPT.app 内置的签名 Node 改为指向 Homebrew 的 Node（它原先导致原生模块报 Team ID 错误）。如果再出现 Team ID 报错，先用 `ls -l $(which node)` 检查这个链接有没有被改回去。
- shell 是 zsh：不要 `echo ===` 之类以 `=` 开头的参数（会触发 `=cmd` 展开报错）。
