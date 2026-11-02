// Real public map sprites + injected transport failures. No backup or network.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Sprite} from './web/js/assets/spr.js';
import {Runs} from './web/js/game/fb565.js';
import {ensureTrainingAssets,trainingAssetsFor} from './web/training-assets.mjs';
const decode=(path,bytes)=>Runs.fromSprite(new Sprite(path,bytes.slice().buffer));
const bytes=async path=>new Uint8Array(await readFile(new URL('./web/data/'+path,import.meta.url)));
async function fixtures(map){const a={bgs:[]};for(const s of trainingAssetsFor(map))a[s.key]=decode(s.path,await bytes(s.path));return a;}
let recovered=0;
for(const map of [1,2,3,4,5,6,8,10,11,12]){
 const assets=await fixtures(map);
 const checked=await ensureTrainingAssets({assets,map,decode,fetcher:()=>assert.fail('No request for valid assets')});
 assert.equal(checked.length,6);assert(checked.every(s=>!s.recovered));assert.equal(assets.bgs[map%9],assets['bg'+map%9]);
}
{
 const assets=await fixtures(1);delete assets.tile;const requests=[];
 const checked=await ensureTrainingAssets({assets,map:1,decode,onRecovery:()=>recovered++,fetcher:async(url,opts)=>{
  requests.push(url);assert.equal(opts.cache,'reload');return {ok:true,arrayBuffer:async()=>(await bytes('map/tile.spr')).buffer};
 }});
 assert.deepEqual(requests,['data/map/tile.spr']);assert.equal(assets.tile.n,22);assert(checked[0].recovered);
 await ensureTrainingAssets({assets,map:1,decode,fetcher:()=>assert.fail('Do not refetch recovered assets')});
}
{
 const assets=await fixtures(1);delete assets.bg1;let attempts=0;
 await ensureTrainingAssets({assets,map:1,decode,fetcher:async()=>++attempts===1?{ok:false,status:503}:{ok:true,arrayBuffer:async()=>(await bytes('map/map_00.spr')).buffer}});
 assert.equal(attempts,2);assert.equal(assets.bgs[1],assets.bg1);
}
for(const mode of ['http','truncated']){
 const assets=await fixtures(1);delete assets.tile;let attempts=0;
 await assert.rejects(ensureTrainingAssets({assets,map:1,decode,fetcher:async()=>{attempts++;return mode==='http'?{ok:false,status:503}:{ok:true,arrayBuffer:async()=>new ArrayBuffer(3)};}}),/Não foi possível carregar map\/tile.spr/);
 assert.equal(attempts,2);assert.equal(assets.tile,undefined);
}
assert.equal(recovered,1);
console.log(JSON.stringify({passed:true,maps:10,missingFloorRecovered:true,retryTransientHttp:true,backgroundSlotRefreshed:true,persistentFailureBlocked:true,corruptionBlocked:true,noRequestsWhenHealthy:true}));
