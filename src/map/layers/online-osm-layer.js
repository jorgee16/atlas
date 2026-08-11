import L from 'leaflet';

export function createOnlineOsmLayer() {
  const layer = L.tileLayer(
    'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors'
    }
  );

  layer.on('loading', () => {
    console.log('[OSM] loading tiles');
  });

  layer.on('tileload', event => {
    console.log(
      '[OSM] tile loaded:',
      event.tile?.src
    );
  });

  layer.on('tileerror', event => {
    console.error(
      '[OSM] TILE ERROR:',
      event.tile?.src,
      event.error
    );
  });

  layer.on('load', () => {
    console.log('[OSM] tile batch complete');
  });

  return layer;
}
