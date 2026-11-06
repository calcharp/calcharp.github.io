class PokemonAtlas {
  constructor(stage, helpers) {
    this.stage=stage;this.helpers=helpers;this.focus='world';this.page=0;this.markers=[];this.hotspots=[];
    this.viewport=new ExplorerViewport(stage,()=>this.position());
    this.centers={Kanto:[858,408],Johto:[653,377],Hoenn:[777,555],Sinnoh:[785,130],Unova:[493,555],Kalos:[490,292],Alola:[1105,415],Galar:[143,277],Paldea:[304,436]};
  }
  setData(data,mapInfo) {this.data=data;this.info=mapInfo;}
  group(p) {return p.region==='Hisui'?'Sinnoh':p.region;}
  setFocus(name) {this.focus=name;this.page=0;this.helpers.onRegion(name);this.render(this.selected,true);}
  changePage(dir) {this.page=Math.max(0,Math.min(this.pages-1,this.page+dir));this.render(this.selected,false);}
  reset() {const r=this.focus==='world'?[0,0,this.info.width,this.info.height]:this.info.regions.find(r=>r.name===this.focus).crop;this.viewport.fit(r);}
  render(selected,reset=false) {
    if(!this.info)return;this.selected=new Set(selected);const picked=this.data.pokemon.filter(p=>selected.has(p.name));
    const groups=new Map(this.info.regions.map(r=>[r.name,picked.filter(p=>this.group(p)===r.name)]));
    const focused=this.focus!=='world',slots=focused?6:1;
    this.pages=1;this.page=0;this.helpers.onPage(0,1);
    this.stage.innerHTML=`<svg class="scene" xmlns="http://www.w3.org/2000/svg" aria-label="Existing cartoon Pokémon world map by MosseN1998" role="img"><image href="world-map.jpg" width="${this.info.width}" height="${this.info.height}"/></svg>`;
    this.markers=[];this.hotspots=[];
    if(!focused) for(const region of this.info.regions) {
      const button=document.createElement('button');button.className='map-region-hit';button.setAttribute('aria-label','Explore '+region.name);button.title='Explore '+region.name;
      button.onclick=()=>this.setFocus(region.name);this.stage.append(button);
      this.hotspots.push({el:button,crop:region.crop});
    }
    for(const region of this.info.regions) {
      if(focused&&region.name!==this.focus)continue;
      const all=groups.get(region.name);
      const items=all;
      items.forEach((p,i)=>{
        const marker=document.createElement('div');marker.className='map-marker'+(focused?' focused':'');
        const meet=document.createElement('button');meet.className='marker-meet';meet.setAttribute('aria-label','Meet '+p.display);
        meet.innerHTML=this.helpers.sprite(p)+`<b>${this.helpers.escape(p.display)}</b>`;meet.onclick=()=>this.helpers.onMeet(p.id);marker.append(meet);
        this.stage.append(marker);
        const center=this.centers[region.name], angle=i*2.399963229728653;
        const radius=items.length===1?0:Math.sqrt((i+.5)/items.length)*(focused?75:Math.min(115,35*Math.sqrt(items.length)));
        const coord=[center[0]+Math.cos(angle)*radius,center[1]+Math.sin(angle)*radius*.8];
        this.markers.push({el:marker,coord});
      });
    }
    if(!picked.length || (focused&&!groups.get(this.focus).length)) {
      const message=document.createElement('div');message.className='map-message';message.textContent=focused?`No picks in ${this.focus} yet. Choose some Pokémon!`:'Choose Pokémon to put them on the map.';this.stage.append(message);
    }
    const first=!this.viewport.svg;
    this.viewport.setScene(this.stage.querySelector('.scene'),[0,0,this.info.width,this.info.height],false);
    if(reset||first)this.reset();else this.position();
  }
  position() {
    if(!this.viewport.box)return;
    const [w,h]=this.viewport.size();
    const positions=this.markers.map(marker=>({...marker,point:this.viewport.toScreen(...marker.coord)}));
    // Keep large touch targets apart in the overview, including portrait iPads.
    if(positions.length<150)for(let pass=0;pass<8;pass++)for(let i=0;i<positions.length;i++)for(let j=i+1;j<positions.length;j++){
      const a=positions[i].point,b=positions[j].point,dx=b[0]-a[0],dy=b[1]-a[1];
      const scale=Number(document.getElementById('spriteSize').value)/100;const ox=112*scale-Math.abs(dx),oy=120*scale-Math.abs(dy);
      if(ox>0&&oy>0){const axis=ox<oy?0:1,delta=(axis===0?ox:oy)/2+1,direction=(axis===0?dx:dy)>=0?1:-1;a[axis]-=delta*direction;b[axis]+=delta*direction;}
    }
    for(const {el,point:[x,y]} of positions) {
      el.style.left=x+'px';el.style.top=y+'px';
      el.hidden=x<-100||x>w+100||y<-100||y>h+100;
    }
    for(const {el,crop} of this.hotspots) {
      const [x,y]=this.viewport.toScreen(crop[0]+crop[2]/2,crop[1]+crop[3]/2);
      el.style.left=x+'px';el.style.top=y+'px';el.style.width=crop[2]*this.viewport.scale+'px';el.style.height=crop[3]*this.viewport.scale+'px';
    }
  }
}
