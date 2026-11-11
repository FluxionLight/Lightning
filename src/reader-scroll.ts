import type {PdfViewer} from "./pdf-viewer";
type Stream={time:number;direction:number;excess:number;turned:boolean};
export function initReaderScroll(viewer:PdfViewer,blocked:()=>boolean,run:(task:()=>Promise<unknown>)=>void):void {
  const streams=new Map<number,Stream>(),lastTurns=new Map<number,number>();
  let nativeSource:{touchpad:boolean;time:number}|null=null;
  window.addEventListener("lightning-scroll-source",event=>{const detail=(event as CustomEvent<{touchpad:boolean;stop:boolean}>).detail;nativeSource={touchpad:detail.touchpad,time:performance.now()};if(detail.stop)streams.clear();});
  viewer.desk.root.addEventListener("wheel",event=>{
    if(!viewer.isOpen||blocked()||event.ctrlKey)return;
    const target=event.target as HTMLElement,viewport=target.closest<HTMLElement>(".pdf-viewport")??(target.closest(".document-outline-toggle")?target.closest(".document-card")?.querySelector<HTMLElement>(".pdf-viewport"):null);
    if(!viewport)return;
    const id=Number(viewport.dataset.tab);if(!Number.isFinite(id))return;
    event.preventDefault();
    const unit=event.deltaMode===1?16:event.deltaMode===2?viewport.clientHeight:1;
    const dx=(event.shiftKey&&!event.deltaX?event.deltaY:event.deltaX)*unit,dy=(event.shiftKey&&!event.deltaX?0:event.deltaY)*unit;
    if(!dx&&!dy)return;
    const now=performance.now(),touchpad=nativeSource&&now-nativeSource.time<500?nativeSource.touchpad:event.deltaMode===0&&(Math.abs(event.deltaY)<40||event.deltaX!==0),direction=Math.sign(dy);
    let stream=streams.get(id);if(!stream||now-stream.time>200||direction&&direction!==stream.direction){stream={time:now,direction,excess:0,turned:false};streams.set(id,stream);}stream.time=now;
    let turn=0,moved=false;
    if(viewer.desk.mode==="desk"&&!viewer.desk.isFramed(id)){const result=viewer.desk.scrollPaper(id,dx,dy);turn=result.turn;moved=result.moved;}
    else {
      const oldX=viewport.scrollLeft,oldY=viewport.scrollTop;
      viewport.scrollLeft+=dx;viewport.scrollTop+=dy;moved=Math.abs(oldX-viewport.scrollLeft)>.5||Math.abs(oldY-viewport.scrollTop)>.5;
      if(!moved&&Math.abs(dy)>=Math.abs(dx)&&dy)turn=dy>0?1:-1;
    }
    if(moved){stream.excess=0;if(viewer.activeTab?.id!==id)run(()=>viewer.activate(id));return;}
    if(!turn)return;
    if(touchpad){stream.excess+=dy;if(stream.turned||Math.abs(stream.excess)<55)return;stream.turned=true;}
    if(now-(lastTurns.get(id)??0)<90)return;lastTurns.set(id,now);run(()=>viewer.turnDocument(id,turn));
  },{passive:false});
  window.addEventListener("blur",()=>streams.clear());
}
