import fs from 'node:fs/promises';
import { createRoutingBuffers } from '../../tests/helpers/routing-fixture.js';
import { normalizeRegion } from '../../tools/region-builder/normalizer.mjs';
import { RoutingGraph } from '../../src/routing/routing-graph.js';
import { ManeuverGenerator } from '../../src/routing/maneuver-generator.js';
import { AStarRouter } from '../../src/routing/astar-router.js';
const root=process.argv[2]??'/tmp/atlas-native-fixtures';
await fs.mkdir(root,{recursive:true});
const nodes=[{lat:40,lon:-8},{lat:40,lon:-7.999},{lat:40,lon:-7.998},{lat:40.001,lon:-7.999},{lat:37,lon:-25,component:1}];
const edges=[
 {from:0,to:1,road:0,distanceDecimeters:850,durationCentiseconds:1000},
 {from:1,to:2,road:1,distanceDecimeters:850,durationCentiseconds:1000},
 {from:0,to:3,road:2,distanceDecimeters:1400,durationCentiseconds:400,geometry:[{lat:40.0004,lon:-7.9996}]},
 {from:3,to:2,road:2,distanceDecimeters:1400,durationCentiseconds:400}
];
const expected=[];
for(const variant of ['basic','restricted','only','toll','profile','uturn']) {
 const input={nodes,edges:edges.map(x=>({...x})),roads:[{name:'Rua Um'},{name:'Rua Dois'},{name:'Autoestrada',ref:'A1',toll:variant==='toll'}]};
 if(variant==='restricted') input.restrictions=[{viaNode:3,fromRoad:2,toRoad:2,only:false}];
 if(variant==='only') input.restrictions=[{viaNode:1,fromRoad:0,toRoad:1,only:true}];
 if(variant==='profile') input.edges[2].walkAllowed=false;
 if(variant==='uturn') {input.edges.push({from:3,to:0,road:2,distanceDecimeters:1400,durationCentiseconds:400});input.restrictions=[{viaNode:3,fromRoad:2,toRoad:2,only:false}];}
 const buffers=createRoutingBuffers(input),directory=`${root}/${variant}`;await fs.mkdir(directory,{recursive:true});
 for(const [name,value] of Object.entries(buffers)) if(value instanceof ArrayBuffer)await fs.writeFile(`${directory}/${name==='spatialIndex'?'spatial-index':name}.bin`,Buffer.from(value));
 const graph=new RoutingGraph(buffers);
 for(const profile of ['drive','walk'])for(const avoidTolls of [false,true]) {
  const r=await new AStarRouter(graph).route(0,2,{profile,avoidTolls,yieldEvery:0});
  expected.push({directory,profile,avoidTolls,edges:r?.edgeIndexes??null,distance:r?.distanceMeters??null,duration:r?.durationSeconds??null,maneuvers:r?new ManeuverGenerator().generate({graph,route:r}).map(m=>({type:m.type,instruction:m.instruction,at:m.routeDistanceMeters})):null});
 }
}
// The closest road to this airport-style polygon centre is an isolated
// service graph. A second publicly reachable road is only 80m away.
{
 const nodes=[
  {lat:40,lon:-8},{lat:40,lon:-7.999},{lat:40,lon:-7.998},
  {lat:40,lon:-7.997},
  {lat:40.0003,lon:-7.9986,component:1},
  {lat:40.0004,lon:-7.9986,component:1}
 ];
 const edges=[
  {from:0,to:1,road:0,distanceDecimeters:850,durationCentiseconds:1000},
  {from:1,to:2,road:0,distanceDecimeters:850,durationCentiseconds:1000},
  {from:2,to:3,road:0,distanceDecimeters:850,durationCentiseconds:1000},
  {from:4,to:5,road:1,distanceDecimeters:110,durationCentiseconds:200}
 ];
 const assets=createRoutingBuffers({nodes,edges,roads:[
  {name:'Public access road'},{name:'Restricted internal road'}
 ]});
 const directory=`${root}/access`;
 await fs.mkdir(directory,{recursive:true});
 for(const [name,value] of Object.entries(assets))
  if(value instanceof ArrayBuffer)
   await fs.writeFile(`${directory}/${name==='spatialIndex'?'spatial-index':name}.bin`,Buffer.from(value));
}
// GPS-heading constrained driving must seek a forward turnaround when
// available, but still permit a last-resort U-turn on a dead-end road.
for (const loop of [true,false]) {
 const nodes=[
  {lat:40,lon:-8},{lat:40,lon:-7.999},{lat:40,lon:-7.998},
  {lat:40.0005,lon:-7.998},{lat:40,lon:-8.001}
 ];
 const edges=[
  {from:0,to:1,road:0,distanceDecimeters:850,durationCentiseconds:1000},
  {from:1,to:4,road:1,distanceDecimeters:1700,durationCentiseconds:600},
  ...(loop?[
   {from:1,to:2,road:2,distanceDecimeters:850,durationCentiseconds:1000},
   {from:2,to:3,road:2,distanceDecimeters:550,durationCentiseconds:1000},
   {from:3,to:4,road:2,distanceDecimeters:2000,durationCentiseconds:2000}
  ]:[])
 ];
 const assets=createRoutingBuffers({nodes,edges,roads:[
  {name:'Current direction'},{name:'Immediate reversal'},{name:'Forward junction loop'}
 ]});
 const directory=`${root}/${loop?'directional-loop':'directional-dead-end'}`;
 await fs.mkdir(directory,{recursive:true});
 for(const [name,value] of Object.entries(assets))
  if(value instanceof ArrayBuffer)
   await fs.writeFile(`${directory}/${name==='spatialIndex'?'spatial-index':name}.bin`,Buffer.from(value));
}
await fs.writeFile(`${root}/expected.json`,JSON.stringify(expected));
const raw=`${root}/places.geojson`;
await fs.writeFile(raw,JSON.stringify({type:'FeatureCollection',features:[
 {type:'Feature',id:'cafe',geometry:{type:'Point',coordinates:[-8,40]},properties:{name:'Café Central',amenity:'cafe'}},
 {type:'Feature',id:'city',geometry:{type:'Point',coordinates:[-8.001,40]},properties:{name:'Cidade Central',place:'city'}},
 {type:'Feature',id:'museum',geometry:{type:'Point',coordinates:[-8.002,40]},properties:{name:'Museu do Centro',tourism:'museum'}}
]}));
await normalizeRegion({rawGeoJson:raw,outputDir:`${root}/search`,config:{id:'test',name:'Test',country:'Portugal',bbox:[-9,39,-7,41],categories:{cafe:[{key:'amenity',values:['cafe']}],museum:[{key:'tourism',values:['museum']}]}}});
console.log(root);

// Same physical road, different OSM ways: geometry and junction evidence,
// rather than a road record ID, decide whether ETA needs a transition delay.
for(const name of ['single','split','turn','ramp','toll-gate','local','junction','restricted']) {
 const local=['local','junction','restricted'].includes(name);
 const cls=local?6:1;
 const secondName=local?'Rua Continua':'Autoestrada';
 const sameRef=local?'':'A5';
 const nodes=[{lat:40,lon:-8},{lat:40,lon:-7.999},
   name==='turn'?{lat:40.001,lon:-7.999}:{lat:40,lon:-7.998},
   {lat:40.001,lon:-7.999}];
 const roads=[{name:secondName,ref:sameRef},
   {name:secondName,ref:sameRef,link:name==='ramp',toll:name==='toll-gate'},
   {name:'Side street'}];
 const road=name==='single'?0:1;
 const edges=[{from:0,to:1,road:0,roadClass:cls,distanceDecimeters:850,durationCentiseconds:local?1020:300},
  {from:1,to:0,road:0,roadClass:cls,distanceDecimeters:850,durationCentiseconds:local?1020:300},
  {from:1,to:2,road,roadClass:cls,distanceDecimeters:850,durationCentiseconds:local?1020:300},
  {from:2,to:1,road,roadClass:cls,distanceDecimeters:850,durationCentiseconds:local?1020:300}];
 if(name==='junction')edges.push({from:1,to:3,road:2,roadClass:6,distanceDecimeters:1000,durationCentiseconds:1500});
 const restrictions=name==='restricted'?[{viaNode:1,fromRoad:0,toRoad:2,only:false}]:[];
 const buffers=createRoutingBuffers({nodes,edges,roads,restrictions});
 const directory=`${root}/eta-${name}`;await fs.mkdir(directory,{recursive:true});
 for(const [key,value] of Object.entries(buffers))if(value instanceof ArrayBuffer)
  await fs.writeFile(`${directory}/${key==='spatialIndex'?'spatial-index':key}.bin`,Buffer.from(value));
}
