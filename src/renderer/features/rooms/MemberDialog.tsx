import { useState, type FormEvent } from 'react';
import { Check, CircleAlert, FlaskConical } from 'lucide-react';
import type { AgentConfiguration, CreateAgentInput, ProviderReadiness, ProviderSummary } from '../../../shared/contracts/configuration';
import { createAgentInputSchema } from '../../../shared/schemas/configuration';
import { Button, Choice, Field, Modal } from '../../components/ui';
import { modelBlockText } from '../settings/model';
import { defaultModelFor, roleTemplates, roomErrorText } from './templates';

const SEPARATOR = '\u0000';
type Option = { value: string; providerId: string; modelId: string; label: string; usable?: boolean; reason: string; mock: boolean };
/** Every configured model of every usable service, labelled with why it cannot take part when it cannot. */
export function modelOptions(providers: readonly ProviderSummary[], readiness: readonly ProviderReadiness[] | undefined): Option[] {
  return providers.filter(provider => provider.enabled && provider.configurationValid && provider.kind !== null).flatMap(provider => {
    const ids = provider.kind === 'mock' ? ['mock'] : [...new Set([provider.defaultModelId, ...provider.customModels.map(model => model.id)].filter((id): id is string => Boolean(id)))];
    const row = readiness?.find(item => item.providerId === provider.id);
    return ids.map(modelId => {
      const state = row?.models.find(model => model.modelId === modelId);
      const name = provider.kind === 'mock' ? '演示' : provider.customModels.find(model => model.id === modelId)?.name ?? modelId;
      return { value: `${provider.id}${SEPARATOR}${modelId}`, providerId: provider.id, modelId, mock: provider.kind === 'mock',
        label: provider.kind === 'mock' ? `${provider.name}（不联网）` : `${provider.name} · ${name}（${modelId}）`, usable: state?.usable, reason: modelBlockText(state) };
    });
  });
}

export type MemberDialogProps = {
  agent?: AgentConfiguration; roomId: string; order: number; providers: readonly ProviderSummary[]; readiness: readonly ProviderReadiness[] | undefined;
  onSave: (input: CreateAgentInput) => Promise<void>; onClose: () => void; onOpenSettings: () => void;
};

/** 添加 / 编辑成员: a role template fills name, role and 设定 (D5-A); the difference between name and role is written out. */
export function MemberDialog({ agent, roomId, order, providers, readiness, onSave, onClose, onOpenSettings }: MemberDialogProps) {
  const fallback = agent ? undefined : defaultModelFor(providers, readiness);
  const [template, setTemplate] = useState(agent ? '' : 'drafter');
  const [name, setName] = useState(agent?.displayName ?? roleTemplates[0].name);
  const [role, setRole] = useState(agent?.roleTemplateId ?? roleTemplates[0].role);
  const [prompt, setPrompt] = useState(agent?.systemPrompt ?? roleTemplates[0].prompt);
  const [model, setModel] = useState(agent?.providerId && agent.modelId ? `${agent.providerId}${SEPARATOR}${agent.modelId}` : fallback ? `${fallback.providerId}${SEPARATOR}${fallback.modelId}` : '');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const options = modelOptions(providers, readiness);
  const selected = options.find(option => option.value === model);
  const stale = model !== '' && !selected;

  function choose(id: string) {
    const next = roleTemplates.find(item => item.id === id)!;
    setTemplate(id); setName(next.name); setRole(next.role); setPrompt(next.prompt); setError('');
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const [providerId, modelId] = model ? model.split(SEPARATOR) : [null, null];
    const parsed = createAgentInputSchema.safeParse({ roomId, displayName: name, roleTemplateId: role, systemPrompt: prompt, providerId, modelId, enabled: agent?.enabled ?? true, displayOrder: agent?.displayOrder ?? order });
    if (!parsed.success) { setError(!name.trim() ? '请填写名字。' : !role.trim() ? '请填写角色，例如“审查”。' : '有一项填写不对，请检查。'); return; }
    setBusy(true); setError('');
    try { await onSave(parsed.data); }
    catch (cause) { setError(roomErrorText(cause)); setBusy(false); }
  }

  const footer = <><Button disabled={busy} onClick={onClose}>取消</Button><Button variant="primary" type="submit" form="member-form" disabled={busy}>{busy ? '正在保存…' : agent ? '保存' : '添加'}</Button></>;
  return <Modal wide title={agent ? `编辑「${agent.displayName}」` : '添加成员'} description={agent ? '改动只影响之后开始的讨论；已有讨论保留当时的成员设定。' : '先选一个角色，名字和设定会自动填好，都可以再改。'}
    onClose={onClose} busy={busy} footer={footer}>
    <form id="member-form" className="form-stack" onSubmit={event => void submit(event)} noValidate>
      {!agent && <div className="choice-grid" role="group" aria-label="角色模板">{roleTemplates.map(item => <Choice key={item.id} selected={template === item.id} title={item.label} onSelect={() => choose(item.id)}>{item.summary}</Choice>)}</div>}
      <div className="form-grid">
        <Field label="名字" help="显示在讨论里，随你取，比如“老周”或“B”。">{props => <input {...props} className="input" value={name} disabled={busy} onChange={event => setName(event.target.value)} aria-invalid={!name.trim() || undefined} />}</Field>
        <Field label="角色" help="决定 TA 做什么。起草、审查、综合会自动带上内置的发言要求；其他角色按下面的设定发言。">{props => <input {...props} className="input" value={role} disabled={busy} onChange={event => setRole(event.target.value)} aria-invalid={!role.trim() || undefined} />}</Field>
      </div>
      <Field label="设定" optional help="写给这位成员的长期要求，每次发言都会带上。">{props => <textarea {...props} className="textarea" rows={3} value={prompt} disabled={busy} onChange={event => setPrompt(event.target.value)} />}</Field>
      <Field label="模型">{props => <select {...props} className="select input" value={model} disabled={busy} onChange={event => { setModel(event.target.value); setError(''); }}>
        <option value="">暂不选择</option>
        {stale && <option value={model}>原来的选择已不可用（服务已删除或停用）</option>}
        {options.map(option => <option key={option.value} value={option.value}>{option.label}{option.reason ? ` — ${option.reason}` : ''}</option>)}
      </select>}</Field>
      <p className="model-state" role="status">{selected?.mock ? <span className="status-text muted"><FlaskConical aria-hidden />演示成员不联网，回复是预先写好的示例，不代表真实模型的水平。</span>
        : selected?.usable ? <span className="status-text ok-text"><Check aria-hidden />可以使用：Key 已保存。</span>
          : selected ? <span className="status-text warn-text"><CircleAlert aria-hidden />暂时不能参与讨论：{selected.reason || '状态未知'}。<button type="button" className="link-btn" onClick={onOpenSettings}>去设置</button></span>
            : <span className="status-text warn-text"><CircleAlert aria-hidden />{agent?.withheldModelId ? '之前填的模型名像 API Key，已隐藏且不会使用；请重新选择。' : stale ? '原来选的服务已删除或停用，请重新选择。' : '还没选模型，暂时不会参与讨论。'}
              {options.length === 0 && <> 还没有可用的服务，<button type="button" className="link-btn" onClick={onOpenSettings}>去连接一个</button>。</>}</span>}</p>
      {error && <p className="field-error" role="alert">{error}</p>}
    </form>
  </Modal>;
}
