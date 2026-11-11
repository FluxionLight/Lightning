import "./style.css";
import "./material.css";
import "./loose-desk.css";
import "./reader-shell.css";
import "./workspace.css";
import "./document-outline.css";
import "./themed-select.css";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { PdfViewer } from "./pdf-viewer";
import { ReadingStateStore } from "./reading-state";
import { ShortcutManager, type KeyCombo } from "./shortcuts";
import { openShortcutSettings } from "./shortcut-settings";
import { openLaserSettings } from "./laser-settings";
import { RegionCapture } from "./region-capture";
import { AppearanceManager } from "./appearance";
import { initReaderShell } from "./reader-shell";
import {setIcon} from "./icons";
import {WorkspaceSession,type WorkspaceFile} from "./workspace-session";
import {DocumentOutline} from "./document-outline";
import {initDesktopInteraction} from "./desktop-interaction";
import {initThemedSelects,syncThemedSelects} from "./themed-select";
import type { DocumentIdentity } from "./types";
import {initReaderInput} from "./reader-input";
import {isAndroid} from "./platform";
import "./mobile.css";
import {initTouchInput} from "./touch-input";
import {initReaderScroll} from "./reader-scroll";

const $ = <T extends HTMLElement = HTMLElement>(id:string) => document.getElementById(id) as T;
function status(text:string,error=false):void { $("status").textContent=text; $("status").classList.toggle("error",error); }
const guard = async (run:()=>Promise<unknown>):Promise<void> => { try { await run(); } catch(e) { status(String(e),true); } };
initReaderShell(status);
initDesktopInteraction();
initThemedSelects();
const workspace=new WorkspaceSession(status);
let restoringWorkspace=true,workspaceTouched=false;
const store = new ReadingStateStore(status);
const viewer = new PdfViewer($("pdf-viewport"), $("pdf-host"), refresh);
const capture = new RegionCapture(viewer,status);
initReaderInput(viewer,()=>capture.selecting||!!document.querySelector("dialog[open]"),task=>{void guard(task);});
initTouchInput(viewer,()=>capture.selecting||!!document.querySelector("dialog[open]"),task=>{void guard(task);});
initReaderScroll(viewer,()=>capture.selecting||!!document.querySelector("dialog[open]"),task=>{void guard(task);});
const outline = new DocumentOutline(viewer,page=>{capture.cancel();void guard(()=>viewer.goToPage(page,"start"));},status);
const shortcuts = new ShortcutManager();
const appearance = new AppearanceManager(status);
const opening = new Map<string,Promise<void>>();
const closing = new Set<number>();
let tabsSignature = "";
let captureReady=false;
workspace.bind(()=>!workspaceTouched&&!viewer.tabList.length?workspace.savedSnapshot:{documents:viewer.tabList.map(t=>({path:t.path,documentId:t.state.documentId})),activeDocumentId:viewer.activeTab?.state.documentId??null,desk:viewer.desk.snapshot()});

function refresh():void {
  if (captureReady) capture.checkContext();
  const tab = viewer.activeTab;
  viewer.desk.sync(viewer.tabList,tab?.id??null);
  viewer.desk.root.dataset.ink=viewer.laser.mode;
  const signature = viewer.desk.mode+"|"+viewer.tabList.map(t=>`${t.id}:${t.id===tab?.id}:${viewer.desk.isStowed(t.id)}`).join("|");
  if (signature!==tabsSignature) { tabsSignature=signature; renderTabs(); }
  const busy = $("pdf-viewport").getAttribute("aria-busy")==="true";
  $("loading").classList.toggle("hidden",!busy);
  $("reader-toolbar").querySelectorAll<HTMLButtonElement|HTMLInputElement|HTMLSelectElement>("button,input,select").forEach(el=>el.disabled=!tab);
  $<HTMLButtonElement>("prev-btn").disabled=!tab || tab.page===0;
  $<HTMLButtonElement>("next-btn").disabled=!tab || tab.page>=tab.info.pageCount-1;
  $<HTMLButtonElement>("anchor-btn").disabled=!viewer.canUseAnchor;
  $<HTMLButtonElement>("capture-btn").disabled=!tab || busy;
  $<HTMLButtonElement>("zoom-in").disabled=!tab || viewer.zoomLevel>=8;
  $<HTMLButtonElement>("zoom-out").disabled=!tab || viewer.zoomLevel<=.1;
  const pageInput=$<HTMLInputElement>("page-input");
  if (document.activeElement!==pageInput) pageInput.value=String((tab?.page??0)+1);
  pageInput.max=String(tab?.info.pageCount??1);
  $("page-count").textContent=String(tab?.info.pageCount??"—");
  $("zoom-indicator").textContent=`${Math.round(viewer.zoomLevel*100)}%`;
  const paperMode=tab?.state.readingMode==="paper";
  $("reading-mode").setAttribute("aria-pressed",String(paperMode));$("reading-mode").setAttribute("aria-label",paperMode?"隐藏纸叠":"显示纸叠");$("reading-mode").title=paperMode?"隐藏纸叠":"显示纸叠";
  $<HTMLButtonElement>("reading-mode").disabled=!tab;
  $<HTMLButtonElement>("document-frame").disabled=!tab||viewer.desk.mode!=="desk";
  $("document-frame").setAttribute("aria-pressed",String(!!tab&&viewer.desk.isFramed(tab.id)));
  $("document-frame").title=tab&&viewer.desk.isFramed(tab.id)?"摊开在桌面":"放入阅读框";
  $("reset-paper").classList.toggle("hidden",tab?.state.readingMode!=="paper");
  setIcon($("anchor-btn"),tab?.state.anchor?"anchorReturn":"anchor",tab?.state.anchor?`返回锚点 · 第 ${tab.state.anchor.page+1} 页`:"设置锚点");
  $("anchor-btn").classList.toggle("active",!!tab?.state.anchor);
  for (const [id,mode] of [["read-tool","off"],["laser-tool","laser"],["highlighter-tool","highlighter"]]) {
    $(id).classList.toggle("active",viewer.laser.mode===mode); $(id).setAttribute("aria-pressed",String(viewer.laser.mode===mode));
  }
  $("fit-width").classList.toggle("active",tab?.fitMode==="width"); $("fit-page").classList.toggle("active",tab?.fitMode==="page");
  $("reading-detail").textContent=tab ? `${viewer.desk.mode==="desk"?`自由桌面 · ${viewer.tabList.length} 份文档`:tab.state.readingMode==="paper"?"纸叠阅读":"单页阅读"} · ${viewer.laser.mode==="off"?"本地 PDF":viewer.laser.mode==="laser"?"激光笔":"激光荧光笔"}` : "本地 PDF · 无需账号";
  document.title=tab ? `${tab.title} — Lightning` : "Lightning · PDF 阅读器";
  outline.sync();
  for (const item of viewer.tabList) store.schedule(item);
  if(!restoringWorkspace&&(workspaceTouched||viewer.tabList.length))workspace.schedule();
}
function renderTabs():void {
  const tabs=$("tabs"); tabs.replaceChildren();
  for (const tab of viewer.tabList) {
    const stowed=viewer.desk.isStowed(tab.id),root=document.createElement("div"); root.className=`tab${tab===viewer.activeTab?" active":""}${stowed?" tab-stowed":""}`;root.dataset.stowed=String(stowed);root.dataset.tab=String(tab.id);
    root.setAttribute("role","tab"); root.setAttribute("aria-selected",String(tab===viewer.activeTab));
    const title=document.createElement("button"); title.className="tab-title"; title.textContent=tab.title; title.title=`${stowed?"展开到原位":viewer.desk.mode==="desk"||viewer.activeTab===tab?"收进标签":"切换到此文件"} · ${tab.path}`;
    title.onclick=()=>{workspaceTouched=true;capture.cancel();void guard(async()=>{if(viewer.desk.mode==="desk"||stowed||viewer.activeTab?.id===tab.id)await viewer.toggleStow(tab.id);else await viewer.activate(tab.id);});};
    const close=document.createElement("button"); close.className="tab-close"; close.textContent="×"; close.setAttribute("aria-label",`关闭 ${tab.title}`);
    close.onclick=()=>{ void closeTab(tab.id); }; root.append(title,close); tabs.append(root);
  }
  if (!viewer.tabList.length) { const label=document.createElement("span"); label.className="tabs-empty"; label.textContent="PDF 阅读器"; tabs.append(label); }
}
async function openPath(path:string,restore=false,fresh=false):Promise<void> {
  if(isAndroid)status("正在导入 PDF…");
  const identity=await invoke<DocumentIdentity>("resolve_document",{path});
  const pending=opening.get(identity.documentId); if(pending) return pending;
  const existing=viewer.tabList.find(t=>t.state.documentId===identity.documentId);
  if(existing) { capture.cancel(); await viewer.activate(existing.id); status("已切换到打开的文档"); return; }
  const task=(async()=>{
    status("正在打开 PDF…");
    const state=await store.load(identity);if(fresh)state.page=0;capture.cancel();
    await viewer.open(identity.path,state,restore,fresh);workspaceTouched=true;
    if(isAndroid&&!restore&&viewer.tabList.length===1&&!localStorage.getItem("lightning.mobile.started")){viewer.desk.setMode("focus");await viewer.fitToWidth();localStorage.setItem("lightning.mobile.started","true");}
    if(!store.hasBlockedState) status("阅读进度会自动保存在本机");
  })();
  opening.set(identity.documentId,task);
  try { await task; } finally { opening.delete(identity.documentId); }
}
async function chooseFiles():Promise<void> {
  const paths=isAndroid?await invoke<string[]>("choose_mobile_files"):await open({multiple:true,filters:[{name:"PDF 文档",extensions:["pdf"]}]});
  if(!paths) return;
  for(const path of Array.isArray(paths)?paths:[paths]) await guard(()=>openPath(path));
}
async function closeTab(id:number):Promise<void> {
  if(closing.has(id)) return; closing.add(id);
  workspaceTouched=true;
  try {
    const tab=viewer.tabList.find(t=>t.id===id); if(!tab) return;
    store.schedule(tab); await store.flush(tab.state.documentId); capture.cancel(); await viewer.close(id);
    status(store.isBlocked(tab.state.documentId)?"文档已关闭；原状态受保护，本次修改未写入":viewer.isOpen?"阅读进度已保存":"文档已关闭，阅读进度已保留",store.isBlocked(tab.state.documentId));
  } catch(e) { status(`未关闭文档：${e}`,true); }
  finally { closing.delete(id); }
}
const action=(id:string,run:()=>Promise<unknown>|void)=>{ $(id).onclick=()=>{ void guard(async()=>{ await run(); }); }; };
document.addEventListener("lightning-close-document",event=>{void closeTab((event as CustomEvent<number>).detail);});
document.addEventListener("lightning-workspace-change",()=>capture.cancel());
document.addEventListener("lightning-desk-saved",()=>{if(!restoringWorkspace&&(workspaceTouched||viewer.tabList.length))workspace.schedule();});
action("startup-settings-btn",()=>{capture.cancel();viewer.cancelInteraction();workspace.openSettings();});
action("document-frame",()=>{const tab=viewer.activeTab;if(tab)viewer.desk.toggleFrame(tab.id);});
action("workspace-desk",()=>{capture.cancel();viewer.desk.setMode("desk");});action("workspace-focus",()=>{capture.cancel();viewer.desk.setMode("focus");});
action("appearance-btn",async()=>{capture.cancel();viewer.cancelInteraction();shortcuts.releaseAll();await appearance.openSettings();});
action("open-btn",chooseFiles); document.querySelector<HTMLElement>(".empty-open")!.onclick=()=>$("open-btn").click();
action("prev-btn",()=>viewer.prev()); action("next-btn",()=>viewer.next());
action("zoom-in",()=>viewer.zoomIn()); action("zoom-out",()=>viewer.zoomOut()); action("zoom-indicator",()=>viewer.setZoom(1));
action("fit-width",()=>viewer.fitToWidth()); action("fit-page",()=>viewer.fitToPage()); action("reset-paper",()=>viewer.resetPaperLayout());
action("anchor-btn",()=>viewer.activeTab?.state.anchor ? viewer.returnToAnchor() : void viewer.setAnchor());
action("read-tool",()=>viewer.laser.setMode("off")); action("laser-tool",()=>viewer.laser.setMode(viewer.laser.mode==="laser"?"off":"laser"));
action("highlighter-tool",()=>viewer.laser.setMode(viewer.laser.mode==="highlighter"?"off":"highlighter")); action("clear-ink",()=>viewer.laser.clear());
action("ink-settings-btn",()=>{ capture.cancel(); viewer.cancelInteraction(); openLaserSettings(viewer.laser,status); });
action("shortcuts-btn",()=>{ capture.cancel(); viewer.cancelInteraction(); openShortcutSettings(shortcuts); });
action("capture-btn",()=>capture.start());
action("reading-mode",()=>{capture.cancel();return viewer.setReadingMode(viewer.activeTab?.state.readingMode==="paper"?"standard":"paper");});
$<HTMLInputElement>("page-input").onchange=e=>{ const input=e.target as HTMLInputElement; void guard(()=>viewer.goToPage(input.valueAsNumber-1,"start")); input.blur(); };
const syncCaptureIcon=()=>setIcon($("capture-mode-icon"),$<HTMLSelectElement>("capture-mode").value==="ocr"?"text":"image",$<HTMLSelectElement>("capture-mode").value==="ocr"?"识别文字":"截图");
$<HTMLSelectElement>("capture-mode").onchange=()=>{ capture.cancel();syncCaptureIcon();try { localStorage.setItem("lightning.capture-mode.v1",$<HTMLSelectElement>("capture-mode").value); } catch { status("捕获方式本次已生效，但无法保存本机偏好",true); } };
try { if(!isAndroid&&localStorage.getItem("lightning.capture-mode.v1")==="ocr") $<HTMLSelectElement>("capture-mode").value="ocr"; } catch { /* Default PNG remains available. */ }
if(isAndroid){const select=$<HTMLSelectElement>("capture-mode");select.querySelector('option[value="ocr"]')?.remove();select.value="png";}
syncCaptureIcon();
syncThemedSelects();

function register(id:string,description:string,combo:KeyCombo|null,run:()=>void|Promise<unknown>,global=false,release?:()=>void):void {
  shortcuts.register({id,description,combo,enabled:()=>global||viewer.isOpen,run:()=>{ void guard(async()=>{ if(!global && capture.selecting) capture.cancel(); await run(); }); },release});
}
register("file.open","打开 PDF",{key:"o",ctrl:true},chooseFiles,true);
register("file.close","关闭当前文档",{key:"w",ctrl:true},()=>viewer.activeTab?closeTab(viewer.activeTab.id):undefined);
register("state.save","保存阅读进度",{key:"s",ctrl:true},async()=>{ await store.flush(); status(store.hasBlockedState?"原状态受保护，本次阅读状态未写入":"阅读进度已保存",store.hasBlockedState); });
register("page.next","下一页",{key:"PageDown"},()=>viewer.next()); register("page.next-arrow","下一页（方向键）",{key:"ArrowRight"},()=>viewer.next());
register("page.previous","上一页",{key:"PageUp"},()=>viewer.prev()); register("page.previous-arrow","上一页（方向键）",{key:"ArrowLeft"},()=>viewer.prev());
register("zoom.in","放大",{key:"="},()=>viewer.zoomIn()); register("zoom.in-plus","放大（加号）",{key:"+",shift:true},()=>viewer.zoomIn());
register("zoom.out","缩小",{key:"-"},()=>viewer.zoomOut()); register("zoom.reset","恢复 100%",{key:"0"},()=>viewer.setZoom(1));
register("fit.page","适合整页",null,()=>viewer.fitToPage()); register("fit.width","适合宽度",null,()=>viewer.fitToWidth());
register("reading.mode","切换阅读形式",null,()=>viewer.setReadingMode(viewer.activeTab?.state.readingMode==="paper"?"standard":"paper"));
register("workspace.toggle","切换桌面 / 专注阅读",null,()=>viewer.desk.setMode(viewer.desk.mode==="desk"?"focus":"desk"),true);
register("workspace.arrange","整理桌面纸张",null,()=>viewer.desk.arrange());
register("anchor.toggle","设置 / 返回锚点",null,()=>viewer.activeTab?.state.anchor?viewer.returnToAnchor():void viewer.setAnchor());
register("paper.reset","重置纸叠布局",null,()=>viewer.resetPaperLayout());
for(const [side,name] of [["before","前页"],["after","后页"]] as const) {
  register(`paper.remember-${side}`,`记忆${name}阅读篇幅`,null,()=>viewer.rememberPaperReading(side));
  register(`paper.read-${side}`,`按住查看${name}阅读篇幅`,null,()=>viewer.beginPaperReading(side),false,()=>viewer.endPaperReading());
}
register("ink.laser","开关激光笔",null,()=>viewer.laser.setMode(viewer.laser.mode==="laser"?"off":"laser"));
register("ink.highlighter","开关激光荧光笔",null,()=>viewer.laser.setMode(viewer.laser.mode==="highlighter"?"off":"highlighter"));
register("ink.clear","清除临时笔迹",null,()=>viewer.laser.clear()); register("capture.region","框选 PDF 区域",{key:"g",ctrl:true},()=>capture.start());
document.addEventListener("keydown",e=>{
  if(e.key==="Escape"&&!document.querySelector("dialog[open]")) {
    if(capture.selecting) { e.preventDefault(); capture.cancel(); return; }
    if(e.defaultPrevented) return;
    viewer.cancelInteraction(); viewer.laser.setMode("off"); shortcuts.releaseAll(); return;
  }
  shortcuts.dispatch(e);
});
document.addEventListener("keyup",e=>shortcuts.keyup(e));
window.addEventListener("blur",()=>shortcuts.releaseAll());
document.addEventListener("visibilitychange",()=>{ if(document.hidden) { shortcuts.releaseAll(); viewer.cancelInteraction(); capture.cancel();if(!restoringWorkspace)try{workspace.flush();}catch(e){status(`工作区保存失败：${e}`,true);}void store.flush().catch(()=>{}); } });

action("help-btn",()=>{
  capture.cancel(); viewer.cancelInteraction(); shortcuts.releaseAll();
  if(document.querySelector("dialog[open]")) return;
  const dialog=document.createElement("dialog"); dialog.innerHTML=`<h2>轻快一点，读深一点。</h2><div class="help-content"><p><b>自由桌面</b> · 多份 PDF 可同时摆放。直接拖动纸面自由摆放、重叠，右下角等比例缩放；点击纸面置顶，旁边的悬浮控件单独翻页。拖动空白处、中键或按空格拖动可平移；空白处普通滚轮缩放桌面，Ctrl+滚轮只缩放鼠标下的 PDF，前后纸叠大小不变，「查看全部」找回纸张。应用菜单中的「专注」单独阅读，返回桌面保留摆放。</p><p><b>收纳与恢复</b> · 桌面中点标签收起文件，再点原位展开，× 才关闭。左侧菜单「启动与恢复」可选重开上次文件组，并选择继续上次位置或从第 1 页开始。</p><p><b>阅读框</b> · 选中文件后点侧栏阅读框图标，切换散纸或框内阅读。框拖标题移动，右下角调整宽高，正文只在框内滚动；翻页贴框内上缘或下缘。</p><p><b>外观</b> · 左侧菜单设置主题色、浅色 / 深色、本地背景图片和图片不透明度。可实时预览，取消还原，保存后重启恢复。</p><p><b>翻页</b> · ← / → 或 PageUp / PageDown。放大后，滚轮先滚动当前页；到达边界再翻页。上一页落在页尾，下一页落在页首。</p><p><b>纸叠对照</b> · 选择「纸叠翻页」，拖动两摞纸上方的把手移动，用右下角调整大小。调到便于阅读的篇幅后点「记」，再缩小。长按纸叠临时展开，松开复原。</p><p><b>锚点</b> · 离开当前阅读点前设置锚点。翻阅之后点击返回，恢复该处位置并消耗这次锚点。</p><p><b>临时画笔</b> · 选择激光笔或荧光笔后按住左键书写。松开后自动渐隐，消失前续写会保留整组。Esc 清除并退出。</p><p><b>区域捕获</b> · Ctrl G 框选，输出截图或系统 OCR 文字。结果可复制，截图可另存 PNG。截图不含画笔与界面。</p><p class="muted">阅读状态自动保存在 Lightning 应用数据目录。不会修改 PDF，不产生永久标注。快捷键与画笔可在左侧菜单中设置。</p></div><div class="settings-actions"><button class="btn primary">开始阅读</button></div>`;
  dialog.querySelector("button")!.onclick=()=>dialog.close(); dialog.onclose=()=>dialog.remove(); document.body.append(dialog); dialog.showModal();
});

async function initNative():Promise<void> {
  await getCurrentWebview().onDragDropEvent(event=>{
    const type=event.payload.type; $("drop-hint").classList.toggle("hidden",type!=="over"&&type!=="enter");
    if(type==="drop") { const paths=event.payload.paths.filter(p=>p.toLowerCase().endsWith(".pdf")); void guard(async()=>{ for(const path of paths) await openPath(path); }); }
  });
  let exiting=false;
  await getCurrentWindow().onCloseRequested(event=>{
    event.preventDefault(); if(exiting) return; exiting=true; capture.cancel(); shortcuts.releaseAll();
    void (async()=>{
      try { for(const tab of viewer.tabList) store.schedule(tab);await store.flush();if(!restoringWorkspace)workspace.flush();await getCurrentWindow().destroy(); }
      catch { exiting=false; showSaveFailure(); }
    })();
  });
  try{
    const paths=await invoke<string[]>("startup_paths"),saved=workspace.savedSnapshot;
    if(paths.length){for(const path of paths)await guard(()=>openPath(path));}
    else if(workspace.preferences.reopenLastGroup&&saved){
      viewer.desk.restoreSnapshot(saved.desk);const failed:WorkspaceFile[]=[];
      for(const file of saved.documents){try{await openPath(file.path,true,!workspace.preferences.restoreReadingPosition);}catch{failed.push(file);}}
      workspace.retainMissing(failed);
      const active=viewer.tabList.find(t=>t.state.documentId===saved.activeDocumentId&&!viewer.desk.isStowed(t.id));if(active)await viewer.activate(active.id);
      viewer.desk.restoreDepths(saved.desk);
      if(failed.length)status(`${failed.length} 份文件无法恢复，记录已保留，请检查文件位置`,true);
    }
  }finally{restoringWorkspace=false;refresh();}
}
function showSaveFailure():void {
  if(document.querySelector("dialog[open]")) return;
  const d=document.createElement("dialog"); d.innerHTML='<h2>阅读进度尚未保存</h2><p class="muted">保存失败，应用仍在运行。可以取消退出后重试保存，或放弃本次未保存的阅读状态并退出。PDF 文件不受影响。</p><div class="settings-actions"><button class="btn cancel">取消退出</button><button class="btn discard">放弃并退出</button></div>';
  d.querySelector<HTMLElement>(".cancel")!.onclick=()=>d.close(); d.querySelector<HTMLElement>(".discard")!.onclick=()=>{ void getCurrentWindow().destroy(); }; d.onclose=()=>d.remove(); document.body.append(d); d.showModal();
}
captureReady=true; refresh();
void initNative().catch(e=>status(`本机接口初始化失败：${e}`,true));
