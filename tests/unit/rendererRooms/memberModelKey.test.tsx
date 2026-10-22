import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomsFeature } from '../../../src/renderer/features/rooms/RoomsFeature';
import { agent, props } from './fixtures';
afterEach(cleanup);

// Synthetic look-alike, never a real credential.
const pastedKey = 'sk-0123456789abcdef0123456789abcdef';
function deepSeekProps() {
  const p = props();
  p.providers = [{ ...p.providers[0], id: 'ds', kind: 'openai-compatible', name: 'DeepSeek', customModels: [], defaultModelId: 'deepseek-flash' }];
  return p;
}

describe('D096 member Model field', () => {
  it('shows an example, flags a pasted API Key at once and refuses to save it', async () => {
    const p = deepSeekProps(); render(<RoomsFeature {...p} />); await screen.findByText('构思员');
    fireEvent.click(screen.getByRole('button', { name: '新增成员' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('成员名称'), { target: { value: '审查者' } });
    fireEvent.change(dialog.getByLabelText('成员角色'), { target: { value: 'Critic' } });
    fireEvent.change(dialog.getByLabelText('Provider'), { target: { value: 'ds' } });
    const model = dialog.getByLabelText('Model') as HTMLInputElement;
    expect(model.placeholder).toContain('例如 deepseek-flash');
    fireEvent.change(model, { target: { value: pastedKey } });
    expect(dialog.getByRole('alert').textContent).toBe('这看起来是 API Key，不是模型 ID。Key 请到“模型设置”里对应 Provider 的“API Key”一栏填写；这里只填模型 ID。');
    expect(model.getAttribute('aria-invalid')).toBe('true');
    fireEvent.click(dialog.getByRole('button', { name: '保存成员' }));
    expect(p.api.createAgent).not.toHaveBeenCalled();
    fireEvent.change(model, { target: { value: 'deepseek-flash' } });
    expect(dialog.queryByRole('alert')).toBeNull();
    fireEvent.click(dialog.getByRole('button', { name: '保存成员' }));
    await waitFor(() => expect(p.api.createAgent).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'ds', modelId: 'deepseek-flash' })));
  });

  it('explains a withheld legacy value in the member list and keeps it out of later saves', async () => {
    const p = deepSeekProps();
    vi.mocked(p.api.listAgentConfigurations).mockResolvedValue([{ ...agent(), providerId: 'ds', modelId: null, withheldModelId: true }]);
    render(<RoomsFeature {...p} />); await screen.findByText('构思员');
    expect(screen.getByText(/之前填写的 Model 看起来是 API Key，已隐藏且不会使用/u)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '编辑 构思员' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText(/之前填写的内容看起来是 API Key，已隐藏且不会使用，请重新填写/u)).toBeTruthy();
    fireEvent.change(dialog.getByLabelText('Model'), { target: { value: 'deepseek-flash' } });
    fireEvent.click(dialog.getByRole('button', { name: '保存成员' }));
    await waitFor(() => expect(p.api.updateAgent).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'deepseek-flash' })));
    expect(vi.mocked(p.api.updateAgent).mock.calls[0][0]).not.toHaveProperty('withheldModelId');
  });
});
