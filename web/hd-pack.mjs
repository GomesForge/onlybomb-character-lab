// The backup's hd.json contract: atlas rects, plus its older PNG grid layout.
export const HD_NAMES=['mo','st','th','pa','pu'].flatMap(a=>[...'swne'].map(d=>a+'_'+d)).concat(['dd','wi','wa'],['msb_ch','rui_mo','rui_st'].flatMap(a=>[...'swne'].map(d=>a+'_'+d)));
export function imageSize(raw,format){
 const b=new Uint8Array(raw),v=new DataView(b.buffer,b.byteOffset,b.byteLength);
 if(format==='png'){
  if(b.length<33||![137,80,78,71,13,10,26,10].every((x,i)=>b[i]===x)||String.fromCharCode(...b.slice(12,16))!=='IHDR')throw Error('PNG inválido');
  return [v.getUint32(16),v.getUint32(20)];
 }
 if(b.length<30||String.fromCharCode(...b.slice(0,4))!=='RIFF'||String.fromCharCode(...b.slice(8,12))!=='WEBP'||v.getUint32(4,true)+8!==b.length)throw Error('WebP inválido');
 const tag=String.fromCharCode(...b.slice(12,16));
 if(tag==='VP8X')return [1+b[24]+(b[25]<<8)+(b[26]<<16),1+b[27]+(b[28]<<8)+(b[29]<<16)];
 if(tag==='VP8L'&&b[20]===47)return [1+b[21]+((b[22]&63)<<8),1+(b[22]>>6)+(b[23]<<2)+((b[24]&15)<<10)];
 if(tag==='VP8 '&&b[23]===157&&b[24]===1&&b[25]===42)return [v.getUint16(26,true)&16383,v.getUint16(28,true)&16383];
 throw Error('Cabeçalho WebP não reconhecido');
}
export function inspectHd(files,gra){
 const raw=files.get('hd.json');if(!raw)return {present:false,sheets:[],issues:[]};
 const issues=[],sheets=[];const warn=(file,text)=>issues.push({level:'warning',file,text:'HD: '+text+'; GRA nativo será usado nesta folha.'});
 let meta;try{meta=JSON.parse(new TextDecoder().decode(raw));if(!['png','webp'].includes(meta.format)||!Number.isInteger(meta.scale)||meta.scale<1||meta.scale>16||!meta.sheets||Array.isArray(meta.sheets))throw Error('format/scale/sheets inválidos');}catch(e){warn('hd.json',e.message);return {present:true,sheets,issues};}
 const k=meta.scale;
 for(const [name,m] of Object.entries(meta.sheets)){
  if(!HD_NAMES.includes(name)){warn('hd.json','folha '+name+' não é usada pelo passe HD original');continue;}
  const file='hd/'+name+'.'+meta.format;
  try{
   const source=gra[name];if(!source||m.frames!==source.frames)throw Error('contagem de quadros diverge do GRA');
   const bytes=files.get(file);if(!bytes)throw Error('imagem ausente');
   const size=imageSize(bytes,meta.format),[w,h]=size;
   if(!w||!h||w>16384||h>16384||w*h>64_000_000)throw Error('dimensões da imagem excedem o limite');
   if(m.size&&(!Array.isArray(m.size)||m.size.length!==2||m.size.some((x,i)=>x!==size[i])))throw Error('size diverge da imagem');
   if(!Array.isArray(m.box)||m.box.length!==4||!m.box.every(Number.isInteger))throw Error('box inválido');
   const [bx,by,bw,bh]=m.box;if(bx<0||by<0||bw<1||bh<1||bx+bw>256||by+bh>256)throw Error('box fora do canvas GRA');
   let rects=m.rects;
   if(!rects){if(meta.format!=='png'||!Number.isInteger(m.cols)||m.cols<1)throw Error('grade PNG antiga requer cols');rects=Array.from({length:m.frames},(_,f)=>[(f%m.cols)*bw*k,Math.floor(f/m.cols)*bh*k,0,0,bw*k,bh*k]);}
   if(!Array.isArray(rects)||rects.length!==m.frames)throw Error('quantidade de rects inválida');
   for(const r of rects){if(!Array.isArray(r)||r.length!==6||!r.every(x=>Number.isInteger(x)&&x>=0))throw Error('rect inválido');const [x,y,rx,ry,rw,rh]=r;if(x+rw>w||y+rh>h||rx+rw>bw*k||ry+rh>bh*k)throw Error('rect fora da imagem/box');}
   const boxes=rects.map(([, ,rx,ry,rw,rh])=>rw?[bx+Math.floor(rx/k),by+Math.floor(ry/k),Math.ceil((rx+rw)/k)-Math.floor(rx/k),Math.ceil((ry+rh)/k)-Math.floor(ry/k)]:[0,0,0,0]);
   sheets.push({name,file,frames:m.frames,scale:k,box:m.box,rects,boxes,w,h,greyBit:!!meta.grey_bit,type:meta.format==='webp'?'image/webp':'image/png'});
  }catch(e){warn(file,e.message);}
 }
 return {present:true,scale:k,format:meta.format,sheets,issues};
}
