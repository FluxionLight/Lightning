import type { PdfTab, RenderedPage, PaperLayout, PaperReadingViews, PaperPileLayout } from "./types";
import { defaultPaperLayout, normalizePaperLayout, normalizeReadingViews, paperWidth, PAPER_MARGIN_X, PAPER_MARGIN_Y, PAPER_CHROME_HEIGHT } from "./paper-layout";
import type { PaperSide } from "./paper-layout";

const EASING = "cubic-bezier(.22,.78,.24,1)";
const DURATION = 340;
type Slot = { page: number; sheet: HTMLElement };
type Panel = { root: HTMLElement; pile: HTMLButtonElement; grip: HTMLButtonElement; resize: HTMLButtonElement; remember: HTMLButtonElement };
type Gesture = { side: PaperSide; resize: boolean; pointer: number; handle: HTMLElement; x: number; y: number; left: number; top: number; width: number; original: PaperLayout };

/** Floating page previews keep their own layout, separate from the main PDF/OCR coordinates. */
export class PaperStack {
  private events=new AbortController();
  private before: HTMLButtonElement;
  private after: HTMLButtonElement;
  private flights: HTMLElement[] = [];
  private arrival: Animation | null = null;
  private arrivingImage: HTMLImageElement | null = null;
  private slots: Slot[] = [];
  private enabled = false;
  private panels: Record<PaperSide, Panel>;
  private layout: PaperLayout = defaultPaperLayout();
  private documentId = "";
  private gesture: Gesture | null = null;
  private readingViews: PaperReadingViews = { before: null, after: null };
  private reading: { side: PaperSide; scrollTop: number; scrollLeft: number } | null = null;
  private readingAnimations = new Map<PaperSide, Animation>();
  private press: { side: PaperSide; pointer: number; x: number; y: number; timer: number; triggered: boolean } | null = null;
  private suppressClickUntil = 0;

  constructor(private stage: HTMLElement, onNavigate: (direction: number) => void, private onLayoutChange: (documentId: string, layout: PaperLayout) => void,
    private onReadingChange: (documentId: string, views: PaperReadingViews) => void, private onPreviewChange: () => void,
    private onSettled: () => void = () => {}, private looseBounds?:()=>{x:number;y:number;width:number;height:number}) {
    this.panels = { before: this.makePanel("before", () => onNavigate(-1)), after: this.makePanel("after", () => onNavigate(1)) };
    this.before = this.panels.before.pile; this.after = this.panels.after.pile;
    this.stage.append(this.panels.before.root, this.panels.after.root);
    window.addEventListener("blur", () => this.cancel(),{signal:this.events.signal});
    window.addEventListener("keydown", event => {
      if (event.key === "Escape" && this.gesture) { event.preventDefault(); this.finishGesture(true); }
      if (event.key === "Escape" && (this.press || this.reading)) { event.preventDefault(); this.finishPress(); this.endReading(); }
    },{signal:this.events.signal});
  }

  private makePanel(side: PaperSide, onClick: () => void): Panel {
    const name = side === "before" ? "前页" : "后页";
    const root = document.createElement("div"); root.className = `paper-panel paper-panel-${side}`;
    root.setAttribute("role", "group"); root.setAttribute("aria-label", `${name}纸叠预览`);
    const button = document.createElement("button");
    button.type = "button"; button.className = `paper-pile paper-pile-${side}`;
    button.onclick = event => {
      if (performance.now() < this.suppressClickUntil) { this.suppressClickUntil = 0; return; }
      const deck = button.querySelector<HTMLElement>(".paper-deck");
      if (event.detail && deck && deck.scrollHeight > deck.clientHeight) {
        const rect = deck.getBoundingClientRect();
        if (event.clientX >= rect.right - 18 && event.clientY >= rect.top && event.clientY <= rect.bottom) return;
      }
      onClick();
    };
    button.oncontextmenu = event => { if (this.press || this.reading) event.preventDefault(); };
    button.onpointerdown = event => {
      this.suppressClickUntil = 0;
      if (event.button !== 0 || !this.enabled || !this.readingViews[side] || button.disabled) return;
      const deck = button.querySelector<HTMLElement>(".paper-deck");
      if (deck && deck.scrollHeight > deck.clientHeight && event.clientX >= deck.getBoundingClientRect().right - 18) return;
      this.finishPress();
      const timer = window.setTimeout(() => {
        if (!this.press || this.press.side !== side) return;
        this.press.triggered = true; this.beginReading(side);
      }, 350);
      this.press = { side, pointer: event.pointerId, x: event.clientX, y: event.clientY, timer, triggered: false };
      button.setPointerCapture(event.pointerId);
    };
    button.onpointermove = event => {
      if (this.press?.pointer === event.pointerId && !this.press.triggered && Math.hypot(event.clientX - this.press.x, event.clientY - this.press.y) > 8) { this.finishPress(); this.suppressClickUntil = performance.now() + 500; }
    };
    button.onpointerup = button.onpointercancel = event => { if (this.press?.pointer === event.pointerId) this.finishPress(); };
    button.onlostpointercapture = () => { if (this.press?.side === side) this.finishPress(); };
    const grip = document.createElement("button"); grip.type = "button"; grip.className = "paper-panel-grip"; grip.textContent = `⠿ ${name}`;
    grip.title = "拖动调整位置；方向键也可移动"; grip.setAttribute("aria-label", `拖动${name}纸叠`);
    const remember = document.createElement("button"); remember.type = "button"; remember.className = "paper-panel-remember"; remember.textContent = "记";
    remember.title = "记住当前大小和位置；长按纸叠临时展开，松开复原"; remember.setAttribute("aria-label", `记忆${name}阅读篇幅`);
    remember.onclick = () => this.rememberReading(side);
    const resize = document.createElement("button"); resize.type = "button"; resize.className = "paper-panel-resize"; resize.textContent = "◢";
    resize.title = "拖动调整大小；方向键也可缩放"; resize.setAttribute("aria-label", `调整${name}纸叠大小`);
    for (const [handle, resizing] of [[grip, false], [resize, true]] as const) {
      handle.onpointerdown = event => this.startGesture(side, resizing, handle, event);
      handle.onpointermove = event => this.moveGesture(event);
      handle.onpointerup = event => { if (this.gesture?.pointer === event.pointerId) this.finishGesture(false); };
      handle.onpointercancel = () => this.finishGesture(true);
      handle.onlostpointercapture = () => this.finishGesture(true);
      handle.onkeydown = event => this.keyboard(side, resizing, event);
    }
    root.append(grip, remember, button, resize);
    return { root, pile: button, grip, resize, remember };
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.stage.classList.toggle("paper-mode", enabled);
    if (!enabled) this.cancel();
  }

  attachStage(stage: HTMLElement): void {
    if (stage === this.stage) return;
    this.cancel(); this.stage = stage;
    stage.append(this.panels.before.root, this.panels.after.root);
    this.reflow();
  }

  update(tab: PdfTab, peek: (page: number) => RenderedPage | null): void {
    this.finishPress(); this.endReading(false); this.cancelReadingAnimations();
    this.finishGesture(true);
    this.documentId = tab.state.documentId;
    this.layout = normalizePaperLayout(tab.state.paperLayout);
    this.readingViews = normalizeReadingViews(tab.state.paperReadingViews);
    this.slots = [];
    for (const side of ["before", "after"] as const) {
      const button = side === "before" ? this.before : this.after;
      const count = side === "before" ? tab.page : tab.info.pageCount - tab.page - 1;
      const direction = side === "before" ? -1 : 1;
      button.disabled = count === 0;
      button.setAttribute("aria-label", side === "before" ? "前一页纸叠" : "后一页纸叠");
      button.title = count ? `${side === "before" ? "上一页" : "下一页"} · ${count} 页` : (side === "before" ? "已到首页" : "已到末页");
      if (count && this.readingViews[side]) button.title += " · 长按查看阅读篇幅，松开复原";
      this.panels[side].remember.setAttribute("aria-pressed", String(!!this.readingViews[side]));
      button.replaceChildren();
      const deck = document.createElement("span"); deck.className = "paper-deck";
      for (let index = Math.min(count, 3) - 1; index >= 0; index--) {
        const page = tab.page + direction * (index + 1);
        const sheet = document.createElement("span"); sheet.className = "paper-sheet";
        if (index === 0) sheet.classList.add("paper-sheet-front");
        sheet.dataset.page = String(page); sheet.style.setProperty("--sheet-depth", String(index));
        sheet.style.zIndex = String(3 - index);
        const rendered = peek(page);
        if (rendered) {
          this.setThumbnail(sheet, rendered);
          if (index === 0) deck.style.aspectRatio = `${rendered.pageWidthPt} / ${rendered.pageHeightPt}`;
        }
        const number = document.createElement("span"); number.className = "paper-sheet-number"; number.textContent = String(page + 1);
        sheet.append(number); deck.append(sheet); this.slots.push({ page, sheet });
      }
      if (!count) { const empty = document.createElement("span"); empty.className = "paper-empty"; empty.textContent = side === "before" ? "首页" : "末页"; deck.append(empty); }
      const label = document.createElement("span"); label.className = "paper-pile-label";
      label.textContent = side === "before" ? `已读 ${count} 页` : `后续 ${count} 页`;
      button.append(deck, label);
    }
    this.reflow();
  }

  /** Only clamp the displayed geometry; retain the saved size for larger windows. */
  reflow(): void {
    let initialized=false;
    for (const side of ["before", "after"] as const) {
      const { root } = this.panels[side];
      const item = this.reading?.side === side ? this.readingViews[side]! : this.layout[side];
      const width = this.panelWidth(item);
      root.style.width = `${width}px`;
      root.style.setProperty("--paper-max-deck-height", `${Math.max(32, this.panelSpace().height - PAPER_MARGIN_Y * 2 - PAPER_CHROME_HEIGHT)}px`);
      root.classList.toggle("paper-panel-large", width > 180);
      const travel = this.travel(side);
      const area=this.pileArea();
      if(this.onDesk&&this.enabled&&this.documentId&&!item.desk&&this.reading?.side!==side){item.desk={x:this.originX(side)+item.x*travel.x,y:PAPER_MARGIN_Y+item.y*travel.y};initialized=true;}
      root.style.left = `${area.x + (this.onDesk&&item.desk?item.desk.x:this.originX(side)+item.x*travel.x)}px`;
      root.style.top = `${area.y + (this.onDesk&&item.desk?item.desk.y:PAPER_MARGIN_Y+item.y*travel.y)}px`;
    }
    if(initialized)this.onLayoutChange(this.documentId,normalizePaperLayout(this.layout));
  }

  thumbnailZoom(page: number, tab: PdfTab): number {
    if (Math.abs(page - tab.page) !== 1) return 0.18;
    const panel = this.panels[page < tab.page ? "before" : "after"];
    const width = panel.root.offsetWidth;
    const needed = width * Math.min(2, Math.max(1.5, devicePixelRatio)) / (Math.max(1, tab.pageWidthPt) * tab.info.baseScale);
    return [0.18, 0.35, 0.6, 1, 1.5, 2].find(zoom => zoom >= needed) ?? 2;
  }

  private travel(side: PaperSide): { x: number; y: number } {
    const root = this.panels[side].root;
    const area=this.pileArea();
    return { x: this.onDesk ? area.width+root.offsetWidth+56 : Math.max(0, area.width - PAPER_MARGIN_X * 2 - root.offsetWidth), y: Math.max(0, area.height - PAPER_MARGIN_Y * 2 - root.offsetHeight) };
  }
  private pileArea():{x:number;y:number;width:number;height:number}{return this.onDesk&&this.looseBounds?this.looseBounds():{x:0,y:0,width:this.stage.clientWidth,height:this.stage.clientHeight};}
  private get onDesk():boolean{return !this.stage.closest(".document-framed")&&this.stage.closest("#reading-workspace")?.getAttribute("data-mode")==="desk";}
  private panelSpace():{width:number;height:number} {
    const workspace=this.onDesk?this.stage.closest<HTMLElement>("#reading-workspace"):null;
    if(workspace){const scale=this.displayScale();return {width:workspace.clientWidth/scale,height:workspace.clientHeight/scale};}
    return {width:this.stage.clientWidth,height:this.stage.clientHeight};
  }
  private panelWidth(item:PaperPileLayout):number {
    // A loose paper changing size must not resize its neighboring previews.
    return paperWidth(this.onDesk&&!item.width?{...item,width:48}:item,this.panelSpace().width);
  }
  private originX(side:PaperSide):number{return this.onDesk?-this.panels[side].root.offsetWidth-28:PAPER_MARGIN_X;}

  rememberReading(side: PaperSide): void {
    if (!this.enabled || !this.documentId) return;
    this.cancel();
    this.readingViews[side] = { ...this.layout[side], width: this.panels[side].root.offsetWidth };
    this.panels[side].remember.setAttribute("aria-pressed", "true");
    this.panels[side].pile.title = this.panels[side].pile.title.split(" · 长按")[0] + " · 长按查看阅读篇幅，松开复原";
    this.onReadingChange(this.documentId, normalizeReadingViews(this.readingViews));
  }
  beginReading(side: PaperSide): void {
    if (!this.enabled || !this.readingViews[side] || this.panels[side].pile.disabled || this.reading?.side === side) return;
    this.endReading(false); this.finishGesture(true);
    const { root, pile } = this.panels[side];
    const rect = root.getBoundingClientRect();
    const deck = pile.querySelector<HTMLElement>(".paper-deck")!;
    this.reading = { side, scrollTop: deck.scrollTop, scrollLeft: deck.scrollLeft };
    root.classList.add("paper-panel-peeking"); root.dataset.reading = "true";
    this.reflow(); this.animateReading(side, rect); this.onPreviewChange();
  }
  endReading(animate = true): void {
    const reading = this.reading; if (!reading) return;
    const { root, pile } = this.panels[reading.side], rect = root.getBoundingClientRect();
    this.reading = null; root.classList.remove("paper-panel-peeking"); delete root.dataset.reading;
    this.reflow();
    const deck = pile.querySelector<HTMLElement>(".paper-deck");
    if (deck) { deck.scrollTop = reading.scrollTop; deck.scrollLeft = reading.scrollLeft; }
    if (animate) this.animateReading(reading.side, rect);
    else this.cancelReadingAnimations();
    this.onPreviewChange();
  }
  private animateReading(side: PaperSide, from: DOMRect): void {
    const root = this.panels[side].root;
    this.readingAnimations.get(side)?.cancel(); this.readingAnimations.delete(side);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { root.classList.remove("paper-panel-transitioning"); return; }
    const to = root.getBoundingClientRect(); if (!to.width || !to.height) return;
    const scale=this.displayScale();
    root.classList.add("paper-panel-transitioning");
    const animation = root.animate([
      { transform: `translate(${(from.left - to.left)/scale}px, ${(from.top - to.top)/scale}px) scale(${from.width / to.width}, ${from.height / to.height})` },
      { transform: "none" },
    ], { duration: 240, easing: EASING });
    this.readingAnimations.set(side, animation);
    void animation.finished.catch(() => {}).then(() => {
      if (this.readingAnimations.get(side) !== animation) return;
      this.readingAnimations.delete(side); root.classList.remove("paper-panel-transitioning");
    });
  }
  private cancelReadingAnimations(): void {
    for (const [side, animation] of this.readingAnimations) { animation.cancel(); this.panels[side].root.classList.remove("paper-panel-transitioning"); }
    this.readingAnimations.clear();
  }
  private finishPress(): void {
    const press = this.press; if (!press) return;
    this.press = null; window.clearTimeout(press.timer);
    if (press.triggered) { this.suppressClickUntil = performance.now() + 500; this.endReading(); }
    const button = this.panels[press.side].pile;
    if (button.hasPointerCapture(press.pointer)) button.releasePointerCapture(press.pointer);
  }
  private startGesture(side: PaperSide, resize: boolean, handle: HTMLElement, event: PointerEvent): void {
    if (event.button !== 0 || !this.enabled) return;
    event.preventDefault(); event.stopPropagation(); this.cancel();
    const rect = this.panels[side].root.getBoundingClientRect(), stage = this.stage.getBoundingClientRect();
    const scale=this.displayScale();
    this.gesture = { side, resize, pointer: event.pointerId, handle, x: event.clientX/scale, y: event.clientY/scale, left: (rect.left - stage.left)/scale, top: (rect.top - stage.top)/scale, width: rect.width/scale, original: normalizePaperLayout(this.layout) };
    handle.focus({ preventScroll: true }); handle.setPointerCapture(event.pointerId);
    this.panels[side].root.classList.add("paper-panel-editing");
  }
  private moveGesture(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointer) return;
    event.preventDefault(); event.stopPropagation();
    const item = this.layout[gesture.side];
    const x=event.clientX/this.displayScale(),y=event.clientY/this.displayScale();
    if (gesture.resize) {
      const dx = x - gesture.x, dy = (y - gesture.y) * 0.75;
      item.width = this.panelWidth({ ...item, width: Math.max(48, gesture.width + (Math.abs(dx) >= Math.abs(dy) ? dx : dy)) });
      this.reflow();
      // Resizing grows from the current top-left corner, not from a bottom/right anchor.
    }
    const travel = this.travel(gesture.side);
    const area=this.pileArea();
    if(this.onDesk){
      item.desk={x:this.deskCoordinate(gesture.left+(gesture.resize?0:x-gesture.x)-area.x),y:this.deskCoordinate(gesture.top+(gesture.resize?0:y-gesture.y)-area.y)};
    }else{
      item.x = travel.x ? Math.min(1, Math.max(0, (gesture.left + (gesture.resize ? 0 : x - gesture.x) - this.originX(gesture.side)) / travel.x)) : 0;
      item.y = travel.y ? Math.min(1, Math.max(0, (gesture.top + (gesture.resize ? 0 : y - gesture.y) - PAPER_MARGIN_Y) / travel.y)) : 0;
    }
    this.reflow();
  }
  private finishGesture(cancel: boolean): void {
    const gesture = this.gesture;
    if (!gesture) return;
    this.gesture = null;
    this.panels[gesture.side].root.classList.remove("paper-panel-editing");
    if (gesture.handle.hasPointerCapture(gesture.pointer)) gesture.handle.releasePointerCapture(gesture.pointer);
    if (cancel) this.layout = gesture.original;
    this.reflow();
    if (!cancel) this.onLayoutChange(this.documentId, normalizePaperLayout(this.layout));
  }
  private keyboard(side: PaperSide, resize: boolean, event: KeyboardEvent): void {
    if (event.key === "Escape" && this.gesture) { event.preventDefault(); event.stopPropagation(); this.finishGesture(true); return; }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation(); this.cancel();
    const item = this.layout[side], step = event.shiftKey ? 40 : 10, travel = this.travel(side);
    if (event.key === "Home") this.layout[side] = defaultPaperLayout()[side];
    else if (resize) {
      const direction = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1;
      const width = this.panels[side].root.offsetWidth;
      item.width = this.panelWidth({ ...item, width: Math.max(48, width + direction * step) });
    } else if(this.onDesk){
      const p=item.desk??{x:this.originX(side)+item.x*travel.x,y:PAPER_MARGIN_Y+item.y*travel.y};item.desk={x:this.deskCoordinate(p.x+(event.key==="ArrowLeft"?-step:event.key==="ArrowRight"?step:0)),y:this.deskCoordinate(p.y+(event.key==="ArrowUp"?-step:event.key==="ArrowDown"?step:0))};
    } else {
      if (event.key === "ArrowLeft") item.x -= step / Math.max(1, travel.x);
      if (event.key === "ArrowRight") item.x += step / Math.max(1, travel.x);
      if (event.key === "ArrowUp") item.y -= step / Math.max(1, travel.y);
      if (event.key === "ArrowDown") item.y += step / Math.max(1, travel.y);
      this.layout = normalizePaperLayout(this.layout);
    }
    this.reflow(); this.onLayoutChange(this.documentId, normalizePaperLayout(this.layout));
  }
  private deskCoordinate(n:number):number{return Math.max(-1e9,Math.min(1e9,n));}

  thumbnail(page: number, rendered: RenderedPage): void {
    for (const slot of this.slots) if (slot.page === page) this.setThumbnail(slot.sheet, rendered);
    this.reflow();
  }
  private setThumbnail(sheet: HTMLElement, rendered: RenderedPage): void {
    let img = sheet.querySelector("img");
    if (!img) { img = new Image(); img.alt = ""; img.draggable = false; sheet.prepend(img); }
    img.src = `data:image/png;base64,${rendered.imageBase64}`;
    if (sheet.classList.contains("paper-sheet-front") && sheet.parentElement) sheet.parentElement.style.aspectRatio = `${rendered.pageWidthPt} / ${rendered.pageHeightPt}`;
  }

  /** FLIP transforms use the visible position even when the previous arrival is mid-flight. */
  turn(oldImage: HTMLImageElement, oldRect: DOMRect, next: HTMLImageElement, forward: boolean): void {
    if (!this.enabled || matchMedia("(prefers-reduced-motion: reduce)").matches) { this.cancel(); return; }
    const stageRect = this.stage.getBoundingClientRect();
    const scale=this.displayScale();
    const target = next.getBoundingClientRect();
    if (!target.width || !oldRect.width) return;
    this.cancelArrival();
    const source = this.sheetRect(forward ? this.after : this.before, target.width / target.height);
    const destination = this.sheetRect(forward ? this.before : this.after, oldRect.width / oldRect.height);
    const clone = oldImage.cloneNode() as HTMLImageElement;
    clone.className = "paper-flight"; clone.removeAttribute("data-moving"); clone.alt = "";
    clone.setAttribute("aria-hidden", "true");
    Object.assign(clone.style, { left: `${(oldRect.left - stageRect.left)/scale}px`, top: `${(oldRect.top - stageRect.top)/scale}px`, width: `${oldRect.width/scale}px`, height: `${oldRect.height/scale}px` });
    this.stage.append(clone); this.flights.push(clone);
    while (this.flights.length > 4) this.removeFlight(this.flights[0]);
    const flight = clone.animate([
      { transform: "none", opacity: 1 },
      { transform: `translate(${(destination.left - oldRect.left)/scale}px, ${(destination.top - oldRect.top)/scale}px) scale(${destination.width / oldRect.width}, ${destination.height / oldRect.height}) rotate(${forward ? -6 : 6}deg)`, opacity: 0.7 },
    ], { duration: DURATION, easing: EASING, fill: "forwards" });
    void flight.finished.catch(() => {}).then(() => this.removeFlight(clone));

    next.dataset.moving = "true"; this.arrivingImage = next;
    const arrival = next.animate([
      { transform: `translate(${(source.left - target.left)/scale}px, ${(source.top - target.top)/scale}px) scale(${source.width / target.width}, ${source.height / target.height}) rotate(${forward ? 6 : -6}deg)`, opacity: 0.8 },
      { transform: "none", opacity: 1 },
    ], { duration: DURATION, easing: EASING });
    this.arrival = arrival;
    void arrival.finished.catch(() => {}).then(() => {
      if (this.arrival !== arrival) return;
      delete next.dataset.moving; this.arrival = null; this.arrivingImage = null;
      this.onSettled();
    });
  }

  private sheetRect(button: HTMLButtonElement, aspect: number): DOMRect {
    const deck = button.querySelector(".paper-deck")!.getBoundingClientRect();
    const width = Math.min(deck.width, deck.height * aspect), height = width / aspect;
    return new DOMRect(deck.left + (deck.width - width) / 2, deck.top + (deck.height - height) / 2, width, height);
  }
  private displayScale(): number {return this.stage.getBoundingClientRect().width/Math.max(1,this.stage.clientWidth)||1;}
  private removeFlight(el: HTMLElement): void {
    for (const animation of el.getAnimations()) animation.cancel();
    el.remove(); this.flights = this.flights.filter(f => f !== el);
  }
  private cancelArrival(): void {
    this.arrival?.cancel(); this.arrival = null;
    if (this.arrivingImage) delete this.arrivingImage.dataset.moving;
    this.arrivingImage = null;
  }
  cancel(): void {
    this.finishPress(); this.endReading(false); this.cancelReadingAnimations();
    this.finishGesture(true);
    this.cancelArrival();
    for (const flight of [...this.flights]) this.removeFlight(flight);
  }

  endInteractions(): void {
    this.finishPress(); this.endReading(false); this.cancelReadingAnimations(); this.finishGesture(true);
  }
  destroy():void {this.cancel();this.events.abort();this.panels.before.root.remove();this.panels.after.root.remove();}
}
