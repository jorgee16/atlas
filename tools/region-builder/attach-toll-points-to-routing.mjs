import fs from 'node:fs/promises';
import path from 'node:path';
import { RoutingGraph } from '../../src/routing/routing-graph.js';

const R=6371008.8;
const rad=v=>v*Math.PI/180;
const toAB=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);

function segDist(p,a,b){
  const lat=(p.lat+a.lat+b.lat)/3;
  const sy=Math.PI*R/180, sx=sy*Math.cos(rad(lat));
  const px=p.lon*sx,py=p.lat*sy,ax=a.lon*sx,ay=a.lat*sy,bx=b.lon*sx,by=b.lat*sy;
  const dx=bx-ax,dy=by-ay,l=dx*dx+dy*dy;
  const t=l<1?0:Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/l));
  return Math.hypot(px-(ax+t*dx),py-(ay+t*dy));
}

function lineDist(p,line){
  let best=Infinity;
  for(let i=1;i<line.length;i++) best=Math.min(best,segDist(p,line[i-1],line[i]));
  return best;
}

function inBounds(p,b){return p.lon>=b[0]&&p.lat>=b[1]&&p.lon<=b[2]&&p.lat<=b[3];}

function motorwayRefs(value){
  const matches=String(value??'').toUpperCase().match(/\bA\s*\d+(?:\s*-\s*\d+)?\b/g)||[];
  return [...new Set(matches.map(ref=>ref.replace(/\s+/g,'').replace(/-(?=\d)/,'-')))];
}

async function loadGraph(dir,id){
  const d=path.join(dir,id);
  const read=async n=>toAB(await fs.readFile(path.join(d,n)));
  const metadata=JSON.parse(await fs.readFile(path.join(d,'metadata.json'),'utf8'));
  const [nodes,edges,geometry,roads,strings,restrictions,spatialIndex]=await Promise.all([
    read('nodes.bin'),read('edges.bin'),read('geometry.bin'),read('roads.bin'),read('strings.bin'),read('restrictions.bin'),read('spatial-index.bin')
  ]);
  return new RoutingGraph({nodes,edges,geometry,roads,strings,restrictions,spatialIndex,metadata});
}

function edgeCandidates(graph,node){
  const out=[];
  const seen=new Set();
  const nodes=[node];
  for(let depth=0;depth<3;depth++){
    for(const from of nodes.splice(0)){
      for(const edge of graph.outgoingEdges(from)){
        if(!edge.driveAllowed||seen.has(edge.edgeIndex)) continue;
        seen.add(edge.edgeIndex);out.push({from,...edge});nodes.push(edge.to);
      }
    }
  }
  return out;
}

function chooseMotorwayRef(edges,point){
  const explicit=motorwayRefs(point.roadRef);
  const candidates=[];

  for(const edge of edges){
    for(const ref of motorwayRefs(edge.roadRef)){
      candidates.push({ref,distanceMeters:edge.distanceMeters,toll:edge.osmTollTagged,electronic:edge.electronicTollTagged});
    }
  }

  candidates.sort((a,b)=>
    a.distanceMeters-b.distanceMeters ||
    Number(b.toll)-Number(a.toll) ||
    Number(b.electronic)-Number(a.electronic)
  );

  if(explicit.length){
    const confirmed=candidates.find(candidate=>explicit.includes(candidate.ref));
    if(confirmed) return {ref:confirmed.ref,source:'edge-confirmed-explicit'};
  }

  if(candidates.length){
    const best=candidates[0];
    const rival=candidates.find(candidate=>candidate.ref!==best.ref);
    if(!rival||best.distanceMeters+25<rival.distanceMeters){
      return {ref:best.ref,source:'nearest-routing-edge'};
    }

    const tollBest=candidates.find(candidate=>candidate.toll||candidate.electronic);
    if(tollBest&&tollBest.distanceMeters<=best.distanceMeters+20){
      return {ref:tollBest.ref,source:'nearest-toll-routing-edge'};
    }
  }

  if(explicit.length===1){
    return {ref:explicit[0],source:'osm-explicit-unconfirmed'};
  }

  return {ref:'',source:'unresolved'};
}

function attach(graph,partitionId,point){
  const nearest=graph.findNearest(point,{maxDistanceMeters:1200,profile:'drive'});
  if(!nearest) return null;
  const edges=edgeCandidates(graph,nearest.node).map(e=>{
    const route=graph.routePath(e.from,[e.edgeIndex]);
    const road=graph.road(e.road,e.geometryReversed);
    return {partitionId,edgeIndex:e.edgeIndex,fromNode:e.from,toNode:e.to,roadIndex:e.road,roadRef:road.ref||'',roadName:road.name||'',distanceMeters:Math.round(lineDist(point,route.points)*10)/10,osmTollTagged:Boolean(road.toll),electronicTollTagged:Boolean(road.electronicToll)};
  }).filter(e=>e.distanceMeters<=180).sort((a,b)=>a.distanceMeters-b.distanceMeters).slice(0,10);

  const inferred=chooseMotorwayRef(edges,point);
  return {
    partitionId,
    nearestNode:nearest.node,
    nearestNodeDistanceMeters:Math.round(nearest.distanceMeters*10)/10,
    edges,
    inferredRoadRef:inferred.ref,
    inferredRoadRefSource:inferred.source
  };
}

async function main(){
  const dir=path.resolve(process.argv[2]||'build/portugal/routing');
  const manifest=JSON.parse(await fs.readFile(path.join(dir,'manifest.json'),'utf8'));
  const doc=JSON.parse(await fs.readFile(path.join(dir,'toll-points.json'),'utf8'));
  const cache=new Map();
  const points=[];
  for(const point of doc.points||[]){
    if(point.kind!=='toll_booth'&&point.kind!=='toll_gantry'){points.push(point);continue;}
    const part=(manifest.partitions||[]).find(p=>inBounds(point,p.bounds));
    if(!part){points.push({...point,routingMatch:null});continue;}
    if(!cache.has(part.id)) cache.set(part.id,await loadGraph(dir,part.id));
    const routingMatch=attach(cache.get(part.id),part.id,point);
    points.push({...point,inferredRoadRef:routingMatch?.inferredRoadRef||'',routingMatch});
  }
  const output=path.join(dir,'toll-points-routed.json');
  await fs.writeFile(output,JSON.stringify({version:2,points},null,2)+'\n');
  const physical=points.filter(p=>p.kind==='toll_booth'||p.kind==='toll_gantry');
  const attached=physical.filter(p=>p.routingMatch?.edges?.length);
  const motorway=attached.filter(p=>/^A\d+(?:-\d+)?$/i.test(p.inferredRoadRef||''));
  const bySource={};
  for(const p of motorway){
    const source=p.routingMatch?.inferredRoadRefSource||'unknown';
    bySource[source]=(bySource[source]||0)+1;
  }
  console.log(`Attached ${attached.length}/${physical.length} physical toll points; ${motorway.length} resolved to an A-road.`);
  console.log(bySource);
  console.log(`Wrote ${output}`);
}

main().catch(e=>{console.error(e);process.exitCode=1;});
