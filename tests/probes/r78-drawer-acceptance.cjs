// Drawers across layouts, hands-on: the production build with real mouse and keyboard input, in an isolated profile.
// Crossing a layout closes its drawers; a click right after the crossing opens the navigation drawer and stays open.
// One screenshot per step into docs/verification/maint-r78-drawer-screens/.
// Usage: electron tests/probes/r78-drawer-acceptance.cjs
const { resolve } = require('node:path');
const { createProbe } = require('./r16-harness.cjs');

const probe = createProbe({ prefix: 'roundtable-r78-drawer', name: 'R78_DRAWER', timeoutMs: 300000 });
const { check, sleep } = probe;
const screens = resolve(probe.root, 'docs/verification/maint-r78-drawer-screens');

async function main() {
  const ui = await probe.start({ screens, width: 1280, height: 800 });
  const { js, until, click, key, capture, api, window } = ui;
  const layout = value => until(`document.querySelector('.app-shell')?.dataset.layout === ${JSON.stringify(value)}`, 'layout ' + value, 10000);
  const drawer = side => js(`Boolean(document.querySelector('.drawer.is-${side}'))`);
  const noDrawer = () => until(`!document.querySelector('.drawer')`, 'no drawer', 5000);
  const opened = side => until(`(() => { const shown = document.querySelector('.drawer.is-${side}'); return shown && shown.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running') && shown.getClientRects().length > 0; })()`, side + ' drawer settled', 5000);
  const setWidth = async (width, height = 600) => { window.setContentSize(width, height); await until(`innerWidth === ${width}`, 'width ' + width, 10000); };

  const room = await api('rooms.createRoom', { name: '抽屉验收房间', objective: '' });
  await js('location.reload(); true'); await until(`document.querySelector('.sidebar')`, 'reloaded'); await ui.ensureLocator();
  await click('抽屉验收房间', { selector: '.sb-item' }); await click('新讨论', { scope: '.room-page' });
  await until(`document.querySelector('.composer')`, 'discussion page');
  await layout('wide');
  await capture('wide', '宽屏：导航在侧栏，没有抽屉');

  // Path 1: the moment the layout folds, the menu is pressed with a real mouse click and the drawer opens.
  let immediate = 0;
  for (let round = 0; round < 20; round++) {
    window.setContentSize(1280, 800); await layout('wide'); await sleep(40);
    window.setContentSize(800, 600); await layout('narrow');
    await click('打开导航');
    await opened('left');
    immediate += await drawer('left') ? 1 : 0;
    await key('Escape'); await noDrawer();
  }
  check(immediate === 20, 'A click right after the fold opens the drawer, 20 of 20');
  await capture('narrow', '缩到 800 宽：导航收起，左上角出现菜单按钮');

  // Path 2: opening and the ways of closing.
  await click('打开导航'); await opened('left');
  await capture('nav-open', '点菜单按钮：导航抽屉打开，后面的内容被遮罩');
  await key('Escape'); await noDrawer();
  check(await js(`document.activeElement?.getAttribute('aria-label') === '打开导航'`), 'Esc closes the drawer and hands focus back to the menu button');
  await click('打开导航'); await opened('left');
  await ui.mouse(700, 300); await noDrawer();
  await click('打开导航'); await opened('left');
  await click('关闭导航'); await noDrawer();
  await capture('nav-closed', '按 Esc、点遮罩、点关闭都能关上抽屉');

  // Path 3: staying within a layout leaves the drawer open.
  await click('打开导航'); await opened('left');
  await setWidth(900); await sleep(200);
  check(await drawer('left'), 'Resizing within the narrow layout leaves the drawer open');
  await capture('nav-kept', '窄屏内从 800 拉到 900：抽屉还开着');

  // Path 4: leaving the layout closes it, and coming back does not reopen it.
  await setWidth(1280, 800); await layout('wide'); await noDrawer();
  await capture('wide-closed', '拉到宽屏：导航抽屉关闭，导航回到侧栏');
  await setWidth(800); await layout('narrow'); await sleep(200);
  check(!(await drawer('left')), 'Coming back to narrow does not reopen the drawer');
  await capture('back-narrow', '再缩回窄屏：抽屉没有自己打开');

  // Path 5: 本场信息 drawer follows the same rule.
  await click('本场信息'); await opened('right');
  await capture('panel-open', '窄屏点本场信息：右侧抽屉打开');
  await setWidth(1100, 700); await layout('medium'); await noDrawer();
  await capture('panel-closed', '拉到中等宽度：本场信息抽屉关闭');
  await click('本场信息'); await opened('right');
  await capture('panel-medium', '中等宽度点本场信息：仍然是抽屉');
  await setWidth(1280, 800); await layout('wide'); await noDrawer();
  await capture('panel-wide', '拉到宽屏：抽屉关闭，没有残留遮罩');
  check(await js(`!document.querySelector('.scrim')`), 'No scrim left behind');
  await ui.finish();
}

main().catch(probe.fail);
