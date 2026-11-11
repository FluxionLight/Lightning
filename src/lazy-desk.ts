export type WorldRect={x:number;y:number;width:number;height:number};
type Point={x:number;y:number};
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
/** Only entities extend the desk. Small groups still get one viewport plus a modest pan margin. */
export function limitDeskCamera(camera:Point,scale:number,view:{width:number;height:number},objects:WorldRect[],empty:Point):Point {
  const w=view.width/scale,h=view.height/scale;
  if(w<=0||h<=0)return camera;
  let left=empty.x,right=left+w,top=empty.y,bottom=top+h;
  if(objects.length){left=Math.min(...objects.map(r=>r.x));right=Math.max(...objects.map(r=>r.x+r.width));top=Math.min(...objects.map(r=>r.y));bottom=Math.max(...objects.map(r=>r.y+r.height));}
  const cx=(left+right)/2,cy=(top+bottom)/2,halfW=Math.max(w,right-left)/2,halfH=Math.max(h,bottom-top)/2;
  const margin=clamp(Math.min(view.width,view.height)*.22,140,260)/scale;
  return {x:clamp(camera.x,view.width-(cx+halfW+margin)*scale,-(cx-halfW-margin)*scale),y:clamp(camera.y,view.height-(cy+halfH+margin)*scale,-(cy-halfH-margin)*scale)};
}
