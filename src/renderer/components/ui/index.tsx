import { forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type ComponentType, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { Check, X } from 'lucide-react';
import './ui.css';
import './page.css';

type IconType = ComponentType<{ 'aria-hidden'?: boolean; size?: number; strokeWidth?: number }>;
const cx = (...names: Array<string | false | undefined | null>) => names.filter(Boolean).join(' ');

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger'; size?: 'sm' | 'md'; solid?: boolean; icon?: IconType;
};
/** Primary, secondary, quiet or danger; text first, an icon only as a hint. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'secondary', size = 'md', solid, icon: Icon, className, children, type = 'button', ...props }, ref) {
  return <button ref={ref} type={type} className={cx('btn', variant !== 'secondary' && `is-${variant}`, size === 'sm' && 'is-sm', solid && 'is-solid', className)} {...props}>
    {Icon && <Icon aria-hidden strokeWidth={1.8} />}{children}
  </button>;
});

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { label: string; icon: IconType; size?: 'sm' | 'md' };
/** An icon-only button always carries its name, for screen readers and as a hover hint. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ label, icon: Icon, size = 'md', className, type = 'button', ...props }, ref) {
  return <button ref={ref} type={type} aria-label={label} title={label} className={cx('icon-btn', size === 'sm' && 'is-sm', className)} {...props}><Icon aria-hidden strokeWidth={1.7} /></button>;
});

export function Pill({ tone = 'neutral', dot, icon: Icon, children }: { tone?: 'neutral' | 'live' | 'warn' | 'danger' | 'ok'; dot?: boolean; icon?: IconType; children: ReactNode }) {
  return <span className={cx('pill', tone !== 'neutral' && `is-${tone}`)}>{dot && <span className="dot" aria-hidden />}{Icon && <Icon aria-hidden strokeWidth={2} />}{children}</span>;
}
export function Tag({ tone = 'neutral', title, children }: { tone?: 'neutral' | 'accent' | 'warn'; title?: string; children: ReactNode }) {
  return <span className={cx('tag', tone !== 'neutral' && `is-${tone}`)} title={title}>{children}</span>;
}
/** A letter avatar: identity comes from the name, never from a colour per member or vendor. */
export function Avatar({ name, size = 'md', host }: { name: string; size?: 'sm' | 'md'; host?: boolean }) {
  return <span className={cx('avatar', size === 'sm' && 'is-sm', host && 'is-host')} aria-hidden>{[...name.trim()][0] ?? '?'}</span>;
}

/** 提示条: a single reason with at most one next step and what it may cost. */
export function Note({ tone = 'warn', icon: Icon, children, action, cost, role = 'note' }: { tone?: 'warn' | 'info' | 'danger' | 'neutral'; icon: IconType; children: ReactNode; action?: ReactNode; cost?: ReactNode; role?: string }) {
  return <div className={cx('note', tone !== 'warn' && `is-${tone}`)} role={role}>
    <Icon aria-hidden strokeWidth={1.8} />
    <div className="note-body">{children}</div>
    {(action || cost) && <div className="note-action">{action}{cost && <span className="note-cost">{cost}</span>}</div>}
  </div>;
}
export function NoticeCard({ tone = 'warn', icon: Icon, title, children, role = 'alert', label }: { tone?: 'warn' | 'danger' | 'info'; icon: IconType; title: ReactNode; children?: ReactNode; role?: string; label?: string }) {
  return <section className={cx('notice-card', tone !== 'warn' && `is-${tone}`)} role={role} aria-label={label}>
    <h3><Icon aria-hidden strokeWidth={1.8} />{title}</h3>{children}
  </section>;
}

const focusable = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
/** Keeps Tab inside a container; used by drawers (dialogs get this from the browser). */
export function trapTab(event: KeyboardEvent<HTMLElement>, container: HTMLElement | null) {
  if (event.key !== 'Tab' || !container) return;
  const items = [...container.querySelectorAll<HTMLElement>(focusable)].filter(item => item.offsetParent !== null || item === document.activeElement);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

/** Restores focus to whatever opened a layer once it closes. */
export function useReturnFocus(active: boolean) {
  const previous = useRef<Element | null>(null);
  useEffect(() => {
    if (!active) return;
    previous.current = document.activeElement;
    return () => { const target = previous.current; if (target instanceof HTMLElement && target.isConnected) target.focus(); };
  }, [active]);
}

/**
 * A side drawer over a scrim: titled, closable with Esc or the scrim, focus kept inside and handed back on close.
 * The content behind it is made inert by the caller.
 */
export function Drawer({ side, label, open, onClose, children, className }: { side: 'left' | 'right'; label: string; open: boolean; onClose: () => void; children: ReactNode; className?: string }) {
  const panel = useRef<HTMLDivElement>(null);
  useReturnFocus(open);
  useEffect(() => {
    if (!open) return;
    const target = panel.current?.querySelector<HTMLElement>('[data-autofocus]') ?? panel.current?.querySelector<HTMLElement>(focusable);
    target?.focus();
  }, [open]);
  if (!open) return null;
  return <>
    <div className="scrim" aria-hidden onClick={onClose} />
    <div ref={panel} className={cx('drawer', `is-${side}`, className)} role="dialog" aria-modal="true" aria-label={label}
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } else trapTab(event, panel.current); }}>
      {children}
    </div>
  </>;
}

/** A modal dialog with title, optional description and footer; Esc closes unless busy; focus returns on close. */
export function Modal({ title, description, onClose, busy, children, footer, wide, below, className }: { title: string; description?: ReactNode; onClose: () => void; busy?: boolean; children: ReactNode; footer?: ReactNode; wide?: boolean; below?: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null); const titleId = useId();
  useReturnFocus(true);
  useEffect(() => {
    const dialog = ref.current!;
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); } else dialog.setAttribute('open', '');
    // A safe default focus (for example 取消 in a destructive confirmation) wins over the first control.
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => { if (typeof dialog.close === 'function' && dialog.open) dialog.close(); };
  }, []);
  return <dialog ref={ref} className={cx('modal', className)} style={wide ? { width: 'min(760px, calc(100vw - 32px))' } : undefined} aria-modal="true" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="modal-head"><div><h2 id={titleId}>{title}</h2>{description && <p>{description}</p>}</div>
      <IconButton label="关闭" icon={X} disabled={busy} onClick={onClose} /></div>
    {below && <div className="modal-below">{below}</div>}
    <div className="modal-body">{children}</div>
    {footer && <div className="modal-foot">{footer}</div>}
  </dialog>;
}

/** Closes a popover on Esc or a pointer press outside it (and outside its trigger). */
export function useDismiss(open: boolean, onClose: () => void, refs: Array<RefObject<HTMLElement | null>>) {
  useEffect(() => {
    if (!open) return;
    const press = (event: PointerEvent) => { if (!refs.some(ref => ref.current?.contains(event.target as Node))) onClose(); };
    const key = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', press); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', press); document.removeEventListener('keydown', key); };
  }, [open, onClose, ...refs]);
}

export function Tabs<T extends string>({ label, tabs, value, onChange, idPrefix }: { label: string; tabs: Array<{ id: T; label: string; count?: number }>; value: T; onChange: (id: T) => void; idPrefix: string }) {
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const index = tabs.findIndex(tab => tab.id === value);
    const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    onChange(next.id); document.getElementById(`${idPrefix}-tab-${next.id}`)?.focus();
  };
  return <div className="tabs" role="tablist" aria-label={label} onKeyDown={move}>
    {tabs.map(tab => <button key={tab.id} id={`${idPrefix}-tab-${tab.id}`} type="button" role="tab" className="tab" aria-selected={tab.id === value}
      aria-controls={`${idPrefix}-panel-${tab.id}`} tabIndex={tab.id === value ? 0 : -1} onClick={() => onChange(tab.id)}>
      {tab.label}{tab.count ? <span className="count">{tab.count}</span> : null}</button>)}
  </div>;
}

/** Copies text with the async clipboard, falling back to a hidden selection where that is unavailable. */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    try {
      const area = document.createElement('textarea'); area.value = text; area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.opacity = '0';
      // Outside an open modal dialog everything is inert and cannot be selected, so the helper goes inside it.
      (document.querySelector('dialog[open]') ?? document.body).appendChild(area); area.select(); const ok = document.execCommand('copy'); area.remove(); return ok;
    } catch { return false; }
  }
}

/** A labelled form field: the label names only the control; help and errors are linked as its description. */
export function Field({ label, help, error, optional, className, children }: { label: ReactNode; help?: ReactNode; error?: ReactNode; optional?: boolean; className?: string; children: (props: { id: string; 'aria-describedby'?: string }) => ReactNode }) {
  const id = useId(); const helpId = `${id}-help`;
  return <div className={cx('field', className)}>
    <label htmlFor={id}>{label}{optional && <span className="muted small field-optional">可选</span>}</label>
    {children({ id, ...(help || error ? { 'aria-describedby': helpId } : {}) })}
    {(error || help) && <span className={error ? 'field-error' : 'field-help'} id={helpId} role={error ? 'alert' : undefined}>{error || help}</span>}
  </div>;
}

/** An on/off switch that always says what it switches, for screen readers and as a hover hint. */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" className="switch" aria-checked={checked} aria-label={label} title={label} disabled={disabled} onClick={() => onChange(!checked)} />;
}

/** A numbered step indicator: finished steps show a check, the current one is emphasised. */
export function Stepper({ steps, current, label }: { steps: string[]; current: number; label: string }) {
  return <ol className="stepper" aria-label={label}>{steps.map((step, index) => <li key={step} className={cx('s', index < current && 'done', index === current && 'now')} aria-current={index === current ? 'step' : undefined}>
    <span className="n" aria-hidden>{index < current ? <Check size={12} strokeWidth={2.4} /> : index + 1}</span>{step}{index < current && <span className="sr-only">（已完成）</span>}
    {index < steps.length - 1 && <span className="line" aria-hidden />}
  </li>)}</ol>;
}

/** A selectable card in a grid of choices (services, role templates, discussion modes). */
export function Choice({ selected, onSelect, title, children, badge, disabled, icon }: { selected: boolean; onSelect: () => void; title: ReactNode; children?: ReactNode; badge?: ReactNode; disabled?: boolean; icon?: ReactNode }) {
  return <button type="button" className="choice" aria-pressed={selected} disabled={disabled} onClick={onSelect}>
    <b>{icon}{title}</b>{children && <small>{children}</small>}{badge && <span className="badge">{badge}</span>}
  </button>;
}

export { cx };
