import assert from "node:assert/strict";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import ts from "typescript";
const output=new URL("../test-results/modules/",import.meta.url);await mkdir(output,{recursive:true});
for(const name of ["pdf-render-cache","paper-layout","reading-state","shortcuts","pdf-laser","lazy-desk"]) {
  const source=await readFile(new URL(`../src/${name}.ts`,import.meta.url),"utf8");
  let js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
  js=js.replace(/from "(\.\/[^"]+)"/g,'from "$1.mjs"');await writeFile(new URL(`${name}.mjs`,output),js);
}
const {PdfRenderCache}=await import(new URL("pdf-render-cache.mjs",output));
const {normalizeState,ReadingStateStore}=await import(new URL("reading-state.mjs",output));
const {normalizeLaserPreferences}=await import(new URL("pdf-laser.mjs",output));
const {limitDeskCamera}=await import(new URL("lazy-desk.mjs",output));
const view={width:1200,height:800},objects=[{x:200,y:50,width:500,height:650}],empty={x:0,y:0};
const limited=limitDeskCamera({x:1e6,y:-1e6},1,view,objects,empty);assert.ok(limited.x<500&&limited.y>-500);assert.deepEqual(limitDeskCamera(limited,1,view,objects,empty),limited);
const expanded=limitDeskCamera({x:-1e6,y:0},1,view,[...objects,{x:4000,y:100,width:400,height:500}],empty);assert.ok(expanded.x<-3000);assert.ok(limitDeskCamera({x:1e6,y:1e6},1,view,[],empty).x<500);
const identity={path:"C:/fixture/a.pdf",documentId:"a".repeat(64)};
const normalized=normalizeState(identity,{page:NaN,zoom:Infinity,anchor:{page:3,scrollX:5,scrollY:-4},paperLayout:{before:{x:99,y:-4,width:9999},after:{x:0,y:0,width:0}}});
assert.equal(normalized.zoom,1);assert.equal(normalized.page,0);assert.deepEqual(normalized.anchor,{page:3,scrollX:1,scrollY:0});assert.equal(normalized.paperLayout.before.width,960);
const free=normalizeState(identity,{paperLayout:{before:{x:.2,y:.7,width:120,desk:{x:-500,y:1600}},after:{x:1,y:1,width:0,desk:{x:Infinity,y:0}}}});
assert.deepEqual(free.paperLayout.before.desk,{x:-500,y:1600});assert.equal(free.paperLayout.after.desk,undefined);assert.equal(free.paperLayout.before.x,.2);
assert.equal(normalizeLaserPreferences({holdSeconds:99,fadeSeconds:0,laserColor:"bad"}).holdSeconds,30);
const queue=[],calls=[];
const cache=new PdfRenderCache(r=>new Promise((resolve,reject)=>{calls.push(r.pageIndex);queue.push({resolve,reject});}),1000,2);
const page=i=>({pageIndex:i,imageBase64:"abc",widthPx:1,heightPx:1,pageWidthPt:1,pageHeightPt:1});
const a=cache.request({tabId:1,pageIndex:0,zoom:1});await Promise.resolve();
const stale=cache.request({tabId:1,pageIndex:1,zoom:1});const latest=cache.request({tabId:1,pageIndex:2,zoom:1});
assert.equal(await stale,null);queue.shift().resolve(page(0));await a;await Promise.resolve();assert.deepEqual(calls,[0,2]);
const duplicate=cache.request({tabId:1,pageIndex:2,zoom:1});assert.equal(duplicate,latest);queue.shift().resolve(page(2));await latest;
const failure=cache.request({tabId:1,pageIndex:3,zoom:1});await Promise.resolve();queue.shift().reject(Error("test failure"));await assert.rejects(failure);
const closed=cache.request({tabId:1,pageIndex:4,zoom:1});await Promise.resolve();cache.close(1);queue.shift().resolve(page(4));assert.equal(await closed,null);
assert.equal(cache.peek({tabId:1,pageIndex:0,zoom:1}),null);
// Per-document writes remain ordered even if the first native save is slow.
globalThis.window=globalThis;
const saves=[];let release;
globalThis.window.__TAURI_INTERNALS__={invoke:async(command,args)=>{if(command==="save_reading_state"){saves.push(args.state.page);if(saves.length===1)await new Promise(r=>release=r);}}};
const store=new ReadingStateStore(()=>{}),tab={state:normalizeState(identity),page:1,zoom:1,fitMode:"none"};
store.schedule(tab);const first=store.flush();await new Promise(r=>setTimeout(r,1));tab.page=2;store.schedule(tab);const second=store.flush();release();await Promise.all([first,second]);assert.deepEqual(saves,[1,2]);
// Returning to the persisted state before debounce must cancel the stale snapshot.
tab.page=3;store.schedule(tab);tab.page=2;store.schedule(tab);await store.flush();assert.deepEqual(saves,[1,2]);
console.log("PASS: state validation, ink limits, render dedup/latest/failure/close, ordered persistence");
