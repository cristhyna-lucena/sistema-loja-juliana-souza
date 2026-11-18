import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { createDatabase } from "@sistema/db";
import { MediaStorage, startPhotoWorker } from "@sistema/media";
import { startIntegrationWorker } from "@sistema/integracoes";
const envPath = resolve(__dirname, "../../../.env");
if (existsSync(envPath)) loadEnvFile(envPath);
async function main() {
  const db = createDatabase(process.env.DATABASE_URL ?? "");
  const storage = new MediaStorage();
  await storage.ensureBucket();
  const runtime = startPhotoWorker(db,storage);
  const integrations = startIntegrationWorker(db, storage);
  await runtime.worker.waitUntilReady();
  console.log("Worker de imagens pronto.");
  let closing = false;
  async function close() { if (closing) return; closing = true; await integrations.close(); await runtime.close(); storage.close(); await db.$disconnect(); }
  process.once("SIGINT",() => { void close().then(() => process.exit(0)); });
  process.once("SIGTERM",() => { void close().then(() => process.exit(0)); });
}
main().catch(() => { console.error("Não foi possível iniciar o worker. Verifique banco, Redis e armazenamento."); process.exit(1); });
