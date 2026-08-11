import assert from 'node:assert/strict'; import test from 'node:test'; import { NavigationFeature } from '../src/features/navigation/navigation-feature.js';
function harness(journeys){const shown=[];const f=new NavigationFeature({map:{clearRoute(){},setNavigationTravelMode(){},showRoute(r){shown.push(r)},clearSelectionPin(){},showSelectionPin(){},focus(){},onUserMoveStart(){}},panelController:{},listElement:{replaceChildren(){}},documentRef:{activeElement:null,createElement(){return {append(){},appendChild(){},addEventListener(){},querySelector(){return null}}}},status(){},
routingService:{
  async route(){
    throw new Error('Offline routing must not be used by this transit test');
  }
},
transitBridge:{async plan(){return journeys}}});return {f,shown}}
const js=[{id:'j1',durationMinutes:25,legs:[{distanceMeters:900}],sequence:[{kind:'walk',points:[{lat:1,lon:1},{lat:2,lon:2}]},{kind:'transit',line:'Jubilee',points:[{lat:2,lon:2},{lat:3,lon:3}]}]},{id:'j2',durationMinutes:29,legs:[{distanceMeters:1200}],sequence:[{kind:'transit',line:'District',points:[{lat:1,lon:1},{lat:4,lon:4}]}]}];
test('transit alternatives preview',async()=>{const {f,shown}=harness(js);f.currentPosition={lat:1,lon:1};f.plannerDestination={lat:4,lon:4,name:'Museum'};f.travelMode='transit';f.render=()=>{};assert.equal(await f.previewPlannedRoute(),true);assert.equal(f.getPlannerState().transitJourneys.length,2);assert.equal(f.getSelectedTransitJourney().id,'j1');assert.equal(shown.length,1);assert.equal(shown.at(-1).transitJourney.id,'j1')});
test('select transit option',async()=>{const {f,shown}=harness(js);f.currentPosition={lat:1,lon:1};f.plannerDestination={lat:4,lon:4,name:'Museum'};f.travelMode='transit';f.render=()=>{};await f.previewPlannedRoute();assert.equal(f.selectTransitJourney(1),true);assert.equal(f.getSelectedTransitJourney().id,'j2');assert.equal(shown.at(-1).transitJourney.id,'j2')});
