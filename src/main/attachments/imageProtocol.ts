import { protocol } from 'electron';
import { IMAGE_SCHEME } from '../../shared/schemas/attachment';
import type { AttachmentStore } from './AttachmentStore';

/** Must run before the app is ready. It grants no bypass of the page's CSP and no fetch access; `<img>` is all it is for. */
export function registerImageScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: IMAGE_SCHEME, privileges: { standard: true, secure: true } }]);
}

const refused = (status: number) => new Response(null, { status });
/** `rt-image://local/<sha256>`: a known ID, nothing else. No path reaches the disk, and the type is the one Main found when it stored the file. */
export async function serveImage(store: Pick<AttachmentStore, 'read'>, request: Pick<Request, 'url' | 'method'>): Promise<Response> {
  if (request.method !== 'GET') return refused(405);
  let url: URL;
  try { url = new URL(request.url); } catch { return refused(400); }
  const id = /^\/([0-9a-f]{64})$/u.exec(url.pathname)?.[1];
  if (url.protocol !== `${IMAGE_SCHEME}:` || url.host !== 'local' || url.search || !id) return refused(404);
  try {
    const { attachment, bytes } = await store.read(id);
    return new Response(Buffer.from(bytes), { headers: { 'content-type': attachment.mediaType, 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'", 'cache-control': 'private, max-age=31536000, immutable' } });
  } catch { return refused(404); }
}

export function handleImageRequests(store: Pick<AttachmentStore, 'read'>): void {
  protocol.handle(IMAGE_SCHEME, request => serveImage(store, request));
}
