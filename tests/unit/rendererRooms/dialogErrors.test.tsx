import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomsFeature } from '../../../src/renderer/features/rooms/RoomsFeature';
import { agent, props } from './fixtures';

afterEach(cleanup);

describe('R07 dialog error feedback', () => {
  it('shows a room save failure inside the dialog, retaining the draft and a single alert', async () => {
    const p = props(); vi.mocked(p.api.updateRoom).mockRejectedValue({ code: 'transport_error' });
    render(<RoomsFeature {...p} />); await screen.findByRole('heading', { name: '项目讨论' });
    fireEvent.click(screen.getByRole('button', { name: '编辑房间' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('房间名称'), { target: { value: '保留草稿' } });
    fireEvent.click(dialog.getByRole('button', { name: '保存房间' }));
    expect((await dialog.findByRole('alert')).textContent).toContain('连接失败');
    expect((dialog.getByLabelText('房间名称') as HTMLInputElement).value).toBe('保留草稿');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('clears corrected room validation before reporting the service failure', async () => {
    const p = props(); vi.mocked(p.api.createRoom).mockRejectedValue({ code: 'transport_error' });
    render(<RoomsFeature {...p} />); await screen.findByRole('heading', { name: '项目讨论' });
    fireEvent.click(screen.getByRole('button', { name: '新建房间' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.click(dialog.getByRole('button', { name: '保存房间' }));
    expect(dialog.getByRole('alert').textContent).toContain('请填写房间名称');
    fireEvent.change(dialog.getByLabelText('房间名称'), { target: { value: '完整房间' } });
    expect(dialog.queryByRole('alert')).toBeNull();
    fireEvent.click(dialog.getByRole('button', { name: '保存房间' }));
    expect((await dialog.findByRole('alert')).textContent).toContain('连接失败');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('shows member save failures inside the dialog after correcting validation', async () => {
    const p = props(); vi.mocked(p.api.createAgent).mockRejectedValue({ code: 'invalid_state' });
    render(<RoomsFeature {...p} />); await screen.findByText('构思员');
    fireEvent.click(screen.getByRole('button', { name: '新增成员' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.click(dialog.getByRole('button', { name: '保存成员' }));
    expect(dialog.getByRole('alert').textContent).toContain('请填写成员名称与角色');
    fireEvent.change(dialog.getByLabelText('成员名称'), { target: { value: '核验员' } });
    fireEvent.change(dialog.getByLabelText('成员角色'), { target: { value: 'Critic' } });
    expect(dialog.queryByRole('alert')).toBeNull();
    fireEvent.click(dialog.getByRole('button', { name: '保存成员' }));
    expect((await dialog.findByRole('alert')).textContent).toContain('历史引用');
    expect((dialog.getByLabelText('成员名称') as HTMLInputElement).value).toBe('核验员');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it.each(['room', 'member'] as const)('announces protected %s deletion only inside its confirmation dialog', async kind => {
    const p = props(); vi.mocked(kind === 'room' ? p.api.deleteRoom : p.api.deleteAgent).mockRejectedValue({ code: 'invalid_state' });
    render(<RoomsFeature {...p} />); await screen.findByText('构思员');
    fireEvent.click(screen.getByRole('button', { name: kind === 'room' ? '删除房间' : '删除 构思员' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.click(dialog.getByRole('button', { name: '确认删除' }));
    expect((await dialog.findByRole('alert')).textContent).toContain('历史引用');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('does not claim an empty or zero-enabled room after the members failed to load', async () => {
    const p = props(); vi.mocked(p.api.listAgentConfigurations).mockRejectedValue({ code: 'transport_error' });
    render(<RoomsFeature {...p} />); await screen.findByRole('alert');
    expect(screen.queryByText('没有启用的成员，无法开始新 Run。')).toBeNull();
    expect(screen.queryByRole('heading', { name: '还没有成员' })).toBeNull();
  });
});

it('gives the Provider selector an exact accessible name independently of its option text', async () => {
  const p = props(); render(<RoomsFeature {...p} />); await screen.findByText('构思员');
  fireEvent.click(screen.getByRole('button', { name: '新增成员' }));
  expect(within(screen.getByRole('dialog')).getByRole('combobox', { name: 'Provider' })).toBeTruthy();
});

it('lets the user clear a legacy model-only reference when no Provider configuration exists', async () => {
  const p = props(); p.providers = [];
  vi.mocked(p.api.listAgentConfigurations).mockResolvedValue([{ ...agent(), providerId: null, modelId: 'legacy-model' }]);
  render(<RoomsFeature {...p} />); await screen.findByText('构思员');
  fireEvent.click(screen.getByRole('button', { name: '编辑 构思员' }));
  const dialog = within(screen.getByRole('dialog')); const model = dialog.getByLabelText('Model') as HTMLInputElement;
  expect(model.disabled).toBe(false); expect(model.value).toBe('legacy-model');
  fireEvent.change(model, { target: { value: '' } }); fireEvent.click(dialog.getByRole('button', { name: '保存成员' }));
  await waitFor(() => expect(p.api.updateAgent).toHaveBeenCalledWith(expect.objectContaining({ providerId: null, modelId: null })));
});
