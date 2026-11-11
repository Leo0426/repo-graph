'use strict';
// Checks visible HTML text on solid backgrounds; excludes SVG, gradients, translucency and disabled controls.
async function audit(page){return page.evaluate(()=>{
 const rgb=s=>(s.match(/[\d.]+/g)||[]).map(Number); const mix=(f,b)=>{let a=f[3]??1;return f.slice(0,3).map((x,i)=>x*a+b[i]*(1-a))};
 const lum=c=>c.slice(0,3).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4}).reduce((s,x,i)=>s+x*[.2126,.7152,.0722][i],0);
 const fail=[];let checked=0;
 for(const el of document.querySelectorAll('body *')) {
  if(![...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim().length>1)||el.closest('svg,script,style,[disabled]'))continue;
  // Closed native disclosures may retain layout boxes and stale computed styles despite not being painted.
  if(typeof el.checkVisibility==='function'&&!el.checkVisibility())continue;
  const r=el.getBoundingClientRect(),cs=getComputedStyle(el);if(!r.width||!r.height||r.bottom<0||r.top>innerHeight||cs.visibility==='hidden')continue;
  const ancestors=[];for(let p=el;p;p=p.parentElement)ancestors.unshift(p);
  if(ancestors.some(p=>Number(getComputedStyle(p).opacity)<.95||getComputedStyle(p).backgroundImage!=='none'))continue;
  let bg=[255,255,255];for(const p of ancestors) bg=mix(rgb(getComputedStyle(p).backgroundColor),bg);
  const fg=mix(rgb(cs.color),bg);const a=lum(fg),b=lum(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  const large=parseFloat(cs.fontSize)>=24||(parseFloat(cs.fontSize)>=18.66&&Number(cs.fontWeight)>=700);checked++;
  if(ratio<(large?3:4.5))fail.push({text:el.textContent.trim().slice(0,48),selector:el.id||el.className,color:cs.color,bg:bg.map(Math.round),ratio:+ratio.toFixed(2)});
 }
 return {checked,fail,overflow:document.documentElement.scrollWidth>innerWidth,panelOverflow:(()=>{const el=document.querySelector('.panel.active .panel-body');return el?el.scrollWidth>el.clientWidth+1:false})()};
});}

module.exports = audit;
