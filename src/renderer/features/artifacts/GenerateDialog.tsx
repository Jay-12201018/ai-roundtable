import { useEffect, useRef, useState } from 'react';
import type { RunSnapshot } from '../../../shared/types/run';
import { artifactKindLabels, type ArtifactKind, type ArtifactPreview } from '../../../shared/schemas/artifact';
import { Button, Modal } from '../../components/ui';
import type { ArtifactCommands } from './useArtifacts';

export const kindDescriptions: Record<ArtifactKind, string> = {
  prd: '需求和验收标准，每条注明依据的发言',
  minutes: '讨论概要、结论、决策和遗留问题',
  actions: '要做的事、负责人、截止时间和状态；讨论没说清的标为“未知”',
  code: '文件路径和代码，不会执行；采用后可以逐个文件确认，写入你选的文件夹',
};

/** D124: what the model says when the discussion holds nothing of this kind; the request is paid either way. */
const nothingNotes: Partial<Record<ArtifactKind, string>> = {
  code: '讨论里没有涉及代码时，模型会如实说明“没有可整理的内容”，不会硬凑代码；这次请求仍会产生费用。',
  prd: '讨论不是关于产品或功能时，模型会如实说明“没有可整理的内容”，不会硬凑需求；这次请求仍会产生费用。',
  actions: '讨论里没有要做的事时，模型会如实说明“没有可整理的内容”，不会硬凑事项；这次请求仍会产生费用。',
};

const reasonText = (preview: ArtifactPreview): string => {
  switch (preview.reason) {
    case 'busy': return '有请求正在进行（讨论还在进行，或正在生成摘要或产物）。暂停讨论或等它结束后再生成。';
    case 'too_few': return '还没有完成的成员发言，没有可以整理的内容。';
    case 'context_exceeds': return `这场讨论太长：请求约 ${preview.inputTokens} tokens，超过所选成员模型可用的 ${preview.inputBudgetTokens} tokens。可以先为较早的发言生成并确认一份摘要，再生成产物。`;
    case 'unsupported': return '所选成员的模型现在不能发送请求（例如还没确认请求地址，或服务已停用）。请到“设置”处理，或换一位成员。';
    default: return '';
  }
};

/**
 * D120: the host picks who writes it and sees what it is based on; nothing is sent until
 * they press the button. Regenerating keeps the artifact and adds a version.
 */
export function GenerateDialog({ snapshot, kind, artifactId, commands, onClose, onStarted }: { snapshot: RunSnapshot; kind: ArtifactKind; artifactId?: string;
  commands: ArtifactCommands; onClose: () => void; onStarted: (result: { artifactId: string; versionId: string }) => void }) {
  const [agentId, setAgentId] = useState<string>();
  const [preview, setPreview] = useState<ArtifactPreview>();
  const [failed, setFailed] = useState(false);
  const request = useRef(0);
  const { preview: load } = commands;
  useEffect(() => {
    const id = ++request.current;
    load({ kind, ...(agentId ? { agentId } : {}), ...(artifactId ? { artifactId } : {}) })
      .then(result => { if (id === request.current) { setPreview(result); setFailed(false); } })
      .catch(() => { if (id === request.current) setFailed(true); });
  }, [load, kind, agentId, artifactId, snapshot.sequence]);
  const label = artifactKindLabels[kind];
  const heading = artifactId ? `重新生成${label}` : `生成${label}`;
  const busy = commands.pending === 'generate';
  if (failed && !preview) return <Modal title={heading} onClose={onClose} footer={<Button onClick={onClose}>关闭</Button>}><p role="alert" className="field-error">无法读取依据范围，请重试。</p></Modal>;
  if (!preview) return <Modal title={heading} onClose={onClose}><p role="status">正在计算依据范围…</p></Modal>;
  const range = preview.lastNumber ? `这场讨论的第 1–${preview.lastNumber} 条发言` : '这场讨论';
  const mock = preview.agents.find(agent => agent.agentId === preview.agentId)?.modelId === 'mock';
  const generate = async () => {
    if (!preview.available || !preview.agentId) return;
    const result = await commands.generate({ kind, agentId: preview.agentId, ...(artifactId ? { artifactId } : {}) });
    if (result) onStarted({ artifactId: result.artifactId, versionId: result.versionId });
  };
  return <Modal title={heading} onClose={onClose} busy={busy}
    description={`根据${range}整理一份${label}：${kindDescriptions[kind]}。${artifactId ? '会作为新的一版保存，之前的版本都保留。' : ''}`}
    footer={<>
      <Button onClick={onClose} disabled={busy}>取消</Button>
      <Button variant="primary" disabled={!preview.available || busy} onClick={() => void generate()}>
        {busy ? '正在发送…' : mock ? '生成' : '生成（发送 1 次请求）'}</Button>
    </>}>
    <div className="summary-fields">
      <label className="field"><span>由谁来写</span>
        <select className="select" aria-label="生成产物的成员" value={preview.agentId ?? ''} onChange={event => setAgentId(event.target.value)}>
          {preview.agents.map(agent => <option key={agent.agentId} value={agent.agentId}>{agent.name}（{agent.modelId ?? '模型未记录'}）</option>)}
        </select>
        <p className="field-help">默认由综合类角色来写{artifactId ? '（重新生成时沿用上次的成员）' : ''}；请求使用该成员的模型和 Key。{preview.summarizedThrough ? `第 1–${preview.summarizedThrough} 条用已确认的摘要代替原文发送。` : ''}</p>
      </label>
    </div>
    <p className="summary-send">{mock ? '演示成员不联网，不发送真实请求。' : '点生成后向所选成员的服务发送 1 次请求，费用由服务商收取。'}</p>
    {nothingNotes[kind] && <p className="small muted">{nothingNotes[kind]}</p>}
    <p className="small muted">模型按固定格式输出 JSON，应用会逐项检查。检查不通过时原样保留输出、指出问题位置，<b>不会自动重试</b>；由你决定修改还是重新生成。</p>
    {preview.reason && <p role="alert" className="summary-reason">{reasonText(preview)}</p>}
    {commands.error?.key === 'generate' && <p role="alert" className="field-error">{commands.error.message}</p>}
  </Modal>;
}
