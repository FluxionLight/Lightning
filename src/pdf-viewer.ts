import { invoke } from "@tauri-apps/api/core";
import type { PdfDocumentInfo, PdfTab, RenderedPage, DocumentReadingState, ReadingMode, ReadingAnchor } from "./types";
import { PdfRenderCache } from "./pdf-render-cache";
import { PdfLaser } from "./pdf-laser";
import { PaperStack } from "./paper-stack";
import { defaultPaperLayout, normalizePaperLayout, normalizeReadingViews } from "./paper-layout";
import type { PaperSide } from "./paper-layout";
import { DocumentDesk } from "./document-desk";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8.0;
/** Low-resolution raster used only by the corner piles. */
const THUMB_ZOOM = 0.18;
type Position = "start" | "end" | "preserve" | ReadingAnchor;

function clampZoom(zoom: number): number {
  return Number.isFinite(zoom) ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) : 1;
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/**
 * Drives the main-panel PDF view across multiple tabs.
 *
 * Rendering happens in Rust (PDFium) and returns a base64 PNG; this class only
 * tracks per-tab navigation/zoom state and paints the active tab onto the page.
 */
export class PdfViewer {
  readonly laser: PdfLaser;
  readonly desk: DocumentDesk;
  private emptyContainer: HTMLElement;
  private emptyHost: HTMLElement;
  private observer: ResizeObserver;
  private tabs: PdfTab[] = [];
  private activeId: number | null = null;
  private renderSeq = 0;
  private cache = new PdfRenderCache();
  private stack: PaperStack;
  private emptyStack: PaperStack;
  private stacks=new Map<number,PaperStack>();
  private shownTab: number | null = null;
  private shownPage: number | null = null;
  private previewRevision = 0;
  private returningAnchors = new Set<number>();
  private passiveSeq = new Map<number,number>();
  private positions = new Map<number,Position>();

  constructor(
    private container: HTMLElement,
    private host: HTMLElement,
    private readonly onStateChange: () => void,
  ) {
    this.emptyContainer = container; this.emptyHost = host;
    this.desk = new DocumentDesk(container.parentElement!, id => { if(id !== this.activeId) void this.activate(id).catch(e=>this.reportError(e)); },
      (id,delta) => { void this.turnDocument(id,delta).catch(e=>this.reportError(e)); },
      () => { this.cancelInteraction(); document.dispatchEvent(new Event("lightning-workspace-change")); this.onStateChange(); }, message => this.reportError(message),
      () => {
        for(const stack of this.stacks.values())stack.reflow();const tab=this.activeTab;if(!tab)return;
        if(this.desk.mode==="desk"&&!this.desk.hasPendingViewport(tab.id)&&this.isStable&&this.pageElement?.dataset.quality===this.renderZoom(tab).toFixed(4)){this.refreshInactive();return;}
        void this.renderActive().catch(e=>this.reportError(e));
      });
    this.laser = new PdfLaser(container, onStateChange);
    const stage = container.parentElement!;
    this.emptyStack=this.stack=this.createStack(stage);
    let resizeTimer: number | undefined;
    const observer = new ResizeObserver(entries => {
      if (!entries.some(entry => entry.target === this.container)) return;
      this.stack.cancel();
      this.stack.reflow();
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        const tab = this.activeTab;
        if (tab && this.desk.mode === "focus" && tab.fitMode !== "none") void this.fit(tab.fitMode).catch(error => this.reportError(error));
        if (tab?.state.readingMode === "paper" && this.shownTab === tab.id && this.shownPage === tab.page) this.prefetch(tab, this.renderSeq);
      }, 80);
    });
    observer.observe(container);
    this.observer = observer;
  }

  get viewport(): HTMLElement { return this.container; }
  get pageElement(): HTMLImageElement | null { return this.host.querySelector<HTMLImageElement>(".pdf-page"); }
  get stageElement(): HTMLElement { return this.container.parentElement!; }

  private createStack(stage:HTMLElement,id?:number):PaperStack {
    return new PaperStack(stage,direction=>{void this.turnDocument(id??this.activeId!,direction).catch(e=>this.reportError(e));},
      (documentId,layout)=>{const tab=this.tabs.find(t=>t.state.documentId===documentId);if(!tab)return;tab.state.paperLayout=layout;if(tab===this.activeTab)this.prefetch(tab,this.renderSeq);this.onStateChange();},
      (documentId,views)=>{const tab=this.tabs.find(t=>t.state.documentId===documentId);if(tab){tab.state.paperReadingViews=views;this.onStateChange();}},
      ()=>{const tab=this.activeTab;if(tab&&tab.id===id&&this.isStable)this.prefetch(tab,this.renderSeq);},this.onStateChange,id===undefined?undefined:()=>this.desk.pileBounds(id));
  }

  private bindSurface(tab: PdfTab | null): void {
    const previousId=Number(this.container.dataset.tab);if(Number.isFinite(previousId)&&this.tabs.some(t=>t.id===previousId))this.desk.rememberViewport(previousId);
    this.renderSeq++; this.laser.detach(); this.stack.cancel();
    this.container.removeAttribute("id"); this.host.removeAttribute("id"); this.container.parentElement!.removeAttribute("id");
    this.container.setAttribute("aria-busy","false");
    const surface = tab ? this.desk.surface(tab.id)! : null;
    this.container = surface?.container ?? this.emptyContainer; this.host = surface?.host ?? this.emptyHost;
    this.container.id="pdf-viewport"; this.host.id="pdf-host";this.container.parentElement!.id="pdf-stage";
    for(const id of ["loading","ocr-overlay"]){const overlay=document.getElementById(id);if(overlay)this.container.parentElement!.append(overlay);}
    if(tab)this.passiveSeq.set(tab.id,(this.passiveSeq.get(tab.id)??0)+1);
    this.laser.setViewport(this.container);this.stack=tab?this.stacks.get(tab.id)!:this.emptyStack;this.stack.reflow();
    const image=this.pageElement;this.shownTab=image?Number(image.dataset.tab):null;this.shownPage=image?Number(image.dataset.page):null;
    this.container.setAttribute("aria-busy","false");
  }

  get isOpen(): boolean {
    return this.activeId !== null;
  }

  get activeTab(): PdfTab | null {
    return this.tabs.find((t) => t.id === this.activeId) ?? null;
  }

  get tabList(): readonly PdfTab[] {
    return this.tabs;
  }

  get pageCount(): number {
    return this.activeTab?.info.pageCount ?? 0;
  }

  get page(): number {
    return this.activeTab?.page ?? 0;
  }

  get zoomLevel(): number {
    const tab=this.activeTab;
    return tab && this.desk.mode==="desk" ? this.desk.paperWidth(tab.id)/(tab.pageWidthPt*tab.info.baseScale) : tab?.zoom ?? 1;
  }

  private renderZoom(tab:PdfTab,width=tab.pageWidthPt):number {
    return this.desk.mode==="desk" ? clampZoom(this.desk.paperWidth(tab.id)/(width*tab.info.baseScale)*Math.min(2,Math.max(1,devicePixelRatio))*Math.max(1,this.desk.zoom)) : tab.zoom;
  }

  get isStable(): boolean {
    return this.isOpen && this.shownTab === this.activeId && this.shownPage === this.page
      && this.container.getAttribute("aria-busy") === "false" && !this.host.querySelector("[data-moving]");
  }

  cancelInteraction(): void { this.stack.cancel(); this.laser.clear(); }

  get canUseAnchor(): boolean {
    const tab = this.activeTab;
    return !!tab && !this.returningAnchors.has(tab.id) && (!!tab.state.anchor ||
      this.isStable);
  }

  setAnchor(): boolean {
    const tab = this.activeTab;
    if (!tab || tab.state.anchor || !this.canUseAnchor) return false;
    const fraction = (offset: number, range: number) => range > 0 ? Math.max(0, Math.min(1, offset / range)) : 0;
    tab.state.anchor = {
      page: tab.page,
      ...(this.desk.mode==="desk"&&!this.desk.isFramed(tab.id)?this.desk.readingPosition(tab.id):{
      scrollX: fraction(this.container.scrollLeft, this.container.scrollWidth - this.container.clientWidth),
      scrollY: fraction(this.container.scrollTop, this.container.scrollHeight - this.container.clientHeight),
      }),
    };
    this.onStateChange();
    return true;
  }

  async returnToAnchor(): Promise<boolean> {
    const tab = this.activeTab;
    const anchor = tab?.state.anchor;
    if (!tab || !anchor || !this.canUseAnchor) return false;
    this.returningAnchors.add(tab.id);
    this.stack.cancel();
    tab.page = Math.max(0, Math.min(anchor.page, tab.info.pageCount - 1));
    this.onStateChange();
    try {
      const displayed = await this.renderActive(anchor);
      // A navigation, zoom, tab change or render error must not consume an unseen return point.
      if (!displayed || this.activeTab !== tab || tab.state.anchor !== anchor) return false;
      tab.state.anchor = null;
      return true;
    } finally {
      this.returningAnchors.delete(tab.id);
      this.onStateChange();
    }
  }

  /** Opens a PDF in a new tab, makes it active, and renders its first page. */
  async open(path: string, state: DocumentReadingState,restore=false,fresh=false): Promise<PdfTab> {
    const info = await invoke<PdfDocumentInfo>("open_pdf", { path });
    if (!info.pageCount) { await invoke("close_pdf", { tabId: info.tabId }); throw Error("PDF 中没有可阅读的页面"); }
    state.paperLayout = normalizePaperLayout(state.paperLayout);
    state.paperReadingViews = normalizeReadingViews(state.paperReadingViews);
    const tab: PdfTab = {
      id: info.tabId,
      path: info.path,
      title: basename(info.path),
      info,
      page: Math.max(0, Math.min(state.page, info.pageCount - 1)),
      zoom: clampZoom(state.zoom),
      fitMode: state.fitMode,
      pageWidthPt: info.pageWidth,
      pageHeightPt: info.pageHeight,
      state,
    };
    this.tabs.push(tab);
    const surface=this.desk.register(tab,restore);this.stacks.set(tab.id,this.createStack(surface.stage,tab.id));surface.card.addEventListener("lightning-paper-position",()=>this.stacks.get(tab.id)?.reflow());this.observer.observe(surface.container);
    if(restore){this.desk.restoreViewportOnNextRender(tab.id,fresh);if(this.desk.isStowed(tab.id)){if(fresh)this.positions.set(tab.id,"start");this.onStateChange();return tab;}}
    else if(this.desk.isStowed(tab.id))this.desk.setStowed(tab.id,false);
    this.activeId = tab.id;
    this.bindSurface(tab);
    this.stack.cancel(); this.cache.clearPrefetch();
    this.stack.setEnabled(state.readingMode === "paper");
    this.onStateChange();
    await this.renderActive(restore&&!fresh?"preserve":"start");
    this.onStateChange();
    return tab;
  }

  /** Closes a tab and releases native resources. */
  async close(tabId: number): Promise<void> {
    this.desk.transitions.cancel(tabId);
    this.cache.close(tabId);
    const idx = this.tabs.findIndex((t) => t.id === tabId);
    if (idx < 0) return;

    this.tabs.splice(idx, 1);
    const closedSurface=this.desk.surface(tabId);if(closedSurface)this.observer.unobserve(closedSurface.container);
    try {
    if (this.activeId === tabId) {
      this.laser.detach();
      const next = this.tabs.slice(idx).find(t=>!this.desk.isStowed(t.id))??this.tabs.find(t=>!this.desk.isStowed(t.id))??null;
      if(next&&this.desk.mode==="focus")this.desk.restoreViewportOnNextRender(next.id);
      this.activeId = next?.id ?? null;
      this.bindSurface(next);
      this.stack.cancel(); this.cache.clearPrefetch();
      this.stack.setEnabled(next?.state.readingMode === "paper");
      this.renderSeq++;
      this.onStateChange();
      if (this.activeId !== null) {
        await this.renderActive("preserve");
      } else {
        this.container.removeAttribute("aria-busy");
        this.shownPage = null; this.shownTab = null;
        this.host.replaceChildren(this.placeholder());
      }
    }
    this.onStateChange();
    } finally { this.stacks.get(tabId)?.destroy();this.stacks.delete(tabId);this.desk.remove(tabId);this.passiveSeq.delete(tabId);this.positions.delete(tabId);this.onStateChange();await invoke<void>("close_pdf", { tabId }); }
  }

  /** Switches the active tab and re-renders it. */
  private selectDocument(tabId:number|null):void {
    if(tabId!==null&&this.desk.mode==="focus")this.desk.restoreViewportOnNextRender(tabId);
    this.activeId=tabId;this.bindSurface(this.activeTab);this.stack.cancel();this.cache.clearPrefetch();this.stack.setEnabled(this.activeTab?.state.readingMode==="paper");this.onStateChange();
  }
  async turnDocument(tabId:number,delta:number):Promise<void> {
    const tab=this.tabs.find(t=>t.id===tabId);if(!tab)return;
    if(this.activeId!==tabId)this.selectDocument(tabId);
    await this.goToPage(tab.page+delta);
  }
  async activate(tabId: number): Promise<void> {
    if(this.tabs.some(t=>t.id===tabId)&&this.desk.isStowed(tabId))this.desk.setStowed(tabId,false);
    if (tabId === this.activeId) { if (!this.isStable) await this.renderActive(this.positions.get(tabId)??"preserve"); return; }
    if (!this.tabs.some(t => t.id === tabId)) return;
    this.selectDocument(tabId);
    await this.renderActive(this.positions.get(tabId) ?? "preserve");
    this.onStateChange();
  }

  async toggleStow(tabId:number):Promise<void> {
    const tab=this.tabs.find(t=>t.id===tabId);if(!tab)return;
    this.stacks.get(tabId)?.cancel();
    const opening=this.desk.isStowed(tabId),transition=this.desk.transitions.begin(tabId,this.desk.surface(tabId)!.card,opening);
    if(opening){
      this.desk.setStowed(tabId,false);
      try { await this.activate(tabId);this.desk.transitions.play(transition); }
      catch(error){this.desk.transitions.cancel(tabId);throw error;}
      return;
    }
    this.desk.setStowed(tabId,true);
    this.desk.transitions.play(transition);
    if(this.activeId===tabId){const next=this.tabs.find(t=>!this.desk.isStowed(t.id));this.selectDocument(next?.id??null);if(next)await this.renderActive("preserve");}
    this.onStateChange();
  }

  /** Renders the active tab's current page at its current zoom. */
  async renderActive(position: Position = "preserve"): Promise<boolean> {
    const tab = this.activeTab;
    if (!tab) return false;
    const restored=this.desk.takeViewportPosition(tab.id);if(position==="preserve"&&restored)position=restored;

    const seq = ++this.renderSeq;
    this.positions.set(tab.id,position);
    this.stack.endInteractions();
    const existing=this.pageElement;
    if(existing?.dataset.tab===String(tab.id)&&existing.dataset.page===String(tab.page)&&!existing.dataset.moving)this.laser.clear();
    else this.laser.detach();
    const pageIndex = tab.page;
    this.cache.clearPrefetch();
    this.container.setAttribute("aria-busy", "true");
    this.onStateChange();
    try {
      let rasterZoom=this.renderZoom(tab);
      let rendered = await this.cache.request({ tabId: tab.id, pageIndex, zoom: rasterZoom });
      if (!rendered || seq !== this.renderSeq || this.activeTab !== tab) return false;
      // A landscape or differently sized page must still fit before it enters the animation.
      if (this.desk.mode === "desk" || tab.fitMode !== "none") {
        const zoom = this.desk.mode==="desk"?this.renderZoom(tab,rendered.pageWidthPt):this.fitZoom(tab, tab.fitMode as "page"|"width", rendered.pageWidthPt, rendered.pageHeightPt);
        if (Math.abs(rasterZoom - zoom) >= 0.003) {
          rasterZoom=zoom;if(this.desk.mode==="focus")tab.zoom=zoom;
          rendered = await this.cache.request({ tabId: tab.id, pageIndex, zoom });
          if (!rendered || seq !== this.renderSeq || this.activeTab !== tab) return false;
        }
      }
      let img = this.makeImage(rendered, tab.id,rasterZoom);
      await img.decode();
      if (seq !== this.renderSeq || this.activeTab !== tab) return false;

      const old = this.host.querySelector<HTMLImageElement>(".pdf-page");
      const oldRect = old?.getBoundingClientRect();
      const previous = this.shownPage;
      const sameTab = this.shownTab === tab.id;
      const scrollRange = this.container.scrollHeight - this.container.clientHeight;
      const scrollProgress = scrollRange > 0 ? this.container.scrollTop / scrollRange : 0;
      tab.pageWidthPt = rendered.pageWidthPt; tab.pageHeightPt = rendered.pageHeightPt;
      img=this.commitImage(this.host,img);
      this.desk.positionPage(tab.id,position,oldRect);
      const newRange = Math.max(0, this.container.scrollHeight - this.container.clientHeight);
      this.container.scrollTop = typeof position === "object" ? position.scrollY * newRange : position === "end" ? newRange : position === "start" ? 0 : scrollProgress * newRange;
      if (typeof position === "object") this.container.scrollLeft = position.scrollX * Math.max(0, this.container.scrollWidth - this.container.clientWidth);
      else if (position !== "preserve") this.container.scrollLeft = 0;
      this.stack.setEnabled(tab.state.readingMode === "paper");
      if(sameTab&&previous===pageIndex)this.stack.reflow();else this.updateStack(tab);
      if (!this.desk.transitions.has(tab.id) && old && oldRect && sameTab && previous !== null && previous !== pageIndex) this.stack.turn(old, oldRect, img, pageIndex > previous);
      else this.stack.cancel();
      this.shownTab = tab.id; this.shownPage = pageIndex;
      this.positions.delete(tab.id);
      this.prefetch(tab, seq);
      this.refreshInactive();
      this.onStateChange();
      return true;
    } catch (error) {
      if (seq === this.renderSeq && this.activeTab === tab) throw error;
      return false;
    } finally {
      if (seq === this.renderSeq) {
        this.container.setAttribute("aria-busy", "false");
        const image = this.host.querySelector<HTMLImageElement>(".pdf-page");
        if (image?.dataset.tab === String(this.activeId) && image.dataset.page === String(this.page)) this.laser.attach(image);
        this.onStateChange();
      }
    }
  }

  async goToPage(page: number, startAt?: "start" | "end"): Promise<void> {
    const tab = this.activeTab;
    if (!tab) return;
    if (!Number.isFinite(page)) return;
    const clamped = Math.max(0, Math.min(Math.floor(page), tab.info.pageCount - 1));
    if (clamped === tab.page) {
      if (startAt) {
        if (this.shownTab !== tab.id || this.shownPage !== clamped) await this.renderActive(startAt);
        else { this.stack.cancel();this.desk.positionPage(tab.id,startAt,this.pageElement?.getBoundingClientRect());this.container.scrollTop = startAt === "start" ? 0 : this.container.scrollHeight - this.container.clientHeight; }
      }
      return;
    }
    const position = startAt ?? (clamped < tab.page ? "end" : "start");
    tab.page = clamped;
    this.onStateChange();
    await this.renderActive(position);
  }

  async next(): Promise<void> {
    await this.goToPage((this.activeTab?.page ?? 0) + 1);
  }

  async prev(): Promise<void> {
    await this.goToPage((this.activeTab?.page ?? 0) - 1);
  }

  async setZoom(zoom: number): Promise<void> {
    const tab = this.activeTab;
    if (!tab) return;
    if(this.desk.mode==="desk"){this.desk.resizePaper(tab.id,clampZoom(zoom)*tab.pageWidthPt*tab.info.baseScale);await this.renderActive();return;}
    tab.fitMode = "none";
    tab.zoom = clampZoom(zoom);
    this.stack.cancel();
    await this.renderActive();
  }

  /** Fix the document identity before any async work, just like wheel paging. */
  async zoomDocument(tabId:number,factor:number,anchor:{x:number;y:number}):Promise<void> {
    const tab=this.tabs.find(t=>t.id===tabId);if(!tab||!Number.isFinite(factor)||factor<=0)return;
    if(this.activeId!==tabId)this.selectDocument(tabId);
    if(this.desk.mode==="desk"){
      this.desk.resizePaper(tabId,clampZoom(this.zoomLevel*factor)*tab.pageWidthPt*tab.info.baseScale,anchor);
      await this.renderActive();
    }else {
      const image=this.pageElement?.getBoundingClientRect(),u=image?(anchor.x-image.left)/image.width:0,v=image?(anchor.y-image.top)/image.height:0,expected=clampZoom(tab.zoom*factor),page=tab.page;
      await this.setZoom(expected);
      if(this.activeId===tabId&&tab.page===page&&tab.zoom===expected&&image){const next=this.pageElement?.getBoundingClientRect();if(next){this.container.scrollLeft+=next.left+u*next.width-anchor.x;this.container.scrollTop+=next.top+v*next.height-anchor.y;}}
    }
  }

  async zoomIn(): Promise<void> {
    await this.setZoom(this.zoomLevel * 1.25);
  }

  async zoomOut(): Promise<void> {
    await this.setZoom(this.zoomLevel / 1.25);
  }

  /** Fit the page to the container width. */
  async fitToWidth(): Promise<void> {
    await this.fit("width");
  }

  /** Fit the whole page inside the container. */
  async fitToPage(): Promise<void> {
    await this.fit("page");
  }

  private async fit(mode: "width" | "page"): Promise<void> {
    const tab = this.activeTab;
    if (!tab) return;
    if(this.desk.mode==="desk"){this.desk.fitPaper(tab.id,mode);await this.renderActive();return;}
    const zoom = this.fitZoom(tab, mode, tab.pageWidthPt, tab.pageHeightPt);
    if (tab.fitMode === mode && Math.abs(tab.zoom - zoom) < 0.003) return;
    tab.fitMode = mode; tab.zoom = zoom;
    this.stack.cancel();
    await this.renderActive();
  }

  private fitZoom(tab: PdfTab, mode: "width" | "page", width: number, height: number,container=this.container): number {
    const style = getComputedStyle(container);
    const availW = Math.max(1, container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
    const availH = Math.max(1, container.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom));
    const zx = availW / (Math.max(1, width) * tab.info.baseScale);
    const zy = availH / (Math.max(1, height) * tab.info.baseScale);
    return clampZoom(mode === "width" ? zx : Math.min(zx, zy));
  }

  async setReadingMode(mode: ReadingMode): Promise<void> {
    const tab = this.activeTab;
    if (!tab) return;
    if(tab.state.readingMode===mode)return;
    tab.state.readingMode = mode;
    if(mode==="paper")this.desk.preparePiles(tab.id);
    this.stack.setEnabled(mode === "paper");
    this.updateStack(tab);
    this.onStateChange();
    if(this.shownTab===tab.id&&this.shownPage===tab.page)this.prefetch(tab,this.renderSeq);
  }

  private makeImage(rendered: RenderedPage, tabId: number,quality:number): HTMLImageElement {
    const img = new Image();
    img.src = `data:image/png;base64,${rendered.imageBase64}`;
    img.className = "pdf-page";
    // Native raster allocation is bounded; logical zoom remains consistent with fit math.
    const tab=this.tabs.find(t=>t.id===tabId);
    const scale = tab?.info.baseScale ?? 2;
    const zoom = tab&&this.desk.mode==="desk" ? this.desk.paperWidth(tabId)/(rendered.pageWidthPt*scale) : tab?.zoom ?? 1;
    img.width = Math.max(1, Math.round(rendered.pageWidthPt * scale * zoom));
    img.height = Math.max(1, Math.round(rendered.pageHeightPt * scale * zoom));
    img.alt = `Page ${rendered.pageIndex + 1}`;
    img.dataset.page = String(rendered.pageIndex);
    img.dataset.tab = String(tabId);
    img.dataset.quality=quality.toFixed(4);
    img.draggable = false;
    return img;
  }

  private commitImage(host:HTMLElement,image:HTMLImageElement):HTMLImageElement {
    const previous=host.querySelector<HTMLImageElement>(".pdf-page");
    if(previous&&previous.dataset.tab===image.dataset.tab&&previous.dataset.page===image.dataset.page&&!previous.dataset.moving){
      // Keep the wheel target alive while a continuous zoom gesture refreshes its pixels.
      previous.src=image.src;previous.width=image.width;previous.height=image.height;previous.dataset.quality=image.dataset.quality;return previous;
    }
    const sheet=document.createElement("div");sheet.className="pdf-sheet";sheet.append(image);host.replaceChildren(sheet);return image;
  }

  resetPaperLayout(): void {
    const tab = this.activeTab;
    if (!tab) return;
    this.stack.cancel(); tab.state.paperLayout = defaultPaperLayout(); this.updateStack(tab);
    if (this.shownTab === tab.id && this.shownPage === tab.page) this.prefetch(tab, this.renderSeq);
    this.onStateChange();
  }

  rememberPaperReading(side: PaperSide): void { this.stack.rememberReading(side); }
  beginPaperReading(side: PaperSide): void { this.stack.beginReading(side); }
  endPaperReading(): void { this.stack.endReading(); }

  private updateStack(tab: PdfTab): void {
    this.stack.update(tab, page => this.cache.peek({ tabId: tab.id, pageIndex: page, zoom: this.stack.thumbnailZoom(page, tab) })
      ?? this.cache.peek({ tabId: tab.id, pageIndex: page, zoom: THUMB_ZOOM }));
  }

  private prefetch(tab: PdfTab, seq: number): void {
    this.cache.clearPrefetch();
    const revision = ++this.previewRevision;
    const page = tab.page;
    const adjacent = [page + 1, page - 1].filter(p => p >= 0 && p < tab.info.pageCount);
    const thumbs = [page - 1, page + 1, page - 2, page + 2, page - 3, page + 3].filter(p => p >= 0 && p < tab.info.pageCount);
    const requests = tab.state.readingMode === "paper" ? thumbs.slice(0, 2).map(pageIndex => ({ pageIndex, zoom: this.stack.thumbnailZoom(pageIndex, tab), preview: true })) : [];
    const zoom=this.renderZoom(tab);
    if (zoom <= 1.5) requests.push(...adjacent.map(pageIndex => ({ pageIndex, zoom, preview: false })));
    if (tab.state.readingMode === "paper") requests.push(...thumbs.slice(2).map(pageIndex => ({ pageIndex, zoom: THUMB_ZOOM, preview: true })));
    for (const request of requests) {
      void this.cache.request({ tabId: tab.id, pageIndex: request.pageIndex, zoom: request.zoom }, true).then(rendered => {
        if (rendered && revision === this.previewRevision && seq === this.renderSeq && this.activeTab === tab && tab.page === page && request.preview) this.stack.thumbnail(request.pageIndex, rendered);
      }).catch(() => {}); // A missing preview must never prevent reading the full page.
    }
  }

  private reportError(error: unknown): void {
    const status = document.getElementById("status");
    if (status) { status.textContent = `翻页失败：${error}`; status.classList.add("error"); }
  }

  /** Visible papers finish their latest page even when focus changes during a native render. */
  private refreshInactive(): void {
    if(this.desk.mode!=="desk")return;
    for(const tab of this.tabs){
      if(tab===this.activeTab||this.desk.isStowed(tab.id))continue;const view=this.desk.surface(tab.id),shown=view?.host.querySelector<HTMLImageElement>(".pdf-page");if(!view||view.container.getAttribute("aria-busy")==="true"||shown?.dataset.page===String(tab.page)&&shown.dataset.quality===this.renderZoom(tab).toFixed(4))continue;
      const page=tab.page,seq=(this.passiveSeq.get(tab.id)??0)+1;this.passiveSeq.set(tab.id,seq);view.container.setAttribute("aria-busy","true");view.card.classList.add("document-loading");
      const valid=()=>this.tabs.includes(tab)&&this.activeTab!==tab&&tab.page===page&&this.passiveSeq.get(tab.id)===seq;
      void(async()=>{
        try{
          let rasterZoom=this.renderZoom(tab),rendered=await this.cache.request({tabId:tab.id,pageIndex:page,zoom:rasterZoom},true);if(!rendered||!valid())return;
          if(this.desk.mode==="desk"||tab.fitMode!=="none"){
            const zoom=this.desk.mode==="desk"?this.renderZoom(tab,rendered.pageWidthPt):this.fitZoom(tab,tab.fitMode as "page"|"width",rendered.pageWidthPt,rendered.pageHeightPt,view.container);
            if(Math.abs(rasterZoom-zoom)>=.003){rasterZoom=zoom;if(this.desk.mode==="focus")tab.zoom=zoom;rendered=await this.cache.request({tabId:tab.id,pageIndex:page,zoom},true);if(!rendered||!valid())return;}
          }
          const image=this.makeImage(rendered,tab.id,rasterZoom);await image.decode();if(!valid())return;
          const previous=view.host.querySelector<HTMLImageElement>(".pdf-page"),oldRect=previous?.getBoundingClientRect(),backward=previous&&Number(previous.dataset.page)>page;
          const position=this.positions.get(tab.id)??(backward?"end":"start");
          const fraction=view.container.scrollTop/Math.max(1,view.container.scrollHeight-view.container.clientHeight);
          this.commitImage(view.host,image);
          tab.pageWidthPt=rendered.pageWidthPt;tab.pageHeightPt=rendered.pageHeightPt;
          this.desk.positionPage(tab.id,position,oldRect);
          const stack=this.stacks.get(tab.id)!;stack.setEnabled(tab.state.readingMode==="paper");if(previous?.dataset.page===String(page))stack.reflow();else stack.update(tab,p=>this.cache.peek({tabId:tab.id,pageIndex:p,zoom:THUMB_ZOOM}));
          const range=Math.max(0,view.container.scrollHeight-view.container.clientHeight);
          view.container.scrollTop=typeof position==="object"?position.scrollY*range:position==="end"?range:position==="preserve"?fraction*range:0;
          if(typeof position==="object")view.container.scrollLeft=position.scrollX*Math.max(0,view.container.scrollWidth-view.container.clientWidth);
          else if(position!=="preserve")view.container.scrollLeft=0;
          this.positions.delete(tab.id);delete view.card.dataset.renderError;
        }catch(e){if(valid()){view.card.dataset.renderError=String(e);view.card.title=`页面显示失败，点击重试：${e}`;}}
        finally{if(valid()){view.container.setAttribute("aria-busy","false");view.card.classList.remove("document-loading");this.onStateChange();}}
      })();
    }
  }

  private placeholder(): HTMLElement {
    const div = document.createElement("div");
    div.className = "placeholder";
    div.innerHTML = `
      <span class="empty-mark"><svg viewBox="0 0 32 36" aria-hidden="true"><path d="M20 3 7 21h9l-4 13L27 14h-9Z" fill="currentColor"/></svg></span><p class="placeholder-title">把注意力留给这一页。</p>
      <p>打开一份 PDF，开始轻快、专注的阅读。</p>
      <button class="btn primary empty-open">打开 PDF <kbd>Ctrl O</kbd></button>
      <p class="placeholder-hint">也可以将文件拖放到窗口 · 一切留在本机</p>`;
    div.querySelector("button")!.onclick = () => document.getElementById("open-btn")?.click();
    return div;
  }
}
