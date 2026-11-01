// Laboratory adapter. Animation stepping and rasterization remain in the original modules.
import { Player } from './js/game/player.js';
import { Hud } from './js/game/hud.js';
import { FB, rgb565 } from './js/game/fb565.js';
import { A } from './js/game/assets.js';
export const DIRS=['s','w','n','e'];
export const NAMES=['mo','st','th','pa','pu'].flatMap(a=>DIRS.map(d=>a+'_'+d)).concat(['dd','wi','wa'],['msb_ch','rui_mo','rui_st'].flatMap(a=>DIRS.map(d=>a+'_'+d)),['preview','face']);
export const INDEX=Object.fromEntries(NAMES.map((n,i)=>[n,i]));
export const WALK_MS=[100,80,80,80,60,60,60,40];
const STATES={mo:0,st:1,th:2,pu:3,pa:4,dd:5,wi:6,wa:7,rui_mo:0,rui_st:1};
export function sheetName(action,dir){return ['dd','wi','wa','preview','face'].includes(action)?action:action+'_'+DIRS[dir];}
export class LabEngine {
 constructor(set,louie,{action='st',dir=0,speed=4,context='round',warp='entry',mount=0}={}){
  Object.assign(this,{set,louie,action,dir,speed,context,warp,mount});this.restart();
 }
 restart(){
  this.world={match:{myId:1,phase:0,scene:6,rules:[1,0,0,0,0]},mapSet:1,mode:0,gimmicks:{warps:[]},me:null,sendMove(){},tile(){return 0;}};
  const p=new Player(this.world,{id:2,nick:'Teste',team:-1,cls:0,char:0,look:0,guild:''},0);
  p.set=this.set;p.louie=this.louie;p.local=false;p.state=STATES[this.action]??1;p.dir=this.dir;p.X=82;p.Y=108;p.ox=p.oy=0;p.recompute();p.speedLvl=this.speed;p.hasMount=this.action.startsWith('rui_');p.mount=this.mount;p.jumpH=0;p.active=true;p.out=false;
  p.cartX=82;p.cartY=108;p.cartSide=this.dir;p.cox=p.coy=0;
  if(this.action==='wa'){p.introRise=this.warp==='entry';p.frame=p.introRise?Math.max(0,this.frames()-1):0;}
  this.p=p;this.ms=0;this.done=false;this.trace=[];this.lastKey='';this.manual=false;
  // The HUD methods below need their world/player plus accumulators. No DOM or network constructor is run.
  this.hud={match:{world:{players:[p]}},poseAcc:0,poseTotal:0,resTimer:0,animT:0,cupAcc:0,cupFrame:0,cupCycles:0,resultState:3,enterResults(){this.poseTotal=0;}};
  if(this.action==='wi')p.wonThisRound=1;
  this.record();return this;
 }
 frames(){return this.set[INDEX[sheetName(this.action,this.dir)]]?.n||1;}
 record(){const k=this.p.state+':'+this.p.frame;if(k!==this.lastKey){this.trace.push({ms:this.ms,state:this.p.state,frame:this.p.frame});this.lastKey=k;}}
 step(){
  if(this.done||['face','preview','msb_ch'].includes(this.action))return;
  const p=this.p;this.manual=false;this.ms+=20;
  if(this.action==='wi'){
   if(this.context==='round')Hud.prototype.roundEndUpdate.call(this.hud,20);
   else{this.hud.resTimer=0;Hud.prototype.resultUpdate.call(this.hud,20);}
  }else if(this.action==='wa'&&this.warp==='out'){
   // One disappearance only: the real warp would then reappear at its destination.
   if(this.ms>=this.frames()*40){this.done=true;this.record();return;}
   p.walkClock(20);p.animate(20);
  }else{
   p.walkClock(20);p.animate(20);
   if(this.action==='wa'&&this.warp==='entry'&&this.ms>=this.frames()*40){p.state=1;p.frame=0;p.introRise=false;this.done=true;}
   if((this.action==='th'&&p.state!==2)||(this.action==='pu'&&p.state!==3)||(this.action==='dd'&&p.state!==5))this.done=true;
   // Standalone stun preview repeats; the Training tab uses the real1000ms stun timer.
  }
  this.record();
 }
 seek(i){this.restart();this.manual=true;this.p.frame=Math.min(this.frames()-1,Math.max(0,i));this.p.frame2=this.p.frame;this.ms=0;this.done=false;}
 current(){
  if(this.manual)return {name:sheetName(this.action,this.dir),frame:this.p.frame};
  if(['face','preview','msb_ch'].includes(this.action))return {name:sheetName(this.action,this.dir),frame:0};
  if(this.action.startsWith('rui_'))return {name:sheetName(this.action,this.dir),frame:this.p.frame};
  const a=['mo','st','th','pu','pa','dd','wi','wa'][this.p.state];
  return {name:a?sheetName(a,this.dir):'dd',frame:Math.min(this.set[INDEX[a?sheetName(a,this.dir):'dd']]?.n-1||0,this.p.frame)};
 }
}

export function measureTimings(set,louie,options){
 const e=new LabEngine(set,louie,options),times=Array(e.frames()).fill(0),wanted=sheetName(e.action,e.dir);
 if(['face','preview','msb_ch'].includes(e.action))return {ms:0,frames:times,static:true};
 let moved=false;
 for(let guard=0;guard<1500;guard++){
  const c=e.current();if(c.name===wanted&&!e.done)times[Math.min(times.length-1,c.frame)]+=20;
  e.step();if(e.p.frame!==0)moved=true;
  if(e.done||moved&&e.p.frame===0&&['st','mo','pa','wi','rui_st','rui_mo'].includes(e.action))break;
 }
 return {ms:e.ms,frames:times,static:false};
}

// Original FB owns RGB565 blending, clipping, sprite layers and conversion to RGBA.
let framebuffer;
export function paint(engine,canvas,{effects=true,guides=true,safeArea=false,zoom=2}={}){
 const p=engine.p,action=engine.action;
 if(!framebuffer)framebuffer=new FB();
 const fb=framebuffer;fb.clear(rgb565(21,32,43));fb.hdBlits.length=0;
 if(action==='face')fb.opaque(engine.set[36],0,108,108);
 else if(action==='preview')fb.opaque(engine.set[35],0,0,0);
 else if(action==='msb_ch')p.drawCart(fb);
 else if(p.state!==8 || engine.manual){
  if(effects)p.drawShadow(fb);
  if(engine.manual&&!action.startsWith('rui_'))fb.opaque(engine.set[INDEX[sheetName(action,engine.dir)]],p.frame,0,0);
  else if(effects)p.drawBody(fb);
  else{
   if(p.hasMount){const L=p.louie[p.mount];fb.opaque(L[p.state===0?p.dir:4+p.dir],p.frame,0,0);}
   const current=engine.current();fb.opaque(engine.set[INDEX[current.name]],current.frame,0,0);
  }
 }
 const ctx=canvas.getContext('2d');fb.present(ctx);ctx.imageSmoothingEnabled=false;
 // These are overlays only: FB still uses the full native canvas. The amber
 // production recommendation is not a clipping rectangle or a GRA limit.
 if(guides){ctx.save();ctx.lineWidth=1;ctx.strokeStyle='#6db8ff';ctx.strokeRect(.5,.5,255,255);ctx.strokeStyle='#6db8ff88';ctx.beginPath();ctx.moveTo(128.5,1);ctx.lineTo(128.5,255);ctx.stroke();if(action==='face'){ctx.strokeRect(108.5,108.5,39,39);}else{ctx.strokeStyle='#a3d5a388';ctx.beginPath();ctx.moveTo(75,195.5);ctx.lineTo(180,195.5);ctx.stroke();ctx.strokeStyle='#ffffff44';ctx.strokeRect(108.5,162.5,39,37);}ctx.restore();}
 if(safeArea&&action!=='face'){ctx.save();ctx.lineWidth=1;ctx.setLineDash([3,3]);ctx.strokeStyle='#edbb5caa';ctx.strokeRect(80.5,88.5,96,128);ctx.restore();}
 canvas.style.width=canvas.style.height=(256*zoom)+'px';
}
export function drawRuns(r,index,canvas,{crop=false}={}){
 const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);if(!r)return;
 const img=ctx.createImageData(r.w,r.h),a=img.data,q=r.frame(index),px=r.px;
 for(let j=0;j<q.length;j+=4)for(let k=0;k<q[j+2];k++){
  const i=((q[j+1])*r.w+q[j]+k)*4,v=px[q[j+3]+k],rr=v>>11,g=(v>>5)&63,b=v&31;
  a[i]=(rr<<3)|(rr>>2);a[i+1]=(g<<2)|(g>>4);a[i+2]=(b<<3)|(b>>2);a[i+3]=255;
 }
 const scratch=document.createElement('canvas');scratch.width=r.w;scratch.height=r.h;scratch.getContext('2d').putImageData(img,0,0);ctx.imageSmoothingEnabled=false;
 if(crop&&r.w===256)ctx.drawImage(scratch,64,64,128,160,0,0,canvas.width,canvas.height);
 else ctx.drawImage(scratch,0,0,canvas.width,canvas.height);
}
export function bbox(r,f){if(!r)return null;const q=r.frame(f);let x0=Infinity,y0=Infinity,x1=0,y1=0;for(let i=0;i<q.length;i+=4){x0=Math.min(x0,q[i]);y0=Math.min(y0,q[i+1]);x1=Math.max(x1,q[i]+q[i+2]);y1=Math.max(y1,q[i+1]+1);}return x0===Infinity?null:[x0,y0,x1,y1];}
