# 群聊第一期验证记录（2026-11-05，分支 `codex/group-chat-phase1`）

决策见 D149–D153，契约和 migration 16 见 CONTRACTS 的“群聊第一期”。**fixture 只能证明流程，不能证明聊天手感**：下面第 1、2 层的回复都是写好的文字，是否像群聊要看第 3 层。

## 第 1 层：自动化

只用先隔离 userData 的入口（`tests/e2e`、`tests/probes/*`），没有运行 `pnpm dev`、`electron-vite dev`，没有用试用 profile 和真实 Key，没有调用真实模型。

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `pnpm run typecheck` | 0 | |
| `pnpm test --reporter=dot` | 0 | 125 个文件，2058 个测试 |
| `pnpm run build` | 0 | |
| `pnpm e2e` | 0 | 46 个通过（含新增 `group-chat.spec.ts` 的 11 个） |
| 全部探针 | 见下 | 42 步全部退出码 0（其中 1 步不算数，见下） |
| `node scripts/scan-public-terms.cjs <词表>` | | 业务文件 0 处；`pnpm-lock.yaml` 8 处是依赖包名（`http-proxy-agent` 等），不是这次引入 |

**探针**：`profile-guard`；`r01-electron` 及 `--r03-recovery`、`--joint-ui`，各加 `r01-sqlite`；`r07r08-electron` 主流程加 `--restart` 连续 3 轮，每轮两次 `r07r08-sqlite`；`r09-native`，`r09-electron` 加 `--restart` 和两次 `r09-sqlite`；`r10-r11-electron`、`r12-electron` 各加 `--restart`；`r12-acceptance`；`r14-acceptance`、`r15-acceptance` 各加 `--restart`；`r16-acceptance`；`r16-batch2-acceptance` 加 `--restart`、`--restart2`；`r16-continuity-acceptance`；`r16-longhistory`；`r78-drawer-acceptance`；`premerge-quality-acceptance` 加 `--restart`。整轮里 `premerge --restart` 是我的运行器传错了参数（应传 manifest，传成了目录），那一步不算数；之后单独用 manifest 重跑，4 秒通过。

整轮之后只改了 `serviceCatalog.ts` 的一行来源注释（去掉链接里的外国服务名）和这份记录。改完重跑了 typecheck、全量 `pnpm test`、build、`r10-r11-electron` 加 `--restart`，以及 `group-chat.spec.ts` 和 `discussion.spec.ts`（13 个通过）。

**未验证**：`r01-electron.cjs --development`（需要开发服务器，按规定不跑）；打包版 `pnpm e2e:packaged`（`walkthrough.packaged.ts` 改了，没有跑）；第 3 层。

新增的用例：

- `tests/unit/groupChat/rules.test.ts`：@ 解析（中文名紧贴后文、同名前缀取最长、不在本场的名字、拉丁名词边界、邮箱）、集合、简单问题、规则回退、调度 JSON 校验（陌生人、主持人、重复、未知意图和长度、多余字段都整份作废）、调度输入的内容和长度、安全规则一字不差、关思考的参数按模型。
- `tests/integration/groupChat/groupChat.test.ts`：真实 RunService、SQLite、ProviderRegistry 和 CompatibleProvider，只替换网络。回到等待、幂等、每种分类、调度回退（非法 JSON、陌生人、空答、500、429、超时）、3 次调度、12 次发言、成员的 @ 没有主持人权限、打断（生成中、调度中、连续多条）、不重发、停止、失败重试不重新调度且请求逐字相同、新消息代替重试、停用的成员、摘要进行中、关思考只在该发的时候发、四种方式不发且仍能按老办法继续、用量、选模型、演示。
- `tests/integration/persistence/migrationV16.test.ts`：v13、v14、v15 夹具升级，已验证备份，消息、Turn、用量逐行不变，旧 Run 读取不变，重建后的表规则都在，校验能发现缺失的表、触发器和索引。
- `tests/unit/rendererWorkflows/productionApp.test.tsx` 新增一组：默认方式、记住的方式、四种方式一键可选。

**对现有用例的改动**：默认方式和默认成员变了，所以需要严格流程的用例和探针在开始前显式选“自由讨论”，或者给房间写上记住的方式；向导和演示建的房间，断言里的名字换成新成员。没有放宽断言，没有 skip。验收类探针会重写 `docs/verification/` 下已跟踪的截图目录，这次都还原了，所以 `premerge`、`r16` 这些旧目录里的截图仍是合并前的旧成员名。

## 第 2 层：实操（真实构建、隔离 profile、回环 fixture）

入口是 `tests/e2e/group-chat.spec.ts`，先隔离 userData（`tests/e2e/support/entry.cjs`，路径不是这次的临时目录就拒绝启动）。截图由窗口自己的 `webContents.capturePage()` 产生，设 `ROUNDTABLE_GROUP_CHAT_SCREENS=1` 时写入 [`group-chat-1-screens/`](group-chat-1-screens/)，每步浅色和深色各一张（`NN-名字-light.png`、`NN-名字-dark.png`）。

| 截图 | 步骤 | 看到什么 |
| --- | --- | --- |
| 01-default-group-chat | 打开新讨论页 | 默认选中“群聊”，右边是“更严格的流程”和四种方式，一键可选；下面一句话说明，写明调度用量计入用量页；输入框是空的，没有“每回合后暂停”和“自定义流程” |
| 02-strict-ways | 依次点四种方式 | 每种都能切换；“自定义流程”和“开始讨论”回来；同一个用例接着把四种方式各跑到结束（3、4、5、12 次发言），请求里仍是原来的提示词，没有关思考参数 |
| 03-gather-typing | 发“集合开会！”，有人正在说时 | 输入框上方写“XX 正在输入… 已等待 N 秒 · 接着：…”；输入框可用；主按钮是一键“停止” |
| 04-gather-done | 说完 | 三位各一句，内容不同；页头“等你说话”；没有调用调度模型；请求都带关思考参数 |
| 05-mention-menu | 第一条消息里打 `@` | 弹出成员列表，说明被 @ 的一定回应、可以 @ 几位。输入法组合中列表不消失，组合中的回车只确认候选，不选人也不发送 |
| 06-mention-two | 用输入法写“@林舟 写前端，@阿哲 写后端” | 输入框上方写“会回应：林舟、阿哲”，和 Main 用同一份解析 |
| 07-mention-done | 发送后 | 只有这两位说；各自的提示里只引用自己的部分；是交付内容，所以没有关思考 |
| 08-simple-question | 问“今天星期几？” | 一两位短答；没有调用调度模型 |
| 09-interrupt-before | 林舟正在说，后面还排着小雨 | 部分文字已显示 |
| 10-interrupt-after | 这时发“@阿哲 先别管范围，算一下成本” | 林舟的回复立刻停止，保留已说的，下面一行小字“被打断 · 已说的保留”；小雨作废；阿哲按新消息回应；林舟没有第二次请求 |
| 11-stopped | 点“停止” | 一键停下，没有确认；写明发新消息就能接着聊；可以“让 TA 重说”或“接着说完” |
| 12-scheduled | 问“这个方向大家怎么看” | 调度模型排了阿哲和小雨；请求只给 400 tokens、带关思考参数 |
| 13-schedule-invalid-json | 调度返回一句话而不是 JSON | 两位成员照常回复，页面没有任何提示 |
| 14-schedule-service-failed | 调度请求 HTTP 500 | 同上 |
| 15-usage-by-purpose | 用量页按用途 | 有“群聊调度（决定谁接话）”一行 |
| 16-demo-chat | 开始试玩，发“集合开会！” | 三位演示成员各一句短话，不重样；没有网络请求，没有调度 |
| 17-limit | 8 位成员，调度一直说还要接 | 第 12 次发言后停下，时间线写明“这条消息的回复到了 12 次发言的上限，大家先停下了。发新消息可以继续。”；发新消息后提示消失，接着聊 |
| 18-after-crash | 回复中途杀掉进程再打开 | 状态“已中断”，部分文字保留，没有任何请求自动发出；发新消息接着聊，排队的人作废 |

同一个用例文件还验证了：重启后群聊内容不变、可以继续。

实操中发现并直接修掉的问题：

1. 新讨论的输入框预填“设计一个校园跑腿平台”，在群聊里按回车就替用户说了一句话。群聊现在打开是空的，严格流程不变。
2. 每条短回复下面都有一行用量和按钮，再加上 30px 间距，聊天被拉得很散。群聊里这一行只在看这条消息（悬停或键盘焦点）时出现，位置保留，间距收到 6px。
3. “被打断”用的是整块提示框，比说的话还显眼。改成一行小字。
4. 最初的实现把前一条消息里被 @ 但还没轮到的人留到新一轮，和任务要求的“排队中的发言作废”不一致，在截图 10 里表现为小雨抢在阿哲前面回答旧问题。已去掉，严格按最新消息。
5. 输入法组合时菜单写“没有名字以 xiao 开头”。群聊里组合中保持完整列表。
6. 中文后面紧跟 `@`（“请@小雨”）原来打不开菜单，因为判断要求前面是空白。群聊里放开了，严格流程不变。
7. 停止对话框在群聊里没有意义（什么都不会丢），改成一键。

## 第 3 层：真实模型

**未验证**，留给总控和用户，用用户自己的 Key。观察点：

- **是不是像群聊**：“集合开会！”是不是每人一句、不重样；简单问题是不是一两句；会不会回到报告腔、“首先其次”。
- **风格差异**：林舟、阿哲、小雨说话有没有区别，阿哲会不会真的挑刺，还是一味附和。
- **关思考后的耗时和 token**：DeepSeek、豆包、千问短回复的首字时间和 token，和没关时对比；Kimi、`glm-5.3` 系列、MiniMax Flash 关不掉，短回复要等多久。
- **调度 token 占比**：用量页“群聊调度”占总量多少；调度返回的 JSON 能不能解析（看 `group_chat_schedule_requests` 的 status），20 秒和 400 tokens 够不够。
- **只连了没有快模型的服务**（Kimi、智谱、混元、文心、MiniMax）时，只靠规则够不够用。这是 D152 的取舍。
- **任务类消息**：“写一份方案”时，是不是一位交付、一位简短回应，交付的质量有没有因为聊天口吻变差。第二期合并前还要和审查修订链对比深度。
- **打断**：被打断的半句话不进上下文（D151），新消息之后模型会不会接不上。
- **文档查实但没实测**：`fastReplyBody` 的参数只读了官方文档，真实请求是否都接受要在这一层看。
