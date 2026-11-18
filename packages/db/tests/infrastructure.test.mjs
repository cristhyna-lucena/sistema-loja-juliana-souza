import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { createDatabase } from "../dist/index.js";
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });
assert.ok(process.env.DATABASE_URL, "Crie o .env local antes de testar");
const db = createDatabase(process.env.DATABASE_URL);
after(async () => { await db.$disconnect(); });
const rollback = new Error("rollback esperado no teste");

test("PostgreSQL: conexão e migration inicial aplicada", async () => {
  const result = await db.$queryRaw`SELECT current_database() AS database`;
  assert.equal(result[0].database, "sistema_loja");
  const migrations = await db.$queryRaw`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  assert.ok(migrations.some(row => row.migration_name.endsWith("_base_acesso")));
});

test("Prisma: relacionamentos e auditoria, com rollback sem dados residuais", async () => {
  const id = randomUUID();
  await assert.rejects(db.$transaction(async tx => {
    const empresa = await tx.empresa.create({ data: { id, nome: "Empresa de teste" } });
    const usuario = await tx.usuario.create({ data: { empresaId: empresa.id, nome: "Teste", email: "teste@example.invalid", senhaHash: "hash-ficticio-teste", perfil: "ADMIN" } });
    await tx.auditLog.create({ data: { empresaId: empresa.id, usuarioId: usuario.id, acao: "TESTE", entidade: "Usuario", entidadeId: usuario.id, dados: { teste: true } } });
    const found = await tx.empresa.findUniqueOrThrow({ where: { id }, include: { usuarios: true, auditoria: true } });
    assert.equal(found.usuarios.length, 1);
    assert.equal(found.auditoria[0].usuarioId, usuario.id);
    throw rollback;
  }), error => error === rollback);
  assert.equal(await db.empresa.count({ where: { id } }), 0);
});

test("Prisma: impede e-mail duplicado dentro da empresa", async () => {
  const id = randomUUID();
  await assert.rejects(db.$transaction(async tx => {
    await tx.empresa.create({ data: { id, nome: "Teste unicidade" } });
    const data = { empresaId: id, nome: "Teste", email: "duplicado@example.invalid", senhaHash: "hash-ficticio-teste", perfil: "OPERADOR" };
    await tx.usuario.create({ data });
    await tx.usuario.create({ data });
  }), error => error.code === "P2002");
  assert.equal(await db.empresa.count({ where: { id } }), 0);
});

test("Prisma: impede vincular auditoria a usuário de outra empresa", async () => {
  const id = randomUUID();
  await assert.rejects(db.$transaction(async tx => {
    const empresa = await tx.empresa.create({ data: { id, nome: "Teste empresa A" } });
    const outra = await tx.empresa.create({ data: { nome: "Teste empresa B" } });
    const usuario = await tx.usuario.create({ data: { empresaId: outra.id, nome: "Teste", email: "outro@example.invalid", senhaHash: "hash-ficticio-teste", perfil: "ADMIN" } });
    await tx.auditLog.create({ data: { empresaId: empresa.id, usuarioId: usuario.id, acao: "TESTE", entidade: "Usuario", entidadeId: usuario.id, dados: {} } });
  }), error => error.code === "P2003");
  assert.equal(await db.empresa.count({ where: { id } }), 0);
});

test("Redis: autenticação, leitura, escrita e remoção de chave temporária", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const cli = (...args) => execFileSync("docker", ["compose", "--env-file", ".env", "-f", "infra/docker-compose.yml", "exec", "-T", "redis", "redis-cli", "--raw", ...args], { cwd: root, encoding: "utf8", timeout: 15000 }).trim();
  const key = `sistema-loja:test:${randomUUID()}`;
  try {
    assert.equal(cli("PING"), "PONG");
    assert.equal(cli("SET", key, "teste", "PX", "30000"), "OK");
    assert.equal(cli("GET", key), "teste");
  } finally { cli("DEL", key); }
  assert.equal(cli("EXISTS", key), "0");
});

