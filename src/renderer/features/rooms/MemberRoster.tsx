import { useEffect, useState } from 'react';
import { CircleAlert, Pencil, Plus } from 'lucide-react';
import type { AgentConfiguration, AgentInput, CreateAgentInput, ProviderReadiness, ProviderSummary, RoomManagementApiContract } from '../../../shared/contracts/configuration';
import { Avatar, Button, IconButton, Switch, Tag, cx } from '../../components/ui';
import { MemberDialog, ModelOptions, modelChoice, modelOptions, modelValue } from './MemberDialog';
import { memberLine } from './RoomPage';
import { agentInput, roleShown, roomErrorText } from './templates';

export type MemberRosterProps = {
  api: Pick<RoomManagementApiContract, 'createAgent' | 'updateAgent'>; roomId: string; members: readonly AgentConfiguration[];
  providers: readonly ProviderSummary[]; readiness: readonly ProviderReadiness[] | undefined; readOnly?: boolean;
  /** A member changed: resolves once the list the page shows has been read again. */
  onChanged: () => Promise<void> | void;
  onOpenSettings: () => void; onConnectMore: () => void;
  /** This list shows the models: a moment a service's list may be looked at again. */
  onShown?: () => void;
};

/**
 * 新讨论 › 参与成员: who takes part and on which model, right above the goal, where that is decided. Saved as it changes; a
 * discussion takes its members when it starts, so this applies to the next one and those after it, not to any before.
 */
export function MemberRoster({ api, roomId, members, providers, readiness, readOnly, onChanged, onOpenSettings, onConnectMore, onShown }: MemberRosterProps) {
  const [saving, setSaving] = useState<Record<string, Partial<AgentInput>>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [editor, setEditor] = useState<AgentConfiguration | 'new'>();
  useEffect(() => { onShown?.(); }, [roomId]);
  useEffect(() => { if (editor) onShown?.(); }, [Boolean(editor)]);
  const options = modelOptions(providers, readiness);
  const realServices = providers.filter(provider => provider.enabled && provider.kind !== null && provider.kind !== 'mock').length;

  async function change(agent: AgentConfiguration, patch: Partial<AgentInput>) {
    setSaving(value => ({ ...value, [agent.id]: patch })); setErrors(({ [agent.id]: _old, ...rest }) => rest);
    try {
      await api.updateAgent({ ...agentInput(agent), ...patch });
      await onChanged();
    } catch (cause) {
      setErrors(value => ({ ...value, [agent.id]: `没有保存，还是原来的选择。${roomErrorText(cause)}` }));
    } finally { setSaving(({ [agent.id]: _done, ...rest }) => rest); }
  }

  return <section className="roster" aria-label="参与成员">
    <h3>参与成员</h3>
    <p className="small muted">每位成员可以用不同的模型。改动对这场和之后的讨论生效，已有讨论不变。</p>
    {members.length === 0 ? <p className="small muted roster-empty">这个房间还没有成员。</p> : <ol className="card roster-list">{members.map(agent => {
      const shown = { ...agent, ...saving[agent.id] } as AgentConfiguration;
      const value = modelValue(shown); const busy = agent.id in saving; const role = roleShown(agent);
      const line = memberLine(shown, providers, readiness);
      return <li key={agent.id} className={cx('roster-row', !shown.enabled && 'is-off')}>
        <Avatar name={agent.displayName} />
        <div className="roster-who"><b>{agent.displayName}</b>{role && <> <Tag>{role}</Tag></>}</div>
        <select className="select input roster-model" aria-label={`${agent.displayName} 的模型`} value={value} disabled={busy || readOnly}
          onChange={event => void change(agent, modelChoice(event.target.value))}>
          <ModelOptions options={options} value={value} />
        </select>
        <Switch label={`${agent.displayName} 参与讨论`} checked={shown.enabled} disabled={busy || readOnly} onChange={enabled => void change(agent, { enabled })} />
        <IconButton size="sm" icon={Pencil} label={`编辑「${agent.displayName}」`} disabled={busy || readOnly} onClick={() => setEditor(agent)} />
        {errors[agent.id] ? <p className="roster-note field-error" role="alert">{errors[agent.id]}</p>
          : !shown.enabled ? <p className="roster-note small muted">已暂停参与</p>
            : line.warn && <p className="roster-note small warn-text"><CircleAlert aria-hidden size={13} className="inline-icon" />{line.text}</p>}
      </li>;
    })}</ol>}
    {!readOnly && <div className="roster-actions"><Button size="sm" icon={Plus} onClick={() => setEditor('new')}>添加成员</Button>
      {realServices <= 1 && <button type="button" className="link-btn small" onClick={onConnectMore}>连接更多模型服务</button>}</div>}
    {editor && <MemberDialog key={editor === 'new' ? 'new' : editor.id} agent={editor === 'new' ? undefined : editor} roomId={roomId}
      order={members.length ? Math.max(...members.map(agent => agent.displayOrder)) + 1 : 0} providers={providers} readiness={readiness} onOpenSettings={onOpenSettings}
      onClose={() => setEditor(undefined)} onSave={async (input: CreateAgentInput) => {
        await (editor === 'new' ? api.createAgent(input) : api.updateAgent({ ...input, id: editor.id }));
        await onChanged();
        setEditor(undefined);
      }} />}
  </section>;
}
