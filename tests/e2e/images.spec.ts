import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { imagesIn, memberOf, textIn } from './support/fixture';
import { expect, memberTexts, newDiscussion, root, seedDeepSeekRoom, statusHas, test, threadItems, type Harness, type RunningApp } from './support/app';

// D147: images in a discussion, in the real app. Paperclip, paste and drag all go through the page's own events; with
// ROUNDTABLE_E2E_SCREENS set it keeps a screenshot of each step, and with ROUNDTABLE_E2E_REAL_CLIPBOARD=1 the paste comes from
// the system clipboard itself (saved and put back), which is left out by default because that clipboard is the person's own.
const screens = process.env.ROUNDTABLE_E2E_SCREENS ? join(root, process.env.ROUNDTABLE_E2E_SCREENS) : undefined;
const captions: Array<{ file: string; caption: string }> = [];
let shot = 0;

async function capture(running: RunningApp, name: string, caption: string) {
  if (!screens) return;
  await running.page.waitForTimeout(250);
  const base64 = await running.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'));
  const file = `${String(++shot).padStart(2, '0')}-${name}.png`;
  mkdirSync(screens, { recursive: true });
  writeFileSync(join(screens, file), Buffer.from(base64, 'base64'));
  captions.push({ file, caption });
  writeFileSync(join(screens, 'captions.json'), `${JSON.stringify(captions, null, 2)}\n`);
}
const theme = (running: RunningApp, value: 'light' | 'dark') => running.page.evaluate(value => { document.documentElement.dataset.theme = value; }, value);
async function size(running: RunningApp, width: number, height = 800) {
  await running.app.evaluate(({ BrowserWindow }, [w, h]) => { BrowserWindow.getAllWindows()[0]!.setContentSize(w!, h!); }, [width, height]);
  await expect.poll(() => running.page.evaluate(() => window.innerWidth)).toBe(width);
}

/** A real image file of the given type, drawn by the page itself, so what is shown can really be decoded. */
const drawn = async (page: Page, type: 'image/png' | 'image/jpeg' | 'image/webp', label: string, color: string) => Buffer.from(await page.evaluate(async ({ type, label, color }) => {
  const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 420;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#f4f1ea'; context.fillRect(0, 0, 640, 420);
  context.fillStyle = color; for (const [index, height] of [120, 220, 170, 300].entries()) context.fillRect(70 + index * 130, 370 - height, 90, height);
  context.fillStyle = '#1e1d1a'; context.font = '32px sans-serif'; context.fillText(label, 70, 50);
  return canvas.toDataURL(type).split(',')[1];
}, { type, label, color }), 'base64');
const fileIn = (harness: Harness, name: string, bytes: Buffer) => { const path = join(harness.profile, name); writeFileSync(path, bytes); return path; };

async function attachWithPaperclip(page: Page, ...paths: string[]) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '添加图片' }).click();
  await (await chooser).setFiles(paths);
}
/** The clipboard's own image and the app's own paste command. What was on the clipboard goes back afterwards. */
async function pasteFromClipboard(running: RunningApp, bytes: Buffer) {
  await running.app.evaluate(({ clipboard, nativeImage, BrowserWindow }, base64) => {
    const saved = { text: clipboard.readText(), html: clipboard.readHTML(), rtf: clipboard.readRTF(), image: clipboard.readImage() };
    (globalThis as any).__savedClipboard = saved;
    clipboard.write({ image: nativeImage.createFromBuffer(Buffer.from(base64, 'base64')) });
    BrowserWindow.getAllWindows()[0]!.webContents.paste();
  }, bytes.toString('base64'));
}
const restoreClipboard = (running: RunningApp) => running.app.evaluate(({ clipboard }) => {
  const saved = (globalThis as any).__savedClipboard;
  if (saved) clipboard.write({ text: saved.text, html: saved.html, rtf: saved.rtf, ...(saved.image.isEmpty() ? {} : { image: saved.image }) });
});
const fileHandle = (page: Page, bytes: Buffer, name: string, type: string, extra: Record<string, string> = {}) => page.evaluateHandle(({ base64, name, type, extra }) => {
  const transfer = new DataTransfer();
  transfer.items.add(new File([Uint8Array.from(atob(base64), char => char.charCodeAt(0))], name, { type }));
  for (const [format, value] of Object.entries(extra)) transfer.setData(format, value);
  return transfer;
}, { base64: bytes.toString('base64'), name, type, extra });
async function paste(running: RunningApp, bytes: Buffer) {
  const { page } = running;
  if (process.env.ROUNDTABLE_E2E_REAL_CLIPBOARD === '1') {
    const before = await page.locator('.image-tray-item').count();
    await pasteFromClipboard(running, bytes);
    // The paste is read asynchronously, so the clipboard goes back only once the image has arrived.
    try { await expect(page.locator('.image-tray-item')).toHaveCount(before + 1); } finally { await restoreClipboard(running); }
    return;
  }
  const clipboardData = await fileHandle(page, bytes, 'image.png', 'image/png');
  await page.evaluate(({ clipboardData }) => {
    const target = document.activeElement ?? document.body;
    target.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
  }, { clipboardData });
}
async function drag(page: Page, bytes: Buffer, name: string, type: string, then?: () => Promise<void>) {
  const dataTransfer = await fileHandle(page, bytes, name, type);
  const box = page.locator('.composer');
  await box.dispatchEvent('dragenter', { dataTransfer });
  await box.dispatchEvent('dragover', { dataTransfer });
  await expect(box).toHaveClass(/is-dropping/u);
  await then?.();
  await box.dispatchEvent('drop', { dataTransfer });
  await expect(box).not.toHaveClass(/is-dropping/u);
}
const tray = (page: Page) => page.getByRole('list', { name: /待发送的图片/u });
const trayCount = (page: Page, count: number) => expect(tray(page).locator('li img')).toHaveCount(count);
/** Every image shown really decoded: the scheme served it and the page's CSP let it through. */
const allDecoded = (page: Page, selector: string, count: number) => expect.poll(() => page.evaluate(selector => [...document.querySelectorAll<HTMLImageElement>(selector)].filter(image => image.complete && image.naturalWidth > 0).length, selector)).toBe(count);
const noSideways = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

async function setModels(running: RunningApp, models: Array<[string, string]>) {
  const provider = (await running.api<Array<{ id: string; kind: string }>>('settings.listProviderSummaries')).find(item => item.kind === 'compatible')!;
  const room = (await running.api<{ items?: unknown } | Array<{ id: string }>>('rooms.listRooms', {})) as Array<{ id: string; name: string }>;
  const agents = await running.api<Array<Record<string, any>>>('rooms.listAgentConfigurations', { roomId: room[0].id });
  for (const agent of agents) {
    const wanted = models.find(([name]) => name === agent.displayName);
    if (wanted) await running.api('rooms.updateAgent', { id: agent.id, roomId: agent.roomId, displayName: agent.displayName, roleTemplateId: agent.roleTemplateId, systemPrompt: agent.systemPrompt, providerId: provider.id, modelId: wanted[1], enabled: agent.enabled, displayOrder: agent.displayOrder });
  }
  await running.page.reload(); await running.page.waitForSelector('.sidebar');
}

test('a host attaches images three ways, members with the right model see them, and they are still there after a restart', async ({ harness }) => {
  const { fixture } = harness;
  fixture.reply = body => `${memberOf(body)}的看法：先改第二栏。`;
  const running = await harness.launch();
  const { page } = running;
  const consoleErrors: string[] = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await seedDeepSeekRoom(running);
  await setModels(running, [['审查者', 'deepseek-v4-pro']]);
  await newDiscussion(running, 'E2E 讨论', '这张图的布局怎么改？');
  // The goal typed through the IME above is untouched by everything below.

  // Each member's row says whether its model reads images.
  const rows = page.locator('.setup-row');
  await expect(rows.filter({ hasText: '起草者' })).toContainText('能看图');
  await expect(rows.filter({ hasText: '审查者' })).toContainText('看不了图');
  await capture(running, 'setup-rows', '新讨论页：成员行写明这个模型能否看图；回形针在输入框左下角。');

  const png = await drawn(page, 'image/png', 'PNG 截图', '#2d6a55');
  const jpeg = await drawn(page, 'image/jpeg', 'JPEG 照片', '#85560f');
  const webp = await drawn(page, 'image/webp', 'WebP 图表', '#356489');
  const fourth = await drawn(page, 'image/png', '第四张', '#a93434');
  const fifth = await drawn(page, 'image/png', '第五张', '#57534b');

  // 1. The paperclip opens the system's dialog. The name says PNG; the bytes are what counts.
  await attachWithPaperclip(page, fileIn(harness, '截图.png', png));
  await trayCount(page, 1);
  await expect(page.getByRole('note').filter({ hasText: '审查者的模型看不到图片，只会收到一句说明。' })).toBeVisible();
  await capture(running, 'paperclip', '点回形针选一张：马上显示缩略图；下面就地写明审查者看不到图片，不拦截开始。');

  // 2. Paste into the goal box.
  await page.getByRole('textbox', { name: '讨论目标' }).focus();
  await paste(running, jpeg);
  await trayCount(page, 2);

  // 3. Drag in; the box shows it is ready to take the file.
  await drag(page, webp, '图表.webp', 'image/webp', () => capture(running, 'dragging', '拖入图片时，输入框换底色并描边，表示可以松手。'));
  await trayCount(page, 3);
  await capture(running, 'three-ways', '回形针、粘贴、拖入各加了一张，共三张；缩略图不把输入框撑开。');

  // What does not qualify says why, and nothing already there is lost. The names lie on purpose.
  await attachWithPaperclip(page, fileIn(harness, '假装是图片.png', Buffer.from('GIF89a 这其实是动图')));
  await expect(page.getByRole('alert').filter({ hasText: '“假装是图片.png” 不是 PNG、JPEG 或 WebP 图片，没有加上。' })).toBeVisible();
  await trayCount(page, 3);
  await capture(running, 'refused-type', '文件头不对：就地写明原因，已有的三张不受影响。');
  await attachWithPaperclip(page, fileIn(harness, 'drawing.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')));
  await expect(page.getByRole('alert').filter({ hasText: '不是 PNG、JPEG 或 WebP' })).toBeVisible();
  const tooBig = Buffer.concat([png, Buffer.alloc(10 * 1024 * 1024)]);
  await attachWithPaperclip(page, fileIn(harness, '很大的图.png', tooBig));
  await expect(page.getByRole('alert').filter({ hasText: '“很大的图.png” 超过 10 MB，没有加上。' })).toBeVisible();
  await attachWithPaperclip(page, fileIn(harness, '第四张.png', fourth), fileIn(harness, '第五张.png', fifth));
  await expect(page.getByRole('alert').filter({ hasText: '每条消息最多 4 张，多出来的 1 张没有加上。' })).toBeVisible();
  await trayCount(page, 4);
  await capture(running, 'four-limit', '第五张没有加上，并说明原因；四张缩略图排得下。');

  // A goal needs words. Removing them leaves the images and says what is missing.
  const goal = page.getByRole('textbox', { name: '讨论目标' });
  const typed = await goal.inputValue();
  expect(typed).toBe('这张图的布局怎么改？');
  await goal.fill('');
  await expect(page.getByRole('button', { name: '开始讨论' })).toBeDisabled();
  await expect(page.getByRole('note').filter({ hasText: '讨论目标要写一句文字，图片作为补充。' })).toBeVisible();
  await capture(running, 'goal-needs-words', '目标必须有文字：开始按钮不可用，并写明原因。');
  await goal.click();
  await running.ime('mubiao', '这张图的布局怎么改？');
  await expect(goal).toHaveValue('这张图的布局怎么改？');
  await trayCount(page, 4);

  await page.getByRole('button', { name: '移除第 4 张图片' }).click();
  await trayCount(page, 3);
  await theme(running, 'dark');
  await capture(running, 'tray-dark', '深色：输入框、缩略图和提示。');
  await theme(running, 'light');
  await size(running, 800, 600);
  await attachWithPaperclip(page, fileIn(harness, '再加一张.png', fourth));
  await trayCount(page, 4);
  await noSideways(page);
  await capture(running, 'narrow', '800×600 窄窗口：四张缩略图和提示都在，没有横向溢出。');
  await page.getByRole('button', { name: '移除第 4 张图片' }).click();
  await size(running, 1280);

  // Each mode's step: pause after every turn, so an interjection can land between members.
  await page.getByText('每回合后暂停').click();
  await page.getByRole('button', { name: '开始讨论' }).click();
  await statusHas(page, '已暂停');
  await expect(tray(page)).toHaveCount(0);

  const first = fixture.requests[0];
  expect(memberOf(first)).toBe('起草者');
  // Nothing but the images in `image_url`, on the user side, whole and in order.
  expect(imagesIn(first.messages).map(image => image.role)).toEqual(['user', 'user', 'user']);
  expect(imagesIn(first.messages)[0].url).toBe(`data:image/png;base64,${png.toString('base64')}`);
  expect(imagesIn(first.messages)[1].url.startsWith('data:image/png;base64,') || imagesIn(first.messages)[1].url.startsWith('data:image/jpeg;base64,')).toBe(true);
  expect(imagesIn(first.messages)[2].url).toBe(`data:image/webp;base64,${webp.toString('base64')}`);
  expect(first.messages.filter(message => message.role === 'system').every(message => typeof message.content === 'string')).toBe(true);
  expect(textIn(first.messages.at(-1))).toContain('主持人附了 3 张图片');

  // The goal keeps its images, and each opens large.
  const goalImages = page.locator('.goal-card .message-image img');
  await expect(goalImages).toHaveCount(3);
  await allDecoded(page, '.goal-card .message-image img', 3);
  await capture(running, 'goal-card', '讨论开始后：目标卡片里是三张缩略图，第一位成员已经回应。');
  await page.getByRole('button', { name: '看大图：第 1 张，共 3 张' }).click();
  const viewer = page.locator('dialog.image-viewer');
  await expect(viewer).toContainText('图片 1 / 3');
  await allDecoded(page, 'dialog.image-viewer img', 1);
  await capture(running, 'viewer', '点缩略图看大图：写明类型和大小，可以上一张、下一张。');
  await viewer.getByRole('button', { name: '下一张' }).click();
  await expect(viewer).toContainText('图片 2 / 3');
  await theme(running, 'dark');
  await capture(running, 'viewer-dark', '深色的大图。');
  await theme(running, 'light');
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);

  // An interjection that is only a pasted image: the hint names who will not see it, and it can be sent.
  const box = page.getByRole('textbox', { name: '主持人插话' });
  await box.focus();
  await paste(running, fourth);
  await trayCount(page, 1);
  await expect(page.getByRole('note').filter({ hasText: '审查者的模型看不到图片' })).toBeVisible();
  await capture(running, 'interject-tray', '插话框：粘贴一张图，发送处写明谁看不到。');
  await page.getByRole('button', { name: '发送插话' }).click();
  await expect(tray(page)).toHaveCount(0);
  const hostImage = threadItems(page).locator('.msg.is-host').last();
  await expect(hostImage.locator('.message-image img')).toHaveCount(1);
  await expect(hostImage.locator('.bubble')).toHaveCount(0);

  // 审查者 cannot read images: the request says so plainly and holds none.
  await page.getByRole('button', { name: '下一步' }).click();
  await statusHas(page, '已暂停');
  const second = fixture.requests[1];
  expect(memberOf(second)).toBe('审查者');
  expect(imagesIn(second.messages)).toEqual([]);
  expect(second.messages.every(message => typeof message.content === 'string')).toBe(true);
  expect(textIn(second.messages.at(-1))).toContain('主持人附了 3 张图片，你的模型看不到');
  expect(textIn(second.messages.at(-1))).toContain('主持人附了 1 张图片，你的模型看不到');
  await capture(running, 'blind-member', '只有图的插话显示在时间线右侧；看不了图的审查者照常发言，它收到的是一句说明。');

  // Words typed with an IME and a dragged image together, then the next member reads both.
  await box.click();
  await running.ime('kandi', '看第三栏');
  await drag(page, fifth, '第五张.png', 'image/png');
  await trayCount(page, 1);
  await expect(box).toHaveValue('看第三栏');
  await page.getByRole('button', { name: '发送插话' }).click();
  await expect(tray(page)).toHaveCount(0);
  await expect(threadItems(page).locator('.msg.is-host').last().locator('.bubble')).toContainText('看第三栏');
  await capture(running, 'interject-words', '中文插话加一张拖入的图：缩略图在上，文字气泡在下。');

  // The summary says plainly what it does with images, before anything is sent.
  await page.getByRole('button', { name: '选择范围和成员…' }).click();
  await expect(page.locator('dialog[open]').getByRole('note')).toContainText('摘要只依据文字');
  await capture(running, 'summary-note', '生成摘要前写明：图片不进摘要，被代替的插话里的图片不再发送，目标里的图片照常发送。');
  await page.locator('dialog[open]').getByRole('button', { name: '关闭' }).first().click();

  // Let go anywhere on the page, and the image still reaches the box.
  const elsewhere = await fileHandle(page, fifth, '别处.png', 'image/png');
  await page.locator('.thread-item').first().dispatchEvent('drop', { dataTransfer: elsewhere });
  await trayCount(page, 1);
  await page.getByRole('button', { name: '移除第 1 张图片' }).click();
  await page.getByRole('button', { name: '继续' }).click();
  await statusHas(page, '已完成');
  const third = fixture.requests[2];
  expect(memberOf(third)).toBe('综合者');
  expect(imagesIn(third.messages)).toHaveLength(5);
  expect(textIn(third.messages.at(-1))).toContain('看第三栏');
  await theme(running, 'dark');
  await capture(running, 'finished-dark', '深色：讨论完成后的时间线。');
  await size(running, 800, 600);
  await noSideways(page);
  await capture(running, 'timeline-narrow-dark', '深色 800×600：时间线里的缩略图不撑破窗口。');
  await size(running, 1280);
  await theme(running, 'light');

  // Continuing a finished discussion takes images too.
  const carryOn = page.getByRole('textbox', { name: '继续讨论' });
  await carryOn.focus();
  await attachWithPaperclip(page, fileIn(harness, '补充.png', fifth));
  await trayCount(page, 1);
  await carryOn.click();
  await running.ime('jixu', '再看这一张');
  await capture(running, 'continue', '讨论结束后继续：同样可以附图。');
  await page.getByRole('button', { name: '发送并继续讨论' }).click();
  await statusHas(page, '已完成');
  expect(imagesIn(fixture.requests.at(-1)!.messages).length).toBeGreaterThan(0);
  await expect(memberTexts(page).last()).toContainText('的看法');

  // Everything needed is on disk under the profile, by hash; the database keeps no bytes.
  const stored = readdirSync(join(harness.profile, 'userData', 'attachments'));
  expect(stored.length).toBeGreaterThan(0);
  for (const name of stored) expect(name).toMatch(/^[0-9a-f]{64}\.(png|jpg|webp)$/u);
  const snapshots = harness.sql('SELECT input_snapshot FROM request_attempts')[0].map((row: { input_snapshot: string }) => row.input_snapshot).join('\n');
  expect(snapshots).toContain('"type":"image"');
  expect(snapshots).not.toContain('base64');
  expect(readFileSync(harness.database).includes(png.toString('base64').slice(0, 200))).toBe(false);
  expect(running.output).not.toContain(png.toString('base64').slice(0, 200));
  await running.expectNoNetwork();
  expect(consoleErrors.filter(text => /Content Security Policy|rt-image|Not allowed to load/u.test(text))).toEqual([]);

  // The page has one thing it can do with images, and no way to reach a file.
  await expect(running.api('attachment.addImage', { path: '/etc/passwd' })).rejects.toBeDefined();
  await expect(running.api('attachment.addImage', { bytes: '/etc/passwd' })).rejects.toBeDefined();
  expect(await page.evaluate(() => Object.keys((window as any).roundtable.attachment))).toEqual(['addImage']);
  expect(await page.evaluate(async id => { try { await fetch(`rt-image://local/${id}`); return 'read'; } catch { return 'refused'; } }, stored[0]!.slice(0, 64))).toBe('refused');
  expect(await page.evaluate(() => new Promise(resolve => { const image = new Image(); image.onload = () => resolve('shown'); image.onerror = () => resolve('refused'); image.src = 'file:///etc/hosts'; }))).toBe('refused');
  expect(await page.evaluate(() => new Promise(resolve => { const image = new Image(); image.onload = () => resolve('shown'); image.onerror = () => resolve('refused'); image.src = 'rt-image://local/../../../etc/hosts'; }))).toBe('refused');

  // Restart: the same run, the same images, read back from disk. What was attached and never sent is gone.
  await page.getByRole('main').getByRole('button', { name: '新讨论' }).click();
  await page.getByRole('textbox', { name: '讨论目标' }).focus();
  const never = await drawn(page, 'image/png', '从没发送', '#000000');
  await paste(running, never);
  await trayCount(page, 1);
  await running.quit();
  const again = await harness.launch();
  await again.page.locator('.sidebar .sb-item', { hasText: 'E2E 讨论' }).first().click();
  await again.page.locator('.room-page').getByRole('button', { name: '打开' }).first().click();
  await allDecoded(again.page, '.goal-card .message-image img', 3);
  await expect(again.page.locator('.msg.is-host .message-image img')).toHaveCount(3);
  await allDecoded(again.page, '.msg.is-host .message-image img', 3);
  await capture(again, 'after-restart', '重启后打开这场讨论：目标和插话里的图片都还在，从磁盘读出。');
  // Exactly the images history uses remain: removed from a draft or never sent, they are gone from disk and from the records.
  const used = harness.sql('SELECT sha256 FROM message_attachments UNION SELECT sha256 FROM run_task_attachments')[0].map((row: { sha256: string }) => row.sha256).sort();
  expect(readdirSync(join(harness.profile, 'userData', 'attachments')).map(name => name.slice(0, 64)).sort()).toEqual(used);
  expect(used).toHaveLength(harness.sql('SELECT COUNT(*) AS n FROM attachments')[0][0].n);
  await again.quit();
});

test('when no member can see images it says so without stopping, and a discovered model is shown as unknown', async ({ harness }) => {
  const { fixture } = harness;
  fixture.modelList = () => ['deepseek-next-vision', 'deepseek-flash', 'deepseek-v4-pro'];
  fixture.reply = () => '看不到图片，只依据文字回答。';
  const running = await harness.launch();
  const { page } = running;
  await seedDeepSeekRoom(running);
  await setModels(running, [['起草者', 'deepseek-v4-pro'], ['审查者', 'deepseek-v4-pro'], ['综合者', 'deepseek-v4-pro']]);
  await newDiscussion(running, 'E2E 讨论', '全员看不了图');
  await attachWithPaperclip(page, fileIn(harness, '图.png', await drawn(page, 'image/png', '全员', '#2d6a55')));
  await trayCount(page, 1);
  await expect(page.getByRole('note').filter({ hasText: '这场讨论的成员都看不到图片，他们只会收到一句说明。' })).toBeVisible();
  await capture(running, 'all-blind', '全员都看不了图：同样就地提示，开始按钮仍然可用。');
  await expect(page.getByRole('button', { name: '开始讨论' })).toBeEnabled();

  // A model the service's list added: the catalog cannot say. The request carries the image; a refusal is a normal failure.
  const provider = (await running.api<Array<{ id: string; kind: string }>>('settings.listProviderSummaries')).find(item => item.kind === 'compatible')!;
  await running.api('settings.refreshModels', { providerId: provider.id });
  await page.reload(); await page.waitForSelector('.sidebar');
  await setModels(running, [['起草者', 'deepseek-next-vision']]);
  await newDiscussion(running, 'E2E 讨论', '未知能力的模型');
  await expect(page.locator('.setup-row').filter({ hasText: '起草者' })).toContainText('能否看图未知');
  const picture = await drawn(page, 'image/png', '未知', '#356489');
  await attachWithPaperclip(page, fileIn(harness, '图.png', picture));
  await trayCount(page, 1);
  await expect(page.getByRole('note').filter({ hasText: '起草者的模型不确定能否看图；如果服务商拒绝，换一个能看图的模型。' })).toBeVisible();
  await capture(running, 'unknown-model', '自动发现的模型：成员行写“能否看图未知”，发送处提醒服务商可能拒绝。');
  fixture.chatError = raw => raw.model === 'deepseek-next-vision' ? { status: 400, body: { error: { code: 'image_not_supported', message: '不应该显示这句话' } } } : undefined;
  await page.getByRole('button', { name: '开始讨论' }).click();
  await statusHas(page, '失败');
  expect(fixture.failedRequests.at(-1)?.model).toBe('deepseek-next-vision');
  const notice = page.locator('.run-notices');
  await expect(notice).toContainText('image_not_supported');
  await expect(notice).toContainText('如果这个模型不接受图片');
  await expect(notice).not.toContainText('不应该显示这句话');
  await capture(running, 'unknown-refused', '服务商拒绝：显示它的错误码，并建议换一个能看图的模型；服务商的原话不显示。');
  await theme(running, 'dark');
  await capture(running, 'unknown-refused-dark', '深色的失败提示。');
  await running.quit();
});

test('images that together do not fit one request are flagged before sending, and the discussion still runs without them', async ({ harness }) => {
  const { fixture } = harness;
  fixture.reply = () => '只依据文字回答。';
  const running = await harness.launch();
  const { page } = running;
  await seedDeepSeekRoom(running);
  await newDiscussion(running, 'E2E 讨论', '三张大图');
  const big = async (label: string) => Buffer.concat([await drawn(page, 'image/png', label, '#2d6a55'), Buffer.alloc(8 * 1024 * 1024)]);
  await attachWithPaperclip(page, fileIn(harness, '一.png', await big('一')), fileIn(harness, '二.png', await big('二')));
  await trayCount(page, 2);
  await expect(page.getByRole('note').filter({ hasText: '合计超过' })).toHaveCount(0);
  await attachWithPaperclip(page, fileIn(harness, '三.png', await big('三')));
  await trayCount(page, 3);
  await expect(page.getByRole('note').filter({ hasText: '这几张图片合计超过 20 MB，一次请求放不下' })).toBeVisible();
  await capture(running, 'over-request-limit', '三张 8 MB 合计超过单次请求 20 MB：发送前就地说明，不拦截。');
  await theme(running, 'dark');
  await capture(running, 'over-request-limit-dark', '深色的同一提示。');
  await theme(running, 'light');
  await page.getByRole('button', { name: '开始讨论' }).click();
  await statusHas(page, '已完成');
  expect(imagesIn(fixture.requests[0].messages)).toEqual([]);
  expect(textIn(fixture.requests[0].messages.at(-1))).toContain('主持人附了 3 张图片，这次请求放不下，没有附上');
  await allDecoded(page, '.goal-card .message-image img', 3);
  await running.quit();
});

