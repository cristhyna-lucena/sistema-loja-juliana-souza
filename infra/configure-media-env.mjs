import { readFileSync, appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
const target = new URL("../.env", import.meta.url);
const source = readFileSync(target, "utf8");
const values = {
  MINIO_ROOT_USER: "loja_" + randomBytes(8).toString("hex"),
  MINIO_ROOT_PASSWORD: randomBytes(24).toString("hex"),
  S3_ENDPOINT: "http://127.0.0.1:19000",
  MINIO_PORT: "19000",
  MINIO_CONSOLE_PORT: "19001",
  S3_MEDIA_BUCKET: "sistema-loja-media",
  MEDIA_QUEUE_PREFIX: "sistema-loja-media"
};
let content = "\n# Fotos: armazenamento local e fila.\n";
let added = 0;
for (const [key, value] of Object.entries(values)) {
  if (!new RegExp("^" + key + "=", "m").test(source)) { content += key + "=" + value + "\n"; added++; }
}
if (added) appendFileSync(target, content);
console.log("Configuração de mídia preparada. Variáveis existentes preservadas; segredos não exibidos.");
