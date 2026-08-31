import './styles.css';
import './map/maplibre-navigation-ui.css';
import './map/maplibre-touch-zoom.js';
import './map/maplibre-nearby-layer.js';
import './map/maplibre-follow-continuity.js';
import './features/tracks/tracks-shell-ui.css';
import './features/tracks/tracks-active-isolation.css';
import './features/tracks/tracks-follow-ui.css';
import './features/tracks/tracks-detail-compact.css';
import "./ui/components/header/header.css";
import "./ui/components/status-toast/status-toast.css";
import "./ui/components/overflow-menu/overflow-menu.css";
import './ui/atlas-ui-consistency.css';
import './ui/navigation-light-contrast.css';
import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { createApp } from './app.js';
import { installTracksShellUI } from './features/tracks/tracks-shell-ui.js';
import { installTracksFollowStateBridge } from './features/tracks/tracks-follow-state-bridge.js';
import { installTracksAndroidFilePickerCompatibility } from './features/tracks/tracks-android-file-picker.js';

// MapLibre GL JS 6 requires bundler consumers to provide an emitted worker
// URL explicitly. Without this Vite/Capacitor can mount the WebGL canvas and
// raster/background layers while the vector-tile worker never starts, leaving
// the style permanently "loading" with zero rendered vector features.
// `?worker&url` makes Vite bundle the worker and its shared module as a
// self-contained asset that Capacitor copies into the Android web bundle.
maplibregl.setWorkerUrl(maplibreWorkerUrl);

const root = document.querySelector('#app');

window.roamApp = await createApp(root);
installTracksShellUI(root);
installTracksFollowStateBridge(root, window.roamApp);
installTracksAndroidFilePickerCompatibility(root);

if ('serviceWorker' in navigator) {
  window.addEventListener(
    'load',
    () => navigator.serviceWorker
      .register('/sw.js', {
        updateViaCache: 'none'
      })
      .then(registration =>
        registration.update()
      )
      .catch(console.error)
  );
}
