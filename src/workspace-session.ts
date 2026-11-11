import type {DeskSnapshot} from "./document-desk";
export type WorkspaceFile={path:string;documentId:string};
export type WorkspaceSnapshot={documents:WorkspaceFile[];activeDocumentId:string|null;desk:DeskSnapshot};
type Preferences={reopenLastGroup:boolean;restoreReadingPosition:boolean};
type RecordData={schemaVersion:1;preferences:Preferences;snapshot:WorkspaceSnapshot|null};
const KEY="lightning.workspace.v1";
const defaults=():RecordData=>({schemaVersion:1,preferences:{reopenLastGroup:false,restoreReadingPosition:true},snapshot:null});
function validSnapshot(value:unknown):value is WorkspaceSnapshot {
  if(!value||typeof value!=="object")return false;const s=value as WorkspaceSnapshot;
  return Array.isArray(s.documents)&&s.documents.length<=200&&s.documents.every(f=>f&&typeof f.path==="string"&&f.path.length>0&&f.path.length<32768&&typeof f.documentId==="string"&&/^[a-f0-9]{64}$/i.test(f.documentId))
    &&(s.activeDocumentId===null||typeof s.activeDocumentId==="string")&&s.desk?.schemaVersion===2&&!!s.desk.layouts&&typeof s.desk.layouts==="object";
}
/** One localStorage replacement commits preferences and the complete desk together. PDF reading data remains in the native per-file store. */
export class WorkspaceSession {
  private record:RecordData=defaults();
  private writable=true;
  private timer:number|undefined;
  private source:(()=>WorkspaceSnapshot|null)|null=null;
  private retained:WorkspaceFile[]=[];
  constructor(private report:(message:string,error?:boolean)=>void){
    try{const raw=localStorage.getItem(KEY);if(raw){const r=JSON.parse(raw) as RecordData;if(r?.schemaVersion!==1||typeof r.preferences?.reopenLastGroup!=="boolean"||typeof r.preferences?.restoreReadingPosition!=="boolean"||(r.snapshot!==null&&!validSnapshot(r.snapshot)))throw Error("格式或版本不受支持");this.record=r;}}
    catch(e){this.writable=false;this.report(`上次工作区记录已保留，本次使用默认启动设置：${e}`,true);}
  }
  get preferences():Preferences{return {...this.record.preferences};}
  get savedSnapshot():WorkspaceSnapshot|null{return this.record.snapshot?structuredClone(this.record.snapshot):null;}
  bind(source:()=>WorkspaceSnapshot|null):void {this.source=source;}
  retainMissing(files:WorkspaceFile[]):void {this.retained=files;}
  schedule():void {window.clearTimeout(this.timer);this.timer=window.setTimeout(()=>{try{this.flush();}catch(e){this.report(`工作区本次无法保存：${e}`,true);}},350);}
  flush():void {
    window.clearTimeout(this.timer);if(!this.writable)return;
    const current=this.source?.();let snapshot=current??this.record.snapshot;
    if(snapshot){snapshot=structuredClone(snapshot);const ids=new Set(snapshot.documents.map(f=>f.documentId));snapshot.documents.push(...this.retained.filter(f=>!ids.has(f.documentId)));}
    const next:RecordData={schemaVersion:1,preferences:this.record.preferences,snapshot};const value=JSON.stringify(next);
    if(value!==localStorage.getItem(KEY))localStorage.setItem(KEY,value);this.record=next;
  }
  openSettings():void {
    if(document.querySelector("dialog[open]"))return;
    const d=document.createElement("dialog");d.className="workspace-settings reader-settings";
    d.innerHTML='<h2>启动与恢复</h2><label class="startup-check"><input name="reopen" type="checkbox">启动时打开上次的文件组</label><label>文件打开后<select name="resume"><option value="resume">恢复上次的页码与阅读位置</option><option value="first">每次从第 1 页开始</option></select></label><p class="muted">桌面位置、纸张大小、收纳状态、阅读框和纸叠设置都会记住。从第 1 页开始时保留摆放与阅读形式。通过文件或命令行直接启动时，优先打开指定文件。</p><p class="settings-error" role="alert"></p><div class="settings-actions"><button class="btn startup-cancel">取消</button><button class="btn primary startup-save">保存</button></div>';
    const reopen=d.querySelector<HTMLInputElement>('[name="reopen"]')!,resume=d.querySelector<HTMLSelectElement>('[name="resume"]')!;
    reopen.checked=this.record.preferences.reopenLastGroup;resume.value=this.record.preferences.restoreReadingPosition?"resume":"first";resume.disabled=!reopen.checked;reopen.onchange=()=>{resume.disabled=!reopen.checked;};
    d.querySelector<HTMLElement>(".startup-cancel")!.onclick=()=>d.close();d.onclose=()=>d.remove();
    d.querySelector<HTMLElement>(".startup-save")!.onclick=()=>{
      const previous=this.record.preferences;
      try{if(!this.writable)throw Error("原工作区记录受保护，暂时不能覆盖");this.record.preferences={reopenLastGroup:reopen.checked,restoreReadingPosition:resume.value==="resume"};this.flush();d.close();this.report("启动与恢复设置已保存");}
      catch(e){this.record.preferences=previous;d.querySelector(".settings-error")!.textContent=`无法保存设置：${e}`;}
    };
    document.body.append(d);d.showModal();
  }
}
