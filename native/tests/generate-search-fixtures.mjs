import fs from 'node:fs/promises';
import {normalizeRegion} from '../../tools/region-builder/normalizer.mjs';
import {LocalRegionProvider} from '../../src/search/providers/local-region-provider.js';
import {AddressStreetProvider} from '../../src/search/providers/address-street-provider.js';
const root=process.argv[2]??'/tmp/atlas-search-parity';await fs.mkdir(root,{recursive:true});
const features=[];
function place(id,name,lon,lat,properties={}){features.push({type:'Feature',id,geometry:{type:'Point',coordinates:[lon,lat]},properties:{name,...properties}});}
place('cafe-near','Café Central',-9.14,38.71,{amenity:'cafe','addr:street':'Rua Augusta','addr:housenumber':'24','addr:city':'Lisboa'});
place('cafe-duplicate','Café Central',-9.1401,38.7101,{amenity:'cafe'});
place('cafe-far','Café Central',-8.9,38.9,{amenity:'cafe'});
place('square','Praça do Comércio',-9.1366,38.7078,{amenity:'square',alt_name:'Terreiro do Paço',short_name:'Praça Central'});
place('museum','Museu Nacional',-9.15,38.72,{tourism:'museum',official_name:'Museu Histórico Nacional','name:en':'National Museum','addr:city':'Lisboa'});
place('town-node','Belém',-9.2068,38.6975,{place:'suburb','addr:city':'Lisboa'});
place('town-area','Belém',-9.208,38.699,{boundary:'administrative',place:'suburb','addr:city':'Lisboa'});
place('town-other','Belém',-8.2,39.5,{place:'village','addr:city':'Outra cidade'});
place('hotel','Hotel da Praça',-9.135,38.71,{tourism:'hotel',alt_name:'Riverside Stay','addr:postcode':'1100-148'});
place('address-one','',-9.14,38.7102,{'addr:street':'Rua Augusta','addr:housenumber':'24','addr:city':'Lisboa','addr:postcode':'1100-148'});
place('address-two','',-9.141,38.711,{'addr:street':'Rua Augusta','addr:housenumber':'25','addr:city':'Lisboa','addr:postcode':'1100-149'});
place('address-english','',-.1275,51.5034,{'addr:street':'Downing Street','addr:housenumber':'10','addr:city':'London','addr:postcode':'SW1A 2AA'});
place('station','Estação Central',-9.143,38.719,{railway:'station',ref:'CENTRAL','addr:city':'Lisboa'});
await fs.writeFile(root+'/raw.geojson',JSON.stringify({type:'FeatureCollection',features}));
await normalizeRegion({rawGeoJson:root+'/raw.geojson',outputDir:root+'/data',config:{id:'parity',name:'Parity',country:'Portugal',bbox:[-10,38,1,52],categories:{cafe:[{key:'amenity',values:['cafe']}],square:[{key:'amenity',values:['square']}],museum:[{key:'tourism',values:['museum']}],hotel:[{key:'tourism',values:['hotel']}],station:[{key:'railway',values:['station']}]}}});
const region={id:'parity',name:'Parity',poiUrl:root+'/data/pois.geojson',assets:{pois:root+'/data/pois.geojson',search:root+'/data/search-index.bin',searchRecords:root+'/data/search-records.bin',addressSearch:root+'/data/address-index.bin',addressRecords:root+'/data/address-records.bin'}};
const options={regionRepository:{findByPosition:async()=>region},fetchFn:async url=>{try{const b=await fs.readFile(root+'/data/'+new URL(url,'https://fixture.invalid').pathname.split('/').at(-1));return{ok:true,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),json:async()=>JSON.parse(b.toString())};}catch{return{ok:false,status:404};}}};
const providers={poi:new LocalRegionProvider(options),address:new AddressStreetProvider(options)};
const queries=['cafe central','café cen','praca do comercio','terreiro paco','nacional','national museum','belem','central lisboa','hotel','riverside','1100-148','24 rua augusta','rua augusta 24','rua augusta','25 augusta','SW1A 2AA','10 Downing Street','Downing Street','rua','missing place'];
const cases=[];
for(const anchor of [{lat:38.71,lon:-9.14},{lat:51.503,lon:-.12}])for(const query of queries)for(const [kind,provider]of Object.entries(providers)){
 const expected=kind==='poi'?await provider.searchByName(query,anchor,{limit:12,includeScore:true}):await provider.search(query,anchor,{limit:12});
 cases.push({kind,query,anchor,expected:expected.map(p=>({id:kind==='address'?String(p.id).replace(/^address:parity:/,''):String(p.id),name:p.name,score:p.matchScore,distance:p.distance}))});
}
await fs.writeFile(root+'/expected.json',JSON.stringify(cases));console.log(`Generated ${cases.length} search parity cases in ${root}`);
