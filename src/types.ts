export interface PdfDocumentInfo {
  tabId: number; path: string; pageCount: number; pageWidth: number; pageHeight: number; baseScale: number;
}
export interface RenderedPage {
  pageIndex: number; widthPx: number; heightPx: number; pageWidthPt: number; pageHeightPt: number; imageBase64: string;
}
export type FitMode = "none" | "width" | "page";
export type ReadingMode = "standard" | "paper";
export interface PaperPileLayout { x: number; y: number; width: number; desk?:{x:number;y:number} }
export interface PaperLayout { before: PaperPileLayout; after: PaperPileLayout }
export interface PaperReadingViews { before: PaperPileLayout | null; after: PaperPileLayout | null }
export interface ReadingAnchor { page: number; scrollX: number; scrollY: number }
export interface DocumentReadingState {
  schemaVersion: number; documentId: string; pdfPath: string;
  page: number; zoom: number; fitMode: FitMode; readingMode: ReadingMode;
  paperLayout: PaperLayout; paperReadingViews: PaperReadingViews; anchor: ReadingAnchor | null;
}
export interface PdfTab {
  id: number; path: string; title: string; info: PdfDocumentInfo;
  page: number; zoom: number; fitMode: FitMode; pageWidthPt: number; pageHeightPt: number;
  state: DocumentReadingState;
}
export interface OutlineEntry { title: string; page: number; depth: number }
export interface DocumentIdentity { path: string; documentId: string }
