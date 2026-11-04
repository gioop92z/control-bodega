/* VANTIS CINEMA — original real-time opening film, no third-party assets. */
const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const DURATION=4600;
let started=false;
function playVantisOpening(){
  if(started||document.getElementById('vantisCinema'))return;
  started=true;
  const root=document.createElement('section');
  root.id='vantisCinema';
  root.className='vantis-cinema';
  root.setAttribute('role','dialog');
  root.setAttribute('aria-label','Animación de inicio VANTIS');
  root.innerHTML='<canvas id="vantisCinemaCanvas" aria-hidden="true"></canvas><div class="vantis-cinema-brand"><span class="vantis-cinema-eyebrow">SISTEMA OPERATIVO DE BODEGA</span><strong>VANTIS</strong><span class="vantis-cinema-subtitle">PRECISIÓN EN CADA MOVIMIENTO</span></div><span class="vantis-cinema-version">LIVERPOOL · OPERACIONES</span><button type="button" class="vantis-cinema-skip">Omitir intro <span aria-hidden="true">›</span></button>';
  document.body.appendChild(root);
  const canvas=root.querySelector('canvas');
  const ctx=canvas.getContext('2d',{alpha:false});
  let raf=0,stopped=false,startedAt=performance.now();
  let w=0,h=0,dpr=1;
  function resize(){
    dpr=Math.min(devicePixelRatio||1,2);w=innerWidth;h=innerHeight;
    canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  resize();window.addEventListener('resize',resize);
  const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
  const ease=x=>1-Math.pow(1-clamp(x),3);
  function render(now){
    if(stopped)return;
    const t=(now-startedAt)/1000;
    ctx.fillStyle='#090910';ctx.fillRect(0,0,w,h);
    const cx=w/2,cy=h/2;
    const glow=ctx.createRadialGradient(cx,cy,0,cx,cy,Math.max(w,h)*.64);
    glow.addColorStop(0,'#311326');glow.addColorStop(.35,'#170e1c');glow.addColorStop(1,'#090910');
    ctx.fillStyle=glow;ctx.fillRect(0,0,w,h);
    // A dimensional energy horizon opens and settles into a precise brand mark.
    const power=ease((t-.25)/1.45),settle=ease((t-2.25)/1.2);
    ctx.save();ctx.translate(cx,cy);ctx.rotate(-.23+settle*.23);
    for(let j=0;j<13;j++){
      const p=j/13,depth=(p+power*.72)%1;
      const r=12+Math.pow(depth,2)*Math.max(w,h)*.57;
      const alpha=Math.sin(depth*Math.PI)*power*(1-settle*.88);
      ctx.beginPath();ctx.ellipse(0,0,r*1.6,r*.47,0,0,Math.PI*2);
      ctx.strokeStyle='rgba(235,43,145,'+(alpha*.34)+')';
      ctx.lineWidth=.5+depth*1.8;ctx.stroke();
    }
    ctx.restore();
    const beam=ease((t-.45)/1.15)*(1-ease((t-2.35)/.7));
    if(beam>0){
      const line=ctx.createLinearGradient(cx-w*.47,cy,cx+w*.47,cy);
      line.addColorStop(0,'#e5007d00');line.addColorStop(.5,'#f3d4e7');line.addColorStop(1,'#e5007d00');
      ctx.globalAlpha=beam;ctx.fillStyle=line;ctx.fillRect(cx-w*.47,cy-1,w*.94,2);
      ctx.globalAlpha=1;
    }
    // Individual points coalesce into a precise orbital insignia.
    const formation=ease((t-1.1)/1.35),opacity=formation*(1-ease((t-3.6)/.8));
    for(let i=0;i<76;i++){
      const a=i*2.399963229728653;
      const orbit=45+(i%9)*6,scatter=(1-formation)*(160+(i%11)*23);
      const x=cx+Math.cos(a)*(orbit+scatter);
      const y=cy+Math.sin(a)*(orbit*.62+scatter*.9);
      ctx.fillStyle='rgba(244,127,194,'+(opacity*(.28+(i%4)*.16))+')';
      ctx.beginPath();ctx.arc(x,y,(i%5===0?1.5:.8),0,Math.PI*2);ctx.fill();
    }
    const ring=ease((t-1.65)/.9)*(1-ease((t-3.25)/.8));
    if(ring){
      ctx.beginPath();ctx.ellipse(cx,cy,86,50,0,0,Math.PI*2);
      ctx.strokeStyle='rgba(244,83,173,'+(ring*.45)+')';ctx.lineWidth=1;ctx.stroke();
    }
    if(t< DURATION/1000){raf=requestAnimationFrame(render)}else close();
  }
  function close(){
    if(stopped)return;stopped=true;cancelAnimationFrame(raf);
    window.removeEventListener('resize',resize);
    root.classList.add('vantis-cinema-out');
    setTimeout(()=>root.remove(),440);
  }
  root.querySelector('button').addEventListener('click',close);
  if(reduced){close();return}
  raf=requestAnimationFrame(render);
}
function check(){
  // Show on each fresh opening, before login, without blocking subsequent operations.
  if(document.body&&document.getElementById('app'))playVantisOpening();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',check,{once:true});else check();
