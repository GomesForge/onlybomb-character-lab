// Non-UI regression tests. Real original ESM graph + lab adapter, no browser or DOM automation.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict'),{pathToFileURL}=require('url');
const root=path.join(__dirname,'web'),mods=new Map();
const context=vm.createContext({console,URL,TextDecoder,TextEncoder,EventTarget,Event,CustomEvent:global.CustomEvent||Event,AbortController,setTimeout,clearTimeout,performance,ImageData:class{constructor(w,h){this.width=w;this.height=h;this.data=new Uint8ClampedArray(w*h*4);}},addEventListener(){},removeEventListener(){},document:{body:{querySelectorAll(){return[];}},createTreeWalker(){return{nextNode(){return null;}};}},NodeFilter:{SHOW_TEXT:4},localStorage:{getItem(){return null;}},window:{addEventListener(){},removeEventListener(){}},navigator:{language:'pt-BR',languages:['pt-BR']}});
function moduleFor(file){file=path.resolve(file);if(mods.has(file))return mods.get(file);const m=new vm.SourceTextModule(fs.readFileSync(file,'utf8'),{context,identifier:file,initializeImportMeta(meta){meta.url=pathToFileURL(file).href;}});mods.set(file,m);return m;}
async function main(){
 const engine=moduleFor(path.join(root,'engine.mjs'));await engine.link((specifier,m)=>moduleFor(path.resolve(path.dirname(m.identifier),specifier)));await engine.evaluate();
 const E=engine.namespace,Sprite=mods.get(path.join(root,'js/assets/spr.js')).namespace.Sprite,F=mods.get(path.join(root,'js/game/fb565.js')).namespace;
 function runs(p){const b=fs.readFileSync(p);return F.Runs.fromSprite(new Sprite(p,Uint8Array.from(b).buffer));}
 const data=path.join(__dirname,'../38_BACKUP_SERVIDOR_2026-10-31/01_JOGO_SITE_onlybomb.online/data');
 const L=['MO_S','MO_W','MO_N','MO_E','ST_S','ST_W','ST_N','ST_E'].map(n=>runs(path.join(data,'player/Lui',n+'.gra')));
 const louie=Array.from({length:4},()=>L);
 const project=process.argv[2]?path.resolve(process.argv[2]):path.join(__dirname,'../Personagens Customizados/MADARA_BOMBER/entrega/madara-bomber');
 const set=E.NAMES.map(n=>runs(path.join(project,n+'.gra'))),checks=[];
 function cycle(action,limit=4000,opts={}){const e=new E.LabEngine(set,louie,{action,...opts});let saw=false;for(let t=0;t<limit;t+=20){e.step();if(e.p.frame!==0)saw=true;if(e.done)return e;if(saw&&e.p.frame===0&&['st','mo','pa','wi'].includes(action))return e;}return e;}
 const count=n=>set[E.INDEX[n]].n,quantize=ms=>Math.ceil(ms/20)*20;
 for(const [a,ms]of [['st',480],['mo',480],['pa',count('pa_s')*50],['th',(count('th_s')+1)*60],['pu',quantize((count('pu_s')+1)*70)],['dd',quantize((count('dd')+1)*70)],['wa',count('wa')*40]]){const e=cycle(a);assert.equal(e.ms,ms,a);checks.push({action:a,ms:e.ms});}
 for(let speed=0;speed<=7;speed++){const e=cycle('mo',4000,{speed});assert.equal(e.ms,8*E.WALK_MS[speed]);}
 for(const [context,ms]of [['round',count('wi')*80],['scoreboard',quantize(count('wi')*70)]]){const e=cycle('wi',6000,{context});assert.equal(e.ms,ms,context);}
 for(let dir=0;dir<4;dir++)for(const action of ['st','mo','th','pu','pa','rui_st','rui_mo','msb_ch']){const e=new E.LabEngine(set,louie,{action,dir});for(let i=0;i<150;i++)e.step();assert(e.current().name.endsWith(E.DIRS[dir]),action);}
 for(const action of ['msb_ch','preview','face']){const e=new E.LabEngine(set,louie,{action});for(let i=0;i<100;i++)e.step();assert.equal(e.p.frame,0);assert.equal(e.ms,0);}
 for(const check of checks){const timings=E.measureTimings(set,louie,{action:check.action});assert.equal(timings.ms,check.ms,check.action+' timeline');assert.equal(timings.frames.reduce((a,b)=>a+b,0),check.ms,check.action+' exposure sum');}
 assert.equal(E.measureTimings(set,louie,{action:'dd'}).frames.at(-1),0,'Final death frame must never be exposed');
 const rects=[],ctx={putImageData(){},save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},setLineDash(){},strokeRect(...r){rects.push(r);}},canvas={style:{},getContext(){return ctx;}};
 const probe=new E.LabEngine(set,louie,{action:'st'});
 E.paint(probe,canvas,{effects:false,guides:true,zoom:1});
 assert(rects.some(r=>JSON.stringify(r)==='[0.5,0.5,255,255]'),'Real 256 canvas outline');
 assert(!rects.some(r=>r[0]===80.5),'Recommended area is off by default');
 rects.length=0;E.paint(probe,canvas,{effects:false,guides:false,safeArea:true,zoom:1});assert.deepEqual(rects,[[80.5,88.5,96,128]],'Optional recommendation overlay');
 rects.length=0;E.paint(new E.LabEngine(set,louie,{action:'face'}),canvas,{effects:false,guides:true,safeArea:true,zoom:1});assert.deepEqual(rects,[[108.5,108.5,39,39]],'Face native canvas is only40x40');
 const report={passed:true,scope:'Original ESM graph / deterministic20ms unit tests, not a browser gameplay test',checks,allSpeedLevels:true,allDirections:true,staticOnlyFrame0:true,frameGuides:true,modules:mods.size};
 fs.writeFileSync(path.join(__dirname,'resultado_motor.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
