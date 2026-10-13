export const statusLabels: Record<string, string> = {
  idle: '待开始', running: '运行中', pausing: '正在暂停', paused: '已暂停',
  cancelling: '正在停止', cancelled: '已停止', completed: '已完成',
  error: '运行失败', interrupted: '已中断', streaming: '生成中',
  failed: '生成失败', aborted: '已中止',
};
