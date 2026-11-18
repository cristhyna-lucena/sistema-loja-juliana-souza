import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { loadEnvFile } from "node:process";
import { chromium, expect } from "@playwright/test";
import { createDatabase } from "@sistema/db";
import { ComercialService } from "../dist/comercial/comercial.service.js";
import { FinanceiroService } from "../dist/comercial/financeiro.service.js";
import { VendasService } from "../dist/comercial/vendas.service.js";
import { EstoqueService } from "../dist/gestao/estoque.service.js";
import { ServicosService } from "../dist/operacoes/servicos.service.js";
import { FiscalService } from "../dist/operacoes/fiscal.service.js";
import { LojaService } from "../dist/loja/loja.service.js";
import { dataLoja } from "../dist/gestao/data-loja.js";

loadEnvFile(new URL("../../../.env", import.meta.url));
const local = new URL(process.env.DATABASE_URL);
assert.ok(["127.0.0.1", "localhost"].includes(local.hostname));
const name = "sistema_loja_test_operacoes_ui_" + randomBytes(8).toString("hex"),
  url = new URL(local);
url.pathname = "/" + name;
const root = createDatabase(local.toString()),
  db = createDatabase(url.toString());
const base = "http://127.0.0.1:43187",
  adminOrigin = "http://127.0.0.1:43189",
  lojaOrigin = "http://127.0.0.1:43190";
async function stop(child) {
  if (child && child.exitCode === null) {
    const done = once(child, "exit");
    child.kill();
    await done;
  }
}
async function ready(child, endpoint, logs) {
  const end = Date.now() + 60000;
  while (Date.now() < end) {
    if (child.exitCode !== null) assert.fail(logs());
    try {
      if ((await fetch(endpoint, { signal: AbortSignal.timeout(1000) })).ok)
        return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.fail(logs());
}

test(
  "Painel e loja: compras, serviços, fiscal, configuração e checkout reais no navegador",
  { timeout: 420000 },
  async (t) => {
    let created = false,
      api,
      admin,
      loja,
      browser;
    const oldCompany = process.env.EMPRESA_ID;
    try {
      await root.$executeRawUnsafe('CREATE DATABASE "' + name + '"');
      created = true;
      const requireDb = createRequire(
        new URL("../../../packages/db/package.json", import.meta.url),
      );
      execFileSync(
        process.execPath,
        [requireDb.resolve("prisma/build/index.js"), "migrate", "deploy"],
        {
          cwd: new URL("../../../packages/db/", import.meta.url),
          env: { ...process.env, DATABASE_URL: url.toString() },
          stdio: "pipe",
          timeout: 60000,
        },
      );
      const empresa = await db.empresa.create({
        data: { nome: "Loja QA", cnpj: "11222333000181" },
      });
      process.env.EMPRESA_ID = empresa.id;
      const usuario = await db.usuario.create({
        data: {
          empresaId: empresa.id,
          nome: "Administrador QA",
          email: "admin@example.invalid",
          senhaHash: "nao-utilizada",
          perfil: "ADMIN",
        },
      });
      const token = randomBytes(32).toString("base64url");
      await db.sessao.create({
        data: {
          empresaId: empresa.id,
          usuarioId: usuario.id,
          tokenHash: createHash("sha256").update(token).digest("hex"),
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      const caixa = await db.contaFinanceira.create({
          data: {
            empresaId: empresa.id,
            nome: "Caixa UI",
            nomeChave: "caixa ui",
            tipo: "CAIXA",
          },
        }),
        banco = await db.contaFinanceira.create({
          data: {
            empresaId: empresa.id,
            nome: "Banco UI",
            nomeChave: "banco ui",
            tipo: "BANCO",
          },
        });
      await db.configuracaoEmpresa.create({
        data: {
          empresaId: empresa.id,
          contaOnlineId: banco.id,
          freteGratisAtivo: true,
          integracoes: {
            mercadoPago: true,
            asaas: false,
            pagarme: false,
            focus: false,
          },
        },
      });
      const fornecedor = await db.fornecedor.create({
        data: {
          empresaId: empresa.id,
          nome: "Fornecedor UI",
          cpfCnpj: "11444777000161",
        },
      });
      const produto = await db.produto.create({
        data: {
          empresaId: empresa.id,
          nome: "Creme UI",
          sku: "CREME-UI",
          unidade: "UN",
          tipo: "AMBOS",
          precoVenda: "19.90",
          custoCompra: "4",
        },
      });
      await db.produtoComplemento.create({
        data: {
          empresaId: empresa.id,
          produtoId: produto.id,
          slug: "creme-ui",
          publicadoLoja: true,
        },
      });
      const environment = {
        ...process.env,
        DATABASE_URL: url.toString(),
        API_PORT: "43187",
        ADMIN_ORIGIN: adminOrigin,
        LOJA_ORIGIN: lojaOrigin,
        API_INTERNAL_URL: base,
        MERCADO_PAGO_ACCESS_TOKEN: "token-ficticio-sem-chamadas-externas",
        RESEND_API_KEY: "token-ficticio-sem-envio",
        EMAIL_FROM: "teste@example.invalid",
        AUTH_REDIS_PREFIX: "test-operacoes-ui:" + randomUUID(),
        NODE_ENV: "test",
      };
      let apiLogs = "",
        adminLogs = "",
        lojaLogs = "";
      api = spawn(process.execPath, ["dist/main.js"], {
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
      });
      api.stdout.on("data", (value) => (apiLogs += value));
      api.stderr.on("data", (value) => (apiLogs += value));
      await ready(api, base + "/health/ready", () => apiLogs);
      const inicial = await fetch(
        base + "/estoque/produtos/" + produto.id + "/movimentos",
        {
          method: "POST",
          headers: {
            cookie: "loja_session=" + token,
            origin: adminOrigin,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            chaveOperacao: randomUUID(),
            tipo: "ENTRADA",
            quantidade: "10",
            custoUnitario: "4",
            motivo: "Saldo inicial do teste",
          }),
        },
      );
      assert.equal(inicial.status, 201, await inicial.text());
      const requireAdmin = createRequire(
          new URL("../../admin/package.json", import.meta.url),
        ),
        requireLoja = createRequire(
          new URL("../../loja/package.json", import.meta.url),
        );
      admin = spawn(
        process.execPath,
        [
          requireAdmin.resolve("next/dist/bin/next"),
          "start",
          "--hostname",
          "127.0.0.1",
          "--port",
          "43189",
        ],
        {
          cwd: new URL("../../admin/", import.meta.url),
          env: { ...environment, NODE_ENV: "production" },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      admin.stdout.on("data", (value) => (adminLogs += value));
      admin.stderr.on("data", (value) => (adminLogs += value));
      loja = spawn(
        process.execPath,
        [
          requireLoja.resolve("next/dist/bin/next"),
          "start",
          "--hostname",
          "127.0.0.1",
          "--port",
          "43190",
        ],
        {
          cwd: new URL("../../loja/", import.meta.url),
          env: { ...environment, NODE_ENV: "production" },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      loja.stdout.on("data", (value) => (lojaLogs += value));
      loja.stderr.on("data", (value) => (lojaLogs += value));
      await Promise.all([
        ready(admin, adminOrigin + "/login", () => adminLogs),
        ready(loja, lojaOrigin + "/produtos", () => lojaLogs),
      ]);
      browser = await chromium.launch({ headless: true });
      const adm = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      });
      await adm.addCookies([
        { name: "loja_session", value: token, url: adminOrigin },
      ]);
      const panel = await adm.newPage(),
        errors = [];
      panel.on("pageerror", (error) => errors.push(error.message));
      const folder = new URL(
        "../../../artifacts/etapas-finais/",
        import.meta.url,
      );
      await mkdir(folder, { recursive: true });
      await t.test(
        "Compras no painel atualizam estoque e parcelas",
        async () => {
          await panel.goto(adminOrigin + "/compras/nova");
          await panel
            .getByLabel("Buscar produto", { exact: true })
            .fill(produto.sku);
          await panel
            .getByRole("button", { name: "Buscar produtos", exact: true })
            .click();
          await panel
            .getByRole("button", { name: "Adicionar Creme UI", exact: true })
            .click();
          await panel
            .getByLabel("Fornecedor", { exact: true })
            .selectOption(fornecedor.id);
          await panel
            .getByLabel("Número do documento", { exact: true })
            .fill("COMPRA-UI-1");
          await panel
            .getByLabel("Valor da parcela 1 (R$)", { exact: true })
            .fill("4");
          await panel
            .getByRole("button", { name: "Confirmar compra", exact: true })
            .click();
          await expect(
            panel.getByRole("heading", {
              name: "Compra COMPRA-UI-1",
              exact: true,
            }),
          ).toBeVisible({ timeout: 15000 });
          assert.equal(await db.compra.count(), 1);
          await panel.screenshot({
            path: fileURLToPath(new URL("compra-desktop.png", folder)),
            fullPage: true,
          });
        },
      );
      await t.test(
        "Cadastro de serviço e publicação ficam disponíveis na loja",
        async () => {
          await panel.goto(adminOrigin + "/servicos/novo");
          await panel.getByLabel("Nome", { exact: true }).fill("Hidratação UI");
          await panel.getByLabel("Preço (R$)", { exact: true }).fill("60");
          await panel
            .getByLabel("Publicar serviço na loja", { exact: true })
            .check();
          await panel
            .getByLabel("Buscar insumo", { exact: true })
            .fill(produto.sku);
          await panel
            .getByRole("button", { name: "Buscar insumos", exact: true })
            .click();
          await panel
            .getByRole("button", { name: "Adicionar Creme UI", exact: true })
            .click();
          await panel
            .getByRole("button", { name: "Salvar serviço", exact: true })
            .click();
          await expect(
            panel.getByRole("heading", { name: "Serviços", exact: true }),
          ).toBeVisible();
          assert.equal(
            await db.servico.count({ where: { publicadoLoja: true } }),
            1,
          );
        },
      );
      await t.test(
        "Configurações, financeiro e relatórios funcionam pelo painel",
        async () => {
          await panel.goto(adminOrigin + "/configuracoes");
          await expect(
            panel.getByLabel("Razão social", { exact: true }),
          ).toBeVisible();
          await panel
            .getByLabel("Razão social", { exact: true })
            .fill("Loja QA LTDA");
          await panel
            .getByRole("button", { name: "Salvar configurações", exact: true })
            .click();
          await expect(
            panel.getByText("Configurações salvas.", { exact: true }),
          ).toBeVisible();
          await panel.goto(adminOrigin + "/financeiro/conferencia");
          await panel
            .getByLabel("Conta de origem", { exact: true })
            .selectOption(caixa.id);
          await panel
            .getByLabel("Conta de destino", { exact: true })
            .selectOption(banco.id);
          await panel
            .getByLabel("Valor da transferência (R$)", { exact: true })
            .fill("1");
          await panel
            .getByLabel("Motivo", { exact: true })
            .fill("Transferência de teste do navegador");
          await panel
            .getByRole("button", {
              name: "Registrar transferência",
              exact: true,
            })
            .click();
          await expect(
            panel.getByText("Transferência registrada.", { exact: true }),
          ).toBeVisible();
          await panel.goto(adminOrigin + "/relatorios");
          await expect(
            panel.getByRole("heading", {
              name: "Caixa realizado por dia",
              exact: true,
            }),
          ).toBeVisible();
        },
      );
      await t.test(
        "XML recebido permite de-para e entrada sem digitar todos os itens",
        async () => {
          const chaveNfe = "35261111444777000161550010000009001000000001";
          const xml = `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe${chaveNfe}"><ide><nNF>900</nNF><dhEmi>${dataLoja()}T10:00:00-04:00</dhEmi></ide><emit><CNPJ>11444777000161</CNPJ><xNome>Fornecedor UI</xNome></emit><dest><CNPJ>11222333000181</CNPJ></dest><det nItem="1"><prod><cProd>CREME-UI</cProd><xProd>Creme UI</xProd><NCM>33049990</NCM><uCom>UN</uCom><qCom>2.0000</qCom><vUnCom>4.0000</vUnCom><vProd>8.00</vProd></prod></det><total><ICMSTot><vProd>8.00</vProd><vFrete>0.00</vFrete><vDesc>0.00</vDesc><vNF>8.00</vNF></ICMSTot></total><cobr><dup><vDup>8.00</vDup><dVenc>${dataLoja()}</dVenc></dup></cobr></infNFe></NFe><protNFe><infProt><chNFe>${chaveNfe}</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>`;
          await panel.goto(adminOrigin + "/fiscal/recebidas");
          await panel
            .getByLabel("Arquivo XML completo", { exact: true })
            .setInputFiles({
              name: "nota.xml",
              mimeType: "application/xml",
              buffer: Buffer.from(xml),
            });
          await panel
            .getByRole("button", { name: "Importar XML", exact: true })
            .click();
          await expect(
            panel.getByText(
              "XML importado. Confira os itens antes de dar entrada.",
              { exact: true },
            ),
          ).toBeVisible();
          await panel.getByRole("link", { name: "900", exact: true }).click();
          await panel
            .getByRole("link", {
              name: "Conferir produtos e dar entrada",
              exact: true,
            })
            .click();
          await expect(
            panel.getByLabel("Produto do estoque", { exact: true }),
          ).toHaveValue(produto.id);
          await panel
            .getByRole("button", { name: "Confirmar compra", exact: true })
            .click();
          await expect(
            panel.getByRole("heading", { name: "Compra 900", exact: true }),
          ).toBeVisible();
          assert.equal(await db.compra.count(), 2);
        },
      );
      const clienteContext = await browser.newContext({
          viewport: { width: 1280, height: 900 },
        }),
        page = await clienteContext.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await t.test(
        "Cliente cria conta, compra e reenvia após perda de resposta sem duplicar pedido",
        async () => {
          await page.goto(lojaOrigin + "/cadastro");
          await page
            .getByLabel("Nome completo", { exact: true })
            .fill("Cliente UI");
          await page
            .getByLabel("CPF/CNPJ", { exact: true })
            .fill("52998224725");
          await page
            .getByLabel("E-mail", { exact: true })
            .fill("cliente-ui@example.invalid");
          await page
            .getByLabel("Senha", { exact: true })
            .fill("Senha-ficticia-para-testes-2026");
          await page
            .getByRole("checkbox", { name: /Li as informações/ })
            .check();
          await page
            .getByRole("button", { name: "Criar conta", exact: true })
            .click();
          await expect(
            page.getByRole("heading", { name: "Minha conta", exact: true }),
          ).toBeVisible();
          await page.goto(lojaOrigin + "/p/creme-ui");
          await page.getByLabel("Quantidade", { exact: true }).fill("2");
          await page
            .getByRole("button", { name: "Adicionar ao carrinho", exact: true })
            .click();
          await page
            .getByRole("link", { name: "Ver carrinho", exact: true })
            .click();
          await page
            .getByRole("link", { name: "Continuar para checkout", exact: true })
            .click();
          await expect(page).toHaveURL(lojaOrigin + "/checkout");
          await expect(
            page.getByRole("heading", {
              name: "Finalizar pedido",
              exact: true,
            }),
          ).toBeVisible();
          await page.route("**/api/loja/cep/01001000", (route) =>
            route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({
                cep: "01001000",
                logradouro: "Praça da Sé",
                bairro: "Sé",
                cidade: "São Paulo",
                uf: "SP",
                codigoIbge: "3550308",
              }),
            }),
          );
          await page.getByLabel("CEP", { exact: true }).fill("01001000");
          await page.getByLabel("Número", { exact: true }).fill("100");
          await expect(page.getByLabel("Cidade", { exact: true })).toHaveValue(
            "São Paulo",
          );
          await page
            .getByRole("button", { name: "Calcular frete", exact: true })
            .click();
          await expect(
            page.getByLabel("Opção de entrega", { exact: true }),
          ).toBeVisible();
          let lost = false;
          await page.route("**/api/loja/checkout", async (route) => {
            if (lost) {
              await route.continue();
              return;
            }
            lost = true;
            const response = await route.fetch();
            assert.equal(response.status(), 201);
            await route.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({
                message: "Resposta perdida para testar reenvio.",
              }),
            });
          });
          await page
            .getByRole("button", {
              name: "Confirmar pedido e seguir para pagamento",
              exact: true,
            })
            .click();
          await expect(
            page.getByRole("button", { name: "Reenviar pedido", exact: true }),
          ).toBeVisible();
          await page
            .getByRole("button", { name: "Reenviar pedido", exact: true })
            .click();
          await expect(
            page.getByRole("heading", { name: "Pedido 1", exact: true }),
          ).toBeVisible();
          assert.equal(await db.pedidoOnline.count(), 1);
          const pedido = await db.pedidoOnline.findFirstOrThrow(),
            database = { client: db },
            comercial = new ComercialService(database),
            financeiro = new FinanceiroService(database, comercial),
            estoque = new EstoqueService(database),
            vendas = new VendasService(
              database,
              comercial,
              estoque,
              financeiro,
            ),
            servicos = new ServicosService(
              database,
              comercial,
              estoque,
              financeiro,
            ),
            fiscal = new FiscalService(database, comercial);
          const lojaService = new LojaService(
            database,
            { limitar: async () => {} },
            estoque,
            comercial,
            vendas,
            servicos,
            financeiro,
            fiscal,
          );
          await lojaService.confirmarPagamento("MERCADO_PAGO", {
            id: "PAY-UI-1",
            referencia: pedido.id,
            pago: true,
            estornado: false,
            valor: pedido.total.toFixed(2),
            moeda: "BRL",
            forma: "PIX",
          });
          await expect(
            page
              .getByRole("status")
              .filter({ hasText: "Pagamento confirmado" }),
          ).toBeVisible({ timeout: 15000 });
          await page.screenshot({
            path: fileURLToPath(new URL("pedido-loja-desktop.png", folder)),
            fullPage: true,
          });
          const mobile = await clienteContext.newPage();
          await mobile.setViewportSize({ width: 390, height: 844 });
          await mobile.goto(lojaOrigin + "/conta");
          await expect(
            mobile.getByRole("heading", { name: "Minha conta", exact: true }),
          ).toBeVisible();
          await expect(
            mobile.getByRole("link", { name: /^Pedido \d+$/ }),
          ).toBeVisible();
          assert.ok(
            await mobile.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          );
          await mobile.screenshot({
            path: fileURLToPath(new URL("conta-loja-mobile.png", folder)),
            fullPage: true,
          });
        },
      );
      await t.test(
        "Permissões, origem e webhooks rejeitam requisições inválidas",
        async () => {
          assert.equal(
            (
              await fetch(base + "/webhooks/pagamento/ASAAS", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: "fake", payment: { id: "fake" } }),
              })
            ).status,
            403,
          );
          assert.equal(
            (
              await fetch(base + "/webhooks/focus", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ref: "fake" }),
              })
            ).status,
            403,
          );
          assert.equal(
            (
              await page.request.post(lojaOrigin + "/api/loja/checkout", {
                headers: { origin: "https://externo.invalid" },
                data: {},
              })
            ).status(),
            403,
          );
          assert.equal(
            (
              await panel.request.get(
                adminOrigin +
                  "/api/gestao/relatorios?de=" +
                  dataLoja() +
                  "&ate=" +
                  dataLoja(),
              )
            ).status(),
            200,
          );
          assert.deepEqual(errors, []);
        },
      );
      await t.test(
        "Recuperação de senha usa token único e revoga sessões do painel e cliente",
        async () => {
          for (const fluxo of [
            {
              request: panel.request,
              origin: adminOrigin,
              prefix: "/api/auth",
              email: usuario.email,
              me: "/api/auth/me",
            },
            {
              request: clienteContext.request,
              origin: lojaOrigin,
              prefix: "/api/loja",
              email: "cliente-ui@example.invalid",
              me: "/api/loja/conta",
            },
          ]) {
            const recuperar = await fluxo.request.post(
              fluxo.origin + fluxo.prefix + "/recuperar",
              {
                headers: { origin: fluxo.origin },
                data: { email: fluxo.email },
              },
            );
            assert.equal(recuperar.status(), 200);
            const desconhecido = await fluxo.request.post(
              fluxo.origin + fluxo.prefix + "/recuperar",
              {
                headers: { origin: fluxo.origin },
                data: { email: "ausente@example.invalid" },
              },
            );
            assert.deepEqual(await desconhecido.json(), await recuperar.json());
            const job = await db.integracaoJob.findFirstOrThrow({
              where: {
                empresaId: empresa.id,
                tipo: "EMAIL",
                payload: { path: ["para"], equals: fluxo.email },
              },
              orderBy: { createdAt: "desc" },
            });
            const tokenRecuperacao =
              job.payload.texto.match(/#([A-Za-z0-9_-]{43})/)[1];
            const data = {
              token: tokenRecuperacao,
              senha: randomBytes(20).toString("hex"),
            };
            const redefinir = await fluxo.request.post(
              fluxo.origin + fluxo.prefix + "/redefinir",
              { headers: { origin: fluxo.origin }, data },
            );
            assert.equal(redefinir.status(), 200);
            assert.equal(
              (await fluxo.request.get(fluxo.origin + fluxo.me)).status(),
              401,
            );
            assert.equal(
              (
                await fluxo.request.post(
                  fluxo.origin + fluxo.prefix + "/redefinir",
                  { headers: { origin: fluxo.origin }, data },
                )
              ).status(),
              401,
            );
          }
        },
      );
    } finally {
      if (browser) await browser.close();
      await stop(loja);
      await stop(admin);
      await stop(api);
      if (oldCompany === undefined) delete process.env.EMPRESA_ID;
      else process.env.EMPRESA_ID = oldCompany;
      await db.$disconnect();
      if (created)
        await root.$executeRawUnsafe(
          'DROP DATABASE "' + name + '" WITH (FORCE)',
        );
      await root.$disconnect();
    }
  },
);
