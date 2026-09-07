export function installNavigationPipStateBridge(root) {
  if (!root || root.__atlasNavigationPipStateInstalled) return;

  root.__atlasNavigationPipStateInstalled = true;
  document.documentElement.dataset.atlasNavigationActive = 'false';

  root.addEventListener('navigationactivechange', event => {
    const active = event?.detail?.active === true;
    document.documentElement.dataset.atlasNavigationActive = String(active);
  });
}
