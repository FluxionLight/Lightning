import { invoke } from "@tauri-apps/api/core";
import type { RenderedPage } from "./types";

export interface PageRequest { tabId: number; pageIndex: number; zoom: number }
type Task = {
  key: string; request: PageRequest; promise: Promise<RenderedPage | null>;
  resolve(value: RenderedPage | null): void; reject(error: unknown): void;
};
const keyFor = (r: PageRequest): string => `${r.tabId}:${r.pageIndex}:${r.zoom.toFixed(3)}`;

/** One native render in flight, latest foreground wins, bounded LRU for PNG strings. */
export class PdfRenderCache {
  private cache = new Map<string, { page: RenderedPage; bytes: number }>();
  private bytes = 0;
  private pending = new Map<string, Task>();
  private foreground: Task | null = null;
  private background: Task[] = [];
  private inFlight: Task | null = null;
  private closed = new Set<number>();

  constructor(
    private render = (r: PageRequest) => invoke<RenderedPage>("render_page", { ...r }),
    private maxBytes = 32 * 1024 * 1024,
    private maxEntries = 12,
  ) {}

  peek(request: PageRequest): RenderedPage | null {
    const key = keyFor(request), entry = this.cache.get(key);
    if (!entry) return null;
    this.cache.delete(key); this.cache.set(key, entry);
    return entry.page;
  }

  request(request: PageRequest, background = false): Promise<RenderedPage | null> {
    if (this.closed.has(request.tabId)) return Promise.resolve(null);
    const cached = this.peek(request);
    if (cached) { if (!background) this.dropForeground(); return Promise.resolve(cached); }
    const key = keyFor(request);
    let task = this.pending.get(key);
    if (!task) {
      let resolve!: Task["resolve"], reject!: Task["reject"];
      const promise = new Promise<RenderedPage | null>((yes, no) => { resolve = yes; reject = no; });
      task = { key, request: { ...request }, promise, resolve, reject };
      this.pending.set(key, task);
    }
    if (task !== this.inFlight) {
      if (!background) {
        this.dropForeground(task);
        this.background = this.background.filter(t => t !== task);
        this.foreground = task;
      } else if (task !== this.foreground && !this.background.includes(task)) this.background.push(task);
    } else if (!background) this.dropForeground();
    queueMicrotask(() => { void this.pump(); });
    return task.promise;
  }

  clearPrefetch(): void {
    for (const task of this.background) { this.pending.delete(task.key); task.resolve(null); }
    this.background = [];
  }

  close(tabId: number): void {
    this.closed.add(tabId);
    for (const [key, entry] of this.cache) if (key.startsWith(`${tabId}:`)) { this.bytes -= entry.bytes; this.cache.delete(key); }
    this.background = this.background.filter(task => {
      if (task.request.tabId !== tabId) return true;
      this.pending.delete(task.key); task.resolve(null); return false;
    });
    if (this.foreground?.request.tabId === tabId) this.dropForeground();
  }

  private dropForeground(keep?: Task): void {
    if (this.foreground && this.foreground !== keep) {
      this.pending.delete(this.foreground.key); this.foreground.resolve(null); this.foreground = null;
    }
  }

  private async pump(): Promise<void> {
    if (this.inFlight) return;
    const task = this.foreground ?? this.background.shift();
    if (!task) return;
    if (task === this.foreground) this.foreground = null;
    this.inFlight = task;
    try {
      const page = await this.render(task.request);
      if (this.closed.has(task.request.tabId)) { task.resolve(null); return; }
      const bytes = page.imageBase64.length * 2;
      if (bytes <= this.maxBytes) {
        while (this.cache.size && (this.bytes + bytes > this.maxBytes || this.cache.size >= this.maxEntries)) {
          const oldest = this.cache.keys().next().value!;
          this.bytes -= this.cache.get(oldest)!.bytes; this.cache.delete(oldest);
        }
        this.cache.set(task.key, { page, bytes }); this.bytes += bytes;
      }
      task.resolve(page);
    } catch (error) { task.reject(error); }
    finally {
      this.pending.delete(task.key); this.inFlight = null;
      queueMicrotask(() => { void this.pump(); });
    }
  }
}
