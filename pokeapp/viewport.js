// Shared mouse/touch viewport. Artwork remains unmodified; only its view changes.
class ExplorerViewport {
  constructor(stage, onChange = () => {}) {
    this.stage = stage; this.onChange = onChange; this.svg = null;
    this.bounds = [0, 0, 1000, 700]; this.center = [500, 350]; this.scale = 1;
    this.pointers = new Map(); this.draggedAt = 0; this.startPoint = null;
    stage.addEventListener('wheel', e => {
      if (!this.svg) return; e.preventDefault();
      this.zoom(Math.exp(-e.deltaY * .0015), this.local(e));
    }, {passive:false});
    stage.addEventListener('pointerdown', e => {
      if (!this.svg || (e.pointerType === 'mouse' && e.button !== 0)) return;
      this.pointers.set(e.pointerId, this.local(e)); this.startPoint = this.local(e);
      if (!e.target.closest('button,[role="button"]')) stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', e => {
      if (!this.pointers.has(e.pointerId)) return;
      const before = [...this.pointers.values()], old = this.pointers.get(e.pointerId), next = this.local(e);
      this.pointers.set(e.pointerId, next);
      const after = [...this.pointers.values()];
      if (after.length >= 2) {
        const dist = ps => Math.hypot(ps[0][0]-ps[1][0], ps[0][1]-ps[1][1]);
        const mid = ps => [(ps[0][0]+ps[1][0])/2, (ps[0][1]+ps[1][1])/2];
        const a = mid(before), b = mid(after), ratio = dist(after) / Math.max(1, dist(before));
        this.zoom(ratio, a, false); this.pan(b[0]-a[0], b[1]-a[1]);
        this.draggedAt = performance.now();
      } else if (Math.hypot(next[0]-this.startPoint[0], next[1]-this.startPoint[1]) > 5 || this.dragging) {
        this.dragging = true; this.draggedAt = performance.now();
        if (!stage.hasPointerCapture(e.pointerId)) stage.setPointerCapture(e.pointerId);
        this.pan(next[0]-old[0], next[1]-old[1]);
      }
    });
    const release = e => { this.pointers.delete(e.pointerId); if (!this.pointers.size) this.dragging = false; };
    window.addEventListener('pointerup', release); window.addEventListener('pointercancel', release);
    stage.addEventListener('click', e => {
      if (performance.now()-this.draggedAt < 200) { e.stopImmediatePropagation(); e.preventDefault(); }
    }, true);
  }
  local(e) { const b=this.stage.getBoundingClientRect(); return [e.clientX-b.left,e.clientY-b.top]; }
  size() { return [this.stage.clientWidth || 800, this.stage.clientHeight || 600]; }
  setScene(svg, bounds, reset = true) {
    this.svg = svg; this.bounds = bounds;
    const [w,h] = this.size(); this.minScale = Math.min(w/bounds[2],h/bounds[3])*.96;
    if (reset) this.fit(bounds); else this.apply();
  }
  fit(rect = this.bounds) {
    const [w,h] = this.size(); this.scale = Math.min(w/rect[2],h/rect[3])*.96;
    this.center = [rect[0]+rect[2]/2,rect[1]+rect[3]/2]; this.apply();
  }
  zoom(factor, point, apply = true) {
    const [w,h] = this.size(); point ||= [w/2,h/2];
    const old = this.scale, next = Math.max(this.minScale || .1, Math.min(8, old*factor));
    this.center[0] += (point[0]-w/2)*(1/old-1/next);
    this.center[1] += (point[1]-h/2)*(1/old-1/next);
    this.scale = next; if (apply) this.apply();
  }
  pan(dx,dy) { this.center[0]-=dx/this.scale; this.center[1]-=dy/this.scale; this.apply(); }
  apply() {
    if (!this.svg) return;
    const [w,h]=this.size(), vw=w/this.scale, vh=h/this.scale, b=this.bounds;
    for (const [axis,span] of [[0,vw],[1,vh]]) {
      // Keep the drawing on screen, allowing a modest margin at its edges.
      const low=b[axis]+Math.min(span/2,b[axis+2]/2), high=b[axis]+b[axis+2]-Math.min(span/2,b[axis+2]/2);
      this.center[axis]=Math.max(low,Math.min(high,this.center[axis]));
    }
    this.box=[this.center[0]-vw/2,this.center[1]-vh/2,vw,vh];
    this.svg.setAttribute('viewBox',this.box.join(' ')); this.onChange();
  }
  toScreen(x,y) { return [(x-this.box[0])*this.scale,(y-this.box[1])*this.scale]; }
}
