// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import type { RunService } from '../../../src/main/services/RunService';
import { registerIpc } from '../../../src/main/ipc/registerIpc';
import { createMainWindow } from '../../../src/main/windows/createMainWindow';

const fixture = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => unknown>(),
  createRoom: vi.fn(() => 'room-id'),
  send: vi.fn(),
  onEvent: vi.fn(),
  handle: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: class {
    isDestroyed = () => false;
    show = vi.fn();
    hide = vi.fn();
    loadFile = async () => {};
    loadURL = async () => {};
    webContents = {
      mainFrame: { url: 'http://localhost:5173/' }, isDestroyed: () => false,
      on: vi.fn(), setWindowOpenHandler: vi.fn(), send: fixture.send,
    };
  },
  app: { quit: vi.fn() },
  dialog: { showErrorBox: vi.fn(), showMessageBoxSync: vi.fn() },
  shell: { openExternal: vi.fn() },
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => unknown) => fixture.handle(channel, handler),
    removeHandler: (channel: string) => fixture.handlers.delete(channel),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  fixture.handlers.clear();
  fixture.handle.mockImplementation((channel, handler) => {
    if (fixture.handlers.has(channel)) throw new Error('Handler already registered');
    fixture.handlers.set(channel, handler);
  });
  vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173/');
});

function bind(url = 'http://localhost:5173/') {
  const window: BrowserWindow = createMainWindow();
  const webContents = window.webContents;
  const frame = webContents.mainFrame;
  Object.assign(frame, { url });
  fixture.onEvent.mockReturnValue(() => {});
  const service = { createDemoRoom: fixture.createRoom, onEvent: fixture.onEvent } as unknown as RunService;
  const dispose = registerIpc(window, service);
  const event = { sender: webContents, senderFrame: frame } as unknown as IpcMainInvokeEvent;
  return { window, service, frame, event, dispose, invoke: () => fixture.handlers.get('room.createDemo')!(event, 'test objective') };
}

describe('registered IPC source boundary', () => {
  it('accepts the trusted main renderer and releases handlers on disposal', () => {
    const { invoke, dispose } = bind();
    expect(invoke()).toEqual({ roomId: 'room-id' });
    dispose();
    expect(fixture.handlers.size).toBe(0);
  });

  it('rejects another webContents before calling the service', () => {
    const bound = bind();
    bound.event.sender = {} as IpcMainInvokeEvent['sender'];
    expect(bound.invoke).toThrow('Unauthorized IPC sender');
    expect(fixture.createRoom).not.toHaveBeenCalled();
  });

  // These are live registration gates, pending controller wiring of the window source policy.
  it.each([
    'http://localhost.attacker.example:5173/',
    'http://localhost:5174/',
    'http://localhost:5173/attacker.html',
    'http://user@localhost:5173/',
    'file://remote/tmp/index.html',
    'about:blank',
  ])('rejects an untrusted document in the same webContents: %s', (url) => {
    const bound = bind();
    Object.assign(bound.frame, { url });
    expect(bound.invoke).toThrow('Unauthorized IPC sender');
    expect(fixture.createRoom).not.toHaveBeenCalled();
  });

  it('rejects a child frame even at the trusted URL', () => {
    const bound = bind();
    Object.assign(bound.event, { senderFrame: { url: 'http://localhost:5173/' } });
    expect(bound.invoke).toThrow('Unauthorized IPC sender');
    expect(fixture.createRoom).not.toHaveBeenCalled();
  });

  it('rejects a missing senderFrame', () => {
    const bound = bind();
    Object.assign(bound.event, { senderFrame: null });
    expect(bound.invoke).toThrow('Unauthorized IPC sender');
    expect(fixture.createRoom).not.toHaveBeenCalled();
  });

  it('does not push run events after the main frame becomes untrusted', () => {
    const { frame } = bind();
    const listener = fixture.onEvent.mock.calls[0]![0] as (event: unknown) => void;
    Object.assign(frame, { url: 'https://attacker.example/' });
    listener({ runId: 'fixture-run', type: 'text_delta', payload: 'private fixture text' });
    expect(fixture.send).not.toHaveBeenCalled();
  });

  it('keeps newer handlers and events intact when an older disposer runs again', () => {
    const first = bind();
    const oldListener = fixture.onEvent.mock.calls[0]![0] as (event: unknown) => void;
    first.dispose();
    const second = bind();
    first.dispose();
    expect(second.invoke()).toEqual({ roomId: 'room-id' });
    oldListener({ runId: 'old-run' });
    expect(fixture.send).not.toHaveBeenCalled();
    const newListener = fixture.onEvent.mock.calls[1]![0] as (event: unknown) => void;
    newListener({ runId: 'new-run' });
    expect(fixture.send).toHaveBeenCalledWith('run.event', { runId: 'new-run' });
    second.dispose();
  });

  it('rejects a previously captured handler after its registration is disposed', () => {
    const bound = bind();
    const captured = fixture.handlers.get('room.createDemo')!;
    bound.dispose();
    expect(() => captured(bound.event, 'test objective')).toThrow('Unauthorized IPC sender');
    expect(fixture.createRoom).not.toHaveBeenCalled();
  });

  it('rolls back handlers installed before a registration failure', () => {
    const bound = bind();
    bound.dispose();
    fixture.handle.mockImplementation((channel, handler) => {
      if (channel === 'run.start') throw new Error('registration failed');
      fixture.handlers.set(channel, handler);
    });
    expect(() => registerIpc(bound.window, bound.service)).toThrow('registration failed');
    expect(fixture.handlers.size).toBe(0);
  });

  it('rolls back handlers when event subscription fails', () => {
    const bound = bind();
    bound.dispose();
    fixture.onEvent.mockImplementationOnce(() => { throw new Error('subscription failed'); });
    expect(() => registerIpc(bound.window, bound.service)).toThrow('subscription failed');
    expect(fixture.handlers.size).toBe(0);
  });

  it('unsubscribes exactly once and stops sending after disposal', () => {
    const bound = bind();
    bound.dispose();
    const unsubscribe = vi.fn();
    fixture.onEvent.mockReturnValueOnce(unsubscribe);
    const dispose = registerIpc(bound.window, bound.service);
    const listener = fixture.onEvent.mock.calls.at(-1)![0] as (event: unknown) => void;
    dispose();
    dispose();
    listener({ runId: 'disposed-run' });
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(fixture.send).not.toHaveBeenCalled();
  });

  it.each(['room.createDemo', 'room.getMessages', 'run.getSnapshot', 'run.subscribe', 'run.start', 'run.pause', 'run.stop', 'run.step', 'run.resumeRun', 'run.retryTurn', 'run.continueMessage', 'run.recoverInterruptedRun'])('guards the source before handling %s', async (channel) => {
    const bound = bind();
    Object.assign(bound.event, { senderFrame: null });
    await expect(Promise.resolve().then(() => fixture.handlers.get(channel)!(bound.event, undefined))).rejects.toThrow('Unauthorized IPC sender');
    bound.dispose();
  });
});
