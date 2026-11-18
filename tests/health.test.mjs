import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";

test("API compilada inicia e responde à rota de saúde", { timeout: 60000 }, async () => {
  const child = spawn(process.execPath, ["apps/api/dist/main.js"], { env: { ...process.env, API_PORT: "43127" }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", data => output += data);
  child.stderr.on("data", data => output += data);
  try {
    let response;
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) assert.fail(`API encerrou: ${output}`);
      try { response = await fetch("http://127.0.0.1:43127/health", { signal: AbortSignal.timeout(1500) }); break; } catch { await new Promise(resolve => setTimeout(resolve, 200)); }
    }
    assert.ok(response, `API não iniciou: ${output}`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok", service: "api" });
    const missing = await fetch("http://127.0.0.1:43127/rota-inexistente");
    assert.equal(missing.status, 404);
  } finally {
    if (child.exitCode === null) { const closed = once(child, "exit"); child.kill(); await closed; }
  }
});

for (const [app, port, title] of [["loja", 43128, "Juliana Souza | Amor em cada detalhe"], ["admin", 43129, "Painel administrativo"]]) {
  test(`${app}: servidor de produção entrega a página inicial`, { timeout: 60000 }, async () => {
    const require = createRequire(new URL(`../apps/${app}/package.json`, import.meta.url));
    const next = require.resolve("next/dist/bin/next");
    const child = spawn(process.execPath, [next, "start", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: new URL(`../apps/${app}/`, import.meta.url), stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", data => output += data);
    child.stderr.on("data", data => output += data);
    try {
      let response;
      const deadline = Date.now() + 45000;
      while (Date.now() < deadline) {
        if (child.exitCode !== null) assert.fail(`Servidor encerrou: ${output}`);
        try { response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) }); break; } catch { await new Promise(resolve => setTimeout(resolve, 200)); }
      }
      assert.ok(response, `Servidor não iniciou: ${output}`);
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.ok(html.includes('lang="pt-BR"'));
      assert.ok(html.includes(app === "admin" ? "Entre no painel" : title));
    } finally {
      if (child.exitCode === null) { const closed = once(child, "exit"); child.kill(); await closed; }
    }
  });
}

