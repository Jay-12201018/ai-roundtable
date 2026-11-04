import { z } from 'zod';

// The sandboxed bridge must validate without dynamically generated code under CSP.
z.config({ jitless: true });

export const PROTOCOL_VERSION = 1 as const;
export const idSchema = z.string().min(1).max(256).regex(/^\S+$/u);
// Common credential prefixes, wherever a Key may have been copied from.
const keyPrefix = /^(?:sk[-_]|rk[-_]|gh[pousr]_|github_pat_|xox[abprs]-|AKIA|ASIA)/u;
/**
 * True for text that looks like an API key rather than a model ID (D096): a credential prefix, or a long run of
 * letters and digits with no separators. Model IDs such as `deepseek-flash` or `models/some-model-2.5` never match.
 */
export function looksLikeApiKey(value: string): boolean {
  const text = value.trim();
  if (keyPrefix.test(text) && text.length >= 12) return true;
  return (text.match(/[A-Za-z0-9]{32,}/gu) ?? []).some(run => run.length >= 40 || /[A-Z]/u.test(run) && /[a-z]/u.test(run) && /\d/u.test(run));
}
export const modelIdSchema = idSchema.refine(value => !looksLikeApiKey(value), 'Model ID looks like an API key');
export const sequenceSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const timestampSchema = z.iso.datetime();
const credentialFields = new Set([
  'apikey', 'accesstoken', 'refreshtoken', 'authtoken', 'bearertoken', 'token', 'password',
  'secret', 'clientsecret', 'apisecret', 'credentials', 'authorization', 'privatekey', 'secretkey',
]);
// This field boundary preserves configuration and references; arbitrary text is not scanned.
function hasCredentialField(value: unknown): boolean {
  return value !== null && typeof value === 'object' && Object.entries(value).some(([field, nested]) =>
    credentialFields.has(field.replace(/[-_]/g, '').toLowerCase()) || hasCredentialField(nested));
}
export const workflowSnapshotSchema = z.record(z.string(), z.json())
  .refine((value) => !hasCredentialField(value), 'Credential fields are not allowed in workflow configuration');
