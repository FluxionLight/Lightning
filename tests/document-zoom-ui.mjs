import assert from "node:assert/strict";
import {mkdir,writeFile} from "node:fs/promises";
import {createServer} from "vite";
import {chromium} from "playwright";
import {installTauriMock} from "./helpers/mock-tauri.mjs";
import {clickApp,chooseReadingMode,activateTab} from "./helpers/reader-actions.mjs";
await mkdir("test-results",{recursive:true});
const server=await createServer({server:{host:"127.0.0.1",port:0,strictPort:false},clearScreen:false});await server.listen();
const browser=await chromium.launch({executablePath:process.env.LIGHTNING_TEST_BROWSER||"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:true});
const page=await browser.newPage({viewport:{width:1440,height:950}});await page.addInitScript(installTauriMock);
const checks=[],errors=[];page.on("pageerror",e=>errors.push(e.message));const pass=s=>{checks.push(s);console.log(`PASS: ${s}`);};
const paper=i=>page.locator(".desk-paper").nth(i),bounds=i=>paper(i).locator(".pdf-page").boundingBox();
const settle=()=>page.waitForFunction(()=>document.querySelector("#pdf-viewport")?.getAttribute("aria-busy")==="false"&&!document.querySelector("#pdf-host .pdf-page[data-moving]"));
const open=async path=>{await page.evaluate(p=>window.testMock.nextPath=p,path);await clickApp(page,"#open-btn");await settle();};
const scene=()=>page.evaluate(()=>{const s=JSON.parse(localStorage.getItem("lightning.desk.v2"));return {camera:s.camera,scale:s.scale};});
const piles=i=>paper(i).locator(".paper-panel").evaluateAll(els=>els.map(el=>{const b=el.getBoundingClientRect();return {width:b.width,height:b.height};}));
const geometry=i=>paper(i).evaluate(el=>["--doc-x","--doc-y","--doc-width"].map(p=>el.style.getPropertyValue(p)));
async function ctrlWheel(point,delta,count=1,newGesture=true){if(newGesture)await page.waitForTimeout(550);await page.mouse.move(point.x,point.y);await page.keyboard.down("Control");for(let i=0;i<count;i++){await page.mouse.wheel(0,delta);await page.waitForTimeout(35);}await page.keyboard.up("Control");if(count>1)await page.waitForTimeout(550);}
function sameSizes(a,b){for(let i=0;i<a.length;i++){assert.ok(Math.abs(a[i].width-b[i].width)<1);assert.ok(Math.abs(a[i].height-b[i].height)<1);}}
try{
  await page.goto(server.resolvedUrls.local[0]);await open("C:/fixture/a.pdf");await chooseReadingMode(page,"paper");await settle();await page.locator("#next-btn").click();await settle();
  await open("C:/fixture/b.pdf");await chooseReadingMode(page,"paper");await settle();await page.locator("#next-btn").click();await settle();await page.locator(".desk-arrange").click();await settle();await activateTab(page,0);await settle();
  const a=await geometry(0),b=await bounds(1),p=await piles(1),s=await scene(),point={x:b.x+b.width-35,y:b.y+120};
  await ctrlWheel(point,-100);await settle();const enlarged=await bounds(1);
  assert.ok(Math.abs(enlarged.width/b.width-1.1)<.005);assert.deepEqual(await geometry(0),a);assert.deepEqual(await scene(),s);sameSizes(await piles(1),p);assert.equal(await paper(1).locator(".pdf-page").getAttribute("data-page"),"1");pass("Ctrl-wheel enlarges the file under the mouse even when another file was active, without zooming the desk, its neighbor or its piles");
  assert.ok(Math.abs((point.x-b.x)/b.width-(point.x-enlarged.x)/enlarged.width)<.002);assert.ok(Math.abs((point.y-b.y)/b.height-(point.y-enlarged.y)/enlarged.height)<.002);pass("the PDF content under the pointer stays in place during document zoom");
  await ctrlWheel(point,100);await settle();assert.ok(Math.abs((await bounds(1)).width-b.width)<1);sameSizes(await piles(1),p);pass("reverse Ctrl-wheel shrinks only that document and preserves preview sizes");
  const view=await page.locator(".desk-viewport").boundingBox(),blankScene=await scene(),blankGeometry=await geometry(1);await ctrlWheel({x:view.x+8,y:view.y+8},-100);assert.deepEqual(await scene(),blankScene);assert.deepEqual(await geometry(1),blankGeometry);
  const beforePile=await paper(1).locator(".paper-panel-before").boundingBox();await ctrlWheel({x:beforePile.x+15,y:beforePile.y+40},-100);assert.deepEqual(await geometry(1),blankGeometry);sameSizes(await piles(1),p);pass("Ctrl-wheel over empty desk or a page pile does not fall through to whole-scene or browser zoom");
  await ctrlWheel(point,-100,9);await settle();assert.ok((await bounds(1)).width>b.width*2);sameSizes(await piles(1),p);assert.deepEqual(await geometry(0),a);pass("default piles keep their dimensions across a large range of document magnifications");
  await page.locator(".desk-arrange").click();await activateTab(page,0);await settle();await page.waitForTimeout(250);await paper(0).locator(".paper-panel-after .paper-panel-resize").focus();for(let i=0;i<7;i++)await page.keyboard.press("Shift+ArrowRight");await page.waitForTimeout(200);
  const largePiles=await piles(0),body=await bounds(0),smallPoint={x:body.x+80,y:body.y+120};await ctrlWheel(smallPoint,100,10);await settle();assert.ok((await bounds(0)).width<largePiles[1].width,JSON.stringify({body,after:await bounds(0),largePiles,piles:await piles(0),status:await page.locator("#status").innerText()}));sameSizes(await piles(0),largePiles);pass("a manually enlarged page pile stays independent even when the main PDF becomes narrower than it");
  await page.locator("#reset-paper").click();await page.locator(".desk-arrange").click();await settle();await page.locator(".desk-zoom-in").click();await page.waitForTimeout(220);await settle();const scaled=await bounds(0),scaledScene=await scene(),scaledPiles=await piles(0);await ctrlWheel({x:scaled.x+75,y:scaled.y+110},-100);await settle();assert.ok(Math.abs((await bounds(0)).width/scaled.width-1.1)<.005);assert.deepEqual(await scene(),scaledScene);sameSizes(await piles(0),scaledPiles);pass("document zoom remains independent after the desk has been separately magnified");
  await clickApp(page,"#workspace-focus");await settle();const focus=await bounds(0),focusPiles=await piles(0);await ctrlWheel({x:focus.x+60,y:focus.y+100},-100);await settle();assert.ok(Math.abs((await bounds(0)).width/focus.width-1.1)<.005);sameSizes(await piles(0),focusPiles);pass("focus mode retains Ctrl-wheel PDF zoom with independently sized page piles");
  await clickApp(page,"#workspace-desk");await settle();
  await page.locator(".desk-arrange").click();await settle();const slowA=await bounds(0),slowB=await bounds(1),slowASize=slowA.width,slowBSize=slowB.width;
  await page.evaluate(()=>window.testMock.renderDelay=100);await ctrlWheel({x:slowA.x+30,y:slowA.y+100},-100);await ctrlWheel({x:slowB.x+slowB.width-30,y:slowB.y+100},-100,1,false);await settle();await page.waitForFunction(()=>[...document.querySelectorAll(".desk-paper .pdf-viewport")].every(el=>el.getAttribute("aria-busy")==="false"));
  assert.ok(Math.abs((await bounds(0)).width/slowASize-1.1)<.005);assert.ok(Math.abs((await bounds(1)).width/slowBSize-1.1)<.005);await page.evaluate(()=>window.testMock.renderDelay=0);pass("fast zooming between files keeps each target's own multiplier while native rendering is in flight");await page.waitForTimeout(550);
  assert.deepEqual(errors,[]);await writeFile("test-results/document-zoom-results.json",JSON.stringify({checks,errors},null,2));console.log(`PASS: ${checks.length} document zoom groups`);
}catch(e){await page.screenshot({path:"test-results/document-zoom-failure.png"});throw e;}
finally{await browser.close();await server.close();}
