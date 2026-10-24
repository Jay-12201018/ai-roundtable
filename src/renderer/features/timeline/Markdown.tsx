import { memo, useState, type MouseEvent, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { Check, Copy } from 'lucide-react';
import { copyText } from '../../components/ui';

/**
 * Model text is untrusted. Only these elements survive, raw HTML is shown as plain text (never parsed), links keep
 * an https target only and open through Main's confirmation (R01), and images are never loaded.
 */
const allowedTags = ['p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'del', 'code', 'pre', 'blockquote',
  'ul', 'ol', 'li', 'input', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'img', 'sup', 'section'];
export const markdownSchema = {
  ...defaultSchema,
  tagNames: allowedTags,
  protocols: { href: ['https'] },
  attributes: {
    a: ['href', 'title'], img: ['alt'], code: [['className', /^language-[\w+#.-]{1,32}$/u]], input: [['type', 'checkbox'], ['disabled', true], 'checked'],
    th: ['align'], td: ['align'], ol: ['start'], li: [], '*': [],
  },
  clobberPrefix: 'md-',
  strip: ['script', 'style'],
};

export const safeHref = (url: string) => {
  try { const parsed = new URL(url); return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.href : ''; }
  catch { return ''; }
};

type Node = { type: string; value?: string; children?: Node[] };
/** remark plugin: raw HTML in model output becomes literal text, so nothing is lost and nothing is executed. */
function htmlAsText() {
  return (tree: Node) => {
    const walk = (node: Node) => { if (node.type === 'html') node.type = 'text'; node.children?.forEach(walk); };
    walk(tree);
  };
}

/**
 * remark plugin: CommonMark does not close `**` right after full-width punctuation when a letter follows, so the very
 * common Chinese `**范围：**3 栋` stays literal. Pairs left in plain text become strong text; code is never touched.
 */
function cjkStrong() {
  const pattern = /\*\*([^*\n]+?)\*\*/gu;
  return (tree: Node) => {
    const walk = (node: Node) => {
      if (!node.children) return;
      node.children = node.children.flatMap(child => {
        if (child.type !== 'text' || !child.value?.includes('**')) { walk(child); return [child]; }
        const parts: Node[] = []; let last = 0;
        for (const match of child.value.matchAll(pattern)) {
          if (match.index > last) parts.push({ type: 'text', value: child.value.slice(last, match.index) });
          parts.push({ type: 'strong', children: [{ type: 'text', value: match[1] }] });
          last = match.index + match[0].length;
        }
        if (!parts.length) return [child];
        if (last < child.value.length) parts.push({ type: 'text', value: child.value.slice(last) });
        return parts;
      });
    };
    walk(tree);
  };
}

const textOf = (node: ReactNode): string => typeof node === 'string' || typeof node === 'number' ? String(node)
  : Array.isArray(node) ? node.map(textOf).join('')
  : node && typeof node === 'object' && 'props' in node ? textOf((node as { props: { children?: ReactNode } }).props.children) : '';

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const child = Array.isArray(children) ? children[0] : children;
  const className = child && typeof child === 'object' && 'props' in child ? String((child as { props: { className?: string } }).props.className ?? '') : '';
  const language = /language-([\w+#.-]+)/u.exec(className)?.[1] ?? '';
  const code = textOf(children).replace(/\n$/u, '');
  return <div className="codeblock">
    <div className="codeblock-head"><span>{language || '代码'}</span>
      <button type="button" className="codeblock-copy" aria-label="复制代码" title="复制代码" onClick={async () => { if (await copyText(code)) { setCopied(true); setTimeout(() => setCopied(false), 1600); } }}>
        {copied ? <Check aria-hidden size={14} /> : <Copy aria-hidden size={14} />}<span>{copied ? '已复制' : '复制'}</span></button></div>
    <pre>{children}</pre>
  </div>;
}

function openLink(event: MouseEvent<HTMLAnchorElement>, href: string) {
  event.preventDefault();
  // Main asks before handing an https link to the system browser and refuses anything else.
  window.open(href, '_blank', 'noopener,noreferrer');
}

const components: Components = {
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  table: ({ children }) => <div className="table-wrap" tabIndex={0}><table>{children}</table></div>,
  a: ({ href, children, title }) => {
    const target = safeHref(href ?? '');
    return target ? <a href={target} title={title ?? target} rel="noopener noreferrer" onClick={event => openLink(event, target)}>{children}</a>
      : <span className="md-link-off" title="只能打开 https 链接">{children}</span>;
  },
  img: ({ alt }) => <span className="md-image-off">［图片{alt ? `：${alt}` : ''}，不会加载］</span>,
};

/** Safe Markdown/GFM for public messages; memoised so only the message being streamed re-parses. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return <div className="md">
    <ReactMarkdown remarkPlugins={[remarkGfm, htmlAsText, cjkStrong]} rehypePlugins={[[rehypeSanitize, markdownSchema]]} components={components}
      urlTransform={url => safeHref(url)} skipHtml={false}>{text}</ReactMarkdown>
  </div>;
});
