import { inspectGra } from './pack.mjs?v=20261102-kit1';

// The original loader deliberately tolerates missing sprites. The lab must not
// start a test on an incomplete map: Renderer.still preserves pixels where the
// missing floor should have painted, leaving trails. Recover in the adapter,
// before any Match/Renderer is created; original modules and clocks stay intact.
const BACKGROUNDS=['MAP_09.spr','map_00.spr','MAP_01.spr','MAP_06.spr','MAP_03.spr','MAP_04.spr','MAP_05.spr','MAP_08.spr','MAP_10.spr'];
export function trainingAssetsFor(map){
 const design=map%9;
 return [
  {key:'tile',path:'map/tile.spr',frames:20},
  {key:'non',path:'map/non.spr',frames:21},
  {key:'pp',path:'map/pp.spr',frames:16},
  {key:'non_sh',path:'map/non_sh.spr',frames:14},
  {key:'pp_sh',path:'map/pp_sh.spr',frames:10},
  {key:'bg'+design,path:'map/'+BACKGROUNDS[design],frames:1},
 ];
}
function usable(r,min){
 return !!r&&r.n>=min&&r.w>0&&r.h>0&&r.px?.length>0&&r.frames?.length===r.n;
}
export async function ensureTrainingAssets({assets,map,decode,fetcher=fetch,onRecovery=()=>{}}){
 const checked=[];
 for(const spec of trainingAssetsFor(map)){
  let recovered=false,reason;
  if(!usable(assets[spec.key],spec.frames)){
   // Bypass loadSprite's cached rejected promise and retry transient HTTP errors.
   for(let attempt=0;attempt<2;attempt++){
    try{
     const options={cache:'reload'};
     if(typeof AbortSignal!=='undefined'&&AbortSignal.timeout)options.signal=AbortSignal.timeout(8000);
     const res=await fetcher('data/'+spec.path,options);
     if(!res.ok)throw Error('HTTP '+res.status);
     const bytes=new Uint8Array(await res.arrayBuffer()),info=await inspectGra(spec.key,bytes);
     if(info.frames<spec.frames)throw Error('quadros insuficientes');
     const run=decode(spec.path,bytes);
     if(!usable(run,spec.frames))throw Error('sprite vazio ou inválido');
     assets[spec.key]=run;recovered=true;reason=null;break;
    }catch(e){reason=e;}
   }
   if(reason)throw Error('Não foi possível carregar '+spec.path+' para o treino ('+reason.message+'). Tente iniciar novamente; a arena não foi aberta com recursos incompletos.');
   onRecovery(spec.path);
  }
  // loadAssets constructed this array before recovery; refresh the same slot.
  if(spec.key.startsWith('bg'))assets.bgs[map%9]=assets[spec.key];
  checked.push({file:spec.path,recovered,frames:assets[spec.key].n});
 }
 return checked;
}
