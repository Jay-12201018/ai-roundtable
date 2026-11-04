export const statusLabels: Record<string, string> = {
  idle: '待开始', running: '运行中', pausing: '正在暂停', paused: '已暂停',
  cancelling: '正在停止', cancelled: '已停止', completed: '已完成',
  error: '运行失败', interrupted: '已中断', streaming: '生成中',
  failed: '生成失败', aborted: '已中止',
};

/** A length of time in the fewest plain words: 45 秒, 5 分钟, 2 小时. */
export function durationText(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} 小时` : `${minutes} 分钟`;
}
/** D146: the discussion ran out of the time allowed; nothing is wrong with the network or the service. */
export const durationStopText = (limitMs: number) => `这场讨论达到了时长上限（${durationText(limitMs)}）。`;
export const runStatusLabel = (snapshot: { status: string; durationStop?: unknown }) => snapshot.durationStop ? '已到时长上限' : statusLabels[snapshot.status] ?? '未知状态';
