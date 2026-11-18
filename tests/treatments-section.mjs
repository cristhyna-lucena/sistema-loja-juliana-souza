import {chromium,expect} from '@playwright/test';
import {pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const dir='artifacts/linhas-tratamento';await mkdir(dir,{recursive:true});
const browser=await chromium.launch();const results=[];
try{for(const width of [1440,1024,768,390,360]){
 const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(process.cwd()+'/output/html/Juliana-Souza-Premium-Referencia-Final.html').href);
 await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.querySelectorAll('#linhas img')].map(i=>{i.loading='eager';return i.decode()}))});
 const data=await page.locator('#linhas').evaluate(el=>({overflow:document.documentElement.scrollWidth>innerWidth,broken:[...el.querySelectorAll('img')].filter(i=>!i.naturalWidth).length,images:[...el.querySelectorAll('img')].map(i=>{const s=getComputedStyle(i),r=i.getBoundingClientRect(),p=i.parentElement.getBoundingClientRect();return s.objectFit==='contain'&&s.transform==='none'&&r.left>=p.left&&r.right<=p.right+1&&r.top>=p.top&&r.bottom<=p.bottom+1}),cards:[...el.querySelectorAll('.treatment-card')].map(c=>({x:c.getBoundingClientRect().x,y:c.getBoundingClientRect().y})),textOverflow:[...el.querySelectorAll('h2,h3,h4,p')].filter(i=>i.scrollWidth>i.clientWidth+1).map(i=>i.textContent)}));
 assert.equal(data.overflow,false);assert.equal(data.broken,0);assert.ok(data.images.every(Boolean));assert.deepEqual(data.textOverflow,[]);assert.deepEqual(errors,[]);
 if(width>760)assert.equal(new Set(data.cards.map(c=>c.y)).size,1);else assert.equal(new Set(data.cards.map(c=>c.x)).size,1);
 const captureStyle=await page.addStyleTag({content:'.store-header,.mode-switch,.mobile-store-nav,.skip{visibility:hidden!important}'});
 await page.locator('#linhas').screenshot({path:`${dir}/secao-${width}.png`});await captureStyle.evaluate(el=>el.remove());
 for(const [id,name] of [['scalp','Scalp Hair'],['milagre','Milagre Capilar'],['sakura','Sakura Essencial Care']]){await page.locator(`[data-treatment="${id}"]`).click();await expect(page.locator('#dialogTitle')).toHaveText(name);await expect(page.locator('#dialogBody img')).toHaveJSProperty('complete',true);await page.keyboard.press('Escape')}
 await page.locator('[data-treatment="scalp"]').click();await page.locator('#dialogBody [data-product]').click();await expect(page.locator('#dialogTitle')).toHaveText('Gel tônico');await page.keyboard.press('Escape');
 results.push({width,...data,buttons:'passed'});await page.close();
}await writeFile(`${dir}/validation.json`,JSON.stringify(results,null,2));console.log('PASS: 5 larguras, fotos inteiras, três destinos de catálogo e detalhe de produto.');}finally{await browser.close()}
