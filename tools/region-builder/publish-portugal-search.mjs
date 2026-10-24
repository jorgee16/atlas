#!/usr/bin/env node
/**
 * Publish only Portugal destination-search assets as an atomic region upgrade.
 * Never modify existing object keys: installed v9 clients must remain able
 * to verify the SHA-256 of their own immutable region package.
 */
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';

function option(key) {
  const index=process.argv.indexOf(key);
  if(index<0 || !process.argv[index+1])throw Error('Missing '+key);
  return process.argv[index+1];
}
const catalogPath=option('--catalog');
const searchDir=option('--search-dir');
const output=option('--output');
const catalog=JSON.parse(await readFile(catalogPath,'utf8'));
const pt=catalog.regions?.find(x=>x.id==='portugal');
if(!pt || pt.version!==9 || !pt.package?.files?.length ||
   !pt.assets?.search || !pt.assets?.addressSearch)
  throw Error('Expected published Portugal v9. Stop; inspect the live R2 catalog.');
const nextVersion=pt.version+1;
const base='/region-packages/portugal/search/v'+nextVersion;
const assets={
  search:'search-index.bin',
  searchRecords:'search-records.bin',
  addressSearch:'address-index.bin',
  addressRecords:'address-records.bin'
};
const originalFiles=pt.package.files;
if(originalFiles.reduce((total,file)=>total+file.sizeBytes,0)!==pt.sizeBytes)
  throw Error('Existing catalog size does not equal manifest');
for(const [asset,file] of Object.entries(assets)){
  const oldUrl=pt.assets[asset];
  const matching=originalFiles.map((file,i)=>file.url===oldUrl?i:-1).filter(i=>i>=0);
  if(matching.length!==1)throw Error('Missing/duplicate old manifest entry '+asset);
  const target=path.resolve(searchDir,file);
  const metadata=await stat(target);
  if(!metadata.isFile() || metadata.size<1000)throw Error('Invalid new search file '+file);
  const sha=await new Promise((resolve,reject)=>{
    const hash=createHash('sha256');
    const stream=createReadStream(target);
    stream.on('data',block=>hash.update(block));
    stream.on('error',reject);
    stream.on('end',()=>resolve(hash.digest('hex')));
  });
  const url=base+'/'+file;
  const old=originalFiles[matching[0]];
  originalFiles[matching[0]]={...old,url,label:file,sizeBytes:metadata.size,sha256:sha};
  pt.assets[asset]=url;
  console.log(file,metadata.size,sha,'→',url);
}
pt.version=nextVersion;
pt.updatedAt=new Date().toISOString().slice(0,10);
pt.sizeBytes=originalFiles.reduce((total,file)=>total+file.sizeBytes,0);
const check=new Set(originalFiles.map(f=>f.url));
if(check.size!==originalFiles.length)throw Error('Duplicate package URLs');
await writeFile(output,JSON.stringify(catalog,null,2)+'\n');
console.log('Portugal v'+nextVersion,pt.sizeBytes,'bytes; routing and map untouched.');
