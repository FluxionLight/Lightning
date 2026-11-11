/** App-level, user-configurable commands. Empty bindings remain available in settings. */
export interface KeyCombo { key: string; ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean }
export interface Shortcut {
  id: string; description: string; combo: KeyCombo | null;
  enabled?: () => boolean; allowInEditable?: boolean; run: () => void;
  /** Hold actions are released by keyup, lost focus or a settings change. */
  release?: () => void;
}
const STORE = "lightning.shortcuts.v1";
const modifier = (key: string) => ["Control", "Alt", "Shift", "Meta"].includes(key);
const valid = (v: unknown): v is KeyCombo => {
  if (!v || typeof v !== "object") return false;
  const c = v as KeyCombo;
  return typeof c.key === "string" && c.key.length > 0 && c.key.length < 40 && !modifier(c.key)
    && c.key !== "Escape" && [c.ctrl,c.alt,c.shift,c.meta].every(v => v === undefined || typeof v === "boolean");
};
const key = (c: KeyCombo) => `${+!!c.ctrl}${+!!c.alt}${+!!c.shift}${+!!c.meta}:${c.key.toLowerCase()}`;
export const formatCombo = (c: KeyCombo | null): string => c ? [...(c.ctrl ? ["Ctrl"] : []), ...(c.alt ? ["Alt"] : []), ...(c.shift ? ["Shift"] : []), ...(c.meta ? ["Meta"] : []), c.key === " " ? "Space" : c.key.length === 1 ? c.key.toUpperCase() : c.key].join(" + ") : "未设置";
export const comboFromEvent = (e: KeyboardEvent): KeyCombo => ({ key: e.key, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey });
export class ShortcutManager {
  private shortcuts = new Map<string, Shortcut>();
  private overrides: Record<string, KeyCombo | null> = {};
  private holds = new Map<string, { code: string; combo: KeyCombo; release: () => void }>();
  constructor() {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(STORE) || "{}");
      if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        for (const [id, value] of Object.entries(stored)) if (value === null || valid(value)) this.overrides[id] = value;
      }
    } catch { /* An unavailable or damaged preference must not prevent reading. */ }
  }
  register(shortcut: Shortcut): void { this.shortcuts.set(shortcut.id, shortcut); }
  list(): readonly Shortcut[] {
    const used = new Set<string>();
    return [...this.shortcuts.values()].map(s => {
      let combo = Object.prototype.hasOwnProperty.call(this.overrides,s.id) ? this.overrides[s.id] : s.combo;
      // A stale preference that conflicts with a newly added command is left unbound.
      if (combo && used.has(key(combo))) combo = null;
      if (combo) used.add(key(combo));
      return { ...s, combo };
    });
  }
  setBinding(id: string, combo: KeyCombo | null): void {
    if (!this.shortcuts.has(id)) throw Error("快捷键操作不存在");
    if (combo && !valid(combo)) throw Error("请选择有效组合，Esc 保留用于取消");
    const conflict = combo && this.list().find(s => s.id !== id && s.combo && key(s.combo) === key(combo));
    if (conflict) throw Error(`与「${conflict.description}」冲突，请先清除它或换一个组合`);
    const next = { ...this.overrides, [id]: combo ? { ...combo } : null };
    this.releaseAll(); this.overrides = next;
    try { localStorage.setItem(STORE, JSON.stringify(next)); }
    catch { throw Error("组合本次已生效，但无法保存本机快捷键偏好"); }
  }
  reset(): void { this.releaseAll(); this.overrides = {}; localStorage.removeItem(STORE); }
  dispatch(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing || event.key === "Process" || document.querySelector("dialog[open]")) return;
    for (const s of this.list()) {
      if (!s.combo || key(s.combo) !== key(comboFromEvent(event))) continue;
      if (isEditable(event.target) && (!s.allowInEditable || (!event.ctrlKey && !event.altKey && !event.metaKey && event.key.length === 1))) continue;
      if (s.enabled && !s.enabled()) continue;
      event.preventDefault();
      if (s.release) {
        if (event.repeat || this.holds.has(s.id)) return;
        this.releaseAll(); this.holds.set(s.id, { code: event.code, combo: s.combo, release: s.release });
      }
      s.run(); return;
    }
  }
  keyup(event: KeyboardEvent): void {
    for (const [id,h] of this.holds) {
      if (event.code === h.code || (h.combo.ctrl && !event.ctrlKey) || (h.combo.alt && !event.altKey) || (h.combo.shift && !event.shiftKey) || (h.combo.meta && !event.metaKey)) {
        this.holds.delete(id); h.release();
      }
    }
  }
  releaseAll(): void { const holds = [...this.holds.values()]; this.holds.clear(); holds.forEach(h => h.release()); }
}
function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (["INPUT","SELECT","TEXTAREA"].includes(el.tagName) || el.isContentEditable);
}
