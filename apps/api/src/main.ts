import "reflect-metadata";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import { AppModule } from "./app.module";
import { adminOrigin } from "./auth/config";
async function bootstrap() {
  const envPath = resolve(__dirname, "../../../.env");
  if (existsSync(envPath)) loadEnvFile(envPath);
  adminOrigin();
  const port = Number(process.env.API_PORT ?? 3002);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("API_PORT inválida");
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use("/fiscal/recebidas/xml", json({ limit: "2mb" }));
  app.use(json({ limit: "32kb" }));
  app.use((req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.enableShutdownHooks();
  await app.listen(port, "127.0.0.1");
}
bootstrap().catch(() => { console.error("Não foi possível iniciar a API. Verifique banco, Redis e variáveis de ambiente."); process.exit(1); });
