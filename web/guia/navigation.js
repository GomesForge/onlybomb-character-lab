// Presentation-only addition; the guide text and its embedded attachments stay intact.
const toc=document.querySelector('nav.toc');
const sidebar=toc;
let scheduled=false;
function followSection(){
 scheduled=false;
 const link=toc?.querySelector('li.ativo a');
 if(!link||!sidebar||!sidebar.clientHeight)return;
 const row=link.getBoundingClientRect(),box=sidebar.getBoundingClientRect(),pad=24;
 // Scroll only this sidebar, and only when the current section leaves its viewport.
 if(row.bottom>box.bottom-pad)sidebar.scrollTop+=row.bottom-(box.bottom-pad);
 else if(row.top<box.top+pad)sidebar.scrollTop-=box.top+pad-row.top;
}
function schedule(){if(!scheduled){scheduled=true;requestAnimationFrame(followSection);}}
if(toc&&sidebar){
 new MutationObserver(schedule).observe(toc,{subtree:true,attributes:true,attributeFilter:['class']});
 window.addEventListener('resize',schedule,{passive:true});schedule();
}
