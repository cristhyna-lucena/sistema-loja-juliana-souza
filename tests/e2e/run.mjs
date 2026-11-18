import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { snapshot } from "./snapshot.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const directory = path.join(root, "artifacts", "e2e-completo", String(Date.now()));
await mkdir(directory, { recursive: true });
const reporter = new URL("./reporter.mjs", import.meta.url).href;
const api = "apps/api";
const suites = [
  ["infraestrutura", "packages/db", ["tests/infrastructure.test.mjs"], "Infraestrutura e transações revertidas", 120000],
  ["autenticacao", api, ["tests/auth.test.mjs"], "API e navegador reais", 360000],
  ["catalogo", api, ["tests/catalogo.test.mjs"], "API e navegador reais", 360000],
  ["gestao", api, ["tests/gestao-painel.test.mjs", "tests/custos-migracao.test.mjs"], "API e navegador reais", 480000],
  ["comercial", api, ["tests/comercial-painel.test.mjs"], "API e navegador reais", 480000],
  ["fotos", api, ["tests/fotos.test.mjs"], "API, S3, Redis, worker e navegador reais", 780000],
  ["operacoes", api, ["tests/operacoes.test.mjs", "tests/integracoes.test.mjs"], "Domínio integrado ao banco; provedores simulados", 360000],
  ["operacoes-painel", api, ["tests/operacoes-painel.test.mjs"], "API e navegador reais; pagamentos simulados", 540000],
  ["producao", ".", ["tests/production-start.test.mjs"], "Inicialização real; API simulada para proxies", 180000],
  ["saude", ".", ["tests/health.test.mjs"], "Servidores compilados reais", 180000],
  ["complementar", api, ["tests/e2e-completo.test.mjs"], "Navegador, usuários, navegação, visual e formulários", 720000],
];
const only = process.argv.find(arg => arg.startsWith("--only="))?.slice(7).split(",");
const selected = suites.filter(([id]) => !only || only.includes(id));
if (!selected.length || only?.some(id => !suites.some(suite => suite[0] === id))) throw new Error("Suíte desconhecida.");
const report = { iniciado: new Date().toISOString(), diretorio: directory, suites: [],
  parcial: selected.length !== suites.length,
  limites: ["Integrações externas sem credenciais: contratos simulados; não homologadas nas contas reais.", "Nenhuma publicação ou alteração de domínio.", "Exclusão física apenas nas funções existentes; cadastros auditáveis usam inativação ou estorno."] };
await writeFile(path.join(root, "artifacts/e2e-completo/ultima-execucao.txt"), directory);
async function save() { await writeFile(path.join(directory, "resultado.json"), JSON.stringify(report, null, 2)); }
await save();
const before = await snapshot(path.join(directory, "before.json"));
for (const [id, cwd, files, tipo, timeout] of selected) {
  console.log(`INICIANDO ${id}`);
  const started = Date.now();
  const log = path.join(directory, id + ".log");
  const eventsFile = path.join(directory, id + ".ndjson");
  const child = spawn(process.execPath, ["--test", "--test-concurrency=1", "--test-reporter=spec", `--test-reporter-destination=${log}`, `--test-reporter=${reporter}`, `--test-reporter-destination=${eventsFile}`, ...files], { cwd: path.join(root, cwd), env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] });
  let diagnostics = "";
  child.stdout.on("data", data => { diagnostics += data; });
  child.stderr.on("data", data => { diagnostics += data; });
  let expired = false;
  const timer = setTimeout(() => { expired = true; child.kill(); }, timeout);
  const [code, signal] = await once(child, "exit");
  clearTimeout(timer);
  const events = (await readFile(eventsFile, "utf8").catch(() => "")).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const passed = events.filter(e => e.type === "test:pass" && !e.skip && !e.todo);
  const failed = events.filter(e => e.type === "test:fail");
  const skipped = events.filter(e => e.skip || e.todo);
  const item = { id, tipo, codigo: code, signal, timeout: expired, duracaoMs: Date.now() - started, aprovados: passed.length, falhas: failed.length, naoExecutados: skipped.length, casos: events.filter(e => e.type !== "test:summary"), log, diagnosticoExecutor: diagnostics };
  report.suites.push(item);
  await save();
  console.log(`CONCLUIDO ${id}: codigo=${code}, aprovados=${passed.length}, falhas=${failed.length}, ignorados=${skipped.length}`);
}
report.finalizado = new Date().toISOString();
report.aprovado = report.suites.every(suite => suite.codigo === 0 && !suite.timeout && suite.falhas === 0);
const after = await snapshot(path.join(directory, "after.json"));
report.preservacao = { envPreservado: before.envHash === after.envHash, tabelasAlteradas: Object.keys(before.tables).filter(table => JSON.stringify(before.tables[table]) !== JSON.stringify(after.tables[table])) };
if (!report.preservacao.envPreservado || report.preservacao.tabelasAlteradas.length) report.aprovado = false;
report.totais = { aprovados: report.suites.reduce((sum, suite) => sum + suite.aprovados, 0), falhas: report.suites.reduce((sum, suite) => sum + suite.falhas, 0), naoExecutados: report.suites.reduce((sum, suite) => sum + suite.naoExecutados, 0) };
await save();
const writer = spawn(process.execPath, [fileURLToPath(new URL("./report.mjs", import.meta.url)), directory], { cwd: root, stdio: "inherit" });
const [reportCode] = await once(writer, "exit");
console.log(JSON.stringify({ resultado: path.join(directory, "resultado.json"), aprovado: report.aprovado, totais: report.totais }));
process.exitCode = report.aprovado && reportCode === 0 ? 0 : 1;
