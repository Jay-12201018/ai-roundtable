# R00–R18 状态与授权看板

## 当前状态（2026-11-05）

- **讨论里发图片、数据目录保护、抽屉修复：merged / verified。** 分支 `codex/maint-r78-drawer`（`9981f62`，基于 main `14bef97`，9 个提交，已包含 `codex/image-input`），以 ff-only 方式合入 main。决策 D147、D148，记录见 [发图片](verification/2026-11-05-image-input.md)、[抽屉探针](verification/2026-11-05-maint-r78-drawer.md)。
  - 发图片：目标框、插话框和继续框可以附 PNG、JPEG、WebP（回形针、粘贴、拖入），每张最多 10 MB，每条最多 4 张，单次请求图片最多 20 MB。图片存在 userData 的 `attachments/`，能看图的成员以 `image_url` 收到，看不了的只收到一句说明。migration 15。
  - 数据目录保护：未打包的应用不能使用正式数据目录，默认落到 `ai-roundtable-dev`，指向正式目录（含符号链接）就拒绝启动，没有跳过开关。
  - 抽屉修复：布局切换时关闭抽屉改为在渲染时做，窄屏点菜单不再被 effect 抵消。根因是最可能的解释，原来两次失败没有在非最小化条件下复现，尚未证实。
- **这次的检查**：总控在 `9981f62` 上跑了完整检查：typecheck、122 个文件 / 1953 个测试、`pnpm e2e` 35 项、打包和 `pnpm e2e:packaged` 3 项、全部探针含重启阶段（含 `profile-guard`、`r78-drawer-acceptance`）、v14 副本升级演练；正式目录 297 个条目跑前跑后没有变化。build 由 `pnpm e2e` 前置步骤和打包执行。`r01 --development` 依赖开发服务器，按新规定未运行。
- **第 3 层（用户亲手，试用版，`66733bc`，开着网络工具）**：一张 PNG。DeepSeek Flash 和豆包 Evolving 都读对图上数字；DeepSeek V4 Pro 没收到图，没有编造（目标里没要求它说明看不到，所以未验证它是否会明说）。**未验证**：JPEG、WebP、接近 10 MB 的大图、一次 4 张；拖入和真实 ⌘V；`66733bc` 之后的提交（保护、探针、抽屉）没有再做真实模型实测。
- **下一步路线**：① 大众化专项（等用户说开始）。② 更新发布政策和 AGENTS.md，清理公开内容，做公开副本并发布（`Jay-12201018/ai-roundtable`，推送前确认一次）；发布前补测不开网络工具的情况和尽量多的服务。③ 自用安装（备份真实数据库并在副本上演练，真实库目前是版本 1，先问用户）。④ 用户确认后删除事故留证目录。

- **事故：migration 15 误作用到真实数据库（已恢复）。** 2026-11-05 12:57:40，发图片子会话为跑探针执行 `electron-vite dev --rendererOnly`，它实际启动了未隔离的 Electron，打开正式数据目录。进程在约 1 分钟后被 `kill -9` 杀掉，迁移只写进了 `-wal`（137 帧，1 个提交，checkpoint 序号 0），主库未变。用户同意后，总控先把整个目录复制到 `~/Library/Application Support/ai-roundtable-incident-2026-11-05/`，确认主库和迁移前备份的 `.dump` 哈希相同（只有文件头 5 个字节不同），再把 `-wal`、`-shm`、Singleton 文件、`attachments`、`backups` 移到留证目录的 `moved-from-real/`。恢复后主库的 SHA-256 未变（`7cc10013…`），副本检查 `quick_check` 为 ok，版本 1，13 场讨论、38 条消息、5 个房间、无新表。Cookies、DIPS、Session Storage 等浏览器文件被更新，未回退；旧库 `key_records` 为 0，钥匙串未检查。留证目录保留，由用户决定何时删除。漏洞已由 D148 修复并合入 main。

- **移除费用、只留国产模型：merged / verified。** 分支 `codex/remove-cost-open-models`（`2127663`，基于 main `b7dab53`，30 个提交），以 ff-only 方式合入 main。决策 D133–D146，记录见 [移除费用](verification/2026-11-03-remove-cost.md)。
  - 彻底移除价格、预算和预计花费，用量页只显示 token。migration 14 建 `request_usage`、`provider_model_discovery`，删除费用相关表，转换并停用旧服务类型。破例改了 v11 的 CHECK 文字（任何数据库的最终状态不变）。
  - 只有内置目录的 8 家服务（DeepSeek、豆包、通义千问、Kimi、智谱 GLM、百度文心、腾讯混元、MiniMax），Main 强制地址和模型；没有代理、自定义服务、本机模型和手填模型名。国外服务的适配器和 SDK 已删除。
  - 每家子模型可选，含多模态模型（目前只发文字）；用 Key 从固定地址的 `/models` 自动发现本品牌新模型。
  - 新讨论页三步：讨论方式 → 几位成员 → 每位成员的模型。默认总时长上限改为 2 小时。失败提示带服务商错误码。
- **这次的检查**：总控在 `2127663` 上跑了完整检查：typecheck、build、117 个文件 / 1889 个测试、`pnpm e2e` 32 项、打包和 `pnpm e2e:packaged` 3 项、全部探针含重启阶段。两处第一次未过：① `r07r08` 在 800×600 下导航抽屉 3 秒内没打开，重跑两遍主流程和重启阶段都通过，判断为偶发，原因未查实，记为已知问题。② 升级演练输入用了已到 v14 的试用库，报 `Untrusted backup path`；换 v13 副本后通过，输入文件未变。
- **第 3 层（用户亲手，试用版）**：开着网络工具时，DeepSeek Flash 和豆包 Evolving 同场跑完 4 轮双人对话，发言完整，无思考内容混入，互相审查质量好。**未验证**：不开网络工具（用户决定暂缓，发布前在两张卡片上各点一次「测试连接」）；其余 6 家只核对文档并用 fixture 测试；真实服务返回错误码的显示；三人以上混用多家的真实讨论。
- **上一轮的路线**：讨论里发图片已合入，其余见本节开头的下一步路线。

## 较早状态（2026-11-03）

- **R17A 真实 Electron E2E 与 Mac 自用包：merged。** 分支 `codex/r17a-e2e-macpack`（`286da03`，基于 main `af5bffb`），以 ff-only 方式合入 main。`pnpm e2e` 在真实 Electron 里跑 V1 验收场景（23 项，连续 3 次通过，空测试集失败）；`pnpm e2e:packaged` 验证打包应用；新增 `pnpm rehearse:upgrade`（只在数据库副本上演练升级，已用夹具测试，未碰真实数据）；README 按当前能力重写；探针改为等实际窗口尺寸；Mac arm64 安装包（dmg / zip，ad-hoc 签名，未公证）。子会话在 `422f923` 上跑了 typecheck、143 个文件 / 2209 个测试、build、37 个探针阶段，之后只改探针和文档，总控审查后未重跑全量。`rendererSelection` 的超时没能复现，延长等待属推断。第 3 层（真实模型、真实钥匙串、真实数据库升级）未验证。记录见 [R17A](verification/2026-11-03-r17a.md)。
- **发布方向变更（用户 2026-11-03 决定，取代 [发布政策](RELEASE_POLICY.md) 和 AGENTS.md 的非商业授权规定，这两份文件待更新）**：MIT 开源，不做签名和公证；仓库已由用户创建（用户名后来改了，现在是 `Jay-12201018/ai-roundtable`）；首发源码加 Mac 安装包，按常见开源项目的做法，精简公开内容。尚未推送代码。
- **发布前要处理（①②③④ 已由移除费用分支解决，留作记录）**：① DeepSeek 价格审核 2026-11-21 到期，到期后真实讨论会被拒绝（`validPrice`），公开发布后所有用户都会受影响，需改到期行为或重新核价。② 4 个旧探针失败（`deepseek-trial-electron`、`deepseek-diagnostics-electron`、`deepseek-final-readiness`、`controlled-launcher-electron`），都涉及 Codex 时期的“受控单次试用”菜单，未确认 main 上是否早已失败；总控建议退役该菜单。③ `legacyMigration.test.ts`、`migrationV2.test.ts` 用 `git show 135bf82` 读原始表结构，重写历史后会失败，要改成固定夹具。④ 待用户决定：发布前是否开放多家模型（目前只有 DeepSeek Flash 能用于真实讨论）。
- **自用安装（待用户同意）**：安装包使用正式数据目录，装之前要先备份真实数据库并在副本上演练升级；步骤见 R17A 记录。

- **R15 安全代码导出：merged / verified。** 分支 `codex/r15-safe-code-export`（`6c61748`，基于 main `9cb0a1b`），以 ff-only 方式合入 main。决策 D126–D131；**migration 13**（`code_exports`、`code_export_files`，只追加，不存文件内容）；新增窄接口 `codeExport.chooseRoot / preview / write`，没有通用文件读写，也不执行任何生成的代码。
  - 只有 R14 交出的已采用代码候选能写入；文件夹由 Main 的系统对话框选，页面只拿引用，传不了路径；不能选磁盘根目录、应用数据目录和 `.git` 内的文件夹。
  - 预览只读：候选路径先按文本检查（绝对路径、`..`、盘符、UNC、反斜杠、保留名、不可见字符、`.git` 及其变体 `git~1`、NFKC 规范化后再查），再逐段检查磁盘（符号链接、非目录、仅大小写不同都拒绝）；每个文件标新建 / 覆盖（附差异）/ 内容相同 / 不能写入 / 路径无效；超大文件只流式算哈希、不读进内存。
  - 逐文件确认，默认全不勾，覆盖单独确认并标红；写入前重查版本、文件夹、路径和目标内容，有变化就拒绝并提示重新检查；临时文件 + `fsync`，新文件用 `link()` 独占放置，覆盖用 `rename`；逐文件如实给结果，失败时清理本次新建的空文件夹。残余风险（检查到放置之间的极小窗口）记在 D129。
- **R15 的检查**：合并候选 `6c61748` 上总控跑了完整检查：typecheck、142 个文件 / 2194 个测试、build；R01（三种模式）、R07/R08、R09、R12、R13A、R13B 的首次运行和重启，R10/R11，premerge（首次 + 重启），R12、R13A、R13B、R16 实操，R16 长历史，讨论延续实操，第二批验收（含两次重启），R14、R15 实操（含重启），全部 exit 0，liveApi=false。记录见 [R15](verification/2026-11-03-r15.md)。
- **R15 真实写入（用户亲手在试用版操作，2026-11-03 周二 13:50 起）**：用 DeepSeek 跑一场审查修订链讨论（5 步）并生成代码候选（`csv2json.py`、`README.md`），采用后写入用户新建的测试文件夹：只勾一个文件时只写了这个文件；预览后在外部修改目标，确认时被拒绝（`target_changed`）；重新检查后覆盖成功。磁盘文件哈希与记录一致，权限 `-rw-r--r--`，没有临时文件残留，脚本没有被运行。合计 ¥0.094（5 次发言 ¥0.068、代码候选 ¥0.026），均为空闲价，逐笔验算一致。试用库已重置：旧库另存为 `ai-roundtable.r14-mid-v12-2026-11-03.sqlite3`，再从升级前备份恢复并升到 migration 13。
- **维护事项（待安排）**：探针窗口尺寸竞态和 `rendererSelection` 超时已在 R17A 处理。已重置的旧试用库里，R14 复测 PRD 第一次失败的未知费用（预留 ¥0.083）只需对照 DeepSeek 控制台确认，当前试用库里不再有这笔。
- **下一步路线**：处理上面的发布前事项，然后做公开副本并发布（R17 后续不再按原 R17B/C/D 拆分）。

## 较早状态（2026-10-29）

- **R14 结构化产物：merged / verified。** 分支 `codex/r14-structured-artifacts`（`af16f3d`，基于 main `0c29bfe`），以 ff-only 方式合入 main。决策 D118–D125；**migration 12**（`artifacts`、`artifact_versions`、`artifact_sources`、`artifact_requests`、`artifact_charges`、`artifact_adoptions`、`artifact_exports`，全部只追加、身份与状态由触发器约束；重建 migration 9 的两个账本交叉核对触发器，规则不变，只把产物费用加入核对范围）；新增 `artifact.*` IPC 8 个。
  - 四类产物（需求文档、会议纪要、行动清单、代码候选）用严格 Zod schema 校验，未知信息必须显式写 null（界面显示"未知"），不得编造；一个解析器把错误定位到字段和行号，格式错误与来源越界一次列全；原始输出始终保留，不自动重试。
  - 生成是显式、计入预算的一次请求：先预览谁来写和最多花多少，同一事务里核对剩余预算并预留，结束按实际结算，用量页"按用途"单列；共同前缀在前、各类规则在后，同一场讨论的第二份产物起可命中服务商缓存。
  - 版本（生成 / 重新生成 / 主持人修改）、"采用"后才算正式版本并可复制或导出；来源记录依据的发言版本，原文被改后标"受影响"。D124：讨论里确实没有这类内容时，模型可如实回答"没有可整理的内容"，单独成状态，不能采用、导出或交给 R15。D125：产物与摘要请求失败时记录脱敏的公开错误码，界面用中文说明原因、费用和下一步。
  - 代码候选只预览，不写盘、不执行，不能导出为文件（界面、Main、数据库三层拒绝）；只有已采用且校验通过的代码候选通过 `artifact.listCodeCandidates` 交给 R15。
- **R14 的检查**：合并候选 `af16f3d` 上总控跑了完整检查：typecheck、138 个文件 / 2018 个测试、build；R01（三种模式）、R07/R08、R09、R12、R13A、R13B 的首次运行和重启，R10/R11，premerge（首次 + 重启），R12、R13A、R13B、R16 实操，R16 长历史，讨论延续实操，R14 实操（首次 + 重启），全部 exit 0。第二批验收探针在"用模拟输入法给房间改名"一步偶发超时（重启两步因此连带失败），单独重跑首次 + 两次重启全部通过；子会话也报告过 R16 实操探针在输入法步骤偶发失败一次。liveApi=false。记录见 [R14](verification/2026-10-28-r14.md)。
- **R14 真实模型实测（用户本人的 DeepSeek Key，`deepseek-flash`）**：
  - 2026-10-28 21:11 起（空闲）：基于 5 条发言的读书会讨论，会议纪要、行动清单、PRD 都一次通过校验并被采用；行动清单 15 项负责人全部为"未知"、截止时间照抄原话，没有编造；来源编号都在依据范围内；4 笔合计 ¥0.048。代码候选因讨论未涉及代码，模型如实说明"没有"，旧版界面却显示"校验失败"——由 D124 修复；缓存命中为 0——由消息顺序调整修复。
  - 修复后复测（试用库先另存为 `ai-roundtable.r14-old-v12-2026-10-28.sqlite3`，再从升级前备份恢复并按新版 migration 12 重新升级）：代码候选两次都得到"没有可整理的内容"并写明原因；PRD 第一次请求 3 秒后失败（原因当时未记录，由 D125 修复，费用暂记为未知、预留 ¥0.083），重新生成后一次通过校验（13 条需求均有验收标准和来源），没有被误判为"没有"；2026-10-29 高峰时段 PRD 命中缓存 5632/6421、代码候选 6144/6365，代码候选只花 ¥0.001。逐笔验算一致。D125 本身未在真实环境触发过失败，由自动化与实操覆盖。
- **输入法探针维护：merged。** 分支 `codex/maint-ime-probes`（`208c745`，基于 main `3351019`），以 ff-only 方式合入 main；只改 `tests/probes/` 和验证记录。根因：探针窗口失去焦点时，Chromium 会结束正在进行的输入法组合并把拼音保留为正文（普通 input 上同样发生，与应用代码无关；10-29 失败现场房间名为“xiaoyuan校园跑腿讨论”），原 `ime()` 用固定停顿、不检查组合状态。改法：新增唯一的 `tests/probes/ime-input.cjs`（按“组合已显示 → 已提交 → 值等于目标”逐步条件等待，各有名字和期限），探针窗口不可聚焦并用 CDP 焦点模拟；新增复现工具 `focus-steal.cjs`。原有断言全部保留，另加“IME 回车后组合仍开着”。子会话实测：R16 实操、第二批验收（含两次重启）、讨论延续实操、R14 实操（含重启）各连跑 10 次全部通过（期间同时跑全量测试）；焦点干扰下修复前稳定失败的探针全部通过；typecheck、2018 个测试、build 通过。总控审查了改动与记录，因只改探针，合并前未重跑全量。记录见 [输入法探针维护](verification/2026-10-29-maint-ime-probes.md)。
- **维护事项（待安排）**：① 独立实操探针（r12 / r13a / r13b / premerge-quality）的 `window size applied` 要求 `innerHeight === 900`，在可用高度不足的屏幕上只能碰上窗口显示前的瞬时值，属竞态；修复会改变断言，需总控决定（例如请求放得下的尺寸，或改为记录实际视口）。② `tests/integration/r07r08/rendererSelection.test.tsx` 的“refreshes member Provider summaries…”在高负载下约 1/20 超时（`findByText` 默认 1 秒期限）。③ 试用库里 R14 复测时 PRD 第一次失败的未知费用（预留 ¥0.083）可由用户对照 DeepSeek 控制台后在用量页核销；试用库停在合并前的中间版 migration 12，下次用 main 启动试用版前需先另存并从升级前备份恢复。
- **下一步路线**：R15 安全代码导出（消费 R14 的 `artifact.listCodeCandidates`）→ R17 E2E 与发布。

## 较早状态（2026-10-28）

- **R16 第二批（E 设置与连接向导、F 房间成员与讨论方式、G 首次使用与用量）：merged / verified。** 分支 `codex/r16-batch2`（`a72301a`，基于 main `29b4e84`），以 ff-only 方式合入 main。决策 D113–D117；**migration 11**（`provider_target_approvals`，换 Key、改地址或类型、删服务时同事务删除，恢复校验已覆盖）；新增 IPC `settings.listModelReadiness`、`network.getSettings/saveSettings/testProxy`、`app.relaunch`，`usage.getReport/exportCsv` 增加可选时间范围。
  - E：设置页改为分类 + 内容；三步连接向导（选服务 → 地址写在 Key 上方、「保存并连接」即确认 → 免费检查连接）；价格未审核的服务如实写“暂时不能用于讨论”；D113 地址确认跨重启记住，绑定“Key 修订号 + 地址 + 服务类型”；D115 代理存 Main 本地配置（只允许本机地址、必须显式勾选“由代理解析域名”、环境变量优先、「检测代理」只做不带 Key 的 CONNECT、「立即重启」在有讨论进行时拒绝）；外观挪进设置。
  - F：房间单页，房间列表只在侧栏并显示人数；成员对话框带角色模板（D5-A），模型只能从已配置服务中选；新房间默认三位成员，不自动改用 Mock；拖动与键盘排序；D116 讨论方式按房间记在本机，每次开始前由 Main 重新核对；工作流状态行“第 n/N 步 · 阶段”，发言带阶段标签；只有从未讨论过的房间可删（Main 强制）。
  - G：欢迎页（按审核状态生成“目前可以用于讨论的是 DeepSeek；其他服务可以先连接”）；D6-A 自动建演示房间和“我的第一场讨论”；用量页换装并支持本月 / 上月 / 全部（D117，按请求发出时间归入）。R13B 遗留“预算停下后右侧仍显示灰色重试/续写”已不再出现。
  - 审查后修复：欢迎页措辞过满、侧栏讨论超过 500 场时看不到最新的（第一批遗留，改为读完全部分页并在失败时可重试）、开始讨论时记住的讨论方式在成员未读完前被误判、「立即重启」后主进程报 Unauthorized IPC sender（改为先回复再重启）。
- **第二批的检查**：合并候选 `a72301a` 上总控跑了完整检查：typecheck、134 个文件 / 1970 个测试（界面整体替换，删去 13 个旧测试文件、新增 9 个，总控逐条核对旧测试守护的行为已有新测试覆盖）、build；R01（三种模式）、R07/R08、R09、R12、R13A、R13B 的首次运行和重启，R10/R11，premerge（首次 + 重启），R12、R13A、R13B、R16 实操，R16 长历史，讨论延续实操，第二批验收（首次 58 项 + 重启 7 项 + 第二次重启 7 项），全部 exit 0，liveApi=false。记录见 [R16 第二批](verification/2026-10-28-r16-batch2.md)。
- **第二批真实模型实测（用户本人的 DeepSeek Key，`deepseek-flash`，2026-10-28 周三 12:24 起，空闲时段）**：启动时不带任何代理环境变量；用户在设置页确认 DeepSeek 地址，配好 127.0.0.1:7890 并勾选“由代理解析域名”，点「立即重启」；重启后不再要求确认地址（确认记录未变、Key 修订号一致），设置页保存的代理生效，审查修订链 5 次请求全部成功，按空闲价、命中缓存部分按缓存价结算，逐笔验算一致，合计 ¥0.0339；讨论质量好（审查者认错撤回、修订者逐条采纳或说明不采纳的理由）。换 Key 后需重新确认这一项未在真实环境实测，由自动化和实操覆盖。
- **下一步路线**：R16 已全部完成（第一批、讨论延续、第二批）。按规划接着是 R14 结构化产物 → R15 安全代码导出 → R17 E2E 与发布。

## 较早状态（2026-10-27）

- **讨论延续专项（R16 第一批之后、第二批之前）：merged / verified。** 分支 `codex/r16-discussion-continuity`（`4d3e8b7`，基于 main `eb0d66a`），以 ff-only 方式合入 main。决策 D110–D112；**migration 10**（只追加的 `run_continuations`，带不可改、不可删和身份校验触发器，恢复校验已覆盖）；新增受信 IPC `run.previewContinuation`、`run.continueDiscussion`。
  - D110：点名改为在下一回合**插入**一轮，计划轮数只算原计划的回合，原计划的成员不再被跳过；@ 的正好是计划中的下一位时只发插话，不多插一轮。
  - D111：讨论结束后，输入框默认“在这场讨论里继续”（重新打开同一个 Run）：带 @ 只让那位成员回应一次，不带 @ 时全员各回应一次，后面的成员看得到全部历史；发送前显示谁回应、单次和整轮最多花费；开新讨论只能点「新讨论」。
  - D112：发言要求里关于主持人修改的规则只在上下文确实带修改标注时发送。
- **讨论延续的检查**：合并候选 `f91b017` 上总控跑了完整检查：typecheck、136 个文件 / 2007 个测试、build；R01（三种模式）、R12、R13A、R13B 的首次运行和重启，R10/R11，premerge（首次 + 重启），R12、R13A、R13B、R16 实操，R16 长历史，讨论延续实操，均 exit 0。R07/R08、R09 两个旧探针因未跟上 D111（结束后要先点「新讨论」）失败，子会话改探针（不放宽断言；`--restart` 缺 manifest 时改为非 0 退出）后，在 `4d3e8b7`（只改探针和记录，未改源码）上复跑：R09 首次 + 重启通过；R07/R08 第一次在 800 宽、深色主题的“房间与成员”布局检查处卡住超过 240 秒失败，第二次首次 + 重启通过（原因已在下方探针维护中查明并修复）。liveApi=false。记录见 [讨论延续](verification/2026-10-27-r16-continuity.md)。
- **讨论延续真实模型实测（用户本人的 DeepSeek Key，`deepseek-flash`，经本机代理，2026-10-27 周二 20:20 起，空闲时段）**：一场 3 人讨论，顺序 A → B（点名插入）→ B（按计划）→ C，C 不再被跳过；结束后 `@C 请把最终方案压缩成三条` 只有 C 在同一场讨论里回应；不带 @ 再发一句，A、B、C 各回应一次。8 次请求的输入都带全部历史和两句插话，没有修改时不含修改规则；全部按空闲价、命中缓存部分按缓存价结算，逐笔验算一致，合计 ¥0.0362。讨论质量好（核账、取舍并给理由、互相回应，不照抄）。实测发现“@ 计划中的下一位会让他连说两次”，已在合并前修复（`6f534d4`），该修复只有自动化和实操覆盖，未再做真实模型复测。
- **探针维护：merged。** 分支 `codex/maint-probes`（`679a463`，基于 main `cf83829`），以 ff-only 方式合入 main；只改 `tests/probes/` 和验收记录，不改业务源码、契约或 migration。① R07/R08 生产探针偶发失败查明是探针问题：窗口被遮挡或隐藏时 Chromium 节流页面定时器，而 Mock 照常输出，导致“暂停”点晚、布局检查的固定停顿被拖到 240 秒总超时（“卡在第 5 项”即此）；界面无问题。改为关闭后台节流（与其他新探针一致）、所有固定停顿换成带名字和期限的条件等待、每段脚本单独超时并报出停在哪一步；原有检查全部保留，并新增“点取消后对话框确实关闭”。子会话实测：连续 10 次首次 + 10 次重启全部通过，全屏遮挡 3/3 通过；窗口最小化时布局检查仍会失败，但会立刻报出具体步骤。② `r01-sqlite.cjs --joint-ui`、`r07r08-sqlite.cjs`、`r09-sqlite.cjs` 按 D095（其他成员发言为 user 侧带标签的 `> ` 引用且有序）和 migration 1–10 更新，并新增“别人的发言不得以 assistant 出现”的断言；在同一数据库上旧脚本失败、新脚本通过。子会话跑过 typecheck、136 个文件 / 2007 个测试、build；总控审查了断言没有放宽，因只改探针，合并前未重跑全量。记录见 [探针维护](verification/2026-10-27-maint-probes.md)。
- **R16 第一批（新的讨论界面：外壳与侧栏、时间线、Markdown 安全渲染、输入框与 `@` 点名插话 D4、本场信息面板、长历史窗口化）：merged。** 设计方案与原型 `codex/r16-ui-redesign`（`8c8eb1b`，D1–D6 用户确认，见 `docs/design/r16/`），实现 `codex/r16-impl-discussion`（`8d833a2`，基于 main `42f5d49`），以 ff-only 方式合入 main。在合并候选上，总控跑了一次完整检查：typecheck、134 个文件 / 1977 个测试、build；隔离生产探针 R01（三种模式）、R07/R08、R09、R12、R13A、R13B 的首次运行和 `--restart`，以及 R10/R11；实操探针 premerge（首次 + 重启）、R13A、R12、R13B、R16（72 项 / 38 张截图）、R16 长历史（1001 条消息）。全部 exit 0，liveApi=false。实操记录见 [R16 第一批](verification/2026-10-24-r16-impl.md)。
- **R16 第一批真实模型试用（用户本人的 DeepSeek Key，`deepseek-flash`，经本机代理，2026-10-27 周二 16:12 起，高峰时段）**：用户亲手在新界面上跑了两场。`@B 检查一下` 记为点名 + 插话，B 作为被点名成员发言并回应；6 笔请求全部按高峰价、命中缓存部分按缓存价结算，逐笔验算一致，合计约 ¥0.052。讨论质量好（审查者逐条核账、带出处、自我更正，不照抄）。
- **试用暴露的体验缺陷（不是第一批引入的退化，已由上面的讨论延续专项修复）**：① 点名会替换原计划的下一位：3 轮讨论里点名 B 后，综合者 C 没有发言，讨论在没有综合的情况下结束，界面也没有提示；② 讨论结束后在输入框发“@C，你去哪了”，会被当作新议题开一场新讨论，新讨论看不到上一场的内容，成员只能自己编议题；③ 系统提示里“写于前序修改之前”这条规则在没有任何修改时也会发送，成员把这句话当成了讨论内容。

## 较早状态（2026-10-24）

- **R13B（运行中追加预算、核销未知费用、按时段与缓存结算、对话摘要、用量页）：merged / verified。** 分支 `codex/r13b-usage-summary`（`a96d4fe`，基于 main `03de217`），以 ff-only 方式合入 main。在合并候选上，总控复跑了 typecheck、130 个文件 / 1936 个测试、build；隔离生产探针 R01（三种模式）、R07/R08、R09、R12、R13A、R13B 的首次运行和 `--restart`（重启后 0 次请求），以及 R10/R11；实操探针 premerge（首次 + 重启）、R13A、R12、R13B。全部通过，liveApi=false。决策 D104–D109；migration 9（7 张只追加的表）。
- **R13B 真实模型实测（用户本人的 DeepSeek Key，`deepseek-flash`，经本机代理，2026-10-23 周五 23:48 起，空闲时段）**：在逐回合推进的运行里，生成摘要（覆盖第 1–2 条）并确认，然后修改被覆盖的第 1 条（座位改为 250、考试周改为 2 周）。下一位成员收到的上下文依次是：摘要（附受影响说明）、修改后的第 1 条（附"以此为准"说明）、轮到你发言；未修改的原文仍由摘要代替（D109）。综合者在回答开头就指出修订作废了原来按 400 座计算的全部数字，并按新条件重新计算。4 笔请求（3 次发言、1 次摘要）全部按空闲价结算，命中缓存的 token 按缓存价计，向上取整逐笔验算一致，合计 ¥0.0286（按高峰价记账为 ¥0.0587）。请求次数、token 与 DeepSeek 控制台一致，用户已核对控制台扣费。
- 遗留（并入 R16）：因预算停下的运行，右侧面板仍显示灰色的"重试当前回合/续写部分回复"；"上下文接近上限"的提示只有自动化测试覆盖（夹具填不满 131072 token 的窗口）。时段判定"按请求开始还是结束"以及调休周末的规则，官方没有写明，按从严原则处理（只要碰到高峰就按高峰计）。

## 早前状态（2026-10-23）

- **R12 主持人与消息版本、R13A 真实模型（DeepSeek）与运行预算、合并前质量修复：merged / verified。** 集成分支 `codex/integrate-r12-r13a`（R12 `codex/r12-host-message-versions` → R13A `codex/r13a-real-model-enable` → 质量修复 `codex/r13a-premerge-quality`，再合入 main 上的文档提交），以 ff-only 方式合入 main。合并结果上总控复跑：typecheck、126 文件 / 1903 测试、build；隔离生产探针 R01（默认、`--joint-ui`、`--r03-recovery`）、R07/R08、R09、R12、R13A 的首次运行和 `--restart`（重启后 0 次请求）、R10/R11；实操探针 premerge（首次 56 项 + 重启 11 项）、R13A、R12（25 项，截图已按最终代码重新生成）。全部通过，liveApi=false。
- **真实模型实测（用户本人的 DeepSeek Key，`deepseek-flash`，经本机代理）**：请求次数、token 与 DeepSeek 控制台逐项一致；花费按高峰价记账，空闲时段实际扣费约为显示值的一半（D090 的保守取向，按时段结算列入 R13B）。主持人点名、插话、持续指令、修改与重新生成、版本切换在真实模型上生效；修复上下文格式（D095）后，审查者给出带出处的具体意见、不再照抄，综合者能整合并做取舍，主持人修改后的条件会被采用；写到输出上限时保留并标注截断，运行继续（D102，默认上限 4096，D103）。
- **数据库**：migration 6（主持人操作与消息版本）、7（运行预算与费用账本）、8（请求结束原因）。启动时清除误填进模型 ID 栏、看起来像 API Key 的值，不留明文（D096/D100）。
- **R10A/R10B/R11**：2026-10-21 合入 main（`66017c0`）。原生 Claude/Gemini 仍没有获审的价格策略，真实生成会被拒绝；代理模式下的目标核对已按 Provider 类型修正（R13A）。
- **环境**：测试在 Electron 自带的 Node 中运行；宿主 Node 为 Homebrew `node@24`。仓库位于 `~/Claude code/AI roundtable`（已移出 iCloud）。
- **下一步路线**：R13B（运行中追加预算、核销未知费用、按时段结算价格、对话摘要、用量统计）→ R14 结构化产物（可以和 R13B 并行）→ R15 代码导出 / R16 按 Claude 风格重做界面（汇总已记录的体验问题：设置页文案过于技术化、工作流运行后要重新应用、右侧面板过长等）→ R17 E2E 与发布。产品标准：按 Claude 配套产品的标准与审美把关，验收分三层（自动化、真实界面实操、真实模型）。

以下为 Codex 时期的历史记录，保留作证据。


## 多服务商目录需求登记（2026-10-20）

**产品需求与后续验收规划已记录；Provider Catalog 实现 not_started。** 纳入 [SPEC](../SPEC.md) 及[R08/R09 后续增强规划](PROVIDER_CATALOG_PLAN.md)，不新增 R 编号，不改变既定依赖/已验收功能。只修改总控规划文档，未修改当前 R10A/R10B/R11 的任务书、业务/测试或 Worktree。

用户本轮明确三个模块按各自已批准任务书继续，后续授权优先于本看板/任务索引中的旧“未授权/未创建”登记；本轮未核定这些执行线程的实际进度或交付，不凭本仓库历史表格撤销授权或登记完成，也不接管/启动它们。目录推荐待必要集成/契约稳定后另行安排，不成为三模块额外交付门槛。具体厂商端点/鉴权/能力/价格本次未核验，不宣称已支持；无付费测试授权。

本轮实际文档检查：`git diff --check`、182个仓库内链接与目录验收锚点、原20个任务编号顺序、308个非本轮文件SHA均通过；既有Worktree登记未变，当前三模块任务书/源码/测试未改。未运行业务测试、typecheck或构建；纯规划验证不能当作目录功能验收。


## DeepSeek 原生许可入口修复（2026-10-19）

候选针对main6c90732实际macOS菜单缺项，一行重新安装菜单修复；不改IPC/Service/授权和费用数据。安装时快照RED→GREEN，实际自有fixture原生AX确认许可入口可见，生产38/重启19、权限22、菜单回归37、启动器24和strict均exit0；已按本次授权严格ff-only从6c90732合入68bfba571a429530dfabf90004686745e578ff51，merged/verified。主线新跑生产38/重启19、权限22、菜单回归37、strict全部exit0；没有重复无关全量回归。[本轮证据](verification/2026-10-19-deepseek-native-menu.md)。当前用户窗口/Key/old unknown/人工对账决定不操作。


## DeepSeek 三项最终收尾（2026-10-19）

**merged / verified（本地fixture、费用/安全与人工操作路径；不代表真实付费成功）。** 分支codex/deepseek-final-readiness，基线dc8a7a0a4b8f2469a39c87403d26dd7d48d0b220。重新核价24小时快照、migration5人工audit+release marker、会话双原生确认单次lease已接通；原unknown不改、迁移不自动释放、普通真实生成blocked。完整Electron1322、strict/build、原生生产37/重启18及费用/迁移/许可专项exit0；失败与限制见[本次记录](verification/2026-10-19-deepseek-final-readiness.md)。本次已从干净dc8a7a0严格ff-only到715c2ebe4bd1b669a938eb866daceaf9640ae485，主线新跑88文件1322/1322、strict/生产构建/ABI139内存SQLite、Python24、许可22/quote28、真实生产37/重启18全部exit0。主线证据另立独立临时根，没有复用候选PASS。治理登记是独立后续提交；最终HEAD可由本节所在commit读取。原分支/全部Worktree保留。本轮未操作实际旧profile、Key、预留或发送许可，真实API0；R10/R11/R17未启动。

## DEEPSEEK-PROXY-01 正式合并与主线验收（2026-10-19）

**merged / verified（仅本地 fixture 与安全接线）**。用户批准获审 `04bf8a20e047f3c46cb3017921ddac049ba9f5ae` 后，从干净 main `1c4d2afb1afbae288ac1201c618ffd9cc39999bb` 执行 `git merge --ff-only codex/deepseek-loopback-proxy`，exit0，无冲突/额外merge commit，原分支和20个Worktree全部保留。

main 本轮新跑 Electron86文件1292/1292、受影响12文件279/279、Node/Electron各10场景121条CONNECT/TLS断言及各13场景57条gate断言、Python24、strict/独立输出生产构建、ABI139内存SQL、真实隔离生产31/重启24，全部exit0；分组重叠不累加。Node24.18.1只执行纯网络/类型/构建，本轮没有重新运行Node完整回归或原生压力。main原out/native的7文件SHA/inode前后一致。[主线报告](verification/2026-10-19-deepseek-loopback-proxy-main.md)/[台账](verification/2026-10-19-deepseek-loopback-proxy-main-commands.md)。

没有部署/重启当前应用、读取真实Key/profile/unknown记录、改FClash/系统网络或授予发送。普通严格生成blocked、价格过期拒绝和unknown/¥0.05保护不变。实际FClash/公网/真实Keychain未验证；用户明确配置并信任本机代理的远端DNS，不能视为客户端证明远端IP公网。旧Finder入口仍绑定1c4d2af快照，不能当作本次最新版；启用方法见主线报告。以下review为历史候选，不取代本节。

## DEEPSEEK-PROXY-01 候选（2026-10-19，历史）

**review，未 merged/verified、未部署。** 总控分支 `codex/deepseek-loopback-proxy` 基于干净 main `1c4d2afb1afbae288ac1201c618ffd9cc39999bb`；实现 `746c4de5df871697c7975ba69bbb75c56b9d46b8`，最终候选另含本节治理提交。main 未移动；所有原分支/Worktree 保留，不启动 R10/R11/R17。

显式可信回环 HTTP CONNECT、固定目标/TLS/socket gate、Main 注入及安全代理诊断已实现。Node/Electron 各86文件1292项、strict/build、Python24、代理gate各57、真实CONNECT/TLS各121、生产31/重启24及双ABI/内存SQLite均exit0；失败记录保留。[报告](verification/2026-10-19-deepseek-loopback-proxy.md)与[命令](verification/2026-10-19-deepseek-loopback-proxy-commands.md)。

本轮只用自建代理/CA/fake Key/隔离DB；真实 API 0，不读原 Key/费用记录、不改首次 unknown/¥0.05、不更新当前应用、不授予发送。原严格计数 blocked、已过期价格拒绝及未知费用保护保持。代理远端 DNS 依赖用户明确信任，不证明实际远端IP公网；真实 FClash、公网/Keychain及付费烟测仍未验证，等待审核。

原始基线：main / `135bf82c6462ade6dd5300717d6f0102ce4a660c`。完整范围和归属见[任务索引](../tasks/README.md)，原始产品状态见[V0审查](V0_AUDIT.md)。R00/R01/R02/R03 已验收。用户批准的 R03 候选 `439e3c6cb58437298e94fe2536f26e22eae66f6c` 已以 `e642b96a8dded195be44749dd6f267798de95198` 合入 main，并通过[本次主线复验](verification/2026-10-15-r03-main.md)。用户已批准联合候选d4a0d274，本次fast-forward合main并通过[独立主线验收](verification/2026-10-16-r04-r05-r06-main.md)，R04/R05/R06及联合集成均verified。R07/R08获批候选d3205b2已严格ff-only合main；此前补充桥包装器失败记录保留，本次另获授权修复验证入口，18/18真实桥安全断言及退出审计通过，两模块及联合集成现为merged/verified；见[主线与补充记录](verification/2026-10-17-r07-r08-main.md)。R09获批候选f3a8fee已按用户最终授权ff-only合main，本轮[独立主线验收](verification/2026-10-17-r09-main.md)完成后仅登记fixture merged/verified；真实模型/费用策略、系统Keychain与发布未验收。共享前置1e1f971先前已按相应授权合main并完成当时的独立主线验收，保持merged/verified，见文末历史专节。ENV-R02-INSTALL-01 保持已解决；Node 24.21.0 上游风险保留，继续采用严格配对的官方 24.18.1。

状态定义：not_started 未开始；ready 依赖满足但仍需实施授权；in_progress 正在执行；review 交付待审核；merged 已由总控集成；verified 验收确认；blocked 前置未满足或存在阻塞。状态与授权分列，不能推断。

| ID | 名称 | 依赖 | 负责人 | 状态 | 授权 | 分支/Worktree | 提交 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R00 | 基线治理与验证 | 无 | 总控（本聊天） | verified | 已授权；用户文档验收通过 | main；不创建 Worktree | a17c649422c69696da91df081cb21d6d260a54cb；769a9519b969b7897d3af314bc981ac2fb7f64d2 | [R00 实际执行记录](verification/2026-10-13-r00-baseline.md)：类型/52测试/空集/build/ABI通过，独立审查通过；2026-10-13 用户批准文档验收 |
| R01 | 启动、退出、安全边界 | R00 已 verified | 总控（本聊天） | verified | 用户批准最终合并与验收；主线复验通过 | 已合 main；codex/integrate-r01 与原子项目 Worktree/分支保留 | 集成 0ad1701a47222315158e7be00d29afe1c9ef1767；合并 4149590d28296ab3520b70606dcb161ba16a6b39；原子项目 d956279949baa0992be5e0cb093f59ef96a9e205 | [合并后实际验证](verification/2026-10-13-r01-main.md)：类型、12文件/133测试、build、ABI139、隔离生产页面/Preload、退出后SQLite通过；10月13日批准/复验，10月14日验收登记 |
| R02 | 契约与归属 | R01 已合 main 且 verified | 总控（本聊天） | verified | 用户批准最终合并与验收；本次 main 复验通过 | 已合 main；codex/integrate-r02、原 codex/r02-contracts 及 Worktree 均保留 | 原14f07a22b44bcd2459dd44f579230792033d9301；引入bafa84f55b6c77aeaffe26b27caae56fb67cbcf0；安全审核8ec1d2b834ba94a5df60a21e0615d1fcb21fd48f；ENV候选5b8f771bfa0fd1823b7efe6488179e15aea436a5；合并6aff174e6cf397eb49b9b4ceadb3387f207b84a6 | [本次 main 验收](verification/2026-10-14-r02-main.md)：6文件94契约/18文件228全回归、类型/生产构建、Node源码编译/内存/压力5次、Electron源码编译/ABI139、隔离页面/Bridge/退出数据均exit0；ENV保持已解决，历史干净安装见[ENV证据](verification/2026-10-14-r02-environment.md) |
| R03 | 持久化、备份、恢复 | R02 已合 main 且 verified | 总控（本聊天） | verified | 用户批准最终合并/复验/状态更新；本次主线必要检查通过 | 已合 main；原分支和 codex/integrate-r03、两个 Worktree 均保留 | 原212808f780cc87d2827a977743f3fc16a028f5b5；引入f144ace84f7861c4f8cf577d0d0d40aa3aae8110；候选439e3c6cb58437298e94fe2536f26e22eae66f6c；合并e642b96a8dded195be44749dd6f267798de95198 | [本次 main 验收](verification/2026-10-15-r03-main.md)：26文件313全回归，Node/Electron专项各9文件85项，类型/构建、原生压力5次、ABI139、隔离恢复/Bridge/退出数据均exit0；限制分列 |
| R04 | Run/Turn Mock | R03 已合main verified；R02契约 | 原模块交付后由总控唯一联合接线 | verified | 用户已批准最终合并；本次main复验通过 | 已合main；联合/原分支和全部WT保留 | 原63ef56e1cd9d4bb9d0793aa4e97e499b45574ecd；引入3c6ed2ff9f79b08a915d152dccd556c0df219090；接线/fast-forward入站d4a0d2742eb28d2441e4d06e8154b8cdd6955336 | [本次main证据](verification/2026-10-16-r04-r05-r06-main.md)：534完整/265专项/112 Electron、类型/构建、Node压力5次、ABI139、隔离UI/恢复/退出均exit0；正式E2E等未验证 |
| R05 | 公共上下文与基本限制 | R03 已合main verified；R02契约 | 原模块交付后由总控唯一联合接线 | verified | 用户已批准最终合并；本次main复验通过 | 已合main；联合/原分支和全部WT保留 | 原1c5a2183f0c5d4f335b39b99aa27cac8fe7baad7；引入7586f023d373f38cbd08df623dcf0149abcebdcf；接线/fast-forward入站d4a0d2742eb28d2441e4d06e8154b8cdd6955336 | [本次main证据](verification/2026-10-16-r04-r05-r06-main.md)：534完整/265专项/112 Electron、类型/构建、Node压力5次、ABI139、隔离UI/恢复/退出均exit0；正式E2E等未验证 |
| R06 | Renderer 状态与订阅 | R03 已合main verified；R02契约 | 原模块交付后由总控唯一联合接线 | verified | 用户已批准最终合并；本次main复验通过 | 已合main；联合/原分支和全部WT保留 | 原ed6d659734cea4169fb54a66bdb257439d6daa39；引入6fe8805bb96c6c41d9f4671260c64ed13c47a275；接线/fast-forward入站d4a0d2742eb28d2441e4d06e8154b8cdd6955336 | [本次main证据](verification/2026-10-16-r04-r05-r06-main.md)：534完整/265专项/112 Electron、类型/构建、Node压力5次、ABI139、隔离UI/恢复/退出均exit0；正式E2E等未验证 |
| R07 | 房间、成员、历史 | R04/R05/R06及SHARED-R07-R08-01已合main且verified | 原模块交付；总控联合接线 | verified | 最终合并及补充探针修复已授权；全部必要验收完成 | 已合main；集成及原分支/WT全部保留 | 原d991178；引入f718f829；接线64ac8ce5038813cc60374573dc8871da30d1eeb0 ；ff入站d3205b2c3fba2061437150e87a87508d44fbb660 | [主线及补充记录](verification/2026-10-17-r07-r08-main.md)：原846/292/111/393、strict/build及UI/重启/退出证据按同业务版本复用；本次18/18真桥断言、生产探针自然exit0及退出SQLite审计通过 |
| R08 | Key 与 Provider 设置 | R04/R05/R06及SHARED-R07-R08-01已合main且verified | 原模块交付；总控联合接线 | verified | 最终合并及补充探针修复已授权；全部必要验收完成 | 已合main；集成及原分支/WT全部保留 | 原d2aed6c；引入5f01e978；接线64ac8ce5038813cc60374573dc8871da30d1eeb0 ；ff入站d3205b2c3fba2061437150e87a87508d44fbb660 | [主线及补充记录](verification/2026-10-17-r07-r08-main.md)：原846/292/111/393、strict/build及UI/重启/退出证据按同业务版本复用；本次18/18真桥断言、生产探针自然exit0及退出SQLite审计通过 |
| R09 | OpenAI 与兼容端点 | R07/R08已合main verified；Mock联合验收 | 原模块交付；总控独占联合接线 | verified（fixture） | 用户批准最终合main及主线独立验收；真实付费测试未授权 | 已合main；codex/integrate-r09与原分支/WT保留 | 原2d97af571debf106aadad708a2c0418f299c6eef；唯一引入f5baaf07e1603a7c356fb0c9cedeb131977307ba；接线da512e7a64a6ec4a596b0f7fda820b3d62b04e42；ff入站f3a8fee38f5b7d75b5144c2997d72373fda6ddd6 | [本轮main报告](verification/2026-10-17-r09-main.md)/[台账](verification/2026-10-17-r09-main-commands.md)：Node/Electron各1073、R09专项227、strict/build、双ABI/SQLite、真实生产fixture12请求/重启HTTP0及退出审计；旧探针白名单一行修复，原失败保留 |
| R10A | Anthropic | R09 fixture已合main verified | 总控（Claude Code） | merged / verified（fixture） | 用户批准合main；真实调用需获审价格策略 | codex/integrate-r10a-r10b-r11 | 接线8a7f293；合main 66017c0 | 1732测试、build、生产探针fixture通过 |
| R10B | Gemini | R09 fixture已合main verified | 总控（Claude Code） | merged / verified（fixture） | 用户批准合main；真实调用需获审价格策略 | codex/integrate-r10a-r10b-r11 | 接线8a7f293；合main 66017c0 | 1732测试、build、生产探针fixture通过 |
| R11 | 声明式工作流 | R07/R04–R06 | 总控（Claude Code） | merged / verified（fixture） | 用户批准合main | codex/integrate-r10a-r10b-r11 | 接线8a7f293；合main 66017c0 | 四种模板经生产入口fixture完整运行与重启验证；真实模型工作流待测 |
| R12 | 主持人与消息版本 | R11 | R12子会话；总控集成 | merged / verified | 用户批准合main | codex/r12-host-message-versions → codex/integrate-r12-r13a | 15e2e30；合并见顶部 | 自动化、实操、DeepSeek真实模型三层通过 |
| R13 | 摘要、usage、费用预算 | R05/R09/R11 | R13A/R13B子会话；总控集成 | merged / verified | 用户批准合main | codex/r13a-real-model-enable、codex/r13a-premerge-quality、codex/r13b-usage-summary | b3e3324、0ccb49c、a96d4fe | 预算、账本、按时段与缓存结算、摘要均经DeepSeek真实账单核对 |
| R14 | 结构化产物 | R11 | R14子会话；总控集成 | merged / verified | 用户批准合main | codex/r14-structured-artifacts | af16f3d | 自动化、实操、DeepSeek真实模型三层通过（含修复后复测） |
| R15 | 安全代码导出 | R14 | R15子会话；总控集成 | merged / verified | 用户批准合main | codex/r15-safe-code-export | 6c61748 | 自动化、实操、用户亲手真实写入三层通过（不涉及模型实测） |
| R16 | 聊天 UI 与可用性 | R06；主要交互稳定 | R16子会话；总控集成 | merged / verified | 用户确认设计（D1–D6）并批准各批合main | codex/r16-ui-redesign、codex/r16-impl-discussion、codex/r16-discussion-continuity、codex/r16-batch2 | 8c8eb1b、8d833a2、4d3e8b7、a72301a | 第一批、讨论延续、第二批均经自动化、实操、DeepSeek真实模型三层验收 |
| R17 | Electron E2E 与发布 | 骨架 R02；最终 R07–R16，含 R10A/R10B | R17A子会话；总控集成 | R17A merged；公开发布未开始 | 用户批准合main；发布方向改为MIT开源 | codex/r17a-e2e-macpack | 286da03 | E2E、全量测试、37个探针阶段和打包实操通过；真实模型与真实数据升级未验证；只验证了Mac |
| R18 | V1.1 评测与 ADR | R17 V1 验收 | 未分派 | blocked | 未授权启动 | 未创建 | 无 | 未运行 |

## R00 提交引用

治理主提交为 `a17c649422c69696da91df081cb21d6d260a54cb`，主题 `chore: establish R00 governance baseline`，直接父提交为原始 `135bf82c6462ade6dd5300717d6f0102ce4a660c`。文档引用修正提交为 `769a9519b969b7897d3af314bc981ac2fb7f64d2`，主题 `docs: correct R00 commit references`，直接父提交为治理主提交。两次提交及原始历史均保留。

验收依据为上述固定提交、[R00 验证证据](verification/2026-10-13-r00-baseline.md)及用户 2026-10-13 的文档验收批准。R00 验收状态更新轮仅更新状态与准备规则，没有重新运行业务测试；R01 本轮另有独立执行证据，不把既有 R00 记录当作 R01 验收，也不表示正式桌面 E2E、真实 Provider 或跨平台发布已经验证。

## 并行与集成门槛

1. R00 → R01 → R02 → R03 串行，先完成稳定与公共边界。
2. R04/R05/R06 可分模块并行，联合验收三 Agent 公共历史、控制、投影与持久化后进入配置阶段。
3. R07/R08 可并行；R09 先建立真实接口闭环，之后 R10A/R10B/R11 可并行。
4. R12/R13/R14 可并行；R15/R16 可并行；R17 汇总最终验收，之后才考虑 R18。

共享 Schema、migration、公共文件接线先由总控完成；模块分支只消费已合入接口。同文件不并发修改，不共享依赖目录/测试数据。未来所有 merged/verified 均由总控依据新鲜证据更新。

## 发布与授权方向确认（2026-10-16，仅规划）

用户已确认免费、源码公开（Source Available）、非商业授权，未来由个人 GitHub 公开仓库及 Releases 分发，用户自备 API Key/承担厂商费用。优先考虑 PolyForm Noncommercial 1.0.0，正式发布前重新核对并由用户确认；不默认 MIT/Apache-2.0，不称 OSI 标准开源，不增加收费/订阅/激活/支付/反盗版系统。统一门槛与外部贡献权利要求见 [发布政策](RELEASE_POLICY.md)及 [R17](../tasks/R17-e2e-release.md)。

本轮仅由总控调整规划文档，不修改业务/契约/数据库/依赖、不创建 Worktree 或 GitHub 仓库、不公开或发布软件。R00–R18 功能、依赖、负责人及状态不变：R07/R08 仅 ready，R17 仍 blocked/未授权实施；许可证尚未正式采用，权属、历史敏感信息及跨平台发布审查仍待 R17 实际执行。

## R01 准备、集成与主线验收

R00 文档验收后，状态更新提交 `462a43a5cd0d341d91c64e28cfc2a903479ecd77` 将 R01 标 ready；当时仅允许准备。用户随后授权独立子项目开发，本次另行授权总控集成，开始时重新确认 main 仍为该 SHA 且工作区干净。

集成 Worktree 为 `/Users/zhangwenjie/.codex/worktrees/integrate-r01/AI交互`，分支 `codex/integrate-r01`。原子项目 `/Users/zhangwenjie/.codex/worktrees/f063/AI交互` 和分支均保留，不删除、不重写历史。用户审核集成候选 `0ad1701a47222315158e7be00d29afe1c9ef1767` 后于 2026-10-13 批准正式合并。本轮再次确认三个工作区干净，原提交 d956279 与引入提交 79b6666 的文件树完全一致；仅将集成分支合入 main，没有单独合并原子项目分支。

实际合并提交为 `4149590d28296ab3520b70606dcb161ba16a6b39`，第一父提交 `462a43a5cd0d341d91c64e28cfc2a903479ecd77`、第二父提交为集成候选；合并文件树与获批候选一致，无冲突。main 上本轮重新执行类型、全部测试、生产构建、Electron ABI 及隔离生产页面/Preload/退出后数据验证，均通过，才更新 R01 verified。原 [集成阶段记录](verification/2026-10-13-r01-integration.md)保留，不能替代 [本轮主线证据](verification/2026-10-13-r01-main.md)。

遗留限制：正式桌面 E2E、打包应用完整启动/安装/升级、Windows/Linux、签名/公证、真实 Provider/Key 仍未验证；Provider 永不响应 abort 的退出等待策略留 R04，异常恢复留 R03。本轮不重复发布/打包或实际开发 HMR 验证，集成阶段证据按历史标识保留。

### R01 文件归属与冲突防范

沿用 [R01 任务文件](../tasks/R01-startup-lifecycle-security.md) 的范围。子项目及集成阶段采用下列边界；共享申请 R01-SHARED-01 由总控接管集成 Worktree 文件并补充窗口 CJS/sandbox 联动与生产来源回归，不同时写原子项目 Worktree。总控内部分派不重叠文件集合、统一验证。本轮仅合并获批内容及更新验收文档，没有继续修改业务代码。

| 文件范围 | 唯一写入负责人 | 协作方式 |
| --- | --- | --- |
| `src/main/windows/createMainWindow.ts`；`tests/unit/appLifecycle.test.ts`；`tests/unit/lifecycle/windowSecurity.test.ts`、`tests/unit/lifecycle/ipcSource.test.ts` | 子项目交付后，本次由总控接管集成候选 | 子项目原提交保留；构建格式、退出竞态与来源回归仅在集成 Worktree 修复 |
| `src/main/index.ts`；`src/main/ipc/registerIpc.ts`；`src/preload/index.ts`；`electron.vite.config.ts`；`src/renderer/index.html` | 总控（本聊天） | 统一生命周期组装、IPC 来源、Preload 构建和 CSP 接线；R01 只提交变更申请 |
| `src/main/services/RunService.ts` | 总控（本聊天） | 仅协调正常退出 paused 终结所需最小修改，登记给 R04；R01 不直接修改状态机 |
| Shared 契约/Schema、migration 编号、package/lock、验证规则及状态看板 | 总控（本聊天） | 维持统一管理；本次不改 DTO/Schema/migration/package/lock，仅登记接线和验证证据 |

1. R01 启动时登记执行者、基线 SHA 和排他文件集合；总控与 R01 不同时写同一文件。需要扩大归属时先更新登记。
2. R01 对共享修改提交需求、调用方、兼容性、迁移、测试和安全影响；总控独立提交并先集成共享变更，R01 在自身工作区干净时同步该提交再消费，不自行向 main 合并。
3. 共享接线完成后，R01 更新并运行其生命周期/安全测试；总控审查模块提交、合入 main 并执行集成验证。未取得本次证据不能宣布 R01 verified。
4. R01 与 R02 串行；在 R01 接线和验收完成前不启动 R02 对 IPC/Preload 等公共文件的修改。各 Worktree 使用独立依赖目录、临时 userData 和数据库，不共享可变运行数据。

上述 R01 最终 main 合入与集成验证步骤已完成。新测试 `tests/integration/shutdown.test.ts`、`tests/unit/lifecycle/preloadBuild.test.ts`、有限探针 `tests/probes/r01-electron.cjs` / `r01-sqlite.cjs` 及治理记录由总控维护。无新增运行依赖，无真实 Provider/Key 操作。

### R02 启动边界

原子项目、独立集成审核及 ENV 专项均已完成。冻结安装问题由总控临时 raw fetch-timeout 参数造成，历史修正及两次全新安装见[ENVIRONMENT](ENVIRONMENT.md)和[环境证据](verification/2026-10-14-r02-environment.md)。用户随后明确批准 R02 最终合并、主线复验与状态更新，本轮只合入集成候选，不重复合并原子项目。

实际合并提交 `6aff174e6cf397eb49b9b4ceadb3387f207b84a6` 的父提交为 main `b690a1e2cefb485e81b35292bfb875bd19b88a2b` 与候选 `5b8f771bfa0fd1823b7efe6488179e15aea436a5`；合并树与候选相同，没有冲突。本次在 main 自身独立 node_modules 上实际重新编译/测试，未复用历史 PASS。全部必要检查通过后才登记 R02 verified；额外 pnpm list 的 store 写打开失败及只读依赖核对单独记录，未把失败清单当 PASS。

R03 的 R02 前置现已满足，标 ready；实施授权、数据负责人和排他文件范围仍须在启动时确认。Database、migration 编号、Main/IPC/Preload 组装及共享契约仍由总控统一管理。本轮不创建 R03 Worktree、不开发 R03；R04–R18 状态不推进。原 R02 与集成 Worktree/任务分支均保留。

R00–R02 验收不表示 V1 已完成。异常退出恢复、完整调度竞态、真正公共上下文、真实 Provider、Key 链路、产物与导出、正式 E2E 和跨平台等仍按任务记录未解决。正式 E2E、打包主入口完整 GUI/安装升级、Windows/Linux、发布签名/公证和真实 Provider/Key 未验证；本轮不重复干净安装/目录包，历史证据与主线复验分列。

## R03 最终合并与主线验收（2026-10-15）

上述 R02 阶段的 R03 ready/未实施说明为历史。用户审核 R03 集成报告后，本次明确授权最终合并。开始时 main 仍为 `be37fad9d05050a9bad1847e5008bc67752523f6`，候选及原子项目 HEAD 与授权一致，三个工作区干净。仅 non-ff 合并 codex/integrate-r03，合并提交 `e642b96a8dded195be44749dd6f267798de95198` 的两父分别为旧 main 与 `439e3c6cb58437298e94fe2536f26e22eae66f6c`，合并树与候选完全相同，没有冲突，也没有再次合原子项目分支。

main 自己的独立依赖、本次临时缓存/userData/数据库上重新执行全部必要检查，才更新 R03 verified；不是引用历史集成 PASS。migration1 原文不改、migration2 升级/真实失败回滚/历史 NULL/WAL busy/独立恢复/并发游标/重复恢复均在本次专项与全回归中通过。没有访问真实数据库/Key 或调用付费 Provider。完整实际命令与限制见[主线验证报告](verification/2026-10-15-r03-main.md)。状态更新为独立文档提交，不改已批准业务代码、依赖或 migration。

R04/R05/R06 都仅依赖已验收的 R03 数据基础与 R02 契约，因此标 ready。R04 的 RunService/stateMachine、R05 的 context、R06 的 store/subscriptions 各按任务归属分工；Database、Shared、IPC/Preload、Main/App 组装和 migration 仍归总控统一接线。三个新模块的联合验收仍须互相配合，ready 不授权开发或创建 Worktree。本轮未创建 R04/R05/R06 Worktree，其他后续任务状态不推进。

未验证：正式 E2E、开发 HMR、发布包/ASAR/安装升级、Windows/Linux、签名/公证、真实模型/Key、大数据量性能与真实断电持久性。Node24.21.0 上游风险、同步校验阶段边界取消、旧重复 requestId/一 Turn 多消息的回填分支未单独动态覆盖等限制保留；完整调度/显式恢复和累计限制仍属 R04。


## R04/R05/R06 联合集成审核（2026-10-15）

上述R03阶段的ready/未授权说明保留历史。用户已另行完成三个模块独立授权交付，本轮明确批准总控联合Worktree及A类最小适配。原模块不回写，main实际仍为37766666且干净；本轮只在联合分支引入三提交和接线。总控独占RunService/context/Mock、Main、Renderer store/session/App、公共文档/验证探针，协作者只读审查；Shared/Database/migration/IPC/Preload/package/lock不变。

三个任务review，等待用户最终审核/合main授权，不因候选PASS更新verified。R07/R08仍blocked且未授权。完整本次命令、失败修正、共享A/B/C及未验证事项见联合报告/命令台账；后续正式合main须重新执行主线验证。原R04/R05/R06分支和Worktree全部保留。


## R04/R05/R06 正式合并与本次main验收（2026-10-16）

上一节为10月15日历史review阶段。用户外部审核后明确批准完整候选，本次再次核实11个WT干净、main未偏离37766666、三模块各完整引入一次，使用git merge --ff-only将main推进d4a0d2742eb28d2441e4d06e8154b8cdd6955336；没有新merge commit，也未重复合子项目。

随后在main自己的独立依赖和本轮新数据环境完成534全回归、265专项、112 Electron专项、类型/构建、双ABI/压力、真实UI/刷新/IPC及退出后只读校验，全部必要检查通过才更新三模块及联合集成为verified。完整真实命令、输入捕获和限制见[主线验收](verification/2026-10-16-r04-r05-r06-main.md)。治理提交仅文档；最终SHA随交付消息及该报告最新Git提交定位。

R07/R08仅ready，需用户另行实施/Worktree授权及排他负责人登记；总控先统一Room/Agent/History与Provider/Key/endpoint的公共契约和数据/IPC接线，子项目不能自行改Shared/Database/migration/Main/App/store公共文件。本轮不创建新WT、不开发R07/R08，所有原任务/集成分支和WT保留。正式E2E、跨平台/发布、真实模型及已登记C类扩展仍未完成。


## R07/R08 共享前置候选（2026-10-16，历史阶段）

本节保留候选阶段历史；最新状态见下一节主线验收。上文“仅规划/没有创建 Worktree”指先前发布规划轮。用户本次明确授权总控实现共享前置，不授权合 main 或创建两个 feature Worktree。总控从已验收 main `510f58a75c676496f6e4e5960eb89553d04ab8ac` 创建唯一共享 Worktree/分支 `codex/shared-r07-r08-foundation`，main 未改。候选提交由包含本节的 Git 提交定位，完整 SHA 见最终交付。

| 项目 | 负责人 | 状态 | 范围及证据 |
| --- | --- | --- | --- |
| SHARED-R07-R08-01 | 总控唯一写入人 | review（未 merged/verified） | Room/Agent/Provider/Key/History 契约、Database CRUD、migration3、安全引用及回归；[实施与验收报告](verification/2026-10-16-r07-r08-shared.md)、[实际命令](verification/2026-10-16-r07-r08-shared-commands.md) |
| R07 | 未分派 | ready（既有依赖满足；共享 main 基线仍待合入） | 未授权 feature 实施/创建 Worktree；不可把共享测试当 R07 完成 |
| R08 | 未分派 | ready（既有依赖满足；共享 main 基线仍待合入） | 未授权 feature 实施/创建 Worktree；不可把共享测试当 R08 完成 |

本次44文件612测试、typecheck、Main/Preload/Renderer build、Node24.18.1内存SQL及5轮压力、Electron ABI139/190专项、隔离现有UI/Bridge/启动恢复/退出数据验证全部exit0。新增长期公共测试78项；中间失败及修正不隐藏。冻结离线安装646 reused/0 downloaded，从空 node_modules 建独立目录，不声称本轮冷缓存联网验证。

候选接口和排他文件详见[共享调用手册](R07_R08_SHARED.md)。Shared、Database、migration3、公共测试与 Main/IPC/Preload/App 接线归总控；以后 R07 独占 room/rooms，R08 独占 settings/security，不能同时写 KeyService。新的输入/输出表未挂生产 Bridge，不存在假成功 handler。

下一门槛：用户审核候选并明确授权合并 → 总控合 main 并重新验证 → 冻结实际最终 main 完整 SHA → 用户单独授权两个功能 Worktree。当前不能从原 main 消费本候选接口。R09 及后续状态/路线不推进；保留全部原分支和 Worktree。真实模型、真实系统 Key 后端、R07/R08 功能UI、正式E2E/发布/跨平台未验证。


## R07/R08 共享前置正式合并及main验收（2026-10-16）

用户审核三份共享交付文件后，正式授权仅ff-only合并及main独立复验。开始时main仍510f58a、候选仍1e1f971，12个Worktree均干净、候选唯一提交直接父为main。实际执行 `git merge --ff-only codex/shared-r07-r08-foundation`，main推进 `1e1f971562151fd800324a544ff4da19fa71e5ab`；没有新merge commit、冲突、重复引入或其他分支更新。全部原分支/Worktree保留。

| 项目 | 状态 | 本次证据与授权 |
| --- | --- | --- |
| SHARED-R07-R08-01 | merged / verified | main本次44文件612全回归、4文件78共享专项、strict/build、Node原生内存/压力5次、Electron ABI139/18文件190专项、两个新隔离UI/恢复profile及退出只读核验全部exit0；见[主线报告](verification/2026-10-16-r07-r08-shared-main.md)与[命令台账](verification/2026-10-16-r07-r08-shared-main-commands.md) |
| R07 | ready，未启动 | 已满足共享主线前置；未分派、无功能Worktree、未授权功能实施 |
| R08 | ready，未启动 | 已满足共享主线前置；未分派、无功能Worktree、未授权功能实施 |

本轮治理提交只更新状态/接口现状/证据与任务启动门槛，完整最终main SHA由包含本节的提交及最终交付定位；两个模块未来必须从该同一最新main完整SHA开始，启动前重新核验，不从旧510f58a或仅候选WT开发。用户仍须另行授权创建/实施。

文件归属以[共享调用手册](R07_R08_SHARED.md)为准：总控独占Shared/Database/migration3/公共测试/Main/IPC/Preload/App/store及公共工厂；R07独占room/rooms及专属测试；R08独占settings/security及专属测试，后续总控冻结KeyService写入。同文件不并发写。新typed API仍未生产注册，真实组装留联合集成；R09/R17及其他任务未启动。

本次不安装/升级依赖，不复制node_modules，main使用自己的既有独立依赖与本轮私有cache/gyp/TMPDIR/userData，Node24.18.1严格同版headers和Electron38.8.6 headers分别重建，最终main原生模块为ABI139。migration1/2逐字核对不变；升级/回滚/备份/WAL/Key归属及撤销均在本轮实际测试通过。Node24.21.0风险、真实Provider/系统Key后端、R07/R08功能UI/新Bridge、正式E2E和跨平台发布仍未验证。


## R07/R08 联合候选（2026-10-17，历史 review 阶段）

此前 ready/未实施的段落为历史。用户已另行授权两模块开发与本轮联合集成。本轮只在 `codex/integrate-r07-r08` 操作，main 仍 `c1b5beaddfe254ca978f32874e6376b398d09836` 且干净；14 个原 Worktree 的 HEAD、分支与工作区均保留。本次引入 R07 `d991178fb41854da2ad281ec1e14b6e96cd4f38b` → `f718f829f8594b09bfc943f2658533c1f69809b2`，R08 `d2aed6c4528209ab0f84e631cbc0e6e405395c31` → `5f01e978d5c4aee5cd429497f7bd7e81ba9c65fe`，各一次且 patch-id 一致，无冲突。接线代码提交 `64ac8ce5038813cc60374573dc8871da30d1eeb0`；随后独立治理提交记录本次证据，完整最终候选 SHA 见交付消息或该治理提交。

本次实际最终 Node 61文件846测试、23文件292专项、Electron29文件393专项，类型/生产构建、Node五次30万SQL压力、Electron ABI139读写/压力、生产配置UI/三Mock协作/刷新/重启、两次退出只读审计及旧v1恢复回归均 exit0。失败及修正见 [联合报告](verification/2026-10-17-r07-r08-integration.md) 和[逐命令台账](verification/2026-10-17-r07-r08-commands.md)；不将此前模块/共享前置的历史 PASS 算成本轮结果。

联合集成、R07、R08 均 **review**，未合 main、未标 merged/verified；R09/R17 仍 blocked/未授权。无新增 migration、依赖、真实 Provider 调用；系统 Keychain 加密、Windows/Linux、正式 E2E/发布包等未验证。1600×1000请求被本机工作区限制为1600×870/868，实际尺寸分列，不冒称完整1000高度已测。

## R07/R08 正式合并与主线验收停止（2026-10-17，前次授权历史）

用户审核候选后明确授权最终合并。重新核对main仍c1b5beaddfe254ca978f32874e6376b398d09836、候选仍d3205b2c3fba2061437150e87a87508d44fbb660，15WT干净；两个原模块各引入一次且patch-id匹配，main无额外提交。实际 `git merge --ff-only codex/integrate-r07-r08` exit0，main直接推进获批候选，无额外merge commit/冲突/历史重写，原分支与Worktree保留。

本次main实际846完整/292联合/111IPC安全/393Electron专项、strict/build、Node五次30万压力、Electron ABI139、生产功能/刷新/新进程重启/两次退出审计、旧联合控制及v1恢复均exit0。复核发现原生产探针只直接断言跨桥code，未逐字段断言message/retryable/无stack，因此补充真实桥核验。临时包装器将node_modules/electron包路径导出误当内置Electron API，app为undefined，在注册窗口监听时失败；未加载生产探针/Main，未执行新增桥断言。错误进程经PID/UID/进程组核验后SIGTERM，子进程-15、runner外层241；保留日志，不算PASS。

按用户“若发现失败，保留证据并停止验收推进”要求，未修复重跑、未继续主线验收。R07/R08和联合集成只登记**merged，验收停止、未verified**；R09仍blocked/未授权，未启动任何新任务或Worktree。记录见[主线报告](verification/2026-10-17-r07-r08-main.md)与[台账](verification/2026-10-17-r07-r08-main-commands.md)。本次独立提交只记录事实/失败/现态，不改业务、测试、依赖或migration，不进行破坏性回滚。

剩余门槛为用户允许继续后，先修复并在ready前落实补充探针隔离，再完成真实桥DTO字段核验及退出确认；通过后才能独立更新verified/R09 ready。既有通过记录有效，但不能将部分PASS或候选历史PASS替代未完成检查。

## R07/R08 补充探针修复与最终验收（2026-10-17）

用户另行授权最小验证修复及完成验收。完整日志、错误wrapper与electron npm入口源码确认绝对包路径只返回二进制路径；原失败(-15/外层241)保留不删。仅在tests/probes/r07r08-electron.cjs中，将新增错误DTO断言放入既有隔离完成/真实Main加载后、UI和PASS之前直接await；沿用内置require('electron')、失败写FAIL/exit1。两条真实错误路径各9项，精确18/18，不能空集成功。

本次真实Electron38.8.6/ABI139/arm64探针自然exit0，原生产操作及24组布局也通过；随后只读退出SQLite审计exit0。业务src、构建配置/依赖、原回归fixtures及UI输入不变；5个生产构建文件本轮前后SHA/mtime不变、native不变，按用户明确授权复用同业务版本的846完整/292联合/111安全/393Electron、strict/build和重启等既有主线证据，不称本轮重跑。全部必要验收闭环后登记R07/R08及联合集成**merged/verified**，关闭VALID-R78-BRIDGE-01。

本次提交仅一个验证探针与治理文档，原失败提交28cb2f7、分支/15WT及历史保留。R09依赖满足而ready，未授权实施/创建Worktree，未启动；不实施R17、不发布。最终完整main SHA由本节所在提交及交付消息定位。真实Provider、系统Keychain、正式E2E/跨平台/发布等原限制不变。

## R09 正式合并与 fixture 主线验收（2026-10-17）

本节取代候选review/未合main的历史停止边界。用户批准完整f3a8fee38f5b7d75b5144c2997d72373fda6ddd6后，重新核对main仍e9cf24e99d09a460f4d8cd0a3a8b7ec4aacf285a且干净、祖先关系与原模块唯一引入记录后，实际git merge --ff-only codex/integrate-r09 exit0；没有重复合原分支，没有新merge commit。紧邻合并前17个WT与收尾清单一致，原分支/WT/历史保留；较早18清单的差异及边界见主线报告。

本轮main实际Node75文件1073/1073、R09专项14文件227/227、Electron75文件1073/1073、strict/build、双ABI内存/压力、真实生产fixture12请求、重启HTTP0及两次退出只读审计均exit0；原房间/设置/三Mock生产回归首轮/重启各18/18真桥断言及审计、旧v1异常恢复/备份也通过。首次loopback沙箱EPERM和旧恢复探针遗漏confirmTarget的exit1保留，后者仅一行验证白名单修复，没有业务/构建改动。全部必要主线检查完成后才将R09 fixture登记merged/verified；详见[报告](verification/2026-10-17-r09-main.md)和[台账](verification/2026-10-17-r09-main-commands.md)。最终main完整SHA为本次独立状态提交，由交付消息及Git定位。

R10A/R10B仅ready未授权；R11仅独立有限计划/Mock范围ready，plan/next-step/阶段进度及必要持久化契约仍须总控先冻结，不能自行跨Shared/DB/RunService/App写入。真实生成默认无获审model policy仍unsupported；公网模型/能力计数/费用、真实Keychain、正式E2E及跨平台发布未验收，不启动后续模块/Worktree或GitHub发布。

## DeepSeek 首次真实测试安全准备（2026-10-18，已合main）

| ID | 范围 | 负责人 | 状态 | 分支/基线 | 验收/授权边界 |
| --- | --- | --- | --- | --- | --- |
| DEEPSEEK-PREP-01 | DeepSeek参数、人民币预算及安全fixture准备 | 总控；协作代理只读 | merged/verified（仅安全准备） | 获批30d578356d283a55b1c15a122c0a37465c6e4b25由dc387146严格ff-only合main；原分支/WT保留 | 本次main重新执行32专项、Node/Electron各1105、strict/build、双ABI/生产拒绝/重启HTTP0/退出审计均exit0；[主线报告](verification/2026-10-18-deepseek-main.md)/[命令](verification/2026-10-18-deepseek-main-commands.md)；真实API仍未授权 |
| DEEPSEEK-TOKEN-01 | 1017 API完整输入Token/隐式封装安全上界证明 | 待总控进一步审查 | blocked | 无获审真实counter，未注册ModelPolicy | 生成在Key/请求前拒绝，真实API数量0；不能用fixture计数/字符比例/预算授权绕过 |

用户另行授权后，完整获批30d5783已ff-only合main并通过本轮独立复验；仅安全准备merged/verified。DEEPSEEK-TOKEN-01继续blocked，R09已有fixture verified不外推为DeepSeek真实可用。R00–R18路线、其他任务状态及分工不变。价格候选使用高峰未命中输入¥2/M、输出¥8/M，单次¥0.05，有效至2026-10-18T00:00Z，过期须复核。真实计数/Keychain/公网账单、E2E/发布未验收；本轮到主线验收完成停止，不启动后续任务或真实请求。

## DeepSeek 单次受控测试候选（2026-10-18，历史 review 阶段）

| ID | 范围 | 负责人 | 状态 | 分支/基线与证据 |
| --- | --- | --- | --- | --- |
| DEEPSEEK-TRIAL-01 | 短文本估算、单次确认、持久预留与 usage 核算 | 总控唯一共享写入人；协作代理按文件归属 | review，未 merged/verified | `codex/deepseek-controlled-trial`，基线 `ae5c24c6dd1410aedba6ef31894470b7cb668c8a`；候选完整 SHA 由本节所在提交及交付消息定位；[报告](verification/2026-10-18-deepseek-controlled-trial.md)、[命令](verification/2026-10-18-deepseek-controlled-trial-commands.md) |
| DEEPSEEK-TOKEN-01 | 严格模式完整1017输入/隐式封装安全上界 | 总控 | blocked（严格模式保持） | 本候选不注册真实 counter/ModelPolicy。另行用户批准的受控模式采用标明偏差/未知的估算，不能视为严格证明已解决 |

本次用户授权仅开发与本地模拟，未授权合 main 或任何公网模型请求。main 仍 `ae5c24c6dd1410aedba6ef31894470b7cb668c8a` 且干净，原分支/Worktree 保留；没有启动 R10/R11/R13/R17。既有 R00–R09 验收和路线不变。候选 Main-only 入口不扩展普通房间真实生成权限，原离线预览网络隔离保持；未结费用保留未知及¥0.05预留，不能自动恢复/重试或清零。

新增 migration4，原1/2/3不变；Shared/IPC/Preload/Renderer、package/lock和 Mock 预算不变。价格重新核验于北京时间2026-10-18，至北京时间2026-10-19 00:00有效，过期安全拒绝。真实 API 请求数为0；实际账单、严格计数、正式签名及锁定登录 Keychain、完整E2E/跨平台/发布仍未验证。实际测试数量、失败修复和有限真实后端证据以本轮报告为准，不沿用旧1105或中间1160成绩充当最终成绩。

## DeepSeek 单次受控测试正式合并与主线验收（2026-10-18）

用户审核后明确授权最终合并。重新核验 main `ae5c24c6dd1410aedba6ef31894470b7cb668c8a`、获批候选 `db97b95c8d7ce279d76d304d9f4c9ea64259d16a`、17个干净Worktree及29文件范围后，实际 `git merge --ff-only codex/deepseek-controlled-trial` exit0。main直接推进获批候选，无新merge commit、冲突、重复引入或历史重写；所有原分支/Worktree保留。

| ID | 最终状态 | 本轮证据及边界 |
| --- | --- | --- |
| DEEPSEEK-TRIAL-01 | merged / verified（仅受控入口、本地fixture） | main独立Node/Electron各81文件1168/1168、strict/build、双ABI原生、42条生产/24条重启断言及只读退出审计通过；原R09/R07/R08生产和重启回归通过；[主线证据](verification/2026-10-18-deepseek-controlled-trial-main.md) |
| DEEPSEEK-TOKEN-01 | blocked（普通真实生成的严格计数） | 没有注册真实counter/ModelPolicy，不把未校准估算或¥0.05客户端预留视为精确计数/绝对账单上限 |

本次必要检查全部exit0后才更新状态；合并后src/tests/依赖版本/价格窗口无修改，migration1–3逐字不变。v3→v4升级、失败回滚、备份恢复、关键索引/记录保护与未知预留跨重启均实测通过。main最终SHA为本节所在独立治理提交，完整值见交付消息与Git历史。未读真实Key/个人数据库，公网模型请求0；没有重新执行OS Keychain测试。原有限28条后端证据仍不等同v4整App、签名或锁定登录Keychain验收。

首次真实调用仍需用户另行明确授权精确目标、单Agent/固定提示/128输出和¥0.05客户端预留风险，并在发送前核价、确认目标/当前Key归属、检查无未知预留、逐次原生确认。现有价格窗口至北京时间2026-10-19 00:00，过期拒绝、不自动续期。未知费用不自动清零。R10/R11/R17及GitHub发布未启动；本轮到主线验收停止，不自动发起真实请求。

## DEEPSEEK-DIAG-01 最小诊断修复候选（2026-10-19）

- 基线/main：`524f5052736dd8fbb7e093873d2a1f3c2732fc82`；独立分支 `codex/deepseek-trial-diagnostics`。候选提交及实际验收见本节对应的 [交付报告](verification/2026-10-19-deepseek-diagnostics.md) 和 [命令台账](verification/2026-10-19-deepseek-diagnostics-commands.md)。
- 状态：**review（独立候选，未合 main）**。只增加未来受控测试的安全诊断与原生记录展示；R00–R09主线验收状态不变，没有启动后续模块。
- 第一次真实请求的 `network_error / unknown` 不能由新代码追溯判定是否送达或计费；本轮不访问其 profile/Keychain/数据库、不清零/删除记录或 ¥0.05 预留。仍须服务商账单人工核对，未知预留继续阻止下一次测试。
- `DEEPSEEK-TOKEN-01` 普通真实 Run 严格模式仍 **blocked**。既有价格快照已于北京时间2026-10-19 00:00到期；本轮不续期/核新价、不发真实 API，请求前门禁继续拒绝。
- 新诊断为 v4 JSON 可选扩展，不变更 migration1–4；只保证新代码读旧记录，旧二进制读取新诊断记录不支持。当前运行 App、原分支和 Worktree 保留，不自动部署候选或重启用户应用。

## DEEPSEEK-DIAG-01 正式合并与主线验收（2026-10-19）

用户最终授权后，main从`524f5052736dd8fbb7e093873d2a1f3c2732fc82`严格ff-only到获批`7599949087e0fc0a09c6ca99a33a376eaba9d3f7`，无冲突/重复引入；原18个Worktree和所有分支保留。上述候选review边界由本次主线验收取代，历史报告不改。

| ID | 当前状态 | 本次证据及边界 |
| --- | --- | --- |
| DEEPSEEK-DIAG-01 | **merged / verified**（安全诊断、本地fixture） | main实际Electron84文件1255/1255、Node诊断66/66、strict、独立输出生产构建、原生ABI139、49/30生产/重启及35退出检查全部exit0；[主线报告](verification/2026-10-19-deepseek-diagnostics-main.md)、[命令](verification/2026-10-19-deepseek-diagnostics-main-commands.md) |
| 原首次真实试验 | **unknown，原¥0.05预留保留，未核销** | 本轮不读取/写入真实profile/DB/Keychain，不倒推送达或失败根因；仅人工账单核对，未核验真实DB当前实时状态 |
| DEEPSEEK-TOKEN-01 | **blocked**（普通真实Run严格模式） | 无新counter/ModelPolicy；价快照过期仍拒绝，未开新单次许可，公网模型API0 |

本次只追加验收文档，src/tests/Shared/Schema/依赖/迁移/价格不另改。main原out全文件及.node哈希/inode前后不变，当前用户应用未部署/重启。旧reader不支持读取新诊断；临时transport覆写须转发observer，未来部署另授权。最终main为本节所在独立文档提交，完整SHA见交付消息/Git历史；完成后停止，不启动其他任务。

## DEEPSEEK-LAUNCH-01 诊断与启动器修复候选（2026-10-19）

用户授权从7900a4fbc75aca6c9c4aedb330636bbbea128490在独立Worktree实施，分支`codex/deepseek-launcher-network-fix`。状态 **review，未合main、未部署或重启当前App**；R00–R09既有状态与R00–R18路线不变。只纳入受控包装器、修复两处observer透传、动态最新干净main构建/产物绑定和安全启动，默认cancel-only，不claim旧发送许可。证据见[候选报告](verification/2026-10-19-deepseek-launcher-network.md)/[逐命令台账](verification/2026-10-19-deepseek-launcher-network-commands.md)。

本次Node1255、Electron诊断178、Python21、包装器8场景、TLS30断言、实际ABI139、真实生产入口28/重启21与prepare执行通过；src/Shared/IPC/迁移1–4/package/lock/价格不改。当前系统代理和TUN差异不足以证明需要专用代理，本轮不实现。首次unknown/¥0.05未触碰，严格计数blocked/价格过期拒绝/真实Keychain和公网未验收/每次本人确认保持。下一步只等待候选审核；合并、部署/关闭旧窗口、核价、核销和真实单次请求分别需要授权，不自动继续。

## DEEPSEEK-LAUNCH-01 正式合并及main验收（2026-10-19）

用户授权后已将获批f04ed4873066eefd7161dd721f104caf4ad1ac30从7900a4fbc75aca6c9c4aedb330636bbbea128490严格ff-only合main，原分支/19个Worktree全部保留。此前review为历史阶段；当前 **merged / verified（安全诊断、最新main构建绑定、本地fixture）**。本次main新跑Python21、Node/Electron包装器各8场景、Electron受影响178、TLS30、ABI139内存4、strict/build、生产入口28/重启21、实际prepare均exit0；原沙箱失败保留。见[主线报告](verification/2026-10-19-deepseek-launcher-main.md)/[台账](verification/2026-10-19-deepseek-launcher-main-commands.md)。

按用户本轮只读授权核对原controlled_trials费用/状态投影：unknown1条、¥0.05预留、实际费用NULL前后一致，未读Key表或真实Key。当前PID27099/旧冻结构建/加密身份未换；新版只提供未授权入口，Finder文件准备不等于真实profile部署。价格过期、严格计数blocked、unknown保护及另行单次许可要求不变；真实网络/Keychain仍未验证，不启动后续任务。最终main为本节所在治理提交，完整SHA见Git和交付消息；最终快照须匹配该HEAD。
