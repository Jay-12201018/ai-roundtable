import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ImageOff, LoaderCircle, Paperclip, X } from 'lucide-react';
import { imageMediaTypeValues, imageUrl, MAX_IMAGES_PER_MESSAGE, type ImageAttachment } from '../../../shared/schemas/attachment';
import { MAX_REQUEST_IMAGE_BYTES } from '../../../shared/schemas/provider';
import { Button, IconButton, Modal, cx } from '../../components/ui';
import type { ImageDraft } from './useImageDraft';
import './images.css';

/** A stored image through Main's restricted scheme; a file that can no longer be read says so instead of showing a broken icon. */
function StoredImage({ id, alt, className }: { id: string; alt: string; className?: string }) {
  const [missing, setMissing] = useState(false);
  if (missing) return <span className={cx('image-missing', className)} role="img" aria-label="图片文件读不出来了" title="图片文件读不出来了"><ImageOff aria-hidden size={18} /></span>;
  return <img className={className} src={imageUrl(id)} alt={alt} draggable={false} decoding="async" onError={() => setMissing(true)} />;
}

const typeName = (mediaType: string) => mediaType.slice('image/'.length).toUpperCase();
const sizeText = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Thumbnails of what the host attached; each opens large. */
export function MessageImages({ images, className }: { images: readonly ImageAttachment[] | undefined; className?: string }) {
  const [open, setOpen] = useState<number>();
  const count = images?.length ?? 0;
  // The arrow keys move between images wherever focus is in the viewer.
  useEffect(() => {
    if (open === undefined || count < 2) return;
    const keys = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'ArrowRight') setOpen(index => index === undefined ? index : (index + 1) % count);
      if (event.key === 'ArrowLeft') setOpen(index => index === undefined ? index : (index + count - 1) % count);
    };
    document.addEventListener('keydown', keys);
    return () => document.removeEventListener('keydown', keys);
  }, [open === undefined, count]);
  if (!images?.length) return null;
  const shown = open === undefined ? undefined : images[open];
  const step = (offset: number) => setOpen(index => index === undefined ? index : (index + offset + images.length) % images.length);
  return <div className={cx('message-images', className)} role="group" aria-label={`附了 ${images.length} 张图片`}>
    {images.map((image, index) => <button key={image.id} type="button" className="message-image" aria-label={`看大图：第 ${index + 1} 张，共 ${images.length} 张`} onClick={() => setOpen(index)}>
      <StoredImage id={image.id} alt={`第 ${index + 1} 张图片`} />
    </button>)}
    {shown && <Modal wide className="image-viewer" title={images.length > 1 ? `图片 ${open! + 1} / ${images.length}` : '图片'} description={`${typeName(shown.mediaType)} · ${sizeText(shown.byteCount)}`} onClose={() => setOpen(undefined)}
      footer={images.length > 1 ? <><Button onClick={() => step(-1)}>上一张</Button><Button onClick={() => step(1)}>下一张</Button></> : undefined}>
      <div className="image-viewer-body"><StoredImage key={shown.id} id={shown.id} alt={`第 ${open! + 1} 张图片`} /></div>
    </Modal>}
  </div>;
}

/** The waiting images, right above the words they go with, and what the host should know about them. */
export function ImageTray({ draft, notes }: { draft: ImageDraft; notes?: ReactNode }) {
  if (!draft.items.length && !draft.error) return null;
  // A request takes a message's images whole or not at all, so the host hears now that these would not go.
  const tooMuch = draft.items.reduce((total, item) => total + (item.attachment?.byteCount ?? 0), 0) > MAX_REQUEST_IMAGE_BYTES;
  return <div className="image-tray">
    {draft.items.length > 0 && <ul className="image-tray-list" aria-label={`待发送的图片（${draft.items.length} / ${MAX_IMAGES_PER_MESSAGE}）`}>
      {draft.items.map((item, index) => <li key={item.key} className="image-tray-item">
        {item.attachment ? <StoredImage id={item.attachment.id} alt={`待发送的第 ${index + 1} 张图片`} />
          : <span className="image-uploading" role="status" aria-label="正在处理图片"><LoaderCircle aria-hidden size={18} /></span>}
        <button type="button" className="image-remove" aria-label={`移除第 ${index + 1} 张图片`} onClick={() => draft.remove(item.key)}><X aria-hidden size={12} /></button>
      </li>)}
    </ul>}
    {draft.error && <p className="field-error image-note" role="alert">{draft.error}</p>}
    {tooMuch && <p className="image-note warn-text" role="note">这几张图片合计超过 {MAX_REQUEST_IMAGE_BYTES / 1024 / 1024} MB，一次请求放不下，不会发给模型，成员只会收到一句说明。移除几张，或换小一点的图。</p>}
    {draft.items.length > 0 && notes}
  </div>;
}

/** Opens the system's file dialog; the page only ever gets the chosen file's bytes. */
export function AttachImageButton({ draft }: { draft: ImageDraft }) {
  const input = useRef<HTMLInputElement>(null);
  if (!draft.available) return null;
  return <>
    <input ref={input} className="image-file-input" type="file" tabIndex={-1} aria-hidden accept={imageMediaTypeValues.join(',')} multiple
      onChange={event => { draft.addFiles([...event.target.files ?? []]); event.target.value = ''; }} />
    <IconButton icon={Paperclip} label="添加图片" className="chip-icon" title={`添加图片，也可以粘贴或拖进来。支持 PNG、JPEG、WebP，每张不超过 10 MB，每条最多 ${MAX_IMAGES_PER_MESSAGE} 张`} onClick={() => input.current?.click()} />
  </>;
}
