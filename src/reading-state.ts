import { invoke } from "@tauri-apps/api/core";
import { defaultPaperLayout, normalizePaperLayout, normalizeReadingViews } from "./paper-layout";
import type { DocumentIdentity, DocumentReadingState, PdfTab } from "./types";

export function normalizeState(identity: DocumentIdentity, value?: Partial<DocumentReadingState> | null): DocumentReadingState {
  const number = (v: unknown, min: number, max: number, fallback: number) => typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
  return {
    schemaVersion: 1, documentId: identity.documentId, pdfPath: identity.path,
    page: Math.floor(number(value?.page, 0, 1000000, 0)), zoom: number(value?.zoom, .1, 8, 1),
    fitMode: value?.fitMode === "none" || value?.fitMode === "width" ? value.fitMode : "page",
    readingMode: value?.readingMode === "paper" ? "paper" : "standard",
    paperLayout: normalizePaperLayout(value?.paperLayout ?? defaultPaperLayout()),
    paperReadingViews: normalizeReadingViews(value?.paperReadingViews),
    anchor: value?.anchor && Number.isInteger(value.anchor.page) && value.anchor.page >= 0 ? {
      page: value.anchor.page, scrollX: number(value.anchor.scrollX, 0, 1, 0), scrollY: number(value.anchor.scrollY, 0, 1, 0),
    } : null,
  };
}

/** Every document has one ordered writer. Nothing is written beside the PDF. */
export class ReadingStateStore {
  private pending = new Map<string, DocumentReadingState>();
  private timers = new Map<string, number>();
  private writers = new Map<string, Promise<void>>();
  private blocked = new Set<string>();
  private persisted = new Map<string, string>();
  private failures = new Set<string>();
  private desired = new Map<string, string>();
  constructor(private report: (message: string, error?: boolean) => void) {}

  async load(identity: DocumentIdentity): Promise<DocumentReadingState> {
    let result: { state: DocumentReadingState | null; warning: string | null; writable: boolean };
    try { result = await invoke("load_reading_state", { ...identity }); }
    catch (error) { result = { state:null, writable:false, warning:`无法读取阅读状态，本次以默认值阅读且暂停写入：${error}` }; }
    if (!result.writable) this.blocked.add(identity.documentId);
    if (result.warning) this.report(result.warning, true);
    const state = normalizeState(identity, result.state);
    if (result.state) this.persisted.set(state.documentId, JSON.stringify(state));
    return state;
  }
  schedule(tab: PdfTab): void {
    Object.assign(tab.state, { page: tab.page, zoom: tab.zoom, fitMode: tab.fitMode });
    const snapshot = structuredClone(tab.state), id = snapshot.documentId;
    const serialized = JSON.stringify(snapshot); this.desired.set(id, serialized);
    if (this.blocked.has(id)) return;
    if (this.persisted.get(id) === serialized && !this.writers.has(id)) {
      this.pending.delete(id); window.clearTimeout(this.timers.get(id)); this.timers.delete(id); return;
    }
    if (JSON.stringify(this.pending.get(id)) === serialized) return;
    this.pending.set(id, snapshot);
    window.clearTimeout(this.timers.get(id));
    this.timers.set(id, window.setTimeout(() => { void this.flush(id).catch(() => {}); }, 350));
  }
  async flush(id?: string): Promise<void> {
    const ids = id ? [id] : [...new Set([...this.pending.keys(), ...this.writers.keys()])];
    await Promise.all(ids.map(async key => {
      window.clearTimeout(this.timers.get(key)); this.timers.delete(key);
      const state = this.pending.get(key); this.pending.delete(key);
      const previous = this.writers.get(key) ?? Promise.resolve();
      const writer = previous.catch(() => {}).then(async () => {
        if (!state) return;
        try {
          await invoke("save_reading_state", { state });
          this.persisted.set(key, JSON.stringify(state)); this.failures.delete(key);
        } catch (error) {
          if (!this.pending.has(key) && this.desired.get(key) === JSON.stringify(state)) this.pending.set(key, state);
          this.failures.add(key); this.report(`阅读进度尚未保存：${error}`, true); throw error;
        }
      });
      this.writers.set(key, writer);
      try { await writer; } finally { if (this.writers.get(key) === writer) this.writers.delete(key); }
    }));
    if (ids.some(key => this.failures.has(key))) throw Error("有阅读进度未能保存，请重试");
  }
  get hasBlockedState(): boolean { return this.blocked.size > 0; }
  isBlocked(id: string): boolean { return this.blocked.has(id); }
}
