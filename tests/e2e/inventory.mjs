import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../../", import.meta.url));
async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(target)); else result.push(target);
  }
  return result;
}
const pages = [];
for (const app of ["admin", "loja"]) {
  const base = path.join(root, "apps", app, "app");
  for (const file of await files(base)) {
    if (path.basename(file) !== "page.tsx" && !(app === "loja" && file === path.join(base, "route.ts"))) continue;
    const parts = path.relative(base, path.dirname(file)).split(path.sep).filter(part => part && !part.startsWith("("));
    pages.push({ app, route: "/" + parts.join("/"), source: path.relative(root, file).replaceAll(path.sep, "/") });
  }
}
const endpoints = [];
for (const file of (await files(path.join(root, "apps/api/src"))).filter(file => file.endsWith(".controller.ts"))) {
  const source = await readFile(file, "utf8");
  let controller = "";
  for (const match of source.matchAll(/@Controller\(\s*["']([^"']*)["']\s*\)|@(Get|Post|Patch|Delete|Put)\(\s*(?:["']([^"']*)["'])?\s*\)/g)) {
    if (match[1] !== undefined) controller = match[1];
    else endpoints.push({ method: match[2].toUpperCase(), route: "/" + [controller, match[3]].filter(Boolean).join("/"), source: path.relative(root, file).replaceAll(path.sep, "/") });
  }
}
await mkdir(path.join(root, "artifacts/e2e-completo"), { recursive: true });
await writeFile(path.join(root, "artifacts/e2e-completo/inventario.json"), JSON.stringify({ pages, endpoints }, null, 2));
console.log(JSON.stringify({ paginas: pages.length, rotasHttpDeclaradas: endpoints.length }));
