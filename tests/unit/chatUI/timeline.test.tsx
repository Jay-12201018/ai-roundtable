import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Timeline, VIRTUALIZE_AT, type TimelineItem } from '../../../src/renderer/features/timeline';
import { useTimelineHold } from '../../../src/renderer/features/timeline/hold';

// jsdom has no layout: every rendered message is 100px tall, the viewport is 600px and scrollTop is clamped.
const ITEM = 100, VIEW = 600;
const saved: Array<[string, PropertyDescriptor | undefined]> = [];
beforeAll(() => {
  const define = (name: string, descriptor: PropertyDescriptor) => { saved.push([name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)]); Object.defineProperty(HTMLElement.prototype, name, { configurable: true, ...descriptor }); };
  define('offsetHeight', { get(this: HTMLElement) { return this.classList.contains('thread-item') ? ITEM : 0; } });
  define('clientHeight', { get(this: HTMLElement) { return this.classList.contains('timeline-scroll') ? VIEW : 0; } });
  define('scrollHeight', { get(this: HTMLElement) {
    if (!this.classList.contains('timeline-scroll')) return 0;
    return [...this.querySelectorAll('.thread-list > *')].reduce((total, node) => total + (node.classList.contains('thread-item') ? ITEM : parseFloat((node as HTMLElement).style.height) || 0), 0);
  } });
  define('scrollTop', {
    get(this: HTMLElement & { __top?: number }) { return this.__top ?? 0; },
    set(this: HTMLElement & { __top?: number }, value: number) { this.__top = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight)); },
  });
});
afterAll(() => { for (const [name, descriptor] of saved) if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor); else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name]; });
afterEach(cleanup);

const items = (count: number, last = ''): TimelineItem[] => Array.from({ length: count }, (_, index) => ({
  key: `slot-${index}`, render: () => <p>{`消息 ${index}${index === count - 1 ? last : ''}`}</p>,
}));
const scroller = () => document.querySelector('.timeline-scroll') as HTMLElement;
const rendered = () => document.querySelectorAll('.thread-item').length;
const atBottom = () => scroller().scrollTop >= scroller().scrollHeight - VIEW - 1;

describe('R16 long history: a bounded DOM for 1000+ messages', () => {
  it('renders only the window around the viewport, starting at the latest message', () => {
    render(<Timeline viewKey="long" label="讨论时间线" items={items(1200)} contentVersion={0} />);
    expect(document.querySelector('[data-virtual]')).toBeTruthy();
    expect(rendered()).toBeLessThan(60);
    expect(screen.getByText('消息 1199')).toBeTruthy();
    expect(screen.queryByText('消息 0')).toBeNull();
    expect(atBottom()).toBe(true);
  });

  it('keeps everything in the DOM below the threshold, so ordinary discussions need no windowing', () => {
    render(<Timeline viewKey="short" label="讨论时间线" items={items(VIRTUALIZE_AT)} contentVersion={0} />);
    expect(document.querySelector('[data-virtual]')).toBeNull();
    expect(rendered()).toBe(VIRTUALIZE_AT);
  });

  it('follows a streaming reply at the bottom: each 32ms delta keeps the newest text in view with the DOM bounded', () => {
    const view = render(<Timeline viewKey="stream" label="讨论时间线" items={items(1200)} contentVersion={0} />);
    for (let delta = 1; delta <= 60; delta++) {
      view.rerender(<Timeline viewKey="stream" label="讨论时间线" items={items(1200, '字'.repeat(delta))} contentVersion={delta} />);
      expect(rendered()).toBeLessThan(60);
    }
    expect(screen.getByText(`消息 1199${'字'.repeat(60)}`)).toBeTruthy();
    expect(atBottom()).toBe(true);
    expect(screen.queryByRole('button', { name: /回到最新/u })).toBeNull();
  });

  it('reading older messages is not interrupted: new content shows 「有新消息 · 回到最新」 instead of moving the page', () => {
    const view = render(<Timeline viewKey="read" label="讨论时间线" items={items(1200)} contentVersion={0} />);
    act(() => { scroller().scrollTop = 40_000; fireEvent.scroll(scroller()); });
    const anchor = scroller().scrollTop;
    const visible = [...document.querySelectorAll('.thread-item')].map(node => node.textContent);
    expect(visible.length).toBeLessThan(60);
    expect(visible).not.toContain('消息 1199');
    view.rerender(<Timeline viewKey="read" label="讨论时间线" items={items(1201)} contentVersion={1} />);
    expect(scroller().scrollTop).toBe(anchor);
    const jump = screen.getByRole('button', { name: '有新消息 · 回到最新' });
    fireEvent.click(jump);
    expect(atBottom()).toBe(true);
    expect(screen.queryByRole('button', { name: /回到最新/u })).toBeNull();
    expect(screen.getByText('消息 1200')).toBeTruthy();
  });

  it('goes to the latest output when the host sends a message, even after reading older ones (D111)', () => {
    const view = render(<Timeline viewKey="host" label="讨论时间线" items={items(1200)} contentVersion={0} latestFromHost="h1" />);
    act(() => { scroller().scrollTop = 40_000; fireEvent.scroll(scroller()); });
    view.rerender(<Timeline viewKey="host" label="讨论时间线" items={items(1201)} contentVersion={1} latestFromHost="h1" />);
    expect(atBottom()).toBe(false);
    view.rerender(<Timeline viewKey="host" label="讨论时间线" items={items(1202)} contentVersion={2} latestFromHost="h2" />);
    expect(atBottom()).toBe(true);
    expect(screen.getByText('消息 1201')).toBeTruthy();
  });

  it('does not follow while a message holds the view (an older version, an edit), even at the bottom', () => {
    function Holding() { useTimelineHold(true); return <p>正在看旧版本</p>; }
    const withHold = (count: number, version: number) => <Timeline viewKey="hold" label="讨论时间线" contentVersion={version}
      items={[{ key: 'holding', render: () => <Holding /> }, ...items(count)]} />;
    const view = render(withHold(20, 0));
    act(() => { scroller().scrollTop = 0; fireEvent.scroll(scroller()); });
    view.rerender(withHold(21, 1));
    expect(scroller().scrollTop).toBe(0);
    expect(screen.getByRole('button', { name: '有新消息 · 回到最新' })).toBeTruthy();
  });

  it('keeps each discussion\'s reading position when switching away and back', () => {
    const view = render(<Timeline viewKey="first" label="讨论时间线" items={items(300)} contentVersion={0} />);
    act(() => { scroller().scrollTop = 12_000; fireEvent.scroll(scroller()); });
    const kept = scroller().scrollTop;
    view.rerender(<Timeline viewKey="second" label="讨论时间线" items={items(10)} contentVersion={0} />);
    expect(atBottom()).toBe(true);
    view.rerender(<Timeline viewKey="first" label="讨论时间线" items={items(300)} contentVersion={0} />);
    expect(scroller().scrollTop).toBe(kept);
  });
});
