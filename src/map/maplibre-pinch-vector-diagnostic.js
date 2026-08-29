const STATE = new WeakMap();

function findMap() {
  const app = globalThis.roamApp;
  const adapter = app?.map?.adapter ?? app?.mapAdapter ?? null;
  return adapter?.map ?? null;
}

function hideBaseLayers(map) {
  const previous = new Map();
  const layers = map?.getStyle?.()?.layers ?? [];

  for (const layer of layers) {
    if (!layer?.id || layer.type === 'background') continue;
    if (layer.id.startsWith('atlas-route-')) continue;
    if (layer.id.startsWith('atlas-nearby')) continue;

    try {
      const visibility = map.getLayoutProperty?.(layer.id, 'visibility') ?? 'visible';
      previous.set(layer.id, visibility);
      map.setLayoutProperty?.(layer.id, 'visibility', 'none');
    } catch {}
  }

  map.triggerRepaint?.();
  return previous;
}

function restoreBaseLayers(map, previous) {
  for (const [layerId, visibility] of previous ?? []) {
    try {
      if (map.getLayer?.(layerId)) {
        map.setLayoutProperty?.(layerId, 'visibility', visibility);
      }
    } catch {}
  }
  map.triggerRepaint?.();
}

function sync() {
  const map = findMap();
  if (!map) return;

  const active = document.documentElement.classList.contains('atlas-map-gesture-active');
  const state = STATE.get(map) ?? { hidden: false, previous: null };

  if (active && !state.hidden) {
    state.previous = hideBaseLayers(map);
    state.hidden = true;
  } else if (!active && state.hidden) {
    restoreBaseLayers(map, state.previous);
    state.previous = null;
    state.hidden = false;
  }

  STATE.set(map, state);
}

const observer = new MutationObserver(sync);
observer.observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['class']
});

queueMicrotask(sync);
