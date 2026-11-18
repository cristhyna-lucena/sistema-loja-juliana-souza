import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { parseEnv } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../../", import.meta.url));
const { createDatabase } = createRequire(new URL("../../apps/api/package.json", import.meta.url))("@sistema/db");
export async function snapshot(target) {
  const raw = await readFile(path.join(root, ".env"));
  const env = { ...parseEnv(raw.toString("utf8")), ...process.env };
  const url = new URL(env.DATABASE_URL);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/sistema_loja") throw new Error("A comparação exige a instalação local sistema_loja.");
  const db = createDatabase(url.toString());
  try {
    const tables = await db.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
    const result = { envHash: createHash("sha256").update(raw).digest("hex"), tables: {} };
    for (const { tablename } of tables) {
      if (!/^[A-Za-z0-9_]+$/.test(tablename)) throw new Error("Tabela inesperada.");
      const [row] = await db.$queryRawUnsafe(`SELECT count(*)::int AS count, md5(COALESCE(string_agg(row_to_json(t)::text, E'\\n' ORDER BY row_to_json(t)::text),'')) AS hash FROM "${tablename}" t`);
      result.tables[tablename] = row;
    }
    await writeFile(target, JSON.stringify(result, null, 2));
    return result;
  } finally { await db.$disconnect(); }
}
