# 原生模块环境治理与待验证项

2026-10-14，R02 集成审核建立，仅限受控验证环境；不升级项目依赖、不修改全局 Node，不表示此版本已通过项目完整验收。证据见 [集成审核](verification/2026-10-14-r02-integration.md)。

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

## 本轮已完成的受控项目验证

使用完整官方24.18.1 darwin-arm64 runtime 的 include/config，而非另版头文件。pnpm11.25.0，node-gyp12.3.0，Python3.14.5，Apple clang21.0.0；SQLite12.11.1与Electron38.8.6沿用锁文件。实际build/config.gypi为arm64、ABI137；node-gyp日志确认node_root_dir和common.gypi均来自同版完整runtime。

- `npm_config_nodedir=<对应完整runtime> npm_config_build_from_source=true pnpm run native:node`：exit0。
- 裸SQLite `:memory:` 30万prepare/get/自然分配GC，重复5次：每次exit0，验证最终进程退出。
- 默认Vitest pool，完整契约94/94、全单元/集成228/228，类型和生产构建：exit0。没有skip或放宽安全断言。
- `pnpm run native:electron`强制重建本Worktree；随后Electron38.8.6实际加载SQLite、内存读写：exit0，ABI139。
- 实际生产Main/CJS Preload/Renderer/Mock IPC探针：exit0；userData/sessionData在ready前隔离、网络阻断，sandbox/contextIsolation=true、NodeIntegration=false。退出后只读临时SQLite核对paused转cancelled、历史输出/身份保留、Key/Provider为空：exit0。

这些证据确认本机现有独立依赖在受控环境下工作，不能将其外推默认Node24.21.0或干净安装/跨平台/发布稳定性。普通`pnpm test`的pretest会按当前PATH重建SQLite，未经控制的24.21头文件可能重新引入崩溃。

## ENV-R02-INSTALL-01（总控环境待项，不启动其他业务任务）

干净安装使用全新临时目录、未改的package/lock/allowBuilds、独立store/cache；未访问原依赖或用户数据。Node24.18.1默认安装长期停在646 resolved / 0 downloaded，结束的只有经PID/命令核对的本任务进程（exit143）。官方registry的curl HEAD与Node GET均exit0/HTTP200；只读进程诊断发现临时pnpm store SQLite连接、无网络连接，具体停滞原因未定，不能据此断言Node或pnpm缺陷。

追加有界安装实验的最终结果见[本轮记录](verification/2026-10-14-r02-integration.md)：24.21.0仅安装依赖、禁安装脚本；24.18.1采用pnpm已有的PNPM_MAX_WORKERS=1、保留安装脚本。两个追加实验均180秒超时、exit124，依赖下载仍为0。禁用安装脚本的实验只是定位，不能当可运行安装验收；单worker只影响安装，不改变本轮通过的默认Vitest pool。

待办：在可观察且隔离的环境定位pnpm11.25.0新store停滞；固定lock/受控runtime重新完成干净安装→严格配对原生编译→默认全回归→生产构建→Electron ABI/Preload；若检查发布，则另验证目录包、native hook和ASAR路径。先提出有证据的环境固定方案，再决定合main，不擅自升级依赖/全局Node，不启动R03。当前package/lock未修改。

早先原生重编译提权请求曾因自动审批账号额度失败而未执行；后续独立构建审批恢复后，原生请求重新接受并完成上述验证。未绕过审批，也不把第一次未执行计为PASS。R02保持待审核/环境阻塞，不标verified。
