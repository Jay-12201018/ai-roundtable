import { describe, expect, it, vi } from 'vitest';
import { sendInterjection } from '../../../src/renderer/features/composer/interject';
import { mentionQuery, mentionedMembers, withoutMentions, type MentionOption } from '../../../src/renderer/features/composer/mention';
import type { CommandInput, CommandOutcome } from '../../../src/renderer/features/host/useHostCommands';

const options: MentionOption[] = [
  { agentId: 'a', name: '审查', available: true, reason: '' },
  { agentId: 'b', name: '审查者', available: true, reason: '' },
  { agentId: 'c', name: '综合者', available: false, reason: '不在当前阶段，按讨论方式现在不能点名' },
];
type Step = (command: CommandInput) => CommandOutcome;
const requester = (step: Step = () => ({ ok: true, duplicate: false })) => {
  const calls: CommandInput[] = [];
  const request = vi.fn(async (_key: string, command: CommandInput, _options: { quiet: true }) => { calls.push(command); return step(command); });
  return { request, calls };
};

describe('D4: @ in an interjection = setOverride, then interject', () => {
  it('sends the two existing commands in order, keeping the @ in the public text', async () => {
    const { request, calls } = requester();
    const result = await sendInterjection('@审查者 先看成本', options, undefined, request);
    expect(calls).toEqual([{ kind: 'setOverride', agentId: 'b' }, { kind: 'interject', content: '@审查者 先看成本' }]);
    expect(request.mock.calls.every(call => call[2].quiet)).toBe(true);
    expect(result).toMatchObject({ clear: true, steps: { override: 'sent', interject: 'sent' } });
    expect(result.notice).toContain('已点名审查者并发送插话');
  });

  it('only interjects when nobody is named, and only names when nothing else is written', async () => {
    let probe = requester();
    expect(await sendInterjection('补充一点', options, undefined, probe.request)).toMatchObject({ clear: true, steps: { override: 'none', interject: 'sent' } });
    expect(probe.calls).toEqual([{ kind: 'interject', content: '补充一点' }]);
    probe = requester();
    const named = await sendInterjection(' @审查者  ', options, undefined, probe.request);
    expect(probe.calls).toEqual([{ kind: 'setOverride', agentId: 'b' }]);
    expect(named).toMatchObject({ clear: true, steps: { override: 'sent', interject: 'none' } });
    expect(named.notice).toContain('已点名审查者，将在下一回合发言');
  });

  it('stops before the interjection when naming fails, and says the text was not sent', async () => {
    const { request, calls } = requester(() => ({ ok: false, message: '当前状态不允许此操作。' }));
    const result = await sendInterjection('@审查者 先看成本', options, undefined, request);
    expect(calls).toEqual([{ kind: 'setOverride', agentId: 'b' }]);
    expect(result).toMatchObject({ clear: false, steps: { override: 'failed', interject: 'blocked' } });
    expect(result.error).toBe('点名审查者没有成功：当前状态不允许此操作。插话还没有发送，内容保留在输入框里。');
  });

  it('says exactly which step went through when the interjection fails after the override, and does not undo it', async () => {
    const { request, calls } = requester(command => command.kind === 'interject' ? { ok: false, message: '与主进程的连接失败，请重试。' } : { ok: true, duplicate: false });
    const result = await sendInterjection('@审查者 先看成本', options, undefined, request);
    expect(calls.map(call => call.kind)).toEqual(['setOverride', 'interject']);
    expect(calls.some(call => call.kind === 'cancelOverride')).toBe(false);
    expect(result).toMatchObject({ clear: false, steps: { override: 'sent', interject: 'failed' } });
    expect(result.error).toBe('已点名审查者，排在下一回合；但插话没有发送：与主进程的连接失败，请重试。内容保留在输入框里，可以再发一次（不会重复点名）。');
    // Sending again with the override in place skips step one.
    const again = requester();
    expect(await sendInterjection('@审查者 先看成本', options, 'b', again.request)).toMatchObject({ clear: true, steps: { override: 'already', interject: 'sent' } });
    expect(again.calls).toEqual([{ kind: 'interject', content: '@审查者 先看成本' }]);
  });

  it('refuses before sending anything when two members or an unavailable member are named', async () => {
    const two = requester();
    const both = await sendInterjection('@审查者 和 @审查 一起看', options, undefined, two.request);
    expect(two.calls).toEqual([]);
    expect(both).toMatchObject({ clear: false, steps: { override: 'blocked', interject: 'blocked' } });
    expect(both.error).toContain('一次只能点名一位成员');
    const off = requester();
    const blocked = await sendInterjection('@综合者 总结一下', options, undefined, off.request);
    expect(off.calls).toEqual([]);
    expect(blocked.error).toBe('综合者不在当前阶段，按讨论方式现在不能点名。去掉“@综合者”后，可以作为普通插话发送。');
  });
});

describe('mentions are parsed only from what the host typed', () => {
  it('prefers the longest whole name and finds the @query before the caret', () => {
    expect(mentionedMembers('请 @审查者 看', options).map(item => item.agentId)).toEqual(['b']);
    expect(mentionedMembers('请 @审查 看', options).map(item => item.agentId)).toEqual(['a']);
    expect(mentionedMembers('邮箱 a@b.com', options)).toEqual([]);
    expect(withoutMentions('@审查者 看', options.slice(1, 2))).toBe('看');
    expect(mentionQuery('你好 @审', 5)).toEqual({ start: 3, query: '审' });
    expect(mentionQuery('@', 1)).toEqual({ start: 0, query: '' });
    expect(mentionQuery('a@b', 3)).toBeUndefined();
  });
});

describe('D110: @ the member the schedule already has next sends only the words', () => {
  it('does not insert a Turn for the planned next speaker; they read the words when they speak', async () => {
    const { request, calls } = requester();
    const result = await sendInterjection('@审查者 先核一下预算数字', options, undefined, request, 'b');
    expect(calls).toEqual([{ kind: 'interject', content: '@审查者 先核一下预算数字' }]);
    expect(result).toMatchObject({ clear: true, steps: { override: 'scheduled', interject: 'sent' } });
    expect(result.notice).toBe('审查者按计划就是下一位，会在发言时看到你这段话（没有多插一轮）。');
    const bare = requester();
    expect(await sendInterjection('@审查者', options, undefined, bare.request, 'b')).toMatchObject({ steps: { override: 'scheduled', interject: 'none' }, notice: '审查者按计划就是下一位，不用点名。' });
    expect(bare.calls).toEqual([]);
  });

  it('still inserts a Turn for anyone else, such as the member speaking now, or when another member is already named', async () => {
    // 审查者 is speaking; 审查 is next by plan: naming 审查者 inserts a Turn after the current one.
    let probe = requester();
    await sendInterjection('@审查者 再说说', options, undefined, probe.request, 'a');
    expect(probe.calls).toEqual([{ kind: 'setOverride', agentId: 'b' }, { kind: 'interject', content: '@审查者 再说说' }]);
    // With 审查 already named, the schedule is not what decides; naming 审查者 replaces that choice as before.
    probe = requester();
    await sendInterjection('@审查者 换你', options, 'a', probe.request, 'b');
    expect(probe.calls[0]).toEqual({ kind: 'setOverride', agentId: 'b' });
  });
});
