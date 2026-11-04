// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Sqlite from 'better-sqlite3';
import { closeFixtures, hostFixture, roomId, startFree } from '../host/fixtures';
import { ArtifactService } from '../../../src/main/artifact/ArtifactService';
import { validateDatabase } from '../../../src/main/database/recovery/validateDatabase';
import { artifactKindValues, artifactListSchema, artifactVersionDetailSchema, codeCandidateListSchema, type ArtifactKind } from '../../../src/shared/schemas/artifact';
import { runSnapshotSchema } from '../../../src/shared/schemas/run';
import { validDocuments, text } from '../../unit/artifacts/fixtures';

afterEach(closeFixtures);
type Fixture = ReturnType<typeof hostFixture>;

function setup(filename?: string) {
  const f = hostFixture(undefined, filename);
  const artifacts = new ArtifactService(f.db, f.run);
  return { ...f, artifacts };
}
/** A finished three-message discussion. */
async function finished(f: Fixture) {
  const { runId } = await startFree(f, { mode: 'automatic', maxTurns: 3 });
  await f.run.waitForIdle(runId);
  expect(f.run.getSnapshot(runId).status).toBe('completed');
  return runId;
}
async function generate(f: ReturnType<typeof setup>, runId: string, kind: ArtifactKind, clientRequestId: string, answer = text(validDocuments[kind]), artifactId?: string) {
  f.provider.answers.set(f.provider.inputs.length, answer);
  const preview = f.run.previewArtifact({ runId, kind, ...(artifactId ? { artifactId } : {}) });
  expect(preview.available).toBe(true);
  const result = f.run.generateArtifact({ runId, clientRequestId, kind, agentId: preview.agentId!, ...(artifactId ? { artifactId } : {}) });
  await f.run.waitForIdle(runId);
  return { preview, result, version: () => f.artifacts.getVersion({ runId, versionId: result.versionId }) };
}

describe('structured artifacts (D118–D123)', () => {
  it('generates all four kinds from the numbered discussion; a valid model version can be used at once (D139)', async () => {
    const f = setup();
    const runId = await finished(f);
    for (const kind of artifactKindValues) {
      const before = f.provider.inputs.length;
      const { preview, result, version } = await generate(f, runId, kind, `g-${kind}`);
      expect(preview).toMatchObject({ kind, agentId: 'a', messageCount: 3, lastNumber: 3, outputTokenLimit: 8192 });
      expect(f.provider.inputs.length).toBe(before + 1);
      const request = f.provider.inputs.at(-1)!;
      expect(request).toMatchObject({ agentRole: `artifact:${kind}`, outputTokenLimit: 8192 });
      const transcript = request.messages.at(-1)!.content;
      // The kind's requirements come after the discussion, right before the answer (D120).
      expect(transcript).toContain('只输出一个 JSON 对象');
      expect(transcript).toContain('对应字段写 null，表示“未知”');
      expect(transcript.indexOf('【整理要求')).toBeGreaterThan(transcript.indexOf('【第 3 条'));
      expect(transcript.includes('{"nothing"')).toBe(kind !== 'minutes');
      expect(transcript).toContain('【第 1 条 · 成员「成员 a」· assistant】');
      expect(transcript).toContain('【第 3 条 · 成员「成员 c」· assistant】');
      expect(transcript).toContain('【请输出 JSON】\n请根据以上第 1–3 条发言整理');
      const detail = version();
      expect(artifactVersionDetailSchema.safeParse(detail).success).toBe(true);
      expect(detail).toMatchObject({ kind, version: { number: 1, origin: 'generate', status: 'valid', agentId: 'a', firstNumber: 1, lastNumber: 3, affectedNumbers: [], issues: [] },
        content: { kind, data: validDocuments[kind] }, rawOutput: text(validDocuments[kind]) });
      expect(detail.sources.map(source => source.number)).toEqual([1, 2, 3]);
    }
    const list = f.artifacts.list({ runId });
    expect(artifactListSchema.safeParse(list).success).toBe(true);
    expect(list.artifacts.map(item => item.kind)).toEqual([...artifactKindValues]);
    // The run status and its Turns are untouched: artifacts are not part of the discussion.
    const snapshot = f.run.getSnapshot(runId);
    expect(snapshot).toMatchObject({ status: 'completed' });
    expect(snapshot.turns).toHaveLength(3);
    expect(runSnapshotSchema.safeParse(snapshot).success).toBe(true);
    // A repeated delivery returns the same version without another request.
    const calls = f.provider.inputs.length;
    expect(f.run.generateArtifact({ runId, clientRequestId: 'g-prd', kind: 'prd', agentId: 'a' })).toMatchObject({ duplicate: true, artifactId: list.artifacts[0].artifactId });
    expect(() => f.run.generateArtifact({ runId, clientRequestId: 'g-prd', kind: 'minutes', agentId: 'a' })).toThrowError(expect.objectContaining({ detail: expect.objectContaining({ code: 'invalid_input', field: 'clientRequestId' }) }));
    expect(f.provider.inputs.length).toBe(calls);
  });

  it('keeps an invalid output in full with field-located errors, retries nothing, and lets the host fix it as a new version', async () => {
    const f = setup();
    const runId = await finished(f);
    const broken = { ...validDocuments.actions, items: [{ id: 'A1', task: '调研', due: '周五', status: 'later', sources: [9] }] };
    const raw = '```json\n' + text(broken) + '\n```';
    const before = f.provider.inputs.length;
    const { result, version } = await generate(f, runId, 'actions', 'g1', raw);
    expect(f.provider.inputs.length).toBe(before + 1);
    const failed = version();
    expect(failed.version.status).toBe('invalid');
    expect(failed.rawOutput).toBe(raw);
    expect(failed.content).toBeUndefined();
    expect(failed.version.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'items[0].owner', label: '事项 第 1 项 › 负责人', message: expect.stringContaining('缺少这个字段'), line: expect.any(Number) }),
      expect.objectContaining({ path: 'items[0].status', message: expect.stringContaining('todo（未开始）') }),
    ]));
    // No automatic retry: nothing else is sent while the host looks at it.
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(f.provider.inputs.length).toBe(before + 1);
    // The host's edit is checked by the same parser; an invalid one is refused and records nothing.
    expect(() => f.artifacts.edit({ runId, clientRequestId: 'e0', versionId: result.versionId, text: raw })).toThrowError(expect.objectContaining({ detail: expect.objectContaining({ code: 'invalid_input', field: 'text' }) }));
    const fixed = { ...broken, items: [{ id: 'A1', task: '调研', owner: null, due: '周五', status: 'todo', sources: [1] }] };
    const edited = f.artifacts.edit({ runId, clientRequestId: 'e1', versionId: result.versionId, text: text(fixed) });
    expect(f.artifacts.edit({ runId, clientRequestId: 'e1', versionId: result.versionId, text: text(fixed) })).toMatchObject({ duplicate: true, versionId: edited.versionId });
    const list = f.artifacts.list({ runId }).artifacts[0];
    expect(list.versions.map(item => [item.number, item.origin, item.status])).toEqual([[1, 'generate', 'invalid'], [2, 'edit', 'valid']]);
    expect(list.versions[1]).toMatchObject({ parentVersionId: result.versionId });
    expect(version().rawOutput).toBe(raw);
    // Regenerating is a host decision: a new version, the earlier ones kept.
    await generate(f, runId, 'actions', 'g2', text(validDocuments.actions), list.artifactId);
    expect(f.artifacts.list({ runId }).artifacts[0].versions.map(item => [item.number, item.origin, item.status])).toEqual([[1, 'generate', 'invalid'], [2, 'edit', 'valid'], [3, 'regenerate', 'valid']]);
  });

  it('says when an output was cut off at the limit, and keeps partial output of a failed or stopped request', async () => {
    const f = setup();
    const runId = await finished(f);
    f.provider.outcomes.set(f.provider.inputs.length, 'length');
    const cut = await generate(f, runId, 'prd', 'g1', text(validDocuments.prd).slice(0, 200));
    expect(cut.version().version).toMatchObject({ status: 'invalid', request: { status: 'completed', finishReason: 'length' } });
    expect(cut.version().version.issues[0].message).toBe('输出达到 8192 tokens 的上限被截断，内容不完整');
    f.provider.outcomes.set(f.provider.inputs.length, 'fail');
    const failed = await generate(f, runId, 'prd', 'g2', '{"title": "半截', cut.result.artifactId);
    expect(failed.version()).toMatchObject({ rawOutput: '{"title": "半截', version: { status: 'failed', request: { status: 'failed' }, issues: [] } });
    const index = f.provider.inputs.length;
    f.provider.hold.add(index); f.provider.answers.set(index, '{"title": "停');
    const held = f.run.generateArtifact({ runId, clientRequestId: 'g3', kind: 'prd', agentId: 'a', artifactId: cut.result.artifactId });
    await f.provider.started(index);
    expect(f.artifacts.getVersion({ runId, versionId: held.versionId }).version.status).toBe('generating');
    expect(() => f.run.previewArtifact({ runId, kind: 'minutes' })).not.toThrow();
    expect(f.run.previewArtifact({ runId, kind: 'minutes' })).toMatchObject({ available: false, reason: 'busy' });
    await f.command({ runId, kind: 'abortGeneration' });
    await f.run.waitForIdle(runId);
    expect(f.artifacts.getVersion({ runId, versionId: held.versionId })).toMatchObject({ rawOutput: '{"title": "停', version: { status: 'failed', request: { status: 'aborted' } } });
    expect(f.run.getSnapshot(runId).status).toBe('completed');
  });

  it('records the public error code of a failed or stopped request, and retries nothing (D125)', async () => {
    const f = setup();
    const runId = await finished(f);
    for (const code of ['network_error', 'rate_limited', 'authentication_failed', 'invalid_response', 'internal_error'] as const) {
      f.provider.outcomes.set(f.provider.inputs.length, { error: code });
      const before = f.provider.inputs.length;
      const { version } = await generate(f, runId, 'prd', `g-${code}`, '{"title": "半');
      expect(version().version).toMatchObject({ status: 'failed', request: { status: 'failed', errorCode: code } });
      expect(version().rawOutput).toBe('{"title": "半');
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(f.provider.inputs.length).toBe(before + 1);
    }
    // A provider timeout is a failure of this request, with its code (D146); a host stop says cancelled.
    f.provider.outcomes.set(f.provider.inputs.length, { error: 'timeout' });
    expect((await generate(f, runId, 'actions', 'g-timeout')).version().version.request).toMatchObject({ status: 'failed', errorCode: 'timeout' });
    const index = f.provider.inputs.length;
    f.provider.hold.add(index);
    const held = f.run.generateArtifact({ runId, clientRequestId: 'g-stop', kind: 'code', agentId: 'a' });
    await f.provider.started(index);
    await f.command({ runId, kind: 'abortGeneration' });
    await f.run.waitForIdle(runId);
    expect(f.artifacts.getVersion({ runId, versionId: held.versionId }).version.request).toMatchObject({ status: 'aborted', errorCode: 'cancelled' });
    // The database keeps only a public code, and only on a request that ended without a result.
    const raw = (f.db as unknown as { db: Sqlite.Database }).db;
    expect(() => raw.prepare("UPDATE artifact_requests SET error_code='rate_limited' WHERE error_code='network_error'").run()).toThrow(/Invalid artifact request transition/u);
    // The CHECK refuses anything that is not a code on a request that ended without a result.
    const run = raw.prepare('SELECT run_id FROM artifact_requests LIMIT 1').pluck().get() as string;
    raw.exec('DROP TRIGGER artifact_request_finish_once');
    expect(() => raw.prepare("UPDATE artifact_requests SET error_code='Upstream said: sk-secret' WHERE error_code='network_error'").run()).toThrow(/CHECK constraint failed/u);
    expect(() => raw.prepare("UPDATE artifact_requests SET status='completed' WHERE error_code='network_error'").run()).toThrow(/CHECK constraint failed/u);
    expect(run).toBe(runId);
  });

  it('records why a summary request failed in its event, without changing migration 9 (D125)', async () => {
    const f = setup();
    const runId = await finished(f);
    const preview = f.run.previewSummary({ runId });
    f.provider.outcomes.set(f.provider.inputs.length, { error: 'rate_limited' });
    const result = f.run.generateSummary({ runId, clientRequestId: 's1', agentId: preview.agentId!, throughSlotId: preview.throughSlotId! });
    await f.run.waitForIdle(runId);
    const snapshot = f.run.getSnapshot(runId);
    expect(snapshot.summaries![0].requests[0]).toMatchObject({ requestId: result.requestId, status: 'failed', errorCode: 'rate_limited' });
    expect(runSnapshotSchema.safeParse(snapshot).success).toBe(true);
    const events = f.db.listRunEvents(runId, 0).filter(event => event.type === 'summary_updated');
    expect(events.at(-1)!.payload).toEqual({ summaryId: result.summaryId, messageId: result.messageId, status: 'failed', errorCode: 'rate_limited' });
  });

  it('marks a version affected when a source message is edited, and an edit re-records its sources', async () => {
    const f = setup();
    const runId = await finished(f);
    const { result, version } = await generate(f, runId, 'minutes', 'g1');
    const first = f.run.getSnapshot(runId).turns[0].messageId!;
    await f.command({ runId, kind: 'editMessage', messageId: first, content: '主持人改过的第一条' });
    expect(version().version.affectedNumbers).toEqual([1]);
    expect(version().sources[0]).toMatchObject({ messageId: first, number: 1, active: false });
    expect(f.artifacts.listCodeCandidates({ runId }).candidates).toEqual([]);
    // Regenerating uses the current history and is not affected.
    const again = await generate(f, runId, 'minutes', 'g2', text(validDocuments.minutes), result.artifactId);
    expect(again.version().version.affectedNumbers).toEqual([]);
    expect(f.provider.inputs.at(-1)!.messages.at(-1)!.content).toContain('主持人改过的第一条');
    // A host edit of the old version is based on the current messages, so it is no longer affected.
    const edited = f.artifacts.edit({ runId, clientRequestId: 'e1', versionId: result.versionId, text: text(validDocuments.minutes) });
    const detail = f.artifacts.getVersion({ runId, versionId: edited.versionId });
    expect(detail.version.affectedNumbers).toEqual([]);
    expect(detail.sources.map(source => [source.number, source.active])).toEqual([[1, true], [2, true], [3, true]]);
  });

  it('sends the rule about revision notes only when the request carries such a note (D112)', async () => {
    const f = setup();
    const runId = await finished(f);
    const rule = '标注“已由主持人修改”的发言';
    await generate(f, runId, 'prd', 'g1');
    const plain = f.provider.inputs.at(-1)!.messages.at(-1)!.content;
    expect(plain).not.toContain(rule);
    // The remaining rules stay numbered without a gap.
    expect(plain).toMatch(/\n4\. sources 写这条内容依据的发言编号[^]*\n5\. 内容用简体中文/u);
    await f.command({ runId, kind: 'editMessage', messageId: f.run.getSnapshot(runId).turns[1].messageId!, content: '主持人改过的第二条' });
    await generate(f, runId, 'minutes', 'g2');
    const revised = f.provider.inputs.at(-1)!;
    expect(revised.messages.at(-1)!.content).toContain(rule);
    expect(revised.messages.at(-1)!.content).toMatch(/\n5\. 标注“已由主持人修改”的发言[^]*\n6\. 内容用简体中文/u);
    expect(revised.messages.at(-1)!.content).toContain('（此发言已由主持人修改');
  });

  it('gives every kind of one discussion the same request prefix, so later ones can hit the prompt cache (D120)', async () => {
    const f = setup();
    const runId = await finished(f);
    for (const kind of artifactKindValues) await generate(f, runId, kind, `g-${kind}`);
    const requests = f.provider.inputs.slice(-4);
    const prefix = (content: string) => content.slice(0, content.indexOf('【整理要求'));
    for (const request of requests.slice(1)) {
      expect(request.messages.slice(0, -1)).toEqual(requests[0].messages.slice(0, -1));
      expect(prefix(request.messages.at(-1)!.content)).toBe(prefix(requests[0].messages.at(-1)!.content));
    }
    expect(prefix(requests[0].messages.at(-1)!.content)).toContain('【第 3 条 · 成员');
    expect(new Set(requests.map(request => request.messages.at(-1)!.content)).size).toBe(4);
  });

  it('keeps "nothing of this kind" as its own result: never exported or handed to R15 (D124)', async () => {
    const f = setup();
    const runId = await finished(f);
    const reason = '讨论记录中没有出现任何代码设计，没有可整理的代码候选。';
    const { result, version } = await generate(f, runId, 'code', 'g1', JSON.stringify({ nothing: reason }));
    expect(version().version).toMatchObject({ status: 'empty', emptyReason: reason, issues: [] });
    expect(version().content).toBeUndefined();
    expect(version().rawOutput).toBe(JSON.stringify({ nothing: reason }));
    await expect(f.artifacts.export({ runId, clientRequestId: 'x1', versionId: result.versionId, format: 'json', target: 'clipboard' })).rejects.toMatchObject({ code: 'invalid_state' });
    expect(f.artifacts.listCodeCandidates({ runId }).candidates).toEqual([]);
    const raw = (f.db as unknown as { db: Sqlite.Database }).db;
    // The host's own version must be a document; writing one from scratch works.
    expect(() => f.artifacts.edit({ runId, clientRequestId: 'e0', versionId: result.versionId, text: JSON.stringify({ nothing: '手写' }) }))
      .toThrowError(expect.objectContaining({ detail: expect.objectContaining({ code: 'invalid_input', field: 'text' }) }));
    expect(f.artifacts.edit({ runId, clientRequestId: 'e1', versionId: result.versionId, text: text(validDocuments.code) })).toMatchObject({ duplicate: false });
    // Regenerating is still offered and adds a version.
    await generate(f, runId, 'code', 'g2', text(validDocuments.code), result.artifactId);
    expect(f.artifacts.list({ runId }).artifacts[0].versions.map(item => item.status)).toEqual(['empty', 'valid', 'valid']);
    // Minutes always exist: there, the same answer is a validation failure.
    const minutes = await generate(f, runId, 'minutes', 'g3', JSON.stringify({ nothing: reason }));
    expect(minutes.version().version).toMatchObject({ status: 'invalid', issues: [expect.objectContaining({ message: expect.stringContaining('会议纪要总能整理') })] });
  });

  it('uses a confirmed summary for the messages it covers and still tracks the originals behind it', async () => {
    const f = setup();
    const { runId } = await startFree(f, { mode: 'automatic', maxTurns: 5 });
    await f.run.waitForIdle(runId);
    const preview = f.run.previewSummary({ runId });
    const summary = f.run.generateSummary({ runId, clientRequestId: 's1', agentId: preview.agentId!, throughSlotId: preview.throughSlotId! });
    await f.run.waitForIdle(runId);
    f.run.confirmSummary({ runId, clientRequestId: 'c1', messageId: summary.messageId! });
    const { preview: artifactPreview, version } = await generate(f, runId, 'actions', 'g1');
    expect(artifactPreview).toMatchObject({ summarizedThrough: 3, lastNumber: 5 });
    const transcript = f.provider.inputs.at(-1)!.messages.at(-1)!.content;
    expect(transcript).toContain('【讨论摘要 · 覆盖第 1–3 条】');
    expect(transcript).not.toContain('【第 1 条');
    expect(transcript).toContain('【第 4 条 · 成员');
    expect(version().version).toMatchObject({ firstNumber: 1, lastNumber: 5, affectedNumbers: [] });
    expect(version().sources[0]).toMatchObject({ speaker: '讨论摘要', summary: { firstNumber: 1, lastNumber: 3 } });
    // Editing a message the summary covers still makes the artifact affected.
    await f.command({ runId, kind: 'editMessage', messageId: f.run.getSnapshot(runId).turns[1].messageId!, content: '改过的第二条' });
    expect(version().version.affectedNumbers).toEqual([2]);
  });

  it('refuses sources and versions of another Run', async () => {
    const f = setup();
    const runA = await finished(f);
    const { result } = await generate(f, runA, 'prd', 'g1');
    f.db.insertRoom({ id: 'other-room', name: 'Other', objective: '' });
    const runB = await finished(f);
    expect(() => f.artifacts.getVersion({ runId: runB, versionId: result.versionId })).toThrowError(expect.objectContaining({ code: 'not_found' }));
    expect(() => f.run.generateArtifact({ runId: runB, clientRequestId: 'x', kind: 'prd', agentId: 'a', artifactId: result.artifactId })).toThrowError(expect.objectContaining({ code: 'not_found' }));
    const foreign = f.run.getSnapshot(runA).turns[0].messageId!;
    f.db.insertArtifact({ id: 'b-art', runId: runB, roomId, kind: 'prd', clientRequestId: 'b' });
    expect(() => f.db.insertArtifactVersion({ id: 'b-v1', artifactId: 'b-art', runId: runB, origin: 'generate', clientRequestId: 'b', agentId: 'a', sources: [foreign] }))
      .toThrowError(expect.objectContaining({ detail: expect.objectContaining({ code: 'invalid_input', field: 'sources' }) }));
    // The database refuses it too, even past the service.
    const raw = (f.db as unknown as { db: Sqlite.Database }).db;
    raw.prepare(`INSERT INTO artifact_versions(id,artifact_id,run_id,version_number,origin,parent_version_id,client_request_id,agent_id,validation,raw_output,content_json,issues_json,created_at,updated_at)
      VALUES('b-v1','b-art',?,1,'generate',NULL,'b','a','pending','',NULL,NULL,'t','t')`).run(runB);
    expect(() => raw.prepare("INSERT INTO artifact_sources(version_id,message_id,run_id,position) VALUES('b-v1',?,?,0)").run(foreign, runB)).toThrow(/Invalid artifact source/u);
    expect(() => raw.prepare("INSERT INTO artifact_sources(version_id,message_id,run_id,position) VALUES('b-v1',?,?,0)").run(foreign, runA)).toThrow(/Invalid artifact source/u);
    expect(() => raw.prepare("INSERT INTO artifacts(id,run_id,room_id,kind,client_request_id,created_at) VALUES('bad',?,'other-room','prd','c','t')").run(runA)).toThrow(/Invalid artifact identity/u);
    // Versions are append-only and validated once.
    expect(() => raw.prepare("UPDATE artifact_versions SET raw_output='x' WHERE id=?").run(result.versionId)).toThrow(/immutable/u);
    expect(() => raw.prepare('DELETE FROM artifact_versions WHERE id=?').run(result.versionId)).toThrow(/append-only/u);
  });

  it('exports only the effective document as Markdown or JSON, and saves files only where the host chooses', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'r14-export-'));
    try {
      const f = setup();
      const runId = await finished(f);
      const { result } = await generate(f, runId, 'prd', 'g1');
      const markdown = await f.artifacts.export({ runId, clientRequestId: 'x1', versionId: result.versionId, format: 'markdown', target: 'clipboard' });
      expect(markdown.text).toContain('# 校园跑腿平台');
      expect(markdown.text).toContain('### R1 下单（必须）');
      expect(markdown.text).toContain('未知（讨论中没有交代）');
      expect(markdown.text).toContain('（来源：第 1 条发言）');
      expect(markdown.text).toContain('依据讨论第 1–3 条发言');
      // Nothing from the request leaves: no rules, no transcript, no task text, no Key.
      for (const leaked of ['只输出一个 JSON 对象', '【第 1 条', 'Trusted task', 'answer 0']) expect(markdown.text).not.toContain(leaked);
      const json = await f.artifacts.export({ runId, clientRequestId: 'x2', versionId: result.versionId, format: 'json', target: 'clipboard' });
      expect(JSON.parse(json.text!)).toEqual({ format: 'ai-roundtable.artifact/v1', kind: 'prd', version: 1, basedOnMessages: { first: 1, last: 3 }, affected: false, content: validDocuments.prd });
      expect(f.artifacts.getVersion({ runId, versionId: result.versionId }).version.status).toBe('exported');
      let asked = 0;
      const cancelled = await f.artifacts.export({ runId, clientRequestId: 'x3', versionId: result.versionId, format: 'markdown', target: 'file' }, async () => { asked++; return undefined; });
      expect(cancelled).toMatchObject({ saved: false });
      expect(readdirSync(directory)).toEqual([]);
      const saved = await f.artifacts.export({ runId, clientRequestId: 'x4', versionId: result.versionId, format: 'markdown', target: 'file' },
        async (name, format) => { asked++; expect([name, format]).toEqual(['校园跑腿平台.md', 'markdown']); return join(directory, name); });
      expect(saved).toMatchObject({ saved: true, fileName: '校园跑腿平台.md' });
      expect(readdirSync(directory)).toEqual(['校园跑腿平台.md']);
      expect(await f.artifacts.export({ runId, clientRequestId: 'x4', versionId: result.versionId, format: 'markdown', target: 'file' }, async () => { asked++; return undefined; }))
        .toMatchObject({ saved: true, duplicate: true });
      expect(asked).toBe(2);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('never writes or runs a code candidate; R15 sees only a valid one', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'r14-code-'));
    const cwd = process.cwd();
    try {
      process.chdir(directory);
      const f = setup();
      const runId = await finished(f);
      const script = { ...validDocuments.code, files: [{ path: 'evil.js', language: 'javascript', description: null, content: "require('fs').writeFileSync('pwned', '1')" }] };
      const { result } = await generate(f, runId, 'code', 'g1', text(script));
      const list = f.artifacts.listCodeCandidates({ runId });
      expect(codeCandidateListSchema.safeParse(list).success).toBe(true);
      expect(list.candidates).toEqual([expect.objectContaining({ runId, roomId, artifactId: result.artifactId, versionId: result.versionId, versionNumber: 1, status: 'valid', affected: false,
        files: script.files, sourceMessageIds: expect.any(Array) })]);
      await expect(f.artifacts.export({ runId, clientRequestId: 'x1', versionId: result.versionId, format: 'markdown', target: 'file' }, async () => join(directory, 'x.md')))
        .rejects.toMatchObject({ code: 'unsupported' });
      const copy = await f.artifacts.export({ runId, clientRequestId: 'x2', versionId: result.versionId, format: 'markdown', target: 'clipboard' });
      expect(copy.text).toContain("```javascript\nrequire('fs')");
      expect(copy.text).toContain('未经执行，也没有写入任何文件');
      expect(readdirSync(directory)).toEqual([]);
      // A file save of a code candidate is refused by the database as well.
      const raw = (f.db as unknown as { db: Sqlite.Database }).db;
      expect(() => raw.prepare("INSERT INTO artifact_exports(id,version_id,run_id,client_request_id,format,target,file_name,created_at) VALUES('e',?,?,'c','markdown','file','x.md','t')").run(result.versionId, runId))
        .toThrow(/Invalid artifact export/u);
    } finally { process.chdir(cwd); rmSync(directory, { recursive: true, force: true }); }
  });

  it('keeps artifacts, versions and states across a restart; an interrupted request stays interrupted and is never resent', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'r14-restart-'));
    try {
      const filename = join(directory, 'db.sqlite');
      const f = setup(filename);
      const runId = await finished(f);
      const { result } = await generate(f, runId, 'actions', 'g1', '不是 JSON');
      f.artifacts.edit({ runId, clientRequestId: 'e1', versionId: result.versionId, text: text(validDocuments.actions) });
      const adopted = await generate(f, runId, 'minutes', 'g2');
      await f.artifacts.export({ runId, clientRequestId: 'x1', versionId: adopted.result.versionId, format: 'json', target: 'clipboard' });
      const index = f.provider.inputs.length;
      f.provider.hold.add(index); f.provider.answers.set(index, '{"title":');
      const held = f.run.generateArtifact({ runId, clientRequestId: 'g3', kind: 'code', agentId: 'a' });
      await f.provider.started(index);
      const before = f.artifacts.list({ runId });
      const reopened = new (f.db.constructor as typeof import('../../../src/main/database/Database').Database)(filename);
      await reopened.initialize();
      reopened.markInFlightRunsInterrupted();
      const again = new ArtifactService(reopened, { notifyArtifact: () => {} }).list({ runId });
      const statuses = (list: typeof again) => list.artifacts.map(artifact => [artifact.kind, artifact.versions.map(version => version.status)]);
      expect(statuses(again)).toEqual([['actions', ['invalid', 'valid']], ['minutes', ['exported']], ['code', ['failed']]]);
      expect(statuses(before).slice(0, 2)).toEqual(statuses(again).slice(0, 2));
      expect(again.artifacts[2].versions[0].request).toMatchObject({ requestId: held.requestId, status: 'interrupted' });
      expect(new ArtifactService(reopened, { notifyArtifact: () => {} }).getVersion({ runId, versionId: result.versionId }).rawOutput).toBe('不是 JSON');
      const raw = new Sqlite(filename, { readonly: true });
      try { expect(validateDatabase(raw).schemaVersion).toBe(14); } finally { raw.close(); }
      reopened.close();
      const calls = f.provider.inputs.length;
      await new Promise(resolve => setTimeout(resolve, 30));
      expect(f.provider.inputs.length).toBe(calls);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('refuses while the discussion is running, with nothing to base it on, or for an unknown writer', async () => {
    const f = setup();
    const index = 0;
    f.provider.hold.add(index);
    const { runId } = await startFree(f, { mode: 'automatic', maxTurns: 3 });
    await f.provider.started(index);
    expect(f.run.previewArtifact({ runId, kind: 'prd' })).toMatchObject({ available: false, reason: 'busy' });
    expect(() => f.run.generateArtifact({ runId, clientRequestId: 'g', kind: 'prd', agentId: 'a' })).toThrowError(expect.objectContaining({ code: 'invalid_state' }));
    f.provider.release(index);
    await f.run.waitForIdle(runId);
    expect(() => f.run.previewArtifact({ runId, kind: 'prd', agentId: 'nobody' })).toThrowError(expect.objectContaining({ code: 'not_found' }));
    expect(f.run.previewArtifact({ runId, kind: 'prd', agentId: 'c' })).toMatchObject({ available: true, agentId: 'c' });
  });
});

describe('recovery validation of migration 12', () => {
  it('rejects a database whose artifact protections or ledger cross-checks are missing', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'r14-validate-'));
    try {
      const filename = join(directory, 'db.sqlite');
      const f = setup(filename);
      const runId = await finished(f);
      await generate(f, runId, 'prd', 'g1');
      const other = await finished(f);
      await closeFixtures();
      const check = (tamper: string, message: RegExp) => {
        const copy = join(directory, `copy-${Math.random().toString(36).slice(2)}.sqlite`);
        const source = new Sqlite(filename); source.pragma('wal_checkpoint(TRUNCATE)'); source.close();
        copyFileSync(filename, copy);
        const raw = new Sqlite(copy);
        try { expect(validateDatabase(raw).schemaVersion).toBe(14); raw.exec(tamper); expect(() => validateDatabase(raw)).toThrow(message); } finally { raw.close(); }
      };
      check('DROP TRIGGER artifact_version_output_once', /Missing R14 artifact protection/u);
      check(`DROP TRIGGER artifact_version_output_once; UPDATE artifact_versions SET content_json='{"title":""}'`, /Missing R14 artifact protection/u);
      check(`DROP TRIGGER artifact_source_insert; DROP TRIGGER artifact_source_immutable; DROP TRIGGER artifact_source_no_delete;
        CREATE TRIGGER artifact_source_insert BEFORE INSERT ON artifact_sources BEGIN SELECT 1; END;
        CREATE TRIGGER artifact_source_immutable BEFORE UPDATE ON artifact_sources BEGIN SELECT 1; END;
        CREATE TRIGGER artifact_source_no_delete BEFORE DELETE ON artifact_sources BEGIN SELECT 1; END;
        UPDATE artifact_sources SET run_id='${other}';`, /Artifact source outside its Run/u);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
