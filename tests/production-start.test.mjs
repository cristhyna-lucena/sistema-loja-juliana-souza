import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";

const loader = new URL("../infra/production-env.mjs", import.meta.url).href;
test("produção carrega o .env da raiz e preserva variáveis do servidor", () => {
  const env = { ...process.env, NODE_ENV: "development", ADMIN_ORIGIN: "https://painel.example.test" };
  delete env.DATABASE_URL;
  const result = spawnSync(process.execPath, ["--import", loader, "--input-type=module", "-e",
    "console.log(JSON.stringify({production:process.env.NODE_ENV==='production',database:!!process.env.DATABASE_URL,origin:process.env.ADMIN_ORIGIN}))"],
    { cwd: new URL("../apps/loja/", import.meta.url), env, encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { production: true, database: true, origin: "https://painel.example.test" });
});

test("API compilada inicia em produção com origem HTTPS e serviços locais", { timeout: 60000 }, async () => {
  const child = spawn(process.execPath, ["--import", loader, "dist/main.js"], {
    cwd: new URL("../apps/api/", import.meta.url),
    env: { ...process.env, API_PORT: "43167", ADMIN_ORIGIN: "https://painel.example.test", LOJA_ORIGIN: "https://loja.example.test" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", data => { output += data; });
  child.stderr.on("data", data => { output += data; });
  try {
    let response;
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      assert.equal(child.exitCode, null, output);
      try { response = await fetch("http://127.0.0.1:43167/health/ready", { signal: AbortSignal.timeout(2000) }); if (response.ok) break; }
      catch { /* Aguarda a inicialização, sem alterar dados. */ }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.ok(response?.ok, output);
    const anonymous = await fetch("http://127.0.0.1:43167/auth/me");
    assert.equal(anonymous.status, 401);
  } finally {
    if (child.exitCode === null) { const closed = once(child, "exit"); child.kill(); await closed; }
  }
});

for (const [app, port] of [["loja", 43168], ["admin", 43169]]) {
  test(`${app}: produção usa as origens e API configuradas em execução`, { timeout: 60000 }, async () => {
    const requests = [];
    const upstream = createServer((req, res) => {
      requests.push({ path: req.url, origin: req.headers.origin });
      req.resume();
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ marcador: "api-local-do-teste" }));
    });
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    const require = createRequire(new URL(`../apps/${app}/package.json`, import.meta.url));
    const child = spawn(process.execPath, ["--import", loader, require.resolve("next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: new URL(`../apps/${app}/`, import.meta.url),
      env: { ...process.env, ADMIN_ORIGIN: "https://painel.example.test", LOJA_ORIGIN: "https://loja.example.test", API_INTERNAL_URL: `http://127.0.0.1:${upstream.address().port}` },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", data => { output += data; });
    child.stderr.on("data", data => { output += data; });
    try {
      let response;
      const deadline = Date.now() + 45000;
      while (Date.now() < deadline) {
        assert.equal(child.exitCode, null, output);
        try { response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) }); break; }
        catch { await new Promise(resolve => setTimeout(resolve, 200)); }
      }
      assert.ok(response, output);
      assert.equal(response.status, 200);
      if (app === "loja") assert.ok((await response.text()).includes('window.lojaAdminOrigin="https://painel.example.test"'));
      const route = app === "loja" ? "/api/loja/login" : "/api/auth/login";
      const origin = app === "loja" ? "https://loja.example.test" : "https://painel.example.test";
      const rejected = await fetch(`http://127.0.0.1:${port}${route}`, { method: "POST", headers: { origin: "https://outra.example.test", "Content-Type": "application/json" }, body: "{}" });
      assert.equal(rejected.status, 403);
      assert.equal(requests.length, 0);
      const allowed = await fetch(`http://127.0.0.1:${port}${route}`, { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: "{}" });
      assert.equal(allowed.status, 200);
      assert.deepEqual(await allowed.json(), { marcador: "api-local-do-teste" });
      assert.deepEqual(requests, [{ path: app === "loja" ? "/loja/login" : "/auth/login", origin }]);
    } finally {
      if (child.exitCode === null) { const closed = once(child, "exit"); child.kill(); await closed; }
      upstream.closeAllConnections();
      await new Promise(resolve => upstream.close(resolve));
    }
  });
}
