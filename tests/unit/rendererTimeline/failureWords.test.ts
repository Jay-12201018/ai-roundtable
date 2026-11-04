import { describe, expect, it } from 'vitest';
import { requestFailureText } from '../../../src/renderer/features/timeline/failure';
import { messageStatusText } from '../../../src/renderer/features/timeline/model';

describe('what a failed message says', () => {
  it('says a part was kept only when there is one', () => {
    expect(messageStatusText({ status: 'failed', content: '' })).toBe('生成失败');
    expect(messageStatusText({ status: 'failed', content: '一半' })).toBe('生成失败，已保留部分文字');
    expect(messageStatusText({ status: 'aborted', content: '' })).toBe('已中止');
    expect(messageStatusText({ status: 'aborted', content: '一半' })).toBe('已中止 · 保留部分文字');
    expect(messageStatusText({ status: 'streaming', content: '' })).toBe('正在发言');
    expect(messageStatusText({ status: 'completed', content: '全部' })).toBe('');
  });
  it('words a 404 from the service as being about its model, not the service', () => {
    const text = requestFailureText({ status: 'failed', errorCode: 'not_found' });
    expect(text).toContain('服务商找不到这个模型，或者它还没在服务商那里开通，请到服务商控制台检查');
    expect(text).not.toContain('已经不存在');
  });
});
