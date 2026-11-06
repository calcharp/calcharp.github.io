const $=id=>document.getElementById(id);
const escapeHTML=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const normalize=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9♀♂]/g,'');
const activate=(el,fn)=>{el.onclick=fn;el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();fn();}}};
let data, selected=new Set(), activeView='tree', bounds=new Map(), spriteSources=new Map(), byId=new Map(), byName=new Map(), selectedOnly=false, inspected=null;
let filterTimer,previewTimer,resizeTimer;
let speciesMode='pokemon',pokemonData,pokemonSelection,animalSelection,animalReady=false,modeRequest=0,animalSearchRequest=0,animalPage=1;
const animalStore=new AnimalStore();
const noun=()=>speciesMode==='animals'?'animals':'Pokémon';
function spriteBox(p) {
  if(p.real)return "0 0 96 96";
  const b=bounds.get(p.id)||[0,0,96,96];
  const size=Math.max(b[2]-b[0],b[3]-b[1])+8;
  return [(b[0]+b[2]-size)/2,(b[1]+b[3]-size)/2,size,size].join(' ');
}
function spriteHTML(p) {
  if(p.real)return p.photo?`<img class="animal-photo" src="${escapeHTML(p.photo)}" alt="${escapeHTML(p.display)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="photo-missing" hidden>Photo unavailable</span>`:'<span class="photo-missing">No photo yet</span>';
  return `<svg xmlns="http://www.w3.org/2000/svg" class="sprite-svg" viewBox="${spriteBox(p)}" aria-hidden="true" focusable="false"><image href="${spriteURL(p)}" width="96" height="96"/></svg>`;
}
function spriteURL(p){if(p.real)return p.photo||'';return spriteSources.get(p.id)||`sprites/${p.id}.png`;}
const common={escape:escapeHTML,activate,spriteBox,spriteURL,sprite:spriteHTML,onMeet:openPokemon,onRemove:removeFromTree,onPick:()=>openPicker(),onColor:n=>{$('clearColors').hidden=!n;},onHint:text=>{$('treeHint').textContent=text;},onPhoto:(photos,index=0,title='')=>openPhotoLightbox(photos,index,title)};
const treeView=new PokemonTree($('treeStage'),common);
const atlas=new PokemonAtlas($('mapStage'),{...common,onRegion:name=>{$('region').value=name;},onPage:(page,pages)=>{
  $('mapPager').hidden=pages<=1;$('mapPage').textContent=`${page+1} / ${pages}`;$('mapPrev').disabled=page===0;$('mapNext').disabled=page===pages-1;
}});
const earth=new AnimalMap($('earthStage'),animalStore,common);
function activeAtlas(){return speciesMode==='animals'?earth:atlas;}
function announce(text){$('status').textContent=text;}
function persist() {try{localStorage.setItem(speciesMode==='animals'?'animal-discovery-selection':'pokemon-phylogeny-selection',JSON.stringify([...selected]));}catch{}}
function renderActive(reset=false) {if(!data)return;if(activeView==='tree')treeView.render(selected,reset);else activeAtlas().render(selected,reset);}
function updateSelection(changedId) {
  persist();$('selectionCount').textContent=selected.size;$('pickerSelected').textContent=selected.size;
  if(changedId) document.querySelectorAll(`[data-pick-id="${changedId}"]`).forEach(button=>{
    const p=byId.get(changedId),isPicked=selected.has(p.name);button.setAttribute('aria-pressed',isPicked);button.setAttribute('aria-label',(isPicked?'Remove ':'Add ')+p.display);setPickMark(button,isPicked);
  });
  if($('picker').open){if(selectedOnly||!changedId)renderGrid();else updatePickerCount();}
  if(!$('previews').hidden && !changedId)renderPreviews();
  if(!$('picker').open){if(speciesMode==='animals')refreshAnimalTree();else renderActive();}
  if(inspected&&!$('pokemonDetail').hidden)updateDetailButton();
}
function removeFromTree(id){
  const p=byId.get(+id);if(!p||!selected.has(p.name))return;
  selected.delete(p.name);treeView.clades.clear();$('clearColors').hidden=true;
  updateSelection(p.id);announce('Removed '+p.display+'.');
}
let kinRequest=0,kinTimer=0,kinTaxon=null;
function kinMarkup(){return `<section class="kin"><div class="kin-head"><h2>Find relatives</h2><button type="button" class="choose-button" id="sisterSearch">Sister species</button></div><label class="kin-search"><span aria-hidden="true">⌕</span><input id="kinQuery" type="search" placeholder="Search this group…" autocomplete="off" enterkeyhint="search"></label><div id="kinGrid" class="kin-grid"></div></section>`;}
function mountPokemonKin(pokemon){
  const grid=$('kinGrid'),input=$('kinQuery');
  const paint=()=>{
    const q=normalize(input.value.trim());
    const family=data.pokemon.filter(p=>p.chain===pokemon.chain);
    const cousins=data.pokemon.filter(p=>p.genus===pokemon.genus&&p.chain!==pokemon.chain);
    let list=[...family,...cousins];
    if(q)list=list.filter(p=>normalize(p.display).includes(q)||normalize(p.name).includes(q));
    grid.replaceChildren();
    if(!list.length){grid.innerHTML='<p class="no-results">No relatives match that search.</p>';return;}
    list.slice(0,16).forEach(p=>grid.append(card(p)));
  };
  input.oninput=paint;$('sisterSearch').onclick=()=>{input.value='';paint();input.focus();};paint();
}
async function showKin(taxon,query=''){
  if(!taxon?.id)return;kinTaxon=taxon;
  document.querySelectorAll('[data-taxon]').forEach(el=>el.setAttribute('aria-pressed',el.dataset.taxon===String(taxon.id)));
  const request=++kinRequest,grid=$('kinGrid');if(!grid)return;
  grid.innerHTML='<p class="no-results">Finding relatives…</p>';
  try{
    const items=await animalStore.relatives(taxon.id,query);
    if(request!==kinRequest||$('pokemonDetail').hidden)return;
    items.forEach(a=>{byId.set(a.id,a);byName.set(a.name,a);});
    grid.replaceChildren();
    if(!items.length){grid.innerHTML='<p class="no-results">No species with a photo in this group.</p>';return;}
    items.forEach(a=>grid.append(card(a)));
  }catch{if(request===kinRequest)grid.innerHTML='<p class="no-results">Relatives could not load. Try again.</p>';}
}
function mountAnimalKin(animal){
  const ranks=animal.ancestors.filter(n=>['class','order','family','genus'].includes(n.rank));
  const genus=ranks.find(n=>n.rank==='genus');
  const family=ranks.find(n=>n.rank==='family');
  const input=$('kinQuery');
  const sisters=async()=>{
    input.value='';
    if(genus){
      await showKin(genus,'');
      const few=$('kinGrid')&&$('kinGrid').querySelectorAll('.pokemon-card').length<2;
      if(few&&kinTaxon===genus&&family&&family!==genus)await showKin(family,'');
    }else if(family)await showKin(family,'');
    else if($('kinGrid'))$('kinGrid').innerHTML='<p class="no-results">No genus or family is available for this animal yet.</p>';
  };
  input.oninput=()=>{clearTimeout(kinTimer);kinTimer=setTimeout(()=>showKin(kinTaxon,input.value.trim()),280);};
  $('sisterSearch').onclick=()=>{sisters();input.focus();};
  dialogTaxonClicks(animal);
  sisters();
}
function dialogTaxonClicks(animal){
  document.querySelectorAll('#pokemonDetail [data-taxon]').forEach(el=>{el.onclick=()=>{const taxon=animal.ancestors.find(n=>String(n.id)===el.dataset.taxon);if(taxon){$('kinQuery').value='';showKin(taxon);$('kinGrid').scrollIntoView({block:'nearest'});}};});
}
async function toggle(id) {
  let p=byId.get(+id);if(!p)return;
  if(speciesMode==='animals'&&!selected.has(p.name)){
    const request=modeRequest,buttons=[...document.querySelectorAll(`[data-pick-id="${p.id}"]`)];
    buttons.forEach(b=>{b.disabled=true;b.setAttribute('aria-busy','true');setPickMark(b,'busy');});
    try{p=await animalStore.hydrate(p.id);if(speciesMode!=='animals'||request!==modeRequest)return;syncAnimals();}catch(error){showAnimalError('Could not load this animal. Please try again.');return;}finally{buttons.forEach(b=>{b.disabled=false;b.removeAttribute('aria-busy');setPickMark(b,selected.has(p.name));});}
  }
  selected.has(p.name)?selected.delete(p.name):selected.add(p.name);
  updateSelection(p.id);announce((selected.has(p.name)?'Added ':'Removed ')+p.display+`. ${selected.size} ${noun()} selected.`);
}
function matches(p,q) {
  if(!q)return true;const normalized=normalize(q);
  return normalize(p.display).includes(normalized)||normalize(p.name).includes(normalized)||String(p.id)===q.replace(/^#0*/, '')||String(p.id).padStart(4,'0').includes(q);
}
function pickGlyph(state){
  if(state==='busy') return `<span class="pick-mark" aria-hidden="true">…</span>`;
  if(state===true||state==='on') return `<svg class="pick-mark" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#6d3d96"/><path d="M6.5 12.5l3.5 3.5 7.5-8" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return `<svg class="pick-mark" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.2" fill="#fff" stroke="#6d3d96" stroke-width="1.6"/><path d="M12 7v10M7 12h10" fill="none" stroke="#6d3d96" stroke-width="2.2" stroke-linecap="round"/></svg>`;
}
function setPickMark(button,on){const mark=button.querySelector('.pick-mark');if(mark)mark.outerHTML=pickGlyph(on===true||on==='on'?'on':on==='busy'?'busy':'off');}
function card(p) {
  const isPicked=selected.has(p.name),b=document.createElement('button');b.type='button';b.className='pokemon-card';b.dataset.pickId=p.id;
  b.setAttribute('aria-label',(isPicked?'Remove ':'Add ')+p.display);b.setAttribute('aria-pressed',isPicked);
  b.innerHTML=`${pickGlyph(isPicked?'on':'off')}${spriteHTML(p)}<b>${escapeHTML(p.display)}</b><small>${p.real?escapeHTML(p.name):'#'+String(p.id).padStart(4,'0')}</small>`;
  b.onclick=()=>toggle(p.id);return b;
}
function closePreviews() {animalSearchRequest++;clearTimeout(previewTimer);$('previews').hidden=true;$('quickSearch').setAttribute('aria-expanded','false');}
function renderPreviews() {
  if(speciesMode==='animals'){renderAnimalPreviews();return;}
  if(!data)return;const q=$('quickSearch').value.trim();
  const items=(q?data.pokemon.filter(p=>matches(p,q)):[25,133,6,448,906,1025].map(id=>byId.get(id))).slice(0,6);
  const panel=$('previews');panel.replaceChildren();
  const title=document.createElement('div');title.className='preview-title';const text=document.createElement('span');text.textContent=q?'Tap to add or remove':'Try a favorite';
  const close=document.createElement('button');close.setAttribute('aria-label','Close search previews');close.textContent='×';close.onclick=closePreviews;title.append(text,close);panel.append(title);
  const grid=document.createElement('div');grid.className='preview-grid';items.forEach(p=>grid.append(card(p)));
  if(!items.length)grid.innerHTML='<p class="no-results">No Pokémon found. Try a name or Pokédex number.</p>';panel.append(grid);
  const browse=document.createElement('button');browse.className='preview-footer';browse.textContent=q?'See all matching Pokémon →':'Browse all 1,025 Pokémon →';browse.onclick=()=>openPicker(q);panel.append(browse);
  panel.hidden=false;$('quickSearch').setAttribute('aria-expanded','true');
}
function pickerItems() {
  const q=$('pickerSearch').value.trim(),region=$('pickerRegion').value;
  return data.pokemon.filter(p=>matches(p,q)&&(!region||p.region===region||(region==='Sinnoh'&&p.region==='Hisui'))&&(!selectedOnly||selected.has(p.name)));
}
function updatePickerCount(items=pickerItems()) {if(speciesMode==='animals'){$('pickerCount').textContent=`${selected.size} animals picked`;return;} $('pickerCount').textContent=`${items.length.toLocaleString()} Pokémon${selectedOnly?' picked':''}`;}
function renderGrid() {
  if(speciesMode==='animals'){renderAnimalGrid();return;}
  if(!data)return;const items=pickerItems();updatePickerCount(items);
  const fragment=document.createDocumentFragment();items.forEach(p=>fragment.append(card(p)));$('pokemonGrid').replaceChildren(fragment);
  if(!items.length)$('pokemonGrid').innerHTML='<div class="no-results">No Pokémon here yet.<br>Try another search or turn off “My picks.”</div>';
}
function openPicker(query='') {
  if(!data)return;closePreviews();$('pickerSearch').value=query;$('pickerRegion').value='';selectedOnly=false;$('pickedOnly').setAttribute('aria-pressed','false');
  if(!$('picker').open)$('picker').showModal();renderGrid();$('pokemonGrid').scrollTop=0;$('pickerDone').focus();
}
function closePicker() {$('picker').close();if(speciesMode==='animals')refreshAnimalTree();else renderActive();$('choose').focus();}
function setView(view) {
  closePreviews();activeView=view;
  for(const name of ['tree','map']) {$(name+'Panel').hidden=name!==view;$(name+'Tab').setAttribute('aria-selected',name===view);$(name+'Tab').tabIndex=name===view?0:-1;}
  // Two frames so Safari/iPad finish laying out a newly shown map panel before Leaflet measures it.
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    renderActive();
    if(activeView==='map'&&speciesMode==='animals') earth.syncSize(true);
  }));
}
function detailOpen(){return !$('pokemonDetail').hidden;}
function showDetail(){
  const panel=$('pokemonDetail'),first=panel.hidden;
  panel.hidden=false;
  document.body.classList.add('detail-open');
  document.documentElement.style.setProperty('--detail-top',document.querySelector('.app-bar').offsetHeight+'px');
  if(first) requestAnimationFrame(()=>{if(treeView?.viewport?.svg)treeView.viewport.fit();if(activeView==='map')activeAtlas()?.viewport?.fit?.();});
}
function hideDetail(){
  if($('pokemonDetail').hidden)return;
  $('pokemonDetail').hidden=true;document.body.classList.remove('detail-open');inspected=null;
  requestAnimationFrame(()=>{if(treeView?.viewport?.svg)treeView.viewport.fit();});
}
function openPokemon(id) {
  inspected=byId.get(+id);if(!inspected)return;if(speciesMode==='animals'){openAnimal(inspected);return;}const p=inspected,dialog=$('pokemonDetail');
  dialog.innerHTML=`<button class="close-button" id="closeDetail" aria-label="Close Pokémon details">×</button><p class="eyebrow">#${String(p.id).padStart(4,'0')} · ${escapeHTML(p.genus)}</p><h1 id="detailTitle">${escapeHTML(p.display)}</h1><div class="detail-stage">${spriteHTML(p)}</div><div class="type-badges">${p.types.map(t=>`<span>${escapeHTML(t)}</span>`).join('')}</div><div class="detail-traits"><div><small>HEIGHT</small>${p.height} m</div><div><small>WEIGHT</small>${p.weight} kg</div><div><small>ABILITIES</small>${p.abilities.map(escapeHTML).join(', ')}</div><div><small>GENERATION REGION</small>${escapeHTML(p.region)}</div></div>${p.wikiExcerpt?`<blockquote>“${escapeHTML(p.wikiExcerpt)}”</blockquote><p class="detail-source">Short biology excerpt · Bulbapedia contributors</p>`:p.dexExcerpt?`<blockquote>“${escapeHTML(p.dexExcerpt)}…”</blockquote><p class="detail-source">Pokédex excerpt · via PokéAPI</p>`:''}${kinMarkup()}<div class="detail-actions"><a href="${escapeHTML(p.wiki)}" target="_blank" rel="noopener">More facts on Bulbapedia ↗</a><button class="choose-button" id="detailPick"></button></div><p class="detail-note">${p.inSource?'Included in the original 340-species dataset.':'Added to this model using '+(p.placement==='family'?'its game evolution family.':'shared traits. Its placement is an estimate.')}</p>`;
  $('closeDetail').onclick=hideDetail;$('detailPick').onclick=()=>{const name=p.name;toggle(p.id);if(!selected.has(name))hideDetail();};updateDetailButton();mountPokemonKin(p);showDetail();$('closeDetail').focus();
}
function updateDetailButton(){if(inspected&&$('detailPick')){$('detailPick').textContent=selected.has(inspected.name)?'Remove from tree':'Add to my picks';}}
$('treeTab').onclick=()=>setView('tree');$('mapTab').onclick=()=>setView('map');
for(const id of ['treeTab','mapTab']) $(id).onkeydown=e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();setView(activeView==='tree'?'map':'tree');$(activeView+'Tab').focus();}};
$('quickSearch').oninput=renderPreviews;$('quickSearch').onfocus=renderPreviews;
$('quickSearch').onkeydown=e=>{if(e.key==='Escape')closePreviews();if(e.key==='Enter'){e.preventDefault();openPicker($('quickSearch').value.trim());}};
document.addEventListener('pointerdown',e=>{if(!$('quickSearchWrap').contains(e.target))closePreviews();});
$('choose').onclick=()=>openPicker();$('pickerDone').onclick=closePicker;
$('picker').addEventListener('cancel',()=>requestAnimationFrame(()=>{if(speciesMode==='animals')refreshAnimalTree();else renderActive();}));
$('pickerSearch').oninput=()=>{clearTimeout(filterTimer);filterTimer=setTimeout(()=>{renderGrid();$('pokemonGrid').scrollTop=0;},100);};
$('pickerRegion').onchange=()=>{renderGrid();$('pokemonGrid').scrollTop=0;};
$('pickedOnly').onclick=()=>{selectedOnly=!selectedOnly;$('pickedOnly').setAttribute('aria-pressed',selectedOnly);renderGrid();};
$('clearSelection').onclick=()=>{selected.clear();treeView.clades.clear();$('clearColors').hidden=true;updateSelection();announce('All picks cleared.');};
$('surprise').onclick=()=>{
  if(speciesMode==='animals'){randomAnimals();return;}
  const clade=randomSubclade(data.tree,selected);
  if(!clade)return;
  selected=clade;treeView.clades.clear();$('clearColors').hidden=true;updateSelection();announce(`${selected.size} Pokémon from one family-tree branch picked!`);
};
for(const [id,shape] of [['branchShape','branch'],['circleShape','circle']]) $(id).onclick=()=>{
  treeView.shape=shape;$('branchShape').setAttribute('aria-pressed',shape==='branch');$('circleShape').setAttribute('aria-pressed',shape==='circle');renderActive(true);
};
$('clearColors').onclick=()=>{treeView.clearColors();$('clearColors').hidden=true;};
$('treeIn').onclick=()=>treeView.viewport.zoom(1.3);$('treeOut').onclick=()=>treeView.viewport.zoom(1/1.3);$('treeFit').onclick=()=>treeView.viewport.fit();
$('region').onchange=()=>atlas.setFocus($('region').value);$('mapIn').onclick=()=>activeAtlas().viewport.zoom(1.35);$('mapOut').onclick=()=>activeAtlas().viewport.zoom(1/1.35);$('mapFit').onclick=()=>activeAtlas().reset();
$('mapPrev').onclick=()=>atlas.changePage(-1);$('mapNext').onclick=()=>atlas.changePage(1);
$('about').onclick=()=>{$('aboutDialog').showModal();};document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
$('aboutDialog').addEventListener('click',e=>{if(e.target===$('aboutDialog')){const b=$('aboutDialog').getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)$('aboutDialog').close();}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&detailOpen())hideDetail();});
window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>renderActive(true),130);});
$('treeStage').innerHTML='<div class="empty-stage"><h2>Opening the Pokédex…</h2></div>';
Promise.all([fetch('data.json').then(r=>{if(!r.ok)throw Error('Pokédex unavailable');return r.json();}),fetch('sprites/sprite-manifest.json').then(r=>r.json()),fetch('map-info.json').then(r=>r.json())]).then(([dex,sprites,mapInfo])=>{
  data=dex;pokemonData=dex;byId=new Map(data.pokemon.map(p=>[p.id,p]));byName=new Map(data.pokemon.map(p=>[p.name,p]));bounds=new Map(sprites.sprites.map(p=>[p.id,p.bbox]));spriteSources=new Map(sprites.sprites.map(p=>[p.id,p.dataUri]));
  let stored=null;try{stored=localStorage.getItem('pokemon-phylogeny-selection');}catch{}
  try{selected=new Set(stored?JSON.parse(stored).filter(n=>byName.has(n)):[25,133,6,151,448,906].map(id=>byId.get(id).name));}catch{selected=new Set([25,133,6,151,448,906].map(id=>byId.get(id).name));}
  for(const region of mapInfo.regions){const option=document.createElement('option');option.value=region.name;option.textContent=region.name==='Sinnoh'?'Sinnoh / Hisui':region.name;$('pickerRegion').append(option);}
  treeView.setData(data);atlas.setData(data,mapInfo);updateSelection();
}).catch(error=>{$('treeStage').innerHTML='<div class="empty-stage"><h2>The Pokédex could not load.</h2><p>Please reload to try again.</p><button class="choose-button" id="retry">Try again</button></div>';$('retry').onclick=()=>location.reload();announce(error.message);});

$('randomizeTop').onclick=()=>$('surprise').click();
$('resetTop').onclick=()=>{$('clearSelection').click();atlas.focus='world';atlas.page=0;$('region').value='world';activeAtlas().reset();renderActive(true);};
$('tipBars').onclick=()=>{treeView.showTipBars=treeView.showTipBars===false; $('tipBars').setAttribute('aria-pressed',treeView.showTipBars);renderActive();};
$('spriteSize').oninput=()=>{const scale=+$('spriteSize').value/100;document.documentElement.style.setProperty('--sprite-scale',scale);treeView.spriteScale=scale;renderActive();};

function syncAnimals(){
  const animals=[...animalStore.items.values()];
  byId=new Map(animals.map(a=>[a.id,a]));byName=new Map(animals.map(a=>[a.name,a]));
  if(speciesMode==='animals') data={pokemon:animals,tree:data?.tree};
}
let animalTreeRequest=0;
function placedNames(node,names=new Set()){if(!node)return names;if(!node.children){if(node.name)names.add(node.name);return names;}node.children.forEach(child=>placedNames(child,names));return names;}
async function refreshAnimalTree(){
  if(speciesMode!=='animals')return;
  const request=++animalTreeRequest;
  const chosen=[...selected].map(name=>byName.get(name)).filter(Boolean);
  $('treeHint').textContent='Checking photos and the Open Tree of Life…';
  try{
    const visible=await animalStore.withPhotos(chosen);
    if(request!==animalTreeRequest||speciesMode!=='animals')return;
    await animalStore.ensureOtt(visible);
    if(request!==animalTreeRequest||speciesMode!=='animals')return;
    // Hydrate any selected relative that still lacks ancestry so taxonomy fallback can place it.
    for(const animal of visible){
      if(!animal.ancestors?.length){
        try{await animalStore.hydrate(animal.id);}catch{}
      }
    }
    syncAnimals();
    const ready=[...selected].map(name=>byName.get(name)).filter(animal=>animal?.photo);
    const tree=await animalStore.openTree(ready);
    if(request!==animalTreeRequest||speciesMode!=='animals')return;
    // Keep every photo-ready pick; taxonomy fallback can place tips Open Tree prunes.
    selected=new Set(ready.map(animal=>animal.name));
    const animals=[...animalStore.items.values()];
    data={pokemon:animals,tree:selected.size?tree:{name:'Animals',label:'Animals'}};
    byId=new Map(animals.map(a=>[a.id,a]));byName=new Map(animals.map(a=>[a.name,a]));
    const taxonomyFallback=data.tree?.taxonomySource==='inat';
    treeView.real=true;treeView.taxonomy=taxonomyFallback;treeView.clades.clear();$('clearColors').hidden=true;treeView.setData(data);
    persist();$('selectionCount').textContent=selected.size;$('pickerSelected').textContent=selected.size;
    document.querySelectorAll('[data-pick-id]').forEach(button=>{const animal=byId.get(+button.dataset.pickId);if(!animal)return;const on=selected.has(animal.name);button.setAttribute('aria-pressed',on);button.setAttribute('aria-label',(on?'Remove ':'Add ')+animal.display);setPickMark(button,on);});
    renderActive(true);
    const label=animalStore.pendingLabel;animalStore.pendingLabel='';
    const leftOut=chosen.length-selected.size;
    const foot=document.querySelector('#treePanel .view-foot');
    if(taxonomyFallback){
      if(foot) foot.innerHTML='<span>iNaturalist taxonomy · Open Tree could not place these tips</span><span>Related by classification</span>';
      $('treeHint').textContent=leftOut?`${selected.size} species shown by taxonomy. ${leftOut} left out without a photo or ancestry.`:(label?`${selected.size} species from ${label}. Open Tree lacks these tips, so classification is shown.`:'Open Tree lacks these tips, so the tree uses iNaturalist classification. Tap a photo to meet an animal.');
    }else{
      $('treeHint').textContent=leftOut?`${selected.size} species on the Open Tree of Life. ${leftOut} left out without a photo or tree match.`:(label?`${selected.size} species from ${label}. Tap a photo to meet an animal.`:'Tap a photo to meet an animal. Tap a dot to color its branch.');
      if(foot) foot.innerHTML=data.tree?.dated?'<span>Open Tree of Life · DateLife ages</span><span>Earlier → Now · million years</span>':'<span>Open Tree of Life · split order kept</span><span>Earlier → Now · synthetic time</span>';
      if(data.tree?.dated) $('treeHint').textContent=`Branch lengths are DateLife ages, in millions of years. The oldest split shown is about ${Math.round(data.tree.age)} million years ago.`;
      if(selected.size>=2&&data.tree?.children) dateAnimalTree(request,data.tree);
    }
  }catch(error){
    if(request!==animalTreeRequest||speciesMode!=='animals')return;
    showAnimalError('The Open Tree of Life could not be loaded. Try again.');
  }
}
function showAnimalError(message){announce(message);$('treeHint').textContent=message;const panel=$('picker').open?$('pickerCount'):null;if(panel)panel.textContent=message;}
async function dateAnimalTree(request,tree){
  if(!tree.dated) $('treeHint').textContent='Looking up published ages from DateLife…';
  const dated=await animalStore.dateTree(tree);
  if(request!==animalTreeRequest||speciesMode!=='animals') return;
  if(!dated){
    if(!tree.dated) $('treeHint').textContent='Tap a photo to meet an animal. Tap a dot to color its branch. Published ages need the local DateLife server.';
    return;
  }
  if(!animalStore.applyDates(tree,dated)){
    if(!tree.dated) $('treeHint').textContent='DateLife returned ages, but they could not be matched to this tree. Showing synthetic time.';
    return;
  }
  treeView.setData(data);renderActive(false);
  document.querySelector('#treePanel .view-foot').innerHTML='<span>Open Tree of Life · DateLife ages</span><span>Earlier → Now · million years</span>';
  $('treeHint').textContent=`Branch lengths are DateLife ages, in millions of years. The oldest split shown is about ${Math.round(tree.age)} million years ago.`;
}
async function switchMode(mode){
  if(!pokemonData)return;if(mode===speciesMode){modeRequest++;return;}const request=++modeRequest;animalSearchRequest++;closePreviews();
  if(mode==='animals'&&!animalReady){$('animalMode').disabled=true;$('animalMode').textContent='Loading…';try{await animalStore.init();animalReady=true;}catch(error){$('treeHint').textContent='Animals could not load. Tap Real animals to retry.';return;}finally{$('animalMode').disabled=false;$('animalMode').textContent='Real animals';}}
  if(request!==modeRequest)return;
  if(speciesMode==='pokemon')pokemonSelection=new Set(selected);else animalSelection=new Set(selected);
  speciesMode=mode;document.body.dataset.mode=mode;treeView.real=mode==='animals';treeView.taxonomy=false;treeView.signature='';treeView.clades.clear();$('clearColors').hidden=true;hideDetail();inspected=null;
  if(mode==='animals'){
    syncAnimals();if(!animalSelection){let saved;try{saved=JSON.parse(localStorage.getItem('animal-discovery-selection'));}catch{}animalSelection=new Set(Array.isArray(saved)?saved.filter(n=>byName.has(n)):animalStore.groups[0].ids.map(id=>byId.get(id)?.name).filter(Boolean));}selected=new Set(animalSelection);
  }else{data=pokemonData;byId=new Map(data.pokemon.map(p=>[p.id,p]));byName=new Map(data.pokemon.map(p=>[p.name,p]));selected=new Set(pokemonSelection);treeView.setData(data);}
  $('pokemonMode').setAttribute('aria-pressed',mode==='pokemon');$('animalMode').setAttribute('aria-pressed',mode==='animals');
  const real=mode==='animals';$('treeTab').textContent='Family tree';$('treeStage').setAttribute('aria-label',real?'Open Tree of Life':'Interactive family tree');$('quickSearch').value='';$('quickSearch').placeholder=real?'Find an animal…':'Find a Pokémon…';$('quickSearch').setAttribute('aria-label',real?'Find an animal':'Find a Pokémon');
  $('chooseLabel').textContent=real?'Choose animals':'Choose Pokémon';$('sizeLabel').textContent=real?'Photos':'Sprites';$('spriteSize').setAttribute('aria-label',real?'Photo size':'Sprite size');
  $('pickerTitle').textContent=real?'Choose your animals':'Choose your Pokémon';$('pickerSearch').placeholder=real?'Search common or scientific names…':'Search all 1,025 Pokémon…';$('pickerSearch').setAttribute('aria-label',real?'Search animals':'Search all Pokémon');
  $('pickerRegion').innerHTML=real?'<option value="">All animals</option>'+animalStore.groups.map(g=>`<option value="${g.id}">${escapeHTML(g.name)}</option>`).join(''):'<option value="">All regions</option>'+['Kanto','Johto','Hoenn','Sinnoh','Unova','Kalos','Alola','Galar','Paldea'].map(n=>`<option>${n}</option>`).join('');$('pickerRegion').setAttribute('aria-label',real?'Filter by animal group':'Filter by region');
  $('region').parentElement.hidden=real;$('mapStage').hidden=real;$('earthStage').hidden=!real;$('mapPager').hidden=true;$('moreAnimals').hidden=true;
  $('animalAbout').hidden=!real;$('pokemonAbout').hidden=real;
  document.querySelector('#treePanel .view-foot').innerHTML=real?'<span>Open Tree of Life · split order kept</span><span>Earlier → Now · synthetic time</span>':'<span>Model family tree · added relationships are estimates</span><span>Earlier → Now · relative time</span>';
  document.querySelector('#mapPanel .view-foot').innerHTML=real?'<span>GBIF sighting samples · photos & taxonomy: iNaturalist</span><a href="https://www.gbif.org" target="_blank" rel="noopener">GBIF & data publishers ↗</a>':'<span>Grouped by debut generation · fan map</span><a href="https://www.deviantart.com/mossen1998/art/Pokemon-World-Map-as-of-2023-kitakami-988993196" target="_blank" rel="noopener">Map by MosseN1998 ↗</a>';
  updateSelection();if(mode!=='animals')renderActive(true);announce(real?'Exploring real animals.':'Exploring Pokémon.');
}
$('pokemonMode').onclick=()=>switchMode('pokemon');$('animalMode').onclick=()=>switchMode('animals');
async function renderAnimalPreviews(){
  const request=++animalSearchRequest,q=$('quickSearch').value.trim(),panel=$('previews');panel.hidden=false;$('quickSearch').setAttribute('aria-expanded','true');
  panel.innerHTML='<p class="no-results">Finding animals…</p>';
  clearTimeout(previewTimer);previewTimer=setTimeout(async()=>{
    try{const items=q?(await animalStore.search(q)).items.slice(0,6):animalStore.groups[0].ids.slice(0,6).map(id=>animalStore.items.get(id));if(request!==animalSearchRequest||speciesMode!=='animals'||panel.hidden)return;
      items.forEach(a=>{byId.set(a.id,a);byName.set(a.name,a);});panel.replaceChildren();
      const title=document.createElement('div');title.className='preview-title';title.textContent='Tap a photo to add or remove';const close=document.createElement('button');close.textContent='×';close.setAttribute('aria-label','Close search previews');close.onclick=closePreviews;title.append(close);panel.append(title);
      const grid=document.createElement('div');grid.className='preview-grid';items.forEach(a=>grid.append(card(a)));if(!items.length)grid.innerHTML='<p class="no-results">No animals found. Try a common or scientific name.</p>';panel.append(grid);
      const more=document.createElement('button');more.className='preview-footer';more.textContent='Browse animals →';more.onclick=()=>openPicker(q);panel.append(more);
    }catch(error){if(request===animalSearchRequest&&!panel.hidden&&speciesMode==='animals')panel.innerHTML='<p class="no-results">Search could not connect. Try again, or use Choose animals for the starter collection.</p>';}
  },q?350:0);
}
async function renderAnimalGrid(append=false){
  const request=++animalSearchRequest,q=$('pickerSearch').value.trim(),group=$('pickerRegion').value; if(!append)animalPage=1;
  $('moreAnimals').hidden=true;let items,total;
  if(!append)$('pokemonGrid').innerHTML='<p class="no-results">Finding animals…</p>';
  try{
    if(selectedOnly){items=[...selected].map(n=>byName.get(n)).filter(a=>a&&matches(a,q)&&(!group||a.ancestors.some(n=>String(n.id)===group)));total=items.length;}
    else if(!q&&!group){items=[...animalStore.items.values()].filter(a=>a.photo);total=items.length;}
    else{const result=await animalStore.search(q,group,animalPage);items=result.items;total=result.total;}
    if(request!==animalSearchRequest||speciesMode!=='animals'||!$('picker').open)return;
    items.forEach(a=>{byId.set(a.id,a);byName.set(a.name,a);});if(!append)$('pokemonGrid').replaceChildren();items.forEach(a=>$('pokemonGrid').append(card(a)));
    if(!items.length&&!append)$('pokemonGrid').innerHTML='<p class="no-results">No animals found. Try another name or group.</p>';
    const count=$('pokemonGrid').querySelectorAll('.pokemon-card').length;$('pickerCount').textContent=`${count} animals shown · ${selected.size} picked`;
    $('moreAnimals').hidden=selectedOnly||(!q&&!group)||!items.length||count>=total;
  }catch(error){if(request!==animalSearchRequest||speciesMode!=='animals')return;$('pickerCount').textContent='Search unavailable. Try again or choose All animals.';if(!append)$('pokemonGrid').innerHTML='<p class="no-results">Could not connect to iNaturalist. The starter collection is still available under All animals.</p>';}
}
$('moreAnimals').onclick=()=>{animalPage++;renderAnimalGrid(true);};
let animalPickRequest=0;
async function randomAnimals(){
  if(speciesMode!=='animals'||!animalReady)return;
  const request=++animalPickRequest;
  $('randomizeTop').disabled=true;$('surprise').disabled=true;
  announce('Choosing 5–10 animals from one branch…');
  try{
    const sample=await animalStore.sampleBranch(selected);
    if(request!==animalPickRequest||speciesMode!=='animals')return;
    if(!sample||sample.animals.length<5){announce('No branch with enough animals was available. Try again.');return;}
    syncAnimals();
    animalStore.pendingLabel=sample.node.common||sample.node.name;
    selected=new Set(sample.animals.map(animal=>animal.name).filter(name=>byName.get(name)?.photo));
    treeView.clades.clear();$('clearColors').hidden=true;updateSelection();
    announce(`${selected.size} species from ${animalStore.pendingLabel}.`);
  }catch(error){
    if(request===animalPickRequest)announce('Could not choose animals. Try Randomize again.');
  }finally{
    if(request===animalPickRequest){$('randomizeTop').disabled=false;$('surprise').disabled=false;}
  }
}
function bindPhotoSwipe(el, {onSwipe, onTap}={}){
  if(!el||el.dataset.swipeBound) return;
  el.dataset.swipeBound='1';
  let startX=0, startY=0, startT=0, tracking=false, swiped=false;
  const threshold=46;
  el.addEventListener('pointerdown',e=>{
    if(e.pointerType==='mouse'&&e.button!==0) return;
    if(e.target.closest('button,a')) return;
    tracking=true; swiped=false;
    startX=e.clientX; startY=e.clientY; startT=performance.now();
    try{el.setPointerCapture(e.pointerId);}catch{}
  });
  el.addEventListener('pointermove',e=>{
    if(!tracking) return;
    const dx=e.clientX-startX, dy=e.clientY-startY;
    if(!swiped&&Math.abs(dx)>threshold&&Math.abs(dx)>Math.abs(dy)*1.2){
      swiped=true;
      onSwipe?.(dx<0?1:-1);
    }
  });
  const end=e=>{
    if(!tracking) return;
    tracking=false;
    try{el.releasePointerCapture(e.pointerId);}catch{}
    if(swiped){e.preventDefault();e.stopPropagation();return;}
    const dx=e.clientX-startX, dy=e.clientY-startY, dt=performance.now()-startT;
    if(onTap&&dt<450&&Math.hypot(dx,dy)<12) onTap(e);
  };
  el.addEventListener('pointerup',end);
  el.addEventListener('pointercancel',()=>{tracking=false;swiped=false;});
}
function largerPhotoURL(url){
  return String(url||'').replace(/\/(square|small|medium|thumb)\./i,'/large.');
}
let lightboxState=null;
function ensurePhotoLightbox(){
  let box=$('photoLightbox');
  if(box) return box;
  box=document.createElement('div');
  box.id='photoLightbox';
  box.className='photo-lightbox';
  box.hidden=true;
  box.setAttribute('role','dialog');
  box.setAttribute('aria-modal','true');
  box.setAttribute('aria-label','Full screen photo');
  box.innerHTML='<button type="button" class="photo-lightbox-close" aria-label="Close full screen photo">×</button><button type="button" class="photo-lightbox-nav prev" data-lightbox-dir="-1" aria-label="Previous photo">‹</button><figure class="photo-lightbox-frame"><img alt="" referrerpolicy="no-referrer"><figcaption></figcaption></figure><button type="button" class="photo-lightbox-nav next" data-lightbox-dir="1" aria-label="Next photo">›</button>';
  document.body.append(box);
  const close=()=>closePhotoLightbox();
  box.querySelector('.photo-lightbox-close').onclick=close;
  box.addEventListener('click',e=>{if(e.target===box)close();});
  box.querySelectorAll('[data-lightbox-dir]').forEach(btn=>btn.onclick=e=>{e.stopPropagation();shiftPhotoLightbox(+btn.dataset.lightboxDir);});
  const frame=box.querySelector('.photo-lightbox-frame');
  bindPhotoSwipe(frame,{onSwipe:delta=>shiftPhotoLightbox(delta)});
  bindPhotoSwipe(box.querySelector('img'),{onSwipe:delta=>shiftPhotoLightbox(delta)});
  return box;
}
function paintPhotoLightbox(){
  if(!lightboxState)return;
  const {photos,title}=lightboxState;
  lightboxState.index=((lightboxState.index%photos.length)+photos.length)%photos.length;
  const shot=photos[lightboxState.index];
  const box=ensurePhotoLightbox();
  const img=box.querySelector('img');
  img.src=largerPhotoURL(shot.url||shot.photo||'');
  img.alt=shot.alt||title||'Photo';
  const credit=shot.credit?escapeHTML(shot.credit):'';
  const link=shot.link?'<a href="'+escapeHTML(shot.link)+'" target="_blank" rel="noopener">Open source ↗</a>':'';
  const count=photos.length>1?(lightboxState.index+1)+' / '+photos.length:'';
  box.querySelector('figcaption').innerHTML='<strong>'+escapeHTML(title||shot.alt||'Photo')+'</strong>'+(count?'<span>'+count+'</span>':'')+(credit||link?'<span>'+credit+(credit&&link?' · ':'')+link+'</span>':'');
  for(const btn of box.querySelectorAll('[data-lightbox-dir]')) btn.hidden=photos.length<2;
}
function openPhotoLightbox(photos,index=0,title=''){
  const list=(photos||[]).map(p=>typeof p==='string'?{url:p}:{...p,url:p.url||p.photo}).filter(p=>p.url);
  if(!list.length)return;
  lightboxState={photos:list,index:index||0,title:title||list[0].alt||''};
  const box=ensurePhotoLightbox();
  box.hidden=false;
  document.body.classList.add('lightbox-open');
  paintPhotoLightbox();
  box.querySelector('.photo-lightbox-close').focus();
}
function shiftPhotoLightbox(delta){
  if(!lightboxState||lightboxState.photos.length<2)return;
  lightboxState.index+=delta;
  paintPhotoLightbox();
}
function closePhotoLightbox(){
  const box=$('photoLightbox');
  if(box) box.hidden=true;
  document.body.classList.remove('lightbox-open');
  lightboxState=null;
}
document.addEventListener('keydown',e=>{
  if(!lightboxState)return;
  if(e.key==='Escape'){e.preventDefault();closePhotoLightbox();}
  if(e.key==='ArrowLeft'){e.preventDefault();shiftPhotoLightbox(-1);}
  if(e.key==='ArrowRight'){e.preventDefault();shiftPhotoLightbox(1);}
});
function mountAnimalGallery(animal,photos){
  const stage=$('animalPhotoStage'),credit=$('animalPhotoCredit');
  if(!stage)return;
  let index=0;
  const show=i=>{
    if(!photos.length)return;
    index=((i%photos.length)+photos.length)%photos.length;
    const shot=photos[index];
    const img=stage.querySelector('.animal-photo');
    if(img){
      img.src=shot.url;img.alt=animal.display;
      img.classList.add('photo-zoomable');
      img.title='Swipe for more · tap for full screen';
      img.setAttribute('role','button');
      img.tabIndex=0;
    }
    stage.dataset.index=String(index);
    const count=stage.querySelector('.photo-count');
    if(count)count.textContent=photos.length>1?`${index+1} / ${photos.length}`:'';
    if(credit)credit.innerHTML=`${escapeHTML(shot.credit||'Photo credit unavailable')} · <a href="${escapeHTML(shot.link)}" target="_blank" rel="noopener">Photo source ↗</a>`;
  };
  for(const sel of ['[data-photo-dir="-1"]','[data-photo-dir="1"]']){
    const btn=stage.querySelector(sel); if(!btn) continue;
    const next=btn.cloneNode(true); btn.replaceWith(next);
  }
  stage.querySelector('[data-photo-dir="-1"]')?.addEventListener('click',()=>show(index-1));
  stage.querySelector('[data-photo-dir="1"]')?.addEventListener('click',()=>show(index+1));
  delete stage.dataset.swipeBound;
  const img=stage.querySelector('.animal-photo');
  if(img) delete img.dataset.swipeBound;
  const open=()=>openPhotoLightbox(photos.map(p=>({...p,alt:animal.display})), index, animal.display);
  bindPhotoSwipe(stage,{
    onSwipe:delta=>{if(photos.length>1) show(index+delta);},
    onTap:e=>{if(e.target.closest('.animal-photo')) open();}
  });
  if(img){
    img.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}};
  }
  show(0);
}
async function openAnimal(animal){
  if(!animal||typeof animal!=='object')return;
  if(!animal.ancestors?.length){try{const full=await animalStore.hydrate(animal.id);if(full)animal=full;syncAnimals();}catch{}}
  animal.ancestors=animal.ancestors||[];
  const dialog=$('pokemonDetail'),esc=escapeHTML;
  const starter=animal.photos?.length?animal.photos:[{url:animal.photo||'',credit:animal.credit||'',link:animal.photoLink||`https://www.inaturalist.org/taxa/${animal.id}`}].filter(p=>p.url);
  const carousel=`<div class="detail-stage photo-carousel" id="animalPhotoStage" data-index="0"><button type="button" class="photo-nav prev" data-photo-dir="-1" aria-label="Previous iNaturalist photo" ${starter.length>1?'':'hidden'}>‹</button>${starter.length?`<img class="animal-photo" src="${esc(starter[0].url)}" alt="${esc(animal.display)}" referrerpolicy="no-referrer">`:'<span class="photo-missing">No photo yet</span>'}<button type="button" class="photo-nav next" data-photo-dir="1" aria-label="Next iNaturalist photo" ${starter.length>1?'':'hidden'}>›</button><span class="photo-count" ${starter.length>1?'':'hidden'}>1 / ${starter.length||1}</span></div>`;
  dialog.innerHTML=`<button class="close-button" id="closeDetail" aria-label="Close animal details">×</button><p class="eyebrow">REAL ANIMALS · OPEN TREE OF LIFE</p><h1 id="detailTitle">${esc(animal.display)}</h1><p class="scientific-name">${esc(animal.name)}</p>${carousel}<p class="detail-source" id="animalPhotoCredit">${esc((starter[0]&&starter[0].credit)||animal.credit||'Photo credit unavailable')} · <a href="${esc((starter[0]&&starter[0].link)||animal.photoLink||('https://www.inaturalist.org/taxa/'+animal.id))}" target="_blank" rel="noopener">Photo source ↗</a></p><div class="taxonomy-trail">${animal.ancestors.filter(n=>['phylum','class','order','family','genus'].includes(n.rank)).map(n=>`<button type="button" class="taxon-chip" data-taxon="${n.id}" aria-pressed="false"><small>${esc(n.rank)}</small><b>${esc(n.common||n.name)}</b><span>${esc(n.name)}</span></button>`).join('')}</div>${animal.summary?`<p class="animal-summary">${esc(animal.summary.length>=900?animal.summary.slice(0,animal.summary.lastIndexOf(' '))+'…':animal.summary)}</p><p class="detail-source">Wikipedia contributors via iNaturalist · <a href="${esc(animal.wiki||'https://www.wikipedia.org')}" target="_blank" rel="noopener">Source & history ↗</a> · CC BY-SA</p>`:''}<p>This animal’s place in the tree comes from the Open Tree of Life, so the order of splits stays the order from that tree. Branch lengths are DateLife ages in millions of years when a published chronogram covers every species shown. Otherwise the scale is synthetic and every species still lines up with Now.</p>${kinMarkup()}<div class="detail-actions"><a href="https://www.inaturalist.org/taxa/${animal.id}" target="_blank" rel="noopener">Photos & facts on iNaturalist ↗</a><button class="choose-button" id="detailPick"></button></div>${animal.wiki?`<p><a href="${esc(animal.wiki)}" target="_blank" rel="noopener">Read about this animal ↗</a></p>`:''}<p class="detail-note">Open Tree of Life supplies the branching order. DateLife supplies ages from published chronograms when this page is served locally and a chronogram covers the species. Map dots are sampled GBIF records; these photos come from iNaturalist taxon examples and may differ from mapped GBIF records.</p>`;
  $('closeDetail').onclick=hideDetail;$('detailPick').onclick=async()=>{const name=animal.name;await toggle(animal.id);if(!selected.has(name))hideDetail();};updateDetailButton();mountAnimalKin(animal);showDetail();$('closeDetail').focus();
  mountAnimalGallery(animal,starter);
  animalStore.gallery(animal).then(photos=>{
    if($('detailTitle')?.textContent!==animal.display)return;
    const stage=$('animalPhotoStage');
    if(!stage||!photos.length)return;
    for(const btn of stage.querySelectorAll('.photo-nav,.photo-count')) btn.hidden=photos.length<2;
    mountAnimalGallery(animal,photos);
  });
}
