import test from 'node:test';
import assert from 'node:assert/strict';

import { calibrateDriveEta } from '../src/routing/drive-eta.js';

test('short urban drive ETA is more conservative than free-flow edge time', () => {
  const route = {
    distanceMeters: 3_100,
    durationSeconds: 180,
    legs: [
      {
        roadIndex: 1,
        roadClass: 3,
        road: { roundabout: false },
        distanceMeters: 3_100,
        durationSeconds: 180,
        routeDurationStartSeconds: 0,
        routeDurationEndSeconds: 180
      }
    ]
  };

  const calibrated = calibrateDriveEta(route);

  assert.equal(calibrated.freeFlowDurationSeconds, 180);
  assert.ok(calibrated.durationSeconds >= 220);
  assert.ok(calibrated.durationSeconds < 300);
  assert.equal(
    calibrated.legs[0].routeDurationEndSeconds,
    calibrated.durationSeconds
  );
});

test('drive ETA never makes a slow mapped edge faster', () => {
  const route = {
    distanceMeters: 500,
    durationSeconds: 120,
    legs: [
      {
        roadIndex: 1,
        roadClass: 6,
        road: { roundabout: false },
        distanceMeters: 500,
        durationSeconds: 120,
        routeDurationStartSeconds: 0,
        routeDurationEndSeconds: 120
      }
    ]
  };

  const calibrated = calibrateDriveEta(route);

  assert.ok(calibrated.durationSeconds >= 140);
  assert.equal(calibrated.legs[0].freeFlowDurationSeconds, 120);
});

test('road changes add bounded junction delay without changing geometry', () => {
  const route = {
    distanceMeters: 1_000,
    durationSeconds: 80,
    points: [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }],
    legs: [
      {
        roadIndex: 1,
        roadClass: 5,
        road: { roundabout: false },
        distanceMeters: 500,
        durationSeconds: 40
      },
      {
        roadIndex: 2,
        roadClass: 6,
        road: { roundabout: false },
        distanceMeters: 500,
        durationSeconds: 40
      }
    ]
  };

  const calibrated = calibrateDriveEta(route);

  assert.equal(calibrated.points, route.points);
  assert.ok(calibrated.legs[1].durationSeconds > 40);
  assert.equal(
    calibrated.legs[1].routeDurationStartSeconds,
    calibrated.legs[0].routeDurationEndSeconds
  );
});

function continuousRoute({roadClass=1,turn=false,link=false,roundabout=false}={}) {
 return {distanceMeters:2000,durationSeconds:80,
  points:[{lat:40,lon:-8},{lat:40,lon:-7.99},turn?{lat:40.01,lon:-7.99}:{lat:40,lon:-7.98}],
  legs:[{fromNode:0,toNode:1,pointStartIndex:0,pointEndIndex:1,roadIndex:0,roadClass,
    road:{ref:'A5;IC15',name:'Continuous road',roundabout},distanceMeters:1000,durationSeconds:40},
   {fromNode:1,toNode:2,pointStartIndex:1,pointEndIndex:2,roadIndex:1,roadClass,
    road:{ref:'A5',name:'Continuous road',link,roundabout},distanceMeters:1000,durationSeconds:40}]};
}
const plainJunction={outgoingEdges:()=>[{to:0,driveAllowed:true},{to:2,driveAllowed:true}],hasTurnRestrictions:()=>false};
test('splitting a straight motorway into OSM ways adds no junction delay',()=>{
 const r=continuousRoute(),control=structuredClone(r);control.legs[1].roadIndex=0;
 const calibrated=calibrateDriveEta(r);
 assert.equal(calibrated.durationSeconds,calibrateDriveEta(control).durationSeconds);
 assert.equal(calibrated.points,r.points);
 assert.deepEqual(r.legs.map(l=>l.durationSeconds),[40,40]);
});
test('sharp turns and ramps keep their actual transition allowance',()=>{
 const straight=calibrateDriveEta(continuousRoute()).durationSeconds;
 assert.equal(calibrateDriveEta(continuousRoute({turn:true})).durationSeconds,straight+2);
 assert.equal(calibrateDriveEta(continuousRoute({link:true})).durationSeconds,straight+2);
});
test('local street fragments are distinct from actual or restricted junctions',()=>{
 const r=continuousRoute({roadClass:6});
 const free=calibrateDriveEta(r,plainJunction).durationSeconds;
 assert.equal(calibrateDriveEta(r,{...plainJunction,outgoingEdges:()=>[...plainJunction.outgoingEdges(),{to:3,driveAllowed:true}]}).durationSeconds,free+6);
 assert.equal(calibrateDriveEta(r,{...plainJunction,hasTurnRestrictions:()=>true}).durationSeconds,free+6);
});
test('circulating through roundabout fragments does not repeat entry delays',()=>{
 const r=continuousRoute({roundabout:true});
 const control=structuredClone(r);control.legs[1].roadIndex=0;
 assert.equal(calibrateDriveEta(r).durationSeconds,calibrateDriveEta(control).durationSeconds);
 r.legs[0].road.roundabout=false;
 assert.equal(calibrateDriveEta(r).durationSeconds,calibrateDriveEta(control).durationSeconds+7);
});

test('toll boundaries retain their transition allowance',()=>{
 const r=continuousRoute(),base=calibrateDriveEta(r).durationSeconds;
 r.legs[1].road.toll=true;
 assert.equal(calibrateDriveEta(r).durationSeconds,base+2);
});
