export async function showAppMenu(page){if(await page.locator("#menu-toggle").getAttribute("aria-expanded")!=="true")await page.locator("#menu-toggle").click();}
export async function clickApp(page,selector){if(!await page.locator(selector).isVisible())await showAppMenu(page);await page.locator(selector).click();}
export async function chooseReadingMode(page,mode){await showAppMenu(page);if(await page.locator("#reading-mode").getAttribute("aria-pressed")===String(mode==="paper")){await page.locator("#menu-toggle").click();return;}await page.locator("#reading-mode").click();}
export async function chooseOption(page,selector,value){const select=page.locator(selector);await page.waitForFunction(s=>!!document.querySelector(s)?.dataset.themedSelect,selector);const popup=await select.getAttribute('data-themed-select');await select.locator('..').locator('.themed-select-button').click();await page.locator(`#${popup} [data-value="${value}"]`).click();}
export async function activateTab(page,index){
  const tabs=page.locator(".tab"),tab=tabs.nth(index);
  if(await tab.getAttribute("aria-selected")==="true"&&await tab.getAttribute("data-stowed")!=="true"){await page.waitForFunction(()=>!document.querySelector(".document-transitioning"));return;}
  const desk=await page.locator("#reading-workspace").getAttribute("data-mode")==="desk";
  if(desk&&await tab.getAttribute("data-stowed")!=="true")await tab.locator(".tab-title").click();
  await tabs.nth(index).locator(".tab-title").click();
  await page.waitForFunction(()=>!document.querySelector(".document-transitioning"));
}
