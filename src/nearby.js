import {
  formatDistance,
  escapeHtml,
  googleWalkingDirections
} from './utils.js';
import { RegionRepository } from './search/region-repository.js';
import {
  LocalRegionProvider
} from './search/providers/local-region-provider.js';
import {
  RoutingRoadProvider
} from './search/providers/routing-road-provider.js';
import {
  AddressStreetProvider
} from './search/providers/address-street-provider.js';

// Nearby and destination-search composition root. Keep it lazy so importing
// navigation logic does not fetch or initialize region data until a search is
// actually requested.
let localRegionProvider = null;
let routingRoadProvider = null;
let addressStreetProvider = null;
let sharedRegionRepository = null;

function regionRepository() {
  sharedRegionRepository ??= new RegionRepository();
  return sharedRegionRepository;
}

function provider() {
  if (!localRegionProvider) {
    localRegionProvider = new LocalRegionProvider({
      regionRepository: regionRepository()
    });
  }

  return localRegionProvider;
}

function roadProvider() {
  if (!routingRoadProvider) {
    routingRoadProvider = new RoutingRoadProvider({
      regionRepository: regionRepository()
    });
  }

  return routingRoadProvider;
}


function addressProvider() {
  if (!addressStreetProvider) {
    addressStreetProvider = new AddressStreetProvider({
      regionRepository: regionRepository()
    });
  }

  return addressStreetProvider;
}

export function queryNearby(anchor, radiusMeters = 900) {
  return provider().search(anchor, radiusMeters);
}

function looksLikeRoadQuery(query) {
  const normalized = String(query ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .trim();

  if (!normalized) return false;

  const compactPostcode = normalized.replace(/[^a-z0-9]/g, '');
  const postcodeLike =
    /^\d{4}\d{0,3}$/.test(compactPostcode) ||
    /^[a-z]{1,2}\d[a-z\d]?\d[a-z]{2}$/.test(compactPostcode);

  // Explicit house numbers and common Portuguese/English street designators
  // are strong signals that the user wants an address rather than a POI.
  return (
    postcodeLike ||
    /\b\d+[a-z]?\b/.test(normalized) ||
    /\b(?:rua|r\.|avenida|av\.?|estrada|travessa|largo|praca|praceta|alameda|calcada|beco|road|rd\.?|street|st\.?|avenue|ave\.?|lane|ln\.?|drive|dr\.?|way|boulevard|blvd\.?|close|court|ct\.?|place|pl\.?)\b/.test(normalized)
  );
}

function mergeDestinationResults(places, roads, limit) {
  const seen = new Set();

  return [...places, ...roads]
    .sort((a, b) =>
      (a.matchScore ?? 100) - (b.matchScore ?? 100) ||
      (a.distance ?? Infinity) - (b.distance ?? Infinity)
    )
    .filter(place => {
      const key = `${String(place.name).toLocaleLowerCase()}|${Math.round(place.lat * 10000)}|${Math.round(place.lon * 10000)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .map(({ matchScore, ...place }) => place);
}

export async function queryDestinations(
  query,
  anchor,
  options = {}
) {
  const limit = Math.max(1, options.limit ?? 12);
  const searchLimit = limit * 2;
  const roadLikeQuery = looksLikeRoadQuery(query);

  // POI/text search is the fast path. Do not initialize the routing graph for
  // ordinary destination names: on large regions that graph is hundreds of
  // MB and was previously on the critical path of every search-box query.
  let places = [];
  let placesError = null;

  try {
    places = await provider().searchByName(query, anchor, {
      ...options,
      limit: searchLimit,
      includeScore: true
    });
  } catch (error) {
    placesError = error;
  }

  // Dedicated address/street binaries are the primary path for road-like
  // queries. They stay unloaded for normal POI searches and avoid waking the
  // much larger routing graph merely to resolve a street name or house number.
  let addresses = [];
  if (roadLikeQuery || !places.length) {
    try {
      addresses = await addressProvider().search(query, anchor, {
        ...options,
        limit: searchLimit
      });
    } catch {
      addresses = [];
    }
  }

  // Routing-road lookup is now last-resort compatibility for older installed
  // regions that do not yet contain address-index.bin/address-records.bin, or
  // for an indexed address query that returned no useful result.
  let roads = [];
  if (!addresses.length && (roadLikeQuery || !places.length)) {
    try {
      roads = await roadProvider().searchByName(query, anchor, {
        ...options,
        limit: searchLimit
      });
    } catch {
      roads = [];
    }
  }

  if (!places.length && !roads.length && placesError) {
    throw placesError;
  }

  return mergeDestinationResults([...addresses, ...places], roads, limit);
}

function humanizeNearbyType(value) {
  const normalized = String(value || 'place')
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .trim();

  return normalized
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word[0]?.toUpperCase() + word.slice(1))
    .join(' ');
}

function nearbyImage(place) {
  return place.image || place.thumbnail || place.imageUrl || '';
}

function nearbyCategory(place) {
  const values = [
    place.amenity,
    place.tourism,
    place.shop,
    place.leisure,
    place.historic,
    place.aeroway,
    place.railway,
    place.public_transport,
    place.type,
    place.place
  ].filter(Boolean).map(value => String(value).toLowerCase());

  const value = values.join(' ');
  const rules = [
    [/clock/, ['🕰️', 'Landmark', 'Clock tower']],
    [/monument|memorial|historic|castle|fort|tower/, ['🏛️', 'Landmark', 'Historic site']],
    [/museum/, ['🏛️', 'Museum', 'Museum']],
    [/gallery/, ['🖼️', 'Gallery', 'Gallery']],
    [/attraction|viewpoint|artwork/, ['📸', 'Attraction', 'Point of interest']],
    [/place_of_worship|church|cathedral|chapel|mosque|synagogue|temple/, ['⛪', 'Place of Worship', 'Religious site']],
    [/cafe|coffee|ice_cream/, ['☕', 'Café', 'Café']],
    [/restaurant|food_court/, ['🍴', 'Restaurant', 'Restaurant']],
    [/fast_food/, ['🍔', 'Fast Food', 'Food']],
    [/pub|bar|biergarten/, ['🍺', 'Pub & Bar', 'Drinks']],
    [/park|garden|nature_reserve|playground/, ['🌳', 'Park', 'Outdoor']],
    [/hotel|hostel|guest_house|motel|apartment|camp_site/, ['🛏️', 'Stay', 'Accommodation']],
    [/supermarket|convenience|mall|department_store|shop/, ['🛍️', 'Shop', 'Shopping']],
    [/pharmacy|hospital|clinic|doctors|dentist|veterinary/, ['⚕️', 'Health', 'Health']],
    [/airport|aerodrome|terminal/, ['✈️', 'Airport', 'Transport']],
    [/station|subway|tram|railway|bus_station|ferry_terminal/, ['🚉', 'Transport', 'Transport']],
    [/parking/, ['🅿️', 'Parking', 'Parking']]
  ];

  for (const [pattern, result] of rules) {
    if (pattern.test(value)) return result;
  }

  const fallback = humanizeNearbyType(
    place.amenity ||
    place.tourism ||
    place.shop ||
    place.leisure ||
    place.historic ||
    place.type ||
    place.place ||
    'place'
  );
  return ['📍', fallback, fallback];
}

export function nearbyPresentation(place) {
  const [icon, category, subtype] = nearbyCategory(place);
  return { icon, category, subtype };
}

function nearbyDetails(place) {
  const details = [];
  const push = value => {
    const text = String(value ?? '').trim();
    if (text && !details.includes(text)) details.push(text);
  };

  if (place.cuisine) push(humanizeNearbyType(place.cuisine));
  if (place.brand && place.brand !== place.name) push(place.brand);

  const address = [
    place['addr:housenumber'] || place.housenumber,
    place['addr:street'] || place.street
  ].filter(Boolean).join(' ');
  push(address);

  push(
    place['addr:suburb'] ||
    place['addr:city'] ||
    place.city ||
    place.suburb
  );

  if (place.iata) push(`IATA ${place.iata}`);
  if (place.opening_hours) push(place.opening_hours);
  if (place.wheelchair === 'yes') push('♿ Accessible');
  if (place.fee === 'no') push('Free entry');

  return details.slice(0, 3);
}

export function nearbyCardHtml(place) {
  const { icon, category, subtype } = nearbyPresentation(place);
  const details = nearbyDetails(place);
  const image = nearbyImage(place);
  const placeId = String(
    place.id ??
    `${place.name ?? 'place'}:${place.lat ?? ''}:${place.lon ?? ''}`
  );
  const metadata = [subtype, ...details]
    .filter(Boolean)
    .slice(0, 3);

  return `
    <article class="nearby-card${image ? ' has-thumbnail' : ''}">
      ${image ? `
        <img
          class="nearby-thumb"
          src="${escapeHtml(image)}"
          alt=""
          loading="lazy"
          decoding="async"
        />
      ` : ''}
      <div class="nearby-card-body">
        <div class="nearby-card-heading">
          <div class="nearby-title-wrap">
            <span class="nearby-category-icon" aria-hidden="true">${icon}</span>
            <b>${escapeHtml(place.name)}</b>
          </div>
          <span class="nearby-distance">${formatDistance(place.distance)}</span>
        </div>
        <div class="nearby-card-meta">
          <span class="nearby-type">${escapeHtml(category)}</span>
          ${metadata.map(detail => `<span>${escapeHtml(detail)}</span>`).join('')}
        </div>
        <div class="nearby-card-actions">
          <button type="button" class="nearby-action nearby-action--quiet"
            data-nearby-show="${escapeHtml(placeId)}">Show</button>
          <button type="button" class="nearby-action nearby-action--primary"
            data-nearby-navigate="${escapeHtml(placeId)}">Navigate</button>
          <button type="button" class="nearby-action nearby-action--quiet"
            data-nearby-bookmark="${escapeHtml(placeId)}">Bookmark</button>
          <a
            class="nearby-action nearby-action--quiet nearby-action--maps"
            target="_blank"
            rel="noopener"
            href="${googleWalkingDirections(place)}"
          >Google Maps</a>
        </div>
      </div>
    </article>
  `;
}
