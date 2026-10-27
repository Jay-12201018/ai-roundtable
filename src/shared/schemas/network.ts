import { z } from 'zod';

/**
 * D115 (R16 D3-B): the local proxy chosen on the settings page. Like the environment variables it stands in for,
 * it accepts only a loopback HTTP proxy, and using it requires the explicit "由代理解析域名" choice. Main reads it at
 * launch, so a change applies after a restart; the environment variables, when set, take precedence.
 */
export const proxyHostSchema = z.enum(['127.0.0.1', '::1']);
export const proxySettingsSchema = z.object({
  enabled: z.boolean(), host: proxyHostSchema, port: z.number().int().min(1).max(65535), trustProxyDns: z.boolean(),
}).strict().refine(value => !value.enabled || value.trustProxyDns, 'A proxy is used only when the proxy resolves names');
export const proxyEndpointSchema = z.object({ host: proxyHostSchema, port: z.number().int().min(1).max(65535) }).strict();
export const networkSettingsSchema = z.object({
  /** What the settings page saved, or null when nothing was saved (or the file could not be read). */
  saved: proxySettingsSchema.nullable(),
  /** What this launch actually uses, and where it came from. */
  effective: z.object({ source: z.enum(['environment', 'settings', 'none']), proxy: proxyEndpointSchema.nullable() }).strict(),
  /** The saved choice differs from what this launch uses; it applies after a restart (never with the environment set). */
  restartRequired: z.boolean(),
  /** The saved file exists but was not usable; Main then connects directly. */
  savedInvalid: z.boolean(),
}).strict();
export const proxyTestResultSchema = z.object({
  ok: z.boolean(), target: z.literal('api.deepseek.com'),
  /** refused: nothing listens there; rejected: the proxy answered but would not open the tunnel; timeout: no answer in time. */
  failure: z.enum(['refused', 'rejected', 'timeout']).optional(),
}).strict().refine(value => value.ok === (value.failure === undefined), 'A failed test names its failure');

export type ProxySettings = z.infer<typeof proxySettingsSchema>;
export type ProxyEndpoint = z.infer<typeof proxyEndpointSchema>;
export type NetworkSettings = z.infer<typeof networkSettingsSchema>;
export type ProxyTestResult = z.infer<typeof proxyTestResultSchema>;
