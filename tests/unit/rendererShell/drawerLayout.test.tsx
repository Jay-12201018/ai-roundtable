import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../src/renderer/App';
import { props as roomProps, room } from '../rendererRooms/fixtures';

const apis = () => {
  const rooms = roomProps().api;
  vi.mocked(rooms.listRooms).mockResolvedValue([room('room', '现有房间')]);
  return {
    rooms, host: { command: vi.fn() }, summary: { preview: vi.fn(), generate: vi.fn(), confirm: vi.fn(), revoke: vi.fn() }, usage: { getReport: vi.fn(), exportCsv: vi.fn() },
    settings: { listModelReadiness: vi.fn().mockResolvedValue([]), createProvider: vi.fn(), updateProvider: vi.fn(), getProviderConfiguration: vi.fn(), listProviderSummaries: vi.fn().mockResolvedValue([]), deleteProvider: vi.fn(), setKey: vi.fn(), deleteKey: vi.fn(), getProviderKeyState: vi.fn(), getKeyStorageStatus: vi.fn(), refreshModels: vi.fn(), testConnection: vi.fn() },
    room: { createDemo: vi.fn().mockResolvedValue({ roomId: 'room' }), getMessages: vi.fn().mockResolvedValue([]) },
    run: { previewWorkflow: vi.fn(async () => { throw new Error('not configured in fixture'); }), subscribe: vi.fn(), start: vi.fn(), getSnapshot: vi.fn(), onEvent: vi.fn(() => () => undefined), pause: vi.fn(), stop: vi.fn(), step: vi.fn(), resumeRun: vi.fn(), retryTurn: vi.fn(), continueMessage: vi.fn(), recoverInterruptedRun: vi.fn(), previewContinuation: vi.fn(), continueDiscussion: vi.fn() },
  };
};
const resizeTo = (width: number) => { window.innerWidth = width; window.dispatchEvent(new Event('resize')); };
const menuButton = () => screen.queryAllByRole('button', { name: '打开导航' })[0];
const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };

describe('drawers follow the layout', () => {
  const width = window.innerWidth;
  beforeEach(() => {
    localStorage.clear();
    window.roundtable = apis() as unknown as typeof window.roundtable;
    window.innerWidth = 1280;
  });
  afterEach(() => { environment.IS_REACT_ACT_ENVIRONMENT = true; cleanup(); window.innerWidth = width; });

  it('opens the navigation drawer for a click that lands right after the layout folds', async () => {
    const { container } = render(<App />);
    await screen.findAllByText('现有房间');
    const shell = container.querySelector<HTMLElement>('.app-shell')!;
    expect(shell.dataset.layout).toBe('wide');
    // The real scheduling, not act(): a resize is not urgent to React, so what follows its commit runs a task later.
    // The observer runs as soon as the fold is committed, which is the earliest moment the button can be pressed.
    environment.IS_REACT_ACT_ENVIRONMENT = false;
    const clicked = new Promise<void>(resolve => {
      const observer = new MutationObserver(() => {
        if (shell.dataset.layout !== 'narrow') return;
        observer.disconnect(); menuButton().click(); resolve();
      });
      observer.observe(shell, { attributes: true, attributeFilter: ['data-layout'] });
    });
    resizeTo(800);
    await clicked;
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(shell.dataset.layout).toBe('narrow');
    expect(screen.queryByRole('dialog', { name: '应用导航' })).not.toBeNull();
  });

  it('closes an open drawer when the layout changes, and it stays closed on the way back', async () => {
    window.innerWidth = 800;
    render(<App />);
    await screen.findAllByRole('button', { name: '打开导航' });
    fireEvent.click(menuButton());
    expect(screen.getByRole('dialog', { name: '应用导航' })).toBeTruthy();
    fireEvent(window, new Event('resize'));
    expect(screen.getByRole('dialog', { name: '应用导航' })).toBeTruthy(); // Within one layout a resize leaves it open.
    window.innerWidth = 1280; fireEvent(window, new Event('resize'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '应用导航' })).toBeNull());
    window.innerWidth = 800; fireEvent(window, new Event('resize'));
    await screen.findAllByRole('button', { name: '打开导航' });
    expect(screen.queryByRole('dialog', { name: '应用导航' })).toBeNull();
  });
});
