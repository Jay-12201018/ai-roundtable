import { useRef, type TextareaHTMLAttributes } from 'react';

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onSubmit'> & { onSubmit(): void };

/** Enter sends; Shift+Enter adds a line; Enter while an IME composition is active only confirms the candidate. */
export function HostTextArea({ onSubmit, onKeyDown, onCompositionStart, onCompositionEnd, ...props }: Props) {
  const composing = useRef(false);
  return <textarea {...props}
    onCompositionStart={event => { composing.current = true; onCompositionStart?.(event); }}
    onCompositionEnd={event => { composing.current = false; onCompositionEnd?.(event); }}
    onKeyDown={event => {
      onKeyDown?.(event);
      if (event.defaultPrevented || event.key !== 'Enter' || event.shiftKey) return;
      // keyCode 229 is reported by some IMEs for the confirming Enter even after compositionend.
      if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      onSubmit();
    }} />;
}
