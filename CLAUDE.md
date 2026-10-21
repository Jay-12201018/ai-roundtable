# Claude Code 入口

本项目此前由 Codex 开发，工程规范以 AGENTS.md 为唯一来源，这里只做引用和少量 Claude Code 专属补充，不重复规则。

@AGENTS.md

@docs/CODEX_HANDOFF.md

## Claude Code 补充

- 回答、报告和交付说明使用简体中文，保留 Electron、SQLite、Mock Provider、IPC 等英文术语。
- AGENTS.md 中的“总控”指当前与用户直接对话的主会话；子会话/subagent 等同于子项目，遵守同样的文件归属和不自行合并 main 的规则。
- 新分支沿用 `codex/rxx-<topic>` 命名，保证与既有分支、STATUS 看板一致；只有用户另行指定时才更换前缀。
- 新 Worktree 不再放在 `~/.codex/worktrees/`；迁移后的位置见 [交接文档](docs/CODEX_HANDOFF.md#worktree-与分支)。
- 测试统一在 Electron 自带的 Node 里跑：全量用 `pnpm test`，部分测试用 `pnpm test <路径>`。不要用 `pnpm exec vitest`（宿主 Node 加载不了 Electron ABI 的 SQLite），也不要写 `pnpm run test -- <路径>`（pnpm 11 会跑全量）。检查流程见 `verify` skill，收尾流程见 `deliver` skill。
- pnpm 11.25.0 已经通过 Homebrew 安装。正常的 Node 在 `/opt/homebrew/opt/node@24/bin`；而 PATH 上的 `node` 交接时指向 ChatGPT.app 内置的签名 Node，会导致原生模块报 Team ID 错误。
- shell 是 zsh：不要 `echo ===` 之类以 `=` 开头的参数（会触发 `=cmd` 展开报错）。
