import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { Database } from '../database/Database';
import { ContractError } from '../../shared/contracts/errors';
import { artifactEditInputSchema, artifactExportInputSchema, artifactListInputSchema, artifactVersionInputSchema, artifactKindLabels,
  type ArtifactCommandResult, type ArtifactEditInput, type ArtifactExportInput, type ArtifactExportResult, type ArtifactList, type ArtifactListInput,
  type ArtifactVersionDetail, type ArtifactVersionInput, type CodeCandidateList, type CodeContent } from '../../shared/schemas/artifact';
import { parseArtifact } from '../../shared/schemas/artifactParse';
import { affectedNumbers, artifactView, contentOf, isEffective, lastExportAt, rebasedSources, represented, sourceViews, versionView } from './view';
import { jsonExport, markdownExport, type ExportMeta } from './exportText';

type Notifier = { notifyArtifact(runId: string, payload: { artifactId: string; versionId: string; status: 'edited' | 'exported' }): void };
/** Main's save dialog; resolves to the path the host picked, or undefined when cancelled. */
export type ChooseSavePath = (defaultName: string, format: 'markdown' | 'json') => Promise<string | undefined>;

const parse = <T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success) throw new ContractError('invalid_input');
  return result.data;
};
/** A file name from the document title, without characters file systems refuse. */
const fileNameOf = (title: string, format: 'markdown' | 'json') =>
  `${title.replace(/[\u0000-\u001f\u007f\\/:*?"<>|]+/gu, '_').replace(/^[.\s]+|[.\s]+$/gu, '').slice(0, 80) || 'AI圆桌产物'}.${format === 'markdown' ? 'md' : 'json'}`;

/**
 * R14 (D118–D123): reading artifacts and the host's own writes — edit, export. Generation is a budgeted Run
 * request and lives in RunService. Everything here is append-only and idempotent per (runId, clientRequestId).
 */
export class ArtifactService {
  constructor(private readonly database: Database, private readonly runs: Notifier) {}

  list(input: ArtifactListInput): ArtifactList {
    const { runId } = parse(artifactListInputSchema, input);
    this.requireRun(runId);
    const snapshot = this.database.readRunSnapshot(runId);
    return { runId, artifacts: this.database.listArtifacts(runId).map(artifact => artifactView(artifact, snapshot)) };
  }

  getVersion(input: ArtifactVersionInput): ArtifactVersionDetail {
    const { runId, versionId } = parse(artifactVersionInputSchema, input);
    const { artifact, version, snapshot } = this.locate(runId, versionId);
    const content = contentOf(artifact.kind, version);
    return { runId, artifactId: artifact.id, kind: artifact.kind, version: versionView(artifact.kind, version, snapshot), rawOutput: version.rawOutput,
      ...(content ? { content: { kind: artifact.kind, data: content } as ArtifactVersionDetail['content'] } : {}), sources: sourceViews(version, snapshot) };
  }

  /**
   * D122: the host's own version, based on any finished version (including a failed or invalid one). It is checked by
   * the same parser as model output and is effective at once; its sources are re-recorded at the current versions of
   * the messages the edited version stood for (as D107), so it is no longer affected.
   */
  edit(input: ArtifactEditInput): ArtifactCommandResult {
    const { runId, clientRequestId, versionId, text } = parse(artifactEditInputSchema, input);
    return this.database.transaction(() => {
      const previous = this.database.findArtifactWrite(runId, clientRequestId);
      if (previous) {
        const found = previous.kind === 'version' ? this.database.listArtifacts(runId).find(item => item.versions.some(entry => entry.id === previous.id)) : undefined;
        const created = found?.versions.find(entry => entry.id === previous.id);
        if (!found || !created || created.origin !== 'edit' || created.parentVersionId !== versionId) throw new ContractError('invalid_input', 'clientRequestId');
        return { runId, artifactId: found.id, versionId: created.id, duplicate: true };
      }
      const { artifact, version, snapshot } = this.locate(runId, versionId);
      if (version.request?.status === 'generating') throw new ContractError('invalid_state');
      const sources = rebasedSources(snapshot, version.sources);
      const numbers = represented(snapshot, sources).touched.map(slot => slot.number);
      const result = parseArtifact(artifact.kind, text, { sourceNumbers: numbers });
      if (!result.ok) throw new ContractError('invalid_input', 'text');
      const id = randomUUID();
      this.database.insertArtifactVersion({ id, artifactId: artifact.id, runId, origin: 'edit', parentVersionId: versionId, clientRequestId, sources,
        edit: { rawOutput: result.json, contentJson: result.json } });
      this.runs.notifyArtifact(runId, { artifactId: artifact.id, versionId: id, status: 'edited' });
      return { runId, artifactId: artifact.id, versionId: id, duplicate: false };
    });
  }

  /**
   * D122: Markdown or JSON rendered from the effective document only. Clipboard returns the text for the page to copy;
   * a file is written by Main to the path the host picked in the system dialog — never for a code candidate (R15).
   */
  async export(input: ArtifactExportInput, choosePath?: ChooseSavePath): Promise<ArtifactExportResult> {
    const { runId, clientRequestId, versionId, format, target } = parse(artifactExportInputSchema, input);
    const previous = this.database.findArtifactWrite(runId, clientRequestId);
    const recorded = previous?.kind === 'export' ? this.database.getArtifactExport(previous.id) : undefined;
    if (previous && (!recorded || recorded.versionId !== versionId || recorded.format !== format || recorded.target !== target)) throw new ContractError('invalid_input', 'clientRequestId');
    const { artifact, version, snapshot } = this.locate(runId, versionId);
    if (!isEffective(version)) throw new ContractError('invalid_state');
    if (target === 'file' && artifact.kind === 'code') throw new ContractError('unsupported');
    const content = contentOf(artifact.kind, version)!;
    const numbers = represented(snapshot, version.sources).touched.map(slot => slot.number);
    const meta: ExportMeta = { kind: artifact.kind, versionNumber: version.number, ...(numbers.length ? { firstNumber: Math.min(...numbers), lastNumber: Math.max(...numbers) } : {}),
      affected: affectedNumbers(snapshot, version.sources).length > 0 };
    const text = format === 'markdown' ? markdownExport(content, meta) : jsonExport(content, meta);
    const result = { runId, versionId, format, target };
    if (recorded) return { ...result, ...(target === 'clipboard' ? { text } : {}), saved: target === 'file', ...(recorded.fileName ? { fileName: recorded.fileName } : {}), duplicate: true };
    let fileName: string | undefined;
    if (target === 'file') {
      if (!choosePath) throw new ContractError('unsupported');
      const path = await choosePath(fileNameOf(content.title || artifactKindLabels[artifact.kind], format), format);
      if (!path) return { ...result, saved: false, duplicate: false };
      await writeFile(path, text, { encoding: 'utf8', mode: 0o600 });
      fileName = basename(path);
    }
    this.database.transaction(() => {
      this.database.insertArtifactExport({ id: randomUUID(), versionId, runId, clientRequestId, format, target, ...(fileName ? { fileName } : {}) });
      this.runs.notifyArtifact(runId, { artifactId: artifact.id, versionId, status: 'exported' });
    });
    return { ...result, ...(target === 'clipboard' ? { text } : {}), saved: target === 'file', ...(fileName ? { fileName } : {}), duplicate: false };
  }

  /**
   * D123: what R15 may consume — per code artifact, its latest version that passed validation. Failed or invalid
   * versions are never listed.
   */
  listCodeCandidates(input: ArtifactListInput): CodeCandidateList {
    const { runId } = parse(artifactListInputSchema, input);
    this.requireRun(runId);
    const snapshot = this.database.readRunSnapshot(runId);
    const candidates = this.database.listArtifacts(runId).filter(artifact => artifact.kind === 'code').flatMap(artifact => {
      const version = [...artifact.versions].reverse().find(isEffective);
      if (!version) return [];
      const content = contentOf('code', version) as CodeContent;
      return [{ runId, roomId: artifact.roomId, artifactId: artifact.id, versionId: version.id, versionNumber: version.number,
        status: lastExportAt(version) ? 'exported' as const : 'valid' as const, affected: affectedNumbers(snapshot, version.sources).length > 0,
        title: content.title, summary: content.summary, files: content.files, notes: content.notes, sourceMessageIds: version.sources,
        createdAt: version.createdAt }];
    });
    return { runId, candidates };
  }

  private requireRun(runId: string): void {
    if (!this.database.getRun(runId)) throw new ContractError('not_found');
  }

  /** The artifact version of this Run; a version id of another Run is not found here (D121). */
  private locate(runId: string, versionId: string) {
    this.requireRun(runId);
    const artifacts = this.database.listArtifacts(runId);
    const artifact = artifacts.find(item => item.versions.some(version => version.id === versionId));
    const version = artifact?.versions.find(item => item.id === versionId);
    if (!artifact || !version) throw new ContractError('not_found');
    return { artifact, version, snapshot: this.database.readRunSnapshot(runId) };
  }
}
