import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { loadEnvFile } from "node:process";
import { createDatabase } from "@sistema/db";
import { hash, verify, argon2id } from "argon2";
import { createClient } from "redis";
import { createInitialAdmin } from "../dist/auth/bootstrap-admin.js";
loadEnvFile(new URL("../../../.env", import.meta.url));
const url = new URL(process.env.DATABASE_URL);
assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname === "/sistema_loja", "Os testes exigem o banco local sistema_loja.");
const db = createDatabase(process.env.DATABASE_URL);
const origin = "http://127.0.0.1:43139";
const base = "http://127.0.0.1:43137";
const prefix = "sistema-loja:test-auth:" + randomUUID();
const password = randomBytes(24).toString("hex");
const empresas = [randomUUID(), randomUUID(), randomUUID()];
const users = {};
let child;
let output = "";
const call = (route, { cookie, body, originHeader = origin, method = body ? "POST" : "GET" } = {}) => fetch(base + route, { method, headers: { ...(cookie ? { cookie } : {}), ...(method === "POST" ? { origin: originHeader, "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
const login = async (email, senha = password, cookie) => call("/auth/login", { body: { email, senha }, cookie });
const cookieOf = response => response.headers.get("set-cookie")?.split(";")[0];
test("Autenticação e permissões com banco, Redis e navegador reais", { timeout: 180000 }, async t => {
  try {
    const senhaHash = await hash(password, { type: argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
    assert.ok(senhaHash.startsWith("$argon2id$"));
    assert.ok(await verify(senhaHash, password));
    for (const id of empresas) await db.empresa.create({ data: { id, nome: "Teste de autenticação" } });
    for (const perfil of ["ADMIN", "CONTADORA", "OPERADOR"]) users[perfil] = await db.usuario.create({ data: { empresaId: empresas[0], nome: "Teste " + perfil, email: randomUUID() + "@example.invalid", senhaHash, perfil } });
    users.inativo = await db.usuario.create({ data: { empresaId: empresas[0], nome: "Inativo", email: randomUUID() + "@example.invalid", senhaHash, perfil: "OPERADOR", ativo: false } });
    users.ui = await db.usuario.create({ data: { empresaId: empresas[0], nome: "Administrador de teste", email: randomUUID() + "@example.invalid", senhaHash, perfil: "ADMIN" } });
    users.outro = await db.usuario.create({ data: { empresaId: empresas[1], nome: "Outra empresa", email: randomUUID() + "@example.invalid", senhaHash, perfil: "ADMIN" } });
    child = spawn(process.execPath, ["dist/main.js"], { env: { ...process.env, API_PORT: "43137", ADMIN_ORIGIN: origin, EMPRESA_ID: empresas[0], AUTH_REDIS_PREFIX: prefix, NODE_ENV: "test" }, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", data => output += data); child.stderr.on("data", data => output += data);
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) assert.fail("API encerrou: " + output);
      try { const response = await call("/health/ready"); if (response.ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.ok(ready, "API não iniciou: " + output);
    await t.test("Primeiro administrador: hash forte, auditoria e bloqueio de duplicação", async () => {
      const input = { empresaId: empresas[2], nomeEmpresa: "Teste", nome: "Administrador", email: randomUUID() + "@example.invalid", senha: password };
      const created = await createInitialAdmin(db, input);
      const user = await db.usuario.findUniqueOrThrow({ where: { id: created.id } });
      assert.equal(user.perfil, "ADMIN");
      assert.ok(await verify(user.senhaHash, password));
      assert.ok(user.senhaHash.startsWith("$argon2id$"));
      assert.equal(await db.auditLog.count({ where: { empresaId: empresas[2], acao: "CRIAR_ADMIN_INICIAL" } }), 1);
      await assert.rejects(createInitialAdmin(db, { ...input, email: randomUUID() + "@example.invalid" }), /Já existe administrador/);
      await assert.rejects(createInitialAdmin(db, { ...input, senha: "curta" }), /12 e 128/);
      assert.equal(await db.usuario.count({ where: { empresaId: empresas[2] } }), 1);
    });
    await t.test("Rejeita ausência de sessão, token falso e dados inválidos", async () => {
      assert.equal((await call("/auth/me")).status, 401);
      assert.equal((await call("/auth/me", { cookie: "loja_session=" + randomBytes(32).toString("base64url") })).status, 401);
      assert.equal((await login("invalido")).status, 400);
      assert.equal((await login(users.ADMIN.email, "incorreta")).status, 401);
      assert.equal((await login(randomUUID() + "@example.invalid")).status, 401);
    });
    await t.test("Rejeita origem externa e não cria sessão", async () => {
      const before = await db.sessao.count({ where: { empresaId: empresas[0] } });
      assert.equal((await call("/auth/login", { body: { email: users.ADMIN.email, senha: password }, originHeader: "https://externo.invalid" })).status, 403);
      assert.equal(await db.sessao.count({ where: { empresaId: empresas[0] } }), before);
    });
    await t.test("Rejeita usuário inativo e credencial de outra empresa", async () => {
      assert.equal((await login(users.inativo.email)).status, 401);
      assert.equal((await login(users.outro.email)).status, 401);
    });
    let adminCookie;
    await t.test("Login emite cookie protegido e grava apenas hash da sessão", async () => {
      const response = await login("  " + users.ADMIN.email.toUpperCase() + "  ");
      assert.equal(response.status, 200);
      assert.match(response.headers.get("set-cookie"), /HttpOnly/i);
      assert.match(response.headers.get("set-cookie"), /SameSite=Lax/i);
      assert.match(response.headers.get("set-cookie"), /Path=\//i);
      assert.match(response.headers.get("set-cookie"), /Max-Age=28800/i);
      adminCookie = cookieOf(response);
      const result = await response.json();
      assert.equal(result.usuario.perfil, "ADMIN");
      assert.equal(result.usuario.empresaId, empresas[0]);
      assert.equal(result.usuario.senhaHash, undefined);
      const raw = adminCookie.slice(adminCookie.indexOf("=") + 1);
      const session = await db.sessao.findUniqueOrThrow({ where: { tokenHash: createHash("sha256").update(raw).digest("hex") } });
      assert.notEqual(session.tokenHash, raw);
      assert.equal((await call("/auth/me", { cookie: adminCookie })).status, 200);
    });
    await t.test("Permissões: administrador, contadora e operador", async () => {
      for (const [perfil, expected] of [["ADMIN", [200,200,200]], ["CONTADORA", [403,200,403]], ["OPERADOR", [403,403,200]]]) {
        const response = perfil === "ADMIN" ? null : await login(users[perfil].email);
        if (response) assert.equal(response.status, 200);
        const cookie = perfil === "ADMIN" ? adminCookie : cookieOf(response);
        for (const [i, area] of ["configuracoes", "financeiro", "operacao"].entries()) assert.equal((await call("/acesso/" + area, { cookie })).status, expected[i], perfil + ":" + area);
      }
    });
    await t.test("Desativação do usuário invalida acesso imediatamente", async () => {
      await db.usuario.update({ where: { id: users.ADMIN.id }, data: { ativo: false } });
      assert.equal((await call("/auth/me", { cookie: adminCookie })).status, 401);
      await db.usuario.update({ where: { id: users.ADMIN.id }, data: { ativo: true } });
    });
    await t.test("Expiração é verificada pelo servidor", async () => {
      const response = await login(users.ADMIN.email);
      const cookie = cookieOf(response);
      const raw = cookie.slice(cookie.indexOf("=") + 1);
      await db.sessao.update({ where: { tokenHash: createHash("sha256").update(raw).digest("hex") }, data: { expiresAt: new Date(Date.now() - 1000) } });
      assert.equal((await call("/auth/me", { cookie })).status, 401);
    });
    await t.test("Novo login troca o token e revoga a sessão anterior", async () => {
      const response = await login(users.ADMIN.email, password, adminCookie);
      assert.equal(response.status, 200);
      assert.equal((await call("/auth/me", { cookie: adminCookie })).status, 401);
      adminCookie = cookieOf(response);
    });
    await t.test("Logout exige origem válida e revoga a sessão", async () => {
      assert.equal((await call("/auth/logout", { method: "POST", cookie: adminCookie, originHeader: "https://externo.invalid" })).status, 403);
      assert.equal((await call("/auth/me", { cookie: adminCookie })).status, 200);
      const response = await call("/auth/logout", { method: "POST", cookie: adminCookie });
      assert.equal(response.status, 204);
      assert.match(response.headers.get("set-cookie"), /Expires=Thu, 01 Jan 1970/i);
      assert.equal((await call("/auth/me", { cookie: adminCookie })).status, 401);
      assert.equal((await call("/auth/logout", { method: "POST", cookie: adminCookie })).status, 204);
    });
    await t.test("Limite de tentativas responde 429", async () => {
      const email = randomUUID() + "@example.invalid";
      for (let i = 0; i < 5; i++) assert.equal((await login(email, "incorreta")).status, 401);
      assert.equal((await login(email, "incorreta")).status, 429);
    });
    await t.test("Navegador: login, persistência, logout, permissões e tela móvel", async () => {
      const require = createRequire(new URL("../../admin/package.json", import.meta.url));
      const frontend = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", "43139"], { cwd: new URL("../../admin/", import.meta.url), env: { ...process.env, API_INTERNAL_URL: base, ADMIN_ORIGIN: origin, NODE_ENV: "production" }, stdio: ["ignore", "pipe", "pipe"] });
      let browser;
      let logs = "";
      frontend.stdout.on("data", data => logs += data); frontend.stderr.on("data", data => logs += data);
      try {
        let ready = false;
        for (let i = 0; i < 100; i++) {
          if (frontend.exitCode !== null) assert.fail("Painel encerrou: " + logs);
          try { if ((await fetch(origin + "/login")).ok) { ready = true; break; } } catch {}
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        assert.ok(ready, "Painel não iniciou: " + logs);
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        const artifacts = new URL("../../../artifacts/", import.meta.url);
        await mkdir(artifacts, { recursive: true });
        await page.goto(origin);
        await expect(page).toHaveURL(origin + "/login");
        await expect(page.getByRole("heading", { name: "Entre no painel" })).toBeVisible();
        await page.screenshot({ path: fileURLToPath(new URL("login-desktop.png", artifacts)), fullPage: true });
        await page.getByLabel("Senha", { exact: true }).fill("teste-visual");
        await page.getByRole("button", { name: "Mostrar senha", exact: true }).click();
        await expect(page.getByLabel("Senha", { exact: true })).toHaveAttribute("type", "text");
        await page.getByRole("button", { name: "Ocultar senha", exact: true }).click();
        await expect(page.getByLabel("Senha", { exact: true })).toHaveAttribute("type", "password");
        await page.getByLabel("E-mail").fill(users.ui.email);
        await page.getByLabel("Senha", { exact: true }).fill("senha-incorreta");
        await page.getByRole("button", { name: "Entrar", exact: true }).click();
        await expect(page.getByText("E-mail ou senha inválidos.", { exact: true })).toBeVisible();
        await page.getByLabel("Senha", { exact: true }).fill(password);
        await page.getByRole("button", { name: "Entrar", exact: true }).click();
        await expect(page.getByRole("heading", { name: "Bem-vindo, Administrador!", exact: true })).toBeVisible({ timeout: 15000 });
        await expect(page.getByRole("link", { name: "Início", exact: true })).toHaveAttribute("aria-current", "page");
        const expectedCounts = await Promise.all([
          db.produto.count({ where: { empresaId: empresas[0] } }),
          db.produto.count({ where: { empresaId: empresas[0], ativo: true } }),
          db.categoria.count({ where: { empresaId: empresas[0] } }),
        ]);
        assert.deepEqual(await page.locator(".metric-value").allTextContents(), expectedCounts.map(String));
        await page.reload();
        await expect(page.getByRole("heading", { name: "Bem-vindo, Administrador!", exact: true })).toBeVisible({ timeout: 15000 });
        assert.ok((await page.context().cookies()).some(cookie => cookie.name === "loja_session" && cookie.httpOnly));
        assert.ok(!(await page.evaluate(() => document.cookie)).includes("loja_session"));
        await page.screenshot({ path: fileURLToPath(new URL("painel-admin.png", artifacts)), fullPage: true });
        await page.getByRole("button", { name: "Sair", exact: true }).click();
        await expect(page).toHaveURL(origin + "/login");
        assert.equal((await page.request.get(origin + "/api/auth/me")).status(), 401);
        await page.goto(origin);
        await expect(page).toHaveURL(origin + "/login");
        await page.getByLabel("E-mail").fill(users.CONTADORA.email);
        await page.getByLabel("Senha", { exact: true }).fill(password);
        await page.getByRole("button", { name: "Entrar", exact: true }).click();
        await expect(page.getByRole("heading", { name: "Bem-vindo, Teste!", exact: true })).toBeVisible({ timeout: 15000 });
        await expect(page.getByRole("link", { name: "Configurações", exact: true })).toHaveCount(0);
        await page.goto(origin + "/operacao");
        await expect(page.getByRole("heading", { name: "Acesso restrito" })).toBeVisible();
        await page.getByRole("link", { name: "Financeiro", exact: true }).click();
        await expect(page.getByRole("heading", { name: "Financeiro", exact: true })).toBeVisible();
        const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
        await mobile.goto(origin + "/login");
        await expect(mobile.getByRole("button", { name: "Entrar", exact: true })).toBeVisible();
        assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
        await mobile.screenshot({ path: fileURLToPath(new URL("login-mobile.png", artifacts)), fullPage: true });
        assert.deepEqual(errors, []);
      } finally {
        if (browser) await browser.close();
        if (frontend.exitCode === null) { const closed = once(frontend, "exit"); frontend.kill(); await closed; }
      }
    });
    await t.test("Produção: cookie Secure, HttpOnly e prefixo __Host", async () => {
      const secureOrigin = "https://admin.example.invalid";
      const server = spawn(process.execPath, ["dist/main.js"], { env: { ...process.env, API_PORT: "43138", ADMIN_ORIGIN: secureOrigin, EMPRESA_ID: empresas[0], AUTH_REDIS_PREFIX: prefix, NODE_ENV: "production" }, stdio: ["ignore", "pipe", "pipe"] });
      let logs = "";
      server.stdout.on("data", data => logs += data); server.stderr.on("data", data => logs += data);
      try {
        let ready = false;
        for (let i = 0; i < 100; i++) {
          if (server.exitCode !== null) assert.fail("API de produção encerrou: " + logs);
          try { if ((await fetch("http://127.0.0.1:43138/health/ready")).ok) { ready = true; break; } } catch {}
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        assert.ok(ready, "API de produção não iniciou: " + logs);
        const response = await fetch("http://127.0.0.1:43138/auth/login", { method: "POST", headers: { origin: secureOrigin, "content-type": "application/json" }, body: JSON.stringify({ email: users.ui.email, senha: password }) });
        assert.equal(response.status, 200);
        const cookie = response.headers.get("set-cookie");
        assert.match(cookie, /^__Host-loja_session=/);
        assert.match(cookie, /; Secure/i);
        assert.match(cookie, /; HttpOnly/i);
        assert.ok(!/; Domain=/i.test(cookie));
      } finally { if (server.exitCode === null) { const closed = once(server, "exit"); server.kill(); await closed; } }
    });
    await t.test("Desenvolvimento: API inicia pelo executor TypeScript", async () => {
      const require = createRequire(import.meta.url);
      const server = spawn(process.execPath, [require.resolve("tsx/cli"), "src/main.ts"], { env: { ...process.env, API_PORT: "43140", ADMIN_ORIGIN: origin, EMPRESA_ID: empresas[0], AUTH_REDIS_PREFIX: prefix, NODE_ENV: "development" }, stdio: ["ignore", "pipe", "pipe"] });
      let logs = "";
      server.stdout.on("data", data => logs += data); server.stderr.on("data", data => logs += data);
      try {
        let ready = false;
        for (let i = 0; i < 100; i++) {
          if (server.exitCode !== null) assert.fail("API de desenvolvimento encerrou: " + logs);
          try { if ((await fetch("http://127.0.0.1:43140/health/ready")).ok) { ready = true; break; } } catch {}
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        assert.ok(ready, "API de desenvolvimento não iniciou: " + logs);
        assert.equal((await fetch("http://127.0.0.1:43140/auth/me")).status, 401);
      } finally { if (server.exitCode === null) { const closed = once(server, "exit"); server.kill(); await closed; } }
    });
    await t.test("Auditoria registra login e logout sem senha ou token", async () => {
      const logs = await db.auditLog.findMany({ where: { empresaId: empresas[0] } });
      assert.ok(logs.some(log => log.acao === "LOGIN"));
      assert.ok(logs.some(log => log.acao === "LOGOUT"));
      assert.ok(logs.every(log => JSON.stringify(log.dados) === "{}"));
    });
  } finally {
    if (child && child.exitCode === null) { const closed = once(child, "exit"); child.kill(); await closed; }
    await db.sessao.deleteMany({ where: { empresaId: { in: empresas } } });
    await db.auditLog.deleteMany({ where: { empresaId: { in: empresas } } });
    await db.usuario.deleteMany({ where: { empresaId: { in: empresas } } });
    await db.empresa.deleteMany({ where: { id: { in: empresas } } });
    await db.$disconnect();
    const redis = createClient({ url: process.env.REDIS_URL, socket: { reconnectStrategy: false } });
    redis.on("error", () => {});
    try { await redis.connect(); for await (const keys of redis.scanIterator({ MATCH: prefix + ":*", COUNT: 100 })) { if (keys.length) await redis.del(keys); } }
    finally { if (redis.isOpen) await redis.quit(); }
  }
});
