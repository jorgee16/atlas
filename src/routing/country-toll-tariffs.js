import bundled, { fixedChargeTables, entryExitTables } from './bundled-toll-tables.js';

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
      (metadata.has('scheme') && !['road-average','fixed-crossing','entry-exit'].includes(metadata.get('scheme')))) throw new Error('Invalid tariff provenance');
  if (metadata.has('status') && metadata.get('status') !== 'active') throw new Error('Unapproved tariff candidate');
  const version = metadata.get('version') ?? '0', digits = metadata.get('fractionDigits') ?? '2';
  if (!/^\d{1,16}$/.test(version) || !/^[0-3]$/.test(digits)) throw new Error('Invalid tariff version/precision');
  const fixed = metadata.get('scheme') === 'fixed-crossing', ticket = metadata.get('scheme') === 'entry-exit';
  const header = rows.shift();
  if (header?.slice(0, 3).join(';') !== (ticket ? 'network;entry;exit' : fixed ? 'charge;road;name' : 'road;section;km') || header.length < 4 || header.length > 35 ||
      !header.slice(3).every(x => /^class[1-9]\d?$/.test(x))) throw new Error('Invalid class columns');
  const classes = header.slice(3).map(x => Number(x.slice(5)));
  if (new Set(classes).size !== classes.length || !rows.length || rows.length > 30000) throw new Error('Invalid classes/rows');
  const roads = new Map(), sections = new Set(), charges = new Map(), fares = new Map();
  const scale = 10 ** Number(digits);
  for (const row of rows) {
    if (row.length !== header.length || !row[0] || !row[1]) throw new Error('Invalid tariff section');
    if (ticket) {
      if (!row.slice(0,3).every(x=>/^[A-Za-z0-9_-]{1,128}$/.test(x))) throw new Error('Invalid entry/exit identity');
      const identity=row.slice(0,3).join('\n');
      if (fares.has(identity)) throw new Error('Duplicate directed fare');
      const prices=new Map();
      row.slice(3).forEach((value,i)=> {
        const n=Number(value), minor=Math.round(n*scale);
        if(!/^\d+(\.\d+)?$/.test(value)||!Number.isFinite(n)||n<0||n>1e9||Math.abs(n*scale-minor)>.0001) throw new Error('Invalid fare precision');
        prices.set(classes[i],minor);
      });
      fares.set(identity,prices);continue;
    }
    if (fixed) {
      if (!/^[A-Za-z0-9:_-]{1,128}$/.test(row[0]) || !row[2] || charges.has(row[0])) throw new Error('Invalid/duplicate fixed charge');
      const prices = new Map();
      row.slice(3).forEach((value,i) => {
        const n = Number(value), minor = Math.round(n * scale);
        if (!/^\d+(\.\d+)?$/.test(value) || !Number.isFinite(n) || n < 0 || n > 1e9 || Math.abs(n * scale - minor) > .0001)
          throw new Error('Invalid fixed price or currency precision');
        prices.set(classes[i],minor);
      });
      charges.set(row[0],{id:row[0],road:row[1],name:row[2],prices});
      continue;
    }
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
  if ((fixed || ticket) && metadata.has('estimateRoads')) throw new Error('Estimate policy in fixed catalog');
  const freeRefs=metadata.has('freeRoads') ? metadata.get('freeRoads').split(',').map(normalize) : [];
  if ((metadata.has('freeRoads') && (fixed || ticket || !metadata.get('freeRoadSource')?.startsWith('https://') ||
      new Set(freeRefs).size!==freeRefs.length || freeRefs.some(r=>!/^[A-Z][A-Z0-9-]{0,31}$/.test(r)))) ||
      (!metadata.has('freeRoads') && metadata.has('freeRoadSource'))) throw new Error('Invalid free-road policy/provenance');
  const freeRoads=new Set(freeRefs);
  const freeRoadClasses=new Map();
  if(metadata.has('freeRoadClasses')) {
    if(fixed||ticket||!metadata.get('freeRoadClassSource')?.startsWith('https://'))throw new Error('Invalid class exemption provenance');
    for(const rule of metadata.get('freeRoadClasses').split('|')) {
      const pair=rule.split(':'),road=normalize(pair[0]);
      if(pair.length!==2||!/^[A-Z][A-Z0-9-]{0,31}$/.test(road)||freeRoadClasses.has(road))throw new Error('Invalid class exemption road');
      const values=pair[1].split(',').map(v=>v.trim());
      if(!values.length||new Set(values).size!==values.length||values.some(v=>!/^[1-9][0-9]?$/.test(v)||!classes.includes(Number(v))))throw new Error('Invalid exempt class');
      freeRoadClasses.set(road,new Set(values.map(Number)));
    }
  } else if(metadata.has('freeRoadClassSource'))throw new Error('Class exemption source without policy');
  const freeForClass=(road,c)=>freeRoads.has(road)||freeRoadClasses.get(road)?.has(c);
  const explicitlyFree=(ref,vehicleClass) => {
    const tokens=String(ref??'').split(/[;,/]/).map(normalize);
    return !fixed && !ticket && classes.includes(vehicleClass) && tokens.some(r=>freeForClass(r,vehicleClass)) &&
      !tokens.some(r=>roads.has(r) && !freeForClass(r,vehicleClass));
  };
  const allowed = metadata.has('estimateRoads') ? new Set(metadata.get('estimateRoads').split(',').filter(x => x.trim()).map(normalize)) : null;
  if (allowed && [...allowed].some(ref => !roads.has(ref))) throw new Error('Invalid estimate policy');
  const referenceRates=new Map();
  if(metadata.has('referenceEstimate')) {
    if(fixed||ticket||metadata.get('referenceEstimate')!=='road-then-country-average'||!metadata.has('referenceSourceRoads'))throw new Error('Invalid reference policy');
    const refs=metadata.get('referenceSourceRoads').split(',').map(normalize);
    if(!refs.length||new Set(refs).size!==refs.length||refs.some(r=>!roads.has(r)||(allowed&&!allowed.has(r))))throw new Error('Invalid reference source roads');
    const km=refs.reduce((n,r)=>n+roads.get(r).km,0);
    for(const c of classes) {const amount=refs.reduce((n,r)=>n+roads.get(r).prices.get(c),0);if(amount>0)referenceRates.set(c,amount/km);}
    if(!referenceRates.size)throw new Error('No positive reference rates');
  } else if(metadata.has('referenceSourceRoads'))throw new Error('Reference source without policy');
  return Object.freeze({ country, currency: metadata.get('currency'), year: metadata.get('year'),
    scheme: ticket ? 'entry-exit' : fixed ? 'fixed-crossing' : 'road-average', fixedCharges:[...charges.values()].map(c => ({id:c.id,road:c.road,name:c.name})),
    fixedCharge(id,vehicleClass) { const n=charges.get(id)?.prices.get(vehicleClass);return n===undefined ? null : n/scale; },
    sumFixedCharges(ids,vehicleClass) {
      if (!fixed || !classes.includes(vehicleClass)) return null;
      let total=0;
      for (const id of ids) { const n=charges.get(id)?.prices.get(vehicleClass);if(n===undefined || !Number.isSafeInteger(total+n))return null;total+=n; }
      return total/scale;
    },
    entryExitFare(journey,vehicleClass) {
      const n=fares.get([journey.network,journey.entry,journey.exit].join('\n'))?.get(vehicleClass);
      return n===undefined ? null : n/scale;
    },
    sumEntryExitFares(journeys,vehicleClass) {
      if(!ticket||!classes.includes(vehicleClass))return null;
      let total=0;
      for(const j of journeys) { const n=fares.get([j.network,j.entry,j.exit].join('\n'))?.get(vehicleClass);if(n===undefined||!Number.isSafeInteger(total+n))return null;total+=n; }
      return total/scale;
    },
    referenceEstimate(ref,meters,vehicleClass) {
      if(!metadata.has('referenceEstimate')||!Number.isFinite(meters)||meters<0||!classes.includes(vehicleClass))return null;
      const tokens=String(ref??'').split(/[;,/]/).map(normalize);
      if(tokens.some(r=>freeForClass(r,vehicleClass)))return null;
      let rate;
      for(const token of tokens) {const road=roads.get(token);if(road?.prices.get(vehicleClass)>0){rate=road.prices.get(vehicleClass)/road.km;break;}}
      rate??=referenceRates.get(vehicleClass);
      const amount=meters/1000*rate;
      return Number.isFinite(amount)&&amount<=1e12?amount:null;
    },
    freeSourceFor(ref,vehicleClass) {
      if(!explicitlyFree(ref,vehicleClass))return '';
      return [...new Set(String(ref??'').split(/[;,/]/).map(normalize).map(r=>freeRoads.has(r)?metadata.get('freeRoadSource'):freeRoadClasses.get(r)?.has(vehicleClass)?metadata.get('freeRoadClassSource'):null).filter(Boolean))].join('\n');
    },
    explicitlyFree, freeRoadSource:metadata.get('freeRoadSource')??'',
    version, source: metadata.get('source'), fractionDigits: Number(digits), classes,
    estimate(ref, meters, vehicleClass) {
      if (fixed || ticket || !Number.isFinite(meters) || meters < 0 || !classes.includes(vehicleClass)) return null;
      const tokens=String(ref??'').split(/[;,/]/).map(normalize);
      if(tokens.some(r=>freeForClass(r,vehicleClass))) return explicitlyFree(ref,vehicleClass) ? 0 : null;
      for (const token of tokens) {
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
    try { if (Object.hasOwn(bundled, country)) { const candidate=parseTollTable(country,bundled[country]);if(candidate.scheme==='road-average')table=candidate; } } catch { /* Missing/invalid data stays unavailable. */ }
    catalogs.set(country, table);
  }
  return catalogs.get(country);
}

const fixedCatalogs = new Map();
export function countryTollCharges(country) {
  if (!fixedCatalogs.has(country)) {
    let table=null;
    try { if (Object.hasOwn(fixedChargeTables,country)) { const candidate=parseTollTable(country,fixedChargeTables[country]);if(candidate.scheme==='fixed-crossing')table=candidate; } } catch { }
    fixedCatalogs.set(country,table);
  }
  return fixedCatalogs.get(country);
}

const entryExitCatalogs=new Map();
export function countryTollFares(country) {
  if(!entryExitCatalogs.has(country)) {
    let table=null;
    try { if(Object.hasOwn(entryExitTables,country)) { const candidate=parseTollTable(country,entryExitTables[country]);if(candidate.scheme==='entry-exit')table=candidate; } } catch { }
    entryExitCatalogs.set(country,table);
  }
  return entryExitCatalogs.get(country);
}
