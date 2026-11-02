// Browser-local import and structural validation. No uploads, storage or server API.
import { HD_NAMES, inspectHd } from './hd-pack.mjs';
export const NAMES = ['mo','st','th','pa','pu'].flatMap(a=>[... 'swne'].map(d=>`${a}_${d}`)).concat(['dd','wi','wa'],['msb_ch','rui_mo','rui_st'].flatMap(a=>[... 'swne'].map(d=>`${a}_${d}`)),['preview','face']);
const known=new Set(NAMES.map(n=>n+'.gra').concat('character.json'));
const hdFiles=new Set(HD_NAMES.flatMap(n=>[n+'.png',n+'.webp']));
const accepted=n=>/^[a-z0-9_-]+\.gra$/.test(leaf(n))||known.has(leaf(n))||leaf(n)==='hd.json'||hdFiles.has(leaf(n))&&(!n.replaceAll('\\','/').includes('/')||n.replaceAll('\\','/').toLowerCase().split('/').includes('hd'));
const keyFor=n=>hdFiles.has(leaf(n))?'hd/'+leaf(n):leaf(n);
export const LIMITS={file:32_000_000,zip:128_000_000,total:256_000_000,entries:40_000,recognized:10_000};
const EXACT={mo:8,st:3,rui_mo:8,rui_st:3,msb_ch:1,preview:3,face:1};
const RANGES={th:[5,7],pa:[5,8],pu:[5,7],dd:[7,30],wa:[18,23]};
const group=n=>n.replace(/_[swne]$/,'');
const leaf=n=>n.replaceAll('\\','/').split('/').at(-1).toLowerCase();
const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
async function hash(b){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('');}
export function collect(entries){
 const files=new Map();let total=0;
 for(const [path,raw] of entries){if(!accepted(path))continue;const n=keyFor(path);if(files.has(n))throw Error('Nome duplicado: '+n+'. Importe um personagem por vez.');const b=new Uint8Array(raw);if(b.length>LIMITS.file)throw Error('Arquivo excede 32 MB: '+n);total+=b.length;if(total>LIMITS.total)throw Error('Pacote excede 256 MB');files.set(n,b);}
 if(!files.size)throw Error('Nenhum GRA/character.json reconhecido');return files;
}
export async function inspectGra(name,bytes){
 const b=new Uint8Array(bytes),v=new DataView(b.buffer,b.byteOffset,b.byteLength);
 if(b.length<23||!same(b.subarray(0,4),new Uint8Array([0,0,1,1])))throw Error('Assinatura GRA inválida');
 const frames=b[5],w=v.getUint16(11,true),h=v.getUint16(13,true),base=19+4*frames;
 if(!frames||!w||!h||Math.max(w,h)>1024||base>b.length)throw Error('Cabeçalho inválido');
 if(base+2*v.getUint32(19+4*(frames-1),true)!==b.length)throw Error('Tamanho divergente do cabeçalho');
 const boxes=[],hashes=[],pixels=[],empty=[],edge=[],outside=[];let start=0;
 for(let i=0;i<frames;i++){
  const end=v.getUint32(19+4*i,true);if(end<start)throw Error('Offsets fora de ordem');let p=base+2*start,stop=base+2*end,x0=w,y0=h,x1=0,y1=0,count=0,bad=0;
  while(p<stop){if(p+6>stop)throw Error('Corrida truncada no quadro '+i);const x=v.getUint16(p,true),y=v.getUint16(p+2,true),k=v.getUint16(p+4,true);p+=6;
   // Original sprites (e.g. Bomberking blink frames) use an empty RLE record.
   // It consumes its six-byte header and draws no pixels in Sprite/Runs/FB.
   if(!k)continue;
   if(x+k>w||y>=h||p+2*k>stop)throw Error('Corrida fora da tela/truncada no quadro '+i);
   x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+k);y1=Math.max(y1,y+1);count+=k;
   bad+=y<88||y>216?k:Math.max(0,Math.min(x+k,80)-x)+Math.max(0,x+k-Math.max(x,177));p+=2*k;
  }
  boxes.push(count?[x0,y0,x1,y1]:null);pixels.push(count);hashes.push(await hash(b.slice(base+2*start,stop)));
  if(!count)empty.push(i);if(count&&(x0===0||y0===0||x1===w||y1===h))edge.push(i);if(bad)outside.push(i);start=end;
 }
 const issues=[],g=group(name),size=name==='face'?40:256;
 const issue=(level,text)=>issues.push({level,text});
 if(w!==size||h!==size)issue('warning',`Tela nativa ${w}×${h}; recomendação de criação ${size}×${size}. Reprodução sem redimensionar o arquivo.`);
 if(g in EXACT&&frames!==EXACT[g])issue('warning',`${frames} quadros; padrão de criação ${EXACT[g]}. O laboratório preserva o arquivo e o relógio original.`);
 if(g in RANGES&&(frames<RANGES[g][0]||frames>RANGES[g][1]))issue('warning',`${frames} quadros; fora da faixa de criação ${RANGES[g].join('–')}, mas legível pelo motor. Não certifica upload no servidor.`);
 if(g==='wi'&&![9,11,22].includes(frames))issue('warning','Contagem de vitória não comprovada no importador. O motor lê a contagem do arquivo.');
 if(empty.length)issue('warning','Quadros vazios: '+JSON.stringify(empty));
 if(edge.length&&name!=='face')issue('warning','Pixels na borda da tela: '+JSON.stringify(edge));
 if(outside.length&&['mo','st','th','pa','pu'].includes(g))issue('warning','Fora da área segura recomendada: '+JSON.stringify(outside));
 if(['mo','pa','st','rui_mo','rui_st'].includes(g)&&new Set(hashes).size<frames)issue('warning','Há quadros binariamente repetidos; conferir movimento visualmente.');
 return {file:name+'.gra',frames,w,h,bytes:b.length,sha256:await hash(b),boxes,hashes,pixels,issues};
}
export async function analyze(files){
 const sheets=Object.create(null),issues=[],fallbacks=Object.create(null);
 const present=[...files.keys()].filter(n=>n.endsWith('.gra')).map(n=>n.slice(0,-4));
 for(const n of present){const raw=files.get(n+'.gra');
  try{const s=await inspectGra(n,raw);sheets[n]=s;issues.push(...s.issues.map(x=>({file:n+'.gra',...x})));}catch(e){issues.push({level:'error',file:n+'.gra',text:e.message});}
 }
 let metadata=null;
 if(files.has('character.json')){
  try{metadata=JSON.parse(new TextDecoder().decode(files.get('character.json')));if(!metadata||Array.isArray(metadata)||metadata.format!=='spr-viewer character 1')throw Error('Formato esperado: spr-viewer character 1');
   const rows=metadata.sheets;if(!Array.isArray(rows)||rows.some(s=>!s||typeof s!=='object'))throw Error('Metadados de folhas inválidos; os GRA serão usados diretamente');
   if(!same(rows.map(s=>s.file),NAMES.map(n=>n+'.gra')))issues.push({level:'warning',file:'character.json',text:'Lista/ordem diferente do pacote de criação de37folhas. Os nomes e cabeçalhos GRA determinam a reprodução.'});
   for(const s of rows){const g=sheets[leaf(String(s.file)).replace(/\.gra$/,'')];if(g&&['frames','w','h'].some(k=>s[k]!==undefined&&s[k]!==g[k]))issues.push({level:'warning',file:s.file,text:'Metadados divergem do GRA; usando o cabeçalho binário do arquivo.'});}
  }catch(e){metadata=null;issues.push({level:'warning',file:'character.json',text:e.message+' · JSON opcional; reprodução pelos GRA.'});}
 }
 const core=['mo','st'].flatMap(a=>[...'swne'].map(d=>a+'_'+d));
 const kind=present.length===8&&core.every(n=>sheets[n])?'mount':'character';
 for(const n of NAMES){if(sheets[n])continue;
  if(n==='preview'&&sheets.st_s){fallbacks[n]='st_s';issues.push({level:'info',file:n+'.gra',text:'Prévia exibida a partir de st_s.gra; nenhum arquivo original foi alterado.'});}
  else if(core.includes(n))issues.push({level:'error',file:n+'.gra',text:'Folha de repouso/caminhada necessária para o treino ausente ou inválida.'});
  else{
   if(n.startsWith('pu_')&&sheets['st_'+n.at(-1)])fallbacks[n]='st_'+n.at(-1);
   if(['wa','wi','dd'].includes(n)&&sheets.st_s)fallbacks[n]='st_s';
   issues.push({level:'warning',file:n+'.gra',text:'Esta pasta não possui a ação. '+(fallbacks[n]?'No treino, usa '+fallbacks[n]+'.gra como repouso de segurança; não é uma animação original desta ação.':'Sem desenho substituto; ação desabilitada no diagnóstico.')});
  }
 }
 const seams=[];function seam(a,ia,b,ib){if(sheets[a]&&sheets[b]&&sheets[a].hashes.at(ia)&&sheets[b].hashes.at(ib))seams.push({a,ia,b,ib,equal:sheets[a].hashes.at(ia)===sheets[b].hashes.at(ib)});}
 for(const d of 'swne'){for(const a of ['th','pu'])seam(a+'_'+d,-1,'st_'+d,0);seam('mo_'+d,-1,'mo_'+d,0);}seam('wa',0,'st_s',0);seam('wi',-1,'wi',0);seam('dd',-1,'dd',-2);
 if(files.has('preview.gra')&&files.has('st_s.gra')&&!same(files.get('preview.gra'),files.get('st_s.gra')))issues.push({level:'warning',file:'preview.gra',text:'Não é cópia binária do st_s.gra'});
 const hd=inspectHd(files,sheets);issues.push(...hd.issues);
 return {sheets,issues,seams,metadata,hd,kind,fallbacks,expected:kind==='mount'?8:37,extras:present.filter(n=>!NAMES.includes(n)),files:Object.keys(sheets).length,frames:Object.values(sheets).reduce((s,g)=>s+g.frames,0),valid:core.every(n=>sheets[n])&&!issues.some(x=>x.level==='error'),note:'Leitura e reprodução dos GRA, com JSON opcional. Recomendações de criação/upload são avisos; corrupção binária continua bloqueando. Ações ausentes são identificadas explicitamente.'};
}
// ZIP central-directory parser; stored/deflate only, bounded decompression and CRC validation.
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function crc32(b){let c=0xffffffff;for(const x of b)c=crcTable[(c^x)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
export async function unzipEntries(raw){
 const b=new Uint8Array(raw);if(b.length>LIMITS.zip)throw Error('Limite de 128 MB por ZIP');const v=new DataView(b.buffer,b.byteOffset,b.byteLength);
 function check(p,n){if(p<0||p+n>b.length)throw Error('ZIP truncado ou inválido');}
 let e=-1;for(let p=b.length-22;p>=Math.max(0,b.length-65557);p--){if(v.getUint32(p,true)===0x06054b50&&p+22+v.getUint16(p+20,true)===b.length){e=p;break;}}
 if(e<0)throw Error('Diretório ZIP ausente');
 const count=v.getUint16(e+10,true),cdSize=v.getUint32(e+12,true),cd=v.getUint32(e+16,true);
 if(v.getUint16(e+4,true)||v.getUint16(e+6,true)||v.getUint16(e+8,true)!==count||count>LIMITS.entries||cd+cdSize!==e)throw Error('ZIP dividido/ZIP64 ou limite de entradas excedido');
 let p=cd,total=0;const rows=[];
 for(let i=0;i<count;i++){
  check(p,46);if(v.getUint32(p,true)!==0x02014b50)throw Error('Entrada ZIP inválida');const flags=v.getUint16(p+8,true),method=v.getUint16(p+10,true),crc=v.getUint32(p+16,true),compressed=v.getUint32(p+20,true),size=v.getUint32(p+24,true),nl=v.getUint16(p+28,true),el=v.getUint16(p+30,true),cl=v.getUint16(p+32,true),offset=v.getUint32(p+42,true);check(p+46,nl+el+cl);
  const name=new TextDecoder().decode(b.subarray(p+46,p+46+nl));p+=46+nl+el+cl;
  if(!name.endsWith('/')&&accepted(name)){total+=size;if(total>LIMITS.total||rows.length>=LIMITS.recognized)throw Error('ZIP excede limites de arquivos reconhecidos/256 MB');if(flags&1||![0,8].includes(method)||size>LIMITS.file)throw Error('ZIP criptografado, método não suportado ou arquivo maior que 32 MB');rows.push({name,flags,method,crc,compressed,size,offset});}
 }
 if(p!==e)throw Error('Diretório ZIP inconsistente');const entries=[];
 for(const r of rows){check(r.offset,30);const q=r.offset;if(v.getUint32(q,true)!==0x04034b50||v.getUint16(q+8,true)!==r.method||(v.getUint16(q+6,true)&1))throw Error('Cabeçalho local ZIP inválido');
  const nl=v.getUint16(q+26,true),el=v.getUint16(q+28,true),start=q+30+nl+el;check(q+30,nl+el);check(start,r.compressed);if(start+r.compressed>cd)throw Error('Dados ZIP fora dos limites');
  if(new TextDecoder().decode(b.subarray(q+30,q+30+nl))!==r.name)throw Error('Nome ZIP divergente');let data=b.slice(start,start+r.compressed);
  if(r.method===8){let ds;try{ds=new DecompressionStream('deflate-raw');}catch{throw Error('Seu navegador não suporta este ZIP. Atualize-o ou importe os GRA/JSON descompactados.');}
   const reader=new Blob([data]).stream().pipeThrough(ds).getReader(),chunks=[];let length=0;
   try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>r.size||length>LIMITS.file){await reader.cancel();throw Error('ZIP excede o tamanho declarado');}chunks.push(value);}}finally{reader.releaseLock();}
   data=new Uint8Array(length);let off=0;for(const c of chunks){data.set(c,off);off+=c.length;}
  }
  if(data.length!==r.size||crc32(data)!==r.crc)throw Error('ZIP corrompido: '+r.name);entries.push([r.name,data]);
 }
 return entries;
}
export async function unzip(raw){return collect(await unzipEntries(raw));}
export async function importPack(list){
 const zips=list.filter(f=>f.name.toLowerCase().endsWith('.zip'));let files;
 if(zips.length){if(list.length!==1)throw Error('Selecione somente um ZIP por importação.');if(zips[0].size>LIMITS.zip)throw Error('Limite de 128 MB por ZIP');files=await unzip(await zips[0].arrayBuffer());}
 else{const chosen=list.filter(f=>accepted(f.webkitRelativePath||f.name));if(chosen.length>LIMITS.recognized||chosen.reduce((s,f)=>s+f.size,0)>LIMITS.total)throw Error('Limite de256MB/10000arquivos reconhecidos');const entries=[];for(const f of chosen){if(f.size>LIMITS.file)throw Error('Arquivo excede32MB: '+f.name);entries.push([f.webkitRelativePath||f.name,await f.arrayBuffer()]);}files=collect(entries);}
 const report=await analyze(files);return {id:'local-'+crypto.randomUUID(),look:0,name:String(report.metadata?.name||zips[0]?.name.replace(/\.zip$/i,'')||'Personagem importado').slice(0,80),files,report};
}
// Preserve paths until character roots have been separated. PNG review folders
// never contribute duplicate GRA/metadata, and no assets are fetched externally.
export function groupEntries(entries){
 const groups=new Map();
 for(const [raw,b] of entries){if(!accepted(raw))continue;
  const path=raw.replaceAll('\\','/'),parts=path.split('/'),lower=parts.map(p=>p.toLowerCase());
  if(hdFiles.has(leaf(path))&&parts.length>1&&!lower.includes('hd'))continue;
  let end=parts.length-1;const anchor=lower.findIndex(p=>['arquivos_do_jogo','arquivos_gra','importar_editor'].includes(p));if(anchor>=0)end=anchor;
  else if(lower.includes('hd'))end=lower.indexOf('hd');
  const root=parts.slice(0,end).join('/');if(!groups.has(root))groups.set(root,[]);groups.get(root).push([path,b]);
 }
 return [...groups].filter(([,rows])=>rows.some(([n])=>n.toLowerCase().endsWith('.gra'))).map(([path,rows])=>({path,entries:rows}));
}
export async function importPacks(list){
 const entries=[];let total=0;const zips=list.filter(f=>f.name.toLowerCase().endsWith('.zip'));
 if(zips.length){if(zips.length!==list.length)throw Error('Importe ZIPs ou pastas/GRA, separadamente.');
  for(const f of zips){if(f.size>LIMITS.zip)throw Error('Limite de128MB porZIP');for(const row of await unzipEntries(await f.arrayBuffer())){total+=row[1].byteLength;if(total>LIMITS.total)throw Error('Limite de256MB por envio');entries.push([zips.length>1?f.name.replace(/\.zip$/i,'')+'/'+row[0]:row[0],row[1]]);}}
 }else{
  const chosen=list.filter(f=>accepted(f.webkitRelativePath||f.name));if(chosen.length>LIMITS.recognized)throw Error('Limite de10000arquivos reconhecidos');
  for(const f of chosen){total+=f.size;if(f.size>LIMITS.file||total>LIMITS.total)throw Error('Limite de32MB por arquivo/256MB por envio');entries.push([f.webkitRelativePath||f.name,await f.arrayBuffer()]);}
 }
 const grouped=groupEntries(entries);if(!grouped.length)throw Error('Nenhum personagem GRA reconhecido');
 const result=[];
 for(const g of grouped){const files=collect(g.entries),report=await analyze(files);const parts=g.path.split('/').filter(Boolean);let hint=parts.at(-1);if(['arquivos_gra','importar_editor','entrega'].includes(hint?.toLowerCase())&&parts.length>1)hint=parts.at(-2);
  result.push({id:'local-'+crypto.randomUUID(),look:0,name:String(report.metadata?.name||hint||zips[0]?.name.replace(/\.zip$/i,'')||'Personagem importado').slice(0,80),files,report});
 }
 return result;
}
