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
  return [...new Set(matches.map(ref=>ref.replace(/\s+/g,'')))];
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

function topologyCandidates(graph,startNode,point){
  const queue=[{node:startNode,networkMeters:0,hops:0}];
  const bestNodeCost=new Map([[startNode,0]]);
  const seenEdges=new Set();
  const edges=[];

  while(queue.length){
    const current=queue.shift();
    if(current.hops>10||current.networkMeters>2600) continue;

    for(const edge of graph.outgoingEdges(current.node)){
      if(!edge.driveAllowed) continue;
      const distance=edge.distanceDecimeters/10;
      const nextCost=current.networkMeters+distance;
      if(nextCost>2600) continue;

      if(!seenEdges.has(edge.edgeIndex)){
        seenEdges.add(edge.edgeIndex);
        const route=graph.routePath(current.node,[edge.edgeIndex]);
        const road=graph.road(edge.road,edge.geometryReversed);
        const geometricDistance=Math.round(lineDist(point,route.points)*10)/10;
        edges.push({
          partitionId:null,
          edgeIndex:edge.edgeIndex,
          fromNode:current.node,
          toNode:edge.to,
          roadIndex:edge.road,
          roadRef:road.ref||'',
          roadName:road.name||'',
          distanceMeters:geometricDistance,
          networkMetersFromSnap:Math.round(current.networkMeters*10)/10,
          osmTollTagged:Boolean(road.toll),
          electronicTollTagged:Boolean(road.electronicToll)
        });
      }

      const previous=bestNodeCost.get(edge.to);
      if(previous===undefined||nextCost+1<previous){
        bestNodeCost.set(edge.to,nextCost);
        queue.push({node:edge.to,networkMeters:nextCost,hops:current.hops+1});
      }
    }
  }

  return edges;
}

function chooseMotorwayRef(edges,point){
  const explicit=motorwayRefs(point.roadRef);
  const candidates=[];

  for(const edge of edges){
    for(const ref of motorwayRefs(edge.roadRef)){
      const score=edge.networkMetersFromSnap + edge.distanceMeters*2 -
        (edge.osmTollTagged?120:0) -
        (edge.electronicTollTagged?100:0);
      candidates.push({ref,score,edge});
    }
  }

  candidates.sort((a,b)=>a.score-b.score);

  if(explicit.length){
    const confirmed=candidates.find(candidate=>explicit.includes(candidate.ref));
    if(confirmed&&confirmed.edge.networkMetersFromSnap<=1800){
      return {ref:confirmed.ref,source:'topology-confirmed-explicit',edge:confirmed.edge};
    }
  }

  if(candidates.length){
    const best=candidates[0];
    const rival=candidates.find(candidate=>candidate.ref!==best.ref);
    const clear=!rival||best.score+180<rival.score;
    if(clear&&best.edge.networkMetersFromSnap<=2200){
      return {ref:best.ref,source:'routing-topology',edge:best.edge};
    }
  }

  if(explicit.length===1){
    return {ref:explicit[0],source:'osm-explicit-unconfirmed',edge:null};
  }

  return {ref:'',source:'unresolved',edge:null};
}

function attach(graph,partitionId,point){
  const nearest=graph.findNearest(point,{maxDistanceMeters:1200,profile:'drive'});
  if(!nearest) return null;

  const edges=topologyCandidates(graph,nearest.node,point)
    .map(edge=>({...edge,partitionId}))
    .sort((a,b)=>
      a.networkMetersFromSnap-b.networkMetersFromSnap ||
      a.distanceMeters-b.distanceMeters
    );

  const inferred=chooseMotorwayRef(edges,point);
  return {
    partitionId,
    nearestNode:nearest.node,
    nearestNodeDistanceMeters:Math.round(nearest.distanceMeters*10)/10,
    inferredRoadRef:inferred.ref,
    inferredRoadRefSource:inferred.source,
    inferredEdge:inferred.edge,
    edges:edges.slice(0,24)
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
  await fs.writeFile(output,JSON.stringify({version:3,points},null,2)+'\n');
  const physical=points.filter(p=>p.kind==='toll_booth'||p.kind==='toll_gantry');
  const attached=physical.filter(p=>p.routingMatch?.edges?.length);
  const motorway=attached.filter(p=>/^A\d+(?:-\d+)?$/i.test(p.inferredRoadRef||''));
  const bySource={};
  for(const p of physical){
    const source=p.routingMatch?.inferredRoadRefSource||'unresolved';
    bySource[source]=(bySource[source]||0)+1;
  }
  console.log(`Attached ${attached.length}/${physical.length} physical toll points; ${motorway.length} resolved to an A-road.`);
  console.log(bySource);
  console.log(`Wrote ${output}`);
}

main().catch(e=>{console.error(e);process.exitCode=1;});
