export function installTracksFollowStateBridge(root, app) {
  if (!root || !app || root.dataset.tracksFollowBridgeInstalled === 'true') {
    return;
  }

  const appContext = app.appContext;
  const atlasMap = appContext?.map ?? null;
  const followMode = appContext?.get?.('followMode') ?? null;
  const gpsButton = root.querySelector('#gpsBtn');

  if (!atlasMap || !followMode || !gpsButton) return;

  root.dataset.tracksFollowBridgeInstalled = 'true';

  let active = false;
  let gpsWasEnabled = false;
  let followWasEnabled = false;
  let tracksStartedGps = false;

  const enter = () => {
    if (active) return;
    active = true;

    gpsWasEnabled = gpsButton.classList.contains('on');
    followWasEnabled = followMode.isFollowing?.() === true;
    tracksStartedGps = !gpsWasEnabled;

    atlasMap.setNavigationTravelMode?.('walk');
    followMode.setNavigationActive?.(true, {
      trackPosition: true
    });

    if (tracksStartedGps) {
      gpsButton.click();
    }
  };

  const leave = () => {
    if (!active) return;
    active = false;

    atlasMap.setNavigationTravelMode?.(null);
    followMode.setNavigationActive?.(false);

    if (!followWasEnabled) {
      followMode.stopFollowing?.();
    }

    if (
      tracksStartedGps &&
      gpsButton.classList.contains('on')
    ) {
      gpsButton.click();
    }

    tracksStartedGps = false;
    gpsWasEnabled = false;
    followWasEnabled = false;
  };

  const sync = () => {
    if (root.classList.contains('tracks-following')) enter();
    else leave();
  };

  const observer = new MutationObserver(sync);
  observer.observe(root, {
    attributes: true,
    attributeFilter: ['class']
  });

  sync();
}
