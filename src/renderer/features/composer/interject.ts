import type { CommandInput, CommandOutcome } from '../host/useHostCommands';
import { mentionedMembers, withoutMentions, type MentionOption } from './mention';

type Request = (key: string, command: CommandInput, options: { quiet: true }) => Promise<CommandOutcome>;
export type InterjectResult = {
  /** Clear the input only when everything the host asked for was accepted. */
  clear: boolean;
  notice?: string; error?: string;
  steps: { override: 'sent' | 'already' | 'scheduled' | 'none' | 'failed' | 'blocked'; interject: 'sent' | 'none' | 'failed' | 'blocked' };
};

/**
 * D4: an interjection that names a member is two existing host commands sent in order — setOverride, then
 * interject. They are not atomic, so a partial result says exactly which step went through; a step that succeeded
 * is never rolled back, and sending again skips an override that is already in place. D110: naming the member the
 * schedule already has next (`scheduled`) sends only the words — an Override would make them speak twice.
 */
export async function sendInterjection(text: string, options: readonly MentionOption[], currentOverride: string | undefined, request: Request, scheduled?: string): Promise<InterjectResult> {
  const mentioned = mentionedMembers(text, options);
  if (mentioned.length > 1) return { clear: false, steps: { override: 'blocked', interject: 'blocked' },
    error: `一次只能点名一位成员（这里点了${mentioned.map(item => `@${item.name}`).join('、')}）。请只留一个，其余改成普通文字。` };
  const target = mentioned[0];
  if (target && !target.available) return { clear: false, steps: { override: 'blocked', interject: 'blocked' },
    error: `${target.name}${target.reason}。去掉“@${target.name}”后，可以作为普通插话发送。` };
  const content = text.trim() ? text : '';
  const hasWords = withoutMentions(text, mentioned).length > 0;
  let override: InterjectResult['steps']['override'] = 'none';
  if (target) {
    if (currentOverride === target.agentId) override = 'already';
    else if (!currentOverride && scheduled === target.agentId) override = 'scheduled';
    else {
      const result = await request('override', { kind: 'setOverride', agentId: target.agentId }, { quiet: true });
      if (!result.ok) return { clear: false, steps: { override: 'failed', interject: hasWords ? 'blocked' : 'none' },
        error: `点名${target.name}没有成功：${result.message}${hasWords ? '插话还没有发送，内容保留在输入框里。' : ''}` };
      override = 'sent';
    }
  }
  if (!hasWords) return { clear: true, steps: { override, interject: 'none' },
    notice: override === 'scheduled' ? `${target!.name}按计划就是下一位，不用点名。`
      : override === 'already' ? `${target!.name}已经被点名，排在下一回合。` : `已点名${target!.name}，将在下一回合发言（不会打断正在进行的发言）。` };
  const result = await request('interject', { kind: 'interject', content }, { quiet: true });
  if (!result.ok) return { clear: false, steps: { override, interject: 'failed' },
    error: override === 'sent' || override === 'already'
      ? `已点名${target!.name}，排在下一回合；但插话没有发送：${result.message}内容保留在输入框里，可以再发一次（不会重复点名）。`
      : `插话没有发送：${result.message}内容保留在输入框里。` };
  return { clear: true, steps: { override, interject: 'sent' },
    notice: override === 'scheduled' ? `${target!.name}按计划就是下一位，会在发言时看到你这段话（没有多插一轮）。`
      : target ? `已点名${target.name}并发送插话：${target.name}会在下一回合发言，所有成员从下一回合起都能看到这段话。` : '插话已加入公共历史，从下一回合起可见。' };
}
