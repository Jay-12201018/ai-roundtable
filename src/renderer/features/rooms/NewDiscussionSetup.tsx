import { useEffect, useState } from 'react';
import { CircleAlert, Minus, Pencil, Plus } from 'lucide-react';
import type { AgentConfiguration, AgentInput, CreateAgentInput, ProviderReadiness, ProviderSummary, RoomManagementApiContract } from '../../../shared/contracts/configuration';
import { Avatar, IconButton, Tag } from '../../components/ui';
import { MAX_PARTICIPANTS, MIN_PARTICIPANTS, isFixedPair, modeSummary, nextDraft, participantsFor, speakersOf, speakingOrder, templates, type WorkflowDraft, type WorkflowTemplate } from '../workflows/model';
import { readRoomCount, writeRoomCount } from '../workflows/storage';
import { MemberDialog, ModelOptions, modelChoice, modelOptions, modelValue } from './MemberDialog';
import { memberLine } from './RoomPage';
import { agentInput, defaultModelFor, nextMemberInput, roleShown, roomErrorText } from './templates';

export type NewDiscussionSetupProps = {
  api: Pick<RoomManagementApiContract, 'createAgent' | 'updateAgent'>; roomId: string;
  /** The room's members, without the archived ones. */
  members: readonly AgentConfiguration[];
  /** The room's remembered discussion mode; none means free discussion with whoever takes part. */
  draft: WorkflowDraft | undefined;
  providers: readonly ProviderSummary[]; readiness: readonly ProviderReadiness[] | undefined; readOnly?: boolean;
  /** Reads the members again; what it resolves with is what the page now shows. */
  reload: () => Promise<readonly AgentConfiguration[]>;
  /** Remembers the mode for this room; false when this profile cannot store it. */
  onDraft: (draft: WorkflowDraft | null) => boolean;
  onOpenSettings: () => void; onConnectMore: () => void; onCustomFlow: () => void;
  /** This page shows models: a moment a service's list may be looked at again. */
  onShown?: () => void;
};

const byOrder = (members: readonly AgentConfiguration[]) => [...members].sort((a, b) => a.displayOrder - b.displayOrder);
const asWorkflowMembers = (members: readonly AgentConfiguration[]) => members.map(member => ({ id: member.id, name: member.displayName, enabled: member.enabled, role: member.roleTemplateId }));

/**
 * 新讨论: how it runs, how many take part, and each one's model, right above the goal. Saved as it changes. A discussion takes
 * its members when it starts, so this applies to the next one and those after it, never to one that already ran.
 */
export function NewDiscussionSetup({ api, roomId, members, draft, providers, readiness, readOnly, reload, onDraft, onOpenSettings, onConnectMore, onCustomFlow, onShown }: NewDiscussionSetupProps) {
  const [changing, setChanging] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState<Record<string, Partial<AgentInput>>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [editor, setEditor] = useState<AgentConfiguration>();
  useEffect(() => { onShown?.(); setError(''); setNotice(''); }, [roomId]);
  useEffect(() => { if (editor) onShown?.(); }, [Boolean(editor)]);

  const ordered = byOrder(members);
  const template: WorkflowTemplate = draft?.template ?? 'free-chat';
  const fixed = isFixedPair(template);
  const shown = speakersOf(draft, ordered);
  const count = shown.length;
  const options = modelOptions(providers, readiness);
  const realServices = providers.filter(provider => provider.enabled && provider.kind !== null && provider.kind !== 'mock').length;
  const disabled = changing || readOnly;

  /** Takes the room to this mode and number of members: only what differs is written, and members who step out keep everything. */
  async function arrange(nextTemplate: WorkflowTemplate, nextCount: number) {
    setChanging(true); setError(''); setNotice('');
    try {
      let current = byOrder(members);
      const wanted = isFixedPair(nextTemplate) ? 2 : nextCount;
      for (let missing = wanted - current.length; missing > 0; missing--) {
        await api.createAgent(nextMemberInput(roomId, current, defaultModelFor(providers, readiness)));
        current = byOrder(await reload());
      }
      const taking = new Set(participantsFor(nextTemplate, asWorkflowMembers(current), wanted));
      for (const agent of current) if (agent.enabled !== taking.has(agent.id)) await api.updateAgent({ ...agentInput(agent), enabled: taking.has(agent.id) });
      const next = byOrder(await reload());
      const plan = nextDraft({ template: nextTemplate, previous: draft, previousMembers: asWorkflowMembers(ordered), members: asWorkflowMembers(next) });
      writeRoomCount(roomId, isFixedPair(nextTemplate) ? readRoomCount(roomId) ?? 3 : wanted);
      if (!onDraft(plan.draft)) setError('这台电脑没能记住讨论方式，这次按默认的自由讨论进行。');
      else if (plan.notice) setNotice(plan.notice);
    } catch (cause) {
      setError(`没有全部改好，下面是现在的样子。${roomErrorText(cause)}`);
      await reload().catch(() => {});
    } finally { setChanging(false); }
  }
  function chooseMode(next: WorkflowTemplate) {
    if (next === template) return;
    if (!fixed) writeRoomCount(roomId, count);
    void arrange(next, isFixedPair(next) ? 2 : fixed ? readRoomCount(roomId) ?? 3 : Math.max(MIN_PARTICIPANTS, count));
  }
  async function change(agent: AgentConfiguration, patch: Partial<AgentInput>) {
    setSaving(value => ({ ...value, [agent.id]: patch })); setErrors(({ [agent.id]: _old, ...rest }) => rest);
    try {
      await api.updateAgent({ ...agentInput(agent), ...patch });
      await reload();
    } catch (cause) {
      setErrors(value => ({ ...value, [agent.id]: `没有保存，还是原来的选择。${roomErrorText(cause)}` }));
    } finally { setSaving(({ [agent.id]: _done, ...rest }) => rest); }
  }

  return <section className="setup" aria-label="这场讨论怎么进行">
    <div className="setup-line"><span className="setup-label" id="setup-mode">讨论方式</span>
      <div className="setup-control">
        <div className="seg setup-seg" role="group" aria-labelledby="setup-mode">{templates.map(item =>
          <button key={item.id} type="button" aria-pressed={template === item.id} disabled={disabled} onClick={() => chooseMode(item.id)}>{item.label}</button>)}</div>
        <p className="small muted setup-hint">{modeSummary(template, draft, shown)}{!readOnly && <button type="button" className="link-btn setup-link" onClick={onCustomFlow}>自定义流程</button>}</p>
      </div></div>
    <div className="setup-line"><span className="setup-label">几位成员</span>
      <div className="setup-control">
        {fixed ? <span className="setup-fixed">固定 2 人</span>
          : <span className="member-count" role="group" aria-label="几位成员">
            <IconButton size="sm" icon={Minus} label="减少一位成员" disabled={disabled || count <= MIN_PARTICIPANTS} onClick={() => void arrange(template, count - 1)} />
            <output className="member-count-value tabular" aria-live="polite">{count}</output>
            <IconButton size="sm" icon={Plus} label="增加一位成员" disabled={disabled || count >= MAX_PARTICIPANTS} onClick={() => void arrange(template, count + 1)} /></span>}
      </div></div>
    <div className="setup-members"><span className="setup-label">成员和模型</span>
      {shown.length === 0 ? <p className="small muted">{fixed ? '这个方式需要两位成员。' : '这个房间还没有参与讨论的成员，点上面的加号添加。'}</p>
        : <ol className="setup-list" aria-label="成员和模型">{speakingOrder(shown, draft).map(agent => {
          const current = { ...agent, ...saving[agent.id] } as AgentConfiguration;
          const value = modelValue(current); const busy = agent.id in saving; const role = roleShown(agent);
          const line = memberLine(current, providers, readiness);
          return <li key={agent.id} className="setup-row">
            <Avatar name={agent.displayName} />
            <div className="setup-who"><b>{agent.displayName}</b>{role && <> <Tag>{role}</Tag></>}</div>
            <select className="select input setup-model" aria-label={`${agent.displayName} 的模型`} value={value} disabled={busy || disabled}
              onChange={event => void change(agent, modelChoice(event.target.value))}>
              <ModelOptions options={options} value={value} emptyLabel={agent.builtInDemo ? '内置演示（不联网）' : undefined} />
            </select>
            <IconButton size="sm" icon={Pencil} label={`编辑「${agent.displayName}」`} disabled={busy || disabled} onClick={() => setEditor(agent)} />
            {errors[agent.id] ? <p className="setup-note field-error" role="alert">{errors[agent.id]}</p>
              : line.warn && <p className="setup-note small warn-text"><CircleAlert aria-hidden size={13} className="inline-icon" />{line.text}</p>}
          </li>;
        })}</ol>}
    </div>
    {error && <p className="field-error setup-message" role="alert">{error}</p>}
    {notice && <p className="small muted setup-message" role="status">{notice}</p>}
    <p className="small muted setup-foot">每位成员可以用不同的模型。改动对这场和之后的讨论生效，已有讨论不变。
      {!readOnly && realServices <= 1 && <button type="button" className="link-btn setup-link" onClick={onConnectMore}>连接更多模型服务</button>}</p>
    {editor && <MemberDialog key={editor.id} agent={editor} roomId={roomId} order={editor.displayOrder} providers={providers} readiness={readiness} onOpenSettings={onOpenSettings}
      onClose={() => setEditor(undefined)} onSave={async (input: CreateAgentInput) => {
        await api.updateAgent({ ...input, id: editor.id });
        await reload();
        setEditor(undefined);
      }} />}
  </section>;
}
