import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const directory = 'artifacts/html-original-aplicado';
await mkdir(directory, { recursive: true });
const original = 'references/loja/Juliana-Souza-Atualizacao-Original-3.html';
assert.ok((await readFile(original, 'utf8')).includes('Beleza que'));
const browser = await chromium.launch({ headless: true });
const base = process.env.STOREFRONT_URL || 'http://127.0.0.1:3000';
const adminBase = process.env.STOREFRONT_ADMIN_URL || 'http://127.0.0.1:3001';
async function geometry(page) {
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => { image.loading = 'eager'; return image.decode().catch(() => {}); })); });
  return page.evaluate(() => Object.fromEntries(['.top-strip','.store-header','.hero','.hero h1','.hero-products','.categories'].map(selector => {
    const element = document.querySelector(selector), rect = element.getBoundingClientRect(), css = getComputedStyle(element);
    return [selector, { x:rect.x, y:rect.y, width:rect.width, height:rect.height, font:css.font, color:css.color }];
  })));
}
try {
  for (const width of [1440, 1024, 768, 390, 360]) {
    const reference = await browser.newPage({ viewport: { width, height:950 } });
    await reference.route('https://**/*', route => route.abort());
    await reference.goto(pathToFileURL(original).href);
    const expected = await geometry(reference);
    const page = await browser.newPage({ viewport: { width, height:950 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base, { waitUntil:'load' });
    assert.deepEqual(await geometry(page), expected, 'O HTML aplicado deve manter a composição original em ' + width);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path:`${directory}/loja-${width}.png`, fullPage:true });
    if (width === 1440) await reference.screenshot({ path:`${directory}/referencia-${width}.png`, fullPage:true });
    await page.locator('[data-action="cart"]').first().click();
    await expect(page).toHaveURL(base + '/carrinho');
    await expect(page.getByRole('heading', {name:'Carrinho',exact:true})).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.goto(base + '/entrar', { waitUntil:'load' });
    await expect(page.getByRole('heading', { name:'Entrar na sua conta',exact:true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path:`${directory}/conta-${width}.png`, fullPage:true });
    if (width < 761) {
      await page.getByRole('button', {name:'Abrir menu',exact:true}).click();
      await expect(page.locator('#shop-navigation').getByRole('link', {name:'Minha conta',exact:true})).toBeVisible();
    }
    await page.goto(base);
    if (width === 1440) {
      await page.locator('[data-action="account"]').first().click();
      await expect(page).toHaveURL(base + '/conta');
      await page.goto(base);
      await page.locator('#adminMode').click();
      await expect(page).toHaveURL(adminBase + '/login');
    }
    assert.deepEqual(errors, []);
    await reference.close(); await page.close();
  }
  console.log('HTML original: composição idêntica em cinco larguras, navegação real e ausência de transbordamento aprovadas.');
} finally { await browser.close(); }
