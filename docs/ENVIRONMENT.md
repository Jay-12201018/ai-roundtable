# 原生模块与干净安装环境治理

2026-10-14，R02 集成审核建立。当前 R02 已按用户批准合入 main，并在严格配对的官方 Node 24.18.1 环境通过[本次主线验收](verification/2026-10-14-r02-main.md)；ENV-R02-INSTALL-01 保持已解决。以下各阶段证据按历史保留，不把 R02 验收外推为 V1/发布验收；不升级项目依赖、不修改全局 Node。

## 原则与本轮发现

Node runtime 版本、同版 headers、CPU/平台构建配置、better-sqlite3 版本和目标 ABI 必须同时记录；ABI 相同不能替代运行验证。开发 Node 原生文件与 Electron 原生文件不能混用，各 Worktree 也不共享可变 node_modules。

本轮从 nodejs.org 官方 HTTPS 下载 runtime/headers 及 SHASUMS256.txt，对每个 archive 验 SHA-256。runtime include/node 的 node_version.h/node_object_wrap.h 与同版 headers archive 字节一致。generic headers config.gypi 与 darwin-arm64 runtime config.gypi 存在平台/CPU/compiler 配置差异，是平台配置而非版本 mismatch；不可盲目要求全部 gypi 字节相同，也不能忽略平台 flags。后续优先使用完整对应 darwin runtime 的 include/config。

独立最小 C++ ObjectWrap addon，不导入 SQLite/Zod/Vitest/R02，在自然分配 GC 30 万对象下：

| runtime + headers | ABI | 本轮5次退出结果 |
| --- | --- | --- |
| 官方24.21.0 + 官方24.21.0 darwin-arm64 include | 137 | 5/5 SIGABRT，RemoveEnvironmentCleanupHook env=null断言 |
| 官方24.18.1 + 官方24.18.1 darwin-arm64 include | 137 | 5/5 exit0 |

这独立复现与 [Node #65446](https://github.com/nodejs/node/issues/65446) 相符，说明相应崩溃不需要R02业务逻辑。它不证明项目SQLite、干净安装或Electron打包已经稳定；24.18.1已在本轮严格配对环境中通过项目原生重编译、SQLite压力和完整测试，不把旧runtime+新/旧headers混合当常规方案。

## 官方archive校验记录

| 文件 | SHA-256 |
| --- | --- |
| node-v24.21.0-darwin-arm64.tar.gz | bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057 |
| node-v24.21.0-headers.tar.gz | 57c6bee2e30bbbee5bd51d6cc343eb992e174b56a2a1d0eab7a7510771c20ea2 |
| node-v24.18.1-darwin-arm64.tar.gz | eb02f7fab96d3d67de40c5ec8566096fcb4c2026728787683ae5a97eb612b941 |
| node-v24.18.1-headers.tar.gz | bee7344a7fc6e3252c4822ca916a50cd6ddda9bb39374d6140a8046d9238fded |

仅下载到本任务临时目录 `/private/tmp/roundtable-r02-integration-b0c3ktgt`。原 Node、全局配置、main和原子项目依赖未改；未来重新下载仍须重新验官方清单，不依赖临时目录永久存在。

## 上一轮受控项目验证（已有独立依赖的历史证据）

使用完整官方24.18.1 darwin-arm64 runtime 的 include/config，而非另版头文件。pnpm11.25.0，node-gyp12.3.0，Python3.14.5，Apple clang21.0.0；SQLite12.11.1与Electron38.8.6沿用锁文件。实际build/config.gypi为arm64、ABI137；node-gyp日志确认node_root_dir和common.gypi均来自同版完整runtime。

- `npm_config_nodedir=<对应完整runtime> npm_config_build_from_source=true pnpm run native:node`：exit0。
- 裸SQLite `:memory:` 30万prepare/get/自然分配GC，重复5次：每次exit0，验证最终进程退出。
- 默认Vitest pool，完整契约94/94、全单元/集成228/228，类型和生产构建：exit0。没有skip或放宽安全断言。
- `pnpm run native:electron`强制重建本Worktree；随后Electron38.8.6实际加载SQLite、内存读写：exit0，ABI139。
- 实际生产Main/CJS Preload/Renderer/Mock IPC探针：exit0；userData/sessionData在ready前隔离、网络阻断，sandbox/contextIsolation=true、NodeIntegration=false。退出后只读临时SQLite核对paused转cancelled、历史输出/身份保留、Key/Provider为空：exit0。

这些证据确认本机现有独立依赖在受控环境下工作，不能将其外推默认Node24.21.0或干净安装/跨平台/发布稳定性。普通`pnpm test`的pretest会按当前PATH重建SQLite，未经控制的24.21头文件可能重新引入崩溃。

## ENV-R02-INSTALL-01：已解决（环境专项阶段记录）

本节取代上一轮未明停滞结论，原失败命令及原生ObjectWrap证据保留。完整命令、退出码和干净依赖复验见[环境修复报告](verification/2026-10-14-r02-environment.md)。

### 已证实的原因及最小修复

总控上一轮临时安装命令使用 `--config.fetch-timeout=60000`；pnpm11.25.0的通用 `--config.*` 路径不应用数值Schema，得到字符串。pnpm在异步retry callback的try外调用AbortSignal.timeout，字符串触发ERR_INVALID_ARG_TYPE，callback Promise未被retry处理，外层fetch悬挂。未处理拒绝仅在退出时打印，空闲worker MessagePort使进程持续存活。因此0 downloaded并非这次网络/SQLite store故障的证明，错误参数由总控引入。

移除这些临时raw数值参数、采用默认数字60000即可；若需要自定义，使用正式 `--fetch-timeout=60000 --fetch-retries=1`。已独立验证正式参数为number、raw参数为string，两次全新store/cache的冻结安装实际exit0（22.79/37.01秒）。未关闭年龄/完整性策略或安装脚本，未升级依赖、改package/lock或全局Node。

### 后续Worktree的受控环境规则

- 本机受控Node为官方24.18.1/darwin-arm64、ABI137；源码重编译使用同一个完整runtime的include/config。Node24.21.0的已确认ObjectWrap异常仍保留，不作为支持环境，不混用跨补丁头文件。
- pnpm11.25.0与当前lockfileVersion9.0通过本轮冻结安装。已安装pnpm入口、主bundle、worker、package.json与官方同版tarball逐字节一致。默认Codex fallback/pnpm硬编码自己的Node，不能只看PATH中的node版本；须显式调用受控Node+该pnpm入口，递归pnpm脚本也用仅指向这两个已核验路径的临时shim。不要引入额外raw数字/布尔配置覆盖。
- 官方24.18.1发行包还含Corepack0.35.0/npm11.16.0，本轮仅读取版本，没有enable/prepare或全局安装；实际安装直接使用已核验pnpm11.25.0。默认shell未找到Corepack与受控发行包包含Corepack是不同事实。
- 每个Worktree独立node_modules/store/cache/userData；干净验证起点仅原package.json、pnpm-lock.yaml、pnpm-workspace.yaml，禁止复制node_modules。Node源码编译和Electron38.8.6/ABI139必须分别执行、实际加载后记录，不能以build或ABI号单独替代。
- 网络访问需获运行环境许可；本轮沙箱DNS失败与提权后成功分别记录。未改变宿主代理、DNS或TLS；抽查6个实际tarball经curl/https.get/内建fetch均全量HTTP200且SHA512匹配，完整安装也成功。
- 每个安装/检查有外部进程上限，默认下载timeout60000或正式数值选项；禁止无限重试或扩大并发掩盖故障。诊断内存hook只用于取证，正式复验不注入代码。

可复用安装形式（参数中的路径由各Worktree准备，不依赖本轮临时目录长期存在）：

```sh
# R02_NODE_DIST：已验SHA的完整官方24.18.1 darwin-arm64目录。
# R02_PNPM_CLI：已核验pnpm11.25.0的bin/pnpm.mjs。
# R02_VALIDATION_ROOT：该Worktree独有验证根目录。
# PATH最前的临时pnpm shim仅exec上述Node和pnpm入口，确保嵌套脚本一致。
"$R02_NODE_DIST/bin/node" "$R02_PNPM_CLI" --version
npm_config_nodedir="$R02_NODE_DIST" npm_config_build_from_source=true \
  "$R02_NODE_DIST/bin/node" "$R02_PNPM_CLI" \
  --config.store-dir="$R02_VALIDATION_ROOT/store" \
  --config.cache-dir="$R02_VALIDATION_ROOT/cache" \
  --config.state-dir="$R02_VALIDATION_ROOT/state" \
  install --frozen-lockfile --fetch-timeout=60000 --fetch-retries=1
```

外部timeout监督不可省略；本轮安装上限300秒，正常完成并非等到上限。详细原生、全回归、构建、Electron及目录包顺序在报告中。Electron源码编译不带Node的npm_config_nodedir，使用对应38.8.6 headers；本轮其构建config与实际运行均ABI139/arm64。

第二次干净安装产生的依赖通过94项契约、228项完整回归、类型、生产构建、SQLite压力5/5、Electron源码编译/ABI/隔离Bridge/退出数据核对、macOS arm64目录包及最终签名后包内SQLite/ASAR路径。ENV阻塞关闭，建议R02进入最终合并审核；未合main、未标R02 verified，不启动R03。跨平台、正式E2E、安装升级、发布签名/公证及真实Provider/Key仍未验证。

## R02 合并后环境确认（2026-10-14）

main 合并 `6aff174e6cf397eb49b9b4ceadb3387f207b84a6` 后，本次重新执行 Node 24.18.1/同版 darwin-arm64 include/config 的源码编译、内存 SQL、30 万次 prepare/get 压力五次、94 项契约、228 项完整回归、类型和生产构建，随后以 Electron 38.8.6 headers 源码重建，实际 ABI139/隔离生产 Bridge/正常退出数据检查均 exit0。主线已安装锁文件与仓库逐字节相同，32 个直接依赖的实际版本匹配锁文件。main、原 R02、集成 R02、环境专项依赖的 SQLite 原生文件 inode 各不相同，没有共享可变依赖。

本次命令没有再带 raw 数值覆盖，没有重新安装依赖或复制旧 node_modules；上一阶段两次全新冻结安装是已审核的历史证据，不能算本次新的安装 PASS。默认 Node 24.21.0 的 ObjectWrap 风险仍未修复；普通未受控 pnpm test 会重编译原生文件，须继续显式控制真实 pnpm runtime 与同版 headers。最终 main 原生文件恢复为 Electron ABI139。

额外 `pnpm list --depth=0 --json` 在受限环境 exit1：pnpm11.25.0 的 inspection/tree-builder 直接读取 `.modules.yaml` 的 storeDir，创建会写入 WAL/建表的 StoreIndex，忽略本次 CLI store 覆盖。trace 证实仍打开原全局 store；独立 immutable URI 只读查询同一索引成功，写打开失败与沙箱限制一致，但未提权执行写打开来直接证明。该辅助清单失败单列保留；以只读 package/锁文件/安装 manifest 逐项核对，不修改全局 store 或项目配置，不把它归因于应用 SQLite/安装停滞，也不声明 list 已通过。完整命令和退出码见[本次报告](verification/2026-10-14-r02-main.md)。

## R03 独立集成环境（2026-10-15）

本次在 `codex/integrate-r03` 使用独立 node_modules、store/cache、测试 TMPDIR 和 Electron userData；实际 Node24.18.1 ABI137/arm64 及同发行包 include/config 重新核验，pnpm11.25.0 的入口/bundle/worker.js/package.json 与官方缓存包一致。未改变系统 Node、package/lock 或真实数据。

从无 node_modules 起点，以独立 inode 的内容缓存与源索引只读备份准备新 store，`pnpm install --frozen-lockfile --offline --package-import-method=copy --side-effects-cache=false --reporter=append-only` 第一次缺 metadata exit1，补齐独立 metadata 缓存后 exit0，646 reused/0 downloaded，安装脚本和源码编译实际执行。独立依赖不等于本轮冷缓存联网安装；没有复制原 node_modules、共享可变 store 或关闭供应链策略。ENV-R02-INSTALL-01 保持已解决，不使用 `--config.fetch-timeout=60000` raw 字符串覆盖。

本次 pnpm list 读取自己的 store，32 直接依赖实际 exit0；这不改写 R02 主线清单命令历史失败。锁文件/安装锁一致，三个 Worktree 原生文件 inode 不同。Node 完整回归后另用 Electron38.8.6 严格对应 headers 重编译 SQLite 并实际加载 ABI139。最终原生文件留在 Electron 目标；后续 Node 测试必须先以受控 Node 同版 headers 执行 native:node/pretest，再恢复 Electron。

逐命令、退出码、source SHA、隔离启动及限制见 [R03 集成报告](verification/2026-10-15-r03-integration.md)。本轮没有重新验证 Node24.21.0 或宣称其上游异常已修复；正式 E2E、跨平台、发布包/安装升级仍未验证。

## R03 合并后 main 环境确认（2026-10-15）

main 合并 `e642b96a8dded195be44749dd6f267798de95198` 后，在 main 自己已安装的独立 node_modules 上重新源码编译 SQLite；官方24.18.1 runtime/headers同版同架构重新核验，Node ABI137内存/压力5次、313全回归、85专项、类型/生产构建均exit0。没有新安装依赖或复制子项目 node_modules，不把历史缓存安装当本次冷安装验证。

本次另建私有cache/gyp/TMPDIR/userData，随后按严格对应的38.8.6 headers源码重编译，实际Electron ABI139加载/85专项/隔离恢复与Bridge/退出数据通过。Node/Electron构建config分别记录正确目标；main、原R03、集成R03原生文件inode不同。最终main原生文件留在Electron ABI139。32个直接依赖版本和安装锁文件只读盘点，锁文件与仓库逐字节相同；未执行可能写全局store的辅助pnpm list，不重写其R02历史失败。

没有再次使用raw数字fetch参数，ENV-R02-INSTALL-01保持已解决；默认Node24.21.0上游异常仍不在支持结论内。本轮诊断警告及正式E2E/发布/跨平台等未验证事项见[主线报告](verification/2026-10-15-r03-main.md)。
