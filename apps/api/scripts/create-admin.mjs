import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { createDatabase } from "@sistema/db";
import { createInitialAdmin } from "../dist/auth/bootstrap-admin.js";
const envFile = new URL("../../../.env", import.meta.url);
if (existsSync(envFile)) loadEnvFile(envFile);
if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Execute em terminal interativo. A senha será digitada de forma oculta.");
let muted = false;
const output = new Writable({ write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk, encoding); callback(); } });
const rl = createInterface({ input: process.stdin, output, terminal: true });
const db = createDatabase(process.env.DATABASE_URL ?? "");
try {
  const nomeEmpresa = (await rl.question("Nome da empresa: ")).trim();
  const nome = (await rl.question("Nome do administrador: ")).trim();
  const email = (await rl.question("E-mail do administrador: ")).trim().toLowerCase();
  if (!nomeEmpresa || nomeEmpresa.length > 150 || !nome || nome.length > 150 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Nome ou e-mail inválido.");
  process.stdout.write("Senha (12 a 128 caracteres; digitação oculta): ");
  muted = true;
  const senha = await rl.question("");
  muted = false; process.stdout.write("\n");
  if (senha.length < 12 || senha.length > 128) throw new Error("A senha deve ter entre 12 e 128 caracteres.");
  process.stdout.write("Confirme a senha: "); muted = true;
  const confirmacao = await rl.question("");
  muted = false; process.stdout.write("\n");
  if (senha !== confirmacao) throw new Error("As senhas não coincidem.");
  await createInitialAdmin(db, { empresaId: process.env.EMPRESA_ID, nomeEmpresa, nome, email, senha });
  console.log("Administrador criado. Entre pelo painel com os dados informados.");
} catch (error) {
  muted = false;
  console.error(error instanceof Error && !("code" in error) ? error.message : "Não foi possível criar o administrador. Verifique o banco e os dados.");
  process.exitCode = 1;
} finally { muted = false; rl.close(); await db.$disconnect(); }
