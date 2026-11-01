import { HD_SHEETS } from './js/game/fb565.js';
import { hdPixels } from './js/game/hdpixels.js';
// Same object/decoder used by the original Screen HD shader; no network routes or clock changes.
export function attachLocalHd(entry,names,{enabled=true,onError=()=>{}}={}){
 if(!entry.hdSheets){entry.hdSheets=new Map();for(const m of entry.report.hd?.sheets||[]){
  const sheet={...m,bytes:entry.files.get(m.file),pixels:null,bad:false,decoding:null};
  sheet.decode=()=>sheet.decoding|| (sheet.decoding=hdPixels(sheet.bytes,sheet.type).then(px=>{if(px.length!==sheet.w*sheet.h*4)throw Error('dimensões decodificadas divergentes');sheet.pixels=px;}).catch(e=>{sheet.bad=true;onError(m.name,e);}).finally(()=>{sheet.decoding=null;}));
  entry.hdSheets.set(m.name,sheet);HD_SHEETS.push(sheet);
 }}
 for(const [name,sheet] of entry.hdSheets){const r=entry.set[names.indexOf(name)];if(r&&r.n===sheet.frames){r.hd=enabled&&!sheet.bad?sheet:null;r.hdTint=null;}}
}
