import { z } from 'zod';

const portSchema = z.number().int().min(1).max(65535);
/** A host name or IP address, with no scheme, path or account in it. */
const hostSchema = z.string().trim().min(1).max(255).regex(/^(?:[A-Za-z0-9.-]+|\[?[0-9A-Fa-f:]+\]?)$/u);
/** D137: a proxy typed by hand, for when the system's setting cannot be read. HTTP CONNECT only. */
export const proxyEndpointSchema = z.object({ host: hostSchema, port: portSchema }).strict();
/** D137: the one switch. Off is a direct connection; on follows the system's setting, or the address typed by hand. */
export const proxySettingsSchema = z.object({ enabled: z.boolean(), manual: proxyEndpointSchema.nullable() }).strict();
/** What a request would do now, as Main reads it. `unsupported` is never turned into a direct connection silently. */
export const proxyStatusSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('off') }).strict(),
  z.object({ state: z.literal('direct') }).strict(),
  z.object({ state: z.literal('proxy'), source: z.enum(['system', 'manual']), host: z.string().min(1).max(255), port: portSchema }).strict(),
  z.object({ state: z.literal('unsupported'), scheme: z.enum(['socks', 'https', 'other']) }).strict(),
]);
export const networkSettingsSchema = z.object({
  saved: proxySettingsSchema,
  status: proxyStatusSchema,
  /** The saved file exists but was not usable; Main then connects directly. */
  savedInvalid: z.boolean(),
}).strict();
export const proxyTestResultSchema = z.object({
  ok: z.boolean(), via: z.enum(['direct', 'proxy']),
  /** refused: nothing answers there; rejected: the proxy answered but would not connect; timeout: no answer in time; unsupported: a proxy type this app cannot use. */
  failure: z.enum(['refused', 'rejected', 'timeout', 'unsupported']).optional(),
}).strict().refine(value => value.ok === (value.failure === undefined), 'A failed test names its failure');

export type ProxySettings = z.infer<typeof proxySettingsSchema>;
export type ProxyEndpoint = z.infer<typeof proxyEndpointSchema>;
export type ProxyStatus = z.infer<typeof proxyStatusSchema>;
export type NetworkSettings = z.infer<typeof networkSettingsSchema>;
export type ProxyTestResult = z.infer<typeof proxyTestResultSchema>;
