# 2026-11-17 发布前优化

用户要求先做优化方案里的发布准备，把项目记忆、项目成果，以及群聊的分工与融合往后排。没有改业务代码，没有推送。

## 升级演练

正式库 `~/Library/Application Support/ai-roundtable/ai-roundtable.db` 当时没有被 AI 圆桌打开。用系统 `sqlite3` 的 `.backup` 把内容复制到 `/tmp/ai-roundtable-rehearse-input/copy.db`（副本本身是版本 1、10 张表），再运行：

```
pnpm rehearse:upgrade /tmp/ai-roundtable-rehearse-input/copy.db
```

结果：通过。v1 → v17。13 场讨论、38 条消息、38 个回合、455 条运行事件，升级前后行数相同。房间 5 → 6、成员 15 → 18，多出的是 migration 17 自己建的常用阵容和它的三位成员。`key_records` 仍是 0。升级备份可以恢复。脚本报告输入文件没有变化。

`.backup` 打开正式库时，旁边出现了 0 字节的 `-wal` 和 32 KB 的 `-shm`。确认没有进程占用后已删除。正式库主文件的 SHA-256 在备份前、备份后、演练后都是 `7cc10013ee27e9b1b1421f02b14633c904a5d86e23a3039bd28535eaf0dd8d2b`，与 2026-11-05 恢复后的记录相同。临时副本和演练目录已删除。正式库没有升级，自用安装仍要另得同意。

## 公开前扫描

只读检查 Git 跟踪文件和全部历史里新增过的路径。没有跟踪或在历史中出现过 `.env`、数据库、`.pem`、`.key`、`.p12` 或 `credentials.json`。没有私钥块。

`sk-` 形态的字符串有 4 处，都在测试里，是用来验证「像 Key 的模型 ID 必须拒绝」的假值：`tests/unit/configuration/modelIdGuard.test.ts`、`tests/probes/premerge-quality-acceptance.cjs`、`tests/integration/providers/upstreamError.test.ts`。`api_key` 一类赋值有 45 处，15 个文件，全部在 `tests/`。没有把这些值当作真实 Key。

这次没有扫描用户的「应用程序支持」目录，也没有打开钥匙串。仓库没有远程，没有推送。
