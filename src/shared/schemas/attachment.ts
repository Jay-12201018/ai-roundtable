import { z } from 'zod';

/** D147: what the host can attach. Main decides by the file's first bytes; a name or a stated type counts for nothing. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGES_PER_MESSAGE = 4;
export const imageMediaTypeValues = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const imageMediaTypeSchema = z.enum(imageMediaTypeValues);
export type ImageMediaType = z.infer<typeof imageMediaTypeSchema>;

/** An attachment's identity is the SHA-256 of its bytes, so a path can never be smuggled in as an ID. */
export const attachmentIdSchema = z.string().regex(/^[0-9a-f]{64}$/u);
export const imageAttachmentSchema = z.object({
  id: attachmentIdSchema, mediaType: imageMediaTypeSchema, byteCount: z.number().int().min(1).max(MAX_IMAGE_BYTES),
}).strict();
export type ImageAttachment = z.infer<typeof imageAttachmentSchema>;
export const imageAttachmentsSchema = z.array(imageAttachmentSchema).max(MAX_IMAGES_PER_MESSAGE);
export const attachmentIdsSchema = z.array(attachmentIdSchema).min(1).max(MAX_IMAGES_PER_MESSAGE)
  .refine(ids => new Set(ids).size === ids.length, 'Duplicate attachment');

const isBytes = (value: unknown): value is Uint8Array => Object.prototype.toString.call(value) === '[object Uint8Array]';
/** The page sends bytes, never a path. The realm a value crosses from is not its type, so `instanceof` is not used. */
export const addImageInputSchema = z.object({
  bytes: z.custom<Uint8Array>(isBytes).refine(bytes => bytes.byteLength >= 1 && bytes.byteLength <= MAX_IMAGE_BYTES, 'Image size'),
}).strict();
export type AddImageInput = z.infer<typeof addImageInputSchema>;

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) => bytes.length >= offset + signature.length && signature.every((byte, index) => bytes[offset + index] === byte);
const ascii = (text: string) => [...text].map(char => char.charCodeAt(0));
/** The image type these bytes begin with, if it is one the app accepts. SVG and GIF are not. */
export function sniffImageType(bytes: Uint8Array): ImageMediaType | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'image/webp';
  return undefined;
}

/** D147: the only way the page shows a stored image. Main serves it by ID, from its own list, with its own type. */
export const IMAGE_SCHEME = 'rt-image';
export const imageUrl = (id: string) => `${IMAGE_SCHEME}://local/${id}`;
