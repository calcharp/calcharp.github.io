/* Taxon-ID ancestry merging adapted from Caleb Charpentier / Imageomics,
 * hdr-species-map-explorer (MIT). See vendor/species-map-explorer-LICENSE. */
function buildTaxonomy(animals) {
  const root={name:'Animals',label:'Animals',children:[],taxonId:1};
  for(const animal of animals) {
    let parent=root;
    for(const step of [...animal.ancestors,{id:animal.id,name:animal.name,rank:'species',common:animal.display}]) {
      if(step.id===1||step.name==='Life')continue;
      let node=parent.children.find(n=>n.taxonId===step.id);
      if(!node){node={taxonId:step.id,name:step.name,label:step.common||step.name,rank:step.rank,children:[]};parent.children.push(node);}
      parent=node;
    }
  }
  function finish(n){if(!n.children.length)delete n.children;else n.children.forEach(finish);}finish(root);
  return root;
}
function animalToSpecies(a) {return {...a,real:true,types:[a.ancestors.find(n=>n.rank==='class')?.common||a.ancestors.find(n=>n.rank==='class')?.name||'Animal'],region:a.group||'More animals'};}
function cleanOttLabel(raw){
  const text=String(raw||'').trim();
  if(!text) return {label:'',ottId:null};
  const ids=[...text.matchAll(/ott(\d+)/gi)].map(match=>+match[1]);
  const ottId=ids.length?ids.at(-1):null;
  if(/mrcaott/i.test(text)) return {label:'',ottId};
  let label=text.replace(/_ott\d+$/i,'').replace(/\s+ott\d+$/i,'').replace(/_/g,' ').replace(/\s*\(in [^)]*\)/ig,'').trim();
  if(/^n\d+$/i.test(label)) label='';
  return {label,ottId};
}
function parseNewick(text){
  let i=0; const s=String(text).trim();
  function parseNode(){
    while(s[i]===' '||s[i]==='\n'||s[i]==='\t') i++;
    let children=null;
    if(s[i]==='('){i++;children=[parseNode()];while(s[i]===','){i++;children.push(parseNode());}if(s[i]===')')i++;}
    let raw='';
    if(s[i]==="'"){i++;while(i<s.length){if(s[i]==="'"&&s[i+1]==="'"){raw+="'";i+=2;continue;}if(s[i]==="'"){i++;break;}raw+=s[i++];}}
    else while(i<s.length&&!'(),;:'.includes(s[i])) raw+=s[i++];
    let length=null;
    if(s[i]===':'){i++;let num='';while(i<s.length&&!'(),;'.includes(s[i]))num+=s[i++];const parsed=Number(num);if(Number.isFinite(parsed))length=parsed;}
    const cleaned=cleanOttLabel(raw);
    const node={name:cleaned.label,label:cleaned.label,ottId:cleaned.ottId,length};
    if(children) node.children=children;
    return node;
  }
  return parseNode();
}
function collapseUnary(node){
  if(!node?.children) return node;
  node.children=node.children.map(collapseUnary).filter(Boolean);
  if(node.children.length===1){const child=node.children[0];if(!child.label&&node.label)child.label=node.label;if(Number.isFinite(node.length))child.length=(Number.isFinite(child.length)?child.length:0)+node.length;return child;}
  return node;
}
// DateLife chronograms are picky about tip spelling; keep Genus species binomials.
function canonicalBinomial(name){
  const cleaned=String(name||'').replace(/_/g,' ').replace(/\s*\([^)]*\)/g,' ').replace(/\s+/g,' ').trim();
  const parts=cleaned.split(' ').filter(Boolean);
  if(parts.length<2||!/^[A-Za-z-]+$/.test(parts[0])||!/^[A-Za-z-]+$/.test(parts[1])) return '';
  return parts[0].charAt(0).toUpperCase()+parts[0].slice(1).toLowerCase()+' '+parts[1].toLowerCase();
}
function dateQueryName(name){
  return canonicalBinomial(name)||String(name||'').replace(/_/g,' ').trim();
}
function attachTips(node,byOtt){
  if(!node?.children){
    const animals=byOtt.get(node?.ottId)||[];
    if(!animals.length) return null;
    if(animals.length===1) return {name:animals[0].name,label:animals[0].display,ottId:animals[0].ottId,ottName:animals[0].ottName||animals[0].name};
    return {label:'',ottId:node.ottId,children:animals.map(animal=>({name:animal.name,label:animal.display,ottId:animal.ottId,ottName:animal.ottName||animal.name}))};
  }
  const children=node.children.map(child=>attachTips(child,byOtt)).filter(Boolean);
  if(!children.length) return null;
  return {name:node.label||'Ancestor',label:node.label||'',ottId:node.ottId,children};
}
function bestOttMatch(result,query){
  const matches=result?.matches||[];
  const taxon=match=>match.taxon||{};
  const name=match=>(taxon(match).unique_name||taxon(match).name||'').toLowerCase();
  return matches.find(match=>!match.is_synonym&&taxon(match).rank==='species'&&name(match)===query.toLowerCase())
    ||matches.find(match=>!match.is_synonym&&taxon(match).rank==='species')
    ||matches.find(match=>taxon(match).rank==='species')
    ||matches[0]
    ||null;
}
function photoLoads(url,timeout=4000){
  return new Promise(resolve=>{
    if(!url){resolve(false);return;}
    const image=new Image();let settled=false;
    const finish=ok=>{if(settled)return;settled=true;clearTimeout(timer);resolve(ok);};
    const timer=setTimeout(()=>finish(false),timeout);
    image.onload=()=>finish(image.naturalWidth>0&&image.naturalHeight>0);
    image.onerror=()=>finish(false);
    image.referrerPolicy='no-referrer';
    image.src=url;
  });
}
class AnimalStore {
  constructor(){this.items=new Map();this.cache=new Map();this.pending=0;this.waiters=[];this.treeCache=new Map();this.dateCache=new Map();this.synonymCache=new Map();this.pendingLabel='';}
  async json(url) {
    if(this.cache.has(url))return this.cache.get(url);
    const promise=(async()=>{
      if(this.pending>=3)await new Promise(resolve=>this.waiters.push(resolve));this.pending++;
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
      try {const response=await fetch(url,{signal:controller.signal});if(!response.ok)throw Error(`Data service unavailable (${response.status}).`);return await response.json();}
      finally{clearTimeout(timer);this.pending--;this.waiters.shift()?.();}
    })();this.cache.set(url,promise);
    try{return await promise;}catch(error){this.cache.delete(url);throw error;}
  }
  async init(){const response=await fetch('animals.json');if(!response.ok)throw Error('Animal collection unavailable.');const data=await response.json();this.groups=data.groups;this.snapshotDate=data.snapshotDate;this.nodes=[];data.animals.forEach(a=>this.items.set(a.id,animalToSpecies(a)));try{const nodeResponse=await fetch('animal-nodes.json');if(nodeResponse.ok){const catalog=await nodeResponse.json();this.nodes=catalog.nodes||[];}}catch{}try{JSON.parse(localStorage.getItem('animal-discovery-cache')||'[]').forEach(a=>{if(a.id&&a.name&&Array.isArray(a.ancestors)&&(a.hydrated||a.photo))this.items.set(a.id,a);});}catch{}return this;}
  save(){try{localStorage.setItem('animal-discovery-cache',JSON.stringify([...this.items.values()].filter(a=>a.hydrated||a.photoOk).slice(-150)));}catch{}}
  photoEntry(p,taxonId){
    if(!p)return null;
    const url=p.medium_url||p.url?.replace('/square.','/medium.')||p.url||'';
    if(!url)return null;
    return {id:p.id||null,url,credit:p.attribution||'',link:p.id?`https://www.inaturalist.org/photos/${p.id}`:`https://www.inaturalist.org/taxa/${taxonId}`,cc:!!p.license_code?.startsWith('cc')};
  }
  normalize(t){
    const seen=new Set(),gallery=[];
    for(const raw of [t.default_photo,...(t.taxon_photos||[]).map(p=>p.photo)]){
      const entry=this.photoEntry(raw,t.id);
      if(!entry)continue;
      const key=String(entry.id||entry.url);
      if(seen.has(key))continue;
      seen.add(key);gallery.push(entry);
    }
    const photo=gallery.find(p=>p.cc)||gallery[0];
    const summary=new DOMParser().parseFromString(t.wikipedia_summary||'','text/html').body.textContent.slice(0,900);
    return animalToSpecies({id:t.id,name:t.name,display:t.preferred_common_name||t.name,rank:t.rank,ancestors:(t.ancestors||[]).filter(a=>a.name!=='Life').map(a=>({id:a.id,name:a.name,rank:a.rank,common:a.preferred_common_name||''})),photo:photo?.url||'',credit:photo?.credit||'',photoLink:photo?.link||`https://www.inaturalist.org/taxa/${t.id}`,photos:gallery.map(({id,url,credit,link})=>({id,url,credit,link})),wiki:t.wikipedia_url,summary,observations:t.observations_count,hydrated:!!t.ancestors,points:null});
  }
  async gallery(animal){
    if(animal.photos?.length>1||(animal.photos?.length===1&&animal.galleryReady))return animal.photos;
    try{
      const result=await this.json(`https://api.inaturalist.org/v1/taxa/${animal.id}?locale=en`);
      const taxon=result.results?.[0];
      if(taxon){
        const next=this.normalize({...taxon,ancestors:taxon.ancestors||animal.ancestors});
        animal.photos=next.photos||[];
        if(next.photo){animal.photo=next.photo;animal.credit=next.credit;animal.photoLink=next.photoLink;}
        animal.galleryReady=true;animal.hydrated=true;this.items.set(animal.id,animal);this.save();
      }
    }catch{}
    if(!animal.photos?.length&&animal.photo){
      animal.photos=[{id:null,url:animal.photo,credit:animal.credit||'',link:animal.photoLink||`https://www.inaturalist.org/taxa/${animal.id}`}];
    }
    animal.galleryReady=true;
    return animal.photos||[];
  }
  async search(query='',group='',page=1){
    const params=new URLSearchParams({q:query,taxon_id:group||'1',rank:'species',is_active:'true',per_page:'24',page:String(page),order_by:'observations_count',locale:'en'});
    const data=await this.json('https://api.inaturalist.org/v1/taxa?'+params);
    const items=(data.results||[]).filter(t=>t.rank==='species'&&t.is_active!==false&&!t.extinct&&(t.ancestor_ids||[]).includes(1)&&(t.default_photo?.medium_url||t.default_photo?.url)).map(t=>{const existing=this.items.get(t.id);if(existing)return existing;const animal=this.normalize(t);if(!animal.photo)return null;this.items.set(animal.id,animal);return animal;}).filter(Boolean);
    return {items,total:data.total_results||0};
  }
  async hydrate(id){let animal=this.items.get(id);if(!animal)throw Error('Animal not found.');if(animal.ancestors?.length&&animal.hydrated)return animal;
    const result=await this.json(`https://api.inaturalist.org/v1/taxa/${id}?locale=en`);const taxon=result.results?.[0];if(!taxon||taxon.rank!=='species'||!(taxon.ancestor_ids||[]).includes(1))throw Error('No animal taxonomy available for this species.');animal=this.normalize(taxon);animal.hydrated=true;this.items.set(id,animal);this.save();return animal;
  }
  occurrenceFields(r){
    const media=(r.media||[]).find(m=>m.type==='StillImage'&&(m.identifier||m.references));
    return {
      lat:r.decimalLatitude,lng:r.decimalLongitude,key:r.key,
      publisher:r.datasetName||r.institutionCode||'GBIF data publisher',
      photo:media?.identifier||'',
      photoLink:media?.references||`https://www.gbif.org/occurrence/${r.key}`,
      locality:[r.locality,r.country].filter(Boolean).join(' · '),
      date:(r.eventDate||'').slice(0,10),
      recordedBy:r.recordedBy||''
    };
  }
  async occurrences(animal){
    if(Array.isArray(animal.points)){if(animal.points.length>100){animal.points=animal.points.slice(0,100);this.save();}return animal.points;}
    if(!animal.gbifKey){const match=await this.json('https://api.gbif.org/v1/species/match?'+new URLSearchParams({name:animal.name,kingdom:'Animalia',strict:'true'}));
      if(match.matchType!=='EXACT'||match.rank!=='SPECIES'||match.kingdom!=='Animalia')throw Error('No exact GBIF species match.');animal.gbifKey=match.acceptedUsageKey||match.usageKey;
    }
    const records=await this.json('https://api.gbif.org/v1/occurrence/search?'+new URLSearchParams({taxonKey:animal.gbifKey,hasCoordinate:'true',hasGeospatialIssue:'false',occurrenceStatus:'PRESENT',limit:'100'}));
    animal.points=(records.results||[]).filter(r=>Number.isFinite(r.decimalLatitude)&&Math.abs(r.decimalLatitude)<=90&&Number.isFinite(r.decimalLongitude)&&Math.abs(r.decimalLongitude)<=180).slice(0,100).map(r=>this.occurrenceFields(r));animal.occurrenceCount=Math.min(records.count||animal.points.length,100);this.save();return animal.points;
  }
  async occurrencePreview(record){
    if(record.previewReady)return record;
    try{
      const detail=await this.json(`https://api.gbif.org/v1/occurrence/${record.key}`);
      const fields=this.occurrenceFields(detail);
      Object.assign(record,{photo:record.photo||fields.photo,photoLink:fields.photoLink||record.photoLink,locality:record.locality||fields.locality,date:record.date||fields.date,recordedBy:record.recordedBy||fields.recordedBy,publisher:record.publisher||fields.publisher,previewReady:true});
    }catch{
      record.previewReady=true;
    }
    return record;
  }
  async relatives(taxonId,query=''){
    const params=new URLSearchParams({q:query,taxon_id:String(taxonId),rank:'species',is_active:'true',per_page:'12',page:'1',order_by:'observations_count',order:'desc',locale:'en'});
    const data=await this.json('https://api.inaturalist.org/v1/taxa?'+params);
    return (data.results||[]).filter(t=>t.rank==='species'&&t.is_active!==false&&!t.extinct&&(t.ancestor_ids||[]).includes(1)&&(t.default_photo?.medium_url||t.default_photo?.url)).slice(0,12).map(t=>{const existing=this.items.get(t.id);if(existing?.photo&&existing.ancestors?.length)return existing;const animal=this.normalize(t);if(!animal.photo)return null;if(existing){animal.points=existing.points;animal.gbifKey=existing.gbifKey;animal.ottId=existing.ottId;animal.ottName=existing.ottName;}this.items.set(animal.id,animal);return animal;}).filter(Boolean);
  }
  shuffle(list){for(let i=list.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[list[i],list[j]]=[list[j],list[i]];}return list;}
  usableSpecies(results){return (results||[]).filter(t=>t.rank==='species'&&t.is_active!==false&&!t.extinct&&t.name&&(t.ancestor_ids||[]).includes(1)&&(t.default_photo?.medium_url||t.default_photo?.url));}
  async confirmPhoto(animal,timeout=4000){
    if(!animal?.photo){if(animal)animal.photoOk=false;return false;}
    if(animal.photoOk===true) return true;
    if(animal.photoOk===false) return false;
    animal.photoOk=await photoLoads(animal.photo,timeout);
    return animal.photoOk;
  }
  async withPhotos(animals){
    return (animals||[]).filter(animal=>animal?.photo);
  }
  // Resolve once `count` photos have loaded. A slow image does not hold up the ones already on screen.
  async firstLoaded(animals,count){
    const needed=Math.min(count,animals.length);
    const good=[];
    if(!needed) return good;
    await new Promise(resolve=>{
      let settled=0,opened=false;
      const finish=()=>{if(opened)return;opened=true;resolve();};
      for(const animal of animals) this.confirmPhoto(animal,2500).then(ok=>{settled++;if(ok)good.push(animal);if(good.length>=needed||settled===animals.length)finish();});
    });
    return good;
  }
  async post(url,body){
    const key='POST '+url+' '+JSON.stringify(body);
    if(this.cache.has(key)) return this.cache.get(key);
    const promise=(async()=>{
      if(this.pending>=3) await new Promise(resolve=>this.waiters.push(resolve));this.pending++;
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
      try{const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(body),signal:controller.signal});const text=await response.text();if(!response.ok){const error=Error('Open Tree of Life unavailable ('+response.status+').');error.body=text;throw error;}return JSON.parse(text);}
      finally{clearTimeout(timer);this.pending--;this.waiters.shift()?.();}
    })();
    this.cache.set(key,promise);
    try{return await promise;}catch(error){this.cache.delete(key);throw error;}
  }
  async ensureOtt(animals){
    const pending=animals.filter(animal=>animal&&!animal.ottMiss&&(animal.ottId==null||!animal.ottName));
    if(!pending.length) return;
    const data=await this.post('https://api.opentreeoflife.org/v3/tnrs/match_names',{names:[...new Set(pending.map(animal=>animal.name))],context_name:'Animals',do_approximate_matching:false});
    const byName=new Map((data.results||[]).map(result=>[result.name,result]));
    for(const animal of pending){
      const match=bestOttMatch(byName.get(animal.name),animal.name);
      if(match?.taxon?.ott_id){animal.ottId=match.taxon.ott_id;animal.ottName=match.taxon.name||animal.name;}
      else if(animal.ottId==null) animal.ottMiss=true;
    }
  }
  async inducedSubtree(ottIds){
    let ids=[...new Set(ottIds)];
    for(let attempt=0;attempt<3&&ids.length;attempt++){
      try{const data=await this.post('https://api.opentreeoflife.org/v3/tree_of_life/induced_subtree',{ott_ids:ids});if(!data.newick)throw Error('Open Tree of Life returned no tree.');return data.newick;}
      catch(error){
        const missing=[...String(error.body||'').matchAll(/\b\d{3,}\b/g)].map(match=>+match[0]);
        const next=ids.filter(id=>!missing.includes(id));
        if(!missing.length||next.length===ids.length) throw error;
        ids=next;
      }
    }
    throw Error('Open Tree of Life could not place these species.');
  }
  tipNamesOf(node,names=new Set()){
    if(!node) return names;
    if(!node.children){if(node.name)names.add(node.name);return names;}
    node.children.forEach(child=>this.tipNamesOf(child,names));
    return names;
  }
  inatTaxonomyTree(animals){
    const list=(animals||[]).filter(animal=>animal?.name&&animal.ancestors?.length);
    if(!list.length){
      const only=(animals||[]).filter(animal=>animal?.name);
      if(only.length===1) return {name:only[0].name,label:only[0].display,ottId:only[0].ottId,taxonomySource:'inat'};
      return {name:'Animals',label:'Animals',taxonomySource:'inat'};
    }
    if(list.length===1) return {name:list[0].name,label:list[0].display,ottId:list[0].ottId,taxonomySource:'inat'};
    const tree=buildTaxonomy(list);
    tree.taxonomySource='inat';
    if(!tree.label) tree.label='Animals';
    return tree;
  }
  async openTree(animals){
    const list=(animals||[]).filter(animal=>animal?.name);
    if(!list.length) return {name:'Animals',label:'Animals'};
    if(list.length===1) return {name:list[0].name,label:list[0].display,ottId:list[0].ottId};
    const key='open:'+list.map(animal=>animal.name).sort().join('|');
    if(this.treeCache.has(key)) return this.treeCache.get(key);
    const finish=tree=>{this.treeCache.set(key,tree);return tree;};
    const byOtt=new Map();
    for(const animal of list){
      if(!animal?.ottId) continue;
      const group=byOtt.get(animal.ottId)||[];
      if(!group.some(item=>item.name===animal.name)) group.push(animal);
      byOtt.set(animal.ottId,group);
    }
    const ids=[...byOtt.keys()];
    // Species pruned from the synthetic Open Tree (common for incertae sedis) need a taxonomy fallback.
    if(ids.length>=2){
      try{
        let tree=attachTips(collapseUnary(parseNewick(await this.inducedSubtree(ids))),byOtt);
        tree=collapseUnary(tree)||{name:'Animals',label:'Animals'};
        if(!tree.label) tree.label='Animals';
        const placed=this.tipNamesOf(tree);
        if(list.every(animal=>placed.has(animal.name))) return finish(tree);
      }catch{}
    }
    return finish(this.inatTaxonomyTree(list));
  }
  newickOf(node){
    if(!node?.children) return String(node?.name||'').replace(/\s+/g,'_');
    return '('+node.children.map(child=>this.newickOf(child)).join(',')+')';
  }
  chronogramAges(newick){
    const dated=collapseUnary(parseNewick(newick));
    if(!dated) return null;
    const height=node=>{
      if(!node.children){node.age=0;return 0;}
      node.children.forEach(height);
      node.age=Math.max(...node.children.map(child=>(Number.isFinite(child.length)?child.length:0)+child.age));
      return node.age;
    };
    const tipNames=node=>node.children?node.children.flatMap(tipNames):[String(node.label||node.name||'').toLowerCase()];
    height(dated);
    if(!(dated.age>0)) return null;
    const heights=new Map();
    const walk=node=>{
      const names=tipNames(node).filter(Boolean).sort();
      if(names.length) heights.set(names.join('|'), node.age||0);
      if(node.children) node.children.forEach(walk);
    };
    walk(dated);
    return {crown:dated.age,heights,root:dated};
  }
  datingTree(node){
    if(!node) return null;
    if(!node.children){
      const query=dateQueryName(node.ottName||node.name);
      return {name:query,label:query};
    }
    const children=[];const seen=new Set();
    for(const child of node.children){
      const next=this.datingTree(child);
      if(!next) continue;
      const key=String(next.name||next.label||'').toLowerCase();
      if(!next.children&&seen.has(key)) continue;
      if(!next.children) seen.add(key);
      children.push(next);
    }
    if(!children.length) return null;
    if(children.length===1) return children[0];
    return {children};
  }
  // Same idea as HDR species-map-explorer OneZoom resolve: walk GBIF synonyms for chronogram tip matching.
  async synonymNames(name,gbifKey=null){
    const primary=dateQueryName(name);
    const cacheKey=primary.toLowerCase();
    if(!cacheKey) return [];
    if(this.synonymCache.has(cacheKey)) return this.synonymCache.get(cacheKey);
    const promise=(async()=>{
      const names=[];
      const add=value=>{
        const binomial=canonicalBinomial(value);
        if(binomial&&!names.some(item=>item.toLowerCase()===binomial.toLowerCase())) names.push(binomial);
      };
      add(primary);
      try{
        let key=gbifKey;
        if(!key){
          const match=await this.json('https://api.gbif.org/v1/species/match?'+new URLSearchParams({name:primary,kingdom:'Animalia'}));
          if(match?.matchType&&match.matchType!=='NONE'&&(match.rank==='SPECIES'||match.rank==='SUBSPECIES')) key=match.acceptedUsageKey||match.usageKey;
        }
        if(!key) return names;
        const [sp,synonyms]=await Promise.all([
          this.json(`https://api.gbif.org/v1/species/${key}`),
          this.json(`https://api.gbif.org/v1/species/${key}/synonyms?limit=40`)
        ]);
        add(sp?.canonicalName);add(sp?.species);add(sp?.scientificName);
        const rows=Array.isArray(synonyms)?synonyms:(synonyms?.results||[]);
        for(const syn of rows){add(syn.canonicalName);add(syn.scientificName);add(syn.species);}
      }catch{}
      const genus=primary.split(' ')[0];
      const moved=names.filter(item=>item!==primary&&item.split(' ')[0]!==genus);
      const same=names.filter(item=>item!==primary&&item.split(' ')[0]===genus);
      // Matching can use any synonym; query retries only try genus moves (pre-split names).
      return {all:[primary,...moved,...same],query:[primary,...moved.slice(0,3)]};
    })();
    this.synonymCache.set(cacheKey,promise);
    try{return await promise;}catch{this.synonymCache.delete(cacheKey);return primary?{all:[primary],query:[primary]}:{all:[],query:[]};}
  }
  async datingAliases(tree){
    const tips=[];
    const walk=node=>{
      if(!node) return;
      if(!node.children){tips.push({name:node.ottName||node.name,gbifKey:node.gbifKey||null});return;}
      node.children.forEach(walk);
    };
    walk(tree);
    const aliasMap=new Map();
    const candidates=[];
    await Promise.all(tips.map(async tip=>{
      const primary=dateQueryName(tip.name);
      if(!primary) return;
      const animal=[...this.items.values()].find(item=>(item.ottName||item.name)===tip.name||item.name===tip.name);
      const synonyms=await this.synonymNames(primary,tip.gbifKey||animal?.gbifKey||null);
      const lower=(synonyms.all||[]).map(name=>name.toLowerCase());
      const index=name=>{const key=String(name||'').toLowerCase().replace(/_/g,' ').replace(/\s+/g,' ').trim();if(key) aliasMap.set(key,lower);};
      index(primary);index(tip.name);index(animal?.name);index(animal?.ottName);
      candidates.push({tip:primary.toLowerCase(),raw:tip.name,aliases:synonyms.query||[primary]});
    }));
    return {aliasMap,candidates};
  }
  applyDates(tree,dated){
    if(!tree||!dated?.root) return false;
    const norm=name=>String(name||'').toLowerCase().replace(/_/g,' ').replace(/\s+/g,' ').trim();
    const binomial=name=>{const parts=norm(name).split(' ').filter(Boolean);return parts.length>=2?parts[0]+' '+parts[1]:norm(name);};
    const dateName=node=>norm(node.ottName||node.name||node.label||'');
    const tipNames=node=>node.children?node.children.flatMap(tipNames):[dateName(node)];
    const present=new Set();
    const gather=node=>{if(!node.children){const name=norm(node.label||node.name||'');if(name)present.add(name);}else node.children.forEach(gather);};
    gather(dated.root);
    const aliasesFor=tip=>{
      const name=norm(tip);
      const fromMap=dated.aliases?.get(name)||dated.aliases?.get(binomial(name))||[];
      return [...new Set([name,binomial(name),...fromMap].filter(Boolean))];
    };
    // DateLife often drops subspecies, rare species, or spelling variants.
    const resolve=tip=>{
      const name=norm(tip); if(!name) return null;
      if(present.has(name)) return name;
      const bin=binomial(name); if(present.has(bin)) return bin;
      for(const alias of aliasesFor(name)){
        if(present.has(alias)) return alias;
        const aliasBin=binomial(alias); if(present.has(aliasBin)) return aliasBin;
      }
      for(const item of present){
        if(name.startsWith(item+' ')||item.startsWith(name+' ')||binomial(item)===bin) return item;
        for(const alias of aliasesFor(name)){
          if(alias.startsWith(item+' ')||item.startsWith(alias+' ')||binomial(item)===binomial(alias)) return item;
        }
      }
      return null;
    };
    const mrcaAge=need=>{
      const wanted=[...new Set((need||[]).map(norm).filter(Boolean))];
      if(!wanted.length) return null;
      if(wanted.length===1){
        let singleton=null;
        const find=node=>{
          if(!node.children) return [norm(node.label||node.name||'')];
          const names=node.children.flatMap(find);
          if(!singleton&&wanted.every(n=>names.includes(n))&&names.every(n=>wanted.includes(n))) singleton=node;
          return names;
        };
        find(dated.root);
        return singleton?singleton.age:0;
      }
      let best=null;
      const walk=node=>{
        if(!node.children) return [norm(node.label||node.name||'')];
        const names=[];
        let nested=false;
        for(const child of node.children){
          const found=walk(child);
          names.push(...found);
          if(!nested&&wanted.every(name=>found.includes(name))) nested=true;
        }
        if(!nested&&wanted.every(name=>names.includes(name))) best=node;
        return names;
      };
      walk(dated.root);
      return best?best.age:null;
    };
    const nodes=[];
    const collect=node=>{nodes.push(node);if(node.children)node.children.forEach(collect);};
    collect(tree);
    const tips=[...new Set(tipNames(tree).filter(Boolean))];
    if(tips.length<2) return false;
    const tipMap=new Map();
    for(const tip of tips){const hit=resolve(tip);if(hit) tipMap.set(tip,hit);}
    // Galagos and many clades only get partial chronograms; still date whatever DateLife covered.
    if(tipMap.size<2) return false;
    const ageFor=names=>{
      const covered=[...new Set(names.map(name=>tipMap.get(name)).filter(Boolean))];
      if(covered.length<=1) return covered.length?0:null;
      return mrcaAge(covered);
    };
    for(const node of nodes){
      const names=[...new Set(tipNames(node).filter(Boolean))];
      const covered=names.filter(name=>tipMap.has(name));
      if(names.length<=1){node.age=0;node.keepAge=true;node.dated=true;continue;}
      if(!covered.length) continue;
      const age=ageFor(covered);
      if(!(age>=0)) continue;
      node.age=age;node.keepAge=true;node.dated=true;
      if(covered.length<names.length) node.partialDate=true;
    }
    // Fill parents that DateLife did not name but whose children are now dated.
    let changed=true;
    while(changed){
      changed=false;
      for(const node of nodes){
        if(node.keepAge||!node.children?.length) continue;
        if(!node.children.every(child=>child.keepAge)) continue;
        node.age=Math.max(...node.children.map(child=>child.age||0));
        node.keepAge=true;node.dated=true;changed=true;
      }
    }
    if(!tree.keepAge){
      const ages=nodes.filter(node=>node.keepAge).map(node=>node.age||0);
      if(ages.length){tree.age=Math.max(dated.crown||0,...ages);tree.keepAge=true;tree.dated=true;}
    }
    const stub=Math.min(0.45,Math.max(0.05,(tree.age||dated.crown||1)*0.08));
    for(const node of nodes){
      if(node.children&&node.children.length>1&&node.age===0&&node.keepAge){
        const childAges=node.children.map(child=>child.age||0);
        if(node.children.every(child=>!child.children)||childAges.every(age=>age===0)){node.age=stub;node.layoutAge=true;}
      }
    }
    tree.dated=!!tree.keepAge;
    tree.dateCoverage=tipMap.size/tips.length;
    tree.dateSource=dated.source==='catalog'?'catalog':'datelife';
    return tree.age>0&&tree.dated;
  }
  chronogramCoverage(dated,chosen,aliasMap){
    if(!dated?.root||!chosen?.length) return {coverage:0,missing:chosen||[]};
    const present=new Set();
    const gather=node=>{if(!node.children){const name=String(node.label||node.name||'').toLowerCase().replace(/_/g,' ').trim();if(name)present.add(name);}else node.children.forEach(gather);};
    gather(dated.root);
    const hit=name=>{
      const norm=String(name||'').toLowerCase().replace(/_/g,' ').trim();
      if(!norm) return false;
      if(present.has(norm)) return true;
      const aliases=aliasMap?.get(norm)||[];
      return aliases.some(alias=>present.has(alias)||present.has(String(alias).split(' ').slice(0,2).join(' ')));
    };
    const missing=chosen.filter(entry=>!hit(entry.query)&&!hit(entry.tip)&&!hit(entry.raw));
    return {coverage:(chosen.length-missing.length)/chosen.length,missing,present};
  }
  datingApiAvailable(){
    // Local serve.py hosts /api/*; GitHub Pages does not.
    const host=String(globalThis.location?.hostname||'');
    return host==='127.0.0.1'||host==='localhost'||host.endsWith('.local');
  }
  async fetchChronogram(queryTips){
    if(!this.datingApiAvailable()) return null;
    const unique=[...new Set((queryTips||[]).map(name=>dateQueryName(name)).filter(Boolean))];
    if(unique.length<2) return null;
    try{
      const response=await fetch('/api/datelife',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({newick:'('+unique.map(name=>String(name).replace(/\s+/g,'_')).join(',')+');'})});
      if(!response.ok) return null;
      const payload=await response.json();
      return payload.newick?this.chronogramAges(payload.newick):null;
    }catch{return null;}
  }
  async loadChronogramCatalog(){
    if(this.chronoCatalog) return this.chronoCatalog;
    try{
      const data=await this.json('chronograms/catalog.json');
      this.chronoCatalog=data&&Array.isArray(data.trees)?data:{trees:[]};
    }catch{this.chronoCatalog={trees:[]};}
    return this.chronoCatalog;
  }
  async staticChronogramDates(names,aliasMap=new Map()){
    const tips=[...new Set((names||[]).map(dateQueryName).filter(Boolean))];
    if(tips.length<2) return null;
    const catalog=await this.loadChronogramCatalog();
    const chosen=tips.map(name=>({tip:name.toLowerCase(),raw:name,query:name,aliases:[name,...(aliasMap.get(name.toLowerCase())||[])]}));
    let best=null;
    for(const entry of catalog.trees||[]){
      if(!entry?.newick) continue;
      const dated=this.chronogramAges(entry.newick);
      if(!dated) continue;
      dated.aliases=aliasMap;
      dated.source='catalog';
      dated.catalogId=entry.id;
      const {coverage}=this.chronogramCoverage(dated,chosen,aliasMap);
      const hits=Math.round(coverage*chosen.length);
      if(hits<2) continue;
      if(!best||hits>best.hits||(hits===best.hits&&coverage>best.coverage)) best={dated,hits,coverage};
    }
    return best?.dated||null;
  }
  async refineChronogram(candidates,aliasMap){
    const chosen=candidates.map(entry=>({...entry,index:0,query:entry.aliases[0]||dateQueryName(entry.raw)}));
    let best=null;
    const advance=entry=>{
      const primary=entry.aliases[0]||'';
      const genus=primary.split(' ')[0];
      let next=entry.aliases.findIndex((alias,i)=>i>entry.index&&alias.split(' ')[0]!==genus);
      if(next<0) next=entry.index+1;
      if(next>=entry.aliases.length) return false;
      entry.index=next;entry.query=entry.aliases[next];
      return true;
    };
    for(let attempt=0;attempt<5;attempt++){
      const dated=await this.fetchChronogram(chosen.map(entry=>entry.query));
      if(!dated){
        const entry=chosen.find(item=>{
          const primary=item.aliases[0]||'';
          const genus=primary.split(' ')[0];
          return item.aliases.some((alias,i)=>i>item.index&&alias.split(' ')[0]!==genus);
        });
        if(!entry||!advance(entry)) break;
        continue;
      }
      dated.aliases=aliasMap;
      const {coverage,missing}=this.chronogramCoverage(dated,chosen,aliasMap);
      if(!best||coverage>best.coverage) best={dated,coverage};
      if(!missing.length) return dated;
      let moved=false;
      for(const entry of missing) if(advance(entry)) moved=true;
      if(!moved) return best.dated;
    }
    return best?.dated||null;
  }
  async dateTree(tree){
    const datedTree=this.datingTree(tree)||tree;
    const names=[];
    const collect=node=>{if(!node?.children){if(node?.name)names.push(node.name);}else node.children.forEach(collect);};
    collect(datedTree);
    if(names.length<2) return Promise.resolve(null);
    const key=names.slice().sort().join('|');
    if(this.dateCache.has(key)) return this.dateCache.get(key);
    const promise=(async()=>{
      try{
        const primary=names.map(name=>{
          const query=dateQueryName(name);
          return {tip:query.toLowerCase(),raw:name,aliases:[query]};
        }).filter(entry=>entry.aliases[0]);
        let aliasMap=new Map();
        // 1) Live DateLife via serve.py (skipped on GitHub Pages).
        let dated=await this.refineChronogram(primary,aliasMap);
        let coverage=dated?this.chronogramCoverage(dated,primary.map(entry=>({...entry,query:entry.aliases[0]})),aliasMap).coverage:0;
        if(this.datingApiAvailable()&&(!dated||coverage<0.5)){
          const syn=await this.datingAliases(tree);
          aliasMap=syn.aliasMap;
          const withSyn=await this.refineChronogram(syn.candidates,aliasMap);
          const synCov=withSyn?this.chronogramCoverage(withSyn,syn.candidates.map(entry=>({...entry,query:entry.aliases[0]})),aliasMap).coverage:0;
          if(withSyn&&(!dated||synCov>coverage)){dated=withSyn;coverage=synCov;}
          if(dated) dated.aliases=aliasMap;
        }
        if(dated&&coverage>=0.5) return dated;
        // 2) Packaged chronograms — works on GitHub Pages / iPads with no API server.
        if(!aliasMap.size){
          try{
            const syn=await this.datingAliases(tree);
            aliasMap=syn.aliasMap;
          }catch{}
        }
        const packed=await this.staticChronogramDates(names,aliasMap);
        if(packed){
          const packCov=this.chronogramCoverage(packed,primary.map(entry=>({...entry,query:entry.aliases[0]})),aliasMap).coverage;
          if(!dated||packCov>coverage){dated=packed;coverage=packCov;}
          if(dated) dated.aliases=aliasMap;
        }
        if(dated&&coverage>=0.5) return dated;
        // 3) Live TimeTree via serve.py proxy.
        const timeTree=await this.timeTreeDates(names);
        if(timeTree) return timeTree;
        return dated;
      }catch{return null;}
    })();
    this.dateCache.set(key,promise);
    promise.then(result=>{if(!result) this.dateCache.delete(key);});
    return promise;
  }
  async timeTreeDates(names){
    if(!this.datingApiAvailable()) return null;
    const tips=[...new Set((names||[]).map(dateQueryName).filter(Boolean))];
    if(tips.length<2) return null;
    try{
      const response=await fetch('/api/timetree',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({names:tips})});
      if(!response.ok) return null;
      const payload=await response.json();
      const pairs=payload?.pairs||{};
      const ages=[...Object.values(pairs)].map(Number).filter(age=>age>0);
      if(ages.length<1) return null;
      return {source:'timetree',pairs,crown:Math.max(...ages),unit:payload.unit||'Ma'};
    }catch{return null;}
  }
  applyTimeTreeDates(tree,dated){
    if(!tree||!dated?.pairs) return false;
    const norm=name=>String(name||'').toLowerCase().replace(/_/g,' ').replace(/\s+/g,' ').trim();
    const pairLookup=new Map();
    for(const [key,value] of Object.entries(dated.pairs||{})){
      const age=Number(value); if(!(age>0)) continue;
      const parts=String(key).split('|'); if(parts.length!==2) continue;
      pairLookup.set(norm(parts[0])+'|'+norm(parts[1]),age);
    }
    const pairAge=(a,b)=>{
      const left=norm(dateQueryName(a)), right=norm(dateQueryName(b));
      return pairLookup.get(left+'|'+right)||pairLookup.get(right+'|'+left)||null;
    };
    const tipNames=node=>node.children?node.children.flatMap(tipNames):[node.ottName||node.name||node.label||''];
    const nodes=[];
    const collect=node=>{nodes.push(node);if(node.children)node.children.forEach(collect);};
    collect(tree);
    let datedTips=0;
    for(const node of nodes){
      const names=[...new Set(tipNames(node).map(dateQueryName).filter(Boolean))];
      if(names.length<=1){node.age=0;node.keepAge=true;node.dated=true;if(names.length===1) datedTips+=1;continue;}
      let age=null;
      for(let i=0;i<names.length;i++){
        for(let j=i+1;j<names.length;j++){
          const hit=pairAge(names[i],names[j]);
          if(hit!=null) age=age==null?hit:Math.max(age,hit);
        }
      }
      if(!(age>0)) continue;
      node.age=age;node.keepAge=true;node.dated=true;
    }
    if(!tree.keepAge){
      const ages=nodes.filter(node=>node.keepAge).map(node=>node.age||0);
      if(ages.length){tree.age=Math.max(dated.crown||0,...ages);tree.keepAge=true;tree.dated=true;}
    }
    const named=[...new Set(tipNames(tree).map(dateQueryName).filter(Boolean))];
    let covered=0;
    for(let i=0;i<named.length;i++){
      for(let j=i+1;j<named.length;j++){
        if(pairAge(named[i],named[j])!=null){covered+=1;break;}
      }
    }
    tree.dated=!!tree.keepAge;
    tree.dateCoverage=named.length?covered/named.length:0;
    tree.dateSource='timetree';
    return tree.age>0&&tree.dated;
  }
  taxonPage(id,page,perPage){const params=new URLSearchParams({taxon_id:String(id),rank:'species',is_active:'true',per_page:String(perPage),page:String(page),order_by:'observations_count',order:'desc',locale:'en'});return this.json('https://api.inaturalist.org/v1/taxa?'+params);}
  // Chronogram databases are dense for vertebrates, sparse for most insect families.
  chronogramFriendlyIds(){
    return new Set([
      3,20978,26036,40151,47178,196614,85497,49099,49231,152875, // vertebrate classes
      47459,47533,47668,48836,47548 // a few marine invertebrates that often date
    ]);
  }
  async isChronogramFriendly(node){
    if(!node) return false;
    if(node.dateable!=null) return node.dateable;
    const friendly=this.chronogramFriendlyIds();
    if(friendly.has(node.id)) return node.dateable=true;
    if(node.rank==='class'||node.rank==='phylum') return node.dateable=false;
    try{
      const data=await this.json(`https://api.inaturalist.org/v1/taxa/${node.id}`);
      const ids=new Set(data.results?.[0]?.ancestor_ids||[]);
      node.dateable=[...friendly].some(id=>ids.has(id));
    }catch{node.dateable=false;}
    return node.dateable;
  }
  // Draw 5–10 species from one catalogued group. Groups smaller than the draw are skipped.
  async sampleBranch(currentNames=new Set()){
    const minimum=5,maximum=10,count=minimum+Math.floor(Math.random()*(maximum-minimum+1));
    const all=(this.nodes||[]).filter(node=>node.speciesCount==null||node.speciesCount>=count);
    this.shuffle(all);
    // Prefer clades DateLife can actually age; ~3/4 of the catalog is undatable insect families.
    const preferred=[];
    const wildcard=[];
    for(const node of all){
      if(preferred.length>=10&&wildcard.length>=4) break;
      const friendly=await this.isChronogramFriendly(node);
      if(friendly){if(preferred.length<10) preferred.push(node);}
      else if(wildcard.length<4) wildcard.push(node);
    }
    const pool=Math.random()<0.12?[...preferred,...wildcard]:(preferred.length?preferred:all);
    this.shuffle(pool);
    for(const node of pool.slice(0,8)){
      try{
        const animals=await this.speciesWithin(node,count);
        if(!animals||animals.length<minimum)continue;
        const same=animals.length===currentNames.size&&animals.every(animal=>currentNames.has(animal.name));
        if(same)continue;
        return {node,animals};
      }catch(error){
        if(error?.name==='TypeError'||/Failed to fetch|NetworkError/i.test(error?.message||''))return this.sampleCachedBranch(count,currentNames);
      }
    }
    return this.sampleCachedBranch(count,currentNames);
  }
  pickPlaced(animals,count){
    const picked=[];const seen=new Set();
    for(const animal of animals){
      if(!animal?.ottId||seen.has(animal.ottId))continue;
      seen.add(animal.ottId);picked.push(animal);
      if(picked.length>=count)break;
    }
    return picked;
  }
  async speciesWithin(node,count){
    const perPage=20;
    let page=1;
    if(node.speciesCount>=perPage){const pages=Math.min(8,Math.ceil(Math.min(node.speciesCount,perPage*8)/perPage));page=1+Math.floor(Math.random()*pages);}
    let data=await this.taxonPage(node.id,page,perPage);
    const total=data.total_results||0;
    if(node.speciesCount==null)node.speciesCount=total;
    if(total<count)return null;
    let results=this.usableSpecies(data.results);
    if(results.length<count&&page!==1){data=await this.taxonPage(node.id,1,perPage);results=this.usableSpecies(data.results);}
    if(results.length<5)return null;
    // Prefer species present in packaged chronograms so GitHub Pages / iPad draws get Ma ages.
    await this.loadChronogramCatalog();
    const datedTips=this.chronoTipSet||(this.chronoTipSet=(()=>{
      const set=new Set();
      for(const tree of (this.chronoCatalog?.trees||[])){
        for(const tip of String(tree.newick||'').match(/[A-Za-z][^():,]*(?=:)/g)||[]){
          if(!/^n\d+$/i.test(tip)) set.add(tip.replace(/_/g,' ').toLowerCase());
        }
      }
      return set;
    })());
    this.shuffle(results);
    results.sort((a,b)=>{
      const aHit=datedTips.has(String(a.name||'').toLowerCase())?0:1;
      const bHit=datedTips.has(String(b.name||'').toLowerCase())?0:1;
      return aHit-bHit;
    });
    const animals=results.slice(0,Math.min(results.length,count+8)).map(taxon=>{
      const existing=this.items.get(taxon.id);
      const animal=existing?.photo?existing:this.normalize(taxon);
      if(!animal.photo)return null;
      this.items.set(animal.id,animal);
      return animal;
    }).filter(Boolean);
    if(animals.length<5)return null;
    const naming=this.ensureOtt(animals);
    let shown=await this.firstLoaded(animals,count);
    await naming;
    let picked=this.pickPlaced(shown,count);
    if(picked.length<5){
      shown=await this.withPhotos(animals);
      picked=this.pickPlaced(shown,count);
    }
    if(picked.length<5)return null;
    this.save();
    await this.openTree(picked);
    return picked;
  }
  sampleCachedBranch(count,currentNames=new Set()){
    const animals=[...this.items.values()].filter(animal=>animal.ancestors?.length);
    if(animals.length<5)return null;
    const eligible=[];
    function visit(node){
      if(!node.children)return [node.name];
      const tips=node.children.flatMap(visit);
      if(tips.length>=count)eligible.push({node,tips});
      return tips;
    }
    visit(buildTaxonomy(animals));
    const different=eligible.filter(entry=>entry.tips.length!==currentNames.size||entry.tips.some(name=>!currentNames.has(name)));
    const pool=different.length?different:eligible;
    if(!pool.length)return null;
    const entry=pool[Math.floor(Math.random()*pool.length)];
    const tips=this.shuffle([...entry.tips]).slice(0,count);
    const chosen=new Set(tips);
    return {node:{id:entry.node.taxonId,name:entry.node.name,common:entry.node.label,rank:entry.node.rank||'group'},animals:animals.filter(animal=>chosen.has(animal.name))};
  }
}
class AnimalMap {
  constructor(stage,store,helpers){
    this.stage=stage;this.store=store;this.helpers=helpers;this.revision=0;this.signature='';
    this.viewport={zoom:f=>this.map?.setZoom(this.map.getZoom()+(f>1?1:-1)),fit:()=>this.syncSize(true)};
    this._onViewportResize=()=>this.syncSize();
  }
  setup(){
    if(this.map)return;
    this.stage.innerHTML='<div class="earth-canvas"></div><div class="animal-map-legend" aria-label="Animals on the map"></div>';
    const canvas=this.stage.querySelector('.earth-canvas');
    this.map=L.map(canvas,{zoomControl:false,minZoom:2,maxZoom:16,worldCopyJump:true}).setView([18,0],2);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',{maxZoom:16,attribution:'Tiles © Esri — Sources: Esri, USGS, NOAA & contributors'}).addTo(this.map);
    this.layers=L.layerGroup().addTo(this.map);
    // iPad/Safari often opens the map while the tab is still settling to full width.
    this._sizeObserver=new ResizeObserver(()=>this.syncSize());
    this._sizeObserver.observe(this.stage);
    this._sizeObserver.observe(canvas);
    window.addEventListener('orientationchange',this._onViewportResize);
    window.visualViewport?.addEventListener('resize',this._onViewportResize);
    this.syncSize(true);
  }
  syncSize(force=false){
    if(!this.map||this.stage.hidden||this.stage.offsetParent===null)return;
    const canvas=this.stage.querySelector('.earth-canvas');
    const w=this.stage.clientWidth,h=this.stage.clientHeight;
    if(w<2||h<2){requestAnimationFrame(()=>this.syncSize(true));return;}
    if(canvas){canvas.style.width=w+'px';canvas.style.height=h+'px';}
    const run=()=>{
      if(!this.map)return;
      this.map.invalidateSize({pan:false,animate:false});
      // Leaflet sometimes keeps a stale tile grid on iOS until a second pass.
      if(force) this.map.invalidateSize({pan:false,animate:false});
    };
    run();
    requestAnimationFrame(()=>requestAnimationFrame(run));
    clearTimeout(this._sizeTimer);
    this._sizeTimer=setTimeout(run,120);
  }
  reset(){if(!this.map)return;this.syncSize(true);const short=(this.stage.clientHeight||800)<760;this.map.setView(short?[6,0]:[16,0],2);}
  async render(selected,reset=false){
    this.setup();this.syncSize(true);if(reset)this.reset();
    const signature=[...selected].join('|');if(signature===this.signature&&this.loaded){this.syncSize(true);return;}
    this.signature=signature;this.loaded=false;const revision=++this.revision;
    this.layers.clearLayers();const legend=this.stage.querySelector('.animal-map-legend');legend.replaceChildren();
    const animals=[...selected].map(name=>[...this.store.items.values()].find(a=>a.name===name)).filter(Boolean);
    if(!animals.length){this.loaded=true;this.syncSize(true);return;}
    const colors=['#7b2c91','#007d9c','#ce661a','#32752d','#c43b67','#425cc2','#8b6414','#357e7e','#8c4c4c','#583bba'];
    await Promise.all(animals.map(async(animal,i)=>{const color=colors[i%colors.length];
      const card=document.createElement('button');card.className='animal-map-card';card.style.setProperty('--animal-color',color);card.innerHTML=`${this.helpers.sprite(animal)}<b>${this.helpers.escape(animal.display)}</b><small>Loading…</small>`;card.onclick=()=>this.helpers.onMeet(animal.id);legend.append(card);
      try{const records=(await this.store.occurrences(animal)).slice(0,100);if(revision!==this.revision)return;
        card.querySelector('small').textContent=records.length?`${records.length} on the map`:'No mapped points';
        const name=this.helpers.escape(animal.display);
        for(const record of records){
          const marker=L.circleMarker([record.lat,record.lng],{radius:6,color:'white',weight:1,fillColor:color,fillOpacity:.75});
          marker.bindPopup('<div class="occurrence-popup"><strong>'+name+'</strong><p class="occurrence-loading">Loading sighting…</p></div>',{maxWidth:280,minWidth:200,className:'occurrence-popup-wrap'});
          marker.on('popupopen',async()=>{
            const popup=marker.getPopup();
            const body=()=>{
              const bits=[];
              if(record.photo) bits.push('<button type="button" class="occurrence-photo-link" data-occurrence-photo="1" aria-label="View full screen sighting photo"><img class="occurrence-preview" src="'+this.helpers.escape(record.photo)+'" alt="'+name+' sighting" loading="lazy" referrerpolicy="no-referrer"></button>');
              else bits.push('<p class="occurrence-empty">No photo attached to this GBIF record.</p>');
              bits.push('<strong>'+name+'</strong>');
              if(record.locality) bits.push('<p>'+this.helpers.escape(record.locality)+'</p>');
              if(record.date) bits.push('<p>'+this.helpers.escape(record.date)+'</p>');
              if(record.recordedBy) bits.push('<p>Recorded by '+this.helpers.escape(record.recordedBy)+'</p>');
              bits.push('<p>'+this.helpers.escape(record.publisher||'GBIF data publisher')+'</p>');
              bits.push('<p><a href="https://www.gbif.org/occurrence/'+record.key+'" target="_blank" rel="noopener">View sighting on GBIF ↗</a></p>');
              return '<div class="occurrence-popup">'+bits.join('')+'</div>';
            };
            if(!record.previewReady){
              popup.setContent('<div class="occurrence-popup"><strong>'+name+'</strong><p class="occurrence-loading">Loading sighting…</p></div>');
              await this.store.occurrencePreview(record);
            }
            popup.setContent(body());
            const photoBtn=popup.getElement()?.querySelector('[data-occurrence-photo]');
            if(photoBtn&&this.helpers.onPhoto){
              photoBtn.onclick=e=>{
                e.preventDefault();e.stopPropagation();
                this.helpers.onPhoto([{url:record.photo,link:record.photoLink||('https://www.gbif.org/occurrence/'+record.key),credit:record.publisher||'GBIF data publisher',alt:animal.display+' sighting'}],0,animal.display);
              };
            }
          });
          marker.addTo(this.layers);
        }
      }catch(error){if(revision!==this.revision)return;card.querySelector('small').textContent='Map unavailable';card.title=error.message;}
    }));
    if(revision!==this.revision)return;this.loaded=true;this.syncSize(true);
  }
}
