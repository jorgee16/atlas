import {distanceMeters, formatDistance, escapeHtml, googleWalkingDirections} from './utils.js';

export async function queryNearby(anchor, radiusMeters = 900) {
  const query = `[out:json][timeout:20];(nwr["amenity"~"cafe|restaurant|pub|bar"](around:${radiusMeters},${anchor.lat},${anchor.lon});nwr["tourism"~"museum|gallery|attraction|viewpoint"](around:${radiusMeters},${anchor.lat},${anchor.lon}););out center tags;`;
  const response = await fetch('https://overpass-api.de/api/interpreter', {method:'POST', body:query});
  if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`);
  const data = await response.json();
  return data.elements.map(element => {
    const lat = element.lat ?? element.center?.lat;
    const lon = element.lon ?? element.center?.lon;
    const tags = element.tags ?? {};
    return {id:element.id, lat, lon, name:tags.name, amenity:tags.amenity ?? tags.tourism ?? '', type:classify(tags)};
  }).filter(place => Number.isFinite(place.lat) && Number.isFinite(place.lon) && place.name)
    .map(place => ({...place, distance:distanceMeters(anchor.lat, anchor.lon, place.lat, place.lon)}))
    .sort((a,b) => a.distance - b.distance);
}

function classify(tags) {
  if (tags.amenity === 'cafe') return 'cafe';
  if (['restaurant','fast_food'].includes(tags.amenity)) return 'restaurant';
  if (['pub','bar'].includes(tags.amenity)) return 'pub';
  return 'attraction';
}

export function nearbyCardHtml(place, anchorName) {
  return `<b>${escapeHtml(place.name)}</b><small>${escapeHtml(place.amenity || 'place')} · ${formatDistance(place.distance)}</small><a target="_blank" rel="noopener" href="${googleWalkingDirections(place.name)}">Directions in Google Maps →</a>`;
}
