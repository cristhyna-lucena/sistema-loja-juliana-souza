import {chromium} from '@playwright/test';
import {pathToFileURL} from 'node:url';
import {mkdir,writeFile,readdir} from 'node:fs/promises';
const dir='tmp/pdfs/telas-atualizadas';await mkdir(dir,{recursive:true});
const browser=await chromium.launch();const manifest=[];let n=0;
const source=(await readdir('output/html')).find(name=>name.endsWith('Original.html'));
if(!source)throw Error('HTML atual não localizado');
const url=pathToFileURL(process.cwd()+'/output/html/'+source).href;
async function shot(page,mode,title,selector=null){const path=`${dir}/${String(++n).padStart(3,'0')}.png`;await page.evaluate(()=>document.activeElement?.blur());const style=await page.addStyleTag({content:'.skip{display:none!important}.mode-switch,.mobile-store-nav{visibility:hidden!important}.store-header,.admin-sidebar{position:static!important}'});if(selector)await page.locator(selector).screenshot({path,animations:'disabled'});else await page.screenshot({path,fullPage:true,animations:'disabled'});await style.evaluate(el=>el.remove());manifest.push({path,mode,title})}
try{for(const [mode,width] of [['Computador',1440],['Celular',390]]){
 const page=await browser.newPage({viewport:{width,height:1000},deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>{i.loading='eager';return i.decode().catch(()=>{})}))});
 await shot(page,mode,'Loja completa');
 await page.locator('.product-card [data-product]').first().click();await shot(page,mode,'Detalhe de produto','#dialog');await page.keyboard.press('Escape');
 for(const id of ['scalp','milagre','sakura']){await page.locator(`[data-treatment="${id}"]`).click();await shot(page,mode,`Detalhe da linha ${id==="scalp"?'Scalp Hair':id==='milagre'?'Milagre Capilar':'Sakura Essencial Care'}`,'#dialog');await page.keyboard.press('Escape')}
 if(mode==='Celular'){
  await page.locator('#menuToggle').click();await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`${dir}/menu-mobile.png`});manifest.push({path:`${dir}/menu-mobile.png`,mode,title:'Menu de navegação'});await page.locator('#menuToggle').click();
  for(let i=0;i<4;i++){const card=page.locator('.product-card').nth(i);await card.scrollIntoViewIfNeeded();await shot(page,mode,`Vitrine - ${await card.locator('h3').innerText()}`,`.product-card:nth-child(${i+1})`)}
 }
 await page.locator('#adminMode').click();
 for(const name of ['Início','Vendas','Produtos','Estoque','Notas fiscais','Financeiro','Serviços','Clientes','Relatórios','Marketing','Configurações']){await page.locator('#adminNav').getByRole('button',{name,exact:true}).click();await page.evaluate(()=>scrollTo(0,0));await shot(page,mode,`Gestão - ${name}`)}
 await page.locator('#adminNav').getByRole('button',{name:'Produtos',exact:true}).click();await page.locator('[data-edit-product="meraki"]').click();await shot(page,mode,'Gestão - edição de produto','#dialog');await page.keyboard.press('Escape');
 if(errors.length)throw Error(errors.join('\n'));await page.close();
}await writeFile(`${dir}/manifest.json`,JSON.stringify(manifest,null,2));console.log(`${manifest.length} capturas atuais salvas.`)}finally{await browser.close()}
