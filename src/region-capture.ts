import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { PdfViewer } from "./pdf-viewer";

export interface RegionResult {
  mode: "png" | "ocr"; page: number; sourcePath: string;
  text: string | null; dataUrl: string | null; width: number; height: number;
}
type Source = { tabId: number; page: number; readingMode: string; mode: "png" | "ocr"; path: string };

/** Capture owns selection and typed results; it has no agent or note consumer. */
export class RegionCapture {
  private overlay = document.getElementById("ocr-overlay")!;
  private rect = document.getElementById("capture-rect")!;
  private panel = document.getElementById("capture-panel")!;
  private source: Source | null = null;
  private drag: { x: number; y: number; pointer: number } | null = null;
  private revision = 0;
  private result: RegionResult | null = null;
  constructor(private viewer: PdfViewer, private report: (text: string, error?: boolean) => void) {
    this.overlay.onpointerdown = e => this.begin(e);
    this.overlay.onpointermove = e => this.move(e);
    this.overlay.onpointerup = e => { void this.finish(e); };
    this.overlay.onpointercancel = () => this.cancel();
    document.getElementById("capture-close")!.onclick = () => this.panel.classList.add("hidden");
    document.getElementById("capture-copy")!.onclick = () => { void this.copy().catch(e => this.report(`无法复制：${e}，截图可选择保存 PNG`, true)); };
    document.getElementById("capture-save")!.onclick = () => { void this.save().catch(e => this.report(`保存截图失败：${e}`, true)); };
    window.addEventListener("blur", () => this.cancel());
    window.addEventListener("resize", () => this.cancel());
  }
  get selecting(): boolean { return !this.overlay.classList.contains("hidden"); }
  start(): void {
    if (!this.viewer.isStable || document.querySelector("dialog[open]")) { this.report("页面稳定显示后即可框选"); return; }
    this.cancel(); this.viewer.cancelInteraction();
    this.viewer.stageElement.append(this.overlay);
    const tab = this.viewer.activeTab!;
    this.source = { tabId: tab.id, path: tab.path, page: tab.page, readingMode: tab.state.readingMode, mode: (document.getElementById("capture-mode") as HTMLSelectElement).value === "ocr" ? "ocr" : "png" };
    this.rect.style.display = "none"; this.overlay.classList.remove("hidden");
  }
  cancel(): void {
    this.revision++; this.source = null;
    const drag = this.drag; this.drag = null;
    if (drag && this.overlay.hasPointerCapture(drag.pointer)) this.overlay.releasePointerCapture(drag.pointer);
    this.overlay.classList.add("hidden"); this.rect.style.display = "none";
  }
  checkContext(): void {
    if (!this.source) return;
    const tab = this.viewer.activeTab;
    if (!tab || tab.id !== this.source.tabId || tab.page !== this.source.page || tab.state.readingMode !== this.source.readingMode
      || !this.viewer.isStable) this.cancel();
  }
  private bounds(): DOMRect | null { return this.viewer.pageElement?.getBoundingClientRect() ?? null; }
  private begin(e: PointerEvent): void {
    if (e.button !== 0 || !e.isPrimary || this.drag) return;
    const b = this.bounds(); if (!b || e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) return;
    e.preventDefault(); this.drag = { x: e.clientX, y: e.clientY, pointer: e.pointerId };
    this.overlay.setPointerCapture(e.pointerId); this.move(e);
  }
  private selection(e: PointerEvent) {
    const b = this.bounds(), d = this.drag; if (!b || !d) return null;
    const loose=this.viewer.desk.mode==="desk"&&!this.viewer.desk.isFramed(this.viewer.activeTab!.id);
    const view=(loose?this.viewer.desk.root:this.viewer.viewport).getBoundingClientRect();
    const x = Math.max(b.left,view.left,Math.min(b.right,view.right,e.clientX)), y = Math.max(b.top,view.top,Math.min(b.bottom,view.bottom,e.clientY));
    return { left: Math.min(d.x,x), top: Math.min(d.y,y), width:Math.abs(d.x-x), height:Math.abs(d.y-y), b };
  }
  private move(e: PointerEvent): void {
    if (this.drag?.pointer !== e.pointerId) return;
    const r = this.selection(e); if (!r) return;
    const stage = this.overlay.getBoundingClientRect();
    const scale=this.viewer.desk.zoom;
    Object.assign(this.rect.style, { display:"block",left:`${(r.left-stage.left)/scale}px`,top:`${(r.top-stage.top)/scale}px`,width:`${r.width/scale}px`,height:`${r.height/scale}px` });
  }
  private async finish(e: PointerEvent): Promise<void> {
    if (this.drag?.pointer !== e.pointerId) return;
    const r = this.selection(e), source = this.source;
    if (!r || r.width < 4 || r.height < 4 || !source) { this.cancel(); return; }
    const request = ++this.revision;
    const pointer = this.drag.pointer; this.drag = null;
    if (this.overlay.hasPointerCapture(pointer)) this.overlay.releasePointerCapture(pointer);
    this.overlay.classList.add("hidden");
    this.report(source.mode === "png" ? "正在生成 PDF 截图…" : "正在使用系统 OCR…");
    try {
      const result = await invoke<RegionResult>("capture_region", { region: { tabId:source.tabId,pageIndex:source.page,mode:source.mode,x:(r.left-r.b.left)/r.b.width,y:(r.top-r.b.top)/r.b.height,width:r.width/r.b.width,height:r.height/r.b.height } });
      this.checkContext(); if (request !== this.revision) return;
      this.source = null;
      result.text = result.text?.trim() ?? null;
      this.result = result; this.showResult(result);
      this.report(source.mode === "png" ? "截图已就绪，仅包含原 PDF 内容" : result.text ? "识别完成，可编辑后复制" : "此选区未识别出文字，可改用截图");
    } catch (error) { if (request === this.revision) { this.source = null; this.report(`区域捕获失败：${error}`, true); } }
  }
  private showResult(result: RegionResult): void {
    document.getElementById("capture-source")!.textContent = `${result.sourcePath.split(/[\\/]/).pop()} · 第 ${result.page + 1} 页`;
    document.getElementById("capture-source")!.title = result.sourcePath;
    const content = document.getElementById("capture-content")!; content.replaceChildren();
    if (result.dataUrl) { const img = new Image(); img.src = result.dataUrl; img.alt = "从 PDF 原始页面裁剪的截图"; content.append(img); }
    else { const text = document.createElement("textarea"); text.value = result.text ?? ""; text.setAttribute("aria-label","识别文字，可编辑"); content.append(text); }
    document.getElementById("capture-save")!.classList.toggle("hidden", !result.dataUrl);
    this.panel.classList.remove("hidden");
  }
  private async copy(): Promise<void> {
    if (!this.result) return;
    if (this.result.dataUrl) {
      const bytes = Uint8Array.from(atob(this.result.dataUrl.split(",")[1]), c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "image/png" });
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    } else await navigator.clipboard.writeText(document.querySelector<HTMLTextAreaElement>("#capture-content textarea")?.value ?? "");
    this.report("已复制到剪贴板");
  }
  private async save(): Promise<void> {
    const result = this.result; if (!result?.dataUrl) return;
    const path = await save({ defaultPath:`Lightning-page-${result.page+1}.png`,filters:[{name:"PNG 图片",extensions:["png"]}] });
    if (!path) return;
    await invoke("save_capture", { path, dataUrl:result.dataUrl }); this.report("PNG 截图已保存");
  }
}
