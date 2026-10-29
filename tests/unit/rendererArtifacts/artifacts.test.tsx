import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArtifactReader, ArtifactsPanel, GenerateDialog, type ArtifactCommands } from '../../../src/renderer/features/artifacts';
import { requestFailureText } from '../../../src/renderer/features/timeline';
import type { RequestCharge } from '../../../src/shared/schemas/budget';
import type { HostCommands } from '../../../src/renderer/features/host/useHostCommands';
import type { ArtifactKind, ArtifactSummary, ArtifactVersion, ArtifactVersionDetail, ArtifactPreview } from '../../../src/shared/schemas/artifact';
import type { RunSnapshot } from '../../../src/shared/types/run';
import { validDocuments, text } from '../artifacts/fixtures';
import { time } from '../rendererSubscriptions/fixtures';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
// jsdom has no <dialog> modal API; the Modal falls back to the open attribute.
const snapshot = (status: RunSnapshot['status'] = 'completed'): RunSnapshot => ({ runId: 'run', roomId: 'room', status, sequence: 3, workflowSnapshot: {}, updatedAt: time, turns: [], messages: [] });
const version = (overrides: Partial<ArtifactVersion> = {}): ArtifactVersion => ({ versionId: 'v1', artifactId: 'art', number: 1, origin: 'generate', status: 'candidate', agentId: 'a',
  request: { requestId: 'r1', status: 'completed', finishReason: 'stop' }, issues: [], outputChars: 10, firstNumber: 1, lastNumber: 3, affectedNumbers: [], createdAt: time, updatedAt: time, ...overrides });
const summary = (kind: ArtifactKind, versions: ArtifactVersion[]): ArtifactSummary => ({ artifactId: 'art', runId: 'run', roomId: 'room', kind, createdAt: time, versions });
const detail = (kind: ArtifactKind, v: ArtifactVersion, raw: string, content?: unknown): ArtifactVersionDetail => ({ runId: 'run', artifactId: 'art', kind, version: v, rawOutput: raw,
  ...(content ? { content: { kind, data: content } as ArtifactVersionDetail['content'] } : {}),
  sources: [1, 2, 3].map(number => ({ messageId: `m${number}`, slotId: `s${number}`, number, speaker: `成员 ${number}`, active: true })) });
function commands(details: Record<string, ArtifactVersionDetail>, extra: Partial<ArtifactCommands> = {}): ArtifactCommands {
  return { available: true, artifacts: [], loadFailed: false, reload: vi.fn(async () => {}), preview: vi.fn(), generate: vi.fn(), adopt: vi.fn(async () => ({ runId: 'run', artifactId: 'art', versionId: 'v1', duplicate: false })),
    edit: vi.fn(async () => ({ runId: 'run', artifactId: 'art', versionId: 'v2', duplicate: false })), getVersion: vi.fn(async (id: string) => details[id]), copy: vi.fn(async () => {}), save: vi.fn(async () => {}),
    pending: undefined, error: undefined, notice: undefined, ...extra } as unknown as ArtifactCommands;
}
const host = { send: vi.fn(async () => true), pending: undefined } as unknown as HostCommands;

describe('artifact reader (R14)', () => {
  it('shows a candidate as a structured document; only adopting it makes it exportable', async () => {
    const v = version();
    const c = commands({ v1: detail('prd', v, text(validDocuments.prd), validDocuments.prd) });
    const onReveal = vi.fn();
    render(<ArtifactReader snapshot={snapshot()} artifact={summary('prd', [v])} commands={c} host={host} onClose={() => {}} onRegenerate={() => {}} onReveal={onReveal} />);
    await screen.findByText('校园跑腿平台');
    expect(screen.getByText(/采用之后才能复制和导出/u)).toBeTruthy();
    expect(screen.queryByText('复制 Markdown')).toBeNull();
    // The null background and the requirement without a source both read 未知.
    expect(screen.getAllByText('未知')).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: '第 1 条' })[0]);
    expect(onReveal).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole('button', { name: '采用这一版' }));
    expect(c.adopt).toHaveBeenCalledWith('v1');
  });

  it('offers copy and save for an effective document, and no file save for code', async () => {
    const v = version({ status: 'valid', adoptedAt: time });
    const c = commands({ v1: detail('code', v, text(validDocuments.code), validDocuments.code) });
    render(<ArtifactReader snapshot={snapshot()} artifact={summary('code', [v])} commands={c} host={host} onClose={() => {}} onRegenerate={() => {}} onReveal={() => {}} />);
    await screen.findByText('src/order/validate.ts');
    expect(screen.getByText('这些代码只在这里预览：不会执行，也不会写入任何文件。')).toBeTruthy();
    expect(screen.queryByText('另存为…')).toBeNull();
    expect(screen.getByText(/代码候选不能在这里存成文件/u)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '复制 JSON' }));
    expect(c.copy).toHaveBeenCalledWith('v1', 'json');
  });

  it('keeps an invalid output visible with its errors, and saves a fix only once it validates', async () => {
    const raw = '{\n  "title": "纪要",\n  "summary": 3\n}';
    const v = version({ status: 'invalid', issues: [{ path: 'summary', label: '概要', message: '应该是文本', line: 3 }] });
    const c = commands({ v1: detail('minutes', v, raw) });
    render(<ArtifactReader snapshot={snapshot()} artifact={summary('minutes', [v])} commands={c} host={host} onClose={() => {}} onRegenerate={() => {}} onReveal={() => {}} />);
    await screen.findByLabelText('原始输出', { selector: 'pre' });
    expect(screen.getByText(/格式检查没有通过：1 处问题/u)).toBeTruthy();
    expect(within(screen.getByLabelText('需要修改的地方')).getByText('应该是文本')).toBeTruthy();
    expect(document.querySelectorAll('.art-raw > span.is-bad')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '修改为有效版本…' }));
    const area = await screen.findByLabelText('产物 JSON');
    expect((area as HTMLTextAreaElement).value).toBe(raw);
    const save = screen.getByRole('button', { name: '保存为新版本' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(screen.getByText(/还有 \d+ 处问题/u)).toBeTruthy();
    const fixed = text(validDocuments.minutes);
    fireEvent.change(area, { target: { value: fixed } });
    await waitFor(() => expect(screen.getByText('格式正确，可以保存。')).toBeTruthy());
    fireEvent.click(save);
    await waitFor(() => expect(c.edit).toHaveBeenCalledWith('v1', fixed));
  });

  it('renders model HTML and Markdown as text: nothing runs and nothing loads', async () => {
    const document_ = { ...validDocuments.minutes, summary: '<script>window.__artifactPwned = 1</script><img src=x onerror="window.__artifactPwned=2"> [链接](javascript:alert(1))' };
    const v = version({ status: 'valid', adoptedAt: time });
    render(<ArtifactReader snapshot={snapshot()} artifact={summary('minutes', [v])} commands={commands({ v1: detail('minutes', v, text(document_), document_) })} host={host}
      onClose={() => {}} onRegenerate={() => {}} onReveal={() => {}} />);
    await screen.findByText('跑腿平台讨论纪要');
    const doc = document.querySelector('.art-doc')!;
    expect(doc.querySelector('script, img, a[href^="javascript"]')).toBeNull();
    expect(doc.textContent).toContain('<script>window.__artifactPwned = 1</script>');
    expect((window as unknown as { __artifactPwned?: number }).__artifactPwned).toBeUndefined();
  });

  it('says what an affected version is based on and offers regeneration right there', async () => {
    const v = version({ status: 'valid', adoptedAt: time, affectedNumbers: [1, 3] });
    const onRegenerate = vi.fn();
    render(<ArtifactReader snapshot={snapshot()} artifact={summary('actions', [v])} commands={commands({ v1: detail('actions', v, text(validDocuments.actions), validDocuments.actions) })} host={host}
      onClose={() => {}} onRegenerate={onRegenerate} onReveal={() => {}} />);
    await screen.findByText('跑腿平台行动清单');
    expect(screen.getByText(/依据的第 1、3 条发言在这一版写成后被修改或重新生成/u)).toBeTruthy();
    fireEvent.click(within(document.querySelector('.note') as HTMLElement).getByRole('button', { name: '重新生成…' }));
    expect(onRegenerate).toHaveBeenCalled();
    expect(screen.getAllByText('未知').length).toBeGreaterThanOrEqual(2); // A2 owner and due
  });
});

const charge = (overrides: Partial<RequestCharge>): RequestCharge => ({ requestId: 'r1', providerId: 'p', modelId: 'deepseek-flash', currency: 'CNY', state: 'unknown',
  inputTokenBound: 1000, outputTokenLimit: 4096, inputMicroPerToken: 2, outputMicroPerToken: 8, reservedMicro: 34_768, inputTokens: null, outputTokens: null, accountedMicro: null,
  chargedMicro: 34_768, priceReviewedAt: null, createdAt: time, updatedAt: time, kind: 'artifact', ...overrides });

describe('why a request ended without a result (D125)', () => {
  it('says the cause, what it cost and what to do, in plain words', () => {
    expect(requestFailureText({ status: 'failed', errorCode: 'network_error', charge: charge({}) }))
      .toBe('请求失败：网络中断或连不上服务。请求可能已经发出，费用暂记为未知（按上限 ¥0.0348 计）；可以到服务商控制台核对后，在用量页核销。没有自动重试，可以重新生成。');
    expect(requestFailureText({ status: 'failed', errorCode: 'rate_limited', charge: charge({ state: 'not_sent', chargedMicro: 0 }) }))
      .toBe('请求失败：服务商限流（请求太频繁）。请求没有发出，不收费。稍等一会儿再重新生成。');
    expect(requestFailureText({ status: 'failed', errorCode: 'authentication_failed' })).toBe('请求失败：Key 无效或已过期。请到“设置”检查 Key，再重新生成。');
    expect(requestFailureText({ status: 'aborted', errorCode: 'cancelled' })).toBe('这次请求已中止。没有自动重试，可以重新生成。');
    expect(requestFailureText({ status: 'interrupted' })).toBe('应用退出时这次请求还没完成，已标为中断。没有自动重试，可以重新生成。');
    expect(requestFailureText({ status: 'failed', charge: charge({ writeOffs: [{ writeOffId: 'w', amountMicro: 100, basis: '控制台', createdAt: time }], chargedMicro: 100 }) }))
      .toBe('请求失败（原因没有记录）。费用已按你核销的 ¥0.0001 计。没有自动重试，可以重新生成。');
    for (const text of [requestFailureText({ status: 'failed', errorCode: 'internal_error', charge: charge({}) })]) expect(text).not.toMatch(/sk-|Key：|upstream/u);
  });

  it('shows the reason on a failed version, with regenerate as the next step', async () => {
    const v = version({ status: 'failed', outputChars: 0, request: { requestId: 'r1', status: 'failed', errorCode: 'network_error' } });
    const snap = { ...snapshot(), charges: [charge({})] } as RunSnapshot;
    const onRegenerate = vi.fn();
    render(<ArtifactReader snapshot={snap} artifact={summary('prd', [v])} commands={commands({ v1: detail('prd', v, '') })} host={host} onClose={() => {}} onRegenerate={onRegenerate} onReveal={() => {}} />);
    await screen.findByText(/请求失败：网络中断或连不上服务。请求可能已经发出，费用暂记为未知/u);
    expect(screen.queryByText(/下面是已收到的部分/u)).toBeNull();
    const regenerate = screen.getByRole('button', { name: '重新生成…' });
    expect(regenerate.className).toContain('primary');
    fireEvent.click(regenerate);
    expect(onRegenerate).toHaveBeenCalled();
  });
});

describe('nothing of this kind (D124)', () => {
  it('shows the model\'s reason as its own state, without adopt or export, and lets the host regenerate or write one', async () => {
    const v = version({ status: 'empty', emptyReason: '讨论里没有涉及代码。' });
    const c = commands({ v1: detail('code', v, '{"nothing": "讨论里没有涉及代码。"}') });
    const onRegenerate = vi.fn();
    render(<ArtifactReader snapshot={snapshot()} artifact={summary('code', [v])} commands={c} host={host} onClose={() => {}} onRegenerate={onRegenerate} onReveal={() => {}} />);
    await screen.findByText('讨论里没有涉及代码。');
    expect(screen.getByText(/这不是模型出错，但这一版不能采用、复制或导出/u)).toBeTruthy();
    for (const name of ['采用这一版', '复制 Markdown', '复制 JSON', '另存为…']) expect(screen.queryByRole('button', { name })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重新生成…' }));
    expect(onRegenerate).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '自己写一版…' }));
    const area = await screen.findByLabelText('产物 JSON') as HTMLTextAreaElement;
    expect(JSON.parse(area.value)).toMatchObject({ title: '', files: [{ path: '', content: '' }] });
  });

  it('says before generating code that an honest "nothing" still costs a request', async () => {
    const preview: ArtifactPreview = { runId: 'run', kind: 'code', available: true, agents: [{ agentId: 'a', name: '综合者', providerId: 'p', modelId: 'deepseek-flash' }], agentId: 'a',
      messageCount: 3, lastNumber: 3, cost: { kind: 'priced', maxMicro: 70_000, remainingMicro: 999_300 }, outputTokenLimit: 8192 };
    render(<GenerateDialog snapshot={snapshot()} kind="code" commands={commands({}, { preview: vi.fn(async () => preview) })} onClose={() => {}} onStarted={() => {}} />);
    await screen.findByText('讨论里没有涉及代码时，模型会如实说明“没有可整理的内容”，不会硬凑代码；这次请求仍会产生费用。');
  });
});

describe('artifacts panel and generate dialog (R14)', () => {
  it('blocks generation while the discussion runs and opens the dialog when it can', () => {
    const onGenerate = vi.fn();
    const { rerender } = render(<ArtifactsPanel snapshot={snapshot('running')} commands={commands({})} onGenerate={onGenerate} onOpen={() => {}} />);
    expect(screen.getByText(/讨论进行中/u)).toBeTruthy();
    expect((screen.getAllByRole('button', { name: '生成…' })[0] as HTMLButtonElement).disabled).toBe(true);
    rerender(<ArtifactsPanel snapshot={snapshot('completed')} commands={commands({})} onGenerate={onGenerate} onOpen={() => {}} />);
    fireEvent.click(screen.getAllByRole('button', { name: '生成…' })[3]);
    expect(onGenerate).toHaveBeenCalledWith('code');
  });

  it('shows the writer, the basis and the maximum cost before anything is sent', async () => {
    const preview: ArtifactPreview = { runId: 'run', kind: 'actions', available: true, agents: [{ agentId: 'a', name: '综合者', providerId: 'p', modelId: 'deepseek-flash' }], agentId: 'a',
      messageCount: 3, lastNumber: 3, cost: { kind: 'priced', maxMicro: 41_300, remainingMicro: 999_300 }, outputTokenLimit: 4096 };
    const c = commands({}, { preview: vi.fn(async () => preview), generate: vi.fn(async () => ({ runId: 'run', artifactId: 'art', versionId: 'v1', duplicate: false })) });
    const onStarted = vi.fn();
    render(<GenerateDialog snapshot={snapshot()} kind="actions" commands={c} onClose={() => {}} onStarted={onStarted} />);
    await screen.findByText(/预计最高 ¥0\.0413（按高峰价和 4096 tokens 输出上限预留）/u);
    expect(screen.getByText(/根据这场讨论的第 1–3 条发言整理一份行动清单/u)).toBeTruthy();
    expect(c.generate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '生成（发送 1 次请求）' }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith({ artifactId: 'art', versionId: 'v1' }));
    expect(c.generate).toHaveBeenCalledWith({ kind: 'actions', agentId: 'a' });
  });

  it('explains why it cannot generate', async () => {
    const preview: ArtifactPreview = { runId: 'run', kind: 'prd', available: false, reason: 'busy', agents: [], messageCount: 0, cost: { kind: 'unavailable' }, outputTokenLimit: 4096 };
    render(<GenerateDialog snapshot={snapshot()} kind="prd" commands={commands({}, { preview: vi.fn(async () => preview) })} onClose={() => {}} onStarted={() => {}} />);
    await screen.findByText(/有请求正在进行/u);
    expect((screen.getByRole('button', { name: '生成' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
