// Ambiente isolado de QA: nenhuma conexão ao banco ou alteração de cadastros reais.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';

const directory = 'artifacts/premium-2026-11-04';
await mkdir(directory, { recursive: true });
const category = { id: 'visual-category', nome: 'Categoria de teste visual', ativa: true, versao: 1 };
const product = { id: 'visual-product', nome: 'Produto de teste visual', descricao: 'Cadastro fictício, usado apenas na revisão de interface.', sku: 'TESTE-VISUAL', precoVenda: '0.00', tipo: 'REVENDA', unidade: 'UN', categoriaId: category.id, categoria: category, ativo: true, versao: 1, imagemPrincipal: { id: 'visual-photo', alt: 'Foto oficial em cadastro de teste visual' } };
const photo = { id: 'visual-photo', alt: product.imagemPrincipal.alt, ordem: 0, status: 'PRONTA', temFoto: true, hash: 'visual', blurDataUrl: null, larguraOrig: 1400, alturaOrig: 1400, mensagem: null, removidaEm: null, restauravelAte: null };
let writes = [];
const fixture = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const respond = (value, status=200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  if (url.pathname === '/auth/login') { res.setHeader('Set-Cookie', 'loja_session=visual-admin; HttpOnly; SameSite=Lax; Path=/'); return respond({ usuario: { nome: 'Prévia visual' } }); }
  if (url.pathname === '/auth/logout') { res.setHeader('Set-Cookie', 'loja_session=; Max-Age=0; Path=/'); res.writeHead(204); return res.end(); }
  const cookie = req.headers.cookie || '';
  const profile = cookie.includes('visual-admin') ? 'ADMIN' : cookie.includes('visual-accountant') ? 'CONTADORA' : cookie.includes('visual-operator') ? 'OPERADOR' : null;
  if (!profile) return respond({ message: 'Sessão de teste inválida.' }, 401);
  if (url.pathname === '/auth/me') return respond({ usuario: { id: 'visual-user', empresaId: 'visual-company', nome: 'Prévia visual', perfil: profile } });
  if (url.pathname.startsWith('/acesso/')) return respond({ permitido: true });
  if (req.method !== 'GET') { let body=''; for await (const part of req) body += part; writes.push({ path: url.pathname, method: req.method, body: JSON.parse(body) }); return respond({ ...product, ...JSON.parse(body) }); }
  if (url.pathname.includes('/arquivo/')) { res.writeHead(200, { 'Content-Type': 'image/webp' }); return res.end(await readFile('apps/loja/public/products/sakura.webp')); }
  if (url.pathname.endsWith('/imagens')) return respond({ versao: 1, imagens: [photo], removidas: [] });
  if (url.pathname === '/categorias/opcoes') return respond([category]);
  if (url.pathname === '/categorias/' + category.id) return respond(category);
  if (url.pathname === '/produtos/' + product.id) return respond(product);
  if (['/produtos', '/categorias'].includes(url.pathname)) {
    const item = url.pathname === '/produtos' ? product : category;
    const matches = item.nome.toLowerCase().includes((url.searchParams.get('q') || '').toLowerCase());
    return respond({ itens: matches ? [item] : [], total: matches ? 1 : 0, page: 1, pageSize: 20, pages: 1 });
  }
  respond({}, 404);
});
fixture.listen(0, '127.0.0.1'); await once(fixture, 'listening');
const fixturePort = fixture.address().port;
const port = 43141;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
  cwd: 'apps/admin', env: { ...process.env, API_INTERNAL_URL: `http://127.0.0.1:${fixturePort}`, ADMIN_ORIGIN: origin }, stdio: ['ignore', 'pipe', 'pipe'],
});
let output=''; server.stdout.on('data', data=>output+=data); server.stderr.on('data',data=>output+=data);
let browser;
const report=[];
async function ready(page) {
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode().catch(()=>{}))); });
}
async function capture(page, name) {
  await ready(page);
  const layout = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, headings: [...document.querySelectorAll('h1,h2')].filter(element=>element.scrollWidth > element.clientWidth+1).map(element=>element.textContent) }));
  assert.equal(layout.overflow, false, `${name}: rolagem horizontal`);
  assert.deepEqual(layout.headings, [], `${name}: título excede container`);
  await page.addStyleTag({ content: 'html::after{content:"AMBIENTE DE TESTE VISUAL";position:fixed;bottom:5px;right:8px;z-index:9999;background:#fff8f4ed;border:1px solid #d7b27d;padding:4px 8px;border-radius:4px;font:9px Arial;color:#875929;pointer-events:none}' });
  await page.screenshot({ path: `${directory}/${name}.png`, fullPage: true });
  report.push({ name, ...layout });
}
try {
  for(let i=0;i<100;i++) { if(server.exitCode!==null) throw new Error(output); try { if((await fetch(origin+'/login')).ok) break; } catch {} await new Promise(resolve=>setTimeout(resolve,200)); }
  browser=await chromium.launch();
  for(const width of [1440,1024,768,390,360]) {
    const context=await browser.newContext({viewport:{width,height:900}});
    const page=await context.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin+'/login',{waitUntil:'networkidle'});
    await capture(page,`login-${width}`);
    await page.getByLabel('E-mail', {exact:true}).fill('preview@example.invalid');
    await page.getByLabel('Senha', {exact:true}).fill('somente-teste-visual');
    await page.getByRole('button',{name:'Mostrar senha'}).click();
    assert.equal(await page.locator('#senha').getAttribute('type'),'text');
    await page.getByRole('button',{name:'Ocultar senha'}).click();
    await page.getByRole('button',{name:'Entrar',exact:true}).click();
    await page.waitForURL(origin+'/');
    await expect(page.locator('.metric-value').first()).toHaveText('1');
    await capture(page,`painel-teste-${width}`);
    for(const [route,name,selector]of [
      ['/produtos','produtos','.table-scroll'], ['/categorias','categorias','.table-scroll'],
      ['/produtos/novo','produto-novo','.catalog-form'], ['/categorias/novo','categoria-nova','.catalog-form'],
      ['/produtos/visual-product','produto-editar','.photo-card'], ['/categorias/visual-category','categoria-editar','.catalog-form'],
      ['/financeiro','financeiro','.upcoming-badge'], ['/operacao','operacao','.upcoming-badge'], ['/configuracoes','configuracoes','.upcoming-badge'],
    ]) {
      await page.goto(origin+route,{waitUntil:'networkidle'});await page.locator(selector).first().waitFor();
      await capture(page,`${name}-teste-${width}`);
      if(route==='/produtos') {
        await page.locator('#busca').fill('nenhum-resultado');await page.getByRole('button',{name:'Filtrar',exact:true}).click();
        await expect(page.getByRole('heading',{name:'Nenhum produto encontrado'})).toBeVisible();
      }
      if(route==='/produtos/visual-product') {
        await page.getByRole('button',{name:'Ampliar foto 1'}).click();await expect(page.locator('dialog[open]')).toBeVisible();
        await page.getByRole('button',{name:'Fechar',exact:true}).click();
      }
    }
    // Escrita somente no servidor efêmero, sem persistência externa.
    await page.goto(origin+'/categorias/novo',{waitUntil:'networkidle'});
    await page.locator('#nome').fill('Categoria de teste visual');
    await page.getByRole('button',{name:'Salvar categoria'}).click();
    await page.waitForURL(/categorias\?salvo=1/);
    assert.ok(writes.some(item=>item.path==='/categorias'&&item.body.nome==='Categoria de teste visual'));
    await page.getByRole('button',{name:'Sair',exact:true}).click();await page.waitForURL(origin+'/login');
    assert.deepEqual(errors,[]);await context.close();
  }
  // Perfis existentes: a navegação continua respeitando as restrições de interface.
  for(const [token,hidden]of [['visual-accountant',['Produtos','Categorias','Operação','Configurações']],['visual-operator',['Financeiro','Configurações']]]) {
    const context=await browser.newContext();await context.addCookies([{name:'loja_session',value:token,url:origin}]);
    const page=await context.newPage();await page.goto(origin,{waitUntil:'networkidle'});
    for(const name of hidden)assert.equal(await page.locator('.sidebar-nav').getByRole('link',{name,exact:true}).count(),0);
    await context.close();
  }
  await writeFile(`${directory}/admin-validation.json`,JSON.stringify({ mode:'isolated-fixtures-only', pages:report, writesToFixture:writes.length },null,2));
  console.log(`QA administrativo aprovado: ${report.length} capturas, 5 larguras, login, navegação, filtros, formulário, galeria e perfis em ambiente isolado.`);
} finally {
  if(browser)await browser.close();
  if(server.exitCode===null){const stopped=once(server,'exit');server.kill();await stopped;}
  fixture.closeAllConnections();await new Promise(resolve=>fixture.close(resolve));
}
