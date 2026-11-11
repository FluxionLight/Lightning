// Only Lightning IPC. Synthetic document pixels and isolated localStorage state.
export function installTauriMock() {
  const clone=v=>JSON.parse(JSON.stringify(v));
  const callbacks=new Map(),events=new Map(),docs=new Map();let nextCallback=0,nextTab=0;
  const states=JSON.parse(localStorage.getItem("test-reading")||"{}");
  Object.defineProperty(navigator,"clipboard",{configurable:true,value:{
    async write(items){window.testClipboard={types:items[0].types,pngSize:(await items[0].getType("image/png")).size};},
    async writeText(text){window.testClipboard={text};}
  }});
  window.testMock={nextPath:"C:/fixture/a.pdf",renderDelay:0,captureDelay:0,failRenderPages:[],failSave:false,corrupt:false,renders:[],saves:[],captures:[],closes:[],opens:[],windowActions:[],maximized:false,minimized:false,modeSizes:{8:[720,420],5:[420,980]},
    emit(event,payload){callbacks.get(events.get(event))?.({event,id:1,payload});}};
  const identity=path=>{const normalized=path.replaceAll("\\","/").toLowerCase();return{path:normalized,documentId:(normalized.match(/\/([a-f])\.pdf$/)?.[1]??"a").repeat(64)};};
  window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};
  window.__TAURI_INTERNALS__={
    metadata:{currentWindow:{label:"main"},currentWebview:{label:"main"}},
    transformCallback(fn){const id=++nextCallback;callbacks.set(id,fn);return id;},
    unregisterCallback(id){callbacks.delete(id);},
    async invoke(command,args={}) {
      const mock=window.testMock;
      if(command==="plugin:window|is_maximized")return mock.maximized;
      if(command==="plugin:window|is_minimized")return mock.minimized;
      if(command==="plugin:window|toggle_maximize"){mock.windowActions.push("maximize");mock.maximized=!mock.maximized;mock.emit("tauri://resize",{width:1320,height:860});return;}
      if(command==="plugin:window|minimize"){mock.windowActions.push("minimize");mock.minimized=true;return;}
      if(command==="plugin:window|close"){mock.windowActions.push("close");mock.emit("tauri://close-requested",null);return;}
      if(command==="plugin:event|listen"){events.set(args.event,args.handler);return ++nextCallback;}
      if(command==="plugin:event|unlisten")return;
      if(command==="plugin:dialog|open")return mock.nextPath;
      if(command==="choose_mobile_files")return [mock.nextPath];
      if(command==="plugin:dialog|save")return null;
      if(command==="startup_paths")return JSON.parse(localStorage.getItem("test-startup-paths")||"[]");
      if(command==="load_appearance")return {preferences:JSON.parse(localStorage.getItem("test-appearance")||"null"),warning:null,writable:true};
      if(command==="save_appearance"){if(mock.failSave)throw Error("Synthetic appearance save failure");localStorage.setItem("test-appearance",JSON.stringify(args.preferences));return;}
      if(command==="import_background") {const c=document.createElement("canvas");c.width=800;c.height=500;const g=c.getContext("2d");g.fillStyle="#547995";g.fillRect(0,0,800,500);g.fillStyle="#d5b993";g.fillRect(200,50,350,400);return c.toDataURL("image/jpeg");}
      if(command==="resolve_document") {if(args.path.includes("missing"))throw Error("文件不存在");return identity(args.path);}
      if(command==="load_reading_state")return {state:mock.corrupt?null:clone(states[args.documentId]??null),writable:!mock.corrupt,warning:mock.corrupt?"原阅读状态已保留，本次使用默认值且暂停写入。":null};
      if(command==="save_reading_state") {
        if(mock.failSave)throw Error("Synthetic disk failure");
        mock.saves.push(clone(args.state));states[args.state.documentId]=clone(args.state);localStorage.setItem("test-reading",JSON.stringify(states));return;
      }
      if(command==="open_pdf") {
        mock.opens.push(args.path);const tabId=++nextTab;docs.set(tabId,args.path);
        return{tabId,path:args.path,pageCount:10,pageWidth:420,pageHeight:594,baseScale:2};
      }
      if(command==="close_pdf"){docs.delete(args.tabId);mock.closes.push(args.tabId);return;}
      if(command==="get_outline"){
        (mock.outlineRequests??=[]).push(args.tabId);
        if(mock.outlineDelay)await new Promise(r=>setTimeout(r,mock.outlineDelay));
        if(mock.failOutline)throw Error("Synthetic outline failure");
        return clone(mock.outlines?.[args.tabId]??[{title:"开始阅读",page:0,depth:0},{title:"继续思考",page:3,depth:1},{title:"横向对照",page:8,depth:0}]);
      }
      if(command==="render_page") {
        mock.renders.push(clone(args));if(mock.renderDelay)await new Promise(r=>setTimeout(r,mock.renderDelay));
        if(!docs.has(args.tabId))throw Error("PDF 已关闭");
        if(mock.failRenderPages.includes(args.pageIndex))throw Error("Synthetic render failure");
        const [w,h]=mock.modeSizes[args.pageIndex]||[420,594],z=args.zoom*2;
        const c=document.createElement("canvas");c.width=Math.round(w*z);c.height=Math.round(h*z);
        const ctx=c.getContext("2d");ctx.scale(z,z);ctx.fillStyle="#fcfbf6";ctx.fillRect(0,0,w,h);
        ctx.fillStyle="#657853";ctx.font="9px sans-serif";ctx.fillText("LIGHTNING / READING NOTES",34,35);
        ctx.fillStyle="#263d2c";ctx.font="24px Georgia";ctx.fillText("A little room to think.",34,84);
        ctx.fillStyle="#5d6d52";ctx.font="11px sans-serif";ctx.fillText(`Chapter ${args.pageIndex+1} - Reading with a little less friction`,34,116);
        ctx.fillStyle="#3b4735";ctx.font="10px Georgia";
        for(let line=0;line<Math.floor((h-190)/19);line++)ctx.fillText("A quiet page gives an idea the space it needs to grow.",34,158+line*19);
        ctx.fillStyle="#a8ba94";ctx.fillRect(34,h-52,w-68,1);ctx.fillStyle="#7d8e68";ctx.fillText(String(args.pageIndex+1),w/2,h-28);
        return{pageIndex:args.pageIndex,widthPx:c.width,heightPx:c.height,pageWidthPt:w,pageHeightPt:h,imageBase64:c.toDataURL().split(",")[1]};
      }
      if(command==="capture_region") {
        mock.captures.push(clone(args.region));if(mock.captureDelay)await new Promise(r=>setTimeout(r,mock.captureDelay));
        const c=document.createElement("canvas");c.width=240;c.height=100;const ctx=c.getContext("2d");ctx.fillStyle="white";ctx.fillRect(0,0,240,100);ctx.fillStyle="#354";ctx.fillText("Original PDF pixels",20,50);
        return{mode:args.region.mode,page:args.region.pageIndex,sourcePath:docs.get(args.region.tabId),text:args.region.mode==="ocr"?" \r\n A quiet page\n\nSecond paragraph. \n":null,dataUrl:args.region.mode==="png"?c.toDataURL():null,width:240,height:100};
      }
      if(command==="plugin:window|destroy")return;
      throw Error(`Unexpected Lightning IPC: ${command}`);
    }
  };
}
