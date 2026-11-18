import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "node:process";
import { chromium, expect } from "@playwright/test";
import { createDatabase } from "@sistema/db";
import { hash, argon2id } from "argon2";
import { createClient } from "redis";
import { CatalogoService } from "../dist/catalogo/catalogo.service.js";
loadEnvFile(new URL("../../../.env", import.meta.url));
const localUrl = new URL(process.env.DATABASE_URL);
assert.ok(["127.0.0.1", "localhost"].includes(localUrl.hostname) && localUrl.pathname === "/sistema_loja", "A suíte exige o banco local sistema_loja.");
const name = "sistema_loja_test_catalogo_" + randomBytes(8).toString("hex");
assert.match(name, /^sistema_loja_test_catalogo_[a-f0-9]{16}$/);
const testUrl = new URL(localUrl); testUrl.pathname = "/" + name;
const rootDb = createDatabase(localUrl.toString());
const db = createDatabase(testUrl.toString());
const prefix = "sistema-loja:test-catalogo:" + randomUUID();
const origin = "http://127.0.0.1:43149";
const base = "http://127.0.0.1:43147";
const password = randomBytes(24).toString("hex");
const companies = [randomUUID(), randomUUID()];
const users = {};
const cookies = {};
let server;
let created = false;
const request = (route, { cookie = cookies.ADMIN, method = "GET", body, originHeader = origin } = {}) => fetch(base + route, { method, headers: { ...(cookie ? { cookie } : {}), "Content-Type": "application/json", ...(method !== "GET" ? { origin: originHeader } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const payload = { nome: "Sérum facial", descricao: "Descrição do produto.", sku: "serum-01", tipo: "REVENDA", unidade: "UN", precoVenda: "129,90", categoriaId: null, ativo: true };
async function waitReady(child, url, logs) {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) assert.fail("Servidor encerrou: " + logs());
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.fail("Servidor não iniciou: " + logs());
}
async function stop(child) { if (child && child.exitCode === null) { const closed = once(child, "exit"); child.kill(); await closed; } }
test("Catálogo: banco isolado, API e navegador", { timeout: 240000 }, async t => {
  try {
    await rootDb.$executeRawUnsafe('CREATE DATABASE "' + name + '"'); created = true;
    const requireDb = createRequire(new URL("../../../packages/db/package.json", import.meta.url));
    execFileSync(process.execPath, [requireDb.resolve("prisma/build/index.js"), "migrate", "deploy"], { cwd: new URL("../../../packages/db/", import.meta.url), env: { ...process.env, DATABASE_URL: testUrl.toString() }, stdio: "pipe", timeout: 60000 });
    const senhaHash = await hash(password, { type: argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
    for (const id of companies) await db.empresa.create({ data: { id, nome: "Empresa de teste do catálogo" } });
    for (const perfil of ["ADMIN", "CONTADORA", "OPERADOR"]) users[perfil] = await db.usuario.create({ data: { empresaId: companies[0], nome: "Teste " + perfil, email: randomUUID() + "@example.invalid", senhaHash, perfil } });
    const externalCategory = await db.categoria.create({ data: { empresaId: companies[1], nome: "Categoria externa", nomeChave: "categoria externa" } });
    const externalProduct = await db.produto.create({ data: { ...payload, sku: "SERUM-01", precoVenda: "9.99", empresaId: companies[1], categoriaId: externalCategory.id } });
    let logs = "";
    server = spawn(process.execPath, ["dist/main.js"], { env: { ...process.env, DATABASE_URL: testUrl.toString(), API_PORT: "43147", EMPRESA_ID: companies[0], ADMIN_ORIGIN: origin, AUTH_REDIS_PREFIX: prefix, NODE_ENV: "test" }, stdio: ["ignore", "pipe", "pipe"] });
    server.stdout.on("data", data => logs += data); server.stderr.on("data", data => logs += data);
    await waitReady(server, base + "/health/ready", () => logs);
    for (const perfil of ["ADMIN", "CONTADORA", "OPERADOR"]) {
      const response = await request("/auth/login", { method: "POST", cookie: "", body: { email: users[perfil].email, senha: password } });
      assert.equal(response.status, 200); cookies[perfil] = response.headers.get("set-cookie").split(";")[0];
    }
    let category;
    let product;
    await t.test("Permissões e proteção de origem", async () => {
      assert.equal((await request("/produtos", { cookie: "" })).status, 401);
      for (const route of ["/produtos", "/categorias", "/categorias/opcoes"]) assert.equal((await request(route, { cookie: cookies.CONTADORA })).status, 403);
      assert.equal((await request("/categorias", { method: "POST", cookie: cookies.CONTADORA, body: { nome: "Negada", ativa: true } })).status, 403);
      assert.equal((await request("/categorias", { method: "POST", originHeader: "https://externo.invalid", body: { nome: "Negada", ativa: true } })).status, 403);
    });
    await t.test("Categorias: criação, normalização, busca e paginação", async () => {
      const response = await request("/categorias", { method: "POST", body: { nome: "  Séruns  ", ativa: true } });
      assert.equal(response.status, 201); category = await response.json(); assert.equal(category.nome, "Séruns");
      assert.equal((await request("/categorias", { method: "POST", body: { nome: "SÉRUNS", ativa: true } })).status, 409);
      assert.equal((await request("/categorias", { method: "POST", body: { nome: "   ", ativa: true } })).status, 400);
      assert.equal((await request("/categorias", { method: "POST", cookie: cookies.OPERADOR, body: { nome: "Corpo", ativa: true } })).status, 201);
      const list = await (await request("/categorias?pageSize=1&page=2")).json();
      assert.equal(list.total, 2); assert.equal(list.itens.length, 1); assert.equal(list.page, 2); assert.equal(list.pages, 2);
      assert.equal((await (await request("/categorias?q=s%C3%A9runs")).json()).total, 1);
    });
    await t.test("Produto: cadastro, preço exato e SKU normalizado", async () => {
      const response = await request("/produtos", { method: "POST", body: { ...payload, categoriaId: category.id } });
      assert.equal(response.status, 201); product = await response.json();
      assert.equal(product.sku, "SERUM-01"); assert.equal(product.precoVenda, "129.90"); assert.equal(product.categoria.nome, "Séruns");
      const saved = await db.produto.findUniqueOrThrow({ where: { id: product.id } });
      assert.equal(saved.precoVenda.toFixed(2), "129.90"); assert.equal(saved.empresaId, companies[0]);
    });
    await t.test("Rejeita preço inválido, SKU duplicado e campos indevidos sem gravar", async () => {
      const before = await db.produto.count({ where: { empresaId: companies[0] } });
      const audits = await db.auditLog.count({ where: { empresaId: companies[0], entidade: "Produto" } });
      for (const precoVenda of ["-1.00", "1.001", "10000000000.00", "NaN", 12.5]) assert.equal((await request("/produtos", { method: "POST", body: { ...payload, sku: randomUUID(), precoVenda } })).status, 400);
      assert.equal((await request("/produtos", { method: "POST", body: payload })).status, 409);
      assert.equal((await request("/produtos", { method: "POST", body: { ...payload, sku: "", nome: " " } })).status, 400);
      assert.equal((await request("/produtos", { method: "POST", body: { ...payload, sku: "INJECTION", empresaId: companies[1] } })).status, 400);
      assert.equal(await db.produto.count({ where: { empresaId: companies[0] } }), before);
      assert.equal(await db.auditLog.count({ where: { empresaId: companies[0], entidade: "Produto" } }), audits);
    });
    await t.test("Isolamento entre empresas e categoria estrangeira", async () => {
      assert.equal((await request("/produtos/" + externalProduct.id)).status, 404);
      assert.equal((await request("/categorias/" + externalCategory.id)).status, 404);
      assert.equal((await request("/produtos/" + externalProduct.id, { method: "PATCH", body: { ativo: false, versao: 1 } })).status, 404);
      assert.equal((await request("/produtos", { method: "POST", body: { ...payload, sku: "FOREIGN", categoriaId: externalCategory.id } })).status, 400);
      const list = await (await request("/produtos")).json(); assert.ok(list.itens.every(item => item.id !== externalProduct.id));
      const options = await (await request("/categorias/opcoes")).json(); assert.ok(options.every(item => item.id !== externalCategory.id));
      await assert.rejects(db.produto.create({ data: { ...payload, precoVenda: "129.90", sku: "FOREIGN_DB", empresaId: companies[0], categoriaId: externalCategory.id } }), error => error.code === "P2003");
    });
    await t.test("Banco rejeita preço negativo mesmo fora da API", async () => {
      await assert.rejects(db.produto.create({ data: { ...payload, empresaId: companies[0], sku: "NEGATIVE_DB", precoVenda: "-0.01" } }));
      assert.equal(await db.produto.count({ where: { empresaId: companies[0], sku: "NEGATIVE_DB" } }), 0);
    });
    await t.test("Edição protege contra sobrescrita e preserva os centavos", async () => {
      const response = await request("/produtos/" + product.id, { method: "PATCH", body: { nome: "Sérum atualizado", precoVenda: "0,10", versao: product.versao } });
      assert.equal(response.status, 200); const changed = await response.json(); assert.equal(changed.precoVenda, "0.10"); assert.equal(changed.versao, product.versao + 1);
      const stale = await request("/produtos/" + product.id, { method: "PATCH", body: { nome: "Obsoleto", versao: product.versao } });
      assert.equal(stale.status, 409); assert.equal((await stale.json()).code, "CONCURRENT_EDIT"); product = changed;
      const concurrent = await Promise.all(["Edição A", "Edição B"].map(nome => request("/produtos/" + product.id, { method: "PATCH", body: { nome, versao: product.versao } })));
      assert.deepEqual(concurrent.map(response => response.status).sort(), [200, 409]);
      product = await (await request("/produtos/" + product.id)).json();
    });
    await t.test("Ativação e filtros por status, nome e SKU", async () => {
      const response = await request("/produtos/" + product.id, { method: "PATCH", cookie: cookies.OPERADOR, body: { ativo: false, versao: product.versao } });
      assert.equal(response.status, 200); product = await response.json();
      assert.equal((await (await request("/produtos?status=ativos")).json()).total, 0);
      assert.equal((await (await request("/produtos?status=inativos&q=serum-01")).json()).total, 1);
      assert.equal((await request("/produtos?page=0")).status, 400);
      assert.equal((await request("/produtos?pageSize=101")).status, 400);
      const restored = await request("/produtos/" + product.id, { method: "PATCH", body: { ativo: true, versao: product.versao } });
      assert.equal(restored.status, 200); product = await restored.json();
    });
    await t.test("Categoria inativa impede novos vínculos e edição exige versão atual", async () => {
      const response = await request("/categorias/" + category.id, { method: "PATCH", body: { ativa: false, versao: category.versao } });
      assert.equal(response.status, 200); const inactive = await response.json();
      assert.equal((await request("/categorias/" + category.id, { method: "PATCH", body: { nome: "Obsoleto", versao: category.versao } })).status, 409);
      assert.equal((await request("/produtos", { method: "POST", body: { ...payload, sku: "INACTIVE", categoriaId: category.id } })).status, 400);
      const edit = await request("/produtos/" + product.id, { method: "PATCH", body: { descricao: "Vínculo anterior preservado.", categoriaId: category.id, versao: product.versao } });
      assert.equal(edit.status, 200); product = await edit.json();
      const restored = await request("/categorias/" + category.id, { method: "PATCH", body: { ativa: true, nome: "Séruns faciais", versao: inactive.versao } });
      assert.equal(restored.status, 200); category = await restored.json();
    });
    await t.test("Falha da auditoria desfaz o cadastro completo", async () => {
      const service = new CatalogoService({ client: db });
      await assert.rejects(service.criarProduto({ id: randomUUID(), empresaId: companies[0], nome: "Ator ausente", perfil: "ADMIN" }, { ...payload, sku: "ROLLBACK", precoVenda: "1.00" }));
      assert.equal(await db.produto.count({ where: { empresaId: companies[0], sku: "ROLLBACK" } }), 0);
      const logs = await db.auditLog.findMany({ where: { empresaId: companies[0], entidade: "Produto" } });
      assert.ok(logs.some(log => log.acao === "CRIAR" && log.dados.depois.sku === "SERUM-01"));
      assert.ok(logs.some(log => log.acao === "EDITAR" && log.dados.antes && log.dados.depois));
    });
    await t.test("Navegador: cadastrar, editar, pesquisar e verificar permissões no celular", async () => {
      const requireAdmin = createRequire(new URL("../../admin/package.json", import.meta.url));
      const front = spawn(process.execPath, [requireAdmin.resolve("next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", "43149"], { cwd: new URL("../../admin/", import.meta.url), env: { ...process.env, API_INTERNAL_URL: base, ADMIN_ORIGIN: origin, NODE_ENV: "production" }, stdio: ["ignore", "pipe", "pipe"] });
      let logs = ""; front.stdout.on("data", data => logs += data); front.stderr.on("data", data => logs += data);
      let browser;
      try {
        await waitReady(front, origin + "/login", () => logs);
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        const errors = []; page.on("pageerror", error => errors.push(error.message));
        const signIn = async (page, role) => {
          await page.goto(origin + "/login");
          await page.getByLabel("E-mail").fill(users[role].email); await page.getByLabel("Senha", { exact: true }).fill(password);
          const loginResponse = page.waitForResponse(response => response.url() === origin + "/api/auth/login" && response.request().method() === "POST");
          await page.getByRole("button", { name: "Entrar", exact: true }).click();
          assert.equal((await loginResponse).status(), 200);
          await expect(page.getByRole("heading", { level: 1, name: "Bem-vindo, Teste!", exact: true })).toBeVisible({ timeout: 15000 });
        };
        await page.goto(origin + "/produtos"); await expect(page).toHaveURL(origin + "/login");
        await signIn(page, "ADMIN");
        await page.getByRole("link", { name: "Categorias", exact: true }).click();
        await page.getByRole("link", { name: "Nova categoria", exact: true }).click();
        await page.getByLabel("Nome", { exact: true }).fill("Cuidados faciais UI");
        await page.getByRole("button", { name: "Salvar categoria", exact: true }).click();
        await expect(page.getByRole("status").filter({ hasText: "Cadastro salvo com sucesso." })).toBeVisible();
        await page.getByRole("link", { name: "Produtos", exact: true }).click();
        await page.getByRole("link", { name: "Novo produto", exact: true }).click();
        await page.getByLabel("Nome", { exact: true }).fill("Produto do navegador");
        await page.getByLabel("SKU", { exact: true }).fill("ui-001");
        await page.getByLabel("Preço de venda (R$)", { exact: true }).fill("89,90");
        await page.getByLabel("Categoria", { exact: true }).selectOption({ label: "Cuidados faciais UI" });
        await page.getByLabel("Descrição", { exact: true }).fill("Cadastro feito no teste completo do navegador.");
        await page.getByRole("button", { name: "Salvar produto", exact: true }).click();
        await expect(page.getByRole("row").filter({ hasText: "Produto do navegador" })).toContainText("89,90");
        await page.getByRole("link", { name: "Editar Produto do navegador", exact: true }).click();
        await expect(page.getByLabel("SKU", { exact: true })).toHaveValue("UI-001");
        await page.getByLabel("Nome", { exact: true }).fill("Produto editado UI");
        await page.getByLabel("Preço de venda (R$)", { exact: true }).fill("99,99");
        await page.getByLabel("Produto ativo", { exact: true }).uncheck();
        await page.getByRole("button", { name: "Salvar produto", exact: true }).click();
        await expect(page.getByRole("row").filter({ hasText: "Produto editado UI" })).toContainText("Inativo");
        await page.getByLabel("Buscar produto").fill("ui-001");
        await page.getByLabel("Status", { exact: true }).selectOption("inativos");
        await page.getByRole("button", { name: "Filtrar", exact: true }).click();
        await expect(page.getByRole("row").filter({ hasText: "Produto editado UI" })).toContainText("99,99");
        const artifacts = new URL("../../../artifacts/", import.meta.url); await mkdir(artifacts, { recursive: true });
        await page.screenshot({ path: fileURLToPath(new URL("catalogo-produtos.png", artifacts)), fullPage: true });
        await page.getByRole("link", { name: "Editar Produto editado UI", exact: true }).click();
        await expect(page.getByLabel("Preço de venda (R$)", { exact: true })).toHaveValue("99,99");
        await page.screenshot({ path: fileURLToPath(new URL("catalogo-formulario.png", artifacts)), fullPage: true });
        await page.getByLabel("SKU", { exact: true }).fill("SERUM-01");
        await page.getByRole("button", { name: "Salvar produto", exact: true }).click();
        await expect(page.getByRole("alert").filter({ hasText: "SKU já cadastrado" })).toBeVisible();
        await page.getByLabel("SKU", { exact: true }).fill("UI-001");
        await page.getByLabel("Produto ativo", { exact: true }).check();
        await page.getByRole("button", { name: "Salvar produto", exact: true }).click();
        await expect(page.getByRole("row").filter({ hasText: "Produto editado UI" })).toContainText("Ativo");
        const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await signIn(mobile, "OPERADOR"); await mobile.getByRole("link", { name: "Produtos", exact: true }).click();
        await expect(mobile.getByRole("heading", { name: "Produtos", exact: true })).toBeVisible();
        await expect(mobile.getByRole("link", { name: "Editar Produto editado UI", exact: true })).toBeVisible();
        assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
        await mobile.screenshot({ path: fileURLToPath(new URL("catalogo-mobile.png", artifacts)), fullPage: true });
        const accountant = await browser.newPage(); await signIn(accountant, "CONTADORA");
        await expect(accountant.getByRole("link", { name: "Produtos", exact: true })).toHaveCount(0);
        await accountant.goto(origin + "/produtos"); await expect(accountant.getByRole("heading", { name: "Acesso restrito" })).toBeVisible();
        const denied = await accountant.request.post(origin + "/api/catalogo/produtos", { headers: { origin }, data: { ...payload, sku: "FORBIDDEN_UI" } }); assert.equal(denied.status(), 403);
        assert.equal(await db.produto.count({ where: { sku: "FORBIDDEN_UI" } }), 0);
        assert.deepEqual(errors, []);
      } finally { if (browser) await browser.close(); await stop(front); }
    });
  } finally {
    await stop(server);
    await db.$disconnect();
    if (created) await rootDb.$executeRawUnsafe('DROP DATABASE "' + name + '" WITH (FORCE)');
    await rootDb.$disconnect();
    const redis = createClient({ url: process.env.REDIS_URL, socket: { reconnectStrategy: false } }); redis.on("error", () => {});
    try { await redis.connect(); for await (const keys of redis.scanIterator({ MATCH: prefix + ":*", COUNT: 100 })) { if (keys.length) await redis.del(keys); } }
    finally { if (redis.isOpen) await redis.quit(); }
  }
});
