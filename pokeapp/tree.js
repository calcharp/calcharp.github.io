function formatAge(value, dated){
  if(!dated) return value<=0.001?'Now':value.toFixed(2);
  if(value<=0.05) return 'Now';
  if(value>=100) return Math.round(value)+' Ma';
  if(value>=10) return Math.round(value)+' Ma';
  return value.toFixed(1)+' Ma';
}
function scaleTicks(max, dated){
  if(!(max>0)) return [];
  if(!dated) return [0,max*.25,max*.5,max*.75,max];
  const rough=max/4, mag=Math.pow(10,Math.floor(Math.log10(Math.max(rough,1e-6))));
  let step=mag;
  for(const mult of [1,2,5,10]) if(mult*mag>=rough*.7){step=mult*mag;break;}
  const ticks=[0];
  for(let value=step;value<max*.92;value+=step) ticks.push(value);
  return ticks;
}
function stampTree(node, index = new Map()) {
  node.key = String(index.size); index.set(node.key,node);
  if (node.children) {
    node.children.forEach(c=>stampTree(c,index));
    if(!node.keepAge) node.age=1+Math.max(...node.children.map(c=>c.age));
    node.tips=node.children.flatMap(c=>c.tips);
  } else { if(!node.keepAge) node.age=0; node.tips=[node.name]; }
  return index;
}
function pruneTree(node, selected) {
  if (!node.children) return selected.has(node.name)?{...node}:null;
  const children=node.children.map(c=>pruneTree(c,selected)).filter(Boolean);
  if(!children.length) return null;
  if(children.length===1){
    const child=children[0];
    // Preserve dating when unary ancestors collapse away during display pruning.
    if((node.dated||node.keepAge)&&child.children){
      return {...child,dated:child.dated||node.dated,keepAge:child.keepAge||node.keepAge,age:child.keepAge?child.age:Math.max(child.age||0,node.age||0),dateSource:child.dateSource||node.dateSource};
    }
    return child;
  }
  return {...node,children};
}
// Choose a complete small clade, never an unrelated sample of tips.
function randomSubclade(root, current = new Set(), random = Math.random) {
  const candidates = [];
  function visit(node) {
    if (!node.children) return {tips:[node.name], forks:0};
    const descendants = node.children.map(visit);
    const tips = descendants.flatMap(d=>d.tips);
    const forks = 1 + descendants.reduce((sum,d)=>sum+d.forks,0);
    // Require several nested splits and at least half the possible resolution.
    if (tips.length>=6 && tips.length<=10 && forks>=Math.max(3,Math.ceil((tips.length-1)/2))) candidates.push(tips);
    return {tips,forks};
  }
  visit(root);
  const different = candidates.filter(tips=>tips.length!==current.size || tips.some(name=>!current.has(name)));
  const pool = different.length ? different : candidates;
  return pool.length ? new Set(pool[Math.floor(random()*pool.length)]) : null;
}
class PokemonTree {
  constructor(stage, helpers) {
    this.stage=stage; this.helpers=helpers; this.shape='branch'; this.clades=new Map();
    this.viewport=new ExplorerViewport(stage,()=>this.drawAxis()); this.signature='';this.axisInfo=null;
  }
  setData(data) {
    this.root=data.tree; this.index=stampTree(this.root);
    this.species=new Map(data.pokemon.map(p=>[p.name,p]));
  }
  clearColors() { this.clades.clear(); this.activeClade=null; this.render(this.selected,false); this.helpers.onColor(0); }
  color(node) {
    let color='#8864aa';
    for (const [key,c] of this.clades) if (node.tips.every(t=>this.index.get(key).tips.includes(t))) color=c;
    return color;
  }
  cladeTips(key){
    const node=this.index.get(key);
    if(!node?.tips?.length) return [];
    return node.tips.filter(name=>this.selected?.has(name));
  }
  toggleClade(key) {
    const palette=['#ab4d91','#d47b28','#338a9a','#5d75be','#799344'];
    // Selecting a clade always colors it so the branch stays visible with the sidebar open.
    if(!this.clades.has(key)) this.clades.set(key,palette[this.clades.size%palette.length]);
    this.activeClade=key;
    this.render(this.selected,false); this.helpers.onColor(this.clades.size);
    const tips=this.cladeTips(key);
    const node=this.index.get(key);
    this.helpers.onClade?.(key,tips,node);
  }
  drawAxis() {
    if(this.taxonomy||!this.axisInfo||!this.viewport.box)return;
    let axis=this.stage.querySelector('.tree-axis');
    if(!axis){axis=document.createElementNS('http://www.w3.org/2000/svg','svg');axis.setAttribute('class','tree-axis');this.stage.append(axis);}
    const w=this.stage.clientWidth,{start,end,age,dated}=this.axisInfo;
    axis.setAttribute('aria-label',dated?'Million years before now, DateLife median':'Relative time before now, synthetic scale');
    const a=this.viewport.toScreen(start,0)[0],b=this.viewport.toScreen(end,0)[0];
    let content=`<path d="M${a} 4H${b}" stroke="#a88fba" fill="none"/>`;
    for(let i=0;i<=4;i++){
      const x=a+(b-a)*i/4;if(x<12||x>w-12||(age===0&&i<4))continue;
      const value=(1-i/4)*age;
      const label=i===4?'0 · Now':dated?(value>=100?value.toFixed(0):value.toFixed(1))+' Ma':value.toFixed(2);
      content+=`<path d="M${x} 4v5" stroke="#a88fba"/><text x="${x}" y="24" text-anchor="middle" font-size="12" fill="#80638f">${label}</text>`;
    }
    content+=`<text x="${w/2}" y="46" text-anchor="middle" font-size="11" fill="#9179a0">${dated?'Million years before now · DateLife median':'Relative time before now · synthetic scale'}</text>`;
    axis.setAttribute('viewBox',`0 0 ${w} 54`);axis.innerHTML=content;
  }
  render(selected, forceFit = false) {
    if(!this.root) return; this.selected=new Set(selected);
    const root=pruneTree(this.root,selected);
    if(!root) { this.viewport.svg=null;this.axisInfo=null;this.stage.innerHTML=`<div class="empty-stage"><h2>Who belongs in your tree?</h2><p>Choose some ${this.real?'animals and explore how they are related':'Pokémon and explore how they might be related'}.</p><button class="choose-button" data-pick>Choose ${this.real?'animals':'Pokémon'}</button></div>`;this.stage.querySelector('[data-pick]').onclick=this.helpers.onPick;this.signature='';return; }
    const signature=[this.shape,...selected].join('|'), reset=forceFit||signature!==this.signature; this.signature=signature;
    const leaves=[], nodes=[];
    function arrange(n) {
      nodes.push(n);
      if(n.children) {n.children.forEach(arrange);n.y=n.children.reduce((s,c)=>s+c.y,0)/n.children.length;}
      else {n.li=leaves.length;n.y=48+leaves.length*92;leaves.push(n);}
    }
    arrange(root);
    const circle=this.shape==='circle';
    const showAxis=!circle&&!this.taxonomy;
    this.stage.classList.toggle('has-axis',showAxis);
    const stage=this.viewport.size();
    if(showAxis) stage[1]=Math.max(280,stage[1]-58);
    const baseHeight=Math.max(stage[1],leaves.length*92+110);
    const w=circle?Math.max(780,leaves.length*146/Math.PI+320):Math.max(780,stage[0]/Math.max(.65,Math.min(1,stage[1]/baseHeight)));
    const h=circle?w:baseHeight;
    const sourceAge=this.root.age||1, tipX=w-365, start=55;
    const dated=!!(root.dated||this.root.dated);
    const rootAge=Math.max(root.age||0, dated?0:1)||1;
    const scaleAge=dated?rootAge:rootAge/sourceAge;
    const x=n=>start+(1-n.age/rootAge)*(tipX-start);
    this.axisInfo=(circle||this.taxonomy)?null:{start,end:tipX,age:scaleAge,dated};
    const cx=w/2,cy=h/2,radius=w/2-155;
    if(!circle) {
      leaves.forEach((n,i)=>n.y=leaves.length===1?(h-95)/2:50+i*(h-145)/Math.max(1,leaves.length-1));
      const rec=n=>{if(n.children){n.children.forEach(rec);n.y=n.children.reduce((s,c)=>s+c.y,0)/n.children.length}};rec(root);
    }
    function angles(n) {if(n.children){n.children.forEach(angles);n.a=(n.children[0].a+n.children.at(-1).a)/2;}else n.a=-Math.PI/2+(n.li+.5)*Math.PI*2/leaves.length;}
    angles(root);
    const polar=(r,a)=>[cx+r*Math.cos(a),cy+r*Math.sin(a)];
    const r=n=>(1-n.age/rootAge)*radius;
    const esc=this.helpers.escape, parts=[];
    const ticks=scaleTicks(scaleAge, dated&&this.real);
    let gapMid=-Math.PI/2;
    if(circle&&leaves.length){
      const angs=leaves.map(n=>n.a).sort((a,b)=>a-b);
      let gap=-1;
      for(let i=0;i<angs.length;i++){const a=angs[i],b=i+1<angs.length?angs[i+1]:angs[0]+Math.PI*2,span=b-a;if(span>gap){gap=span;gapMid=(a+b)/2;}}
    }
    const path=(d,color,width=2.6)=>parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`);
    if(circle&&!this.taxonomy&&(dated||!this.real)) {
      for(const age of ticks){const rr=(1-age/Math.max(scaleAge,1e-6))*radius;if(rr>8)parts.push(`<circle cx="${cx}" cy="${cy}" r="${rr}" fill="none" stroke="#e5dced" stroke-dasharray="3 7"/>`);}
    } else if(!circle&&!this.taxonomy) {
      const base=h-60;
      for(let i=0;i<=4;i++) {const xx=start+i/4*(tipX-start);parts.push(`<path d="M${xx} 33V${base}" stroke="#e7deed" stroke-dasharray="3 7" fill="none"/>`);}
    }
    const paint=n=>{
      const col=this.color(n),[nx,ny]=circle?polar(r(n),n.a):[x(n),n.y];
      if(n.children) {
        if(circle) {
          for(let i=1;i<n.children.length;i++) {const a=n.children[i-1].a,b=n.children[i].a,rr=r(n),p=polar(rr,a),q=polar(rr,b);if(rr>0)path(`M${p}A${rr},${rr} 0 ${b-a>Math.PI?1:0} 1 ${q}`,col);}
        } else path(`M${nx} ${n.children[0].y}V${n.children.at(-1).y}`,col);
        for(const child of n.children) {
          if(!child.children && this.showTipBars===false) {}
          else if(circle) path(`M${polar(r(n),child.a)}L${polar(r(child),child.a)}`,this.color(child));
          else path(`M${nx} ${child.y}H${x(child)}`,this.color(child));
          paint(child);
        }
        const count=n.tips.filter(t=>selected.has(t)).length;
        const cladeLabel=this.real?`Open clade with ${count} animals`:`Open family with ${count} selected Pokémon`;
        const active=this.activeClade===n.key;
        parts.push(`<g role="button" tabindex="0" class="clade${active?' clade-active':''}" data-clade="${n.key}" aria-label="${cladeLabel}" aria-pressed="${active}"><title>${this.real?'Tap for clade facts · remove or keep':'Tap for this family · remove or keep'}</title><circle cx="${nx}" cy="${ny}" r="26" fill="transparent"/>${active?`<circle cx="${nx}" cy="${ny}" r="12" fill="none" stroke="${col}" stroke-width="3" opacity=".9"/>`:''}<circle class="visible-dot" cx="${nx}" cy="${ny}" r="${active?8:5}" fill="${col}" stroke="#fffdf8" stroke-width="2"/></g>`);
        if(this.real&&dated&&!n.layoutAge&&n.age>0.5&&(!circle||r(n)>36)){
          const ageText=formatAge(n.age,true);
          const [lx,ly]=circle?[nx+Math.cos(n.a+Math.PI/2)*26, ny+Math.sin(n.a+Math.PI/2)*26]:[nx-8,ny-7];
          parts.push(`<text class="node-age" x="${lx}" y="${ly}" text-anchor="${circle?'middle':'end'}" font-size="13" font-weight="700" fill="#5c3d78" stroke="#fffdf8" stroke-width="4" paint-order="stroke">${ageText}</text>`);
        }
      } else {
        const p=this.species.get(n.name); if(!p) return; let sx,sy,tx,ty,align;
        if(circle) {const point=polar(radius+65,n.a);sx=point[0]-64;sy=point[1]-64;tx=point[0];ty=point[1]+79;align='middle';}
        else {sx=nx+13;sy=ny-55;tx=nx+135;ty=ny-4;align='start';}
        const nameLimit=circle?18:26;
        const sw=(circle?128:110)*(this.spriteScale||1), spriteX=sx-(circle?128:110)*((this.spriteScale||1)-1)/2, spriteY=sy-(circle?128:110)*((this.spriteScale||1)-1)/2;
        parts.push(`<g class="tip" role="button" tabindex="0" data-pokemon="${p.id}" aria-label="Meet ${esc(p.display)}"><title>Meet ${esc(p.display)}</title><rect class="tip-bg" x="${sx-7}" y="${sy-4}" width="${circle?142:265}" height="${circle?154:118}" rx="14" fill="${col==='#8864aa'?'transparent':col+'18'}"/><svg class="sprite-svg" x="${spriteX}" y="${spriteY}" width="${sw}" height="${sw}" viewBox="${this.helpers.spriteBox(p)}"><image href="${this.helpers.spriteURL(p)}" width="96" height="96"/></svg><text x="${tx}" y="${ty}" text-anchor="${align}" fill="${col==='#8864aa'?'#59377a':col}" font-size="${circle?15:18}" font-weight="700">${esc(p.display.length>nameLimit?p.display.slice(0,nameLimit-1)+'…':p.display)}</text>${circle?'':`<text x="${tx}" y="${ty+23}" font-size="12" fill="#a088b0">${p.real?esc(p.name.length>34?p.name.slice(0,33)+'…':p.name):'#'+String(p.id).padStart(4,'0')+' · '+p.types.join(' / ')}</text>`}</g>`);
      }
    };
    paint(root);
    if(circle&&!this.taxonomy&&dated&&this.real){
      parts.push(`<text x="${cx}" y="${cy+5}" text-anchor="middle" font-size="15" font-weight="700" fill="#5c3d78" stroke="#fffdf8" stroke-width="5" paint-order="stroke">${formatAge(scaleAge,true)}</text>`);
    } else if(circle&&!this.taxonomy&&!this.real){
      for(const age of ticks){
        if(age<=0.05) continue;
        const dist=(1-age/Math.max(scaleAge,1e-6))*radius;
        if(dist<36||dist>radius-28) continue;
        const [lx,ly]=polar(dist,gapMid);
        parts.push(`<text x="${lx}" y="${ly}" text-anchor="middle" font-size="12" font-weight="700" fill="#6d4a86" stroke="#fffdf8" stroke-width="5" paint-order="stroke">${formatAge(age,false)}</text>`);
      }
    }
    this.stage.innerHTML=`<svg xmlns="http://www.w3.org/2000/svg" class="scene" role="group" aria-label="${this.real?(root.dated?'Open Tree of Life, DateLife ages in million years':'Open Tree of Life, synthetic ultrametric scale'):'Ultrametric model family tree'}" viewBox="0 0 ${w} ${h}"><g font-family="Trebuchet MS,system-ui,sans-serif">${parts.join('')}</g></svg>`;
    if(circle&&dated&&this.real){
      const legend=document.createElement('div');
      legend.className='time-legend';
      const marks=ticks.filter(age=>age>0.05&&age<scaleAge*.92).map(age=>`<span>${formatAge(age,true)}</span>`).join('');
      legend.innerHTML=`<b>${formatAge(scaleAge,true)} at the center</b>${marks}<span>Now at the photos</span>`;
      this.stage.append(legend);
    }
    this.viewport.setScene(this.stage.querySelector('.scene'),[0,0,w,h],reset);
    if(reset&&!circle&&leaves.length>10){this.viewport.scale=Math.max(.65,this.viewport.scale);this.viewport.center=[w/2,stage[1]/this.viewport.scale/2];this.viewport.apply();}
    this.helpers.onHint(this.real?(dated?`Branch lengths are million years before now. The oldest split is about ${Math.round(root.age)} Ma.`:'Tap a photo to meet an animal. Tap a dot to color its branch.'):leaves.length>10?'Drag to explore your tree. Tap Fit to see every Pokémon.':'Tap a Pokémon to meet it. Tap a dot to color its family.');
    this.stage.querySelectorAll('[data-clade]').forEach(el=>this.helpers.activate(el,()=>this.toggleClade(el.dataset.clade)));
    this.stage.querySelectorAll('[data-pokemon]').forEach(el=>this.helpers.activate(el,()=>this.helpers.onMeet(+el.dataset.pokemon)));
  }
}
