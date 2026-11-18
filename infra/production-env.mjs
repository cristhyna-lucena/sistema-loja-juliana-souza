import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

// Executado somente pelos comandos start; preserva variáveis do servidor.
process.env.NODE_ENV = "production";
const env = new URL("../.env", import.meta.url);
if (existsSync(env)) loadEnvFile(env);
