import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AttachmentApiContract } from '../../../shared/contracts/app';
import { MAX_IMAGE_BYTES, MAX_IMAGES_PER_MESSAGE, type ImageAttachment } from '../../../shared/schemas/attachment';

export type DraftImage = { key: string; attachment?: ImageAttachment };
export type ImageDraft = {
  available: boolean; items: DraftImage[]; error: string; uploading: boolean;
  /** What Main accepted, in the order shown. */
  attachmentIds: string[];
  addFiles: (files: readonly File[], source?: 'pasted') => void;
  remove: (key: string) => void; clear: () => void;
};

const fieldOf = (error: unknown) => typeof error === 'object' && error !== null && 'field' in error ? (error as { field?: unknown }).field : undefined;
const codeOf = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: unknown }).code : undefined;
/** Why this file was not added, in words the host can act on; Main's answer decides. */
function refusal(error: unknown, name: string): string {
  if (codeOf(error) === 'image_unsupported') return `${name} 不是 PNG、JPEG 或 WebP 图片，没有加上。`;
  if (fieldOf(error) === 'bytes') return `${name} 是空文件或超过 10 MB，没有加上。`;
  return `${name} 没能加上，请再试一次。`;
}

let counter = 0;
/**
 * D147: the images waiting to be sent with one message. They go to Main the moment they are added, as bytes; what is kept here is
 * Main's answer. `remembered` lets a draft outlive the box it is shown in while the window stays open, as its text does.
 */
export function useImageDraft(api: AttachmentApiContract | undefined, remembered?: { initial: readonly DraftImage[]; save: (items: readonly DraftImage[]) => void }): ImageDraft {
  const [items, setItemsState] = useState<DraftImage[]>(() => [...remembered?.initial ?? []]);
  const [error, setError] = useState('');
  const current = useRef(items);
  const save = remembered?.save;
  const setItems = useCallback((next: DraftImage[]) => {
    current.current = next; setItemsState(next);
    save?.(next.filter(item => item.attachment));
  }, [save]);

  const addFiles = useCallback((files: readonly File[], source?: 'pasted') => {
    if (!api || !files.length) return;
    const problems: string[] = [];
    const room = MAX_IMAGES_PER_MESSAGE - current.current.length;
    const taken = files.slice(0, Math.max(0, room));
    const left = files.length - taken.length;
    if (left > 0) problems.push(room > 0 ? `每条消息最多 ${MAX_IMAGES_PER_MESSAGE} 张，多出来的 ${left} 张没有加上。` : `每条消息最多 ${MAX_IMAGES_PER_MESSAGE} 张，先移除一张再加。`);
    const nameOf = (file: File) => source === 'pasted' || !file.name ? '粘贴的图片' : `“${file.name}”`;
    const accepted = taken.filter(file => {
      // Said here so a very large file is never read into memory; Main checks again whatever the page says.
      if (file.size <= MAX_IMAGE_BYTES) return true;
      problems.push(`${nameOf(file)} 超过 10 MB，没有加上。`);
      return false;
    });
    setError(problems.join(''));
    for (const file of accepted) {
      const key = `image-${++counter}`;
      setItems([...current.current, { key }]);
      void file.arrayBuffer().then(buffer => api.addImage({ bytes: new Uint8Array(buffer) })).then(attachment => {
        if (!current.current.some(item => item.key === key)) return;
        if (current.current.some(item => item.attachment?.id === attachment.id)) {
          setItems(current.current.filter(item => item.key !== key));
          setError(previous => `${previous}${nameOf(file)} 已经加过了。`);
          return;
        }
        setItems(current.current.map(item => item.key === key ? { key, attachment } : item));
      }).catch((cause: unknown) => {
        setItems(current.current.filter(item => item.key !== key));
        setError(previous => `${previous}${refusal(cause, nameOf(file))}`);
      });
    }
  }, [api, setItems]);
  const remove = useCallback((key: string) => { setItems(current.current.filter(item => item.key !== key)); setError(''); }, [setItems]);
  const clear = useCallback(() => { setItems([]); setError(''); }, [setItems]);
  return useMemo(() => ({ available: Boolean(api), items, error, uploading: items.some(item => !item.attachment),
    attachmentIds: items.flatMap(item => item.attachment ? [item.attachment.id] : []), addFiles, remove, clear }), [api, items, error, addFiles, remove, clear]);
}

const hasFiles = (event: DragEvent) => [...(event.dataTransfer?.types ?? [])].includes('Files');
/** A dialog on top has the host's attention: an image dropped there is not meant for the box behind it. */
const dialogOpen = () => document.querySelector('dialog[open]') !== null;

/**
 * Paste and drag anywhere on the page while a box that takes images is showing: wherever the host lets go, the image reaches the
 * box instead of being lost. Words pasted with a picture of themselves (a spreadsheet, a document) stay words, and dragging
 * anything that is not a file (a member, a line of text) is left alone.
 */
export function useImageInput(draft: Pick<ImageDraft, 'available' | 'addFiles'>) {
  const [dropping, setDropping] = useState(false);
  const { available, addFiles } = draft;
  useEffect(() => {
    if (!available) return;
    const onPaste = (event: ClipboardEvent) => {
      const data = event.clipboardData;
      const files = [...data?.files ?? []];
      if (!data || !files.length || dialogOpen() || data.getData('text/plain').trim() && [...data.types].includes('text/html')) return;
      event.preventDefault();
      addFiles(files, 'pasted');
    };
    const onDragEnter = (event: DragEvent) => { if (hasFiles(event) && !dialogOpen()) { event.preventDefault(); setDropping(true); } };
    const onDragOver = (event: DragEvent) => { if (hasFiles(event) && !dialogOpen()) { event.preventDefault(); event.dataTransfer!.dropEffect = 'copy'; } };
    const onDragLeave = (event: DragEvent) => { if (!event.relatedTarget) setDropping(false); };
    const onDrop = (event: DragEvent) => {
      setDropping(false);
      if (!hasFiles(event) || dialogOpen()) return;
      event.preventDefault();
      addFiles([...event.dataTransfer!.files]);
    };
    document.addEventListener('paste', onPaste);
    document.addEventListener('dragenter', onDragEnter);
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('paste', onPaste);
      document.removeEventListener('dragenter', onDragEnter);
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('dragleave', onDragLeave);
      document.removeEventListener('drop', onDrop);
    };
  }, [available, addFiles]);
  return { dropping };
}
