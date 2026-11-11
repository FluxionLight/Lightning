/** Temporary, page-bound ink. No pixels or paths enter the PDF/project/note. */
export type LaserMode = "off" | "laser" | "highlighter";
export interface LaserPreferences {
  laserColor: string;
  highlighterColor: string;
  laserWidth: number;
  highlighterWidth: number;
  holdSeconds: number;
  fadeSeconds: number;
}
const STORE = "lightning.pdf-laser.v1";
const NS = "http://www.w3.org/2000/svg";
export const DEFAULT_LASER: Readonly<LaserPreferences> = Object.freeze({
  laserColor: "#ff375f", highlighterColor: "#ffe04b",
  laserWidth: 3, highlighterWidth: 22, holdSeconds: 1.2, fadeSeconds: 0.8,
});
const bounded = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
export function normalizeLaserPreferences(value: unknown): LaserPreferences {
  const p = value && typeof value === "object" ? value as Partial<LaserPreferences> : {};
  const color = (value: unknown, fallback: string) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  return {
    laserColor: color(p.laserColor, DEFAULT_LASER.laserColor),
    highlighterColor: color(p.highlighterColor, DEFAULT_LASER.highlighterColor),
    laserWidth: bounded(p.laserWidth, 1, 12, DEFAULT_LASER.laserWidth),
    highlighterWidth: bounded(p.highlighterWidth, 6, 60, DEFAULT_LASER.highlighterWidth),
    holdSeconds: bounded(p.holdSeconds, 0, 30, DEFAULT_LASER.holdSeconds),
    fadeSeconds: bounded(p.fadeSeconds, 0.1, 10, DEFAULT_LASER.fadeSeconds),
  };
}
interface Point { x: number; y: number }

export class PdfLaser {
  private preferences: LaserPreferences;
  private selected: LaserMode = "off";
  private image: HTMLImageElement | null = null;
  private svg: SVGSVGElement | null = null;
  private group: SVGGElement | null = null;
  private pointer: number | null = null;
  private path: SVGPathElement | null = null;
  private last: Point | null = null;
  private commands = "";
  private moved = false;
  private frame = 0;
  private timer: number | undefined;
  private fading: Animation | null = null;

  constructor(private viewport: HTMLElement, private readonly changed: () => void) {
    let saved: unknown;
    try { saved = JSON.parse(localStorage.getItem(STORE) || "null"); } catch { /* Safe defaults also work without storage. */ }
    this.preferences = normalizeLaserPreferences(saved);
    window.addEventListener("blur", () => this.finish());
    document.addEventListener("visibilitychange", () => { if (document.hidden) this.clear(); });
  }
  get mode(): LaserMode { return this.selected; }
  setViewport(viewport: HTMLElement): void { this.detach(); this.viewport = viewport; }
  get settings(): LaserPreferences { return { ...this.preferences }; }

  setMode(mode: LaserMode): void {
    if (mode === this.selected) return;
    this.clear(); this.selected = mode; this.syncMode(); this.changed();
  }
  /** Session takes effect even if saving the local preference is unavailable. */
  setPreferences(value: LaserPreferences): boolean {
    this.clear(); this.preferences = normalizeLaserPreferences(value);
    try { localStorage.setItem(STORE, JSON.stringify(this.preferences)); return true; }
    catch { return false; }
  }
  attach(image: HTMLImageElement): void {
    if (this.image === image && this.svg?.isConnected) {this.svg.setAttribute("viewBox",`0 0 ${image.width} ${image.height}`);return;}
    this.detach(); this.image = image;
    const svg = document.createElementNS(NS, "svg");
    svg.classList.add("pdf-laser-layer");
    svg.setAttribute("viewBox", `0 0 ${image.width} ${image.height}`);
    svg.setAttribute("aria-hidden", "true");
    const group = document.createElementNS(NS, "g");
    group.classList.add("pdf-laser-ink"); svg.append(group);
    this.svg = svg; this.group = group; image.parentElement!.append(svg); this.syncMode();
    svg.addEventListener("pointerdown", event => this.begin(event));
    svg.addEventListener("pointermove", event => this.move(event));
    svg.addEventListener("pointerup", event => {
      if (event.pointerId !== this.pointer) return;
      this.append(event); this.finish();
    });
    svg.addEventListener("pointercancel", event => { if (event.pointerId === this.pointer) this.finish(); });
    svg.addEventListener("lostpointercapture", event => { if (event.pointerId === this.pointer) this.finish(); });
    svg.addEventListener("contextmenu", event => { if (this.selected !== "off") event.preventDefault(); });
  }
  detach(): void {
    this.clear(); this.svg?.remove(); this.svg = null; this.group = null; this.image = null;
  }
  clear(): void {
    this.stopFade(); this.release(); this.flush();
    this.group?.replaceChildren(); this.path = null; this.last = null; this.commands = "";
  }
  private syncMode(): void {
    if (this.svg) this.svg.dataset.mode = this.selected;
  }
  private stopFade(): void {
    window.clearTimeout(this.timer); this.timer = undefined;
    if (this.fading) { this.fading.cancel(); this.fading = null; }
  }
  private drawable(): boolean {
    return this.selected !== "off" && !!this.svg?.isConnected && !!this.image?.isConnected
      && !this.image.dataset.moving && this.viewport.getAttribute("aria-busy") === "false"
      && !document.querySelector("dialog[open]") && !!document.querySelector("#ocr-overlay.hidden");
  }
  private point(event: PointerEvent): Point | null {
    const rect = this.svg!.getBoundingClientRect();
    const viewport = this.viewport.getBoundingClientRect();
    const workspace=this.viewport.closest<HTMLElement>('#reading-workspace[data-mode="desk"]')?.getBoundingClientRect();
    const sx=viewport.width/Math.max(1,this.viewport.offsetWidth),sy=viewport.height/Math.max(1,this.viewport.offsetHeight);
    const left = Math.max(rect.left, viewport.left + this.viewport.clientLeft*sx,workspace?.left??-Infinity);
    const top = Math.max(rect.top, viewport.top + this.viewport.clientTop*sy,workspace?.top??-Infinity);
    const right = Math.min(rect.right, viewport.left + (this.viewport.clientLeft + this.viewport.clientWidth)*sx,workspace?.right??Infinity);
    const bottom = Math.min(rect.bottom, viewport.top + (this.viewport.clientTop + this.viewport.clientHeight)*sy,workspace?.bottom??Infinity);
    if (!rect.width || !rect.height || event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) return null;
    return { x: (event.clientX - rect.left) * this.image!.width / rect.width, y: (event.clientY - rect.top) * this.image!.height / rect.height };
  }
  private begin(event: PointerEvent): void {
    if (event.button !== 0 || !event.isPrimary || this.pointer !== null || !this.drawable()) return;
    const point = this.point(event); if (!point) return;
    event.preventDefault(); event.stopPropagation();
    this.viewport.focus({ preventScroll: true });
    this.stopFade(); this.pointer = event.pointerId; this.svg!.setPointerCapture(event.pointerId);
    this.newPath(point);
  }
  private newPath(point: Point): void {
    this.flush();
    const highlighter = this.selected === "highlighter";
    const path = document.createElementNS(NS, "path");
    const color = highlighter ? this.preferences.highlighterColor : this.preferences.laserColor;
    path.setAttribute("fill", "none"); path.setAttribute("stroke", color);
    path.setAttribute("stroke-width", String(highlighter ? this.preferences.highlighterWidth : this.preferences.laserWidth));
    path.setAttribute("stroke-linecap", highlighter ? "square" : "round"); path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("vector-effect", "non-scaling-stroke");
    path.classList.add(highlighter ? "pdf-laser-highlighter" : "pdf-laser-pen");
    if (!highlighter) path.style.filter = `drop-shadow(0 0 2px ${color})`;
    this.path = path; this.last = point;
    this.moved = false; this.commands = `M${this.xy(point)}`;
    path.setAttribute("d", `${this.commands}h0.01`); this.group!.append(path);
  }
  private xy(point: Point): string { return `${point.x.toFixed(2)} ${point.y.toFixed(2)}`; }
  private append(event: PointerEvent): void {
    const point = this.point(event);
    // Outside-page capture must not draw on toolbars or connect across an off-page excursion.
    if (!point) { this.flush(); this.path = null; this.last = null; return; }
    if (!this.last || !this.path) { this.newPath(point); return; }
    if (Math.hypot(point.x - this.last.x, point.y - this.last.y) < 0.5) return;
    const mid = { x: (point.x + this.last.x) / 2, y: (point.y + this.last.y) / 2 };
    this.commands += `Q${this.xy(this.last)} ${this.xy(mid)}`;
    this.last = point; this.moved = true;
    if (!this.frame) this.frame = requestAnimationFrame(() => this.flush());
  }
  private move(event: PointerEvent): void {
    if (event.pointerId !== this.pointer) return;
    // A lost release/focus must not leave permanently held ink.
    if (!(event.buttons & 1)) { this.finish(); return; }
    event.preventDefault();
    const coalesced = event.getCoalescedEvents?.() ?? [];
    for (const sample of coalesced.length ? coalesced : [event]) this.append(sample);
  }
  private flush(): void {
    cancelAnimationFrame(this.frame); this.frame = 0;
    if (this.path && this.last) this.path.setAttribute("d", this.moved ? `${this.commands}L${this.xy(this.last)}` : `${this.commands}h0.01`);
  }
  private release(): void {
    const pointer = this.pointer; this.pointer = null;
    if (pointer !== null && this.svg?.hasPointerCapture(pointer)) this.svg.releasePointerCapture(pointer);
  }
  private finish(): void {
    if (this.pointer === null) return;
    this.flush(); this.release(); this.path = null; this.last = null;
    this.timer = window.setTimeout(() => {
      this.timer = undefined;
      if (!this.group?.childElementCount) return;
      const animation = this.group.animate([{ opacity: 1 }, { opacity: 0 }], { duration: this.preferences.fadeSeconds * 1000, easing: "ease-out", fill: "forwards" });
      this.fading = animation;
      animation.onfinish = () => { if (this.fading === animation) this.clear(); };
    }, this.preferences.holdSeconds * 1000);
  }
}
