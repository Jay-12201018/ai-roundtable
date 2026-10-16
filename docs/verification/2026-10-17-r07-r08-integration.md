# R07/R08 联合集成与验收报告

执行日期：2026-10-17（Asia/Shanghai）。结论：必要联合验收通过，**建议进入用户最终合 main 审核**。本轮只交 review 候选，没有合 main、没有把 R07/R08 标 verified，没有启动 R09/R17。

## 1. Git、范围与精确引入

| 项目 | 实际结果 |
| --- | --- |
| main 基线及当前 HEAD | `c1b5beaddfe254ca978f32874e6376b398d09836`，工作区干净、未修改 |
| 集成分支 | `codex/integrate-r07-r08` |
| 独立集成 Worktree | `/Users/zhangwenjie/.codex/worktrees/integrate-r07-r08/AI交互` |
| R07 原提交 | `d991178fb41854da2ad281ec1e14b6e96cd4f38b` |
| R07 引入 | `f718f829f8594b09bfc943f2658533c1f69809b2`，cherry-pick -x |
| R08 原提交 | `d2aed6c4528209ab0f84e631cbc0e6e405395c31` |
| R08 引入 | `5f01e978d5c4aee5cd429497f7bd7e81ba9c65fe`，cherry-pick -x |
| 总控公共接线代码提交 | `64ac8ce5038813cc60374573dc8871da30d1eeb0` |
| 最终候选 | 上述代码提交加随后独立治理提交；完整最终 SHA 由交付消息和当前分支 HEAD 给出，不在文档中伪造自引用 SHA |

两个模块均直接基于获批 main。引入为连续父链，各一次，无冲突；原/引入 patch-id 分别相同：R07 `31269c952e79e94c1e32a54c717de312b76701cb`，R08 `e2fa25dcb7aed3406147bf8c8046941f5cb4b7a8`。开始、恢复执行及提交前再次核对 main 与14个原 Worktree HEAD/状态均未变；原模块分支及 Worktree 全保留。原始135bf82历史仍在祖先链。

完整精确命令、上限、退出码、用时、日志指纹见[逐命令台账](2026-10-17-r07-r08-commands.md)，原始证据根为 `/private/tmp/roundtable-r78-joint-i6xqf65e`。报告不把模块历史 68/74/680/684 等结果当本轮 PASS。

## 2. 共享接线与最小必要适配

| 范围 | 实际实现及原因 |
| --- | --- |
| Main 装配 | 同一 Database 注入 RoomService、KeyService、ProviderSettingsService；与既有 RunService 一起真实注册。无空 handler、第二套 repository、真实 Adapter 或新依赖 |
| IPC / Preload | 增加15个 rooms、11个 settings 方法；保留原 room/run，共38条受限 invoke。Shared直接引用统一input/output表，双端严格解析，检查实体/房间/Provider身份及分页上界。无通用invoke/send、resolveKey、Node/fs能力 |
| 异步来源与事件 | handler入口及成功/失败返回前校验sender/senderFrame/顶层可信页；失信/已dispose来源不能收迟到响应或事件；旧disposer不能撤新注册 |
| 配置退出协调 | disposer即时撤权限，单独drain已接受配置操作；Main唯一退出屏障在关DB前等待当前/已关闭窗口配置写入。Run长控制不加入集合；保留R01单次退出、R03恢复与部分输出 |
| 跨桥错误修复 | 真实Electron发现ContractError自定义属性丢失；invoke外catch只抛严格ApiError普通DTO，保留固定code/message/retryable/可选field，不带stack/原异常/Key。成功返回及Main内部错误不改 |
| App 与 R06 | 正式挂RoomsFeature/SettingsFeature和讨论页。先恢复旧Run再初始化Rooms，非首房/归档房可找回，失败保留重试；相同API/action身份不引起反复加载。生产无房间禁启动，不静默创建Demo |
| 空选择 | 可选onClearRoom通知清除旧Run、恢复ID、事件缓冲和页面；末房删除/归档/过滤均回归。initialRoomId只作首次定位，不替代运行权威 |
| Provider 摘要 | 五类mutation结算后统一刷新；设置页提前卸载也刷新，房间成员选择看到最新安全摘要，失败/迟到读取有版本守卫 |
| 历史身份 | Message→Attempt/Turn→冻结membersSnapshot读取姓名、角色、Provider ID、Model ID；旧未知信息显示未记录，当前成员编辑不能覆盖历史 |
| Provider 准入 | 统一schedule在任何状态修改前复验冻结Provider/model仍有效且显式Mock，覆盖新建、重试、续写与恢复。真实/禁用/失效配置不会交单例Mock继续执行；仅旧Demo null+mock兼容 |
| 桌面布局 | 统一系统/浅/深主题，保留两feature自有功能结构，以公共tokens协调；去1080px页面最小宽，窗口最小800×600，窄窗显式展开主持人控制；无无关UI重构 |

Database.ts、配置Schema、已发布migration1/2/3、package.json/lock/workspace、electron-vite配置、生产CSP文件均与main逐字节相同。无Schema升级、无历史数据改写、无付费网络接线。

旧测试仅按新API装配、异步屏障完成条件和真实配置流程适配；保留其原行为/安全断言。未知模型测试改为更早拒绝且零Run/消息/Attempt/活动锁，安全要求更严格，没有skip、删测试或放宽安全断言。

## 3. 本轮实际验证

| 检查 | 命令标签 / 实际结果 |
| --- | --- |
| 联合引入后原始基线 | baseline-full：56文件752测试，exit0；typecheck exit0，不能替代最终结果 |
| 最终完整Node回归 | joint-full-final-03：`pnpm test --reporter=dot`（受控pretest源码编译），61文件 **846/846**，exit0 |
| 最终R07/R08 + Preload专项 | joint-special-node-final-02：23文件 **292/292**，exit0；Room/成员/历史、settings/Key、共享配置/migration3、联合IPC/选择/Provider准入 |
| TypeScript strict | joint-typecheck-final-02及修复后bridge-error-typecheck-04均exit0；最后joint-build-final-02内再次执行tsc --noEmit exit0 |
| 生产构建 | joint-build-final-02：Main / bundled CJS Preload / Renderer全部生成，exit0；构建不是桌面验证替代 |
| Node 原生 | 官方24.18.1/同版darwin-arm64 include/config源码编译，实际ABI137读写；5独立进程各300,000次prepare/get/分配/关闭与自然退出均exit0 |
| Electron 原生 | 最终38.8.6严格配对headers源码重建exit0；实际Electron38.8.6、内嵌Node22.22.0、ABI139/arm64内存读写exit0；本轮另有300,000次压力exit0 |
| 最终Electron专项 | joint-special-electron-final-02：29文件 **393/393**，exit0；SQLite/迁移/恢复/Key/配置/真实服务IPC/契约，独立临时DB |
| 最强隔离生产首次 | production-ui-first-isolated-06：实际built Main/CJS Preload/App，exit0 |
| 首次退出数据 | production-first-exit-audit-07：本次profile只读SQLite审计exit0 |
| 同profile重启 | production-ui-restart-isolated-08：真实新Electron进程，配置/旧Run/假Key归属恢复，exit0 |
| 重启退出数据 | production-restart-exit-audit-09：同profile再次只读审计exit0 |
| 既有联合桌面回归 | legacy-joint-ui-final-01 / legacy-joint-exit-final-02：真实暂停/刷新/单步/继续/停止/重试/续写、持久输入及退出屏障，均exit0 |
| 旧v1升级与启动恢复 | legacy-recovery-ui-final-03 / legacy-recovery-exit-final-04：9旧Run、4非终态转interrupted、终态/idle不误改，旧部分文本/未知输入保留、v1验证备份，均exit0 |
| 依赖与隔离 | 冻结离线安装exit0（646 reused/0 downloaded）；锁字节一致，32直接依赖盘点exit0，最终inode隔离审计exit0 |

最终测试实际执行于本轮未提交接线工作树，随后代码提交固定了该版本；之后只修改测试探针隔离/几何取证及治理文档，生产源码没有再次变化。各原始JSON保留代码摘要、输入/runner/命令文件哈希和前后版本，台账区分中间失败与最终结果；不是用模块报告代替本次执行。

## 4. 真实生产功能操作及数据证据

最强隔离profile：`/private/tmp/roundtable-r78-joint-i6xqf65e/test-tmp/roundtable-r78-production-mYXEIq`。两次真实启动均在ready前分离userData/sessionData/logs、启用并断言Chromium use-mock-keychain；safeStorage的5个原方法全部替换为fake并核验。阻断Node http/https/net/tls/fetch及Chromium网络，实际尝试数组、Renderer consoleError和PreloadError均为空。没有导入真实Provider网络Adapter或访问用户数据；fake后端的XOR仅测试fixture，不是生产密码学实现。

| 用户要求的真实操作 | 本次观察 |
| --- | --- |
| 打开房间与设置 | 实际应用导航、两个feature、表单与错误区可达 |
| Provider和Model配置 | 通过设置UI保存1个显式Mock与2个真实类型配置、默认/自定义fixture模型；修改请求目标；返回房间时Provider安全摘要已刷新。真实鉴权显示尚未接入，不伪报成功 |
| 配置自定义三Agent | 通过UI建房与3成员，独立姓名/角色/system prompt，选择显式Mock配置实例及mock模型；编辑成员姓名/角色，重启仍保留 |
| 公共协作与投影 | 实际UI启动自定义三Agent；暂停、刷新保留paused快照、下一步至2回合、继续至3回合completed；三个独立请求身份和消息完整持久化 |
| 公共输入证据 | 退出只读SQLite的Attempt.input_snapshot确认B包含A公共输出，C按序含A和B；与数据库消息身份关联，不靠三个气泡判断协作 |
| 控制与部分输出 | 实际Stop、显式retry和continue后再Stop；原消息/Attempt不改，新request/message ID不同，数据库输入确认retry复用原输入、continue追加已保存部分文本 |
| 切房与旧Run | 切到另一房清旧Run/消息；旧Run历史打开时仍是冻结姓名/角色/provider/model，当前成员改名未覆盖；刷新/重启不重复发请求 |
| 保护与空选择 | UI删除有历史成员/房间被明确拒绝；归档后切剩余房；删除最后可见房清空旧Run与启动；归档过滤也清空；房间/成员可恢复 |
| 假Key | UI保存、更换、删除、请求目标更改撤销、重新保存；跨Provider注入引用严格拒绝，另一Provider仍missing。普通DTO/历史/localStorage无明文，输入保存后清空 |
| 重启与退出 | 同profile新进程找回配置、旧Run、编辑后的成员；fake加解密证明持久化Key属于原Provider。两次只读审计integrity_check=ok、foreign_key_check为空、migration ledger1/2/3，9类数据表无唯一fake明文 |
| 主题与窄窗 | 首次/重启各24项（4窗口×2主题×3页）几何/主题检查；800实际展开/折叠主持人控制、房间/成员modal保存取消可滚动到达、设置长页Key/按钮可达。两张实际渲染截图另做视觉检查，不拿截图替操作 |

实际窗口外框800×600、1024×768、1280×800可用。请求1600×1000被本机workArea限制为首次1600×870、重启1600×868；两次各24检查中包含这个**受限实际尺寸**，完整1000高度未验证。未把物理限制改写成产品1600×1000 PASS。

假Key初次fake encrypt=4/decrypt=11，重启encrypt=0/decrypt=3；最终只有1条fake密文，所属Provider与当前KeyReference一致，另Provider引用为空。没有把fake持久化成功写成真实OS Keychain加密验收。

## 5. 失败、诊断与修复记录

| 实际失败 | 原因与处理 |
| --- | --- |
| source-verify / source-verify-fixed / pnpm-archive-diagnostic | 临时校验脚本SyntaxError，及把pnpm整个安装树与archive当完全一致导致辅助诊断失败。修脚本；官方tarball完整性及4个核心执行文件逐字节确认，whole-tree差异如实保留，不升级包。copy导入与最终实际安装/运行另证 |
| baseline-isolation-audit | pnpm .modules.yaml实际是JSON，临时诊断用YAML regex失败；改为实际格式解析后通过，不改产品 |
| IPC RED / ipc-typecheck-06 | 原来无rooms/settings注册与全Bridge、缺drain/来源再检查；按RED补实现。typecheck当时Main/Renderer尚未装配，最终strict/build通过 |
| Renderer RED与green-selection-1 | 实际缺空选择/初始恢复/摘要结算刷新；补最小接线。第一轮GREEN另有API Key标签歧义selector，收窄真实输入并正确await act；不改安全行为 |
| main-lifecycle-red-01 / green-02 | 先证明服务未装配、关库未等配置。实现后旧测试只等固定microtask数，改为等待真实关闭条件且保留原断言；最终29项通过 |
| admission-red-01 | 6项复现旧Run retry/continue/recover可绕过已变真实/禁用Provider；统一schedule前门禁后8新回归及完整回归通过，历史不改 |
| window-minimum-red-01 | 旧1080px工厂限制真实窄窗；最小尺寸800×600，全部导航/安全选项断言保留 |
| joint-full-01 | 未知冻结模型被更早拒绝，旧测试还期待先建Run再error；改为验证拒绝且零Run/消息/Attempt/锁，未降低安全要求 |
| production-ui-first-01 | checkbox标签尾文本未被探针selector识别；修探针，不改业务 |
| production-ui-first-02 / rejection-diagnostic-03 | **真实产品跨桥错误缺陷**：ContractError被contextBridge转换后仅message/stack。最小真Electron实验证明plain DTO可保留错误字段；先6个RED，再修Preload统一抛安全DTO；严格111安全回归及完整846、实际保护错误UI通过 |
| production-ui-first-fixed-04 | 1600×1000被macOS限制为870高度；探针按实际workArea精确校验并保留requested/actual，不放宽安全断言 |
| first-final-05 | 中间完整功能PASS，但尚未加Chromium mock-keychain，只作中间证据；新增隔离后全新profile first06和同profilerestart08重跑通过 |
| 自动审批中断 | 文档写入审批服务因用量限制无法完成，操作未执行；没有绕过审查。用户继续后同一授权操作正常批准，已恢复，无剩余审批阻塞 |

Zod/Rollup两类注释位置提示、macOS sandbox_extension_issue_file_to_process stderr及Git自动committer提示保留；没有把非零退出当PASS，实际Renderer错误数组为空且所有最终进程正常退出0。不为消除提示升级依赖、改系统Node或重写历史。

## 6. 文件清单、归属与审查

下表列出相对基线的实际变更文件及来源。模块文件只在各自原提交引入；总控在集成WT独占共享契约/Schema登记、Main/IPC/Preload、App/状态协调、公共样式、Run最小准入、公共回归/probes和治理。没有同时写原模块WT，没有第二份数据库或共享node_modules。

| 文件 | 来源 / 本轮负责人 |
| --- | --- |
| `docs/CONTRACTS.md` | 总控联合 |
| `docs/DECISIONS.md` | 总控联合 |
| `docs/ENVIRONMENT.md` | 总控联合 |
| `docs/R07_R08_SHARED.md` | 总控联合 |
| `docs/STATUS.md` | 总控联合 |
| `docs/VALIDATION.md` | 总控联合 |
| `docs/verification/2026-10-17-r07-r08-commands.md` | 总控联合 |
| `docs/verification/2026-10-17-r07-r08-integration.md` | 总控联合 |
| `src/main/index.ts` | 总控联合 |
| `src/main/ipc/registerIpc.ts` | 总控联合 |
| `src/main/room/HANDOFF.md` | R07引入 |
| `src/main/room/PLAN.md` | R07引入 |
| `src/main/room/RoomService.ts` | R07引入 |
| `src/main/room/VERIFICATION.md` | R07引入 |
| `src/main/security/KeyService.ts` | R08引入 |
| `src/main/security/electronSafeStorage.ts` | R08引入 |
| `src/main/services/RunService.ts` | 总控联合 |
| `src/main/settings/ProviderSettingsService.ts` | R08引入 |
| `src/main/settings/README.md` | R08引入 |
| `src/main/settings/index.ts` | R08引入 |
| `src/main/windows/createMainWindow.ts` | 总控联合 |
| `src/preload/index.ts` | 总控联合 |
| `src/renderer/App.tsx` | 总控联合 |
| `src/renderer/features/rooms/HistoryPanel.tsx` | R07引入 |
| `src/renderer/features/rooms/MembersPanel.tsx` | R07引入 |
| `src/renderer/features/rooms/RoomsFeature.tsx` | R07引入；总控联合 |
| `src/renderer/features/rooms/index.ts` | R07引入 |
| `src/renderer/features/rooms/rooms.css` | R07引入 |
| `src/renderer/features/rooms/ui.tsx` | R07引入 |
| `src/renderer/features/settings/SettingsFeature.tsx` | R08引入 |
| `src/renderer/features/settings/index.ts` | R08引入 |
| `src/renderer/features/settings/settings.css` | R08引入 |
| `src/renderer/styles.css` | 总控联合 |
| `src/renderer/subscriptions/rendererSession.ts` | 总控联合 |
| `src/shared/contracts/app.ts` | 总控联合 |
| `src/shared/contracts/configuration.ts` | 总控联合 |
| `src/shared/contracts/ipc.ts` | 总控联合 |
| `tasks/R07-rooms-agents-history.md` | 总控联合 |
| `tasks/R08-key-provider-settings.md` | 总控联合 |
| `tests/integration/joint/fixtures.ts` | 总控联合 |
| `tests/integration/joint/publicContext.test.ts` | 总控联合 |
| `tests/integration/joint/recovery.test.tsx` | 总控联合 |
| `tests/integration/joint/renderer.test.tsx` | 总控联合 |
| `tests/integration/r07r08/ipcConfiguration.test.ts` | 总控联合 |
| `tests/integration/r07r08/providerAdmission.test.ts` | 总控联合 |
| `tests/integration/r07r08/rendererSelection.test.tsx` | 总控联合 |
| `tests/integration/rooms/featureIntegration.test.tsx` | R07引入 |
| `tests/integration/rooms/rooms.test.ts` | R07引入 |
| `tests/integration/settings/providerSettings.test.ts` | R08引入 |
| `tests/integration/settings/settingsFeature.test.tsx` | R08引入 |
| `tests/probes/joint-ui.cjs` | 总控联合 |
| `tests/probes/r01-electron.cjs` | 总控联合 |
| `tests/probes/r07r08-electron.cjs` | 总控联合 |
| `tests/probes/r07r08-sqlite.cjs` | 总控联合 |
| `tests/probes/r07r08-ui.cjs` | 总控联合 |
| `tests/unit/appLifecycle.test.ts` | 总控联合 |
| `tests/unit/contracts/configurationIpc.test.ts` | 总控联合 |
| `tests/unit/contracts/ipc.test.ts` | 总控联合 |
| `tests/unit/contracts/preload.test.ts` | 总控联合 |
| `tests/unit/lifecycle/ipcSource.test.ts` | 总控联合 |
| `tests/unit/lifecycle/windowSecurity.test.ts` | 总控联合 |
| `tests/unit/rendererRooms/RoomsFeature.test.tsx` | R07引入 |
| `tests/unit/rendererRooms/dialogErrors.test.tsx` | R07引入 |
| `tests/unit/rendererRooms/edgeCases.test.tsx` | R07引入 |
| `tests/unit/rendererRooms/emptySelection.test.tsx` | 总控联合 |
| `tests/unit/rendererRooms/fixtures.ts` | R07引入 |
| `tests/unit/rendererRooms/roomLifecycle.test.tsx` | R07引入 |
| `tests/unit/rendererSettings/SettingsFeature.test.tsx` | R08引入 |
| `tests/unit/rendererSubscriptions/fixtures.ts` | 总控联合 |
| `tests/unit/rendererSubscriptions/mainProjection.test.ts` | 总控联合 |
| `tests/unit/rendererSync.test.tsx` | 总控联合 |
| `tests/unit/rooms/RoomService.test.ts` | R07引入 |
| `tests/unit/settings/keySecurityBackend.test.ts` | R08引入 |
| `tests/unit/settings/keySecurityLifecycle.test.ts` | R08引入 |

## 7. 遗留边界与最终建议

没有发现本阶段剩余功能/安全/数据阻塞，建议将完整候选交用户最终合 main 审核。只有获得下一次明确授权后，才能合入main并另做主线复验，再标R07/R08及联合集成merged/verified；不以当前review替代主线验收。

- 真实网络Adapter、真实鉴权/付费调用、系统Keychain实际加密与权限未验证；R09/R10需统一替换当前显式Mock resolver准入，不能静默回退或仅删除门禁。
- 正式桌面E2E、Windows/Linux、DMG/NSIS/AppImage、ASAR/发布包、安装升级、签名/公证、公开GitHub与R17授权/第三方许可审查均未实施。本轮没有lint命令或CI，不能声称其通过。
- 完整1600×1000实际高度受本机显示区域限制未验证。可达性脚本及视觉核对不是键盘/读屏/多DPI/所有窗口边界的完整可用性审计；成员启停排序与Provider删除等有自动化模块/IPC覆盖，桌面烟测未穷举每种组合。
- 配置写入后端若永久不结算，退出drain仍会等待，以防关库后写入；本轮验证正常结算/失败/来源撤销，不宣称覆盖任意永久卡死的OS后端。
- Node24.21.0上游ObjectWrap异常保留，受控24.18.1 runtime/headers/arm64与Electron ABI139严格分离；当前不是全局Node环境修复。离线冻结安装不等于本轮冷缓存联网安装。
- 内存/临时DB及有限并发/迁移测试不能证明任意大数据量、真实断电或硬件故障持久性；恢复不自动重发收费请求。

R09/R17保持blocked/未授权。所有原分支/Worktree保留，main保持基线与clean。本次交付后停止，等待用户最终合并授权。
