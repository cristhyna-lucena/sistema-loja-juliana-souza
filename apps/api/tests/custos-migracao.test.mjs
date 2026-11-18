import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { loadEnvFile } from "node:process";
import { createDatabase } from "@sistema/db";
loadEnvFile(new URL("../../../.env", import.meta.url));
test("Migração de custos preserva histórico antigo e identifica saldos sem avaliação", { timeout: 60000 }, async () => {
  const local = new URL(process.env.DATABASE_URL);
  assert.ok(["127.0.0.1", "localhost"].includes(local.hostname) && local.pathname === "/sistema_loja");
  const name = "sistema_loja_test_custos_" + randomBytes(8).toString("hex");
  const url = new URL(local); url.pathname = "/" + name;
  const root = createDatabase(local.toString());
  const requireDb = createRequire(new URL("../../../packages/db/package.json", import.meta.url));
  const { Client } = requireDb("pg");
  const pg = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000 });
  let created = false;
  try {
    await root.$executeRawUnsafe('CREATE DATABASE "' + name + '"'); created = true;
    await pg.connect();
    const folder = new URL("../../../packages/db/prisma/migrations/", import.meta.url);
    const ultima = "20261106180000_custos_alertas_estoque";
    for (const entry of (await readdir(folder, { withFileTypes: true })).filter(e => e.isDirectory() && e.name < ultima).sort((a, b) => a.name.localeCompare(b.name))) await pg.query(await readFile(new URL(entry.name + "/migration.sql", folder), "utf8"));
    await pg.query(`INSERT INTO "Empresa" (id,nome,"updatedAt") VALUES ('empresa-legada','Legado',NOW());
      INSERT INTO "Produto" (id,"empresaId",nome,sku,unidade,"precoVenda","updatedAt") VALUES ('com-saldo','empresa-legada','Com saldo','COM','UN',10,NOW()),('zerado','empresa-legada','Sem saldo','ZERO','UN',10,NOW());
      INSERT INTO "MovimentoEstoque" (id,"empresaId","produtoId",tipo,quantidade,motivo,"chaveOperacao") VALUES ('original','empresa-legada','com-saldo','ENTRADA',2,'Saldo inicial anterior','legado-1');`);
    await pg.query(await readFile(new URL(ultima + "/migration.sql", folder), "utf8"));
    const rows = (await pg.query('SELECT id,"custoCompra","estoqueMinimo","custoMedio","valorEstoque" FROM "Produto" ORDER BY id')).rows;
    assert.equal(rows[0].id, "com-saldo"); assert.equal(rows[0].custoCompra, null); assert.equal(rows[0].estoqueMinimo, "0.000"); assert.equal(rows[0].custoMedio, null); assert.equal(rows[0].valorEstoque, null);
    assert.equal(rows[1].custoMedio, "0.0000"); assert.equal(rows[1].valorEstoque, "0.0000000");
    const movimento = (await pg.query('SELECT quantidade,"custoUnitario","valorMovimento" FROM "MovimentoEstoque" WHERE id=\'original\'')).rows[0];
    assert.equal(movimento.quantidade, "2.000"); assert.equal(movimento.custoUnitario, null); assert.equal(movimento.valorMovimento, null);
    await assert.rejects(pg.query('UPDATE "MovimentoEstoque" SET "custoUnitario"=1 WHERE id=\'original\''));
    await assert.rejects(pg.query('UPDATE "Produto" SET "estoqueMinimo"=-1 WHERE id=\'zerado\''));
    await assert.rejects(pg.query('UPDATE "Produto" SET "custoCompra"=-1 WHERE id=\'zerado\''));
    await pg.query(await readFile(new URL("20261106210000_vendas_financeiro/migration.sql", folder), "utf8"));
    const conta = (await pg.query('SELECT nome,tipo FROM "ContaFinanceira" WHERE "empresaId"=\'empresa-legada\'')).rows;
    assert.deepEqual(conta, [{ nome: "Caixa da loja", tipo: "CAIXA" }]);
    assert.equal((await pg.query('SELECT COUNT(*)::int AS total FROM "LancamentoFinanceiro"')).rows[0].total, 0);
    assert.equal((await pg.query('SELECT quantidade FROM "MovimentoEstoque" WHERE id=\'original\'')).rows[0].quantidade, "2.000");
  } finally {
    await pg.end();
    if (created) await root.$executeRawUnsafe('DROP DATABASE "' + name + '" WITH (FORCE)');
    await root.$disconnect();
  }
});
