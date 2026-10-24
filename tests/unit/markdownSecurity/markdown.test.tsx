import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Markdown, safeHref } from '../../../src/renderer/features/timeline';

afterEach(() => { cleanup(); vi.restoreAllMocks(); delete (window as unknown as { __pwned?: number }).__pwned; });
const md = (text: string) => render(<Markdown text={text} />).container.querySelector('.md')!;

describe('R16 safe Markdown: model text never runs', () => {
  it('shows raw HTML as text and never creates script, event handlers, iframes or images', () => {
    const root = md('前文 <script>window.__pwned = 1</script>\n\n<div onclick="window.__pwned = 2">点我</div>\n\n<iframe src="https://evil.example"></iframe><img src=x onerror="window.__pwned=3"><a href="javascript:alert(1)">x</a>\n\n<b>未闭合 <i>畸形');
    expect(root.querySelector('script, iframe, img, [onclick], [onerror], div[onclick]')).toBeNull();
    expect(root.querySelectorAll('*').length).toBeGreaterThan(0);
    expect(root.textContent).toContain('<script>window.__pwned = 1</script>');
    expect(root.textContent).toContain('<div onclick="window.__pwned = 2">');
    expect(root.textContent).toContain('<b>未闭合 <i>畸形');
    fireEvent.click(screen.getByText(/点我/u));
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it.each([
    ['javascript:', '[危险](javascript:window.__pwned=1)'],
    ['data:', '[数据](data:text/html;base64,PHNjcmlwdD4=)'],
    ['vbscript:', '[脚本](vbscript:msgbox)'],
    ['http (not https)', '[明文](http://example.com/a)'],
    ['credentials', '[凭据](https://user:pass@example.com/)'],
    ['relative', '[相对](/etc/passwd)'],
  ])('keeps a %s link as inert text', (_kind, text) => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const root = md(text);
    expect(root.querySelector('a')).toBeNull();
    const span = root.querySelector('.md-link-off')!;
    expect(span.getAttribute('title')).toBe('只能打开 https 链接');
    fireEvent.click(span);
    expect(open).not.toHaveBeenCalled();
  });

  it('opens an https link only on click, through window.open, which Main confirms (R01)', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const root = md('见 [公告](https://example.edu/notice?a=1)');
    const link = root.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('https://example.edu/notice?a=1');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(open).not.toHaveBeenCalled();
    const click = fireEvent.click(link);
    expect(click).toBe(false); // the renderer never navigates itself
    expect(open).toHaveBeenCalledWith('https://example.edu/notice?a=1', '_blank', 'noopener,noreferrer');
  });

  it('never loads an image; it says one was left out', () => {
    const root = md('![架构图](https://example.com/a.png)');
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toBe('［图片：架构图，不会加载］');
  });

  it.each([
    ['https://a.example/x', 'https://a.example/x'], ['http://a.example', ''], ['javascript:alert(1)', ''], ['  javascript:alert(1)', ''],
    ['JAVASCRIPT:alert(1)', ''], ['https://u:p@a.example', ''], ['not a url', ''],
  ])('safeHref(%j) is %j', (input, expected) => expect(safeHref(input)).toBe(expected));
});

describe('R16 Markdown/GFM keeps its structure', () => {
  it('renders lists, tables (scrollable), quotes, inline code and headings', () => {
    const root = md('### 标题\n\n1. 第一\n2. 第二\n\n- 甲\n- [x] 已完成\n\n> 引用\n\n| 问题 | 建议 |\n| --- | --- |\n| 夜间 | 暂停 |\n\n用 `pnpm test` 跑。');
    expect(root.querySelector('h3')!.textContent).toBe('标题');
    expect(root.querySelectorAll('ol > li')).toHaveLength(2);
    expect(root.querySelector('input[type=checkbox]')!.hasAttribute('disabled')).toBe(true);
    expect(root.querySelector('blockquote')!.textContent!.trim()).toBe('引用');
    const wrap = root.querySelector('.table-wrap')!;
    expect(wrap.querySelector('table')!.textContent).toContain('夜间');
    expect(wrap.getAttribute('tabindex')).toBe('0');
    expect(root.querySelector(':not(pre) > code')!.textContent).toBe('pnpm test');
  });

  it('closes Chinese bold after full-width punctuation, the way models write it, but leaves code alone', () => {
    const root = md('1. **范围：**3 栋宿舍楼\n2. **定价：**基础费 2 元\n\n```text\n**不是加粗**\n```\n\n行内 `**也不是**`');
    expect([...root.querySelectorAll('strong')].map(node => node.textContent)).toEqual(['范围：', '定价：']);
    expect(root.querySelector('pre')!.textContent).toBe('**不是加粗**\n');
    expect(root.querySelector(':not(pre) > code')!.textContent).toBe('**也不是**');
    expect(root.textContent).not.toContain('**范围');
  });

  it('gives a code block its language and a keyboard-reachable copy button that copies exactly the code', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const root = md('```python\nprint("<b>不执行</b>")\nx = 1\n```');
    expect(root.querySelector('.codeblock-head')!.textContent).toContain('python');
    expect(root.querySelector('pre')!.textContent).toBe('print("<b>不执行</b>")\nx = 1\n');
    const copy = screen.getByRole('button', { name: '复制代码' });
    expect(copy.tagName).toBe('BUTTON');
    fireEvent.click(copy);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('print("<b>不执行</b>")\nx = 1'));
    await screen.findByText('已复制');
  });

  it('keeps a very long code line inside its block', () => {
    const root = md('```\n' + 'x'.repeat(4000) + '\n```');
    expect(root.querySelector('.codeblock pre')).toBeTruthy();
    expect(root.querySelector('.codeblock pre code')!.textContent!.length).toBe(4001);
  });
});
