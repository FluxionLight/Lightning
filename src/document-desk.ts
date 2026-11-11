import type { PdfTab, ReadingAnchor } from "./types";
import {icon} from "./icons";
import { TabTransitions } from "./tab-transition";
import {limitDeskCamera,type WorldRect} from "./lazy-desk";
export type WorkspaceMode = "desk" | "focus";
type Fraction={scrollX:number;scrollY:number};
type Frame={x:number;y:number;width:number;height:number};
type Geometry = { x: number; y: number; width: number; z: number;pileArea?:Frame;stowed?:boolean;presentation?:"loose"|"frame";frame?:Frame;views?:{frame?:Fraction;focus?:Fraction} };
export type DeskSnapshot={schemaVersion:2;mode:WorkspaceMode;scale:number;camera:{x:number;y:number};layouts:Record<string,Geometry>};
export type DocumentSurface = { card: HTMLElement; stage: HTMLElement; container: HTMLElement; host: HTMLElement; title: HTMLElement; page: HTMLElement; previous: HTMLButtonElement; next: HTMLButtonElement };
const STORE = "lightning.desk.v2";
const bound = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
function valid(v: unknown): v is Geometry {
  if (!v || typeof v !== "object") return false;
  const g=v as Geometry;
  return [g.x,g.y,g.width,g.z].every(Number.isFinite) && Math.abs(g.x)<1e9 && Math.abs(g.y)<1e9 && g.width>=100 && g.width<=6720 && g.z>=0;
}
/** Loose pages in world coordinates. Only the camera has a viewport; papers do not. */
export class DocumentDesk {
  readonly root: HTMLElement;
  readonly transitions: TabTransitions;
  private viewport: HTMLElement;
  private canvas: HTMLElement;
  private controls: HTMLElement;
  private empty: HTMLElement;
  private surfaces = new Map<number,DocumentSurface>();
  private documents = new Map<number,PdfTab>();
  private layouts: Record<string,Geometry> = {};
  private active: number|null = null;
  private order=0;
  private scale=1;
  private camera={x:0,y:0};
  private selectedMode: WorkspaceMode="desk";
  private space=false;
  private qualityTimer:number|undefined;
  private restoreViews=new Set<number>();
  private emptyOrigin={x:0,y:0};
  private edgeFrame:number|undefined;
  private edgeTime=0;
  private restoring=false;
  private wheelSource:{touchpad:boolean;time:number}|null=null;
  private gesture: {id:number;original:Geometry;x:number;y:number;lastX:number;lastY:number;camera:{x:number;y:number};pointer:number;handle:HTMLElement;resize:boolean}|null=null;
  private pan: {x:number;y:number;original:{x:number;y:number};pointer:number}|null=null;

  constructor(empty:HTMLElement,private activate:(id:number)=>void,private navigate:(id:number,delta:number)=>void,
    private changed:()=>void,private report:(message:string)=>void,private renderedSizeChanged:()=>void) {
    try {
      const saved=JSON.parse(localStorage.getItem(STORE)||"null");
      if(saved?.mode==="focus")this.selectedMode="focus";
      if(Number.isFinite(saved?.scale))this.scale=bound(saved.scale,.12,3);
      if(saved?.camera && [saved.camera.x,saved.camera.y].every(Number.isFinite))this.camera={x:saved.camera.x,y:saved.camera.y};
      if(saved?.layouts && typeof saved.layouts==="object")for(const [id,g] of Object.entries(saved.layouts).slice(-200))if(valid(g)){this.layouts[id]=this.normalizeGeometry(g);this.order=Math.max(this.order,g.z);}
      // Keep old card positions and widths; discard the clipping window's height.
      if(!saved){
        const old=JSON.parse(localStorage.getItem("lightning.desk.v1")||"null");
        if(old?.mode==="focus")this.selectedMode="focus";
        for(const [id,value] of Object.entries(old?.layouts??{}).slice(-200)){
          const g=value as Geometry,migrated={x:g.x,y:g.y,width:g.width,z:++this.order};if(valid(migrated))this.layouts[id]=migrated;
        }
      }
    }catch{/* Damaged desk preferences never block reading. */}
    this.empty=empty;empty.classList.add("desk-empty");
    this.root=document.createElement("div");this.root.id="reading-workspace";empty.before(this.root);
    this.root.innerHTML='<div class="workspace-wallpaper" aria-hidden="true"></div><div class="desk-viewport"><div class="desk-canvas"></div></div><div class="desk-instructions">拖动纸面摆放 · 拖动空白平移 · 空白处滚轮缩放</div><div class="desk-controls"><span class="desk-caption">无界桌面</span><button class="btn desk-arrange" title="将纸张错落摆放并显示全部">整理纸张</button><button class="btn desk-home" title="缩放和平移桌面，找回所有纸张">查看全部</button><span class="desk-control-divider"></span><button class="btn icon desk-zoom-out" aria-label="缩小桌面">−</button><button class="desk-scale" title="恢复桌面 100%">100%</button><button class="btn icon desk-zoom-in" aria-label="放大桌面">＋</button></div>';
    this.controls=this.root.querySelector(".desk-controls")!;
    this.controls.innerHTML=`<span class="rail-divider"></span><button class="rail-button desk-arrange" title="整理纸张" aria-label="整理纸张">${icon("arrange")}</button><button class="rail-button desk-home" title="查看全部纸张" aria-label="查看全部纸张">${icon("overview")}</button><button class="rail-button desk-zoom-in" title="放大桌面" aria-label="放大桌面">${icon("plus")}</button><button class="rail-button desk-scale" title="恢复桌面 100%" aria-label="恢复桌面 100%">100%</button><button class="rail-button desk-zoom-out" title="缩小桌面" aria-label="缩小桌面">${icon("minus")}</button>`;
    document.getElementById("desk-tools")?.append(this.controls);
    this.root.append(empty);const folded=document.createElement("div");folded.className="stowed-message hidden";folded.textContent="文件已收进标签 · 点击标签在原处展开";this.root.append(folded);const drop=document.getElementById("drop-hint");if(drop)this.root.append(drop);
    this.viewport=this.root.querySelector(".desk-viewport")!;this.canvas=this.root.querySelector(".desk-canvas")!;
    this.emptyOrigin={x:-this.camera.x/this.scale,y:-this.camera.y/this.scale};
    new ResizeObserver(()=>{if(this.mode==="desk"&&!this.restoring&&!this.gesture&&!this.pan&&this.contentObjects().length){const old={...this.camera};this.constrainCamera();this.applyCamera();if(old.x!==this.camera.x||old.y!==this.camera.y)this.save();}}).observe(this.viewport);
    this.transitions=new TabTransitions(this.root);
    this.controls.querySelector<HTMLElement>(".desk-arrange")!.onclick=()=>this.arrange();
    this.controls.querySelector<HTMLElement>(".desk-home")!.onclick=()=>this.overview();
    this.controls.querySelector<HTMLElement>(".desk-scale")!.onclick=()=>this.setScale(1);
    this.controls.querySelector<HTMLElement>(".desk-zoom-out")!.onclick=()=>this.setScale(this.scale/1.15);
    this.controls.querySelector<HTMLElement>(".desk-zoom-in")!.onclick=()=>this.setScale(this.scale*1.15);
    window.addEventListener("lightning-scroll-source",e=>{this.wheelSource={touchpad:(e as CustomEvent<{touchpad:boolean}>).detail.touchpad,time:performance.now()};});
    this.viewport.addEventListener("wheel",e=>{
      if(this.mode!=="desk"||document.querySelector("dialog[open]")||this.root.querySelector(".ocr-overlay:not(.hidden)"))return;
      const target=((e.ctrlKey?document.elementFromPoint(e.clientX,e.clientY):null)??e.target) as HTMLElement;
      if(e.ctrlKey){
        if(target.closest(".pdf-viewport,.document-outline-toggle"))return; // The reader owns document-local zoom.
        e.preventDefault();e.stopPropagation();return;
      }
      if(target.closest(".document-card"))return;
      e.preventDefault();e.stopPropagation();const b=this.viewport.getBoundingClientRect();
      const touchpad=this.wheelSource&&performance.now()-this.wheelSource.time<500?this.wheelSource.touchpad:e.deltaMode===0&&(Math.abs(e.deltaY)<40||e.deltaX!==0);
      if(touchpad){const unit=e.deltaMode===1?16:e.deltaMode===2?this.viewport.clientHeight:1;this.camera=this.limitedCamera({x:this.camera.x-e.deltaX*unit,y:this.camera.y-e.deltaY*unit});this.applyCamera();this.save();return;}
      this.setScale(this.scale*Math.exp(-bound(e.deltaY,-100,100)*.002),{x:e.clientX-b.left,y:e.clientY-b.top});
    },{passive:false});
    this.viewport.addEventListener("pointerdown",e=>{
      const target=e.target as HTMLElement;
      if(e.pointerType==="touch"&&!e.isPrimary)return;
      if(this.mode!=="desk"||!(e.button===1||e.button===0&&(this.space||!target.closest(".document-card"))))return;
      if(this.root.querySelector(".ocr-overlay:not(.hidden)"))return;
      this.transitions.cancelAll();this.finishGesture(true);this.changed();e.preventDefault();e.stopPropagation();
      this.pan={x:e.clientX,y:e.clientY,original:{...this.camera},pointer:e.pointerId};
      this.viewport.setPointerCapture(e.pointerId);this.root.classList.add("desk-panning");
    },true);
    this.viewport.addEventListener("pointermove",e=>{if(this.pan?.pointer!==e.pointerId)return;this.camera=this.limitedCamera({x:this.pan.original.x+e.clientX-this.pan.x,y:this.pan.original.y+e.clientY-this.pan.y});this.applyCamera();});
    this.viewport.addEventListener("pointerup",()=>this.endPan(false));this.viewport.addEventListener("pointercancel",()=>this.endPan(true));this.viewport.addEventListener("lostpointercapture",()=>this.endPan(true));
    window.addEventListener("blur",()=>{this.space=false;this.finishGesture(true);this.endPan(true);this.root.classList.remove("desk-space");});
    window.addEventListener("keydown",e=>{
      if(this.mode!=="desk"||document.querySelector("dialog[open]")||(e.target as HTMLElement).closest("input,textarea,select,[contenteditable=true],.document-outline,.document-outline-toggle,.themed-select"))return;
      if(e.code==="Space"){e.preventDefault();this.space=true;this.root.classList.add("desk-space");}
      if(e.key==="Escape"&&(this.gesture||this.pan)){e.preventDefault();this.finishGesture(true);this.endPan(true);}
    },true);
    window.addEventListener("keyup",e=>{if(e.code==="Space"){this.space=false;this.root.classList.remove("desk-space");}});
    this.applyMode();
  }
  get mode():WorkspaceMode{return this.selectedMode;}
  get zoom():number{return this.mode==="desk"?this.scale:1;}
  surface(id:number):DocumentSurface|undefined{return this.surfaces.get(id);}
  paperWidth(id:number):number{return this.geometry(id).width;}
  isStowed(id:number):boolean{return !!this.geometry(id).stowed;}
  isFramed(id:number):boolean{return this.geometry(id).presentation==="frame";}
  hasPendingViewport(id:number):boolean{return this.restoreViews.has(id);}
  /** A stable world-space reference, independent of the page's reading offset and zoom. */
  pileBounds(id:number):Frame {
    const g=this.geometry(id),a=g.pileArea!;return {x:a.x-g.x,y:a.y-g.y,width:a.width,height:a.height};
  }
  private resetPileArea(id:number):void {
    const g=this.geometry(id),t=this.documents.get(id)!,w=this.viewport.clientWidth/this.scale,h=this.viewport.clientHeight/this.scale;
    const width=Math.min(g.width,Math.max(100,w-180)),height=Math.min(g.width*t.pageHeightPt/t.pageWidthPt,Math.max(120,h-100));
    const left=(70-this.camera.x)/this.scale,top=(25-this.camera.y)/this.scale;
    g.pileArea={x:bound(g.x,left,Math.max(left,left+w-width-140/this.scale)),y:bound(g.y,top,Math.max(top,top+h-height-50/this.scale)),width,height};
  }
  preparePiles(id:number):void {
    if(this.mode!=="desk"||this.isFramed(id))return;
    const state=this.documents.get(id)!.state,layout=state.paperLayout;
    // New default piles appear beside the current reading position, never by fitting the PDF.
    if(!layout.before.desk&&!layout.after.desk&&layout.before.x===0&&layout.before.y===0&&layout.after.x===1&&layout.after.y===1&&!layout.before.width&&!layout.after.width&&!state.paperReadingViews.before&&!state.paperReadingViews.after){this.resetPileArea(id);this.save();}
  }
  setStowed(id:number,stowed:boolean):void {this.finishGesture(true);if(stowed)this.rememberViewport(id);this.geometry(id).stowed=stowed;if(!stowed)this.restoreViews.add(id);this.applyGeometry(id);this.save();this.changed();}
  toggleFrame(id:number):void {
    this.transitions.cancel(id);
    this.finishGesture(true);
    this.rememberViewport(id);const g=this.geometry(id),tab=this.documents.get(id)!;
    if(!g.frame){const width=bound(g.width+120,220,Math.max(220,Math.min(850,this.viewport.clientWidth/this.scale-100))),height=bound(g.width*tab.pageHeightPt/tab.pageWidthPt+64,180,Math.max(180,Math.min(900,this.viewport.clientHeight/this.scale-100))),left=(30-this.camera.x)/this.scale,top=(30-this.camera.y)/this.scale;g.frame={x:bound(g.x,left,Math.max(left,(this.viewport.clientWidth-50-this.camera.x)/this.scale-width)),y:bound(g.y,top,Math.max(top,(this.viewport.clientHeight-50-this.camera.y)/this.scale-height)),width,height};}
    g.presentation=this.isFramed(id)?"loose":"frame";this.restoreViews.add(id);this.applyGeometry(id);this.save();this.changed();this.renderedSizeChanged();
  }
  rememberViewport(id:number):void {
    const surface=this.surfaces.get(id);if(!surface||this.isStowed(id)||!surface.container.clientHeight||surface.container.getAttribute("aria-busy")==="true")return;
    const mode=this.mode==="focus"?"focus":this.isFramed(id)?"frame":null;if(!mode)return;
    const v=surface.container,f=(n:number,r:number)=>r>0?bound(n/r,0,1):0,g=this.geometry(id);
    (g.views??={})[mode]={scrollX:f(v.scrollLeft,v.scrollWidth-v.clientWidth),scrollY:f(v.scrollTop,v.scrollHeight-v.clientHeight)};
  }
  restoreViewportOnNextRender(id:number,fresh=false):void {if(fresh)this.geometry(id).views={frame:{scrollX:0,scrollY:0},focus:{scrollX:0,scrollY:0}};this.restoreViews.add(id);}
  takeViewportPosition(id:number):ReadingAnchor|null {
    if(!this.restoreViews.delete(id))return null;
    const mode=this.mode==="focus"?"focus":this.isFramed(id)?"frame":null;if(!mode)return null;
    return {page:this.documents.get(id)!.page,...this.geometry(id).views?.[mode]??{scrollX:0,scrollY:0}};
  }
  snapshot():DeskSnapshot {for(const id of this.documents.keys())this.rememberViewport(id);return structuredClone({schemaVersion:2,mode:this.mode,scale:this.scale,camera:this.camera,layouts:this.layouts});}
  restoreSnapshot(snapshot:DeskSnapshot):void {
    if(snapshot?.schemaVersion!==2)return;
    this.restoring=true;
    this.layouts={};this.order=0;for(const [id,g] of Object.entries(snapshot.layouts??{}).slice(-200))if(valid(g)){this.layouts[id]=this.normalizeGeometry(g);this.order=Math.max(this.order,g.z);}
    if(snapshot.mode==="desk"||snapshot.mode==="focus")this.selectedMode=snapshot.mode;
    if(Number.isFinite(snapshot.scale))this.scale=bound(snapshot.scale,.12,3);
    if(snapshot.camera&&[snapshot.camera.x,snapshot.camera.y].every(Number.isFinite))this.camera={...snapshot.camera};this.emptyOrigin={x:-this.camera.x/this.scale,y:-this.camera.y/this.scale};this.applyMode();
  }
  restoreDepths(snapshot:DeskSnapshot):void {for(const tab of this.documents.values()){const z=snapshot.layouts?.[tab.state.documentId]?.z;if(Number.isFinite(z)){this.geometry(tab.id).z=z;this.applyGeometry(tab.id);this.order=Math.max(this.order,z);}}this.restoring=false;this.applyCamera();this.save();}
  private normalizeGeometry(g:Geometry):Geometry {
    const copy:Geometry={x:g.x,y:g.y,width:g.width,z:g.z,stowed:g.stowed===true,presentation:g.presentation==="frame"?"frame":"loose"};
    const f=g.frame;if(f&&[f.x,f.y,f.width,f.height].every(Number.isFinite)&&Math.abs(f.x)<1e9&&Math.abs(f.y)<1e9)copy.frame={x:f.x,y:f.y,width:bound(f.width,220,2800),height:bound(f.height,180,2400)};
    const a=g.pileArea;if(a&&[a.x,a.y,a.width,a.height].every(Number.isFinite)&&Math.abs(a.x)<1e9&&Math.abs(a.y)<1e9&&a.width>=100&&a.width<=1e6&&a.height>=100&&a.height<=1e6)copy.pileArea={...a};
    if(!copy.frame)copy.presentation="loose";
    for(const mode of ["frame","focus"] as const){const p=g.views?.[mode];if(p&&[p.scrollX,p.scrollY].every(Number.isFinite))(copy.views??={})[mode]={scrollX:bound(p.scrollX,0,1),scrollY:bound(p.scrollY,0,1)};}
    return copy;
  }
  /** Scroll one loose sheet against the workspace edges, leaving every other sheet and camera alone. */
  scrollPaper(id:number,dx:number,dy:number):{moved:boolean;turn:number} {
    const tab=this.documents.get(id);if(!tab||this.mode!=="desk")return {moved:false,turn:0};
    const g=this.geometry(id),bounds=this.pageBounds(id),view=this.viewport.getBoundingClientRect();
    const horizontal=Math.abs(dx)>Math.abs(dy),delta=horizontal?dx:dy;
    const start=horizontal?bounds.left:bounds.top,end=horizontal?bounds.right:bounds.bottom;
    const near=horizontal?view.left:view.top,far=horizontal?view.right:view.bottom;
    const remaining=delta>0?end-far:near-start;
    if(delta&&remaining>1){
      const movement=Math.sign(delta)*Math.min(Math.abs(delta),remaining)/this.scale;
      if(horizontal)g.x-=movement;else g.y-=movement;
      this.applyGeometry(id);this.save();return {moved:true,turn:0};
    }
    return {moved:false,turn:horizontal?0:Math.sign(dy)};
  }
  readingPosition(id:number):{scrollX:number;scrollY:number} {
    const page=this.pageBounds(id),view=this.viewport.getBoundingClientRect();
    return {scrollX:bound((view.left-page.left)/Math.max(1,page.width-view.width),0,1),scrollY:bound((view.top-page.top)/Math.max(1,page.height-view.height),0,1)};
  }
  /** Called only when a page commits; actual point dimensions are already known. */
  positionPage(id:number,position:"start"|"end"|"preserve"|ReadingAnchor,old?:DOMRect):void {
    this.applyGeometry(id);if(this.mode!=="desk"||this.isFramed(id)||position==="preserve")return;
    const page=this.pageBounds(id),view=this.viewport.getBoundingClientRect(),g=this.geometry(id);
    if(typeof position==="object"){
      g.y=( -Math.max(0,page.height-view.height)*position.scrollY-this.camera.y)/this.scale;
      if(page.width>view.width)g.x=(-Math.max(0,page.width-view.width)*position.scrollX-this.camera.x)/this.scale;
    }else if(page.height>view.height+1 || old&&old.height>view.height+1 || page.top<view.top-1 || page.bottom>view.bottom+1){
      const top=position==="end"?view.height-page.height:0;
      g.y=(top-this.camera.y)/this.scale;
    }
    this.applyGeometry(id);this.save();
  }
  private pageBounds(id:number):DOMRect {
    const g=this.geometry(id),tab=this.documents.get(id)!,v=this.viewport.getBoundingClientRect();
    return new DOMRect(v.left+this.camera.x+g.x*this.scale,v.top+this.camera.y+g.y*this.scale,g.width*this.scale,g.width*tab.pageHeightPt/tab.pageWidthPt*this.scale);
  }
  register(tab:PdfTab,restore=false):DocumentSurface {
    this.viewport.classList.remove("hidden");
    const card=document.createElement("article");card.className="document-card desk-paper";card.dataset.tab=String(tab.id);card.setAttribute("aria-label",tab.title);
    card.innerHTML='<div class="document-handle" tabindex="0" title="拖动纸面或文件名摆放；方向键移动，Esc 撤销"><span class="document-dot"></span><span class="document-title"></span></div><div class="pdf-stage document-stage"><div class="pdf-viewport" tabindex="0"><div class="pdf-host"></div></div></div><nav class="document-footer" aria-label="纸张操作"><button class="btn icon document-previous" aria-label="此文档上一页" title="上一页">↑</button><span class="document-page"></span><button class="btn icon document-next" aria-label="此文档下一页" title="下一页">↓</button><span class="paper-control-divider"></span><button class="btn icon document-focus" aria-label="专注阅读这份文档" title="专注阅读">⛶</button><button class="btn icon document-close" aria-label="关闭文档" title="关闭文档">×</button></nav><button class="document-resize" aria-label="调整纸张大小" title="等比例缩放纸张；方向键也可调整">↘</button>';
    const frameButton=document.createElement("button");frameButton.className="btn icon document-presentation";frameButton.innerHTML=icon("frame");frameButton.setAttribute("aria-label","切换摊开或框内阅读");card.querySelector(".document-focus")!.before(frameButton);frameButton.onclick=()=>{this.activate(tab.id);this.toggleFrame(tab.id);};
    const outlineButton=document.createElement("button");outlineButton.type="button";outlineButton.className="btn icon document-outline-toggle";outlineButton.innerHTML=icon("outline");outlineButton.setAttribute("aria-controls","outline");outlineButton.setAttribute("aria-expanded","false");outlineButton.setAttribute("aria-label",`展开 ${tab.title} 的目录`);outlineButton.title=`展开 ${tab.title} 的目录`;card.append(outlineButton);
    const surface:DocumentSurface={card,stage:card.querySelector(".document-stage")!,container:card.querySelector(".pdf-viewport")!,host:card.querySelector(".pdf-host")!,title:card.querySelector(".document-title")!,page:card.querySelector(".document-page")!,previous:card.querySelector(".document-previous")!,next:card.querySelector(".document-next")!};
    surface.container.setAttribute("aria-label",`${tab.title} 阅读区`);surface.container.dataset.tab=String(tab.id);surface.title.textContent=tab.title;surface.title.title=tab.path;
    card.addEventListener("pointerdown",e=>{if(!(e.target as HTMLElement).closest(".document-close"))this.activate(tab.id);},true);
    card.querySelector<HTMLElement>(".document-close")!.onclick=()=>document.dispatchEvent(new CustomEvent("lightning-close-document",{detail:tab.id}));
    card.querySelector<HTMLElement>(".document-focus")!.onclick=()=>{this.activate(tab.id);this.setMode("focus");};
    surface.previous.onclick=()=>this.navigate(tab.id,-1);surface.next.onclick=()=>this.navigate(tab.id,1);
    this.surfaces.set(tab.id,surface);this.documents.set(tab.id,tab);this.layouts[tab.state.documentId]??=this.spawnGeometry(this.surfaces.size-1,tab);
    if(!restore)this.placeInView(tab.id);
    if(!this.geometry(tab.id).pileArea)this.resetPileArea(tab.id);
    this.canvas.append(card);this.applyGeometry(tab.id);
    surface.container.addEventListener("scroll",()=>{if(surface.container.getAttribute("aria-busy")==="true"||!surface.container.clientHeight)return;this.rememberViewport(tab.id);if(this.mode==="focus"||this.isFramed(tab.id))this.save();},{passive:true});
    const resize=card.querySelector<HTMLElement>(".document-resize")!,handle=card.querySelector<HTMLElement>(".document-handle")!;
    card.addEventListener("pointerdown",e=>{
      if(this.mode!=="desk"||e.button!==0||!e.isPrimary)return;
      const target=e.target as HTMLElement,isResize=!!target.closest(".document-resize");
      if(!isResize&&this.root.dataset.ink!=="off"&&this.root.dataset.ink&&!target.closest(".document-handle"))return;
      if(!isResize&&target.closest("button,.paper-panel,.ocr-overlay,svg[data-mode=laser],svg[data-mode=highlighter]"))return;
      if(!isResize&&!target.closest(".pdf-viewport,.document-handle"))return;
      if(this.isFramed(tab.id)&&!isResize&&!target.closest(".document-handle"))return;
      e.preventDefault();this.transitions.cancelAll();this.finishGesture(true);this.changed();const capture=isResize?resize:handle;
      this.gesture={id:tab.id,original:structuredClone(this.geometry(tab.id)),x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,camera:{...this.camera},pointer:e.pointerId,handle:capture,resize:isResize};
      capture.focus({preventScroll:true});capture.setPointerCapture(e.pointerId);card.classList.add("document-adjusting");
    });
    for(const [grip,resizing] of [[handle,false],[resize,true]] as const){
      grip.onpointermove=e=>this.moveGesture(e);grip.onpointerup=e=>{if(this.gesture?.pointer===e.pointerId)this.finishGesture(false);};
      grip.onpointercancel=()=>this.finishGesture(true);grip.onlostpointercapture=()=>this.finishGesture(true);
      grip.onkeydown=e=>{
        if(this.mode!=="desk"||!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home"].includes(e.key))return;
        e.preventDefault();e.stopPropagation();this.changed();const g=this.geometry(tab.id),step=e.shiftKey?40:10;
        this.transitions.cancelAll();const oldX=g.x,oldY=g.y;
        if(e.key==="Home"){Object.assign(g,this.defaultGeometry([...this.surfaces.keys()].indexOf(tab.id),tab));this.resetPileArea(tab.id);}
        else if(resizing&&this.isFramed(tab.id)){const f=g.frame!;if(e.key==="ArrowLeft")f.width=bound(f.width-step,220,2800);if(e.key==="ArrowRight")f.width=bound(f.width+step,220,2800);if(e.key==="ArrowUp")f.height=bound(f.height-step,180,2400);if(e.key==="ArrowDown")f.height=bound(f.height+step,180,2400);}
        else if(resizing)g.width=bound(g.width+(["ArrowRight","ArrowDown"].includes(e.key)?step:-step),100,6720);
        else {const p=this.isFramed(tab.id)?g.frame!:g;if(e.key==="ArrowLeft")p.x-=step;if(e.key==="ArrowRight")p.x+=step;if(e.key==="ArrowUp")p.y-=step;if(e.key==="ArrowDown")p.y+=step;}
        if(e.key!=="Home"&&!resizing&&!this.isFramed(tab.id)){g.pileArea!.x+=g.x-oldX;g.pileArea!.y+=g.y-oldY;}
        this.applyGeometry(tab.id);this.save();if(resizing||e.key==="Home")this.renderedSizeChanged();
      };
    }
    return surface;
  }
  remove(id:number):void{this.transitions.cancel(id);if(this.gesture?.id===id)this.finishGesture(true);this.surfaces.get(id)?.card.remove();this.surfaces.delete(id);this.documents.delete(id);}
  sync(tabs:readonly PdfTab[],active:number|null):void {
    const occupied=tabs.some(t=>!this.isStowed(t.id));if(!occupied&&!this.root.classList.contains("desk-empty-area"))this.emptyOrigin={x:-this.camera.x/this.scale,y:-this.camera.y/this.scale};this.root.classList.toggle("desk-empty-area",!occupied);
    const switched=this.active!==active;this.active=active;this.empty.classList.toggle("hidden",tabs.length>0);this.viewport.classList.toggle("hidden",tabs.length===0);this.root.classList.toggle("desk-has-documents",tabs.length>0);
    for(const tab of tabs){const s=this.surfaces.get(tab.id);if(!s)continue;const selected=tab.id===active;s.card.classList.toggle("document-active",selected);s.card.setAttribute("aria-current",String(selected));s.previous.disabled=tab.page===0;s.next.disabled=tab.page===tab.info.pageCount-1;s.page.textContent=`${tab.page+1} / ${tab.info.pageCount}`;s.card.classList.toggle("document-loading",s.container.getAttribute("aria-busy")==="true");if(selected&&switched)this.geometry(tab.id).z=++this.order;this.applyGeometry(tab.id);}
    this.applyMode();if(switched)this.save();
    this.root.querySelector(".stowed-message")!.classList.toggle("hidden",!tabs.length||tabs.some(t=>!this.isStowed(t.id)));
  }
  setMode(mode:WorkspaceMode):void {if(mode===this.mode)return;this.transitions.cancelAll();for(const id of this.documents.keys()){this.rememberViewport(id);this.restoreViews.add(id);}window.clearTimeout(this.qualityTimer);this.finishGesture(true);this.endPan(true);this.selectedMode=mode;this.applyMode();this.save();this.changed();this.renderedSizeChanged();}
  resizePaper(id:number,width:number,anchor?:{x:number;y:number}):void {
    this.transitions.cancel(id);
    const g=this.geometry(id),next=bound(width,100,6720);
    const surface=this.surfaces.get(id)!,oldImage=this.isFramed(id)?surface.host.querySelector<HTMLImageElement>(".pdf-page")?.getBoundingClientRect():null,ratio=next/g.width;
    if(anchor&&!this.isFramed(id)){const old=this.pageBounds(id);g.x+=(anchor.x-old.left)*(1-ratio)/this.scale;g.y+=(anchor.y-old.top)*(1-ratio)/this.scale;}
    g.width=next;this.applyGeometry(id);this.save();this.changed();
    if(anchor&&oldImage){surface.container.scrollLeft+=(anchor.x-oldImage.left)*(ratio-1)/this.scale;surface.container.scrollTop+=(anchor.y-oldImage.top)*(ratio-1)/this.scale;}
  }
  fitPaper(id:number,mode:"page"|"width"):void {
    const tab=this.documents.get(id)!,width=(this.viewport.clientWidth-180)/this.scale,height=(this.viewport.clientHeight-130)/this.scale;
    if(this.isFramed(id)){const v=this.surfaces.get(id)!.container,s=getComputedStyle(v),w=v.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight),h=v.clientHeight-parseFloat(s.paddingTop)-parseFloat(s.paddingBottom);this.resizePaper(id,mode==="width"?w:Math.min(w,h*tab.pageWidthPt/tab.pageHeightPt));return;}
    this.resizePaper(id,mode==="width"?width:Math.min(width,height*tab.pageWidthPt/tab.pageHeightPt));this.reveal(id,true);
  }
  reveal(id:number,center=false):void {
    if(this.mode!=="desk")return;const tab=this.documents.get(id);if(!tab)return;const g=this.objectGeometry(id);
    const x=g.x*this.scale+this.camera.x,y=g.y*this.scale+this.camera.y,w=g.width*this.scale,h=g.height*this.scale;
    if(center||x+w<40||y+h<40||x>this.viewport.clientWidth-40||y>this.viewport.clientHeight-40){this.camera={x:this.viewport.clientWidth/2-(g.x+g.width/2)*this.scale,y:this.viewport.clientHeight/2-(g.y+g.height/2)*this.scale};this.applyCamera();this.save();this.changed();}
  }
  private applyMode():void {
    this.root.dataset.mode=this.mode;this.applyCamera();this.controls.querySelector(".desk-scale")!.textContent=`${Math.round(this.scale*100)}%`;this.controls.classList.toggle("hidden",this.mode!=="desk"||!this.surfaces.size);
    document.getElementById("workspace-desk")?.setAttribute("aria-pressed",String(this.mode==="desk"));document.getElementById("workspace-focus")?.setAttribute("aria-pressed",String(this.mode==="focus"));
  }
  private applyCamera():void{this.canvas.style.transform=this.mode==="desk"?`translate(${this.camera.x}px,${this.camera.y}px) scale(${this.scale})`:"none";this.root.dispatchEvent(new Event("lightning-camera-position"));}
  private setScale(scale:number,anchor={x:this.viewport.clientWidth/2,y:this.viewport.clientHeight/2}):void {
    this.transitions.cancelAll();
    this.finishGesture(true);this.endPan(false);const next=bound(scale,.12,3),ratio=next/this.scale;this.camera={x:anchor.x-(anchor.x-this.camera.x)*ratio,y:anchor.y-(anchor.y-this.camera.y)*ratio};this.scale=next;this.constrainCamera();this.applyMode();this.save();this.changed();
    window.clearTimeout(this.qualityTimer);this.qualityTimer=window.setTimeout(()=>this.renderedSizeChanged(),140);
  }
  overview():void {
    this.transitions.cancelAll();
    if(!this.surfaces.size)return;this.finishGesture(true);this.endPan(false);
    const all=this.contentObjects();if(!all.length)return;
    const left=Math.min(...all.map(g=>g.x))-100,top=Math.min(...all.map(g=>g.y))-45,right=Math.max(...all.map(g=>g.x+g.width))+100,bottom=Math.max(...all.map(g=>g.y+g.height))+85;
    this.scale=bound(Math.min((this.viewport.clientWidth-50)/(right-left),(this.viewport.clientHeight-50)/(bottom-top),1),.12,3);this.camera={x:(this.viewport.clientWidth-(right+left)*this.scale)/2,y:(this.viewport.clientHeight-(bottom+top)*this.scale)/2};this.applyMode();this.save();this.changed();
  }
  private contentObjects():WorldRect[]{
    return [...this.documents.values()].filter(t=>!this.isStowed(t.id)).flatMap(t=>{
      const object=this.objectGeometry(t.id);if(this.isFramed(t.id))return [object];
      const g=this.geometry(t.id),piles=t.state.readingMode==="paper"?[...this.surfaces.get(t.id)!.stage.querySelectorAll<HTMLElement>(".paper-panel")].map(p=>({x:g.x+p.offsetLeft,y:g.y+p.offsetTop,width:p.offsetWidth,height:p.offsetHeight})):[];
      return [object,...piles];
    });
  }
  private limitedCamera(camera:{x:number;y:number}):{x:number;y:number}{return limitDeskCamera(camera,this.scale,{width:this.viewport.clientWidth,height:this.viewport.clientHeight},this.contentObjects(),this.emptyOrigin);}
  private constrainCamera():void{this.camera=this.limitedCamera(this.camera);}
  private spawnGeometry(index:number,tab:PdfTab):Geometry{
    const w=this.viewport.clientWidth,h=this.viewport.clientHeight,s=this.scale;
    const screenWidth=bound(Math.min(w*.36,(h-170)*tab.pageWidthPt/tab.pageHeightPt),Math.min(240,w-80),500),width=bound(screenWidth/s,100,6720),height=width*tab.pageHeightPt/tab.pageWidthPt;
    return {x:(bound(w*.5-width*s*.95+(index%4)*width*s*.67,35,Math.max(35,w-width*s-35))-this.camera.x)/s,y:(bound(55+(index%4)*65,30,Math.max(30,h-height*s-30))-this.camera.y)/s,width,z:++this.order};
  }
  private placeInView(id:number):void{
    const g=this.geometry(id),o=this.objectGeometry(id),x=o.x*this.scale+this.camera.x,y=o.y*this.scale+this.camera.y,w=o.width*this.scale,h=o.height*this.scale;
    g.stowed=false;
    if(x+w>60&&x<this.viewport.clientWidth-60&&y+h>45&&y<this.viewport.clientHeight-45)return;
    const nextX=(Math.max(25,(this.viewport.clientWidth-w)/2)-this.camera.x)/this.scale,nextY=(Math.max(35,(this.viewport.clientHeight-h)/2)-this.camera.y)/this.scale,dx=nextX-o.x,dy=nextY-o.y;
    o.x=nextX;o.y=nextY;
    if(this.isFramed(id))Object.assign(g.frame!,o);else{g.x=nextX;g.y=nextY;if(g.pileArea){g.pileArea.x+=dx;g.pileArea.y+=dy;}}
  }
  arrange():void {this.transitions.cancelAll();this.finishGesture(true);this.endPan(false);this.camera={x:0,y:0};this.scale=1;[...this.documents.values()].filter(t=>!this.isStowed(t.id)).forEach((tab,i)=>{const g=this.geometry(tab.id);Object.assign(g,this.defaultGeometry(i,tab));this.resetPileArea(tab.id);if(g.frame){g.frame.x=g.x;g.frame.y=g.y;}this.applyGeometry(tab.id);});if(this.active!==null){this.geometry(this.active).z=++this.order;this.applyGeometry(this.active);}this.overview();this.renderedSizeChanged();}
  private defaultGeometry(index:number,tab:PdfTab):Geometry {
    const first=[...this.documents.values()][0],base=first&&this.layouts[first.state.documentId];
    if(index>0&&base)return {x:base.x+(index%4)*base.width*.67,y:base.y+(index%4)*65+Math.floor(index/4)*80,width:base.width,z:++this.order};
    const w=this.viewport?.clientWidth||1100,h=this.viewport?.clientHeight||650,width=bound(Math.min(w*.36,(h-170)*tab.pageWidthPt/tab.pageHeightPt),240,500);
    return {x:(w*.5-this.camera.x)/this.scale-width*.95+(index%4)*width*.67,y:(55-this.camera.y)/this.scale+(index%4)*65+Math.floor(index/4)*80,width,z:++this.order};
  }
  private geometry(id:number):Geometry{return this.layouts[this.documents.get(id)!.state.documentId];}
  private objectGeometry(id:number):Frame {const g=this.geometry(id),t=this.documents.get(id)!;return this.isFramed(id)?g.frame!:{x:g.x,y:g.y,width:g.width,height:g.width*t.pageHeightPt/t.pageWidthPt};}
  private applyGeometry(id:number):void {
    const g=this.geometry(id),card=this.surfaces.get(id)?.card;if(!card)return;
    const object=this.objectGeometry(id);card.classList.toggle("document-stowed",!!g.stowed);card.classList.toggle("document-framed",this.isFramed(id));
    card.style.setProperty("--doc-x",`${object.x}px`);card.style.setProperty("--doc-y",`${object.y}px`);card.style.setProperty("--doc-width",`${object.width}px`);card.style.setProperty("--doc-height",`${object.height}px`);card.style.setProperty("--page-width",`${g.width}px`);card.style.zIndex=String(g.z);
    card.querySelector<HTMLElement>(".document-resize")!.title=this.isFramed(id)?"拖动调整阅读框宽高；方向键也可调整":"等比例缩放纸张；方向键也可调整";
    card.dispatchEvent(new Event("lightning-paper-position"));
  }
  private moveGesture(e:PointerEvent):void {
    const d=this.gesture;if(!d||d.pointer!==e.pointerId)return;e.preventDefault();d.lastX=e.clientX;d.lastY=e.clientY;this.updateGesture();
    if(!d.resize&&this.edgeFrame===undefined){this.edgeTime=performance.now();this.edgeFrame=requestAnimationFrame(t=>this.edgePan(t));}
  }
  private updateGesture():void{
    const d=this.gesture;if(!d)return;const g=this.geometry(d.id),dx=(d.lastX-d.x-(this.camera.x-d.camera.x))/this.scale,dy=(d.lastY-d.y-(this.camera.y-d.camera.y))/this.scale;
    if(this.isFramed(d.id)){const f=g.frame!,original=d.original.frame!;if(d.resize){f.width=bound(original.width+dx,220,2800);f.height=bound(original.height+dy,180,2400);}else{f.x=original.x+dx;f.y=original.y+dy;}}
    else if(d.resize){const t=this.documents.get(d.id)!,aspect=t.pageHeightPt/t.pageWidthPt;g.width=bound(d.original.width+(dx+dy*aspect)/(1+aspect*aspect),100,6720);}else{g.x=d.original.x+dx;g.y=d.original.y+dy;g.pileArea={...d.original.pileArea!,x:d.original.pileArea!.x+dx,y:d.original.pileArea!.y+dy};}this.applyGeometry(d.id);
  }
  private edgePan(time:number):void{
    this.edgeFrame=undefined;const d=this.gesture;if(!d||d.resize)return;
    const b=this.viewport.getBoundingClientRect(),speed=(p:number,near:number,far:number)=>p<near+36?-bound((near+36-p)/36,0,1)*850:p>far-36?bound((p-far+36)/36,0,1)*850:0;
    const dt=Math.min(.04,(time-this.edgeTime)/1000);this.edgeTime=time;const dx=speed(d.lastX,b.left,b.right)*dt,dy=speed(d.lastY,b.top,b.bottom)*dt;
    if(dx||dy){this.camera.x-=dx;this.camera.y-=dy;this.applyCamera();this.updateGesture();}
    this.edgeFrame=requestAnimationFrame(t=>this.edgePan(t));
  }
  private finishGesture(cancel:boolean):void {
    if(this.edgeFrame!==undefined)cancelAnimationFrame(this.edgeFrame);this.edgeFrame=undefined;
    const d=this.gesture;if(!d)return;this.gesture=null;this.surfaces.get(d.id)?.card.classList.remove("document-adjusting");if(d.handle.hasPointerCapture(d.pointer))d.handle.releasePointerCapture(d.pointer);
    if(cancel){Object.assign(this.geometry(d.id),d.original);this.camera=d.camera;this.applyCamera();this.applyGeometry(d.id);}else{this.save();if(d.resize)this.renderedSizeChanged();}
  }
  private endPan(cancel:boolean):void {const p=this.pan;if(!p)return;this.pan=null;if(cancel){this.camera=p.original;this.applyCamera();}this.root.classList.remove("desk-panning");if(this.viewport.hasPointerCapture(p.pointer))this.viewport.releasePointerCapture(p.pointer);if(!cancel)this.save();}
  private save():void {const layouts=Object.fromEntries(Object.entries(this.layouts).slice(-200));try{localStorage.setItem(STORE,JSON.stringify({schemaVersion:2,mode:this.mode,scale:this.scale,camera:this.camera,layouts}));document.dispatchEvent(new Event("lightning-desk-saved"));}catch{this.report("桌面布局本次已生效，但无法保存到本机");}}
}
