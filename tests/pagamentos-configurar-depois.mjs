import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const providers = [
    { codigo: "MERCADO_PAGO", nome: "Mercado Pago", disponivel: false },
    { codigo: "ASAAS", nome: "Asaas", disponivel: false },
    { codigo: "PAGARME", nome: "Pagar.me", disponivel: false },
  ];
  let cobranças = 0;
  await page.route("**/api/loja/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    let data;
    if (path.endsWith("/configuracao")) data = { gateways: providers };
    else if (path.endsWith("/produtos/produto-qa"))
      data = {
        id: "produtoqa",
        slug: "produto-qa",
        nome: "Produto QA",
        preco: "10.00",
        disponivel: "5.000",
        imagens: [],
      };
    else if (path.endsWith("/checkout")) {
      cobranças++;
      data = {};
    } else data = {};
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  });
  await page.addInitScript(() =>
    localStorage.setItem(
      "juliana-souza-carrinho",
      JSON.stringify([
        {
          produtoId: "produtoqa",
          slug: "produto-qa",
          nome: "Produto QA",
          quantidade: 1,
        },
      ]),
    ),
  );
  await page.goto((process.env.STOREFRONT_URL || "http://127.0.0.1:3000") + "/checkout", {
    waitUntil: "load",
  });
  await expect(
    page.getByText(
      "As opções de pagamento estão em configuração. A loja ativará as compras online após concluir essa etapa.",
      { exact: true },
    ),
  ).toBeVisible();
  const options = await page
    .getByLabel("Provedor de pagamento", { exact: true })
    .locator("option")
    .allTextContents();
  for (const provider of providers)
    assert.ok(options.includes(provider.nome + " · Em configuração"));
  await expect(
    page.getByRole("button", {
      name: "Confirmar pedido e seguir para pagamento",
      exact: true,
    }),
  ).toBeDisabled();
  assert.equal(cobranças, 0);
  await page.evaluate(() => document.fonts.ready);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  console.log(
    "Os três provedores continuam visíveis para configuração posterior, com cobrança bloqueada enquanto não ativados.",
  );
} finally {
  await browser.close();
}
