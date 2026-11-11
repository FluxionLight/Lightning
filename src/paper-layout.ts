import type { PaperLayout, PaperPileLayout, PaperReadingViews } from "./types";

export const MIN_PAPER_WIDTH = 48;
export const MAX_PAPER_WIDTH = 960;
export const PAPER_MARGIN_X = 14;
export const PAPER_MARGIN_Y = 20;
export const PAPER_CHROME_HEIGHT = 53;
export type PaperSide = keyof PaperLayout;
const unit = (n: number) => Math.min(1, Math.max(0, n));

/** Zero width keeps the original responsive corner thumbnails. */
export function defaultPaperLayout(): PaperLayout {
  return { before: { x: 0, y: 0, width: 0 }, after: { x: 1, y: 1, width: 0 } };
}
export function normalizePaperLayout(value?: PaperLayout): PaperLayout {
  const defaults = defaultPaperLayout();
  for (const side of ["before", "after"] as const) {
    const item = value?.[side];
    if (!item) continue;
    defaults[side] = {
      x: Number.isFinite(item.x) ? unit(item.x) : defaults[side].x,
      y: Number.isFinite(item.y) ? unit(item.y) : defaults[side].y,
      width: Number.isFinite(item.width) && item.width > 0 ? Math.max(MIN_PAPER_WIDTH, Math.min(MAX_PAPER_WIDTH, item.width)) : 0,
    };
    const desk=item.desk;
    if(desk&&Number.isFinite(desk.x)&&Number.isFinite(desk.y)&&Math.abs(desk.x)<=1e9&&Math.abs(desk.y)<=1e9)defaults[side].desk={x:desk.x,y:desk.y};
  }
  return defaults;
}
export function paperWidth(layout: PaperPileLayout, stageWidth: number): number {
  const wanted = layout.width || Math.max(MIN_PAPER_WIDTH, Math.min(82, stageWidth * 0.1));
  const limit = Math.max(1, Math.min(MAX_PAPER_WIDTH, stageWidth - PAPER_MARGIN_X * 2));
  return Math.min(limit, Math.max(Math.min(MIN_PAPER_WIDTH, limit), wanted));
}
export function normalizeReadingViews(value?: PaperReadingViews): PaperReadingViews {
  const result: PaperReadingViews = { before: null, after: null };
  for (const side of ["before", "after"] as const) {
    if (value?.[side]) result[side] = normalizePaperLayout({ ...defaultPaperLayout(), [side]: value[side] })[side];
  }
  return result;
}
