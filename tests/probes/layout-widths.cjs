// Shipped layout at the two widths STATUS still listed as unchecked: 1024 and 1600, light and dark.
// Isolated profile, production build, no network. Screenshots land in docs/verification/2026-11-17-layout-screens/.
// Usage: electron tests/probes/layout-widths.cjs
const { resolve } = require('node:path');
const { createProbe } = require('./r16-harness.cjs');

const probe = createProbe({ prefix: 'roundtable-layout-widths', name: 'LAYOUT_WIDTHS', timeoutMs: 180000 });
const { check, sleep } = probe;
const screens = resolve(probe.root, 'docs/verification/2026-11-17-layout-screens');

async function main() {
  const ui = await probe.start({ screens, width: 1024, height: 768 });
  const { js, until, click, capture, resize, ensureLocator } = ui;
  const layout = value => until(`document.querySelector('.app-shell')?.dataset.layout === ${JSON.stringify(value)}`, 'layout ' + value, 10000);
  const noOverflow = () => js('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 && document.body.scrollWidth <= document.body.clientWidth + 1');
  const dockWidth = () => js(`document.querySelector('.dock-inner')?.getBoundingClientRect().width ?? 0`);

  const applyTheme = async theme => {
    await js(`localStorage.setItem('roundtable.theme', ${JSON.stringify(theme)}); location.reload(); true`);
    await until(`document.querySelector('.app-shell') && document.documentElement.dataset.theme === ${JSON.stringify(theme)}`, theme + ' theme', 20000);
    await ensureLocator();
  };

  await applyTheme('light');
  await until(`document.body.innerText.includes('开始试玩')`, 'welcome text', 20000);
  await layout('medium');
  ui.window.show();
  await sleep(700);
  check(await noOverflow(), '1024 welcome does not scroll sideways');
  check(await js(`Boolean(document.querySelector('.app-side')) && !document.querySelector('.app-context')`), '1024 welcome keeps the sidebar and has no context column');
  await capture('1024-light-welcome', '1024×768 浅色：侧栏在，欢迎页两张卡片并排，没有横向滚动');

  await click('开始试玩');
  await until(`document.querySelector('.composer')`, 'discussion', 20000);
  await layout('medium');
  check(await noOverflow(), '1024 discussion does not scroll sideways');
  check(await js(`Boolean(document.querySelector('.app-side')) && !document.querySelector('.app-context') && !document.querySelector('.drawer')`), '1024 discussion keeps the sidebar and folds the context panel');
  check(await dockWidth() <= 760.5, '1024 composer stays within the 760px reading width');
  await capture('1024-light-discussion', '1024×768 浅色：讨论页侧栏在，本场信息收起，正文不超过阅读宽度');

  await resize(1600, 1000);
  await layout('wide');
  check(await noOverflow(), '1600 discussion does not scroll sideways');
  check(await js(`Boolean(document.querySelector('.app-side')) && Boolean(document.querySelector('.app-context'))`), '1600 discussion shows sidebar, conversation and context together');
  check(await dockWidth() <= 760.5, '1600 composer stays within the 760px reading width');
  await capture('1600-light-discussion', '1600×1000 浅色：导航、讨论、本场信息三栏都在，正文仍限在阅读宽度里');

  await applyTheme('dark');
  await resize(1024, 768);
  await until(`document.querySelector('.composer')`, 'dark discussion', 20000);
  await layout('medium');
  check(await noOverflow(), '1024 dark discussion does not scroll sideways');
  check(await js(`Boolean(document.querySelector('.app-side')) && !document.querySelector('.app-context')`), '1024 dark discussion folds the context panel');
  await capture('1024-dark-discussion', '1024×768 深色：侧栏在，本场信息收起');

  await resize(1600, 1000);
  await layout('wide');
  check(await noOverflow(), '1600 dark discussion does not scroll sideways');
  check(await js(`Boolean(document.querySelector('.app-side')) && Boolean(document.querySelector('.app-context'))`), '1600 dark discussion shows all three columns');
  check(await dockWidth() <= 760.5, '1600 dark composer stays within the 760px reading width');
  await capture('1600-dark-discussion', '1600×1000 深色：三栏都在，正文仍限在阅读宽度里');

  await ui.finish();
}

main().catch(probe.fail);
