/* Touch / click "network roots" ripple — soft blue, professional */
(function(){
  const canvas = document.getElementById('touchNet');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  function resize(){ canvas.width = innerWidth; canvas.height = innerHeight; }
  addEventListener('resize', resize); resize();

  const bursts = []; // {x,y,age,nodes:[{x,y,vx,vy}]}

  function spawn(x, y){
    const count = 10 + Math.floor(Math.random()*4);
    const nodes = [];
    for(let i=0;i<count;i++){
      const a = (i/count)*Math.PI*2 + Math.random()*0.4;
      const s = 0.8 + Math.random()*1.6;
      nodes.push({x, y, vx:Math.cos(a)*s, vy:Math.sin(a)*s});
    }
    bursts.push({x, y, age:0, life:55, nodes});
    if(bursts.length>8) bursts.shift();
  }

  function onPointer(e){
    const t = (e.touches && e.touches[0]) || e;
    if(t && t.clientX!=null) spawn(t.clientX, t.clientY);
  }
  addEventListener('pointerdown', onPointer, {passive:true});
  addEventListener('touchstart', onPointer, {passive:true});

  function tick(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    for(let k=bursts.length-1;k>=0;k--){
      const b = bursts[k];
      b.age++;
      const t = b.age/b.life;
      const alpha = Math.max(0, 1 - t);
      // move nodes
      for(const n of b.nodes){ n.x += n.vx; n.y += n.vy; n.vx *= 0.985; n.vy *= 0.985; }
      // root lines from center
      ctx.lineWidth = 1.2;
      for(const n of b.nodes){
        ctx.strokeStyle = `rgba(74,143,240,${alpha*0.55})`;
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(n.x, n.y); ctx.stroke();
      }
      // inter-node connections (network)
      for(let i=0;i<b.nodes.length;i++){
        for(let j=i+1;j<b.nodes.length;j++){
          const a = b.nodes[i], c = b.nodes[j];
          const d = Math.hypot(a.x-c.x, a.y-c.y);
          if(d<90){
            ctx.strokeStyle = `rgba(127,179,255,${alpha*(1-d/90)*0.4})`;
            ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(c.x,c.y); ctx.stroke();
          }
        }
      }
      // nodes
      for(const n of b.nodes){
        ctx.fillStyle = `rgba(10,61,145,${alpha*0.85})`;
        ctx.beginPath(); ctx.arc(n.x, n.y, 2.2, 0, Math.PI*2); ctx.fill();
      }
      // pulse ring at origin
      ctx.strokeStyle = `rgba(74,143,240,${alpha*0.5})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(b.x, b.y, 6 + t*60, 0, Math.PI*2); ctx.stroke();
      // origin glow
      const g = ctx.createRadialGradient(b.x,b.y,0,b.x,b.y,18);
      g.addColorStop(0, `rgba(127,179,255,${alpha*0.6})`);
      g.addColorStop(1, 'rgba(127,179,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(b.x,b.y,18,0,Math.PI*2); ctx.fill();

      if(b.age>=b.life) bursts.splice(k,1);
    }
    requestAnimationFrame(tick);
  }
  tick();
})();