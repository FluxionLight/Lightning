import {getCurrentWindow} from "@tauri-apps/api/window";
import {setIcon,type IconName} from "./icons";
import {isAndroid} from "./platform";

export function initReaderShell(report:(message:string,error?:boolean)=>void):void {
  for(const button of document.querySelectorAll<HTMLElement>("[data-icon]"))setIcon(button,button.dataset.icon as IconName);
  const menu=document.getElementById("app-menu")!,toggle=document.getElementById("menu-toggle")!;
  const closeMenu=()=>{menu.classList.add("hidden");toggle.setAttribute("aria-expanded","false");};
  toggle.onclick=()=>{const open=menu.classList.contains("hidden");menu.classList.toggle("hidden",!open);toggle.setAttribute("aria-expanded",String(open));};
  menu.addEventListener("click",e=>{if((e.target as HTMLElement).closest("button"))closeMenu();});
  menu.addEventListener("change",closeMenu);
  document.addEventListener("pointerdown",e=>{const target=e.target as Node;if(!menu.contains(target)&&!toggle.contains(target))closeMenu();});
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!menu.classList.contains("hidden")){e.preventDefault();e.stopPropagation();closeMenu();toggle.focus();}},true);
  const win=getCurrentWindow(),run=(task:()=>Promise<unknown>)=>{void task().catch(e=>report(`窗口操作失败：${e}`,true));};
  document.getElementById("window-minimize")!.onclick=()=>run(()=>win.minimize());
  document.getElementById("window-maximize")!.onclick=()=>run(()=>win.toggleMaximize());
  document.getElementById("window-close")!.onclick=()=>run(()=>win.close());
  const syncMaximize=async()=>{const maximized=await win.isMaximized();setIcon(document.getElementById("window-maximize")!,maximized?"restore":"maximize",maximized?"还原窗口":"最大化");};
  if(!isAndroid){void syncMaximize().catch(()=>{});void win.onResized(()=>{void syncMaximize().catch(()=>{});}).catch(()=>{});}
  const status=document.getElementById("status")!,toast=status.parentElement!;let timer:number|undefined;
  new MutationObserver(()=>{window.clearTimeout(timer);toast.classList.add("status-visible");if(!status.classList.contains("error"))timer=window.setTimeout(()=>toast.classList.remove("status-visible"),3500);}).observe(status,{childList:true,subtree:true,attributes:true,attributeFilter:["class"]});
}
