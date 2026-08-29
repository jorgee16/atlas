import './styles.css';
import './map/maplibre-navigation-ui.css';
import './map/maplibre-touch-zoom.js';
import './map/maplibre-gesture-performance.css';
import './map/maplibre-nearby-layer.js';
import './features/tracks/tracks-shell-ui.css';
import "./ui/components/header/header.css";
import "./ui/components/status-toast/status-toast.css";
import "./ui/components/overflow-menu/overflow-menu.css";
import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { createApp } from './app.js';
import { installTracksShellUI } from './features/tracks/tracks-shell-ui.js';

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
