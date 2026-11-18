import {chromium} from '@playwright/test';
import {pathToFileURL} from 'node:url';
import {readFile,writeFile,readdir} from 'node:fs/promises';
const dir='tmp/pdfs/telas-atualizadas';const manifest=JSON.parse(await readFile(`${dir}/manifest.json`,'utf8')).filter(s=>s.title!=='Loja completa');
const source=(await readdir('output/html')).find(n=>n.endsWith('Original.html'));const browser=await chromium.launch();let n=0;
try{for(const [mode,width] of [['Computador',1440],['Celular',390]]){
 const page=await browser.newPage({viewport:{width,height:844}});await page.goto(pathToFileURL(process.cwd()+'/output/html/'+source).href);
 await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>{i.loading='eager';return i.decode().catch(()=>{})}))});
 await page.addStyleTag({content:'.mode-switch,.mobile-store-nav,.skip{visibility:hidden!important}.store-header{position:static!important}'});
 async function shot(title,selector){const path=`${dir}/section-${++n}.png`;await page.locator(selector).screenshot({path,animations:'disabled'});manifest.push({mode,title,path})}
 await shot('Cabeçalho e navegação','.store-header');await shot('Banner principal','.hero');await shot('Benefícios','.benefits');await shot('Categorias','#categorias');
 if(mode==='Computador'){await shot('Vitrine de produtos','.showcase');await shot('Linhas de tratamento e cronograma','#linhas')}
 else{await shot('Linhas de tratamento - apresentação','.treatments-heading');for(let i=1;i<=3;i++)await shot('Linha '+['Scalp Hair','Milagre Capilar','Sakura Essencial Care'][i-1],`.treatment-card:nth-child(${i})`);await shot('Você pode combinar as linhas','#linhas>.wrap>.treatment-ribbon');await shot('Cronograma capilar','.schedule')}
 await shot('Cuide-se com o que você merece','.care-banner');await shot('Área de vídeos','.video-section');await shot('Newsletter','.newsletter');await shot('Rodapé','.store-footer');await page.close();
}const sorted=manifest.sort((a,b)=>a.mode.localeCompare(b.mode));await writeFile(`${dir}/manifest-corrected.json`,JSON.stringify(sorted,null,2));console.log(sorted.length+' telas completas, sem fatiamento.')}finally{await browser.close()}
