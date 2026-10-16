import { mkdirSync, writeFileSync } from 'node:fs';
import { rankTransitJourneys } from '../src/transit/transit-journey-ranker.js';
import { TransitJourneyBridge } from '../src/transit/transit-journey-bridge.js';
import { TransitJourneyExecution } from '../src/transit/transit-journey-execution.js';
import { TfLJourneyProvider } from '../src/transit/providers/tfl-journey-provider.js';

// Synthetic public-place fixtures only. Expected behavior comes from the original app.
let seed=17623;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
const ranking=[];
for(let group=0;group<32;group++){
  const input=Array.from({length:8},(_,index)=>{
    const sequence=[{kind:'walk',mode:'walking',durationMinutes:Math.floor(random()*25),disruptions:[]}];
    for(let leg=0,count=1+Math.floor(random()*3);leg<count;leg++)sequence.push({kind:'transit',mode:'tube',line:['Bakerloo','Central','Elizabeth'][leg],fromName:`Stop ${leg}`,toName:`Stop ${leg+1}`,durationMinutes:5+Math.floor(random()*20),disruptions:random()<.2?[{summary:'Synthetic service notice'}]:[]});
    const durationMinutes=sequence.reduce((total,leg)=>total+leg.durationMinutes,0)+Math.floor(random()*10);
    const departure=Date.UTC(2026,9,16,12,Math.floor(random()*25));
    return {id:`g${group}-${index}`,durationMinutes,sequence,...(group%3?{startTime:new Date(departure).toISOString(),arrivalTime:new Date(departure+durationMinutes*60000).toISOString()}:{})};
  });
  ranking.push({input,expected:rankTransitJourneys(input)});
}
const raw={duration:22,startDateTime:'2026-10-16T12:00:00Z',arrivalDateTime:'2026-10-16T12:22:00Z',legs:[
  {mode:{id:'walking'},duration:5,instruction:{summary:'Walk to station'},departurePoint:{commonName:'Origin'},arrivalPoint:{commonName:'Paddington Underground Station'},path:{lineString:'[[51.515,-0.18],[51.516,-0.175]]'}},
  {mode:{id:'tube'},duration:12,departureTime:'2026-10-16T12:05:00Z',arrivalTime:'2026-10-16T12:17:00Z',routeOptions:[{name:'Bakerloo',directions:['Elephant & Castle Underground Station']}],instruction:{summary:'Bakerloo to Oxford Circus',detailed:'Take the southbound train from platform 4'},departurePoint:{naptanId:'synthetic-paddington',commonName:'Paddington Underground Station',stopLetter:'A'},arrivalPoint:{naptanId:'synthetic-oxford',commonName:'Oxford Circus Underground Station'},path:{lineString:'[[51.516,-0.175],[51.515,-0.141]]',stopPoints:[{name:'Baker Street Underground Station'}]},disruptions:[{summary:'Synthetic notice'}]},
  {mode:{id:'walking'},duration:5,instruction:{summary:'Walk to destination'},departurePoint:{commonName:'Oxford Circus'},arrivalPoint:{commonName:'Destination'},path:{lineString:'[[51.515,-0.141],[51.514,-0.14]]'}}
]};
const provider=new TfLJourneyProvider({fetchImpl:async()=>({ok:true,json:async()=>({journeys:[raw]})})});
const normalized=(await provider.journeys({lat:51.5,lon:-.1},{lat:51.51,lon:-.12}))[0];
const bridge=new TransitJourneyBridge({provider:{journeys:async()=>[normalized]}});
const alternative=await bridge.plan({lat:51.5,lon:-.1},{lat:51.51,lon:-.12});
let tick=10;const execution=new TransitJourneyExecution(alternative[0],{now:()=>tick++});
const actions=['boarded','arrived','get_off','boarded','boarded','get_off','arrived','arrived'];
const transitions=actions.map(action=>({action,accepted:execution.transition(action),state:execution.getState()}));
const path=process.argv[2]??'android/native-app/src/androidTest/assets/native-transit.json';
mkdirSync(path.slice(0,path.lastIndexOf('/')),{recursive:true});
writeFileSync(path,JSON.stringify({ranking,raw,normalized,alternative,transitions}));
console.log(`Generated ${ranking.length} ranking groups and original normalization / execution fixtures`);
