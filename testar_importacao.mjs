import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {readFile} from 'node:fs/promises';
import {NAMES,collect,inspectGra,analyze,unzip,crc32,importPack} from './web/pack.mjs';
function gra(frames=3,w=256){const b=new Uint8Array(19+4*frames+8*frames),v=new DataView(b.buffer);b.set([0,0,1,1,3,frames,100]);v.setUint16(11,w,true);v.setUint16(13,w,true);for(let i=0;i<frames;i++){v.setUint32(19+4*i,(i+1)*4,true);let p=19+4*frames+i*8;[Math.min(w-1,120+i),Math.min(w-1,195),1,65535].forEach((n,k)=>v.setUint16(p+2*k,n,true));}return b;}
const counts={mo:8,st:3,th:7,pa:8,pu:7,dd:21,wi:22,wa:23,msb_ch:1,rui_mo:8,rui_st:3,preview:3,face:1};
const fixtures=NAMES.map(n=>[n+'.gra',gra(counts[n.replace(/_[swne]$/,'')],n==='face'?40:256)]);
const metadata={format:'spr-viewer character 1',name:'Teste local',sheets:NAMES.map((n,i)=>({file:n+'.gra',frames:fixtures[i][1][5],w:n==='face'?40:256,h:n==='face'?40:256}))};
fixtures.push(['character.json',new TextEncoder().encode('\ufeff'+JSON.stringify(metadata))]);
function zip(entries,method=8){const locals=[],centrals=[];let offset=0;for(const [name,bytes]of entries){const n=Buffer.from(name),raw=Buffer.from(bytes),d=method===8?deflateRawSync(raw):raw,l=Buffer.alloc(30),c=Buffer.alloc(46);l.writeUInt32LE(0x04034b50);l.writeUInt16LE(method,8);l.writeUInt32LE(crc32(raw),14);l.writeUInt32LE(d.length,18);l.writeUInt32LE(raw.length,22);l.writeUInt16LE(n.length,26);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(method,10);c.writeUInt32LE(crc32(raw),16);c.writeUInt32LE(d.length,20);c.writeUInt32LE(raw.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);locals.push(l,n,d);centrals.push(c,n);offset+=l.length+n.length+d.length;}const cd=Buffer.concat(centrals),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);return new Uint8Array(Buffer.concat([...locals,cd,end]));}
const r=await analyze(collect(fixtures));assert.equal(r.files,37);assert.equal(r.frames,250);assert.equal(r.valid,true);assert.equal(r.metadata.name,'Teste local');
for(const method of [0,8]){const z=zip(fixtures.map(([n,b])=>['pack/'+n,b]),method),files=await unzip(z);assert.equal(files.size,38);assert.equal((await analyze(files)).valid,true);}
const files=collect(fixtures);files.set('mo_s.gra',gra(16));assert.equal((await analyze(files)).valid,false);
files.set('mo_s.gra',fixtures[0][1].slice(0,-1));assert.equal((await analyze(files)).sheets.mo_s,undefined);
assert.throws(()=>collect([fixtures[0],['other/mo_s.gra',fixtures[0][1]]]),/duplicado/);
assert.equal((await analyze(new Map())).valid,false);
const badJson=collect(fixtures);badJson.set('character.json',new TextEncoder().encode('[]'));assert.equal((await analyze(badJson)).valid,false);
const badMeta=structuredClone(metadata);badMeta.sheets[0].frames=1;badJson.set('character.json',new TextEncoder().encode(JSON.stringify(badMeta)));assert.equal((await analyze(badJson)).valid,false);
const corrupt=zip([fixtures[0]],0);corrupt[30+fixtures[0][0].length+10]^=1;await assert.rejects(unzip(corrupt),/corrompido/);
await assert.rejects(unzip(zip([fixtures[0]]).slice(0,-1)),/ZIP/);
await assert.rejects(unzip(zip([fixtures[0],['x/mo_s.gra',fixtures[0][1]]])),/duplicado/);
const malformed=gra();new DataView(malformed.buffer).setUint16(19+4*3,256,true);await assert.rejects(inspectGra('st_s',malformed),/fora da tela/);
await assert.rejects(importPack([{name:'bad.zip',size:128_000_001}]),/128 MB/);
const imported=await importPack(fixtures.map(([name,b])=>({name,size:b.length,arrayBuffer:async()=>b.slice().buffer})));assert.equal(imported.report.valid,true);assert.equal(imported.name,'Teste local');
const raw=zip(fixtures),p=await importPack([{name:'pack.zip',size:raw.length,arrayBuffer:async()=>raw.buffer}]);assert.equal(p.report.frames,250);
// Verify decoder graph is preserved on every supported platform, without requiring the private backup.
const origin=JSON.parse(await readFile(new URL('./ORIGEM_MODULOS.json',import.meta.url),'utf8'));
for(const f of origin.files){const b=await readFile(new URL('./web/js/'+f.file,import.meta.url));const hex=Buffer.from(await crypto.subtle.digest('SHA-256',b)).toString('hex');assert.equal(hex,f.sha256,f.file);}
console.log(JSON.stringify({passed:true,scope:'Browser import core / ZIP stored+deflate, CRC, bounds, GRA corruption, JSON, duplicate and size limits, 37 sheets / 250 frames',originalModules:origin.files.length}));
