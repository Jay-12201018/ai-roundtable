import { z } from 'zod';
import { idSchema, timestampSchema } from '../../../shared/schemas/common';

// Fixed evidence vocabulary prevents a reconciliation note becoming a credential or response dump.
export const reconciliationEvidenceSummary = '人工核对官方控制台：筛选本次请求所属 API Key、最近30天，页面显示 API 请求0、Tokens 0、消费¥0.00。官方页面未显示消费，不证明绝对没有费用；原始 usage、错误及 unknown 历史保留。' as const;
export const reconciliationInputSchema = z.object({
  trialId: idSchema, requestId: idSchema, providerId: idSchema, keyRevision: idSchema,
  evidence: z.literal('dashboard_no_displayed_usage'),
  decision: z.enum(['retain_reservation', 'release_reservation']),
  acknowledgedUncertainty: z.literal(true),
}).strict();
export const reconciliationAuditSchema = reconciliationInputSchema.extend({
  id: idSchema, reviewedAt: timestampSchema, evidenceSummary: z.literal(reconciliationEvidenceSummary),
});
export type ReconciliationInput = z.infer<typeof reconciliationInputSchema>;
export type TrialReconciliation = z.infer<typeof reconciliationAuditSchema>;
