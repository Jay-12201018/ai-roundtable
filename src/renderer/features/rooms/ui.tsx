import { useEffect, useId, useRef, type ReactNode } from 'react';
import { errorCodeSchema } from '../../../shared/schemas/error';

export function errorText(error: unknown): string {
  const value = error && typeof error === 'object' ? error as { code?: unknown; detail?: { code?: unknown } } : undefined;
  const parsed = errorCodeSchema.safeParse(value?.detail?.code ?? value?.code);
  switch (parsed.success ? parsed.data : 'internal_error') {
    case 'invalid_input': return '配置或分页参数无效，请检查后重试。';
    case 'not_found': return '记录已不存在，请刷新列表。';
    case 'invalid_state': return '当前操作受保护：可能存在活动 Run 或历史引用。请保留记录，或归档未使用的配置。';
    case 'unsupported': return '当前配置尚不支持此操作，请检查 Provider 与模型。';
    case 'transport_error': return '连接失败，请重试。';
    default: return '操作失败，请刷新后重试。';
  }
}

export function Dialog({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null); const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement; const dialog = ref.current!;
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={ref} className="rooms-dialog" aria-modal="true" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <h2 id={titleId}>{title}</h2>{children}
    <button type="button" disabled={busy} onClick={onClose}>取消</button>
  </dialog>;
}
