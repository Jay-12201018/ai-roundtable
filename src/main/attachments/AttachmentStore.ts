import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ContractError } from '../../shared/contracts/errors';
import { addImageInputSchema, attachmentIdSchema, sniffImageType, type AddImageInput, type ImageAttachment, type ImageMediaType } from '../../shared/schemas/attachment';
import type { Database } from '../database/Database';

const extensions: Record<ImageMediaType, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const storedFile = /^[0-9a-f]{64}\.(?:png|jpg|webp)$/u;

/**
 * D147: the host's images, in one folder Main owns. A file is named by the hash of its bytes, never by anything the page or the
 * original file said. The page hands over bytes; only this class reads or writes them. Nothing here logs.
 */
export class AttachmentStore {
  constructor(private readonly database: Database, private readonly root: string) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
  }

  private path(attachment: Pick<ImageAttachment, 'id' | 'mediaType'>) { return join(this.root, `${attachment.id}.${extensions[attachment.mediaType]}`); }

  async addImage(input: AddImageInput): Promise<ImageAttachment> {
    const parsed = addImageInputSchema.safeParse(input);
    if (!parsed.success) throw new ContractError('invalid_input', 'bytes');
    const { bytes } = parsed.data;
    const mediaType = sniffImageType(bytes);
    if (!mediaType) throw new ContractError('image_unsupported');
    const attachment: ImageAttachment = { id: createHash('sha256').update(bytes).digest('hex'), mediaType, byteCount: bytes.byteLength };
    const target = this.path(attachment);
    // Written beside the target and moved into place, so a file under its final name is always whole.
    const partial = join(this.root, `${randomUUID()}.partial`);
    try {
      await writeFile(partial, bytes, { mode: 0o600 });
      await rename(partial, target);
    } catch (error) {
      await rm(partial, { force: true }).catch(() => {});
      throw error;
    }
    this.database.insertAttachment(attachment);
    return attachment;
  }

  /** An image's bytes, checked against its name: what is sent or shown is exactly what the host attached. */
  async read(id: string): Promise<{ attachment: ImageAttachment; bytes: Uint8Array }> {
    if (!attachmentIdSchema.safeParse(id).success) throw new ContractError('attachment_missing');
    const attachment = this.database.getAttachment(id);
    if (!attachment) throw new ContractError('attachment_missing');
    let bytes: Uint8Array;
    try { bytes = await readFile(this.path(attachment)); } catch { throw new ContractError('attachment_missing'); }
    if (createHash('sha256').update(bytes).digest('hex') !== id) throw new ContractError('attachment_missing');
    return { attachment, bytes };
  }

  /**
   * At startup, before any page exists: drops what was attached but never sent (a draft does not outlive the window) and any file
   * without a record. A file in use is never touched, and nothing else in this folder is either.
   */
  sweep(): void {
    const kept = new Set(this.database.sweepUnusedAttachments().map(attachment => `${attachment.id}.${extensions[attachment.mediaType]}`));
    if (!existsSync(this.root)) return;
    for (const name of readdirSync(this.root)) {
      if (name.endsWith('.partial') || storedFile.test(name) && !kept.has(name)) rmSync(join(this.root, name), { force: true });
    }
  }
}
