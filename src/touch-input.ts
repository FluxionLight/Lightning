import type {PdfViewer} from "./pdf-viewer";
type Point={x:number;y:number};
type Touch={id:number;viewport:HTMLElement;last:Point;start:Point;excess:number;horizontal:number;pinched:boolean;distance:number;inking:boolean;};
export function initTouchInput(viewer:PdfViewer,blocked:()=>boolean,run:(task:()=>Promise<unknown>)=>void):void {
  const points=new Map<number,Point>();let touch:Touch|null=null;
  const clear=()=>{points.clear();touch=null;};
  document.addEventListener("pointerdown",event=>{
    if(event.pointerType!=="touch"||blocked())return;
    const el=event.target as HTMLElement;
    if(el.closest("button,input,.paper-panel,.document-outline,.ocr-overlay"))return;
    const viewport=touch?.viewport??el.closest<HTMLElement>(".pdf-viewport");if(!viewport)return;
    const id=touch?.id??Number(viewport.dataset.tab);if(!Number.isFinite(id))return;
    if(points.size>=2)return;
    const point={x:event.clientX,y:event.clientY};points.set(event.pointerId,point);
    if(!touch){touch={id,viewport,last:point,start:point,excess:0,horizontal:0,pinched:false,distance:0,inking:viewer.laser.mode!=="off"};if(viewer.activeTab?.id!==id)run(()=>viewer.activate(id));}
    if(points.size>=2){touch.pinched=true;const [a,b]=[...points.values()];touch.distance=Math.hypot(a.x-b.x,a.y-b.y);viewer.cancelInteraction();}
    if(touch.inking&&!touch.pinched)return;
    event.preventDefault();event.stopImmediatePropagation();viewport.setPointerCapture(event.pointerId);
  },true);
  document.addEventListener("pointermove",event=>{
    if(!touch||!points.has(event.pointerId))return;
    if(touch.inking&&!touch.pinched){points.set(event.pointerId,{x:event.clientX,y:event.clientY});return;}
    event.preventDefault();event.stopImmediatePropagation();
    if(blocked()){clear();return;}
    const point={x:event.clientX,y:event.clientY};points.set(event.pointerId,point);
    if(points.size>=2){
      const [a,b]=[...points.values()],distance=Math.hypot(a.x-b.x,a.y-b.y),center={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
      if(touch.distance>10&&distance>10){const id=touch.id,factor=distance/touch.distance;run(()=>viewer.zoomDocument(id,factor,center));}
      touch.distance=distance;touch.last=point;return;
    }
    if(touch.pinched){touch.last=point;return;}
    const dx=touch.last.x-point.x,dy=touch.last.y-point.y;touch.last=point;
    const loose=viewer.desk.mode==="desk"&&!viewer.desk.isFramed(touch.id),v=touch.viewport;
    if(loose){const result=viewer.desk.scrollPaper(touch.id,dx,dy);if(result.turn)touch.excess+=dy;else if(result.moved)touch.excess=0;}
    else{const before=v.scrollTop;v.scrollLeft+=dx;v.scrollTop+=dy;if(Math.abs(v.scrollTop-before)<.5)touch.excess+=dy;else touch.excess=0;}
    if(v.scrollWidth<=v.clientWidth+2)touch.horizontal=touch.start.x-point.x;
  },{capture:true,passive:false});
  document.addEventListener("pointerup",event=>{
    if(!touch||!points.has(event.pointerId))return;
    if(touch.inking&&!touch.pinched){clear();return;}
    event.preventDefault();event.stopImmediatePropagation();points.delete(event.pointerId);
    const finished=touch;
    if(!points.size){clear();if(!finished.pinched){const delta=Math.abs(finished.excess)>65?Math.sign(finished.excess):Math.abs(finished.horizontal)>90&&Math.abs(finished.horizontal)>Math.abs(finished.last.y-finished.start.y)*1.4?Math.sign(finished.horizontal):0;if(delta)run(()=>viewer.turnDocument(finished.id,delta));}}
    else if(points.size===1)touch.last=[...points.values()][0];
  },true);
  document.addEventListener("pointercancel",event=>{if(points.has(event.pointerId))clear();},true);
  window.addEventListener("blur",clear);window.addEventListener("resize",clear);document.addEventListener("visibilitychange",()=>{if(document.hidden)clear();});
}
