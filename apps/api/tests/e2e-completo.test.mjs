import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { loadEnvFile } from "node:process";
import { chromium, expect } from "@playwright/test";
import { hash, argon2id } from "argon2";
import { createClient } from "redis";
import { createDatabase } from "@sistema/db";

loadEnvFile(new URL("../../../.env", import.meta.url));
const local = new URL(process.env.DATABASE_URL);
assert.ok(["127.0.0.1", "localhost"].includes(local.hostname));
const suffix = randomBytes(8).toString("hex");
const database = "sistema_loja_test_e2e_" + suffix;
assert.match(database, /^sistema_loja_test_e2e_[a-f0-9]{16}$/);
const url = new URL(local); url.pathname = "/" + database;
const root = createDatabase(local.toString()), db = createDatabase(url.toString());
const apiOrigin = "http://127.0.0.1:43201", adminOrigin = "http://127.0.0.1:43202", lojaOrigin = "http://127.0.0.1:43203";
const folder = new URL("../../../artifacts/e2e-complementar/", import.meta.url);
const password = randomBytes(24).toString("hex"), authPrefix = "e2e-complementar:" + suffix;
const children = [], logs = {}, coverage = [];
let browser, context, created = false;
async function stop(child) { if (child?.exitCode === null) { const closed = once(child, "exit"); child.kill(); await closed; } }
function launch(name, args, cwd, environment) {
  const child = spawn(process.execPath, args, { cwd, env: environment, stdio: ["ignore", "pipe", "pipe"] });
  logs[name] = ""; child.stdout.on("data", data => { logs[name] += data; }); child.stderr.on("data", data => { logs[name] += data; }); children.push(child); return child;
}
async function ready(child, endpoint, name) {
  const end = Date.now() + 60000;
  while (Date.now() < end) {
    assert.equal(child.exitCode, null, logs[name]);
    try { if ((await fetch(endpoint, { signal: AbortSignal.timeout(1500) })).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.fail("Não iniciou: " + name + "\n" + logs[name]);
}
async function login(page, email, senha = password) {
  await page.goto(adminOrigin + "/login");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(senha);
  const response = page.waitForResponse(r => r.url() === adminOrigin + "/api/auth/login" && r.request().method() === "POST");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  assert.equal((await response).status(), 200);
  await expect(page).toHaveURL(adminOrigin + "/", { timeout: 15000 });
}
async function settle(page) {
  await expect(page.getByRole("status").filter({ hasText: /Carregando/i })).toHaveCount(0, { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
}
async function open(page, address) {
  const response = await page.goto(address, { waitUntil: "load" });
  await settle(page);
  return response;
}
async function script(relative, environment) {
  const child = launch(relative, [fileURLToPath(new URL("../../../" + relative, import.meta.url))], new URL("../../../", import.meta.url), environment);
  const [code] = await once(child, "exit");
  assert.equal(code, 0, logs[relative]);
}

test("E2E complementar: navegação completa, usuários, formulários e loja", { timeout: 720000 }, async t => {
  await mkdir(folder, { recursive: true });
  try {
    await root.$executeRawUnsafe('CREATE DATABASE "' + database + '"'); created = true;
    const requireDb = createRequire(new URL("../../../packages/db/package.json", import.meta.url));
    execFileSync(process.execPath, [requireDb.resolve("prisma/build/index.js"), "migrate", "deploy"], { cwd: new URL("../../../packages/db/", import.meta.url), env: { ...process.env, DATABASE_URL: url.toString() }, stdio: "pipe", timeout: 60000 });
    const empresa = await db.empresa.create({ data: { nome: "Loja E2E" } });
    const admin = await db.usuario.create({ data: { empresaId: empresa.id, nome: "E2E Administrador", email: "admin-e2e@example.invalid", senhaHash: await hash(password, { type: argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 }), perfil: "ADMIN" } });
    await db.configuracaoEmpresa.create({ data: { empresaId: empresa.id, email: "atendimento-e2e@example.invalid", telefone: "(00) 00000-0000", integracoes: { mercadoPago: false, asaas: false, pagarme: false, focus: false } } });
    const categoria = await db.categoria.create({ data: { empresaId: empresa.id, nome: "Categoria E2E", nomeChave: "categoria e2e" } });
    const produto = await db.produto.create({ data: { empresaId: empresa.id, nome: "Produto E2E", descricao: "Produto exclusivamente de teste", sku: "PRODUTO-E2E", tipo: "REVENDA", unidade: "UN", precoVenda: "25.00", categoriaId: categoria.id } });
    await db.produtoComplemento.create({ data: { empresaId: empresa.id, produtoId: produto.id, slug: "produto-e2e", publicadoLoja: true } });
    const cliente = await db.cliente.create({ data: { empresaId: empresa.id, nome: "Cliente E2E" } });
    const fornecedor = await db.fornecedor.create({ data: { empresaId: empresa.id, nome: "Fornecedor E2E", cpfCnpj: "11444777000161" } });
    const servico = await db.servico.create({ data: { empresaId: empresa.id, nome: "Serviço E2E", descricao: "Somente teste", preco: "50.00", duracaoMin: 30, publicadoLoja: true } });
    const environment = { ...process.env, DATABASE_URL: url.toString(), EMPRESA_ID: empresa.id, AUTH_REDIS_PREFIX: authPrefix, API_PORT: "43201", API_INTERNAL_URL: apiOrigin, ADMIN_ORIGIN: adminOrigin, LOJA_ORIGIN: lojaOrigin, NODE_ENV: "test", MERCADO_PAGO_ACCESS_TOKEN: "", ASAAS_API_KEY: "", PAGARME_SECRET_KEY: "", FOCUS_TOKEN: "", FOCUS_TOKEN_PRODUCAO: "", RESEND_API_KEY: "", EMAIL_FROM: "", CORREIOS_USUARIO: "", CORREIOS_CODIGO_ACESSO: "" };
    const api = launch("api", ["dist/main.js"], new URL("../", import.meta.url), environment);
    await ready(api, apiOrigin + "/health/ready", "api");
    for (const [name, port] of [["admin", "43202"], ["loja", "43203"]]) {
      const req = createRequire(new URL(`../../${name}/package.json`, import.meta.url));
      const child = launch(name, [req.resolve("next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", port], new URL(`../../${name}/`, import.meta.url), { ...environment, NODE_ENV: "production" });
      await ready(child, (name === "admin" ? adminOrigin + "/login" : lojaOrigin + "/produtos"), name);
    }
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    const page = await context.newPage(), errors = [], httpErrors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("response", response => { if (response.url().startsWith(adminOrigin) && response.status() >= 500) httpErrors.push({ url: response.url(), status: response.status() }); });
    await t.test("Login: campos obrigatórios, e-mail inválido e credenciais incorretas", async () => {
      await page.goto(adminOrigin + "/produtos"); await expect(page).toHaveURL(adminOrigin + "/login");
      await page.getByLabel("E-mail", { exact: true }).fill("email-invalido");
      assert.equal(await page.locator("#email").evaluate(input => input.checkValidity()), false);
      await page.getByLabel("E-mail", { exact: true }).fill(admin.email);
      await page.getByLabel("Senha", { exact: true }).fill("senha-incorreta-de-teste");
      const response = page.waitForResponse(r => r.url().endsWith("/api/auth/login") && r.request().method() === "POST");
      await page.getByRole("button", { name: "Entrar", exact: true }).click(); assert.equal((await response).status(), 401);
      await expect(page.getByRole("main").getByRole("alert")).toBeVisible(); assert.equal(await db.sessao.count(), 0);
    });
    await t.test("Recuperação do painel: páginas abrem, confirmação diverge e token inválido é recusado", async () => {
      const recovery = await browser.newPage();
      for (const route of ["/recuperar-senha", "/redefinir-senha"]) {
        assert.equal((await recovery.goto(adminOrigin + route)).status(), 200); await expect(recovery.getByRole("heading", { level: 1 })).toBeVisible(); coverage.push({ area: "painel público", route, status: "aprovado" });
      }
      await recovery.getByLabel("Nova senha", { exact: true }).fill(password); await recovery.getByLabel("Confirme a nova senha", { exact: true }).fill("Outra-senha-invalida-E2E");
      await recovery.getByRole("button", { name: "Salvar nova senha", exact: true }).click(); await expect(recovery.getByRole("main").getByRole("alert")).toHaveText("As senhas devem ser iguais.");
      await recovery.goto(adminOrigin + "/redefinir-senha#" + "a".repeat(43)); await recovery.getByLabel("Nova senha", { exact: true }).fill(password); await recovery.getByLabel("Confirme a nova senha", { exact: true }).fill(password);
      const response = recovery.waitForResponse(r => r.url().endsWith("/api/auth/redefinir") && r.request().method() === "POST");
      await recovery.getByRole("button", { name: "Salvar nova senha", exact: true }).click(); assert.equal((await response).status(), 401); await expect(recovery.getByRole("main").getByRole("alert")).toBeVisible();
      await recovery.close();
    });
    await login(page, admin.email);
    const stock = await context.request.post(apiOrigin + `/estoque/produtos/${produto.id}/movimentos`, { headers: { origin: adminOrigin }, data: { chaveOperacao: randomUUID(), tipo: "ENTRADA", quantidade: "5", custoUnitario: "10", motivo: "Estoque somente E2E" } });
    assert.equal(stock.status(), 201, await stock.text());

    const routes = ["/", "/produtos", "/produtos/novo", `/produtos/${produto.id}`, "/categorias", "/categorias/novo", `/categorias/${categoria.id}`, "/operacao", "/clientes", "/clientes/novo", `/clientes/${cliente.id}`, "/fornecedores", "/fornecedores/novo", `/fornecedores/${fornecedor.id}`, "/estoque", `/estoque/${produto.id}`, "/estoque/alertas", "/vendas", "/vendas/nova", "/compras", "/compras/nova", "/servicos", "/servicos/novo", `/servicos/${servico.id}`, "/vouchers", "/pedidos", "/financeiro", "/financeiro/conferencia", "/financeiro/titulos/novo", "/fiscal", "/fiscal/recebidas", "/fiscal/emitidas", "/relatorios", "/configuracoes"];
    for (const route of routes) await t.test("Carregamento autenticado do painel: " + route.replaceAll(/c[a-z0-9]{20,}/g, "[id]"), async () => {
      const before = errors.length, beforeHttp = httpErrors.length;
      const response = await open(page, adminOrigin + route);
      assert.equal(response.status(), 200); await expect(page.getByRole("main").getByRole("heading", { level: 1 }).first()).toBeVisible();
      assert.equal(new URL(page.url()).pathname, route); assert.deepEqual(errors.slice(before), []);
      assert.deepEqual(httpErrors.slice(beforeHttp), []); await expect(page.getByRole("heading", { name: "Acesso restrito", exact: true })).toHaveCount(0);
      coverage.push({ area: "painel", route, status: "aprovado" });
    });
    await t.test("Navegação real pelos menus, submenu Operação e atualização", async () => {
      await page.goto(adminOrigin + "/");
      const nav = page.getByRole("navigation", { name: "Menu principal", exact: true });
      await nav.getByRole("button", { name: "Operação", exact: true }).click();
      await page.locator("#operacao-menu-desktop").getByRole("link", { name: "Clientes", exact: true }).click();
      await expect(page).toHaveURL(adminOrigin + "/clientes");
      await page.getByRole("button", { name: "Atualizar painel", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Clientes", exact: true })).toBeVisible();
    });
    await open(page, adminOrigin + "/configuracoes");
    const users = page.locator("section").filter({ has: page.getByRole("heading", { name: "Usuários e permissões", exact: true }) });
    const email = "operador-e2e@example.invalid";
    await t.test("Usuários: formulário recusa e-mail inválido sem cadastrar", async () => {
      const count = await db.usuario.count();
      await users.getByLabel("Nome do usuário", { exact: true }).fill("Operador E2E");
      await users.getByLabel("E-mail do usuário", { exact: true }).fill("invalido");
      await users.getByLabel("Senha inicial", { exact: true }).fill(password);
      assert.equal(await users.locator("form").evaluate(form => form.checkValidity()), false);
      await users.getByRole("button", { name: "Salvar usuário", exact: true }).click();
      assert.equal(await db.usuario.count(), count);
    });
    await t.test("Usuários: cria operador pelo formulário e persiste senha protegida", async () => {
      await users.getByLabel("E-mail do usuário", { exact: true }).fill(email);
      await users.getByLabel("Perfil do usuário", { exact: true }).selectOption("OPERADOR");
      const response = page.waitForResponse(r => r.url().endsWith("/administracao/usuarios") && r.request().method() === "POST");
      await users.getByRole("button", { name: "Salvar usuário", exact: true }).click(); assert.equal((await response).status(), 201);
      await expect(users.getByRole("row").filter({ hasText: email })).toContainText("Operador E2E");
      const saved = await db.usuario.findFirstOrThrow({ where: { email } }); assert.equal(saved.perfil, "OPERADOR"); assert.notEqual(saved.senhaHash, password); assert.match(saved.senhaHash, /^\$argon2id\$/);
    });
    await t.test("Usuários: duplicidade retorna conflito e mensagem de erro", async () => {
      await users.getByLabel("Nome do usuário", { exact: true }).fill("Duplicado E2E"); await users.getByLabel("E-mail do usuário", { exact: true }).fill(email); await users.getByLabel("Senha inicial", { exact: true }).fill(password);
      const response = page.waitForResponse(r => r.url().endsWith("/administracao/usuarios") && r.request().method() === "POST");
      await users.getByRole("button", { name: "Salvar usuário", exact: true }).click(); assert.equal((await response).status(), 409);
      await expect(users.getByRole("alert")).toContainText(/já existe/i); assert.equal(await db.usuario.count({ where: { email } }), 1);
    });
    const opContext = await browser.newContext(), op = await opContext.newPage();
    await t.test("Novo operador autentica e tem acesso negado às configurações e API de usuários", async () => {
      await login(op, email); await op.goto(adminOrigin + "/configuracoes");
      await expect(op.getByRole("heading", { name: "Acesso restrito", exact: true })).toBeVisible();
      assert.equal((await opContext.request.get(adminOrigin + "/api/gestao/administracao/usuarios")).status(), 403);
    });
    await t.test("Usuários: edita nome/perfil, revoga sessão e permite login como contadora", async () => {
      await users.getByRole("button", { name: "Editar Operador E2E", exact: true }).click();
      await users.getByLabel("Nome do usuário", { exact: true }).fill("Contadora E2E"); await users.getByLabel("Perfil do usuário", { exact: true }).selectOption("CONTADORA");
      const response = page.waitForResponse(r => r.url().includes("/administracao/usuarios/") && r.request().method() === "PATCH");
      await users.getByRole("button", { name: "Salvar usuário", exact: true }).click(); assert.equal((await response).status(), 200);
      await expect(users.getByRole("row").filter({ hasText: email })).toContainText("Contadora");
      assert.equal((await opContext.request.get(adminOrigin + "/api/auth/me")).status(), 401);
      await login(op, email); await op.goto(adminOrigin + "/financeiro"); await expect(op.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await op.goto(adminOrigin + "/produtos"); await expect(op.getByRole("heading", { name: "Acesso restrito", exact: true })).toBeVisible();
    });
    await t.test("Usuários: inativa o cadastro, revoga o acesso e rejeita novo login", async () => {
      await users.getByRole("button", { name: "Editar Contadora E2E", exact: true }).click(); await users.getByLabel("Usuário ativo", { exact: true }).uncheck();
      const response = page.waitForResponse(r => r.url().includes("/administracao/usuarios/") && r.request().method() === "PATCH");
      await users.getByRole("button", { name: "Salvar usuário", exact: true }).click(); assert.equal((await response).status(), 200);
      await expect(users.getByRole("row").filter({ hasText: email })).toContainText("Inativo");
      assert.equal((await opContext.request.get(adminOrigin + "/api/auth/me")).status(), 401);
      const denied = await opContext.request.post(adminOrigin + "/api/auth/login", { headers: { origin: adminOrigin }, data: { email, senha: password } }); assert.equal(denied.status(), 401);
    });
    await t.test("Usuários: bloqueia inativação do último administrador e mostra mensagem", async () => {
      await users.getByRole("button", { name: "Editar E2E Administrador", exact: true }).click(); await users.getByLabel("Usuário ativo", { exact: true }).uncheck();
      const response = page.waitForResponse(r => r.url().includes("/administracao/usuarios/") && r.request().method() === "PATCH");
      await users.getByRole("button", { name: "Salvar usuário", exact: true }).click(); assert.equal((await response).status(), 409);
      await expect(users.getByRole("alert")).toContainText("Mantenha ao menos um administrador ativo."); assert.equal((await db.usuario.findUniqueOrThrow({ where: { id: admin.id } })).ativo, true);
    });
    await opContext.close();
    const shop = await browser.newPage({ viewport: { width: 390, height: 844 } }), shopErrors = [], shopHttp = [];
    shop.on("pageerror", error => shopErrors.push(error.message));
    shop.on("response", response => { if (response.url().startsWith(lojaOrigin) && response.status() >= 500) shopHttp.push({ url: response.url(), status: response.status() }); });
    const publicRoutes = ["/", "/produtos", "/c/" + categoria.id, "/p/produto-e2e", "/servicos", "/servicos/" + servico.id, "/carrinho", "/checkout", "/entrar", "/cadastro", "/recuperar-senha", "/redefinir-senha", "/trocas", "/privacidade"];
    for (const route of publicRoutes) await t.test("Página pública e formulário no celular: " + route.replaceAll(/c[a-z0-9]{20,}/g, "[id]"), async () => {
      const before = shopErrors.length, beforeHttp = shopHttp.length;
      const response = await open(shop, lojaOrigin + route); assert.equal(response.status(), 200);
      await expect(shop.getByRole("heading", { level: 1 }).first()).toBeVisible(); await shop.evaluate(() => document.fonts.ready);
      assert.equal(await shop.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(shopErrors.slice(before), []); assert.deepEqual(shopHttp.slice(beforeHttp), []);
      coverage.push({ area: "loja", route, status: "aprovado" });
    });
    await t.test("Catálogo público: pesquisa, categoria e resultado vazio reais", async () => {
      await open(shop, lojaOrigin + "/produtos");
      await shop.getByLabel("Buscar produto", { exact: true }).fill("nada-corresponde-e2e"); await expect(shop.getByText("Nenhum produto disponível com estes filtros.", { exact: true })).toBeVisible();
      await shop.getByLabel("Buscar produto", { exact: true }).fill("Produto E2E"); await shop.getByLabel("Categoria", { exact: true }).selectOption(categoria.id); await expect(shop.getByRole("link", { name: /Produto E2E/ }).first()).toBeVisible();
      await expect(shop.getByRole("button", { name: "Anterior", exact: true })).toBeDisabled(); await expect(shop.getByRole("button", { name: "Próxima", exact: true })).toBeDisabled();
    });
    await t.test("Logo da loja retorna à página inicial HTML após navegar no catálogo", async () => {
      await open(shop, lojaOrigin + "/produtos");
      await shop.getByRole("link", { name: "Juliana Souza — início", exact: true }).first().click();
      await expect(shop).toHaveURL(lojaOrigin + "/"); await expect(shop.locator(".hero")).toBeVisible({ timeout: 15000 });
    });
    await t.test("Carrinho: adiciona, altera quantidade, persiste ao recarregar e remove", async () => {
      await open(shop, lojaOrigin + "/p/produto-e2e");
      await shop.getByRole("button", { name: "Adicionar ao carrinho", exact: true }).click(); await open(shop, lojaOrigin + "/carrinho");
      await shop.getByLabel("Quantidade de Produto E2E", { exact: true }).fill("2"); await shop.reload({ waitUntil: "load" }); await settle(shop);
      await expect(shop.getByLabel("Quantidade de Produto E2E", { exact: true })).toHaveValue("2");
      await shop.getByRole("button", { name: "Remover Produto E2E", exact: true }).click(); await expect(shop.getByText(/Seu carrinho está vazio/)).toBeVisible();
      assert.equal(await db.pedidoOnline.count(), 0);
    });
    await t.test("Checkout real permanece bloqueado com os três gateways desativados", async () => {
      await open(shop, lojaOrigin + "/p/produto-e2e"); await shop.getByRole("button", { name: "Adicionar ao carrinho", exact: true }).click();
      await open(shop, lojaOrigin + "/checkout"); await expect(shop.getByText("As opções de pagamento estão em configuração. A loja ativará as compras online após concluir essa etapa.", { exact: true })).toBeVisible();
      await expect(shop.getByRole("button", { name: "Confirmar pedido e seguir para pagamento", exact: true })).toBeDisabled(); assert.equal(await db.pedidoOnline.count(), 0);
    });
    await t.test("Rotas inexistentes e detalhes inexistentes retornam erro sem quebrar a navegação", async () => {
      assert.equal((await shop.goto(lojaOrigin + "/rota-e2e-inexistente")).status(), 404);
      await open(shop, lojaOrigin + "/p/produto-e2e-inexistente"); await expect(shop.getByRole("main").getByRole("alert")).toBeVisible();
      await shop.goto(lojaOrigin + "/produtos"); await expect(shop.getByRole("heading", { level: 1 })).toBeVisible();
    });
    await t.test("Indisponibilidade da API mostra mensagem e a página recupera após recarregar", async () => {
      await shop.route("**/api/loja/produtos**", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Indisponibilidade simulada E2E" }) }));
      await open(shop, lojaOrigin + "/produtos"); await expect(shop.getByRole("main").getByRole("alert")).toContainText("Indisponibilidade simulada E2E");
      await shop.unroute("**/api/loja/produtos**"); await shop.reload({ waitUntil: "load" }); await settle(shop); await expect(shop.getByRole("link", { name: /Produto E2E/ }).first()).toBeVisible();
    });
    await t.test("Cliente: cadastro real, consentimento, logout e novo login", async () => {
      await shop.goto(lojaOrigin + "/cadastro");
      await shop.getByLabel("Nome completo", { exact: true }).fill("Cliente Navegação E2E");
      await shop.getByLabel("CPF/CNPJ", { exact: true }).fill("52998224725");
      await shop.getByLabel("E-mail", { exact: true }).fill("cliente-e2e@example.invalid");
      await shop.getByLabel("Senha", { exact: true }).fill(password);
      await shop.getByRole("checkbox", { name: /Li as informações/ }).check();
      const response = shop.waitForResponse(r => r.url().endsWith("/api/loja/cadastro") && r.request().method() === "POST");
      await shop.getByRole("button", { name: "Criar conta", exact: true }).click(); assert.equal((await response).status(), 201);
      await expect(shop).toHaveURL(lojaOrigin + "/conta"); await expect(shop.getByText("Olá, Cliente Navegação E2E.", { exact: true })).toBeVisible();
      await shop.getByRole("button", { name: "Sair da conta", exact: true }).click(); await expect(shop).toHaveURL(lojaOrigin + "/entrar");
      assert.equal((await shop.request.get(lojaOrigin + "/api/loja/conta")).status(), 401);
      await shop.getByLabel("E-mail", { exact: true }).fill("cliente-e2e@example.invalid"); await shop.getByLabel("Senha", { exact: true }).fill(password);
      await shop.getByRole("button", { name: "Entrar", exact: true }).click(); await expect(shop).toHaveURL(lojaOrigin + "/conta");
    });
    await t.test("Cliente: encerramento exige confirmação, desativa acesso e preserva histórico", async () => {
      await shop.getByText("Encerrar minha conta", { exact: true }).click();
      await expect(shop.getByRole("button", { name: "Confirmar encerramento da conta", exact: true })).toBeDisabled();
      await shop.getByLabel("Quero encerrar minha conta.", { exact: true }).check();
      await shop.getByRole("button", { name: "Confirmar encerramento da conta", exact: true }).click(); await expect(shop).toHaveURL(lojaOrigin + "/entrar");
      assert.equal((await shop.request.get(lojaOrigin + "/api/loja/conta")).status(), 401);
      const saved = await db.contaCliente.findFirstOrThrow({ where: { email: "cliente-e2e@example.invalid" } }); assert.ok(saved.excluidaEm);
      assert.equal(await db.sessaoCliente.count({ where: { contaId: saved.id } }), 0);
      assert.ok(await db.cliente.findUnique({ where: { id: saved.clienteId } }));
      const denied = await shop.request.post(lojaOrigin + "/api/loja/login", { headers: { origin: lojaOrigin }, data: { email: "cliente-e2e@example.invalid", senha: password } }); assert.equal(denied.status(), 401);
    });
    await t.test("Visual aprovado em cinco larguras e acessos reais", async () => {
      await script("tests/storefront-html-original.mjs", { ...environment, STOREFRONT_URL: lojaOrigin, STOREFRONT_ADMIN_URL: adminOrigin });
    });
    await t.test("Três provedores preparados e nenhuma cobrança sem ativação", async () => {
      await script("tests/pagamentos-configurar-depois.mjs", { ...environment, STOREFRONT_URL: lojaOrigin });
      assert.equal(await db.pedidoOnline.count(), 0);
    });
    await t.test("Menu de operação, formulários e usuários cabem em tela de 390px", async () => {
      await page.setViewportSize({ width: 390, height: 844 }); await open(page, adminOrigin + "/configuracoes"); await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: fileURLToPath(new URL("usuarios-mobile.png", folder)), fullPage: true });
    });
    await t.test("Logout pelo botão do painel revoga sessão e bloqueia nova navegação protegida", async () => {
      await page.getByRole("button", { name: "Sair", exact: true }).click(); await expect(page).toHaveURL(adminOrigin + "/login");
      await page.goto(adminOrigin + "/clientes"); await expect(page).toHaveURL(adminOrigin + "/login");
    });
  } finally {
    await writeFile(new URL("cobertura-rotas.json", folder), JSON.stringify(coverage, null, 2));
    if (context) await context.tracing.stop({ path: fileURLToPath(new URL("navegacao.trace.zip", folder)) });
    if (browser) await browser.close();
    for (const child of children.reverse()) await stop(child);
    for (const [name, log] of Object.entries(logs)) await writeFile(new URL(name.replaceAll("/", "-") + ".log", folder), log);
    await db.$disconnect(); if (created) await root.$executeRawUnsafe('DROP DATABASE "' + database + '" WITH (FORCE)'); await root.$disconnect();
    const redis = createClient({ url: process.env.REDIS_URL }); redis.on("error", () => {});
    try { await redis.connect(); for await (const key of redis.scanIterator({ MATCH: authPrefix + "*", COUNT: 100 })) { if (key.length) await redis.del(key); } } finally { if (redis.isOpen) await redis.quit(); }
  }
});
