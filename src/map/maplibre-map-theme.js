import {
  MapLibrePmtilesMapAdapter
} from './maplibre-pmtiles-map-adapter.js';

const INSTALLED = Symbol('atlas-map-theme-installed');
const LISTENER = Symbol('atlas-map-theme-listener');
const STYLE_LISTENER = Symbol('atlas-map-theme-style-listener');

const LIGHT = Object.freeze({
  background: '#f3f1ec',
  land: '#e8eadf',
  landResidential: '#f0efea',
  landCommercial: '#eee9e5',
  landIndustrial: '#e9e7e3',
  landGreen: '#d9e8d2',
  landGrass: '#e3edd9',
  landFarmland: '#eee9d8',
  water: '#b9dceb',
  waterway: '#9bc9df',
  park: '#dcebd2',
  building: '#d8d4ce',
  buildingOutline: '#c5c0b9',
  roadCasing: '#c7c2bb',
  roadMinor: '#ffffff',
  motorway: '#e8aaa3',
  trunk: '#efc48e',
  primary: '#f0d7aa',
  secondary: '#fff5d7',
  path: '#b8b5ae',
  boundary: '#9c8fa8',
  label: '#4e5562',
  placeLabel: '#303744',
  poiLabel: '#5d6470',
  houseLabel: '#818793',
  labelHalo: 'rgba(255,255,255,0.96)',
  routeCasing: '#ffffff',
  traveledRoute: '#737b8c'
});

const DARK = Object.freeze({
  background: '#101722',
  land: '#161f2b',
  landResidential: '#1b2531',
  landCommercial: '#202936',
  landIndustrial: '#242a34',
  landGreen: '#183025',
  landGrass: '#1c3428',
  landFarmland: '#2a2c25',
  water: '#173247',
  waterway: '#28546d',
  park: '#183426',
  building: '#2b3440',
  buildingOutline: '#394553',
  roadCasing: '#0b111a',
  roadMinor: '#394453',
  motorway: '#7f4b50',
  trunk: '#765a3e',
  primary: '#6d6048',
  secondary: '#505047',
  path: '#56616d',
  boundary: '#657080',
  label: '#cbd3df',
  placeLabel: '#f1f5f9',
  poiLabel: '#b5bfcc',
  houseLabel: '#929eac',
  labelHalo: 'rgba(12,18,27,0.92)',
  routeCasing: '#0a1018',
  traveledRoute: '#6f7c8d'
});

function resolvedTheme() {
  return document.documentElement?.dataset?.atlasTheme === 'dark'
    ? 'dark'
    : 'light';
}

function palette(theme) {
  return theme === 'dark' ? DARK : LIGHT;
}

function setPaint(map, layerId, property, value) {
  try {
    if (!map?.getLayer?.(layerId)) return;
    map.setPaintProperty(layerId, property, value);
  } catch (error) {
    console.warn(
      `Unable to theme MapLibre layer ${layerId}.${property}.`,
      error
    );
  }
}

function landExpression(p) {
  return [
    'match', ['get', 'kind'],
    'forest', p.landGreen,
    'wood', p.landGreen,
    'park', p.park,
    'grass', p.landGrass,
    'grassland', p.landGrass,
    'meadow', p.landGrass,
    'recreation_ground', p.landGrass,
    'orchard', p.landGreen,
    'vineyard', p.landGreen,
    'farmland', p.landFarmland,
    'farmyard', p.landFarmland,
    'cemetery', p.landGreen,
    'residential', p.landResidential,
    'commercial', p.landCommercial,
    'retail', p.landCommercial,
    'industrial', p.landIndustrial,
    'railway', p.landIndustrial,
    'quarry', p.landIndustrial,
    'wetland', p.landGreen,
    'beach', p.landFarmland,
    'sand', p.landFarmland,
    p.land
  ];
}

function roadExpression(p) {
  return [
    'match', ['get', 'kind'],
    'motorway', p.motorway,
    'motorway_link', p.motorway,
    'trunk', p.trunk,
    'trunk_link', p.trunk,
    'primary', p.primary,
    'primary_link', p.primary,
    'secondary', p.secondary,
    'secondary_link', p.secondary,
    p.roadMinor
  ];
}

export function applyMapLibreTheme(map, theme = resolvedTheme()) {
  const p = palette(theme);

  setPaint(map, 'atlas-background', 'background-color', p.background);

  for (const id of ['atlas-land', 'atlas-landcover']) {
    if (id === 'atlas-land') {
      setPaint(map, id, 'fill-color', landExpression(p));
    } else {
      setPaint(map, id, 'fill-color', p.land);
    }
  }

  setPaint(map, 'atlas-landuse', 'fill-color', p.landResidential);
  setPaint(map, 'atlas-park', 'fill-color', p.park);
  setPaint(map, 'atlas-ocean', 'fill-color', p.water);
  setPaint(map, 'atlas-water', 'fill-color', p.water);
  setPaint(map, 'atlas-waterway', 'line-color', p.waterway);

  for (const id of ['atlas-buildings', 'atlas-building']) {
    setPaint(map, id, 'fill-color', p.building);
    setPaint(map, id, 'fill-outline-color', p.buildingOutline);
  }

  for (const id of [
    'atlas-roads-casing',
    'atlas-major-roads-casing',
    'atlas-minor-roads-casing',
    'atlas-transportation-casing'
  ]) {
    setPaint(map, id, 'line-color', p.roadCasing);
  }

  setPaint(map, 'atlas-roads', 'line-color', roadExpression(p));
  setPaint(map, 'atlas-major-roads', 'line-color', roadExpression(p));
  setPaint(map, 'atlas-minor-roads', 'line-color', p.roadMinor);
  setPaint(map, 'atlas-transportation', 'line-color', p.roadMinor);
  setPaint(map, 'atlas-paths', 'line-color', p.path);
  setPaint(map, 'atlas-aeroway', 'line-color', p.path);

  for (const id of ['atlas-boundaries', 'atlas-boundary']) {
    setPaint(map, id, 'line-color', p.boundary);
  }

  for (const id of ['atlas-road-labels', 'atlas-street-labels']) {
    setPaint(map, id, 'text-color', p.label);
    setPaint(map, id, 'text-halo-color', p.labelHalo);
  }

  setPaint(map, 'atlas-place-labels', 'text-color', p.placeLabel);
  setPaint(map, 'atlas-place-labels', 'text-halo-color', p.labelHalo);
  setPaint(map, 'atlas-poi-labels', 'text-color', p.poiLabel);
  setPaint(map, 'atlas-poi-labels', 'text-halo-color', p.labelHalo);
  setPaint(map, 'atlas-house-numbers', 'text-color', p.houseLabel);
  setPaint(map, 'atlas-house-numbers', 'text-halo-color', p.labelHalo);

  /* Route colors remain intentionally high-contrast in both themes. Only the
   * casing/traveled line adapts so the active blue/orange guidance keeps the
   * same semantic meaning at night. */
  setPaint(map, 'atlas-route-casing', 'line-color', p.routeCasing);
  setPaint(map, 'atlas-route-traveled', 'line-color', p.traveledRoute);

  map?.triggerRepaint?.();
  return theme;
}

function scheduleApply(adapter) {
  queueMicrotask(() => applyMapLibreTheme(adapter.map, adapter.atlasMapTheme));
  globalThis.setTimeout?.(
    () => applyMapLibreTheme(adapter.map, adapter.atlasMapTheme),
    0
  );
}

function ensureThemeBinding(adapter) {
  if (adapter[INSTALLED]) return;
  adapter[INSTALLED] = true;
  adapter.atlasMapTheme = resolvedTheme();

  adapter[LISTENER] = event => {
    adapter.atlasMapTheme =
      event?.detail?.resolved === 'dark' ? 'dark' : 'light';
    applyMapLibreTheme(adapter.map, adapter.atlasMapTheme);
  };

  document.documentElement?.addEventListener?.(
    'atlasappearancechange',
    adapter[LISTENER]
  );

  adapter[STYLE_LISTENER] = () => {
    scheduleApply(adapter);
  };
  adapter.map?.on?.('style.load', adapter[STYLE_LISTENER]);

  scheduleApply(adapter);
}

const originalSetRegion = MapLibrePmtilesMapAdapter.prototype.setRegion;
const originalShowRoute = MapLibrePmtilesMapAdapter.prototype.showRoute;
const originalUpdateRouteProgress =
  MapLibrePmtilesMapAdapter.prototype.updateRouteProgress;
const originalUpdateUserLocation =
  MapLibrePmtilesMapAdapter.prototype.updateUserLocation;

MapLibrePmtilesMapAdapter.prototype.setRegion = async function (...args) {
  ensureThemeBinding(this);
  const result = await originalSetRegion.apply(this, args);
  scheduleApply(this);
  return result;
};

MapLibrePmtilesMapAdapter.prototype.showRoute = function (...args) {
  ensureThemeBinding(this);
  const result = originalShowRoute.apply(this, args);
  scheduleApply(this);
  return result;
};

MapLibrePmtilesMapAdapter.prototype.updateRouteProgress = function (...args) {
  ensureThemeBinding(this);
  const result = originalUpdateRouteProgress.apply(this, args);
  scheduleApply(this);
  return result;
};

MapLibrePmtilesMapAdapter.prototype.updateUserLocation = function (...args) {
  ensureThemeBinding(this);
  return originalUpdateUserLocation.apply(this, args);
};

export function installMapLibreMapTheme() {
  return true;
}
