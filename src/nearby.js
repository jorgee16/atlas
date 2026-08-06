import {
  formatDistance,
  escapeHtml,
  googleWalkingDirections
} from './utils.js';
import { RegionRepository } from './search/region-repository.js';
import {
  LocalRegionProvider
} from './search/providers/local-region-provider.js';

// Nearby-search composition root.
// The rest of the application continues to use queryNearby(anchor).
const regionRepository = new RegionRepository();

const localRegionProvider = new LocalRegionProvider({
  regionRepository
});

export function queryNearby(anchor, radiusMeters = 900) {
  return localRegionProvider.search(anchor, radiusMeters);
}

export function nearbyCardHtml(place) {
  return `
    <b>${escapeHtml(place.name)}</b>
    <small>
      ${escapeHtml(place.amenity || 'place')} ·
      ${formatDistance(place.distance)}
    </small>
    <a
      target="_blank"
      rel="noopener"
      href="${googleWalkingDirections(place.name)}"
    >
      Directions in Google Maps →
    </a>
  `;
}
