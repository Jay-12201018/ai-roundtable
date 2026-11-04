import { useState } from 'react';
import { act, cleanup, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HostComposer, TaskComposer, type TaskSettings } from '../../../src/renderer/features/composer/Composer';
import { MessageImages } from '../../../src/renderer/features/attachments/images';
import { useImageDraft, type DraftImage } from '../../../src/renderer/features/attachments/useImageDraft';
import { imageAudienceNotes, memberImageSupport } from '../../../src/renderer/features/attachments/support';
import { sendInterjection } from '../../../src/renderer/features/composer/interject';
import { useHostCommands } from '../../../src/renderer/features/host';
import type { AttachmentApiContract, HostApiContract } from '../../../src/shared/contracts/app';
import { MAX_IMAGE_BYTES, imageUrl } from '../../../src/shared/schemas/attachment';
import type { RunSnapshot } from '../../../src/shared/types/run';
import { time } from '../rendererSubscriptions/fixtures';
import { publicError } from '../../../src/shared/schemas/error';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const settings: TaskSettings = { outputLimitText: '8192', setOutputLimitText: vi.fn(), outputLimitValid: true, stepMode: false, setStepMode: vi.fn(), workflowLabel: '自由讨论' };
let counter = 0;
const stored = () => ({ id: String(++counter).padStart(64, '0'), mediaType: 'image/png' as const, byteCount: 8 });
const accepting = () => ({ addImage: vi.fn<AttachmentApiContract['addImage']>(async () => stored()) });
const file = (name: string, size = 8, type = 'image/png') => { const value = new File([new Uint8Array(1)], name, { type }); Object.defineProperty(value, 'size', { value: size }); Object.defineProperty(value, 'arrayBuffer', { value: async () => new ArrayBuffer(8) }); return value; };

function Task({ api, canStart = true, onStart = vi.fn(), notes = [] }: { api: AttachmentApiContract; canStart?: boolean; onStart?: () => void; notes?: string[] }) {
  const [draft, setDraft] = useState('');
  const images = useImageDraft(api);
  return <TaskComposer draft={draft} setDraft={setDraft} canStart={canStart && Boolean(draft.trim())} starting={false} onStart={onStart} settings={settings} images={images} imageNotes={notes} />;
}
const picker = () => document.querySelector('input[type="file"]') as HTMLInputElement;
const pick = (files: File[]) => act(async () => { fireEvent.change(picker(), { target: { files } }); });
const tray = () => screen.queryByRole('list', { name: /待发送的图片/u });
const paste = async (target: Element, data: { files?: File[]; text?: string; html?: boolean }) => {
  const event = createEvent.paste(target, { clipboardData: { files: data.files ?? [], types: [...(data.text ? ['text/plain'] : []), ...(data.html ? ['text/html'] : []), ...(data.files?.length ? ['Files'] : [])], getData: (type: string) => type === 'text/plain' ? data.text ?? '' : '' } });
  await act(async () => { fireEvent(target, event); });
  return event;
};

describe('attaching images in the goal box (D147)', () => {
  it('the paperclip takes files, shows thumbnails through the restricted scheme, and a thumbnail can be removed', async () => {
    const api = accepting();
    render(<Task api={api} />);
    expect(picker().accept).toBe('image/png,image/jpeg,image/webp');
    await pick([file('a.png'), file('b.png')]);
    await waitFor(() => expect(within(tray()!).getAllByRole('img')).toHaveLength(2));
    expect(api.addImage.mock.calls[0][0].bytes).toBeInstanceOf(Uint8Array);
    expect(within(tray()!).getAllByRole('img')[0].getAttribute('src')).toMatch(/^rt-image:\/\/local\/[0-9a-f]{64}$/u);
    fireEvent.click(screen.getByRole('button', { name: '移除第 1 张图片' }));
    expect(within(tray()!).getAllByRole('img')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '移除第 1 张图片' }));
    expect(tray()).toBeNull();
  });

  it('says on the spot what was not added and why, and never drops anything silently', async () => {
    const api = accepting();
    api.addImage.mockRejectedValueOnce(publicError('image_unsupported'));
    render(<Task api={api} />);
    await pick([file('动图.gif')]);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('“动图.gif” 不是 PNG、JPEG 或 WebP 图片，没有加上。'));
    expect(tray()).toBeNull();
    await pick([file('大图.png', MAX_IMAGE_BYTES + 1)]);
    expect(screen.getByRole('alert').textContent).toBe('“大图.png” 超过 10 MB，没有加上。');
    await pick([file('1.png'), file('2.png'), file('3.png'), file('4.png'), file('5.png'), file('6.png')]);
    await waitFor(() => expect(within(tray()!).getAllByRole('img')).toHaveLength(4));
    expect(screen.getByRole('alert').textContent).toBe('每条消息最多 4 张，多出来的 2 张没有加上。');
    expect(api.addImage).toHaveBeenCalledTimes(5);
    await pick([file('7.png')]);
    expect(screen.getByRole('alert').textContent).toBe('每条消息最多 4 张，先移除一张再加。');
  });

  it('says before sending when a message\'s images together would not fit one request, without stopping it', async () => {
    const megabytes = (count: number) => ({ ...stored(), byteCount: count * 1024 * 1024 });
    const api = { addImage: vi.fn<AttachmentApiContract['addImage']>() };
    api.addImage.mockResolvedValueOnce(megabytes(10)).mockResolvedValueOnce(megabytes(10)).mockResolvedValueOnce(megabytes(1));
    render(<Task api={api} />);
    fireEvent.change(screen.getByRole('textbox', { name: '讨论目标' }), { target: { value: '目标' } });
    await pick([file('a.png'), file('b.png')]);
    await waitFor(() => expect(within(tray()!).getAllByRole('img')).toHaveLength(2));
    expect(screen.queryByRole('note')).toBeNull();
    await pick([file('c.png')]);
    await waitFor(() => expect(screen.getByRole('note').textContent).toContain('合计超过 20 MB，一次请求放不下'));
    expect((screen.getByRole('button', { name: '开始讨论' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '移除第 3 张图片' }));
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('the same image twice stays one, and says so', async () => {
    const same = stored();
    render(<Task api={{ addImage: async () => same }} />);
    await pick([file('a.png')]);
    await waitFor(() => expect(within(tray()!).getAllByRole('img')).toHaveLength(1));
    await pick([file('a 副本.png')]);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('已经加过了'));
    expect(within(tray()!).getAllByRole('img')).toHaveLength(1);
  });

  it('paste takes images; words copied with a picture of themselves stay words', async () => {
    const api = accepting();
    render(<Task api={api} />);
    const area = screen.getByRole('textbox', { name: '讨论目标' });
    expect((await paste(area, { text: '只是文字' })).defaultPrevented).toBe(false);
    expect((await paste(area, { text: '表格文字', html: true, files: [file('image.png')] })).defaultPrevented).toBe(false);
    expect(api.addImage).not.toHaveBeenCalled();
    expect((await paste(area, { files: [file('image.png')] })).defaultPrevented).toBe(true);
    await waitFor(() => expect(api.addImage).toHaveBeenCalledTimes(1));
    // A file copied in the file manager comes with its name as text, and is still the file.
    expect((await paste(area, { text: '照片.png', files: [file('照片.png')] })).defaultPrevented).toBe(true);
    await waitFor(() => expect(api.addImage).toHaveBeenCalledTimes(2));
  });

  it('dragging files in marks the box and adds them; dragged text is left alone', async () => {
    const api = accepting();
    render(<Task api={api} />);
    const box = document.querySelector('.composer')!;
    const files = [file('拖入.png')];
    fireEvent.dragEnter(box, { dataTransfer: { types: ['Files'], files } });
    expect(box.classList.contains('is-dropping')).toBe(true);
    await act(async () => { fireEvent.drop(box, { dataTransfer: { types: ['Files'], files } }); });
    expect(box.classList.contains('is-dropping')).toBe(false);
    await waitFor(() => expect(api.addImage).toHaveBeenCalledTimes(1));
    const text = createEvent.drop(box, { dataTransfer: { types: ['text/plain'], files: [] } });
    fireEvent(box, text);
    expect(text.defaultPrevented).toBe(false);
    expect(api.addImage).toHaveBeenCalledTimes(1);
    // Let go anywhere on the page, and the image still reaches the box.
    await act(async () => { fireEvent.drop(document.body, { dataTransfer: { types: ['Files'], files: [file('页面别处.png')] } }); });
    await waitFor(() => expect(api.addImage).toHaveBeenCalledTimes(2));
    // Not when a dialog on top has the host's attention.
    const dialog = document.createElement('dialog'); dialog.setAttribute('open', ''); document.body.append(dialog);
    const ignored = createEvent.drop(dialog, { dataTransfer: { types: ['Files'], files: [file('对话框里.png')] } });
    fireEvent(dialog, ignored);
    expect(ignored.defaultPrevented).toBe(false);
    expect(api.addImage).toHaveBeenCalledTimes(2);
    dialog.remove();
  });

  it('a goal still needs words, says so, and waits for images in progress; who cannot see them is told, not stopped', async () => {
    let finish: (value: ReturnType<typeof stored>) => void = () => {};
    const onStart = vi.fn();
    render(<Task api={{ addImage: () => new Promise(resolve => { finish = resolve; }) }} onStart={onStart} notes={['审查者的模型看不到图片，只会收到一句说明。']} />);
    await pick([file('a.png')]);
    fireEvent.change(screen.getByRole('textbox', { name: '讨论目标' }), { target: { value: '目标' } });
    const start = screen.getByRole('button', { name: '开始讨论' }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    await act(async () => { finish(stored()); });
    expect(start.disabled).toBe(false);
    expect(screen.getByRole('note').textContent).toBe('审查者的模型看不到图片，只会收到一句说明。');
    fireEvent.change(screen.getByRole('textbox', { name: '讨论目标' }), { target: { value: '' } });
    expect(start.disabled).toBe(true);
    expect(screen.getAllByRole('note').map(note => note.textContent)).toContain('讨论目标要写一句文字，图片作为补充。');
  });

  it('Enter while composing never sends, with images in the box', async () => {
    const onStart = vi.fn();
    render(<Task api={accepting()} onStart={onStart} />);
    await pick([file('a.png')]);
    const area = screen.getByRole('textbox', { name: '讨论目标' });
    fireEvent.change(area, { target: { value: '目标' } });
    fireEvent.compositionStart(area);
    fireEvent.keyDown(area, { key: 'Enter', metaKey: true, keyCode: 229 });
    expect(onStart).not.toHaveBeenCalled();
  });
});

const member = (agentId: string, displayName: string, displayOrder: number) => ({ agentId, displayName, roleTemplateId: '角色', systemPrompt: '', providerId: null, modelId: 'mock', displayOrder });
const paused: RunSnapshot = {
  runId: 'run', roomId: 'room', status: 'paused', sequence: 3, workflowSnapshot: {}, updatedAt: time, turns: [], messages: [],
  execution: { task: '任务', membersSnapshot: [member('a', '起草者', 0), member('b', '审查者', 1)], nextTurnIndex: 0, elapsedExecutionMs: 0, mode: 'automatic', maxTurns: 3,
    maxDurationMs: 300000, outputTokenLimit: 1024, currentTurnId: null, currentAgentId: null, startedAt: time, finishedAt: null, createdAt: time, updatedAt: time },
  host: { instructions: [], actions: [] },
};
function Host({ command, api }: { command: HostApiContract['command']; api: AttachmentApiContract }) {
  const commands = useHostCommands({ command }, 'run', () => {});
  return <HostComposer snapshot={paused} commands={commands} instructionsWritable attachmentApi={api} imageSupport={agent => agent.providerId ? 'yes' : 'no'} />;
}

describe('attaching images in the interjection box (D147)', () => {
  it('images alone can be sent; the box empties once Main has them, and everyone who cannot see them is named', async () => {
    const command = vi.fn<HostApiContract['command']>(async input => ({ runId: 'run', actionId: 'x', kind: input.kind, duplicate: false }));
    render(<Host command={command} api={accepting()} />);
    const send = screen.getByRole('button', { name: '发送插话' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await pick([file('a.png')]);
    await waitFor(() => expect(send.disabled).toBe(false));
    expect(screen.getByRole('note').textContent).toBe('这场讨论的成员都看不到图片，他们只会收到一句说明。');
    await act(async () => { fireEvent.click(send); });
    await waitFor(() => expect(command).toHaveBeenCalledTimes(1));
    expect(command.mock.calls[0][0]).toMatchObject({ kind: 'interject', content: '', attachmentIds: [expect.stringMatching(/^[0-9a-f]{64}$/u)] });
    await waitFor(() => expect(tray()).toBeNull());
  });

  it('a refused interjection keeps its words and images', async () => {
    const command = vi.fn<HostApiContract['command']>(async () => { throw publicError('invalid_state'); });
    render(<Host command={command} api={accepting()} />);
    await pick([file('a.png')]);
    await waitFor(() => expect(within(tray()!).getAllByRole('img')).toHaveLength(1));
    const box = screen.getByRole('textbox', { name: '主持人插话' });
    fireEvent.change(box, { target: { value: '看这张' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '发送插话' })); });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('插话没有发送'));
    expect((box as HTMLTextAreaElement).value).toBe('看这张');
    expect(within(tray()!).getAllByRole('img')).toHaveLength(1);
  });

  it('naming a member with an image sends both', async () => {
    const request = vi.fn(async () => ({ ok: true as const, message: '' }));
    const options = [{ agentId: 'b', name: '审查者', available: true, reason: '' }];
    const result = await sendInterjection('@审查者 ', options, undefined, request as never, undefined, ['f'.repeat(64)]);
    expect(result.clear).toBe(true);
    expect(request).toHaveBeenCalledWith('interject', { kind: 'interject', content: '@审查者 ', attachmentIds: ['f'.repeat(64)] }, { quiet: true });
  });

  it('a draft survives leaving the discussion while the window is open', () => {
    const initial: DraftImage[] = [{ key: 'k', attachment: stored() }];
    const Draft = () => { const draft = useImageDraft(accepting(), { initial, save: () => {} }); return <p>{draft.attachmentIds.length}</p>; };
    render(<Draft />);
    expect(screen.getByText('1')).toBeTruthy();
  });
});

describe('who can see images (D147)', () => {
  const provider = (id: string, kind: string) => ({ id, kind }) as never;
  const row = (providerId: string, baseUrl: string) => ({ providerId, baseUrl, models: [] }) as never;
  it('follows the catalog, as Main does', () => {
    const providers = [provider('ds', 'compatible'), provider('demo', 'mock')];
    const readiness = [row('ds', 'https://api.deepseek.com')];
    expect(memberImageSupport({ providerId: 'ds', modelId: 'deepseek-flash' }, providers, readiness)).toBe('yes');
    expect(memberImageSupport({ providerId: 'ds', modelId: 'deepseek-v4-pro' }, providers, readiness)).toBe('no');
    expect(memberImageSupport({ providerId: 'ds', modelId: 'deepseek-later' }, providers, readiness)).toBe('unknown');
    expect(memberImageSupport({ providerId: 'demo', modelId: 'mock' }, providers, readiness)).toBe('no');
    expect(memberImageSupport({ providerId: null, modelId: 'mock' }, providers, readiness)).toBe('no');
    expect(memberImageSupport({ providerId: 'ds', modelId: 'deepseek-flash' }, providers, undefined)).toBeUndefined();
  });
  it('names who will not see images, and says nothing when everyone can', () => {
    expect(imageAudienceNotes([{ name: 'A', support: 'yes' }, { name: 'B', support: 'yes' }])).toEqual([]);
    expect(imageAudienceNotes([{ name: 'A', support: 'yes' }, { name: 'B', support: 'no' }, { name: 'C', support: 'no' }])).toEqual(['B、C的模型看不到图片，只会收到一句说明。']);
    expect(imageAudienceNotes([{ name: 'A', support: 'no' }])).toEqual(['这场讨论的成员都看不到图片，他们只会收到一句说明。']);
    expect(imageAudienceNotes([{ name: 'A', support: 'unknown' }, { name: 'B', support: 'yes' }])).toEqual(['A的模型不确定能否看图；如果服务商拒绝，换一个能看图的模型。']);
  });
});

describe('images in the timeline (D147)', () => {
  it('thumbnails open large; a file that cannot be read says so', () => {
    const images = [stored(), { ...stored(), mediaType: 'image/jpeg' as const, byteCount: 2 * 1024 * 1024 }];
    render(<MessageImages images={images} />);
    const buttons = screen.getAllByRole('button', { name: /看大图/u });
    expect(buttons).toHaveLength(2);
    expect(within(buttons[0]).getByRole('img').getAttribute('src')).toBe(imageUrl(images[0].id));
    fireEvent.click(buttons[1]);
    expect(screen.getByRole('heading', { name: '图片 2 / 2' })).toBeTruthy();
    expect(screen.getByText('JPEG · 2.0 MB')).toBeTruthy();
    // The arrow keys work wherever focus is in the viewer.
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(screen.getByRole('heading', { name: '图片 1 / 2' })).toBeTruthy();
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(screen.getByRole('heading', { name: '图片 2 / 2' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '下一张' }));
    expect(screen.getByRole('heading', { name: '图片 1 / 2' })).toBeTruthy();
    fireEvent.error(within(buttons[0]).getByRole('img'));
    expect(within(buttons[0]).getByRole('img', { name: '图片文件读不出来了' })).toBeTruthy();
  });
  it('nothing attached, nothing shown', () => {
    const { container } = render(<MessageImages images={undefined} />);
    expect(container.firstChild).toBeNull();
  });
});
