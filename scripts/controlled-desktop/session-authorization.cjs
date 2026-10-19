// Memory-only intent; opening the app or cancelling can never authorize a later request.
function createSessionAuthorization({ priceExpiresAt, approve, revoke, now = Date.now }) {
  let intentUntil = 0, quote, consumed = false, generation = 0;
  const valid = value => value && typeof value.id === 'string' && value.id && typeof value.requestId === 'string' && value.requestId
    && typeof value.providerId === 'string' && value.providerId && typeof value.keyRevision === 'string' && value.keyRevision
    && value.baseUrl === 'https://api.deepseek.com' && value.modelId === 'deepseek-flash' && value.prompt === 'Reply OK.'
    && value.maxOutputTokens === 128 && value.reservedMicroCny === 50000
    && Number.isSafeInteger(value.estimatedMicroCny) && value.estimatedMicroCny >= 0 && value.estimatedMicroCny <= 50000
    && value.priceExpiresAt === priceExpiresAt() && now() < Date.parse(value.priceExpiresAt)
    && now() < Date.parse(value.expiresAt) && Date.parse(value.expiresAt) <= Date.parse(value.priceExpiresAt);
  return {
    request() {
      if (consumed || now() >= Date.parse(priceExpiresAt())) return false;
      generation++; quote = undefined; intentUntil = Math.min(now() + 120000, Date.parse(priceExpiresAt()));
      return true;
    },
    capture(value) { if (!consumed && now() < intentUntil && valid(value)) quote = structuredClone(value); },
    cancel() { generation++; intentUntil = 0; quote = undefined; revoke(); },
    async confirm(options, show) {
      const selected = quote, current = generation;
      quote = undefined;
      if (consumed || now() >= intentUntil || !valid(selected)) {
        intentUntil = 0; revoke();
        await show({ ...options, buttons:['取消'], defaultId:0, cancelId:0,
          detail:'本会话尚未准备指定 Provider 的单次许可，请使用“准备本会话单次许可…”；当前不能发送。\n\n' + options.detail });
        return { response:0 };
      }
      consumed = true; intentUntil = 0;
      const stillValid = () => generation === current && valid(selected);
      try {
        const permission = await show({ type:'warning', title:'准备本会话单次发送许可',
          message:'仅允许进入这一个请求的最终人工确认',
          detail:`Provider：${selected.providerId}\n目标：https://api.deepseek.com/chat/completions\n模型：deepseek-flash；提示词：Reply OK.；单 Agent；max_tokens=128。\n客户端预留 ¥0.05，并非服务商账单的绝对上限。\n取消、停止、关窗、超时或重启后许可失效；禁止自动重试。`,
          buttons:['取消','仅准备这一次许可'], defaultId:0, cancelId:0, noLink:true });
        if (permission.response !== 1 || !stillValid()) { revoke(); return { response:0 }; }
        const final = await show(options);
        if (final.response !== 1 || !stillValid() || !approve(selected)) { revoke(); return { response:0 }; }
        return final;
      } catch { revoke(); return { response:0 }; }
    },
  };
}
module.exports = { createSessionAuthorization };
