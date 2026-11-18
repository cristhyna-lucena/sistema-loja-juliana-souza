import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
const postgresPassword = randomBytes(24).toString("hex");
const redisPassword = randomBytes(24).toString("hex");
const contents = [
  "# Ambiente local. Não compartilhar nem versionar.",
  "API_PORT=3002", "POSTGRES_PORT=5433", "REDIS_PORT=6380",
  `POSTGRES_PASSWORD=${postgresPassword}`,
  `REDIS_PASSWORD=${redisPassword}`,
  `DATABASE_URL=postgresql://sistema_loja:${postgresPassword}@127.0.0.1:5433/sistema_loja?schema=public`,
  `REDIS_URL=redis://:${redisPassword}@127.0.0.1:6380`, ""
].join("\n");
try {
  writeFileSync(new URL("../.env", import.meta.url), contents, { flag: "wx", mode: 0o600 });
  console.log(".env local criado; credenciais não serão exibidas.");
} catch (error) {
  if (error.code === "EEXIST") console.log(".env já existe e foi preservado.");
  else throw error;
}

