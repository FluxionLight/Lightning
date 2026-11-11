type Visual = { rect: DOMRect; opacity: number };
type Transition = { id: number; card: HTMLElement; opening: boolean; ghost?: HTMLElement; animation?: Animation; from?: Visual };
const DURATION = 320;
const EASING = "cubic-bezier(.4,0,.2,1)";

/** Animate a disposable, noninteractive picture; the real document retains its exact layout. */
export class TabTransitions {
  private running = new Map<number, Transition>();
  private motion = matchMedia("(prefers-reduced-motion: reduce)");

  constructor(private workspace: HTMLElement) {
    window.addEventListener("resize", () => this.cancelAll());
    window.addEventListener("blur", () => this.cancelAll());
    document.addEventListener("visibilitychange", () => { if (document.hidden) this.cancelAll(); });
    window.addEventListener("keydown", e => { if (e.key === "Escape") this.cancelAll(); });
    this.motion.addEventListener("change", () => this.cancelAll());
  }

  has(id: number): boolean { return this.running.has(id); }
  current(t: Transition | null): t is Transition { return !!t && this.running.get(t.id) === t; }

  begin(id: number, card: HTMLElement, opening: boolean): Transition | null {
    const previous = this.running.get(id);
    // Sample before cancelling, so a second click reverses from the visible position.
    const from = previous?.ghost ? { rect: previous.ghost.getBoundingClientRect(), opacity: Number(getComputedStyle(previous.ghost).opacity) } : undefined;
    const ghost = previous?.ghost;
    if (ghost && from) {
      const transform=getComputedStyle(ghost).transform;
      previous?.animation?.cancel();
      Object.assign(ghost.style, { transform, opacity: String(from.opacity) });
    }
    this.running.delete(id);
    if (this.motion.matches) { ghost?.remove(); card.classList.remove("document-transitioning"); this.update(); return null; }
    const t: Transition = { id, card, opening, ghost, from };
    if (!opening) { t.ghost = this.snapshot(card, id); ghost?.remove(); }
    this.running.set(id, t);
    card.classList.toggle("document-transitioning", opening);
    while (this.running.size > 4) this.cancel(this.running.keys().next().value!);
    this.update();
    return t;
  }

  play(t: Transition | null): void {
    if (!this.current(t)) return;
    const tab = document.querySelector<HTMLElement>(`.tab[data-tab="${t.id}"]`);
    if (!tab || !t.card.isConnected || this.motion.matches || t.opening&&!t.card.querySelector(".pdf-page")) { this.finish(t); return; }
    const fresh = t.opening ? this.snapshot(t.card, t.id) : undefined;
    if (fresh) { t.ghost?.remove(); t.ghost = fresh; }
    const ghost = t.ghost;
    if (!ghost) { this.finish(t); return; }
    const full = ghost.getBoundingClientRect(), target = tab.getBoundingClientRect();
    const tinyScale = Math.min(target.width * .7 / full.width, target.height * .7 / full.height, .15);
    const tiny = new DOMRect(target.left + (target.width - full.width * tinyScale) / 2, target.top + (target.height - full.height * tinyScale) / 2, full.width * tinyScale, full.height * tinyScale);
    // Map the current visible rectangle onto the fresh snapshot when reversing.
    const from = t.from ?? { rect: t.opening ? tiny : full, opacity: t.opening ? .12 : 1 };
    const to = t.opening ? { rect: full, opacity: 1 } : { rect: tiny, opacity: 0 };
    const key = (v: Visual) => ({ transform: `translate(${v.rect.left-full.left}px,${v.rect.top-full.top}px) scale(${v.rect.width/full.width},${v.rect.height/full.height})`, opacity: v.opacity });
    ghost.dataset.direction = t.opening ? "expand" : "stow";
    t.animation = ghost.animate([key(from), key(to)], { duration: DURATION, easing: EASING, fill: "both" });
    void t.animation.finished.then(() => this.finish(t), () => {});
  }

  cancel(id: number): void { const t = this.running.get(id); if (t) this.finish(t); }
  cancelAll(): void { for (const t of [...this.running.values()]) this.finish(t); }

  private finish(t: Transition): void {
    if (!this.current(t)) return;
    this.running.delete(t.id); t.animation?.cancel(); t.ghost?.remove();
    t.card.classList.remove("document-transitioning"); this.update();
  }
  private update(): void { this.workspace.classList.toggle("has-tab-transitions", this.running.size > 0); }

  private snapshot(card: HTMLElement, id: number): HTMLElement | undefined {
    const rect = card.getBoundingClientRect(), view = this.workspace.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const panels = [...card.querySelectorAll<HTMLElement>(".paper-panel")].filter(e => getComputedStyle(e).display !== "none").map(e => e.getBoundingClientRect());
    const left = Math.max(view.left, Math.min(rect.left, ...panels.map(b => b.left)) - 12);
    const top = Math.max(view.top, Math.min(rect.top, ...panels.map(b => b.top)) - 12);
    const right = Math.min(view.right, Math.max(rect.right, ...panels.map(b => b.right)) + 12);
    const bottom = Math.min(view.bottom, Math.max(rect.bottom, ...panels.map(b => b.bottom)) + 12);
    if (right <= left || bottom <= top) return;
    const ghost = document.createElement("div"); ghost.className = "tab-document-flight"; ghost.dataset.document = String(id);
    ghost.setAttribute("aria-hidden", "true"); ghost.inert = true;
    Object.assign(ghost.style, { left: `${left}px`, top: `${top}px`, width: `${right-left}px`, height: `${bottom-top}px` });
    const scrolls: { el: Element; x: number; y: number }[] = [];
    const copy = (source: Element): Element | null => {
      if (source.matches(".document-outline,.document-outline-toggle,.document-footer,.document-resize,.pdf-laser-layer,.ocr-overlay,.paper-flight,#loading")) return null;
      const el = source.cloneNode(false) as HTMLElement | SVGElement;
      for (const attr of [...el.attributes]) if (/^(id|class|tabindex|name|role)$|^(data-|aria-)/.test(attr.name)) el.removeAttribute(attr.name);
      const style = getComputedStyle(source);
      for (const property of style) el.style.setProperty(property, style.getPropertyValue(property));
      Object.assign(el.style, { animation: "none", transition: "none", pointerEvents: "none" });
      scrolls.push({ el, x: source.scrollLeft, y: source.scrollTop });
      for (const node of source.childNodes) {
        const child = node instanceof Element ? copy(node) : node.cloneNode();
        if (child) el.appendChild(child);
      }
      return el;
    };
    const picture = copy(card) as HTMLElement;
    Object.assign(picture.style, { position: "absolute", left: `${rect.left-left}px`, top: `${rect.top-top}px`, margin: "0", width: `${card.offsetWidth}px`, height: `${card.offsetHeight}px`, transform: `scale(${rect.width/card.offsetWidth},${rect.height/card.offsetHeight})`, transformOrigin: "0 0", opacity: "1", visibility: "visible" });
    ghost.append(picture); document.body.append(ghost);
    for (const s of scrolls) { s.el.scrollLeft = s.x; s.el.scrollTop = s.y; }
    return ghost;
  }
}
