import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { ArrowUp, AtSign, Check, ChevronDown, Clock, Ellipsis, JapaneseYen, Pause, Pin, Play, Square, StepForward, Workflow } from 'lucide-react';
import type { RunSnapshot } from '../../../shared/types/run';
import { Avatar, Button, IconButton, cx, useDismiss } from '../../components/ui';
import type { RunApiContract } from '../../../shared/contracts/run';
import { canContinueRun, canDirectRun, nextSpeaker, nextSpeakerText, scheduledNext } from '../host/model';
import { parseMentions } from '../../../shared/groupChat';
import { WaitingSeconds } from '../timeline/MessageItem';
import type { HostCommands } from '../host/useHostCommands';
import { sendInterjection } from './interject';
import { chatMentionQuery, mentionedMembers, mentionOptions, mentionQuery, type MentionOption } from './mention';
import { continuationSummary, useContinuation } from './continuation';
import { AttachImageButton, ImageTray } from '../attachments/images';
import { useImageDraft, useImageInput, type DraftImage, type ImageDraft } from '../attachments/useImageDraft';
import { imageAudienceNotes } from '../attachments/support';
import type { AttachmentApiContract } from '../../../shared/contracts/app';
import type { ImageSupport } from '../../../shared/serviceCatalog';
import './composer.css';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/u.test(navigator.platform || navigator.userAgent);
const modifier = isMac ? '⌘' : 'Ctrl';
/**
 * Which box the dock shows: live Runs, stopped ones Main can still direct and finished ones (D111: continued in
 * place) get the host box; only a new discussion (no Run selected) gets the goal box. A new discussion is always the
 * explicit 新讨论 button, never what the box does by itself.
 */
export const interjectionBoxFor = (snapshot: RunSnapshot | undefined, live: boolean) =>
  !!snapshot && (Boolean(snapshot.groupChat) || live || ['error', 'cancelled', 'interrupted'].includes(snapshot.status) && canDirectRun(snapshot) || canContinueRun(snapshot));
/** Unsent interjections are kept per discussion while the window is open. */
const interjectionDrafts = new Map<string, string>();
const interjectionImages = new Map<string, readonly DraftImage[]>();

const AudienceNotes = ({ notes }: { notes: readonly string[] }) => <>{notes.map(note => <p key={note} className="image-note warn-text" role="note">{note}</p>)}</>;

/** Enter while an IME composition is active only confirms the candidate (keyCode 229 covers IMEs that end first). */
export const isComposing = (event: KeyboardEvent, composing: boolean) => composing || event.nativeEvent.isComposing || event.keyCode === 229;

function useAutosize(ref: RefObject<HTMLTextAreaElement | null>, value: string) {
  useLayoutEffect(() => {
    const area = ref.current; if (!area) return;
    area.style.height = 'auto';
    area.style.height = `${Math.min(200, Math.max(48, area.scrollHeight))}px`;
  }, [ref, value]);
}

const noImages: ImageDraft = { available: false, items: [], error: '', uploading: false, attachmentIds: [], addFiles: () => {}, remove: () => {}, clear: () => {} };

export type TaskSettings = {
  outputLimitText: string; setOutputLimitText: (value: string) => void; outputLimitValid: boolean;
  stepMode: boolean; setStepMode: (value: boolean) => void;
  workflowLabel: string; onOpenWorkflow?: () => void;
};

/** 未开始: a multi-line goal, the discussion settings as chips, and 开始讨论 in the slot 暂停 will take (D098). */
export function TaskComposer({ draft, setDraft, canStart, starting, onStart, settings, notices, hint, label = '讨论目标', placeholder, images, imageNotes = [], chat }: {
  draft: string; setDraft: (value: string) => void; canStart: boolean; starting: boolean; onStart: () => void; settings: TaskSettings;
  notices?: ReactNode; hint?: ReactNode; label?: string; placeholder?: string;
  /** D147: images going with the goal, and who will not see them. */
  images?: ImageDraft; imageNotes?: readonly string[];
  /** D149: this is the first message of a group chat: Enter sends, and `@` names people. */
  chat?: { members: ReadonlyArray<{ agentId: string; name: string }> };
}) {
  const imageInput = useImageInput(images ?? noImages);
  const startable = canStart && !images?.uploading;
  const area = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const chatOptions = chat?.members.map(member => ({ ...member, available: true, reason: '@ 了就会回应' })) ?? [];
  const mentions = useChatMentions(draft, setDraft, chatOptions, area, composing);
  const chatDock = useRef<HTMLDivElement>(null);
  useDismiss(mentions.menu !== undefined, mentions.close, [chatDock]);
  const [moreOpen, setMoreOpen] = useState(false);
  const popover = useRef<HTMLDivElement>(null), trigger = useRef<HTMLDivElement>(null);
  const invalid = !settings.outputLimitValid;
  // An invalid value keeps its field open, so the reason the start button is disabled stays visible.
  const open = moreOpen || invalid;
  const close = useCallback(() => setMoreOpen(false), []);
  useDismiss(moreOpen && !invalid, close, [popover, trigger]);
  useAutosize(area, draft);
  const panelId = useId();
  return <div className="dock">
    <div className="dock-inner" ref={chatDock}>
      {notices}
      {chat && mentions.menu && <MentionMenu id={`${panelId}-mention`} options={mentions.filtered} query={mentions.menu.query} active={mentions.active} onPick={mentions.pick} onHover={mentions.setActive} continuing={false} chat />}
      {chat && <MentionStrip text={draft} members={chat.members} />}
      {open && <div ref={popover} id={panelId} className="popover settings-pop" role="group" aria-label="更多设置">
        <label className="field"><span>单次发言上限</span>
          <span className="inline-field"><input className="input" style={{ width: 110 }} aria-label="单次输出上限（token）" inputMode="numeric" value={settings.outputLimitText}
            aria-invalid={!settings.outputLimitValid} aria-describedby="output-limit-help" onChange={event => settings.setOutputLimitText(event.target.value)} /><span className="muted small">tokens</span></span>
          {settings.outputLimitValid ? <span id="output-limit-help" className="field-help">每位成员每次最多写这么长（8192 约 6,000 汉字），模型的思考也算在内。写到上限会保留并标注，可以续写。超过某位成员模型的最大输出时，按那个模型的上限发送；最大输出可以在“设置 › 模型服务”里改。</span>
            : <span id="output-limit-help" className="field-error" role="alert">单次输出上限请输入 1 到 65536 之间的整数。</span>}
        </label>
      </div>}
      <div className={cx('composer', imageInput.dropping && 'is-dropping')}>
        {images && <ImageTray draft={images} notes={<>{!draft.trim() && <p className="image-note muted" role="note">{chat ? '第一条消息要写一句文字，图片作为补充。' : '讨论目标要写一句文字，图片作为补充。'}</p>}<AudienceNotes notes={imageNotes} /></>} />}
        <div className="composer-text">
          <textarea ref={area} aria-label={chat ? '第一条消息' : label} value={draft} rows={2} placeholder={chat ? '和大家说点什么，比如“集合开会！”。输入 @ 可以点名一位或几位' : placeholder ?? '这场讨论要解决什么？写下目标和约束，例如范围、时间、要交付什么…'}
            onChange={event => { setDraft(event.target.value); if (chat) mentions.sync(event.target.value, event.target.selectionStart ?? event.target.value.length); }}
            onCompositionStart={() => { composing.current = true; mentions.setComposing(true); }} onCompositionEnd={event => { composing.current = false; mentions.setComposing(false); if (chat) mentions.sync(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length); }}
            onKeyDown={event => {
              if (chat) {
                if (mentions.onKey(event, isComposing(event, composing.current))) return;
                if (event.key !== 'Enter' || event.shiftKey || isComposing(event, composing.current)) return;
                event.preventDefault(); if (startable) onStart();
                return;
              }
              if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey) || isComposing(event, composing.current)) return;
              event.preventDefault(); if (startable) onStart();
            }} />
        </div>
        <div className="composer-row">
          <div className="chips" ref={trigger}>
            {images && <AttachImageButton draft={images} />}
            {chat && <button type="button" className="chip" aria-expanded={mentions.menu !== undefined} onClick={() => mentions.toggle()}><AtSign aria-hidden size={15} />点名</button>}
            {settings.onOpenWorkflow && <button type="button" className="chip" onClick={settings.onOpenWorkflow} aria-label={`讨论方式：${settings.workflowLabel}`} title="选择谁在什么时候发言"><Workflow aria-hidden size={15} />{settings.workflowLabel}<ChevronDown aria-hidden size={14} /></button>}
            {!chat && <label className={cx('chip', 'chip-check', settings.stepMode && 'is-on')} title="每位成员说完一次就停下，方便你插话或点名，再点「下一步」或「继续」">
              <input type="checkbox" checked={settings.stepMode} onChange={event => settings.setStepMode(event.target.checked)} />每回合后暂停</label>}
            <IconButton icon={Ellipsis} label="更多设置" className="chip-icon" aria-expanded={open} aria-controls={panelId} onClick={() => setMoreOpen(value => !value)} />
          </div>
          <div className="controls">
            <Button variant="primary" className="slot" disabled={!startable} onClick={onStart}>{starting ? '正在开始…' : chat ? '发送' : '开始讨论'}</Button>
          </div>
        </div>
      </div>
      <div className="dock-hint">{hint ?? <>{chat ? <><span><span className="kbd">Enter</span> 发送</span><span aria-hidden>·</span><span><span className="kbd">Shift</span> <span className="kbd">Enter</span> 换行</span></> : <span><span className="kbd">{modifier}</span> <span className="kbd">Enter</span> 开始</span>}<span aria-hidden>·</span><span>调用模型的费用由服务商收取，这里不估算</span></>}</div>
    </div>
  </div>;
}

export type RunControls = {
  status: RunSnapshot['status']; pause: { enabled: boolean; run: () => void }; resume: { enabled: boolean; run: () => void };
  step: { enabled: boolean; run: () => void }; stop: { enabled: boolean; run: () => void };
  /** A request is out; stopping may already be billed. */
  inFlight: boolean; speaker?: string;
};

/** D098: 停止 | 下一步 | 暂停/继续 — the primary slot keeps its place and width; stopping asks once, above it. */
function LiveControls({ controls }: { controls: RunControls }) {
  const [confirming, setConfirming] = useState(false);
  const stopButton = useRef<HTMLButtonElement>(null), pop = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setConfirming(false), []);
  useDismiss(confirming, close, [pop, stopButton]);
  useEffect(() => { if (!controls.stop.enabled) setConfirming(false); }, [controls.stop.enabled]);
  const { status } = controls;
  return <div className="controls" role="group" aria-label="运行控制">
    {confirming && controls.stop.enabled && <div ref={pop} id="stop-confirm" className="popover stop-pop" role="dialog" aria-label="确认停止运行"
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setConfirming(false); stopButton.current?.focus(); } }}>
      <h3>停止这次讨论？</h3>
      <p>{controls.inFlight
        ? `${controls.speaker ? `${controls.speaker}正在发言，` : ''}停止会立即中止当前回合，并结束本次运行。已生成的部分文字会保留；这次请求已经发出，服务商可能已经计入用量。`
        : '停止会结束本次运行，后续回合不再执行。已有发言都会保留。'}停止后不会自动继续。</p>
      <div className="stop-actions">
        <Button autoFocus onClick={() => { setConfirming(false); stopButton.current?.focus(); }}>不停止</Button>
        <Button variant="danger" solid onClick={() => { setConfirming(false); controls.stop.run(); }}>停止讨论</Button>
      </div>
    </div>}
    <Button ref={stopButton} variant="danger" size="sm" icon={Square} disabled={!controls.stop.enabled} aria-expanded={confirming} aria-controls="stop-confirm"
      onClick={() => setConfirming(true)}>{status === 'cancelling' ? '正在停止…' : '停止'}</Button>
    <span className="controls-gap" aria-hidden />
    <Button size="sm" icon={StepForward} disabled={!controls.step.enabled} title={controls.step.enabled ? '只让下一位说一次，然后再停下' : '暂停后可以单步'} onClick={controls.step.run}>下一步</Button>
    {status === 'paused'
      ? <Button variant="primary" className="slot" icon={Play} disabled={!controls.resume.enabled} onClick={controls.resume.run}>继续</Button>
      : <Button variant="primary" className="slot" icon={Pause} disabled={!controls.pause.enabled} onClick={controls.pause.run}>{status === 'pausing' ? '正在暂停…' : '暂停'}</Button>}
  </div>;
}

function MentionMenu({ id, options, query, active, onPick, onHover, continuing, chat }: { id: string; options: MentionOption[]; query: string; active: number; onPick: (option: MentionOption) => void; onHover: (index: number) => void; continuing: boolean; chat?: boolean }) {
  return <div id={id} className="popover mention-pop" role="listbox" aria-label={chat ? '点名成员' : continuing ? '只让一位成员回应' : '点名下一位'}>
    <h4>{chat ? '点名谁来回应' : continuing ? '只让一位成员回应' : '点名下一位发言'}</h4>
    {options.length === 0 && <p className="mention-empty">没有名字以“{query}”开头的成员。</p>}
    {options.map((option, index) => <button key={option.agentId} id={`${id}-${index}`} type="button" role="option" aria-selected={index === active} aria-disabled={!option.available}
      className={cx('mention-item', index === active && 'is-active', !option.available && 'is-off')}
      onMouseDown={event => event.preventDefault()} onMouseEnter={() => onHover(index)} onClick={() => { if (option.available) onPick(option); }}>
      <Avatar name={option.name} size="sm" /><span className="grow">{option.name}<small>{option.reason}</small></span>{option.reason.startsWith('已点名') && <Check aria-hidden size={14} />}
    </button>)}
    <p className="pop-foot">{chat ? '被 @ 的成员一定会回应，可以 @ 几位，各说各的事。只 @ 一位时，一般就 TA 回答。' : continuing ? '带 @ 时只有这位成员回应你这段话；不带 @ 时，所有成员按顺序各回应一次。'
      : '被点名的成员插入一轮发言，之后回到原计划，原计划的成员不会被跳过；@ 按计划的下一位只发插话，不多插一轮。按讨论方式进行时，只能点名当前阶段的成员。'}</p>
  </div>;
}

/** D149: `@` in a group chat. While an IME is composing, what it holds is not a name yet, so the whole list stays up instead of "no such name". */
function useChatMentions(text: string, setText: (value: string) => void, options: MentionOption[], area: RefObject<HTMLTextAreaElement | null>, composing: RefObject<boolean>) {
  const [menu, setMenu] = useState<{ start: number; query: string } | undefined>();
  const [active, setActive] = useState(0);
  const [composingNow, setComposing] = useState(false);
  const filtered = menu ? (composingNow ? options : options.filter(option => option.name.toLowerCase().startsWith(menu.query.toLowerCase()))) : [];
  const close = useCallback(() => setMenu(undefined), []);
  const sync = (value: string, caret: number) => { const found = chatMentionQuery(value, caret); setMenu(found); setActive(0); };
  const pick = (option: MentionOption) => {
    if (!menu) return;
    const caret = area.current?.selectionStart ?? text.length;
    const value = `${text.slice(0, menu.start)}@${option.name} ${text.slice(caret)}`;
    setText(value); setMenu(undefined);
    requestAnimationFrame(() => { const position = menu.start + option.name.length + 2; area.current?.focus(); area.current?.setSelectionRange(position, position); });
  };
  const toggle = () => {
    if (menu) { setMenu(undefined); return; }
    const node = area.current; const caret = node?.selectionStart ?? text.length;
    const space = caret > 0 && /[A-Za-z0-9_.-]/u.test(text[caret - 1]!) ? ' ' : '';
    const position = caret + space.length + 1;
    setText(`${text.slice(0, caret)}${space}@${text.slice(caret)}`); setMenu({ start: position - 1, query: '' }); setActive(0);
    requestAnimationFrame(() => { node?.focus(); node?.setSelectionRange(position, position); });
  };
  /** True when the key belonged to the menu. */
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>, composingKey: boolean) => {
    if (!menu || composingKey || composing.current) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (filtered.length) setActive(index => (index + (event.key === 'ArrowDown' ? 1 : filtered.length - 1)) % filtered.length);
      return true;
    }
    if (event.key === 'Escape') { event.preventDefault(); setMenu(undefined); return true; }
    // A name nobody has is not a choice: Enter sends the words as they are.
    if ((event.key === 'Enter' && !event.shiftKey || event.key === 'Tab') && filtered[active]) { event.preventDefault(); pick(filtered[active]!); return true; }
    return false;
  };
  return { menu, active, setActive, filtered, close, sync, pick, toggle, onKey, setComposing };
}

/** Says who the box will reach, before sending, by the same reading Main uses. */
function MentionStrip({ text, members }: { text: string; members: ReadonlyArray<{ agentId: string; name: string }> }) {
  const { mentions, everyone } = parseMentions(text, members.map(member => ({ agentId: member.agentId, displayName: member.name })));
  if (!mentions.length && !everyone) return null;
  return <div className="next-strip" role="status" aria-label="会回应的成员"><AtSign aria-hidden size={14} />
    <span>{mentions.length ? <>会回应：<b>{mentions.map(mention => mention.name).join('、')}</b></> : '所有人都会回应'}</span></div>;
}

/** D149: only stopping, at once and in the primary place: nothing is lost by it, and the next message simply goes on. */
function ChatControls({ controls }: { controls: RunControls }) {
  return <div className="controls" role="group" aria-label="运行控制">
    <Button variant="danger" className="slot" icon={Square} disabled={!controls.stop.enabled} onClick={controls.stop.run}>{controls.status === 'cancelling' ? '正在停止…' : '停止'}</Button>
  </div>;
}

/** Who is typing and who comes next. One at a time, and nothing here is made to look slower than it is. */
function ChatStatus({ snapshot }: { snapshot: RunSnapshot }) {
  const round = snapshot.groupChat?.round;
  const members = snapshot.execution?.membersSnapshot ?? [];
  const name = (agentId: string | undefined) => members.find(member => member.agentId === agentId)?.displayName ?? '成员';
  const turn = snapshot.turns.find(item => item.turnId === snapshot.currentTurnId);
  const since = snapshot.attempts?.filter(attempt => attempt.turnId === turn?.turnId).at(-1);
  const queue = round?.state === 'open' ? round.queue : [];
  if (!turn && !round?.scheduling && !(queue.length && ['running', 'pausing'].includes(snapshot.status))) return null;
  return <div className="next-strip chat-status" role="status" aria-label="谁在说话">
    <Clock aria-hidden size={14} />
    <span>{turn ? <><b>{name(turn.agentId)}</b> 正在输入… <WaitingSeconds key={turn.turnId} since={since?.startedAt ?? since?.createdAt} /></> : round?.scheduling ? '在看谁来接话…' : <><b>{name(queue[0]?.agentId)}</b> 马上接话…</>}
      {turn && queue.length > 0 && <> · 接着：{queue.map(item => name(item.agentId)).join('、')}</>}</span>
  </div>;
}

/**
 * 运行中: the box is the interjection box. Enter sends, Shift+Enter adds a line, `@` names the next speaker (D4),
 * and 设为持续指令 turns the text into a standing instruction. The run controls sit at its right.
 */
export function HostComposer({ snapshot, commands, controls, settledSlot, notices, instructionsWritable, continueApi, onContinued, attachmentApi, imageSupport }: {
  snapshot: RunSnapshot; commands: HostCommands; controls?: RunControls;
  /** For a Run that is no longer live: what sits in the primary slot instead of the run controls. */
  settledSlot?: ReactNode; notices?: ReactNode; instructionsWritable: boolean;
  /** D111: with these, a finished discussion is continued in place from this box. */
  continueApi?: Pick<RunApiContract, 'previewContinuation' | 'continueDiscussion'>; onContinued?: () => void;
  /** D147: with this, the box takes images; `imageSupport` says who will not see them. */
  attachmentApi?: AttachmentApiContract; imageSupport?: (member: { providerId: string | null; modelId: string | null }) => ImageSupport | undefined;
}) {
  const key = snapshot.runId;
  const [rememberedImages] = useState(() => ({ initial: interjectionImages.get(key) ?? [], save: (items: readonly DraftImage[]) => { if (items.length) interjectionImages.set(key, items); else interjectionImages.delete(key); } }));
  const images = useImageDraft(attachmentApi, rememberedImages);
  const imageInput = useImageInput(images);
  const [text, setTextState] = useState(() => interjectionDrafts.get(key) ?? '');
  const setText = (value: string) => { setTextState(value); if (value) interjectionDrafts.set(key, value); else interjectionDrafts.delete(key); };
  useEffect(() => { setTextState(interjectionDrafts.get(key) ?? ''); }, [key]);
  const area = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const [menu, setMenu] = useState<{ start: number; query: string } | undefined>();
  const [active, setActive] = useState(0);
  const menuId = useId();
  const dockRef = useRef<HTMLDivElement>(null);
  useAutosize(area, text);
  const chat = Boolean(snapshot.groupChat);
  const continuing = Boolean(continueApi) && canContinueRun(snapshot);
  const members = snapshot.execution?.membersSnapshot ?? [];
  const memberName = (agentId: string) => members.find(member => member.agentId === agentId)?.displayName ?? '成员';
  // Continuing, anyone in the roster may be asked to answer; Main says if one can no longer speak.
  const options = chat ? members.map(member => ({ agentId: member.agentId, name: member.displayName, available: true, reason: '@ 了就会回应' }))
    : continuing ? members.map(member => ({ agentId: member.agentId, name: member.displayName, available: true, reason: '只让这位成员回应' })) : mentionOptions(snapshot);
  const chatMentions = useChatMentions(text, setText, options, area, composing);
  const filtered = chat ? chatMentions.filtered : menu ? options.filter(option => option.name.startsWith(menu.query)) : [];
  const closeMenu = useCallback(() => setMenu(undefined), []);
  useDismiss(menu !== undefined, closeMenu, [dockRef]);
  useDismiss(chatMentions.menu !== undefined, chatMentions.close, [dockRef]);
  const named = continuing ? mentionedMembers(text, options) : [];
  const noop = useCallback(() => {}, []);
  const continuation = useContinuation(continueApi, snapshot.runId, continuing, { content: text, ...(named.length === 1 ? { agentId: named[0].agentId } : {}) }, onContinued ?? noop);
  const busy = commands.pending !== undefined || continuation.sending || images.uploading;
  const hasContent = text.trim().length > 0 || images.attachmentIds.length > 0;
  const attached = images.attachmentIds.length ? { attachmentIds: images.attachmentIds } : {};
  const imageNotes = imageAudienceNotes(members.map(member => ({ name: member.displayName, support: imageSupport?.(member) })));
  // When the discussion ends, what was said about the live Run (who was named, what comes next) no longer applies.
  const { report } = commands;
  useEffect(() => { if (continuing) report({}); }, [continuing, report]);
  const status = snapshot.status;
  const next = ['running', 'pausing', 'paused'].includes(status) || snapshot.host?.override ? nextSpeaker(snapshot) : undefined;
  const nextText = next ? nextSpeakerText(next) : undefined;
  const plan = continuing ? continuationSummary(continuation.preview, memberName) : undefined;
  const override = snapshot.host?.override;
  const overrideName = override ? options.find(option => option.agentId === override.agentId)?.name ?? '成员' : undefined;

  const syncMenu = (value: string, caret: number) => {
    const found = mentionQuery(value, caret);
    setMenu(found); if (found) setActive(Math.max(0, options.filter(option => option.name.startsWith(found.query)).findIndex(option => option.available)));
  };
  const pick = (option: MentionOption) => {
    if (!menu) return;
    const caret = area.current?.selectionStart ?? text.length;
    const value = `${text.slice(0, menu.start)}@${option.name} ${text.slice(caret)}`;
    setText(value); setMenu(undefined);
    requestAnimationFrame(() => { const position = menu.start + option.name.length + 2; area.current?.focus(); area.current?.setSelectionRange(position, position); });
  };
  const openMenu = () => {
    const areaNode = area.current; const caret = areaNode?.selectionStart ?? text.length;
    const needsSpace = caret > 0 && !/\s/u.test(text[caret - 1]);
    const value = `${text.slice(0, caret)}${needsSpace ? ' ' : ''}@${text.slice(caret)}`;
    const position = caret + (needsSpace ? 2 : 1);
    setText(value); setMenu({ start: position - 1, query: '' }); setActive(Math.max(0, options.findIndex(option => option.available)));
    requestAnimationFrame(() => { areaNode?.focus(); areaNode?.setSelectionRange(position, position); });
  };
  const send = async () => {
    if (!hasContent || busy || !commands.available) return;
    if (chat) {
      const result = await commands.request('chat', { kind: 'interject', content: text.trim() ? text : '', ...attached }, { quiet: true });
      commands.report(result.ok ? {} : { error: `没有发出去：${result.message}内容保留在输入框里。` });
      if (result.ok) { setText(''); images.clear(); }
      return;
    }
    if (continuing) {
      if (named.length > 1) { commands.report({ error: `一次只能让一位成员回应（这里点了${named.map(item => `@${item.name}`).join('、')}）。请只留一个；不带 @ 时所有成员各回应一次。` }); return; }
      const result = await continuation.send({ content: text, ...attached, ...(named.length === 1 ? { agentId: named[0].agentId } : {}) });
      if (!result.ok) { commands.report({ error: `没有继续：${result.message}内容保留在输入框里。` }); return; }
      commands.report({ notice: `已在这场讨论里继续：${result.agentIds.length === 1 ? `${memberName(result.agentIds[0])}会回应你这段话` : `${result.agentIds.map(memberName).join('、')}会按顺序各回应一次`}，每位都能看到前面的全部讨论。` });
      setText(''); images.clear();
      return;
    }
    const result = await sendInterjection(text, options, override?.agentId, commands.request, scheduledNext(snapshot), images.attachmentIds);
    commands.report({ notice: result.notice, error: result.error });
    if (result.clear) { setText(''); images.clear(); }
  };
  const addInstruction = async () => {
    if (!text.trim() || busy) return;
    const result = await commands.request('instruction:new', { kind: 'setInstruction', content: text }, { quiet: true });
    commands.report(result.ok ? { notice: '已设为持续指令：从下一个新请求起，每位成员都会遵守。可以在「本场信息 › 指令」里修改或清除。' } : { error: `持续指令没有保存：${result.message}` });
    if (result.ok) setText('');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (chat && chatMentions.onKey(event, isComposing(event, composing.current))) return;
    if (menu && !isComposing(event, composing.current)) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (filtered.length) setActive(index => (index + (event.key === 'ArrowDown' ? 1 : filtered.length - 1)) % filtered.length);
        return;
      }
      if (event.key === 'Escape') { event.preventDefault(); setMenu(undefined); return; }
      // With the menu open, Enter picks; a member who cannot be named is not picked and nothing is sent.
      if (event.key === 'Enter' && !event.shiftKey || event.key === 'Tab' && filtered.length) { event.preventDefault(); if (filtered[active]?.available) pick(filtered[active]); return; }
    }
    if (event.key !== 'Enter' || event.shiftKey || isComposing(event, composing.current)) return;
    event.preventDefault(); void send();
  };
  const placeholder = chat ? '说点什么。输入 @ 可以点名一位或几位；有人正在说时发送，会打断 TA' : continuing ? '在这场讨论里继续：写下你的问题或要求，所有成员按顺序各回应一次；输入 @ 只让一位成员回应…'
    : ['error', 'cancelled', 'interrupted'].includes(status) ? '插话会在讨论继续后被成员看到；要讨论新问题，点「新讨论」'
    : '插话，所有成员从下一回合起可见；输入 @ 点名下一位…';
  const hint = chat ? <><span><span className="kbd">Enter</span> 发送</span><span aria-hidden>·</span><span><span className="kbd">Shift</span> <span className="kbd">Enter</span> 换行</span><span aria-hidden>·</span><span>发新消息会打断正在说的人，已说的保留</span></>
    : status === 'paused' ? <><span><span className="kbd">Enter</span> 发送插话</span><span aria-hidden>·</span><span>下一步：只让下一位说一次</span><span aria-hidden>·</span><span>继续：恢复自动轮流</span></>
    : status === 'pausing' ? <span>当前回合说完后会停下</span>
    : status === 'cancelling' ? <span>等待当前请求中止，已生成的文字会保留</span>
    : status === 'running' ? <><span>暂停会等{controls?.speaker ?? '当前成员'}说完再停</span><span aria-hidden>·</span><span>停止会立即中止当前发言</span></>
    : continuing ? <><span><span className="kbd">Enter</span> 发送并继续讨论</span><span aria-hidden>·</span><span><span className="kbd">Shift</span> <span className="kbd">Enter</span> 换行</span><span aria-hidden>·</span><span>讨论新问题，点「新讨论」</span></>
    : <><span><span className="kbd">Enter</span> 发送</span><span aria-hidden>·</span><span><span className="kbd">Shift</span> <span className="kbd">Enter</span> 换行</span></>;
  return <div className="dock">
    <div className="dock-inner" ref={dockRef}>
      {notices}
      {chat && chatMentions.menu && <MentionMenu id={menuId} options={filtered} query={chatMentions.menu.query} active={chatMentions.active} onPick={chatMentions.pick} onHover={chatMentions.setActive} continuing={false} chat />}
      {!chat && menu && <MentionMenu id={menuId} options={filtered} query={menu.query} active={active} onPick={pick} onHover={setActive} continuing={continuing} />}
      {chat && <ChatStatus snapshot={snapshot} />}
      {chat && <MentionStrip text={text} members={options} />}
      {continuing && <div className="next-strip" role="status" aria-label="继续后谁回应">
        <Clock aria-hidden size={14} />
        <span>{plan ? <>{plan.text}{plan.warn && <span className="strip-warn">{plan.warn}</span>}</> : continuation.previewFailed ? '没有读到谁会回应；发送后按成员顺序回应。' : '正在确认谁回应…'}</span>
      </div>}
      {!continuing && (next || override) && <div className="next-strip" role="status" aria-label="下一位">
        <Clock aria-hidden size={14} />
        <span>{status === 'paused' ? '已暂停，等你决定 · ' : ''}{nextText ? <>下一位：<b>{nextText.name}</b>（{nextText.source}）{nextText.then ? ` · ${nextText.then}` : ''}</> : `已点名${overrideName}`}</span>
        {override && <button type="button" className="link-btn" disabled={busy} onClick={() => void commands.send('cancelOverride', { kind: 'cancelOverride' }, '已取消点名，恢复按计划发言。')}>取消点名</button>}
      </div>}
      {(commands.pending || commands.notice || commands.error) && <div className="composer-feedback">
        {commands.pending && <p role="status" className="muted">正在发送，等待主进程确认…</p>}
        {!commands.pending && commands.notice && <p role="status">{commands.notice}</p>}
        {!commands.pending && commands.error && <p role="alert" className="field-error">{commands.error}</p>}
      </div>}
      <div className={cx('composer', imageInput.dropping && 'is-dropping')}>
        <ImageTray draft={images} notes={<AudienceNotes notes={imageNotes} />} />
        <div className="composer-text">
          <textarea ref={area} aria-label={chat ? '发消息' : continuing ? '继续讨论' : '主持人插话'} value={text} rows={2} placeholder={placeholder}
            aria-controls={menu || chatMentions.menu ? menuId : undefined} aria-expanded={menu || chatMentions.menu ? true : undefined} aria-activedescendant={(menu || chatMentions.menu) && filtered[chat ? chatMentions.active : active] ? `${menuId}-${chat ? chatMentions.active : active}` : undefined}
            onChange={event => { setText(event.target.value); const caret = event.target.selectionStart ?? event.target.value.length; if (chat) chatMentions.sync(event.target.value, caret); else syncMenu(event.target.value, caret); }}
            onCompositionStart={() => { composing.current = true; chatMentions.setComposing(true); }}
            onCompositionEnd={event => { composing.current = false; chatMentions.setComposing(false); if (chat) chatMentions.sync(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length); }}
            onKeyDown={onKeyDown} />
          <IconButton icon={ArrowUp} label={chat ? '发送' : continuing ? '发送并继续讨论' : '发送插话'} className="send" disabled={!hasContent || busy || !commands.available
            || continuing && (continuation.preview?.available === false && continuation.preview.reason !== 'busy')} onClick={() => void send()} />
        </div>
        <div className="composer-row">
          <div className="chips">
            <AttachImageButton draft={images} />
            <button type="button" className="chip" aria-expanded={(chat ? chatMentions.menu : menu) !== undefined} aria-controls={menuId} onClick={() => chat ? chatMentions.toggle() : menu ? setMenu(undefined) : openMenu()}><AtSign aria-hidden size={15} />点名</button>
            <button type="button" className="chip" disabled={!text.trim() || busy || !instructionsWritable} title="把这段话作为持续指令：之后每位成员的每次发言都遵守，可随时修改或清除。图片不会带进持续指令" onClick={() => void addInstruction()}><Pin aria-hidden size={15} />设为持续指令</button>
          </div>
          {controls ? (chat ? <ChatControls controls={controls} /> : <LiveControls controls={controls} />) : <div className="controls">{settledSlot}</div>}
        </div>
      </div>
      <div className="dock-hint">{hint}</div>
    </div>
  </div>;
}

