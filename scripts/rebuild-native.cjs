module.exports = async ({ appDir, electronVersion, platform, arch }) => {
  const { rebuild } = await import('@electron/rebuild');
  // Node test builds can leave Electron's .forge-meta marker behind; never trust it.
  await rebuild({ buildPath: appDir, electronVersion, platform: platform.nodeName, arch, force: true, onlyModules: ['better-sqlite3'] });
  return true;
};
