import { z } from 'zod';

// The sandboxed bridge must validate without dynamically generated code under CSP.
z.config({ jitless: true });

export const PROTOCOL_VERSION = 1 as const;
export const idSchema = z.string().min(1).max(256).regex(/^\S+$/u);
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
