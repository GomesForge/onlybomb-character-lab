// Read-only mirror of Player.drawBody/drawCart selection, not animation timing.
export function playerSheet(p){
 if(!p?.set)return null;
 const dirs=['s','w','n','e'],dir=dirs[p.dir];
 if(p.inCart)return 'msb_ch_'+dirs[p.cartSide]+'.gra';
 if(p.state===8)return null;
 if(p.hasMount&&!p.dismountBlink&&p.louie){
  if(p.state===6)return 'wi.gra';
  return (p.state===0?'rui_mo_':'rui_st_')+dir+'.gra';
 }
 if(p.dismountBlink||p.reviveBlink)return p.state===6?'wi.gra':(p.state===0?'mo_':'st_')+dir+'.gra';
 const action=['mo_','st_','th_','pu_','pa_','dd','wi','wa'][p.state];
 return action? action+(action.endsWith('_')?dir:'')+'.gra':null;
}
export class AnimationTrace{
 constructor(){this.reset();}
 reset(){this.current=null;this.previous=null;}
 observe(file){
  if(file===this.current)return false;
  this.previous=this.current;this.current=file;return true;
 }
}
