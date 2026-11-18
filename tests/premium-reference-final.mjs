import { chromium, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const directory='artifacts/html-referencia-final';
await mkdir(directory,{recursive:true});
const browser=await chromium.launch();
const report=[];
const views=['Início','Vendas','Produtos','Estoque','Notas fiscais','Financeiro','Serviços','Clientes','Relatórios','Marketing','Configurações'];
try{
 for(const width of [1440,1024,768,390,360]){
  const context=await browser.newContext({viewport:{width,height:900},acceptDownloads:true});
  const page=await context.newPage();const errors=[];const requests=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url())});
  await page.goto(pathToFileURL(process.cwd()+'/output/html/Juliana-Souza-Premium-Referencia-Final.html').href,{waitUntil:'networkidle'});
  await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(image=>{image.loading='eager';return image.decode().catch(()=>{})}))});
  const check=await page.evaluate(()=>({
   overflow:document.documentElement.scrollWidth>innerWidth,
   images:[...document.querySelectorAll('#store [data-product-image]')].map(image=>{
    const css=getComputedStyle(image),rect=image.getBoundingClientRect(),box=image.parentElement.getBoundingClientRect();
    return {alt:image.alt,loaded:image.naturalWidth>0,fit:css.objectFit,position:css.objectPosition,transform:css.transform,inside:rect.left>=box.left-1&&rect.right<=box.right+1&&rect.top>=box.top-1&&rect.bottom<=box.bottom+1,gaps:[rect.left-box.left,box.right-rect.right,rect.top-box.top,box.bottom-rect.bottom]};
   }),
   headings:[...document.querySelectorAll('#store h1,#store h2')].filter(element=>element.scrollWidth>element.clientWidth+1).map(element=>element.textContent),
   broken:[...document.images].filter(image=>!image.naturalWidth).map(image=>image.alt)
  }));
  await page.screenshot({path:`${directory}/loja-${width}.png`,fullPage:true});
  await page.screenshot({path:`${directory}/inicio-${width}.png`});
  assert.equal(check.overflow,false,JSON.stringify({width,check}));
  assert.deepEqual(check.headings,[],JSON.stringify({width,check}));
  assert.deepEqual(check.broken,[]);
  assert.ok(check.images.every(image=>image.loaded&&image.fit==='contain'&&image.position==='50% 50%'&&image.transform==='none'&&image.inside&&image.gaps.every(gap=>gap>=7)),JSON.stringify({width,check}));
  await page.locator('[data-filter="Faciais"]').click();await expect(page.locator('.product-card')).toHaveCount(1);
  await page.locator('[data-filter="Todas"]').click();
  await page.locator('#query').fill('meraki');await page.locator('#storeSearch button').click();await expect(page.locator('.product-card')).toHaveCount(1);
  await page.locator('.product-card [data-product]').click();await expect(page.locator('dialog[open]')).toBeVisible();
  const modalFit=await page.locator('.detail-image img').evaluate(image=>getComputedStyle(image).objectFit);assert.equal(modalFit,'contain');
  await page.screenshot({path:`${directory}/produto-${width}.png`});await page.keyboard.press('Escape');
  await page.locator('#query').fill('');await page.locator('#storeSearch button').click();
  await page.locator('.favorite').first().click();await expect(page.locator('#favCount')).toHaveText('1');
  await page.locator('#adminMode').click();await page.locator('#management:not([hidden])').waitFor();
  const contentSignatures=new Set();
  for(const view of views){
   await page.locator('#adminNav').getByRole('button',{name:view,exact:true}).click();
   await expect(page.locator('#adminBreadcrumb')).toHaveText('Gestão / '+view);
   const text=await page.locator('#adminContent').innerText();contentSignatures.add(text.replace(view,''));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`Gestão ${view}, ${width}`);
   assert.equal(await page.locator('#adminContent h1').evaluate(element=>element.scrollWidth>element.clientWidth+1),false,`Título ${view}, ${width}`);
   if(['Início','Produtos','Configurações','Financeiro'].includes(view))await page.screenshot({path:`${directory}/gestao-${view==='Início'?'inicio':view==='Configurações'?'configuracoes':view==='Produtos'?'produtos':'financeiro'}-${width}.png`,fullPage:true});
  }
  assert.equal(contentSignatures.size,views.length,'Os módulos devem possuir conteúdos distintos.');
  await page.locator('#settingsForm input[name="message"]').fill('Carinho em cada cuidado');
  await page.getByRole('button',{name:'Salvar configurações'}).click();await expect(page.locator('#toast')).toHaveText('Configurações salvas neste navegador.');
  await page.reload({waitUntil:'networkidle'});await expect(page.locator('#store .brand-logo').first()).toHaveAttribute('alt','Juliana Souza — Amor em cada detalhe');
  await page.locator('#adminMode').click();await page.locator('#adminNav').getByRole('button',{name:'Configurações',exact:true}).click();
  await expect(page.locator('#settingsForm input[name="message"]')).toHaveValue('Carinho em cada cuidado');
  await page.locator('#settingsForm input[name="message"]').fill('Amor em cada detalhe');await page.getByRole('button',{name:'Salvar configurações'}).click();
  await page.locator('#adminNav').getByRole('button',{name:'Produtos',exact:true}).click();
  await page.locator('#adminQuery').fill('nenhum-resultado');await page.locator('#catalogFilter button').click();await expect(page.locator('#adminProductRows')).toContainText('Nenhum produto encontrado');
  await page.locator('#adminQuery').fill('');await page.locator('#catalogFilter button').click();
  await page.locator('[data-edit-product="meraki"]').click();await page.locator('#productForm input[name="size"]').fill('60 cápsulas');
  await page.getByRole('button',{name:'Salvar produto',exact:true}).click();await expect(page.locator('dialog[open]')).toHaveCount(0);
  await page.locator('#adminNav').getByRole('button',{name:'Relatórios',exact:true}).click();
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Baixar catálogo em CSV'}).click();const download=await downloading;assert.equal(download.suggestedFilename(),'Juliana-Souza-catalogo-local.csv');
  await page.locator('#storeMode').click();
  if(width<=760){await page.locator('#menuToggle').click();await expect(page.locator('#menuToggle')).toHaveAttribute('aria-expanded','true');await page.locator('#storeNav a').filter({hasText:'Capilares'}).click();await expect(page.locator('#menuToggle')).toHaveAttribute('aria-expanded','false')}
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[],'O HTML deve funcionar sem dependências externas.');
  report.push({width,...check,modules:views.length,distinctContents:contentSignatures.size,configurationPersistence:true,catalogEdit:true,csvDownload:true,errors,externalRequests:requests});
  await context.close();
 }
 await writeFile(`${directory}/validation.json`,JSON.stringify(report,null,2));
 console.log('HTML aprovado: 5 larguras, 11 telas distintas, configurações persistentes, edição local, CSV e imagens inteiras.');
}finally{await browser.close()}
