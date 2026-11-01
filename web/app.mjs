import { loadAssets } from './js/game/assets.js';
import { CHARACTERS, CHARACTER_COUNT, characterSet, louieSets } from './js/game/characters.js';
import { importPack } from './pack.mjs';
import { Sprite } from './js/assets/spr.js';
import { Runs } from './js/game/fb565.js';
import { Match } from './js/game/match.js';
import { Training } from './js/game/training.js';
import { settings, stopAll } from './js/game/sound.js';
import { display } from './js/game/display.js';
import { Screen } from './js/game/screen.js';
import { LabEngine, paint, drawRuns, bbox, measureTimings, DIRS, NAMES, INDEX, sheetName, WALK_MS } from './engine.mjs';
const $=id=>document.getElementById(id);
const state={view:'lab',action:'st',dir:0,speed:4,context:'round',warp:'entry',mount:0,playing:true,ready:false,epoch:0,diagnostics:[],errors:[]};
const library=new Map();let selected,reference,engine,refEngine,louie,match,training,report,last=0,acc=0,repeatAt=0,seenFrame='';
let resources;const empty=new Runs([new Int32Array()],new Uint16Array(),256,256);
async function ensureResources(){if(!resources)resources=Promise.all([loadAssets(),louieSets()]).then(([,l])=>{louie=l;}).catch(e=>{resources=null;throw e;});return resources;}
function enableSubject(yes){for(const el of document.querySelectorAll('#view-lab button, #view-lab select, #view-lab input, #view-seams select, #view-training button, #reload, #export-report, #character, #reference, #compare'))el.disabled=!yes;}
function status(s){$('status').textContent=s;}
function error(e){const s=e?.message||String(e);state.errors.push(s);status('Falha: '+s);console.error(e);postResults();}
window.addEventListener('error',e=>error(e.error||e.message));window.addEventListener('unhandledrejection',e=>error(e.reason));
function register(entry){
 library.set(entry.id,entry);const opt=new Option(entry.name,entry.id);$('custom-group').append(opt);return entry;
}
function options(){return {action:state.action,dir:state.dir,speed:state.speed,context:state.context,warp:state.warp,mount:state.mount};}
async function loadEntry(entry,force=false){
 if(entry.set&&!force)return entry;
 if(entry.native){entry.set=await characterSet(entry.look);entry.report=nativeReport(entry);}
 else{
  const map=entry.report.sheets;
  // Read only structurally valid files. Missing files stay visibly empty; never substitute White.
  entry.set=await Promise.all(NAMES.map(async n=>{
   if(!map[n])return empty;
   const bytes=entry.files.get(n+'.gra');return Runs.fromSprite(new Sprite(n,bytes.slice().buffer));
  }));
 }
 return entry;
}
function nativeReport(entry){const sheets={};NAMES.forEach((n,i)=>{const r=entry.set[i];sheets[n]={file:n+'.gra',frames:r.n,w:r.w,h:r.h,boxes:Array.from({length:r.n},(_,f)=>bbox(r,f)),issues:[]};});return {sheets,issues:[],files:37,frames:entry.set.reduce((s,r)=>s+r.n,0),valid:true,native:true,note:'Referência nativa carregada pelo decodificador/tinta originais.'};}
async function selectCharacter(id,force=false){
 const token=++state.epoch;stopTraining();status('Carregando personagem…');const entry=library.get(id);if(!entry)throw Error('Personagem desconhecido');await ensureResources();await loadEntry(entry,force);if(token!==state.epoch)return;
 selected=entry;report=entry.report;$('subject-name').textContent=entry.name;$('pack-info').textContent=`${report.files}/37 folhas · ${report.frames} quadros${entry.native?' · oficial':' · projeto / importação local'}`;
 enableSubject(true);$('start-training').disabled=!report.valid;$('empty-state').hidden=true;$('sprite').hidden=false;
 if(match?.world?.me){match.world.me.set=entry.set;match.world.me.look=entry.look;}
 resetLab();renderValidation();drawSeam();status(report.valid?'Pronto. Ritmo e renderização do cliente original.':'Há erros no pacote. Inspeção disponível; corrija os arquivos antes do treino.');
 await browserSelfTest();
}
async function selectReference(){if(!selected||!$('compare').checked)return;reference=await loadEntry(library.get($('reference').value));resetLab();}
function resetLab(){
 if(!selected)return;engine=new LabEngine(selected.set,louie,options());refEngine=reference?new LabEngine(reference.set,louie,options()):null;last=0;acc=0;repeatAt=0;seenFrame='';state.playing=true;$('play').textContent='Pausar';
 $('warp-control').hidden=state.action!=='wa';document.querySelectorAll('[data-dir]').forEach(b=>b.classList.toggle('active',+b.dataset.dir===state.dir));
 const n=engine.frames();$('scrub').max=n-1;$('scrub').value=0;buildFilmstrip();clockNote();draw();
}
function clockNote(){
 const a=state.action,n=engine.frames();let note='';
 if(a==='st'||a==='rui_st')note='Repouso: quadro0 por240ms; demais por120ms. O índice também controla o Louie.';
 if(a==='mo'||a==='rui_mo')note=`Caminhada: ${WALK_MS[state.speed]}ms/quadro · ${n*WALK_MS[state.speed]}ms/ciclo. O deslocamento do jogador é testado na aba Treino.`;
 if(a==='th')note=`Arremesso: quadro0 dobrado; ${(n+1)*60}ms antes de retornar ao repouso. Bloqueia movimento no jogo.`;
 if(a==='pu')note=`Golpe: quadro0 dobrado; média ${(n+1)*70}ms. O motor alterna passos de60/80ms. Bloqueia movimento no jogo.`;
 if(a==='pa')note='Atordoado: média50ms/quadro (passos de60/40ms). Aqui o ciclo se repete para inspeção; no treino dura1segundo.';
 if(a==='dd')note='Derrota: quadro0 por cerca de210ms; demais70ms; o último quadro tem exposição ZERO. O motor original define quando o personagem desaparece.';
 if(a==='wi')note=`Vitória: ${state.context==='round'?'80ms/quadro no fim da rodada':'média70ms/quadro no placar'} · loop conforme contagem real.`;
 if(a==='wa')note=`Entrada/teleporte: ${n}×40ms=${n*40}ms por sentido. Entrada toca do último ao0; READY/GO completo está no treino.`;
 if(['msb_ch','preview','face'].includes(a))note='O jogo usa somente o quadro0 nesta situação. Inspecionar outros quadros não muda esse comportamento.';
 $('clock-note').textContent=note;
}
function buildFilmstrip(){
 const n=sheetName(state.action,state.dir),r=selected.set[INDEX[n]],fragment=document.createDocumentFragment();
 const timings=measureTimings(selected.set,louie,options());
 for(let f=0;f<r.n;f++){
  const b=document.createElement('button'),c=document.createElement('canvas'),t=document.createElement('span');c.width=112;c.height=128;drawRuns(r,f,c,{crop:true});t.textContent=`#${f} · ${timings.static?(f===0?'estático':'não usado'):timings.frames[f]+' ms'}`;b.append(c,t);b.onclick=()=>seek(f);b.dataset.frame=f;fragment.append(b);
 }
 $('filmstrip').replaceChildren(fragment);
}
function seek(f){state.playing=false;$('play').textContent='Reproduzir';engine.seek(f);refEngine?.seek(Math.min(f,refEngine.frames()-1));$('scrub').value=f;draw();}
function draw(){
 if(!engine)return;const opts={effects:$('effects').checked,guides:$('guides').checked,zoom:+$('zoom').value};paint(engine,$('sprite'),opts);
 const c=engine.current(),r=selected.set[INDEX[c.name]],box=bbox(r,c.frame);$('frame-info').textContent=`${c.name}.gra · quadro${c.frame}/${r.n-1} · ${engine.ms}ms${engine.done?' · ação concluída':''}\ncaixa: ${box?.join(', ')||'vazio'}${box?' · '+(box[2]-box[0])+'×'+(box[3]-box[1])+'px':''}`;
 $('scrub-label').value=`${engine.p.frame} / ${engine.frames()-1}`;
 if(state.playing)$('scrub').value=Math.min(engine.frames()-1,engine.p.frame);
 $('reference-stage').hidden=!$('compare').checked;
 if(refEngine&&$('compare').checked){paint(refEngine,$('reference-canvas'),opts);const rc=refEngine.current();$('reference-info').textContent=`${reference.name} · ${rc.name}.gra · quadro${rc.frame} · ${refEngine.ms}ms`;}
 const key=c.name+':'+c.frame;if(key!==seenFrame){$('filmstrip').querySelectorAll('button').forEach(b=>b.classList.toggle('selected',+b.dataset.frame===c.frame));seenFrame=key;}
}
function frame(now){
 requestAnimationFrame(frame);if(!state.ready||!engine)return;
 if(state.view==='lab'){
  if(state.playing){if(!last)last=now;acc+=Math.min(250,now-last);last=now;
   while(acc>=20){engine.step();refEngine?.step();acc-=20;}
   if(engine.done&&$('auto-repeat').checked){if(!repeatAt)repeatAt=now+600;if(now>=repeatAt){engine.restart();refEngine?.restart();repeatAt=0;}}
   else if(engine.done){state.playing=false;$('play').textContent='Repetir';}
  }else{last=now;acc=0;}draw();
 }else if(state.view==='seams'&&$('seam-mode').value==='alternate')drawSeam(now);
 if(match?.world?.me&&state.view==='training'){
   const p=match.world.me;$('training-status').textContent=`${selected.name} · cena${match.scene} · estado${p.state} · direção${DIRS[p.dir]} · quadro${p.frame} · velocidade${p.speedLvl} · ${p.hasMount?'Louie'+p.mount:'sem montaria'} · tile${p.tx},${p.ty} · bombas${match.world.bombs.length}`;
 }
}
document.addEventListener('visibilitychange',()=>{last=0;acc=0;});
function renderValidation(){
 if(!report)return;const issues=report.issues,errors=issues.filter(i=>i.level==='error').length,warnings=issues.filter(i=>i.level==='warning').length;
 $('validation-summary').replaceChildren(...[`${report.files}/37 folhas`,`${report.frames} quadros`,`${errors} erros`,`${warnings} avisos`].map((s,i)=>{const e=document.createElement('span');e.className='tag '+(i===2&&errors?'error':i===3&&warnings?'warning':'ok');e.textContent=s;return e;}));
 $('issues').replaceChildren(...issues.map(i=>{const d=document.createElement('div');d.className='issue '+i.level;d.textContent=`${i.file||''}: ${i.text}`;return d;}));
 $('sheet-table').replaceChildren(...NAMES.map(n=>{const s=report.sheets[n],tr=document.createElement('tr');const values=[n+'.gra',s?.frames??'—',s?`${s.w}×${s.h}`:'—',s?.boxes?.[0]?.join(', ')||'—',s?(s.issues.length?'Conferir':'Lido'):'Ausente / inválido'];for(const v of values){const td=document.createElement('td');td.textContent=v;tr.append(td);}tr.onclick=()=>{const i=NAMES.indexOf(n);state.action=n.startsWith('rui_mo')?'rui_mo':n.startsWith('rui_st')?'rui_st':n.startsWith('msb_ch')?'msb_ch':n.split('_')[0];if(i<20)state.dir=i%4;else if(i>=23&&i<=34)state.dir=(i-23)%4;$('action').value=state.action;setView('lab');resetLab();};return tr;}));
}
function drawSeam(now=0){
 if(!selected)return;const [l,r]=$('seam').value.split(',').map(s=>{const [n,f]=s.split(':');const run=selected.set[INDEX[n]];return {n,run,f:+f<0?run.n+(+f):+f};});
 const canvas=$('seam-canvas'),ctx=canvas.getContext('2d'),mode=$('seam-mode').value;canvas.width=mode==='side'?512:256;canvas.height=256;ctx.fillStyle='#15202b';ctx.fillRect(0,0,canvas.width,256);ctx.imageSmoothingEnabled=false;
 function one(x,dx,alpha=1){const c=document.createElement('canvas');c.width=c.height=256;drawRuns(x.run,x.f,c);ctx.globalAlpha=alpha;ctx.drawImage(c,dx,0);ctx.globalAlpha=1;}
 if(mode==='side'){one(l,0);one(r,256);}else if(mode==='overlay'){one(l,0);one(r,0,.5);}else one(Math.floor(now/800)%2?l:r,0);
 ctx.strokeStyle='#68b7ff88';[128,...(mode==='side'?[384]:[])].forEach(x=>{ctx.beginPath();ctx.moveTo(x+.5,70);ctx.lineTo(x+.5,225);ctx.stroke();});ctx.strokeStyle='#8de0ad88';ctx.beginPath();ctx.moveTo(70,195.5);ctx.lineTo(canvas.width-70,195.5);ctx.stroke();
 $('seam-info').textContent=`${l.n}[${l.f}] · caixa${bbox(l.run,l.f)?.join(', ')} → ${r.n}[${r.f}] · caixa${bbox(r.run,r.f)?.join(', ')}${mode==='alternate'?' · alternância lenta só para inspeção':''}`;
}
function setView(view){
 if(state.view==='training'&&view!=='training'){expandArena(false);stopTraining();}state.view=view;last=0;acc=0;document.body.classList.toggle('training-view',view==='training');
 document.querySelectorAll('.view').forEach(e=>e.hidden=e.id!=='view-'+view);document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
 if(view==='seams')drawSeam();if(view==='lab')draw();if(view==='training')requestAnimationFrame(fitTrainingCanvas);
}
function fitTrainingCanvas(){
 const arena=$('arena'),canvas=$('game-canvas');if(state.view!=='training'||!arena.clientWidth||!arena.clientHeight)return;
 const ratio=match?.screen?match.screen.srcW/match.screen.srcH:4/3;
 const w=Math.floor(Math.min(arena.clientWidth,arena.clientHeight*ratio)),h=Math.floor(w/ratio);
 canvas.style.width=w+'px';canvas.style.height=h+'px';
 $('render-info').textContent=`800×600 nativo · ${w}×${h} na tela`;
}
function expandArena(on){
 if(!on&&document.fullscreenElement===$('play-surface'))document.exitFullscreen().catch(()=>{});
 $('play-surface').classList.toggle('expanded',on);document.body.classList.toggle('arena-expanded',on);$('expand-arena').textContent=on?'Voltar ao laboratório':'Ampliar arena';$('expand-arena').setAttribute('aria-pressed',String(on));requestAnimationFrame(fitTrainingCanvas);if(match)$('game-canvas').focus();
}
function changeTrainingFilter(){
 display.filter=$('render-filter').value;
 if(match?.loaded){match.screen.dispose();match.screen=new Screen(match.canvas);match.sizeScreen();match.fitFrame();fitTrainingCanvas();}
}
async function startTraining(){
 if(!selected||!report.valid)return;stopTraining();status('Carregando arena do cliente original…');
 expandArena(false);
 display.sideArt=false;display.lite=false;display.smooth=$('fluid-motion').checked;display.filter=$('render-filter').value;settings.bgm=settings.sfx=$('audio').checked;
 const s={myId:1,users:new Map([[1,{nick:'TesteLocal',cls:0}]]),outfit:{wearing:false,look:selected.look},wallet:{bomb:0},belts:[],beltOf:()=>0,superBroadcast:null};
 training=new Training(s,{map:+$('map').value,bots:+$('bots').value,blocks:$('blocks').checked,full:true,items:8191});
 match=new Match(training.sessionFor(),$('game-canvas'),null);training.onEnd=()=>{stopTraining();status('Treino encerrado.');};
 const instance=match;
 try{await instance.start();if(match!==instance||instance.stopped)return;match.world.me.set=selected.set;state.diagnostics.push({type:'training-start',character:selected.name,map:+$('map').value,bots:+$('bots').value,date:new Date().toISOString()});
  // Observe requests and states without changing their handling or their clocks.
  const send=training.conn.sendGame.bind(training.conn);training.conn.sendGame=raw=>{state.diagnostics.push({type:'training-request',opcode:raw[0],ms:instance.world.clock});send(raw);postResults();};
  const update=instance.update.bind(instance);let lastSample=0;
  instance.update=dt=>{update(dt);if(instance.world.clock-lastSample>=200){lastSample=instance.world.clock;const p=instance.world.me;state.diagnostics.push({type:'training-sample',ms:lastSample,state:p.state,frame:p.frame,dir:p.dir,tile:[p.tx,p.ty],bombs:instance.world.bombs.length});if(state.diagnostics.length>1500)state.diagnostics.splice(0,1);}};
  const nextRound=instance.nextRound.bind(instance);instance.nextRound=(...args)=>{if(instance.labVictory){instance.labVictory=false;setTimeout(()=>{if(match===instance)diagnostic('reset');},0);return;}nextRound(...args);};
  fitTrainingCanvas();$('game-canvas').focus();status('Treino ativo. Clique na arena e use as setas, espaço e Z.');postResults();}catch(e){if(match===instance)stopTraining();throw e;}
}
function stopTraining(){if(match){match.stop();match=null;training=null;postResults();}$('training-status').textContent='Treino encerrado.';status('Treino encerrado. O laboratório de animações está disponível.');stopAll();}
function diagnostic(kind){
 if(!match)return status('Inicie o treino primeiro.');const p=match.world.me;
 state.diagnostics.push({type:'forced-state',action:kind,character:selected.name,date:new Date().toISOString()});
 if(kind==='entry'){match.phase=0;match.hud.resetRound();for(const actor of match.world.players){actor.resetStats(match.mapSet);actor.spawnAt(actor.tx,actor.ty);if(training.full)actor.fullItems();}match.world.roundStart();match.setScene(5);}
 else if(kind==='reset'){p.spawnAt(p.tx,p.ty);p.resetStats(match.mapSet);p.fullItems();match.phase=0;match.setScene(6);match.input.clear();}
 else if(kind==='mount'){match.phase=0;match.scene=6;p.out=false;p.active=true;p.inCart=false;p.stunned=false;p.hasMount=true;p.mount=+$('mount-color').value;p.state=1;p.frame=0;}
 else if(kind==='dismount'){match.phase=0;match.scene=6;p.out=false;p.active=true;p.inCart=false;p.stunned=false;p.hasMount=false;p.mount=-1;p.state=1;p.frame=0;}
 else if(kind==='cart'){match.phase=0;match.scene=6;p.hasMount=false;p.out=true;p.state=8;p.inCart=true;p.cartSet(0,2);p.cartSide=3;}
 else{
  match.phase=0;match.scene=6;p.hasMount=false;p.inCart=false;p.out=false;p.active=true;p.wonThisRound=0;p.stateT=0;p.frame=0;p.frame2=0;p.hold=0;p.introRise=false;p.stunned=false;
  if(kind==='stun'){p.state=4;p.stunned=true;p.stunT=0;}
  if(kind==='throw')p.state=2;
  if(kind==='punch')p.state=3;
  if(kind==='death'){p.state=5;p.hitReported=true;}
  if(kind==='victory'){p.state=6;p.wonThisRound=1;match.phase=1;match.hud.poseAcc=0;match.hud.poseTotal=0;match.labVictory=true;}
 }
 match.canvas.focus();postResults();
}
async function importFiles(list){
 if(!list.length)return;status('Lendo e validando arquivos neste navegador…');$('choose-files').disabled=$('choose-folder').disabled=true;
 try{const entry=await importPack(list);register(entry);$('character').value=entry.id;await selectCharacter(entry.id);}finally{$('choose-files').disabled=$('choose-folder').disabled=false;$('files').value=$('folder').value='';}
}
function download(name,data){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function postResults(){return Promise.resolve();} // Reports stay in this tab; explicit download only.
async function browserSelfTest(){
 const tests=[];for(const action of ['st','mo','th','pu','pa','dd','wi','wa','rui_st','rui_mo','msb_ch','preview','face']){
  const dirs=['dd','wi','wa','preview','face'].includes(action)?[0]:[0,1,2,3];
  for(const dir of dirs){const e=new LabEngine(selected.set,louie,{...options(),action,dir});const canvas=document.createElement('canvas');canvas.width=canvas.height=256;paint(e,canvas,{guides:false,effects:true,zoom:1});for(let i=0;i<150;i++)e.step();paint(e,canvas,{guides:false,effects:true,zoom:1});tests.push({sheet:sheetName(action,dir),frames:e.frames(),clockAdvanced:true,rendered:true});}
 }
 state.diagnostics.push({type:'browser-render-and-clock-smoke',character:selected.name,tests,scope:'Every sheet decoded, rendered with originalFB and clock-stepped. Does not prove visual quality or completed gameplay.'});await postResults();
}
function bind(){
 $('expand-arena').onclick=()=>expandArena(!$('play-surface').classList.contains('expanded'));
 $('fullscreen-arena').onclick=async()=>{expandArena(true);try{if(!document.fullscreenElement)await $('play-surface').requestFullscreen();else await document.exitFullscreen();}catch{status('Arena ampliada nesta janela. Use F11 no navegador para ocupar a tela inteira.');}};
 $('render-filter').onchange=()=>{changeTrainingFilter();if(match)$('game-canvas').focus();};$('fluid-motion').onchange=()=>{display.smooth=$('fluid-motion').checked;if(match)$('game-canvas').focus();};
 document.addEventListener('fullscreenchange',()=>{expandArena(!!document.fullscreenElement);});
 window.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('play-surface').classList.contains('expanded')){e.preventDefault();e.stopImmediatePropagation();expandArena(false);}},true);
 new ResizeObserver(fitTrainingCanvas).observe($('arena'));
 document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>setView(b.dataset.view));document.querySelectorAll('[data-dir]').forEach(b=>b.onclick=()=>{state.dir=+b.dataset.dir;resetLab();});
 $('character').onchange=()=>selectCharacter($('character').value).catch(error);$('reference').onchange=()=>selectReference().catch(error);
 $('reload').onclick=()=>selectCharacter($('character').value,true).catch(error);
 $('action').onchange=()=>{state.action=$('action').value;resetLab();};$('speed').onchange=()=>{state.speed=+$('speed').value;resetLab();if(match)match.world.me.speedLvl=state.speed;};$('victory-context').onchange=()=>{state.context=$('victory-context').value;resetLab();};$('warp').onchange=()=>{state.warp=$('warp').value;resetLab();};$('mount-color').onchange=()=>{state.mount=+$('mount-color').value;resetLab();if(match&&match.world.me.hasMount)match.world.me.mount=state.mount;};
 for(const id of ['zoom','guides','effects'])$(id).onchange=draw;
 $('compare').onchange=()=>{if($('compare').checked)selectReference().catch(error);else draw();};
 $('play').onclick=()=>{if(engine.done&& !state.playing){engine.restart();refEngine?.restart();acc=0;repeatAt=0;}state.playing=!state.playing;$('play').textContent=state.playing?'Pausar':'Reproduzir';last=0;};$('restart').onclick=resetLab;
 $('prev').onclick=()=>seek((engine.p.frame+engine.frames()-1)%engine.frames());$('next').onclick=()=>seek((engine.p.frame+1)%engine.frames());$('scrub').oninput=()=>seek(+$('scrub').value);
 $('seam').onchange=()=>drawSeam();$('seam-mode').onchange=()=>drawSeam();$('start-training').onclick=()=>startTraining().catch(error);$('stop-training').onclick=stopTraining;
 document.querySelectorAll('[data-test]').forEach(b=>b.onclick=()=>{try{diagnostic(b.dataset.test);}catch(e){error(e);}});
 $('choose-files').onclick=()=>$('files').click();$('choose-folder').onclick=()=>$('folder').click();for(const id of ['files','folder'])$(id).onchange=()=>importFiles([...$(id).files]).catch(error);
 const drop=$('dropzone');drop.ondragover=e=>{e.preventDefault();drop.classList.add('over');};drop.ondragleave=()=>drop.classList.remove('over');drop.ondrop=e=>{e.preventDefault();drop.classList.remove('over');importFiles([...e.dataTransfer.files]).catch(error);};
 $('export-report').onclick=()=>download('validacao-personagem.json',{character:selected?.name,report,diagnostics:state.diagnostics});
}
async function boot(){
 bind();display.sideArt=false;settings.bgm=settings.sfx=false;
 const custom=document.createElement('optgroup');custom.label='Importados nesta sessão';custom.id='custom-group';
 const placeholder=new Option('Importe um personagem para começar','',true,true);placeholder.disabled=true;$('character').append(placeholder,custom);
 for(let i=0;i<CHARACTER_COUNT;i++){const entry={id:'native-'+i,name:CHARACTERS[i][2],native:true,look:i};library.set(entry.id,entry);$('reference').append(new Option(entry.name,entry.id));}
 enableSubject(false);$('sprite').hidden=true;status('Importe um personagem para começar. Nenhum arquivo é enviado ao servidor.');state.ready=true;requestAnimationFrame(frame);
 window.characterLab={state,library,get engine(){return engine;},get match(){return match;}};
}
boot().catch(error);
