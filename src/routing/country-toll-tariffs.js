import bundled from './bundled-toll-tables.js';

const normalize = value => String(value).replace(/\s+/g, '').toUpperCase();
export function parseTollTable(country, csv) {
  if (typeof csv !== 'string' || csv.length > 2 * 1024 * 1024) throw new Error('Invalid tariff data');
  const metadata = new Map(), rows = [];
  for (const raw of csv.split('\n')) {
    const line = raw.trim(); if (!line) continue;
    if (line.startsWith('#')) {
      const at = line.indexOf('='); if (at < 0) continue;
      const key = line.slice(1, at).trim(); if (metadata.has(key)) throw new Error('Duplicate metadata');
      metadata.set(key, line.slice(at + 1).trim());
    } else rows.push(line.split(';').map(x => x.trim()));
  }
  if (metadata.get('country') !== country || !/^[A-Z]{3}$/.test(metadata.get('currency')) ||
      !/^\d{4}$/.test(metadata.get('year')) || !metadata.get('source')?.startsWith('https://') ||
      (metadata.has('scheme') && metadata.get('scheme') !== 'road-average')) throw new Error('Invalid tariff provenance');
  const version = metadata.get('version') ?? '0', digits = metadata.get('fractionDigits') ?? '2';
  if (!/^\d{1,16}$/.test(version) || !/^[0-3]$/.test(digits)) throw new Error('Invalid tariff version/precision');
  const header = rows.shift();
  if (header?.slice(0, 3).join(';') !== 'road;section;km' || header.length < 4 || header.length > 35 ||
      !header.slice(3).every(x => /^class[1-9]\d?$/.test(x))) throw new Error('Invalid class columns');
  const classes = header.slice(3).map(x => Number(x.slice(5)));
  if (new Set(classes).size !== classes.length || !rows.length || rows.length > 30000) throw new Error('Invalid classes/rows');
  const roads = new Map(), sections = new Set();
  for (const row of rows) {
    if (row.length !== header.length || !row[0] || !row[1]) throw new Error('Invalid tariff section');
    const ref = normalize(row[0]), identity = ref + '\n' + row[1];
    if (sections.has(identity)) throw new Error('Duplicate tariff section'); sections.add(identity);
    const numbers = row.slice(2).map(x => {
      const n = Number(x); if (!/^\d+(\.\d+)?$/.test(x) || !Number.isFinite(n) || n < 0 || n > 1e9) throw new Error('Invalid price');
      return n;
    });
    if (numbers[0] <= 0) throw new Error('Invalid section length');
    const road = roads.get(ref) ?? { km: 0, prices: new Map(classes.map(c => [c, 0])) };
    road.km += numbers[0]; classes.forEach((c, i) => road.prices.set(c, road.prices.get(c) + numbers[i + 1])); roads.set(ref, road);
  }
  const allowed = metadata.has('estimateRoads') ? new Set(metadata.get('estimateRoads').split(',').filter(x => x.trim()).map(normalize)) : null;
  if (allowed && [...allowed].some(ref => !roads.has(ref))) throw new Error('Invalid estimate policy');
  return Object.freeze({ country, currency: metadata.get('currency'), year: metadata.get('year'),
    version, source: metadata.get('source'), fractionDigits: Number(digits), classes,
    estimate(ref, meters, vehicleClass) {
      if (!Number.isFinite(meters) || meters < 0 || !classes.includes(vehicleClass)) return null;
      for (const token of String(ref ?? '').split(/[;,/]/)) {
        const key = normalize(token), road = roads.get(key); if (!road) continue;
        if (allowed && !allowed.has(key)) return null;
        const amount = meters / 1000 * road.prices.get(vehicleClass) / road.km;
        return Number.isFinite(amount) && amount <= 1e12 ? amount : null;
      }
      return null;
    }
  });
}
const catalogs = new Map();
export function countryTollTariffs(country) {
  if (!catalogs.has(country)) {
    let table = null;
    try { if (Object.hasOwn(bundled, country)) table = parseTollTable(country, bundled[country]); } catch { /* Missing/invalid data stays unavailable. */ }
    catalogs.set(country, table);
  }
  return catalogs.get(country);
}
