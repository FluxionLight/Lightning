const paths = {
  frame:'<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 8h18M8 11v7h8v-7"/>',
  startup:'<path d="M7 3H3v18h18v-4M11 3h10v10M21 3l-11 11"/>',
  menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
  open:'<path d="M3 18V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v2M3 18l3-7h16l-3 9H5a2 2 0 0 1-2-2Z"/>',
  desk:'<rect x="3" y="3" width="11" height="15" rx="1.5"/><path d="M17 7h4v14H10"/>',
  focus:'<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/><rect x="8" y="7" width="8" height="10" rx="1"/>',
  paper:'<path d="M7 3h10v14H7zM4 7H3v14h10v-1M20 6h1v14h-5"/>',
  theme:'<path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.4-3.4c-.8-.8-.2-2.1.9-2.1H18A3 3 0 0 0 21 12a9 9 0 0 0-9-9Z"/><circle cx="7.5" cy="10" r=".8"/><circle cx="10" cy="6.8" r=".8"/><circle cx="14.5" cy="7" r=".8"/><circle cx="17.5" cy="10.5" r=".8"/>',
  shortcuts:'<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M10 13h.01M14 13h.01M18 13h.01M8 16h8"/>',
  settings:'<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2" fill="var(--surface)"/><circle cx="16" cy="12" r="2" fill="var(--surface)"/><circle cx="10" cy="18" r="2" fill="var(--surface)"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 .5c0 2-2.5 2-2.5 4M12 17h.01"/>',
  cursor:'<path d="m5 3 14 10-7 1-3 7-4-18Z"/>',
  pen:'<path d="m15 4 5 5M4 20l1-5L16 4a2 2 0 0 1 3 0l1 1a2 2 0 0 1 0 3L9 19l-5 1Z"/>',
  marker:'<path d="m12 3 8 8-6 6-8-8 6-6ZM6 9l-3 3 8 8 3-3M5 16l-2 5h5l2-2M15 6l-6 6"/>',
  erase:'<path d="m9 20-6-6a2 2 0 0 1 0-3l8-8a2 2 0 0 1 3 0l7 7a2 2 0 0 1 0 3l-7 7H9ZM7 7l10 10M13 20h8"/>',
  anchor:'<circle cx="12" cy="5" r="2"/><path d="M12 7v14M8 10h8M3 14v3a9 9 0 0 0 18 0v-3M1 16l2-2 2 2M19 16l2-2 2 2"/>',
  anchorReturn:'<path d="M8 4H4v4M4 5a9 9 0 1 1-1 10M12 7v5l3 2"/>',
  capture:'<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/><rect x="7" y="7" width="10" height="10" rx="1"/>',
  image:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
  text:'<path d="M5 5V3h14v2M12 3v18M8 21h8"/>',
  outline:'<path d="M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01"/>',
  up:'<path d="m6 14 6-6 6 6"/>',down:'<path d="m6 10 6 6 6-6"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',minus:'<path d="M5 12h14"/>',
  fitWidth:'<path d="M3 4v16M21 4v16M6 12h12M9 9l-3 3 3 3M15 9l3 3-3 3"/>',
  fitPage:'<rect x="6" y="3" width="12" height="18" rx="1"/><path d="M9 8V6h2M15 16v2h-2"/>',
  reset:'<path d="M4 9V4h5M4 5a9 9 0 1 1-1 10"/>',
  overview:'<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/><path d="M8 8h4v8H8zM15 10h2v6h-2"/>',
  arrange:'<path d="m12 3 10 6-10 6L2 9l10-6ZM3 13l9 5 9-5M3 17l9 5 9-5"/>',
  minimize:'<path d="M5 12h14"/>',maximize:'<rect x="5" y="5" width="14" height="14"/>',restore:'<path d="M9 5V3h12v12h-2"/><rect x="3" y="9" width="12" height="12"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',
} as const;
export type IconName=keyof typeof paths;
export function icon(name:IconName):string {return `<svg class="line-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;}
export function setIcon(button:HTMLElement,name:IconName,label?:string):void {
  const title=label??button.getAttribute("aria-label")??button.title;
  button.innerHTML=icon(name);if(title){const text=document.createElement("span");text.className="sr-only";text.textContent=title;button.append(text);button.title=title;button.setAttribute("aria-label",title);}
}
