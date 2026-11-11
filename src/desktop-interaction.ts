const EDITABLE = "input,textarea,select,[contenteditable=true]";
const editable = (target: EventTarget | null) => target instanceof Element && !!target.closest(EDITABLE);

/** Keep browser text/image selection out of the desk, while preserving actual editors. */
export function initDesktopInteraction(): void {
  const clear = () => { const selection = getSelection(); if (selection && !selection.isCollapsed) selection.removeAllRanges(); };
  document.addEventListener("selectstart", event => { if (!editable(event.target)) event.preventDefault(); });
  document.addEventListener("dragstart", event => { if ((event.target as Element).closest("#reading-workspace,.tab-document-flight")) event.preventDefault(); });
  document.addEventListener("pointerdown", event => { if (!editable(event.target)) clear(); }, true);
  document.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a" && !editable(event.target)) { event.preventDefault(); clear(); }
  }, true);
  document.addEventListener("selectionchange", () => {
    const selection = getSelection(); if (!selection || selection.isCollapsed) return;
    const element = (node: Node | null) => node instanceof Element ? node : node?.parentElement ?? null;
    if (editable(element(selection.anchorNode)) && editable(element(selection.focusNode))) return;
    const workspace = document.getElementById("reading-workspace");
    if (workspace && Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i)).some(range => range.intersectsNode(workspace))) clear();
  });
}
