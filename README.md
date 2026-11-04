# AI 圆桌（AI Roundtable）

让几位 AI 围坐一桌，替你把问题讨论透。你是主持人：定目标、点名、插话、随时暂停。

AI 圆桌是一个本地桌面应用（Electron、React、TypeScript、SQLite）。你用自己的 API Key 连接模型服务，让多位成员按起草、审查、综合等角色依次发言。所有数据只保存在这台电脑上。

## 能做什么

- **交叉审计：** 支持国内主流大模型，也可以添加其他通用接口的服务。几位成员可以各用一家的模型，在同一场讨论里互相审查。
- **多成员讨论：** 一个房间里多位成员依次发言，实时显示。可选自由讨论、双人对话、审查修订链、深度辩论等讨论方式，每种都有上限，不会无限运行。
- **主持人控制：** 暂停、单步、继续、停止，插话，用 `@` 点名下一位，修改某条发言后重新生成受影响的回复。停止时已生成的内容保留。
- **用量：** 用量页按讨论、模型、日期和用途显示 token，可以导出 CSV。
- **摘要：** 讨论变长时一键生成摘要，之后的发言用它代替较早的原文；原文保留，可以修改、重新生成或撤销。
- **产物：** 把讨论一键整理成需求文档、会议纪要、行动清单或代码候选。格式校验通过就能复制和另存；校验失败时完整保留原始输出，可以改好再用。
- **写入代码：** 代码候选可以写进你选的文件夹。先逐个文件预览新建、覆盖和差异，只写勾选的文件，覆盖要单独勾选，不会运行其中任何代码。
- **意外退出：** 重启后数据还在，没完成的请求标为中断，不会自动重发，由你决定恢复还是放弃。

## 费用

AI 圆桌不收费。调用模型的费用由服务商直接从你的账户收取，账单请到服务商控制台查看；应用只显示服务商返回的 token 用量，不估算金额。

## 当前限制

- 目前只在 macOS arm64 上验证过安装包，Windows 和 Linux 未验证。安装包未经 Apple 公证，见下方安装说明。

## 安装（macOS arm64）

目前没有公开下载。从源码打包（`pnpm run pack`）后，在 `dist/` 里可以找到 `.dmg` 和 `.zip`。

打开 `.dmg`，把 AI Roundtable 拖进“应用程序”。因为没有公证，第一次打开可能被系统拦下：在“系统设置 → 隐私与安全性”里点“仍要打开”。

第一次使用，可以先点“先试玩演示”：三位演示成员跑一场完整讨论，不联网、不需要 Key，回复是预先写好的示例。准备好真实讨论时，点“连接…”，选 DeepSeek，粘贴 API Key。

**数据位置：** 数据库在 `~/Library/Application Support/ai-roundtable/ai-roundtable.db`。升级到需要迁移的新版本时，应用会先把数据库备份到同目录的 `backups/`。Key 用系统钥匙串保护的密钥加密后保存，不以明文写入数据库、日志或导出文件。

## 开发

需要 Node.js 24 和 pnpm 11（`packageManager` 固定为 `pnpm@11.25.0`）。

```bash
pnpm install --frozen-lockfile
pnpm dev
```

| 命令 | 作用 |
|---|---|
| `pnpm typecheck` | 类型检查 |
| `pnpm test` | 单元和集成测试，在 Electron 自带的 Node 里运行；部分测试用 `pnpm test <路径>` |
| `pnpm e2e` | 构建后用 Playwright 驱动真实 Electron；每个用例都用临时数据目录、假的密钥后端，并阻断外网 |
| `pnpm build` | 生产构建 |
| `pnpm run pack` | 打当前平台的安装包，输出到 `dist/` |
| `pnpm native:check` | 确认 better-sqlite3 能在 Electron 里加载，必要时重建 |

测试统一在 Electron 的 Node 里运行，这样 better-sqlite3 只需要一套 Electron ABI 的构建。不要用 `pnpm exec vitest`：宿主 Node 加载不了这个构建。

自动化测试只用 Mock 或本地夹具，不发起付费请求。隔离规则见 [验证规则](docs/VALIDATION.md)。

### 隔离试用

想用真实 Key 试用、又不碰正式数据时：

```bash
pnpm trial
```

它会先构建，再用独立目录启动：macOS 为 `~/Library/Application Support/ai-roundtable-trial`（Windows 为 `%APPDATA%\ai-roundtable-trial`，Linux 为 `~/.config/ai-roundtable-trial`）。正式数据目录不会被打开；试用目录如果是指向它的链接，启动会被拒绝。

```bash
pnpm trial:reset
```

不带参数只显示将删除的目录；确认删除运行 `pnpm trial:reset --yes`。它只删除带有 `trial-profile.json` 标记的目录。系统钥匙串里用于加密的条目由系统管理，不会被删除，也不包含 API Key 明文。

### 升级演练

升级前可以先在数据库副本上演练迁移，详见 `scripts/rehearse-upgrade.cjs` 开头的用法说明。脚本不写入输入文件，并拒绝直接指向正式或试用数据目录的路径。

## 工程文档

[V1 规格](SPEC.md) · [工程规范](AGENTS.md) · [任务清单](tasks/README.md) · [状态看板](docs/STATUS.md) · [接口登记](docs/CONTRACTS.md) · [架构决策](docs/DECISIONS.md) · [设计规范](docs/DESIGN_GUIDELINES.md)

## 发布与授权方向 / Distribution and licensing direction

**免费、源码公开（Source Available）、非商业授权。** 未来将在作者个人 GitHub 公开仓库发布源码，通过 GitHub Releases 提供桌面安装包。软件本身免费，用户自行提供模型厂商 API Key 并承担厂商调用费用；不增加收费、会员订阅、激活码、商业支付或反盗版系统。优先考虑 **PolyForm Noncommercial 1.0.0**，禁止未经授权的商业使用；正式发布前须再次核对全文并由作者确认，当前尚未设置正式许可证。不得将此定位称为 OSI 标准开源；MIT、Apache-2.0 不作为项目默认候选。

**Free of charge, source available, licensed for noncommercial use.** Source code is planned for the author's personal public GitHub repository, with desktop installers distributed through GitHub Releases. Users supply their own model-provider API keys and pay any provider fees. No software fees, subscriptions, activation keys, commercial payment or DRM systems are planned. **PolyForm Noncommercial 1.0.0** is the preferred license, subject to review of its full text and the author's confirmation before release; no final license has been adopted yet. Unauthorized commercial use is outside the intended licensing scope. This is not OSI open source; MIT and Apache-2.0 are not default project-license candidates.

完整规划及外部贡献权利要求见 [发布与授权政策 / Release policy](docs/RELEASE_POLICY.md)。本轮只调整文档，不创建或公开 GitHub 仓库、不发布安装包；现有 R00–R18 技术路线与 Worktree 模式保持不变。
