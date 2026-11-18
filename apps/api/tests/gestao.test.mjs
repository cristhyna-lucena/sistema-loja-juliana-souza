import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { loadEnvFile } from "node:process";
import { createDatabase } from "@sistema/db";
import { createClient } from "redis";
import { EstoqueService } from "../dist/gestao/estoque.service.js";
import { CadastrosService } from "../dist/gestao/cadastros.service.js";
import { AlertasEstoqueService } from "../dist/gestao/alertas-estoque.service.js";
import { alertasEstoqueSchema } from "@sistema/shared";
loadEnvFile(new URL("../../../.env", import.meta.url));
const local = new URL(process.env.DATABASE_URL);
assert.ok(["localhost", "127.0.0.1"].includes(local.hostname) && local.pathname === "/sistema_loja");
const name = "sistema_loja_test_gestao_" + randomBytes(8).toString("hex");
const testUrl = new URL(local); testUrl.pathname = "/" + name;
const root = createDatabase(local.toString()), db = createDatabase(testUrl.toString());
const origin = "http://127.0.0.1:43169", base = "http://127.0.0.1:43167";
const prefix = "sistema-loja:test-gestao:" + randomUUID();
const cookies = {};
const bodyMov = (overrides = {}) => ({ tipo: "ENTRADA", quantidade: "10.125", motivo: "Saldo inicial conferido", chaveOperacao: randomUUID(), ...overrides });
const request = (route, { method = "GET", body, cookie = cookies.ADMIN, originHeader = origin } = {}) => fetch(base + route, { method, headers: { cookie: cookie ?? "", "Content-Type": "application/json", origin: originHeader }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
async function json(route, options, expected = 201) { const r = await request(route, options); const data = await r.json(); assert.equal(r.status, expected, JSON.stringify(data)); return data; }
test("Gestão: API e regras de estoque em PostgreSQL isolado", { timeout: 300000 }, async t => {
  let created = false, server;
  try {
    await root.$executeRawUnsafe('CREATE DATABASE "' + name + '"'); created = true;
    const requireDb = createRequire(new URL("../../../packages/db/package.json", import.meta.url));
    execFileSync(process.execPath, [requireDb.resolve("prisma/build/index.js"), "migrate", "deploy"], { cwd: new URL("../../../packages/db/", import.meta.url), env: { ...process.env, DATABASE_URL: testUrl.toString() }, stdio: "pipe", timeout: 60000 });
    const empresa = await db.empresa.create({ data: { nome: "Teste gestão" } });
    const externa = await db.empresa.create({ data: { nome: "Outra empresa" } });
    const users = {};
    for (const perfil of ["ADMIN", "OPERADOR", "CONTADORA"]) {
      users[perfil] = await db.usuario.create({ data: { empresaId: empresa.id, nome: perfil, email: perfil + "@example.invalid", senhaHash: "nao-utilizada", perfil } });
      const token = randomBytes(32).toString("base64url");
      await db.sessao.create({ data: { empresaId: empresa.id, usuarioId: users[perfil].id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3600000) } });
      cookies[perfil] = "loja_session=" + token;
    }
    const produtoData = { nome: "Produto de teste", sku: "TESTE", unidade: "ML", precoVenda: "10.00" };
    const produto = await db.produto.create({ data: { ...produtoData, empresaId: empresa.id } });
    const outroProduto = await db.produto.create({ data: { ...produtoData, sku: "OUTRO", empresaId: empresa.id } });
    const produtoExterno = await db.produto.create({ data: { ...produtoData, empresaId: externa.id } });
    const clienteExterno = await db.cliente.create({ data: { nome: "Externo", empresaId: externa.id } });
    const loteExterno = await db.lote.create({ data: { empresaId: externa.id, produtoId: produtoExterno.id, numero: "EXT" } });
    const loteOutro = await db.lote.create({ data: { empresaId: empresa.id, produtoId: outroProduto.id, numero: "OUTRO" } });
    const path = "/estoque/produtos/" + produto.id;
    const user = { ...users.ADMIN, empresa: empresa.nome };
    let logs = "";
    server = spawn(process.execPath, ["dist/main.js"], { env: { ...process.env, DATABASE_URL: testUrl.toString(), API_PORT: "43167", EMPRESA_ID: empresa.id, ADMIN_ORIGIN: origin, AUTH_REDIS_PREFIX: prefix, NODE_ENV: "test" }, stdio: ["ignore", "pipe", "pipe"] });
    server.stdout.on("data", v => logs += v); server.stderr.on("data", v => logs += v);
    let ready = false, readiness = "";
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      if (server.exitCode !== null) assert.fail(logs);
      try { const response = await fetch(base + "/health/ready", { signal: AbortSignal.timeout(1500) }); if (response.ok) { ready = true; break; } readiness = response.status + ": " + await response.text(); } catch (error) { readiness = String(error) + " " + String(error.cause); }
      await new Promise(r => setTimeout(r, 200));
    }
    assert.ok(ready, readiness + "\n" + logs);
    await t.test("Autenticação, permissões, origem e campos desconhecidos", async () => {
      for (const route of ["/clientes", "/fornecedores", path + "/saldo"]) {
        assert.equal((await request(route, { cookie: "" })).status, 401);
        assert.equal((await request(route, { cookie: cookies.CONTADORA })).status, 403);
        assert.equal((await request(route, { cookie: cookies.OPERADOR })).status, 200);
      }
      assert.equal((await request("/clientes", { method: "POST", originHeader: "https://externo.invalid", body: { nome: "Teste" } })).status, 403);
      assert.equal((await request("/clientes", { method: "POST", body: { nome: "Teste", empresaId: externa.id } })).status, 400);
      assert.equal((await request("/clientes?campoIndevido=1")).status, 400);
    });
    await t.test("Cadastros: documentos, duplicidade, pesquisa e conflito de edição", async () => {
      const cliente = await json("/clientes", { method: "POST", body: { nome: "  Maria  Souza ", cpfCnpj: "529.982.247-25" } });
      assert.equal(cliente.nome, "Maria Souza"); assert.equal(cliente.cpfCnpj, "52998224725");
      await json("/clientes", { method: "POST", body: { nome: "Duplicada", cpfCnpj: "52998224725" } }, 409);
      for (const cpfCnpj of ["11111111111", "52998224724", "123"]) await json("/clientes", { method: "POST", body: { nome: "Inválido", cpfCnpj } }, 400);
      await json("/fornecedores", { method: "POST", body: { nome: "Sem documento" } }, 400);
      const fornecedor = await json("/fornecedores", { method: "POST", body: { nome: "Fornecedor", cpfCnpj: "11.222.333/0001-81" } });
      await json("/fornecedores", { method: "POST", body: { nome: "Alfanumérico", cpfCnpj: "12.ABC.345/01DE-35" } });
      await json("/fornecedores/" + fornecedor.id, { method: "PATCH", body: { versao: 1, cpfCnpj: null } }, 400);
      const editado = await json("/clientes/" + cliente.id, { method: "PATCH", body: { versao: 1, ativo: false } }, 200);
      assert.equal(editado.versao, 2);
      assert.equal(editado.cpfCnpj, "52998224725");
      await json("/clientes/" + cliente.id, { method: "PATCH", body: { versao: 2 } }, 400);
      const renomeado = await json("/clientes/" + cliente.id, { method: "PATCH", body: { versao: 2, nome: "Maria atualizada" } }, 200);
      assert.equal(renomeado.ativo, false); assert.equal(renomeado.cpfCnpj, "52998224725");
      await json("/clientes/" + cliente.id, { method: "PATCH", body: { versao: 1, nome: "Antigo" } }, 409);
      const lista = await json("/clientes?status=inativos&q=Maria&pageSize=1", {}, 200);
      assert.equal(lista.total, 1); assert.equal(lista.itens[0].id, cliente.id);
      await json("/clientes/" + clienteExterno.id, {}, 404);
      await json("/clientes/" + clienteExterno.id, { method: "PATCH", body: { versao: 1, ativo: false } }, 404);
    });
    let lote, entrada;
    await t.test("Lotes: unicidade, data válida e vínculo restrito ao produto/empresa", async () => {
      lote = await json(path + "/lotes", { method: "POST", body: { numero: " lote-01 ", validade: "2027-02-28" } });
      assert.equal(lote.numero, "LOTE-01"); assert.equal(lote.validade, "2027-02-28");
      await json(path + "/lotes", { method: "POST", body: { numero: "LOTE-01" } }, 409);
      await json(path + "/lotes", { method: "POST", body: { numero: "Data inválida", validade: "2027-02-30" } }, 400);
      for (const loteId of [loteExterno.id, loteOutro.id]) await json(path + "/movimentos", { method: "POST", body: bodyMov({ loteId }) }, 400);
      await json("/estoque/produtos/" + produtoExterno.id + "/saldo", {}, 404);
      await assert.rejects(db.movimentoEstoque.create({ data: { empresaId: empresa.id, produtoId: produto.id, loteId: loteOutro.id, tipo: "ENTRADA", quantidade: "1", motivo: "Inválido", chaveOperacao: randomUUID() } }), e => e.code === "P2003");
      await assert.rejects(db.movimentoEstoque.create({ data: { empresaId: empresa.id, produtoId: produto.id, tipo: "ENTRADA", quantidade: "-1", motivo: "Inválido", chaveOperacao: randomUUID() } }));
    });
    await t.test("Estoque decimal, idempotência e rejeição de saldo insuficiente", async () => {
      const body = bodyMov({ loteId: lote.id });
      entrada = await json(path + "/movimentos", { method: "POST", body });
      assert.equal(entrada.quantidade, "10.125");
      assert.equal((await json(path + "/movimentos", { method: "POST", body })).id, entrada.id);
      await json(path + "/movimentos", { method: "POST", body: { ...body, quantidade: "11" } }, 409);
      for (const quantidade of [0, "0", "-0.000", "1.0001", "1000000000", "-1", "NaN"]) await json(path + "/movimentos", { method: "POST", body: bodyMov({ quantidade }) }, 400);
      await json(path + "/movimentos", { method: "POST", body: bodyMov({ tipo: "SAIDA", quantidade: "0,125", loteId: lote.id }) });
      assert.equal((await json(path + "/saldo", {}, 200)).saldo, "10.000");
      await json(path + "/movimentos", { method: "POST", body: bodyMov({ tipo: "SAIDA", quantidade: "10.001", loteId: lote.id }) }, 409);
      await json(path + "/movimentos", { method: "POST", body: bodyMov({ tipo: "SAIDA", quantidade: "1" }) }, 409);
      await json(path + "/movimentos", { method: "POST", body: bodyMov({ tipo: "AJUSTE", quantidade: "-0.001", loteId: lote.id }) });
      assert.equal((await json(path + "/saldo", {}, 200)).saldo, "9.999");
      const historico = await json(path + "/movimentos?pageSize=1", {}, 200);
      assert.equal(historico.total, 3); assert.equal(historico.pages, 3);
    });
    await t.test("Saídas concorrentes não vendem o mesmo saldo duas vezes", async () => {
      const responses = await Promise.all([1, 2].map(() => request(path + "/movimentos", { method: "POST", body: bodyMov({ tipo: "SAIDA", quantidade: "6", loteId: lote.id }) })));
      assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
      assert.equal((await json(path + "/saldo", {}, 200)).saldo, "3.999");
      const repetido = bodyMov({ quantidade: "1" });
      const reenvios = await Promise.all([1, 2].map(() => json(path + "/movimentos", { method: "POST", body: repetido })));
      assert.equal(reenvios[0].id, reenvios[1].id);
    });
    await t.test("Estornos preservam histórico e impedem duplicação e saldo negativo", async () => {
      await json(path + "/movimentos/" + entrada.id + "/estornar", { method: "POST", body: { motivo: "Entrada já consumida", chaveOperacao: randomUUID() } }, 409);
      const movimento = await json(path + "/movimentos", { method: "POST", body: bodyMov({ quantidade: "2" }) });
      const body = { motivo: "Correção da entrada", chaveOperacao: randomUUID() };
      const estorno = await json(path + "/movimentos/" + movimento.id + "/estornar", { method: "POST", body });
      assert.equal(estorno.quantidade, "-2.000");
      assert.equal((await json(path + "/movimentos/" + movimento.id + "/estornar", { method: "POST", body })).id, estorno.id);
      await json(path + "/movimentos/" + movimento.id + "/estornar", { method: "POST", body: { ...body, chaveOperacao: randomUUID() } }, 409);
      await json(path + "/movimentos/" + estorno.id + "/estornar", { method: "POST", body: { ...body, chaveOperacao: randomUUID() } }, 400);
      await assert.rejects(db.movimentoEstoque.update({ where: { id: movimento.id }, data: { quantidade: "99" } }));
      await assert.rejects(db.movimentoEstoque.delete({ where: { id: movimento.id } }));
    });
    await t.test("Falha de auditoria desfaz cadastros e movimentos", async () => {
      const falhaDb = { client: { $transaction: callback => db.$transaction(tx => callback(new Proxy(tx, { get(target, key) { if (key === "auditLog") return { create: async () => { throw new Error("Falha simulada de auditoria"); } }; const value = target[key]; return typeof value === "function" ? value.bind(target) : value; } }))) } };
      const estoque = new EstoqueService(falhaDb), cadastros = new CadastrosService(falhaDb);
      const before = await db.movimentoEstoque.count();
      await assert.rejects(estoque.movimentar(user, produto.id, bodyMov()), /Falha simulada/);
      assert.equal(await db.movimentoEstoque.count(), before);
      await assert.rejects(cadastros.criar("cliente", user, { nome: "Rollback", cpfCnpj: null, email: null, telefone: null, ativo: true }), /Falha simulada/);
      assert.equal(await db.cliente.count({ where: { nome: "Rollback" } }), 0);
    });
    await t.test("Produto inativo bloqueia novas entradas e permite estorno", async () => {
      const mov = await json(path + "/movimentos", { method: "POST", body: bodyMov({ quantidade: "1" }) });
      await db.produto.update({ where: { id: produto.id }, data: { ativo: false } });
      await json(path + "/movimentos", { method: "POST", body: bodyMov() }, 400);
      await json(path + "/movimentos/" + mov.id + "/estornar", { method: "POST", body: { motivo: "Correção após inativação", chaveOperacao: randomUUID() } });
    });
    await t.test("Custos: média ponderada, estornos, referência, ajustes e idempotência", async () => {
      const p = await json("/produtos", { method: "POST", body: { ...produtoData, sku: "CUSTOS", descricao: null, tipo: "REVENDA", categoriaId: null, ativo: true, custoCompra: "10,0000", estoqueMinimo: "5,125" } });
      assert.equal(p.custoCompra, "10.0000"); assert.equal(p.estoqueMinimo, "5.125");
      const rota = "/estoque/produtos/" + p.id;
      const aBody = bodyMov({ quantidade: "10" });
      const a = await json(rota + "/movimentos", { method: "POST", body: aBody });
      const bBody = bodyMov({ quantidade: "10", custoUnitario: "20" });
      const b = await json(rota + "/movimentos", { method: "POST", body: bBody });
      let s = await json(rota + "/saldo", {}, 200);
      assert.equal(s.custoMedio, "15.0000"); assert.equal(s.valorEstoque, "300.00");
      const saida = await json(rota + "/movimentos", { method: "POST", body: bodyMov({ tipo: "SAIDA", quantidade: "5" }) });
      assert.equal(saida.custoUnitario, "15.0000"); assert.equal(saida.valorMovimento, "-75.0000000");
      await json("/produtos/" + p.id, { method: "PATCH", body: { versao: 1, custoCompra: "30" } }, 200);
      const renomeado = await json("/produtos/" + p.id, { method: "PATCH", body: { versao: 2, nome: "Produto com custos" } }, 200);
      assert.equal(renomeado.custoCompra, "30.0000"); assert.equal(renomeado.estoqueMinimo, "5.125"); assert.equal(renomeado.custoMedio, "15.0000");
      await json("/produtos/" + p.id, { method: "PATCH", body: { versao: 3, unidade: "G" } }, 400);
      for (const campo of ["custoMedio", "valorEstoque"]) await json("/produtos/" + p.id, { method: "PATCH", body: { versao: 3, [campo]: "1" } }, 400);
      for (const custoCompra of ["-1", "1.00001", 10, "100000000"]) await json("/produtos/" + p.id, { method: "PATCH", body: { versao: 3, custoCompra } }, 400);
      for (const estoqueMinimo of ["-1", "1.0001", 10, "1000000000"]) await json("/produtos/" + p.id, { method: "PATCH", body: { versao: 3, estoqueMinimo } }, 400);
      assert.equal((await json(rota + "/movimentos", { method: "POST", body: aBody })).id, a.id);
      await json(rota + "/movimentos", { method: "POST", body: { ...bBody, custoUnitario: "21" } }, 409);
      await json(rota + "/movimentos/" + saida.id + "/estornar", { method: "POST", body: { motivo: "Correção do consumo", chaveOperacao: randomUUID() } });
      s = await json(rota + "/saldo", {}, 200); assert.equal(s.valorEstoque, "300.00");
      await json(rota + "/movimentos/" + b.id + "/estornar", { method: "POST", body: { motivo: "Correção da compra", chaveOperacao: randomUUID() } });
      s = await json(rota + "/saldo", {}, 200); assert.equal(s.custoMedio, "10.0000"); assert.equal(s.valorEstoque, "100.00");
      await json(rota + "/movimentos/" + a.id + "/estornar", { method: "POST", body: { motivo: "Correção do saldo inicial", chaveOperacao: randomUUID() } });
      s = await json(rota + "/saldo", {}, 200); assert.equal(s.saldo, "0.000"); assert.equal(s.valorEstoque, "0.00");
      await json(rota + "/movimentos", { method: "POST", body: bodyMov({ tipo: "AJUSTE", quantidade: "2", custoUnitario: "7" }) });
      await json(rota + "/movimentos", { method: "POST", body: bodyMov({ tipo: "AJUSTE", quantidade: "-0.5" }) });
      s = await json(rota + "/saldo", {}, 200); assert.equal(s.saldo, "1.500"); assert.equal(s.custoMedio, "7.0000"); assert.equal(s.valorEstoque, "10.50"); assert.equal(s.reposicao, true);
      await json(rota + "/movimentos", { method: "POST", body: bodyMov({ tipo: "SAIDA", quantidade: "1", custoUnitario: "9" }) }, 400);
      const before = await db.produto.findUniqueOrThrow({ where: { id: p.id } });
      const qtdAntes = await db.movimentoEstoque.count({ where: { produtoId: p.id } });
      await assert.rejects(new EstoqueService({ client: db }).movimentar({ ...user, id: randomUUID() }, p.id, bodyMov({ quantidade: "1", custoUnitario: "9" })));
      const after = await db.produto.findUniqueOrThrow({ where: { id: p.id } });
      assert.equal(after.valorEstoque.toFixed(7), before.valorEstoque.toFixed(7)); assert.equal(after.custoMedio.toFixed(4), before.custoMedio.toFixed(4));
      assert.equal(await db.movimentoEstoque.count({ where: { produtoId: p.id } }), qtdAntes);
    });
    await t.test("Custos: entradas sem custo, gratuidade explícita, precisão e estorno impossível", async () => {
      const novo = async sku => db.produto.create({ data: { ...produtoData, sku, empresaId: empresa.id } });
      const semCusto = await novo("SEM-CUSTO"), rota = "/estoque/produtos/" + semCusto.id;
      await json(rota + "/movimentos", { method: "POST", body: bodyMov({ quantidade: "2" }) });
      await json(rota + "/movimentos", { method: "POST", body: bodyMov({ quantidade: "1", custoUnitario: "9" }) });
      assert.equal((await json(rota + "/saldo", {}, 200)).custoMedio, null);
      await json(rota + "/movimentos", { method: "POST", body: bodyMov({ tipo: "SAIDA", quantidade: "3" }) });
      assert.equal((await json(rota + "/saldo", {}, 200)).valorEstoque, "0.00");
      await json(rota + "/movimentos", { method: "POST", body: bodyMov({ quantidade: "2", custoUnitario: "0" }) });
      assert.equal((await json(rota + "/saldo", {}, 200)).custoMedio, "0.0000");
      const caro = await novo("ESTORNO-CUSTO"), r = "/estoque/produtos/" + caro.id;
      await json(r + "/movimentos", { method: "POST", body: bodyMov({ quantidade: "10", custoUnitario: "1" }) });
      const compra = await json(r + "/movimentos", { method: "POST", body: bodyMov({ quantidade: "10", custoUnitario: "10" }) });
      await json(r + "/movimentos", { method: "POST", body: bodyMov({ tipo: "SAIDA", quantidade: "10" }) });
      await json(r + "/movimentos/" + compra.id + "/estornar", { method: "POST", body: { motivo: "Estorno após consumo", chaveOperacao: randomUUID() } }, 409);
      assert.equal((await json(r + "/saldo", {}, 200)).valorEstoque, "55.00");
      const exato = await novo("PRECISAO-CUSTO"), e = "/estoque/produtos/" + exato.id;
      const movimento = await json(e + "/movimentos", { method: "POST", body: bodyMov({ quantidade: "999999999.999", custoUnitario: "99999999.9999" }) });
      assert.equal(movimento.valorMovimento, "99999999999800000.0000001");
      await json(e + "/movimentos", { method: "POST", body: bodyMov({ tipo: "SAIDA", quantidade: "0.001" }) });
      assert.equal((await json(e + "/saldo", {}, 200)).custoMedio, "99999999.9999");
      await json(e + "/movimentos", { method: "POST", body: bodyMov({ tipo: "SAIDA", quantidade: "999999999.998" }) });
      const s = await json(e + "/saldo", {}, 200); assert.equal(s.saldo, "0.000"); assert.equal(s.valorEstoque, "0.00");
      const concorrente = await novo("CUSTO-CONCORRENTE"), c = "/estoque/produtos/" + concorrente.id;
      await Promise.all(["10", "20"].map(custoUnitario => json(c + "/movimentos", { method: "POST", body: bodyMov({ quantidade: "10", custoUnitario }) })));
      const concorrencia = await json(c + "/saldo", {}, 200); assert.equal(concorrencia.custoMedio, "15.0000"); assert.equal(concorrencia.valorEstoque, "300.00");
    });
    await t.test("Alertas: mínimo, validade, paginação, isolamento e virada do dia em Cuiabá", async () => {
      const p = await db.produto.create({ data: { ...produtoData, nome: "Produto Alerta QA", sku: "ALERTA-QA", estoqueMinimo: "2", empresaId: empresa.id } });
      const r = "/estoque/produtos/" + p.id;
      const criar = async (numero, validade, saldo = "1") => {
        const lote = await json(r + "/lotes", { method: "POST", body: { numero, validade } });
        if (saldo !== "0") await json(r + "/movimentos", { method: "POST", body: bodyMov({ quantidade: saldo, loteId: lote.id, custoUnitario: "3" }) });
        return lote;
      };
      await criar("VENCIDO", "2026-11-05"); await criar("HOJE", "2026-11-06"); await criar("LIMITE", "2026-12-06"); await criar("FORA", "2026-12-07"); await criar("SEM-SALDO", "2026-11-01", "0"); await criar("SEM-VALIDADE", null);
      const zerado = await db.produto.create({ data: { ...produtoData, nome: "Produto Alerta QA sem saldo", sku: "ALERTA-QA-ZERO", estoqueMinimo: "1", empresaId: empresa.id } });
      await db.produto.create({ data: { ...produtoData, nome: "Produto Alerta QA inativo", sku: "ALERTA-QA-INATIVO", estoqueMinimo: "1", ativo: false, empresaId: empresa.id } });
      await db.produto.create({ data: { ...produtoData, nome: "Produto Alerta QA externo", sku: "ALERTA-QA-EXTERNO", estoqueMinimo: "1", empresaId: externa.id } });
      const service = new AlertasEstoqueService({ client: db });
      const query = alertasEstoqueSchema.parse({ q: "Alerta QA" });
      const resultado = await service.listar(empresa.id, query, new Date("2026-11-07T02:00:00Z"));
      assert.equal(resultado.dataReferencia, "2026-11-06");
      assert.deepEqual(resultado.resumo, { reposicao: 1, vencidos: 1, aVencer: 2 }); assert.equal(resultado.total, 4);
      assert.equal(resultado.itens[0].tipo, "VENCIDO"); assert.ok(resultado.itens.every(i => !i.sku.includes("INATIVO") && !i.sku.includes("EXTERNO")));
      const pag = await service.listar(empresa.id, { ...query, tipo: "A_VENCER", pageSize: 1, page: 2 }, new Date("2026-11-07T02:00:00Z"));
      assert.equal(pag.total, 2); assert.equal(pag.pages, 2); assert.equal(pag.itens[0].numero, "LIMITE");
      const hoje = await service.listar(empresa.id, { ...query, dias: 0 }, new Date("2026-11-07T02:00:00Z")); assert.equal(hoje.resumo.aVencer, 1);
      // O saldo exatamente no mínimo também alerta; zero desativa essa regra.
      await db.produto.update({ where: { id: p.id }, data: { estoqueMinimo: "5" } });
      const igual = await service.listar(empresa.id, query, new Date("2026-11-07T02:00:00Z")); assert.equal(igual.resumo.reposicao, 2);
      await db.produto.update({ where: { id: zerado.id }, data: { estoqueMinimo: "0" } });
      const desligado = await service.listar(empresa.id, query, new Date("2026-11-07T02:00:00Z")); assert.equal(desligado.resumo.reposicao, 1);
      assert.equal((await request("/estoque/alertas", { cookie: "" })).status, 401);
      assert.equal((await request("/estoque/alertas", { cookie: cookies.CONTADORA })).status, 403);
      assert.equal((await request("/estoque/alertas", { cookie: cookies.OPERADOR })).status, 200);
      assert.equal((await request("/estoque/alertas?dias=-1")).status, 400); assert.equal((await request("/estoque/alertas?empresaId=" + externa.id)).status, 400);
      const api = await json("/estoque/alertas?q=Alerta%20QA&tipo=REPOSICAO", {}, 200); assert.equal(api.total, 1); assert.equal(api.itens[0].produtoId, p.id);
    });
    if (process.env.GESTAO_BROWSER === "1") await t.test("Painel: clientes, fornecedores, custos, alertas, reenvio e permissões", { timeout: 180000 }, async () => {
      const { chromium, expect } = await import("@playwright/test");
      const { mkdir } = await import("node:fs/promises");
      const { fileURLToPath } = await import("node:url");
      const requireAdmin = createRequire(new URL("../../admin/package.json", import.meta.url));
      const front = spawn(process.execPath, [requireAdmin.resolve("next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", "43169"], { cwd: new URL("../../admin/", import.meta.url), env: { ...process.env, API_INTERNAL_URL: base, ADMIN_ORIGIN: origin, NODE_ENV: "production" }, stdio: ["ignore", "pipe", "pipe"] });
      let frontLogs = "", browser;
      front.stdout.on("data", v => frontLogs += v); front.stderr.on("data", v => frontLogs += v);
      try {
        let started = false;
        const deadline = Date.now() + 45000;
        while (Date.now() < deadline) {
          if (front.exitCode !== null) assert.fail(frontLogs);
          try { if ((await fetch(origin + "/login", { signal: AbortSignal.timeout(1500) })).ok) { started = true; break; } } catch {}
          await new Promise(r => setTimeout(r, 200));
        }
        assert.ok(started, frontLogs);
        browser = await chromium.launch({ headless: true });
        const artifacts = new URL("../../../artifacts/gestao-painel/", import.meta.url); await mkdir(artifacts, { recursive: true });
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        await context.addCookies([{ name: "loja_session", value: cookies.ADMIN.split("=")[1], url: origin }]);
        const page = await context.newPage(), errors = [];
        page.on("pageerror", e => errors.push(e.message));
        await page.goto(origin + "/operacao");
        await page.getByRole("link", { name: "Acessar clientes", exact: true }).click();
        await page.getByRole("link", { name: "Novo cliente", exact: true }).click();
        await page.getByLabel("Nome", { exact: true }).fill("Cliente do painel");
        await page.getByLabel("E-mail", { exact: true }).fill("cliente@example.invalid");
        await page.getByRole("button", { name: "Salvar cliente", exact: true }).click();
        await expect(page.getByRole("status").filter({ hasText: "Cadastro salvo" })).toBeVisible();
        await page.getByRole("link", { name: "Editar Cliente do painel", exact: true }).click();
        await page.getByLabel("Telefone", { exact: true }).fill("(65) 99999-0000");
        await page.getByLabel("Cliente ativo", { exact: true }).uncheck();
        await page.getByRole("button", { name: "Salvar cliente", exact: true }).click();
        await page.getByLabel("Buscar cliente", { exact: true }).fill("Cliente do painel");
        await page.getByLabel("Status", { exact: true }).selectOption("inativos");
        await page.getByRole("button", { name: "Filtrar", exact: true }).click();
        await expect(page.getByRole("row").filter({ hasText: "Cliente do painel" })).toContainText("Inativo");
        await page.screenshot({ path: fileURLToPath(new URL("clientes-desktop.png", artifacts)), fullPage: true });
        await page.getByRole("button", { name: "Operação", exact: true }).click();
        await page.getByRole("link", { name: "Fornecedores", exact: true }).click();
        await page.getByRole("link", { name: "Novo fornecedor", exact: true }).click();
        await page.getByLabel("Nome", { exact: true }).fill("Fornecedor do painel");
        await page.getByLabel("CPF/CNPJ", { exact: true }).fill("11.222.333/0001-81");
        await page.getByRole("button", { name: "Salvar fornecedor", exact: true }).click();
        await expect(page.getByRole("main").getByRole("alert")).toContainText("já cadastrado");
        await page.getByLabel("CPF/CNPJ", { exact: true }).fill("04.252.011/0001-10");
        await page.getByRole("button", { name: "Salvar fornecedor", exact: true }).click();
        await expect(page.getByRole("row").filter({ hasText: "Fornecedor do painel" })).toContainText("04252011000110");
        const produtoUI = await db.produto.create({ data: { ...produtoData, nome: "Creme do painel", sku: "CREME-UI", empresaId: empresa.id } });
        await page.getByRole("link", { name: "Produtos", exact: true }).click();
        await page.getByRole("link", { name: "Editar Creme do painel", exact: true }).click();
        await page.getByLabel("Custo de compra de referência (R$)", { exact: true }).fill("2,0000");
        await page.getByLabel("Estoque mínimo", { exact: true }).fill("10");
        await page.getByRole("button", { name: "Salvar produto", exact: true }).click();
        await expect(page.getByRole("status").filter({ hasText: "Cadastro salvo" })).toBeVisible();
        await page.getByRole("link", { name: "Estoque", exact: true }).click();
        await page.getByLabel("Buscar produto", { exact: true }).fill("CREME-UI");
        await page.getByRole("button", { name: "Filtrar", exact: true }).click();
        await page.getByRole("link", { name: "Gerenciar estoque de Creme do painel", exact: true }).click();
        await expect(page.getByTestId("saldo-total")).toHaveText("0,000");
        await page.getByLabel("Número do lote", { exact: true }).fill("PAINEL-01");
        const referencia = (await json("/estoque/alertas", {}, 200)).dataReferencia;
        await page.getByLabel("Validade (opcional)", { exact: true }).fill(referencia);
        await page.getByRole("button", { name: "Cadastrar lote", exact: true }).click();
        await expect(page.getByRole("status").filter({ hasText: "Lote cadastrado" })).toBeVisible();
        async function movimento(tipo, quantidade, motivo) {
          await page.getByLabel("Tipo de movimento", { exact: true }).selectOption(tipo);
          await page.getByLabel("Quantidade (ML)", { exact: true }).fill(quantidade);
          await page.getByLabel("Motivo da movimentação", { exact: true }).fill(motivo);
          await page.getByRole("button", { name: "Registrar movimentação", exact: true }).click();
        }
        await movimento("ENTRADA", "5,125", "Compra conferida no painel");
        await expect(page.getByTestId("saldo-total")).toHaveText("5,125");
        await expect(page.getByTestId("custo-medio")).toContainText("2,0000");
        await movimento("SAIDA", "1,125", "Consumo registrado no painel");
        await expect(page.getByTestId("saldo-total")).toHaveText("4,000");
        await movimento("SAIDA", "99", "Saída acima do saldo");
        await expect(page.getByRole("main").getByRole("alert")).toContainText("Saldo insuficiente");
        await page.getByRole("button", { name: "Estornar movimento: Consumo registrado no painel", exact: true }).click();
        await page.getByLabel("Motivo do estorno", { exact: true }).fill("Consumo lançado por engano");
        await page.getByRole("button", { name: "Confirmar estorno", exact: true }).click();
        await expect(page.getByTestId("saldo-total")).toHaveText("5,125");
        // Simula resposta perdida depois da gravação: reenvio precisa manter a chave.
        let interrompida = false;
        await page.route("**/api/gestao/estoque/produtos/*/movimentos", async route => {
          if (route.request().method() === "POST" && !interrompida) { interrompida = true; const response = await route.fetch(); assert.equal(response.status(), 201); await route.abort("failed"); }
          else await route.continue();
        });
        await page.getByLabel("Tipo de movimento", { exact: true }).selectOption("ENTRADA");
        await page.getByLabel("Custo unitário da entrada (R$)", { exact: true }).fill("4");
        await movimento("ENTRADA", "2", "Entrada com resposta perdida");
        await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
        await page.getByRole("button", { name: "Registrar movimentação", exact: true }).click();
        await expect(page.getByTestId("saldo-total")).toHaveText("7,125");
        await expect(page.getByTestId("custo-medio")).toContainText("2,5614");
        assert.equal(await db.movimentoEstoque.count({ where: { produtoId: produtoUI.id, motivo: "Entrada com resposta perdida" } }), 1);
        await page.screenshot({ path: fileURLToPath(new URL("estoque-desktop.png", artifacts)), fullPage: true });
        await page.getByRole("link", { name: "Voltar para estoque", exact: false }).click();
        await page.getByRole("link", { name: "Alertas de estoque", exact: true }).click();
        await page.getByLabel("Buscar produto nos alertas", { exact: true }).fill("CREME-UI");
        await page.getByRole("button", { name: "Filtrar alertas", exact: true }).click();
        await expect(page.getByRole("row").filter({ hasText: "Creme do painel" })).toHaveCount(2);
        await page.getByLabel("Tipo de alerta", { exact: true }).selectOption("REPOSICAO");
        await page.getByRole("button", { name: "Filtrar alertas", exact: true }).click();
        await expect(page.getByRole("row").filter({ hasText: "Creme do painel" })).toHaveCount(1);
        await expect(page.getByRole("row").filter({ hasText: "Creme do painel" })).toContainText("Reposição");
        await db.produto.update({ where: { id: produtoUI.id }, data: { estoqueMinimo: "0" } });
        await page.getByRole("button", { name: "Filtrar alertas", exact: true }).click();
        await expect(page.getByRole("heading", { name: "Nenhum alerta encontrado", exact: true })).toBeVisible();
        await db.produto.update({ where: { id: produtoUI.id }, data: { estoqueMinimo: "10" } });
        await page.getByRole("button", { name: "Filtrar alertas", exact: true }).click();
        await expect(page.getByRole("row").filter({ hasText: "Creme do painel" })).toHaveCount(1);
        await page.screenshot({ path: fileURLToPath(new URL("alertas-desktop.png", artifacts)), fullPage: true });
        assert.deepEqual(errors, []);
        const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
        await mobile.addCookies([{ name: "loja_session", value: cookies.OPERADOR.split("=")[1], url: origin }]);
        const mobilePage = await mobile.newPage();
        await mobilePage.goto(origin + "/estoque/" + produtoUI.id);
        await expect(mobilePage.getByTestId("saldo-total")).toHaveText("7,125");
        await expect(mobilePage.getByTestId("custo-medio")).toContainText("2,5614");
        assert.ok(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
        await mobilePage.screenshot({ path: fileURLToPath(new URL("estoque-mobile.png", artifacts)), fullPage: true });
        await mobilePage.goto(origin + "/estoque/alertas");
        await mobilePage.getByLabel("Buscar produto nos alertas", { exact: true }).fill("CREME-UI");
        await mobilePage.getByRole("button", { name: "Filtrar alertas", exact: true }).click();
        await expect(mobilePage.getByRole("row").filter({ hasText: "Creme do painel" })).toHaveCount(2);
        assert.ok(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
        await mobilePage.screenshot({ path: fileURLToPath(new URL("alertas-mobile.png", artifacts)), fullPage: true });
        await mobilePage.setViewportSize({ width: 360, height: 800 });
        assert.ok(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
        await mobilePage.screenshot({ path: fileURLToPath(new URL("alertas-360.png", artifacts)), fullPage: true });
        await mobilePage.setViewportSize({ width: 390, height: 844 });
        await mobilePage.getByRole("button", { name: "Operação", exact: true }).click();
        await mobilePage.getByRole("link", { name: "Clientes", exact: true }).click();
        await expect(mobilePage.getByRole("heading", { name: "Clientes", exact: true })).toBeVisible();
        await expect(mobilePage.getByRole("link", { name: "Editar Cliente do painel", exact: true })).toBeVisible();
        assert.ok(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
        await mobilePage.screenshot({ path: fileURLToPath(new URL("clientes-mobile.png", artifacts)), fullPage: true });
        const accountant = await browser.newContext();
        await accountant.addCookies([{ name: "loja_session", value: cookies.CONTADORA.split("=")[1], url: origin }]);
        const denied = await accountant.newPage();
        for (const rota of ["/clientes", "/fornecedores", "/estoque", "/estoque/alertas", "/estoque/" + produtoUI.id]) {
          await denied.goto(origin + rota); await expect(denied.getByRole("heading", { name: "Acesso restrito", exact: true })).toBeVisible();
        }
        assert.equal((await accountant.request.post(origin + "/api/gestao/clientes", { headers: { origin }, data: { nome: "Negado" } })).status(), 403);
        assert.equal((await accountant.request.get(origin + "/api/gestao/estoque/alertas")).status(), 403);
        assert.equal((await page.request.post(origin + "/api/gestao/clientes", { headers: { origin: "https://externo.invalid" }, data: { nome: "Negado" } })).status(), 403);
        assert.equal((await page.request.get(origin + "/api/gestao/usuarios")).status(), 404);
        assert.equal((await page.request.post(origin + "/api/gestao/estoque/produtos/" + produtoUI.id + "/saldo", { headers: { origin }, data: {} })).status(), 405);
      } finally {
        if (browser) await browser.close();
        if (front.exitCode === null) { const stopped = once(front, "exit"); front.kill(); await stopped; }
      }
    });
  } finally {
    if (server && server.exitCode === null) { const stopped = once(server, "exit"); server.kill(); await stopped; }
    await db.$disconnect();
    if (created) await root.$executeRawUnsafe('DROP DATABASE "' + name + '" WITH (FORCE)');
    await root.$disconnect();
    const redis = createClient({ url: process.env.REDIS_URL, socket: { reconnectStrategy: false } }); redis.on("error", () => {});
    try { await redis.connect(); for await (const keys of redis.scanIterator({ MATCH: prefix + ":*", COUNT: 100 })) { if (keys.length) await redis.del(keys); } }
    finally { if (redis.isOpen) await redis.quit(); }
  }
});
