type Control={select:HTMLSelectElement;button:HTMLButtonElement;panel:HTMLDivElement;sync:()=>void;close:(focus?:boolean)=>void;dispose:()=>void};
const controls=new Set<Control>();
let opened:Control|null=null,sequence=0,started=false;

export function syncThemedSelects(root:ParentNode=document):void{for(const c of controls)if(root===document||root.contains(c.select))c.sync();}

function enhance(select:HTMLSelectElement):void{
  if(select.dataset.themedSelect)return;
  const name=select.getAttribute("aria-label")||[...select.labels??[]].flatMap(l=>[...l.childNodes]).find(n=>n.nodeType===Node.TEXT_NODE&&n.textContent?.trim())?.textContent?.trim()||"选择";
  const rail=select.parentElement!.classList.contains("rail-select"),wrapper=rail?select.parentElement!:document.createElement("div");
  if(!rail){select.before(wrapper);wrapper.append(select);}
  wrapper.classList.add("themed-select");if(rail)wrapper.classList.add("themed-select-rail");
  const button=document.createElement("button"),panel=document.createElement("div"),label=document.createElement("span"),arrow=document.createElement("span");
  button.type="button";button.className="themed-select-button";button.setAttribute("role","combobox");button.setAttribute("aria-haspopup","listbox");button.setAttribute("aria-expanded","false");
  panel.id=`themed-options-${++sequence}`;panel.className="themed-options";panel.setAttribute("role","listbox");panel.setAttribute("aria-label",name);panel.setAttribute("popover","manual");button.setAttribute("aria-controls",panel.id);
  label.className="themed-select-value";arrow.className="themed-select-arrow";arrow.setAttribute("aria-hidden","true");arrow.textContent="⌄";
  const originalIcon=rail?wrapper.querySelector<HTMLElement>("[data-icon]"):null;
  if(originalIcon)button.append(originalIcon);else button.append(label);
  button.append(arrow);wrapper.append(button,panel);
  select.dataset.themedSelect=panel.id;select.classList.add("themed-native-select");select.tabIndex=-1;select.setAttribute("aria-hidden","true");
  const events=new AbortController();let active=select.selectedIndex;
  const options=()=>[...select.options];
  const mark=()=>{
    for(const [i,el]of [...panel.children].entries()){el.classList.toggle("option-active",i===active);el.setAttribute("aria-selected",String(i===select.selectedIndex));}
    if(active>=0){button.setAttribute("aria-activedescendant",`${panel.id}-${active}`);const item=panel.children[active] as HTMLElement|undefined;if(item){if(item.offsetTop<panel.scrollTop)panel.scrollTop=item.offsetTop;else if(item.offsetTop+item.offsetHeight>panel.scrollTop+panel.clientHeight)panel.scrollTop=item.offsetTop+item.offsetHeight-panel.clientHeight;}}
  };
  const sync=()=>{
    const text=select.selectedOptions[0]?.textContent??"";label.textContent=text;button.disabled=select.disabled;button.setAttribute("aria-label",`${name}：${text}`);button.title=`${name} · ${text}`;
    if(select.disabled&&opened===control)close();
    if(opened===control)mark();
  };
  const close=(focus=false)=>{
    if(opened===control)opened=null;
    if(typeof panel.hidePopover==="function"&&panel.matches(":popover-open"))panel.hidePopover();
    panel.classList.remove("options-open");button.setAttribute("aria-expanded","false");button.removeAttribute("aria-activedescendant");
    if(focus&&button.isConnected&&!button.disabled)button.focus({preventScroll:true});
  };
  const choose=(index:number)=>{
    const option=select.options[index];if(!option||option.disabled||select.disabled)return;
    select.selectedIndex=index;close(true);sync();select.dispatchEvent(new Event("input",{bubbles:true}));select.dispatchEvent(new Event("change",{bubbles:true}));sync();
  };
  const show=()=>{
    if(select.disabled)return;opened?.close();sync();active=select.selectedIndex;panel.replaceChildren();
    options().forEach((option,i)=>{
      const item=document.createElement("button");item.type="button";item.className="themed-option";item.id=`${panel.id}-${i}`;item.dataset.value=option.value;item.setAttribute("role","option");item.tabIndex=-1;item.disabled=option.disabled;
      const text=document.createElement("span"),check=document.createElement("span");text.textContent=option.textContent;check.className="themed-option-check";check.textContent="✓";check.setAttribute("aria-hidden","true");item.append(text,check);
      item.onpointerdown=e=>e.preventDefault();item.onpointermove=()=>{active=i;mark();};item.onclick=e=>{e.preventDefault();e.stopPropagation();choose(i);};panel.append(item);
    });
    const b=button.getBoundingClientRect(),width=Math.min(innerWidth-16,Math.max(b.width,rail?186:220)),below=innerHeight-b.bottom-14,above=b.top-14,height=Math.min(320,Math.max(70,Math.max(below,above)));
    Object.assign(panel.style,{width:`${width}px`,maxHeight:`${height}px`,left:`${Math.max(8,Math.min(b.left,innerWidth-width-8))}px`,top:"0px"});
    opened=control;button.setAttribute("aria-expanded","true");
    if(typeof panel.showPopover==="function")panel.showPopover();else panel.classList.add("options-open");
    const actual=panel.getBoundingClientRect().height;panel.style.top=`${below>=actual||below>=above?b.bottom+6:Math.max(8,b.top-actual-6)}px`;mark();
  };
  const control:Control={select,button,panel,sync,close,dispose:()=>{close();events.abort();controls.delete(control);}};
  controls.add(control);
  // Label activation must never reopen the hidden system picker.
  select.addEventListener("mousedown",e=>e.preventDefault(),{signal:events.signal});
  select.addEventListener("click",e=>e.preventDefault(),{signal:events.signal});
  select.addEventListener("focus",()=>button.focus({preventScroll:true}),{signal:events.signal});
  select.labels?.[0]?.addEventListener("click",e=>{if(e.target===select.labels?.[0]||e.target===wrapper){e.preventDefault();button.focus({preventScroll:true});button.click();}},{signal:events.signal});
  button.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();if(opened===control)close(true);else show();},{signal:events.signal});
  button.addEventListener("keydown",e=>{
    const keys=["ArrowUp","ArrowDown","Home","End","Enter"," ","Escape","Tab"];
    if(!keys.includes(e.key)){
      if(opened===control&&e.key.length===1&&!e.ctrlKey&&!e.metaKey){const i=options().findIndex(o=>!o.disabled&&o.textContent?.toLocaleLowerCase().startsWith(e.key.toLocaleLowerCase()));if(i>=0){active=i;mark();}e.stopPropagation();}
      return;
    }
    if(e.key==="Tab"){close();return;}
    e.preventDefault();e.stopPropagation();
    if(e.key==="Escape"){close(true);return;}
    if(opened!==control){show();return;}
    if(e.key==="Enter"||e.key===" "){choose(active);return;}
    const enabled=options().map((o,i)=>o.disabled?-1:i).filter(i=>i>=0);if(!enabled.length)return;
    const at=enabled.indexOf(active);
    active=e.key==="Home"?enabled[0]:e.key==="End"?enabled[enabled.length-1]:enabled[(at+(e.key==="ArrowDown"?1:-1)+enabled.length)%enabled.length];mark();
  },{signal:events.signal});
  select.addEventListener("change",()=>{close();sync();},{signal:events.signal});sync();
}

export function initThemedSelects():void{
  if(started)return;started=true;
  const scan=(root:ParentNode)=>{if(root instanceof HTMLSelectElement)enhance(root);for(const select of root.querySelectorAll<HTMLSelectElement>("select"))enhance(select);};
  scan(document);
  new MutationObserver(records=>{
    for(const record of records){
      if(record.type==="attributes"){const select=record.target instanceof HTMLSelectElement?record.target:(record.target as Element).closest("select");if(select)for(const c of controls)if(c.select===select)c.sync();}
      for(const node of record.addedNodes)if(node instanceof Element)scan(node);
    }
    for(const c of [...controls])if(!c.select.isConnected)c.dispose();
  }).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["disabled","selected"]});
  document.addEventListener("pointerdown",e=>{if(opened&&!opened.button.contains(e.target as Node)&&!opened.panel.contains(e.target as Node))opened.close();},true);
  document.addEventListener("scroll",e=>{if(opened&&!(e.target instanceof Node&&opened.panel.contains(e.target)))opened.close();},true);
  window.addEventListener("resize",()=>opened?.close());window.addEventListener("blur",()=>opened?.close());
}
