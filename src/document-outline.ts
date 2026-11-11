import { invoke } from "@tauri-apps/api/core";
import type { PdfViewer } from "./pdf-viewer";
import type { OutlineEntry } from "./types";

/** One transient outline belongs to the selected file, never to the application edge. */
export class DocumentOutline {
  private panel = document.getElementById("outline")!;
  private list = document.getElementById("outline-items")!;
  private owner: number | null = null;
  private revision = 0;
  private preferredWidth = 230;
  private entries = new Map<number, OutlineEntry[]>();
  private observer = new ResizeObserver(() => this.positionAll());

  constructor(private viewer: PdfViewer, private navigate: (page: number) => void, private report: (message: string, error?: boolean) => void) {
    viewer.desk.root.append(this.panel);
    this.panel.classList.add("document-outline");
    viewer.desk.root.addEventListener("click", e => {
      const button=(e.target as Element).closest(".document-outline-toggle");
      if(button)this.toggle(Number(button.closest<HTMLElement>(".document-card")!.dataset.tab));
    });
    viewer.desk.root.addEventListener("keydown",e=>{if(e.key==="Escape"&&(e.target as Element).closest(".document-outline-toggle")&&this.owner!==null){e.preventDefault();e.stopPropagation();this.close(true);}});
    document.getElementById("outline-close")!.onclick = () => this.close(true);
    viewer.desk.root.addEventListener("lightning-camera-position", () => this.positionAll());
    viewer.desk.root.addEventListener("lightning-paper-position", e => {
      const id=Number((e.target as HTMLElement).dataset.tab);this.positionButton(id);if(this.owner===id)this.position();
    },true);
    viewer.desk.root.addEventListener("scroll",e=>{const viewport=e.target as HTMLElement;if(viewport.matches(".pdf-viewport"))this.positionButton(Number(viewport.dataset.tab));},true);
    this.observer.observe(viewer.desk.root);
    viewer.desk.root.addEventListener("pointerdown", e => {
      if (this.owner !== null && !(e.target as Element).closest(`.document-card[data-tab="${this.owner}"]`)) this.close();
    }, true);
    window.addEventListener("blur", () => this.close());
    window.addEventListener("resize", () => this.positionAll());
    this.panel.addEventListener("wheel", e => { e.stopPropagation(); if (e.ctrlKey) e.preventDefault(); }, { passive: false });
    this.panel.addEventListener("keydown", e => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this.close(true); }
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", " "].includes(e.key)) e.stopPropagation();
    });
  }

  sync(): void {
    const tab = this.viewer.activeTab;
    if (this.owner !== null && (tab?.id !== this.owner || this.viewer.desk.isStowed(this.owner))) this.close();
    for (const id of this.entries.keys()) if (!this.viewer.tabList.some(t => t.id === id)) this.entries.delete(id);
    for(const file of this.viewer.tabList){const button=this.button(file.id);if(!button)continue;const expanded=this.owner===file.id;button.setAttribute("aria-expanded",String(expanded));button.setAttribute("aria-label",`${expanded?"收起":"展开"} ${file.title} 的目录`);button.title=button.getAttribute("aria-label")!;}
    this.positionAll();
    if (this.owner !== null) {
      for (const item of this.list.querySelectorAll<HTMLElement>("[data-page]")) {
        if (Number(item.dataset.page) === tab?.page) item.setAttribute("aria-current", "location"); else item.removeAttribute("aria-current");
      }
      this.position();
    }
  }

  private toggle(id:number): void {
    if(this.owner===id){this.close(true);return;}
    const tab=this.viewer.tabList.find(t=>t.id===id);if(!tab||this.viewer.desk.isStowed(id))return;
    // Selecting a visible file is synchronous; its page rendering can finish independently.
    if(this.viewer.activeTab?.id!==id)void this.viewer.activate(id).catch(error=>this.report(`无法切换文件：${error}`,true));
    if(this.viewer.activeTab!==tab)return;
    this.close();
    const surface = this.viewer.desk.surface(tab.id)!;
    const available = surface.card.getBoundingClientRect().left - this.viewer.desk.root.getBoundingClientRect().left - 24;
    this.preferredWidth = available >= 180 ? Math.min(230, available) : 230;
    this.viewer.desk.transitions.cancelAll();
    this.owner = tab.id; const revision = ++this.revision;
    this.panel.dataset.tab = String(tab.id);
    this.panel.querySelector(".side-heading span")!.textContent = tab.title;
    this.panel.setAttribute("aria-label", `${tab.title} 的目录`);
    surface.card.append(this.panel); surface.card.classList.add("document-has-outline");
    this.panel.classList.add("open");this.sync();
    this.position();
    this.list.replaceChildren();
    const cached = this.entries.get(tab.id);
    if (cached) { this.populate(cached); return; }
    this.message("正在读取目录…");
    void invoke<OutlineEntry[]>("get_outline", { tabId: tab.id }).then(entries => {
      if (!this.viewer.tabList.includes(tab)) return;
      this.entries.set(tab.id, entries);
      if (this.owner === tab.id && revision === this.revision) this.populate(entries);
    }).catch(error => {
      if (this.owner !== tab.id || revision !== this.revision) return;
      this.message("无法读取这份 PDF 的目录。再次展开可重试。"); this.report(`目录读取失败：${error}`, true);
    });
  }

  private populate(entries: OutlineEntry[]): void {
    this.list.replaceChildren();
    if (!entries.length) { this.message("这份 PDF 没有书签目录。"); return; }
    for (const entry of entries) {
      const item = document.createElement("button"); item.className = "outline-item";
      item.textContent = entry.title; item.title = `${entry.title} · 第 ${entry.page + 1} 页`; item.dataset.page = String(entry.page);
      item.style.paddingLeft = `${8 + Math.min(12, entry.depth) * 12}px`;
      const id = this.owner;
      item.onclick = () => { if (id === this.viewer.activeTab?.id && id === this.owner) this.navigate(entry.page); };
      this.list.append(item);
    }
    this.sync();
  }
  private message(text: string): void { const p = document.createElement("p"); p.className = "muted"; p.textContent = text; this.list.replaceChildren(p); }

  private close(focus = false): void {
    if (this.owner === null) return;
    const card = this.viewer.desk.surface(this.owner)?.card;
    const button=this.button(this.owner),returnFocus=this.viewer.activeTab?.id===this.owner&&!this.viewer.desk.isStowed(this.owner);
    const wasFocused = this.panel.contains(document.activeElement);
    this.owner = null; this.revision++;
    card?.classList.remove("document-has-outline"); card?.style.removeProperty("--outline-gutter");
    this.panel.classList.remove("open"); delete this.panel.dataset.tab;
    this.viewer.desk.root.append(this.panel);button?.setAttribute("aria-expanded","false");
    if ((focus || wasFocused) && returnFocus) button?.focus({ preventScroll: true });
    this.sync();
  }

  private button(id:number):HTMLButtonElement|null{return this.viewer.desk.surface(id)?.card.querySelector(".document-outline-toggle")??null;}
  private positionAll():void{for(const tab of this.viewer.tabList)this.positionButton(tab.id);this.position();}
  private positionButton(id:number):void{
    const surface=this.viewer.desk.surface(id),button=this.button(id);if(!surface||!button)return;
    const card=surface.card.getBoundingClientRect(),view=this.viewer.desk.root.getBoundingClientRect();
    const visible=card.width>0&&card.right>view.left+20&&card.left<view.right-20&&card.bottom>view.top+20&&card.top<view.bottom-20;
    button.classList.toggle("outline-button-offscreen",!visible);if(!visible)return;
    const scale=this.viewer.desk.mode==="desk"?this.viewer.desk.zoom:1,framed=this.viewer.desk.mode==="desk"&&this.viewer.desk.isFramed(id);
    const image=surface.host.querySelector(".pdf-page")?.getBoundingClientRect(),viewport=surface.container.getBoundingClientRect();
    const left=this.viewer.desk.mode==="focus"?Math.max(viewport.left,image?.left??viewport.left):card.left;
    const top=this.viewer.desk.mode==="focus"?Math.max(viewport.top,image?.top??viewport.top):card.top;
    const x=Math.max(view.left+8,Math.min(left+8,view.right-36)),y=Math.max(view.top+8,Math.min(top+(framed?32*scale+8:8),view.bottom-36));
    Object.assign(button.style,{left:`${(x-card.left)/scale}px`,top:`${(y-card.top)/scale}px`,transform:`scale(${1/scale})`});
  }

  private position(): void {
    if (this.owner === null) return;
    const card = this.viewer.desk.surface(this.owner)?.card; if (!card || !card.offsetWidth) return;
    const view = this.viewer.desk.root.getBoundingClientRect(), file = card.getBoundingClientRect();
    const scale = this.viewer.desk.mode === "desk" ? this.viewer.desk.zoom : 1;
    const width = Math.min(this.preferredWidth, Math.max(150, view.width - 32));
    const height = Math.min(520, Math.max(100, view.height - 24));
    Object.assign(this.panel.style, { width: `${width}px`, maxHeight: `${height}px` });
    // Prefer the file's left edge; near a viewport edge the tray overlaps that edge instead of disappearing.
    const x = Math.max(view.left + 12, Math.min(file.left - width - 12, view.right - width - 12));
    const y = Math.max(view.top + 12, Math.min(file.top, view.bottom - this.panel.offsetHeight - 12));
    const focus = this.viewer.desk.mode === "focus";
    card.style.setProperty("--outline-gutter", `${width + 24}px`);
    Object.assign(this.panel.style, { left: `${(x-file.left)/scale}px`, top: `${(y-file.top)/scale}px`, width: `${width}px`, maxHeight: `${height}px`, transform: `scale(${1/scale})` });
    this.panel.classList.toggle("outline-in-focus", focus);
  }
}
