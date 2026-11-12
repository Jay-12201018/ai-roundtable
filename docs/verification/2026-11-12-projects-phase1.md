# 项目与独立讨论 第一期（结构）验证记录

日期：2026-11-11 至 2026-11-12。分支 `codex/projects-phase1`，基于 main `9f97cd2`。决策 D167 到 D171，migration 17。子会话交付，未合 main。

只用先隔离 userData 的入口（`tests/e2e`、`tests/probes/*`、`:memory:` 和临时目录里的数据库）。没有运行 `pnpm dev`、`electron-vite dev`，没有启动未隔离的应用，没有读取或写入正式数据目录 `~/Library/Application Support/ai-roundtable/`，没有用真实 Key，没有调用真实模型。试用目录只读了一次：用 `sqlite3 "file:…?immutable=1" ".backup"` 把试用库复制到会话的临时目录做升级演练，试用目录里没有新建文件（复制前后目录里各文件的时间没有变化）。

## 第 1 层：自动化测试

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 类型 | `pnpm run typecheck` | exit 0 |
| 单元和集成 | `pnpm test` | 131 个文件 / 2240 项通过，exit 0（main 上是 125 / 2204） |
| 桌面 e2e（真实 Electron，隔离 profile，回环夹具） | `pnpm e2e`（含前置的 `pnpm build`） | 54 项通过，exit 0（原 51 项加新增 3 项） |
| 打包后的 e2e | `pnpm run pack`，`pnpm e2e:packaged` | 打包 exit 0；3 项通过，exit 0 |
| 升级演练 | `pnpm rehearse:upgrade <试用库 v16 副本>` | 通过，见下 |

新增和改动的测试：

- `tests/integration/persistence/migrationV17.test.ts`（3 项）：从 v1 结构逐个迁移到 v16、带四个房间五场讨论的数据库升级到 17。升级前后 `workflow_runs`、`turns`、`messages`、`run_events` 逐行相同，`rooms`、`agents` 原有的列逐行相同，只多了阵容房间和三位成员；四个房间都成为项目，默认讨论方式按最后一场推断；备份登记为从 16 升级；各触发器（阵容唯一、不能删、不能归档、不能有讨论、种类和方式的取值）直接在 SQL 层验证；全新数据库同样带阵容。
- `tests/integration/projects/projects.test.ts`（9 项）：真实 `RunService`、`RoomService`、上下文构建和服务适配层，拦截发出的请求体。项目说明出现在群聊三位成员和严格流程三个回合的每个请求里，位置在规则之后（第 3 条消息），逐行引用并写明不是指令，调度请求里没有；讨论进行中改项目说明，下一条回复带新内容；不带 `brief` 的更新不会清掉它；超过 4000 字被拒绝。独立讨论：从阵容复制成员、补默认模型、开始、继续（同一个 Run）、列出时带参与成员；改这场的成员不动阵容，改阵容不动已有讨论；没开始的那场被下一场替换；从另一场独立讨论接着开；归档后从列表消失、带归档时出现；阵容不能讨论、归档、改名、删除。默认讨论方式存取和取值校验。
- `tests/unit/context/projectBrief.test.ts`（4 项）：上下文里的位置、来源记录、逐行引用（含伪造标签和 Unicode 换行）、空和超长被拒、小上下文模型放不下时明确拒绝而不是悄悄截断。
- `tests/unit/rendererShell/sidebarSections.test.tsx`（6 项）：侧栏三栏的显示、展开、点击、头像、归档与恢复、空状态和读取失败、长列表折叠。
- `tests/unit/rendererShell/standaloneApp.test.tsx`（6 项）：打开应用落在新讨论、默认模型、第一条消息发到这场自己的房间、侧栏再开一场、项目里的新讨论、建不出来时的提示和重试（只建一次）、从列表行归档。
- `tests/unit/rendererRooms/projectPage.test.tsx`（7 项）：项目说明的说明文字、保存、取消、超长、归档后只读；默认讨论方式五选一；常用阵容变体只有成员、没指定模型不标警告。
- `tests/e2e/projects.spec.ts`（3 项）：见第 2 层。
- 跟着新结构改的既有测试：版本号 16 改 17 的各迁移和校验测试；`rehearseUpgrade.test.ts` 加 v16 起点；`productionApp.test.tsx` 改为由假 Main 保存讨论方式；依赖“启动即进入第一个房间”的 App 级测试改用 `tests/support/landing.ts`（把落地页指到被测项目的新讨论）；e2e 加 `starterProject`、`projectRuns`、`openFirstProject` 三个辅助函数，`strictRoom` 改为通过接口设置项目的默认讨论方式。没有删除测试，没有跳过。

### 升级演练

输入是试用库的副本（v16，5 个房间、17 位成员、71 场讨论、471 条消息、97,746 条事件）。试用库旁边有约 1.9 MB 还没合并的 `-wal`，`immutable=1` 的复制不包含它，所以副本比试用库的当前状态略旧；这不影响演练的结论，但不等于对试用库当前状态的逐行证明。

```
版本：v16 → v17
启动恢复：0 个未完成的讨论标为中断；清除 0 处疑似 Key 的模型 ID
升级备份可恢复：是
agents: 17 → 20    rooms: 5 → 6    messages: 471 → 471    workflow_runs: 71 → 71
turns: 331 → 331   run_events: 97746 → 97746   request_usage: 488 → 488（其余各表行数不变）
输入文件：没有变化
结果：通过
```

演练后的库（只读打开）：5 个项目，其中 4 个默认群聊、1 个按最后一场推断为审查修订链；71 场讨论全部在项目里，没有一场变成独立讨论；`foreign_key_check` 无输出；阵容三位成员没有模型、`configuration_version=1`。第一次演练报“输入文件有变化”，原因是我在演练前用 `sqlite3` 直接打开过副本，旁边留下了空的 `-wal` 和 `-shm`；删掉副本重新生成后通过。演练脚本本身的改动见 D170。

## 第 2 层：实操验收（构建出的真实应用，隔离的临时 profile）

用 `tests/e2e` 的隔离入口启动 `out/` 里的构建（启动时核对 userData、sessionData、logs 都在临时 profile 里，网络只放行到本机回环夹具），用真实的鼠标点击和输入法组合输入中文，把三条路径各走一遍。截图由 `webContents.capturePage()` 取自窗口本身，浅色和深色各一张，存在 `docs/verification/projects-phase1-screens/`（36 张，命令：`ROUNDTABLE_PROJECTS_SCREENS=1 pnpm exec playwright test tests/e2e/projects.spec.ts`）。回复内容来自夹具，只能证明结构和流程，不能说明真实模型说得好不好。

### 独立讨论

| 截图 | 说明 |
| --- | --- |
| `a01-landing-new-discussion` [浅色](projects-phase1-screens/a01-landing-new-discussion-light.png) / [深色](projects-phase1-screens/a01-landing-new-discussion-dark.png) | 打开应用就是一场新讨论：不用先建项目，成员是常用阵容的三位，模型已经选好；侧栏三栏是新讨论、项目、最近讨论。 |
| `a02-standalone-chat` [浅色](projects-phase1-screens/a02-standalone-chat-light.png) / [深色](projects-phase1-screens/a02-standalone-chat-dark.png) | 第一条消息发出后，三位成员回应；这场讨论出现在“最近讨论”，前面是三位成员的小头像。 |
| `a03-new-discussion-two-members` [浅色](projects-phase1-screens/a03-new-discussion-two-members-light.png) / [深色](projects-phase1-screens/a03-new-discussion-two-members-dark.png) | 从侧栏再开一场：这一场只留两位成员。页面写明“这里的改动只用于这一场”，并给出修改常用阵容的入口。 |
| `a04-recent-row-archive` [浅色](projects-phase1-screens/a04-recent-row-archive-light.png) | 指到“最近讨论”的一行，右侧出现归档按钮；不提供删除，记录都保留。 |
| `a05-archived-discussion` [浅色](projects-phase1-screens/a05-archived-discussion-light.png) / [深色](projects-phase1-screens/a05-archived-discussion-dark.png) | 打开已归档的讨论：内容都在，输入框的位置写明只能查看，并原地给出“恢复这场讨论”。 |

### 常用阵容

| 截图 | 说明 |
| --- | --- |
| `b01-settings-lineup` [浅色](projects-phase1-screens/b01-settings-lineup-light.png) / [深色](projects-phase1-screens/b01-settings-lineup-dark.png) | 设置 › 常用阵容：侧栏“新讨论”默认带的成员。没有指定模型的成员写明新讨论时用默认模型，不显示成故障。 |
| `b02-settings-lineup-edited` [浅色](projects-phase1-screens/b02-settings-lineup-edited-light.png) / [深色](projects-phase1-screens/b02-settings-lineup-edited-dark.png) | 改名并加了一位成员之后的常用阵容。 |
| `b03-new-discussion-new-lineup` [浅色](projects-phase1-screens/b03-new-discussion-new-lineup-light.png) / [深色](projects-phase1-screens/b03-new-discussion-new-lineup-dark.png) | 再点“新讨论”：成员就是刚改过的常用阵容。 |

### 项目

| 截图 | 说明 |
| --- | --- |
| `c01-new-project-dialog` [浅色](projects-phase1-screens/c01-new-project-dialog-light.png) | 新建项目：一个名称，说明项目里的讨论共用什么，会带好三位成员。 |
| `c02-project-page-empty` [浅色](projects-phase1-screens/c02-project-page-empty-light.png) / [深色](projects-phase1-screens/c02-project-page-empty-dark.png) | 项目页：项目说明（还没有写，写明不写会怎样）、成员、默认讨论方式、讨论。侧栏“项目”一栏里它是展开的。 |
| `c03-project-brief-editing` [浅色](projects-phase1-screens/c03-project-brief-editing-light.png) | 写项目说明：上面写明每位成员每次发言前都会读到、不是指令、会算进输入用量；右下是字数和保存。 |
| `c04-project-page-filled` [浅色](projects-phase1-screens/c04-project-page-filled-light.png) / [深色](projects-phase1-screens/c04-project-page-filled-dark.png) | 写好项目说明、默认讨论方式选了“自由讨论”的项目页。 |
| `c05-project-new-discussion` [浅色](projects-phase1-screens/c05-project-new-discussion-light.png) / [深色](projects-phase1-screens/c05-project-new-discussion-dark.png) | 项目里的新讨论：默认就是项目定的“自由讨论”，标题下写着项目名，成员是项目的成员。 |
| `c06-project-discussion-done` [浅色](projects-phase1-screens/c06-project-discussion-done-light.png) / [深色](projects-phase1-screens/c06-project-discussion-done-dark.png) | 项目里的一场讨论：状态行带着项目名；侧栏里它列在项目下面，不在“最近讨论”。 |
| `c07-sidebar-both-lists` [浅色](projects-phase1-screens/c07-sidebar-both-lists-light.png) / [深色](projects-phase1-screens/c07-sidebar-both-lists-dark.png) | 侧栏同时有项目和最近讨论：正在看的是独立讨论，项目收起。 |
| `c08-project-page-with-discussions` [浅色](projects-phase1-screens/c08-project-page-with-discussions-light.png) / [深色](projects-phase1-screens/c08-project-page-with-discussions-dark.png) | 回到项目页：三场讨论都在，默认讨论方式已是刚才在新讨论页改成的“群聊”。 |
| `c09-narrow-drawer` [浅色](projects-phase1-screens/c09-narrow-drawer-light.png) / [深色](projects-phase1-screens/c09-narrow-drawer-dark.png) | 800×600：导航收进抽屉，三栏照旧。 |
| `c10-narrow-project-page` [浅色](projects-phase1-screens/c10-narrow-project-page-light.png) / [深色](projects-phase1-screens/c10-narrow-project-page-dark.png) | 800×600 的项目页。 |

每条路径里同时核对的事实（都是测试里的断言，不只是看图）：

- **独立讨论**：落地页状态行写“独立讨论 · 3 位成员”，三位都已选好默认模型；发出第一条后数据库里是 1 个阵容房间加 1 个独立讨论房间；三个成员请求都不带项目说明；继续发言后仍是同一个 Run；第二场减到两位后阵容仍是三位且都参与；重启后两场都在，旧的那场能接着聊，聊过之后排到最前；归档后从列表消失、在“已归档”里、打开只读、恢复后输入框回来；全程没有被拦截的网络请求。
- **常用阵容**：设置里改名（输入法）并加一位后，新讨论是四位新阵容；改之前那场讨论的头像和发言人还是原来三位。
- **项目**：用输入法起名建项目；写项目说明并保存；默认讨论方式选“自由讨论”后数据库里 `default_mode='free-chat'`；项目里两场新讨论都默认是自由讨论，六个成员请求每个都带一条项目说明且逐行引用；在新讨论页改成群聊后数据库里同步变成群聊，群聊的请求也带项目说明；旁边开的独立讨论请求里没有项目说明、也没有项目名；侧栏里项目的三场讨论和“最近讨论”分开列；800×600 下导航在抽屉里；归档项目后它和它的讨论一起收进“已归档”，四场讨论都还在。

### 实操中发现并修掉的问题

1. **自动落地会关掉刚打开的导航抽屉**：窄窗口下点菜单后，稍晚完成的“自动开一场新讨论”又把抽屉关了。关抽屉只留给侧栏按钮的点击。
2. **“再试一次”会建出两场**：建新讨论失败后点重试，手动的一次和自动落地的一次同时发出。改成同一时间只建一场。
3. **严格流程的项目，目标框被清空**：房间还没读出来时被当成群聊处理，预填的目标被清掉。改成读到房间之后才判断。
4. **新建的独立讨论页面闪一下**：刚建好时列表还没刷新，页面先按“未知房间”画了一帧。建好的房间直接记下，不等列表。
5. **结束的严格流程下面再开始，流程成员还没读到**：只有群聊和不带流程的自由讨论可以不等成员；其余方式在查看已结束的讨论时也读成员。
6. **项目的讨论列表第一行不是讨论**：最初把“在项目里开新讨论”做成列表第一行，重启后用户（和既有 e2e）点第一行会开出一场新讨论而不是打开上一场。改成项目行右侧的“+”，列表里只有讨论。
7. **项目页有两个“新讨论”按钮**：讨论一节里又放了一个，和页头重复，去掉。
8. **最近讨论里中断的讨论没有标记**：崩溃后中断的独立讨论现在和失败的一样带状态点。
9. **“开始试玩”和自动落地抢跑**（打包后的 e2e 发现）：点“开始试玩”后演示服务一建好，“没有打开任何讨论就开一场新讨论”的规则就生效了，和试玩自己要打开的演示项目撞在一起，最后停在哪个页面看谁先完成；打包应用里停在了独立讨论，演示项目里没有讨论。试玩进行中不再自动落地，并在 `firstUse.test.tsx` 里加了断言（停在演示项目，且没有建出独立讨论）。

### 探针

逐个运行了 14 个探针的首次阶段（都在各自的临时 profile 里，`liveApi=false`），最后一遍全部 exit 0：`premerge-quality-acceptance`、`r07r08-electron`、`r09-electron`、`r10-r11-electron`、`r12-electron`、`r12-acceptance`、`r14-acceptance`、`r15-acceptance`、`r16-acceptance`、`r16-batch2-acceptance`、`r16-continuity-acceptance`、`r16-longhistory`、`r78-drawer-acceptance`、`r01-electron`（不带参数）。最后那处修正（见下面第 9 条）之后只重跑了涉及试玩和向导的三个（`r16-batch2-acceptance`、`premerge-quality-acceptance`、`r12-acceptance`），其余十一个是在那一行改动之前通过的。

第一遍有 5 个失败，都是探针跟不上新导航，不是应用的缺陷，已改探针：

- 靠本地存储 `roundtable.mode.<id>` 设“自由讨论”的 11 处，改为通过 `rooms.updateRoom` 设置项目的默认讨论方式（D169）。
- 依赖“连接第一个服务后自动建好我的第一场讨论”的 4 个探针，改为像“新建项目”那样建一个项目（`tests/probes/starter-project.cjs`）；`r07r08-ui` 里“删除向导建的房间”一步改成核对向导没有建项目。
- `r16-acceptance` 里 4 处点侧栏“新讨论”来在同一项目里再开一场的，改点项目行的“+”。
- `r16-batch2-acceptance`：欢迎页侧栏的空状态文字；项目页的“更改”按钮换成就地选方式加“自定义流程”。
- `r01-electron`、`r07r08-electron`：`rooms` 接口面清单加上三个新方法。

探针会把截图写进以前各任务的截图目录；这些目录已恢复成运行前的内容，没有随本分支改动。

**未运行**：各探针的重启阶段（`--restart`）、`focus-steal`、`window-condition`、`joint-ui`（r01 的 `--joint-ui`）、`r01 --r03-recovery`、`r01 --development`（按规定不运行）、`r09-native`、三个 `*-sqlite` 检查、`public-context`。

**要说明的一次误操作**：第一遍我用一个循环不带参数地启动了每个探针，其中 `profile-guard.cjs` 不带参数时是它的总控模式：会列出正式数据目录里各文件的名字、大小和时间做前后对比，不读内容、不写入。它卡住后被我杀掉，没有跑完。这违反了“不读取正式数据目录”的要求，请总控按惯例核对正式目录的条目数和时间。

## 第 3 层：真实模型实测

**未验证。** 这一期不增加模型调用，但项目说明改变了每个成员请求的内容，合并前应由总控和用户用真实模型看一次：成员是否把项目说明当背景用、会不会把它当指令照做、群聊里“只说有依据的事”会不会因为它而放松或收紧。

## 未验证和已知限制

- 真实模型下项目说明的效果（见上）。
- 试用库当前状态（含未合并的 `-wal`）的升级：只在不含 `-wal` 的副本上演练过。正式数据库（版本 1）没有碰，也没有演练。
- 对比度没有实际测量；深色主题只看了截图。1024×768、1600×1000 没有单独截图，只走了 1280×800 和 800×600。
- 摘要、产物生成、群聊调度这三类请求不带项目说明（D168 写明是有意的）；它们整理项目讨论时不知道项目背景。
- 独立讨论目前不能移进项目，也不能改标题（标题就是第一条消息）；项目没有成果汇总和记忆，都是第二期。
- 这台电脑以前记在本地存储里的讨论方式只在升级后第一次打开时交接一次；交接前就清过本地数据的，按最后一场讨论推断。
- 重启或崩溃后如果上次没有停在某场讨论上，应用落在新讨论页，项目里中断的讨论要点开项目才看得到；以前只有一个房间时会直接看到它的讨论列表。
