import type { ProviderReadiness, ProviderSummary } from '../../../shared/contracts/configuration';
import { catalogServiceAt, imageSupportOf, serviceCatalog, type ImageSupport } from '../../../shared/serviceCatalog';

/** D147: whether this member's model reads images, by the same rule Main sends by; undefined until that can be told. */
export function memberImageSupport(member: { providerId: string | null; modelId: string | null }, providers: readonly ProviderSummary[], readiness: readonly ProviderReadiness[] | undefined): ImageSupport | undefined {
  if (!member.providerId) return 'no';
  const provider = providers.find(item => item.id === member.providerId);
  if (provider?.kind === 'mock') return 'no';
  const row = readiness?.find(item => item.providerId === member.providerId);
  return provider && row && member.modelId ? imageSupportOf(catalogServiceAt(serviceCatalog, row.baseUrl), member.modelId) : undefined;
}

export const imageSupportLabels: Record<ImageSupport, string> = { yes: '能看图', no: '看不了图', unknown: '能否看图未知' };

/** What the host should know before sending images: who will not see them. Nothing here stops the sending. */
export function imageAudienceNotes(members: ReadonlyArray<{ name: string; support: ImageSupport | undefined }>): string[] {
  const names = (support: ImageSupport) => members.filter(member => member.support === support).map(member => member.name);
  const unseen = names('no'); const unknown = names('unknown');
  return [
    ...(unseen.length && unseen.length === members.length ? ['这场讨论的成员都看不到图片，他们只会收到一句说明。']
      : unseen.length ? [`${unseen.join('、')}的模型看不到图片，只会收到一句说明。`] : []),
    ...(unknown.length ? [`${unknown.join('、')}的模型不确定能否看图；如果服务商拒绝，换一个能看图的模型。`] : []),
  ];
}
