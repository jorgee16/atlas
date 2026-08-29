import {
  MapLibrePmtilesMapAdapter
} from './maplibre-pmtiles-map-adapter.js';

export function installMapLibreUserGesturePolicy() {
  const prototype = MapLibrePmtilesMapAdapter?.prototype;
  if (!prototype || prototype.__atlasUserGesturePolicyInstalled) return;

  Object.defineProperty(prototype, '__atlasUserGesturePolicyInstalled', {
    value: true
  });

  prototype.onUserMoveStart = function onUserMoveStart(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('onUserMoveStart requires a callback.');
    }

    // A pinch zoom changes only the desired scale. It must not be interpreted
    // as leaving Follow mode, because FollowModeController.stopFollowing()
    // resets bearing to north-up. Dragging/rotating/pitching still means the
    // user intentionally took manual camera control and should pause Follow.
    for (const eventName of [
      'dragstart',
      'rotatestart',
      'pitchstart'
    ]) {
      this.map.on(eventName, event => {
        if (event?.originalEvent) callback(event);
      });
    }
  };
}
