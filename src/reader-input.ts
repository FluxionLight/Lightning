import type {PdfViewer} from "./pdf-viewer";

type Point={x:number;y:number};
type Pinch={id:number|null;scale:number;point:Point};
const unit=(event:WheelEvent,height:number)=>event.deltaMode===1?16:event.deltaMode===2?height:1;
const editable=(el:Element|null)=>!!el?.closest("input,textarea,select,[contenteditable=true],dialog,.app-sidebar,#app-menu,.paper-panel,.document-outline,.capture-panel");

/** The application owns PDF magnification; browser UI zoom must never consume it. */
export function initReaderInput(viewer:PdfViewer,blocked:()=>boolean,run:(task:()=>Promise<unknown>)=>void):void {
  let pinch:Pinch|null=null,suppressWheelUntil=0;
  const hit=(point:Point)=>{
    const el=document.elementFromPoint(point.x,point.y);
    if(editable(el))return null;
    const surface=el?.closest<HTMLElement>(".pdf-viewport")??el?.closest(".document-outline-toggle")?.closest(".document-card")?.querySelector<HTMLElement>(".pdf-viewport");
    const id=Number(surface?.dataset.tab);
    return surface&&Number.isFinite(id)?id:null;
  };
  const zoom=(id:number|null,factor:number,point:Point)=>{
    if(id===null||blocked()||!Number.isFinite(factor)||factor<=0)return;
    run(()=>viewer.zoomDocument(id,Math.max(.25,Math.min(4,factor)),point));
  };
  document.addEventListener("wheel",event=>{
    if(!event.ctrlKey)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(performance.now()<suppressWheelUntil||!event.deltaY)return;
    const point={x:event.clientX,y:event.clientY},pixels=event.deltaY*unit(event,innerHeight);
    zoom(hit(point),Math.exp(-Math.max(-100,Math.min(100,pixels))*Math.log(1.1)/100),point);
  },{capture:true,passive:false});
  // Some WebKit versions also dispatch this legacy event after `wheel`.
  document.addEventListener("mousewheel",event=>{if((event as WheelEvent).ctrlKey){event.preventDefault();event.stopImmediatePropagation();}},{capture:true,passive:false});
  const begin=(point:Point)=>{pinch={id:hit(point),scale:1,point};suppressWheelUntil=performance.now()+200;};
  const update=(scale:number,point:Point)=>{
    if(!pinch)begin(point);
    if(!pinch||!Number.isFinite(scale)||scale<=0)return;
    zoom(pinch.id,scale/pinch.scale,point);pinch.scale=scale;suppressWheelUntil=performance.now()+180;
  };
  const end=()=>{pinch=null;suppressWheelUntil=performance.now()+100;};
  window.addEventListener("lightning-native-pinch",event=>{
    const d=(event as CustomEvent<{phase:number;scale:number;x:number;y:number}>).detail,point={x:d.x,y:d.y};
    if(d.phase===0)begin(point);else if(d.phase===1)update(d.scale,point);else end();
  });
  // Safari/WebKit GestureEvents are cumulative scales, unlike wheel deltas.
  for(const type of ["gesturestart","gesturechange","gestureend"]){
    document.addEventListener(type,event=>{
      event.preventDefault();event.stopImmediatePropagation();
      const e=event as Event&{scale:number;clientX:number;clientY:number},point={x:e.clientX,y:e.clientY};
      if(type==="gesturestart")begin(point);else if(type==="gesturechange")update(e.scale,point);else end();
    },{capture:true,passive:false});
  }
  window.addEventListener("blur",end);
  document.addEventListener("visibilitychange",()=>{if(document.hidden)end();});
  document.addEventListener("keydown",event=>{
    if(!(event.ctrlKey||event.metaKey)||!["+","=","-","0"].includes(event.key)||editable(event.target as Element))return;
    event.preventDefault();event.stopImmediatePropagation();
    if(blocked()||!viewer.activeTab)return;
    run(()=>event.key==="0"?viewer.setZoom(1):event.key==="-"?viewer.zoomOut():viewer.zoomIn());
  },true);
}
