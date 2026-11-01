import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inspectHd,imageSize} from './web/hd-pack.mjs';
const encode=o=>new TextEncoder().encode(JSON.stringify(o));
const png=new Uint8Array(33);png.set([137,80,78,71,13,10,26,10]);png.set([73,72,68,82],12);new DataView(png.buffer).setUint32(16,16);new DataView(png.buffer).setUint32(20,16);
const gra={mo_s:{frames:8}},m={frames:8,box:[120,150,4,4],size:[16,16],cols:2};
function inspect(meta,bytes=png){return inspectHd(new Map([['hd.json',encode(meta)],['hd/mo_s.'+meta.format,bytes]]),gra);}
const meta={format:'png',scale:2,grey_bit:true,sheets:{mo_s:m}};
let r=inspect(meta);assert.equal(r.sheets.length,0,'Grid8frames does not fit16x16');
m.size=[16,32];new DataView(png.buffer).setUint32(20,32);r=inspect(meta);assert.equal(r.sheets.length,1);assert.deepEqual(r.sheets[0].rects[2],[0,8,0,0,8,8]);assert.equal(r.sheets[0].greyBit,true);
const rects=r.sheets[0].rects;const packed=structuredClone(meta);delete packed.sheets.mo_s.cols;packed.sheets.mo_s.rects=rects;r=inspect(packed);assert.equal(r.sheets.length,1,'PNG packed rects');
const bad=structuredClone(packed);bad.sheets.mo_s.frames=7;assert.equal(inspect(bad).sheets.length,0,'Frame mismatch falls back');
bad.sheets.mo_s.frames=8;bad.sheets.mo_s.rects[0][0]=99;assert.equal(inspect(bad).sheets.length,0,'Out-of-atlas rect falls back');
const webp=new Uint8Array(30);webp.set(new TextEncoder().encode('RIFF'),0);webp.set(new TextEncoder().encode('WEBPVP8X'),8);new DataView(webp.buffer).setUint32(4,22,true);webp[24]=15;webp[27]=31;assert.deepEqual(imageSize(webp,'webp'),[16,32]);
const modern=structuredClone(packed);modern.format='webp';assert.equal(inspect(modern,webp).sheets.length,1,'Current WebP rects');
assert.equal(inspectHd(new Map(),gra).present,false);assert.equal(inspectHd(new Map([['hd.json',encode({})]]),gra).sheets.length,0);assert.throws(()=>imageSize(new Uint8Array(3),'png'));
// If local browser fixtures are present, also validate the actual PNG grid and lossless WebP packages.
const {unzip,analyze}=await import('./web/pack.mjs');let fixtures=0;
for(const format of ['png','webp']){let bytes;try{bytes=await readFile(new URL('./.test-data/oficial-hd-'+format+'.zip',import.meta.url));}catch(e){if(e.code==='ENOENT')continue;throw e;}const files=await unzip(bytes),report=await analyze(files);assert.equal(report.valid,true);assert.equal(report.frames,226);assert.equal(report.hd.sheets.length,1);assert.equal(report.hd.issues.length,0);fixtures++;}
console.log(JSON.stringify({passed:true,scope:'HD metadata/layout/PNG/WebP, legacy grid, frame and atlas mismatch fallback; browser GPU test separate',localOfficialFixtures:fixtures}));
