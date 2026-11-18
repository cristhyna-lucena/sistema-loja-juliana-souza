import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const directory = 'artifacts/imagens-html-2026-11-04';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch();
const report = [];
try {
  for (const width of [1440, 1024, 768, 390, 360]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(process.cwd() + '/output/html/Juliana-Souza-HTML-imagens-corrigidas.html').href, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      broken: [...document.images].filter(image => !image.complete || !image.naturalWidth).map(image => image.alt),
      products: [...document.querySelectorAll('.hero-product img,.product-image img,.promo-banner:first-child>img,.cat:nth-child(3) img,.mini-prod img')].map(image => {
        const css = getComputedStyle(image), rect = image.getBoundingClientRect(), box = image.parentElement.getBoundingClientRect();
        return { fit: css.objectFit, position: css.objectPosition, inside: rect.left >= box.left-1 && rect.right <= box.right+1 && rect.top >= box.top-1 && rect.bottom <= box.bottom+1 };
      }),
      headings: [...document.querySelectorAll('#site h1,#site h2')].filter(element => element.scrollWidth > element.clientWidth+1).map(element => element.textContent),
    }));
    await page.screenshot({ path: `${directory}/html-${width}.png`, fullPage: true });
    assert.equal(layout.overflow, false, JSON.stringify({ width, layout }));
    assert.deepEqual(layout.broken, [], JSON.stringify({ width, layout }));
    assert.ok(layout.products.every(image => image.fit === 'contain' && image.position === '50% 50%' && image.inside), JSON.stringify({ width, layout }));
    assert.deepEqual(layout.headings, [], JSON.stringify({ width, layout }));
    await page.locator('[data-filter="Suplementos"]').click();
    assert.equal(await page.locator('.card').count(), 1);
    await page.locator('.card .pinkbtn').click();
    await page.locator('.modal.active').waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.modal.active').count(), 0);
    await page.locator('#btnDash').click();
    await page.locator('.dashboard.visible').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${directory}/html-gestao-${width}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    report.push({ width, ...layout, errors });
    await page.close();
  }
  await writeFile(`${directory}/html-validation.json`, JSON.stringify(report, null, 2));
  console.log('HTML único aprovado nas cinco larguras: imagens, filtros, modal e troca para gestão.');
} finally { await browser.close(); }
