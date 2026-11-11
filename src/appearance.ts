import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {syncThemedSelects} from "./themed-select";
export interface Appearance {schemaVersion:number;mode:"light"|"dark"|"system";accent:string;backgroundImage:string|null;backgroundName:string;imageOpacity:number}
export const DEFAULT_APPEARANCE:Appearance={schemaVersion:1,mode:"light",accent:"#1a73e8",backgroundImage:null,backgroundName:"",imageOpacity:.45};
export function normalizeAppearance(value:Partial<Appearance>|null):Appearance {
  return {schemaVersion:1,mode:value?.mode==="dark"||value?.mode==="system"?value.mode:"light",accent:typeof value?.accent==="string"&&/^#[0-9a-f]{6}$/i.test(value.accent)?value.accent:DEFAULT_APPEARANCE.accent,
    backgroundImage:typeof value?.backgroundImage==="string"&&value.backgroundImage.startsWith("data:image/jpeg;base64,")?value.backgroundImage:null,backgroundName:typeof value?.backgroundName==="string"?value.backgroundName:"",
    imageOpacity:typeof value?.imageOpacity==="number"&&Number.isFinite(value.imageOpacity)?Math.max(0,Math.min(1,value.imageOpacity)):.45};
}
const rgb=(hex:string)=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
const mix=(a:string,b:string,t:number)=>`#${rgb(a).map((n,i)=>Math.round(n*(1-t)+rgb(b)[i]*t).toString(16).padStart(2,"0")).join("")}`;
export class AppearanceManager {
  private current:Appearance={...DEFAULT_APPEARANCE};
  private writable=true;
  private writer:Promise<unknown>=Promise.resolve();
  private ready:Promise<void>;
  private media=matchMedia("(prefers-color-scheme: dark)");
  constructor(private report:(text:string,error?:boolean)=>void){
    this.apply(this.current);this.media.addEventListener("change",()=>this.apply(this.current));
    this.ready=this.load();
  }
  private async load():Promise<void>{try{const result=await invoke<{preferences:Appearance;warning:string|null;writable:boolean}>("load_appearance");this.current=normalizeAppearance(result.preferences);this.writable=result.writable;this.apply(this.current);if(result.warning)this.report(result.warning,true);}catch(e){this.report(`外观偏好暂时无法读取：${e}`,true);}}
  private apply(p:Appearance):void{
    const dark=p.mode==="dark"||(p.mode==="system"&&this.media.matches),root=document.documentElement;
    root.dataset.theme=dark?"dark":"light";root.style.colorScheme=dark?"dark":"light";
    const colors:Record<string,string>={"--accent":p.accent,"--accent-container":mix(p.accent,dark?"#202124":"#ffffff",dark?.76:.89),"--accent-hover":mix(p.accent,dark?"#ffffff":"#000000",.12),"--on-accent":rgb(p.accent).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0)>165?"#142015":"#ffffff",
      "--surface":mix(p.accent,dark?"#202124":"#ffffff",.98),"--surface-alt":mix(p.accent,dark?"#292a2d":"#f1f3f4",.96),"--desk-color":mix(p.accent,dark?"#17191d":"#edf1f7",.96),"--border":mix(p.accent,dark?"#45474d":"#dce1e8",.94)};
    for(const[k,v]of Object.entries(colors))root.style.setProperty(k,v);
    root.style.setProperty("--wallpaper",p.backgroundImage?`url("${p.backgroundImage}")`:"none");root.style.setProperty("--wallpaper-opacity",String(p.imageOpacity));
  }
  async openSettings():Promise<void>{
    await this.ready;if(document.querySelector("dialog[open]"))return;
    const original=structuredClone(this.current);let draft=structuredClone(original),committed=false,loading=false;
    const dialog=document.createElement("dialog");dialog.className="appearance-settings reader-settings";
    dialog.innerHTML=`<div class="appearance-heading"><div><span class="settings-eyebrow">让桌面属于你</span><h2>外观与背景</h2></div><button type="button" class="btn icon appearance-dismiss" aria-label="关闭外观设置">×</button></div><div class="appearance-body"><div class="appearance-options"><label>界面模式<select name="themeMode"><option value="light">浅色 · 明亮纸桌</option><option value="dark">深色 · 夜间阅读</option><option value="system">跟随系统</option></select></label><div class="appearance-label">主题色</div><div class="theme-swatches">${["#1a73e8","#6750a4","#13795b","#be4268","#b86316","#426779"].map(c=>`<button type="button" class="theme-swatch" data-color="${c}" style="--swatch:${c}" aria-label="主题色 ${c}"></button>`).join("")}</div><div class="custom-accent"><input name="accent" type="color" aria-label="自定义主题色"><input name="accentHex" type="text" maxlength="7" pattern="#[0-9A-Fa-f]{6}" aria-label="主题色十六进制值"></div><div class="appearance-label">桌面背景</div><div class="wallpaper-buttons"><button type="button" class="btn appearance-image">选择本地图片</button><button type="button" class="btn appearance-remove">移除图片</button></div><p class="background-name muted"></p><label class="opacity-label">图片不透明度 <output></output><input name="opacity" type="range" min="0" max="100" step="1"></label><p class="muted">0% 完全透明，100% 完全显示。背景只影响桌面，PDF 纸面保持清晰。</p></div><div class="appearance-preview"><div class="theme-preview-bar"><span></span><i></i><i></i></div><div class="theme-preview-desk"><div class="theme-preview-paper"><span></span><b></b><i></i><i></i><i></i><i></i></div><div class="theme-preview-paper second"><span></span><b></b><i></i><i></i><i></i></div></div><p>实时预览</p></div></div><p class="settings-error" role="alert"></p><div class="settings-actions"><button type="button" class="btn appearance-reset">恢复默认</button><span></span><button type="button" class="btn appearance-cancel">取消</button><button type="button" class="btn primary appearance-save">保存外观</button></div>`;
    const input=<T extends HTMLInputElement|HTMLSelectElement=HTMLInputElement>(name:string)=>dialog.querySelector<T>(`[name="${name}"]`)!;
    const error=dialog.querySelector<HTMLElement>(".settings-error")!;
    const render=()=>{
      input("themeMode").value=draft.mode;input("accent").value=draft.accent;input("accentHex").value=draft.accent.toUpperCase();input("opacity").value=String(Math.round(draft.imageOpacity*100));dialog.querySelector("output")!.textContent=`${Math.round(draft.imageOpacity*100)}%`;
      dialog.querySelector(".background-name")!.textContent=draft.backgroundImage?draft.backgroundName||"自定义背景":"未设置图片 · 使用纯色桌面";
      dialog.querySelector<HTMLButtonElement>(".appearance-remove")!.disabled=!draft.backgroundImage;
      dialog.querySelectorAll<HTMLElement>(".theme-swatch").forEach(el=>el.setAttribute("aria-pressed",String(el.dataset.color===draft.accent)));
      this.apply(draft);
      syncThemedSelects(dialog);
    };
    input("themeMode").onchange=()=>{draft.mode=input("themeMode").value as Appearance["mode"];render();};
    input("accent").oninput=()=>{draft.accent=input("accent").value;render();};
    input("accentHex").oninput=()=>{const value=input("accentHex").value;if(/^#[\da-f]{6}$/i.test(value)){draft.accent=value.toLowerCase();error.textContent="";render();}else error.textContent="请填写 # 加六位十六进制颜色，例如 #1A73E8";};
    input("opacity").oninput=()=>{draft.imageOpacity=Number(input("opacity").value)/100;render();};
    dialog.querySelectorAll<HTMLElement>(".theme-swatch").forEach(el=>el.onclick=()=>{draft.accent=el.dataset.color!;error.textContent="";render();});
    dialog.querySelector<HTMLElement>(".appearance-image")!.onclick=()=>{void(async()=>{
      if(loading)return;loading=true;try{const path=await open({multiple:false,filters:[{name:"背景图片",extensions:["jpg","jpeg","png","webp"]}]});if(typeof path!=="string")return;const image=await invoke<string>("import_background",{path});if(!dialog.isConnected)return;draft.backgroundImage=image;draft.backgroundName=path.split(/[\\/]/).pop()||"背景图片";error.textContent="";render();}catch(e){error.textContent=`无法设置背景：${e}`;}finally{loading=false;}
    })();};
    dialog.querySelector<HTMLElement>(".appearance-remove")!.onclick=()=>{draft.backgroundImage=null;draft.backgroundName="";render();};
    dialog.querySelector<HTMLElement>(".appearance-reset")!.onclick=()=>{draft={...DEFAULT_APPEARANCE};error.textContent="";render();};
    for(const name of ["appearance-dismiss","appearance-cancel"])dialog.querySelector<HTMLElement>(`.${name}`)!.onclick=()=>{if(!committed)this.apply(original);dialog.close();};
    dialog.oncancel=()=>{if(!committed)this.apply(original);};
    dialog.querySelector<HTMLButtonElement>(".appearance-save")!.onclick=()=>{void(async()=>{
      if(loading){error.textContent="请等待背景图片处理完成";return;}if(!/^#[\da-f]{6}$/i.test(input("accentHex").value)){error.textContent="主题色格式无效";return;}
      const button=dialog.querySelector<HTMLButtonElement>(".appearance-save")!;button.disabled=true;
      this.current=structuredClone(draft);committed=true;this.apply(this.current);
      const snapshot=structuredClone(this.current);
      try{if(!this.writable)throw Error("原配置受保护，本次不覆盖");const writing=this.writer.catch(()=>{}).then(()=>invoke("save_appearance",{preferences:snapshot}));this.writer=writing;await writing;this.report("外观与背景已保存在本机");}catch(e){this.report(`外观本次已生效，但未能保存：${e}`,true);}dialog.close();
    })();};
    dialog.onclose=()=>{if(!committed)this.apply(original);dialog.remove();};document.body.append(dialog);render();dialog.showModal();
  }
}
