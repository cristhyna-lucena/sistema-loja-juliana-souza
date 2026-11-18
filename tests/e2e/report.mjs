import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../../", import.meta.url));
const latest = process.argv[2] || (await readFile(path.join(root, "artifacts/e2e-completo/ultima-execucao.txt"), "utf8")).trim();
const result = JSON.parse(await readFile(path.join(latest, "resultado.json"), "utf8"));
if (!result.finalizado) throw new Error("A execução ainda não terminou.");
const inventory = JSON.parse(await readFile(path.join(root, "artifacts/e2e-completo/inventario.json"), "utf8"));
const before = JSON.parse(await readFile(path.join(latest, "before.json"), "utf8").catch(() => readFile(path.join(root, "artifacts/e2e-completo/antes.json"), "utf8")));
const after = JSON.parse(await readFile(path.join(latest, "after.json"), "utf8").catch(() => readFile(path.join(root, "artifacts/e2e-completo/depois.json"), "utf8")));
const changed = Object.keys(before.tables).filter(table => JSON.stringify(before.tables[table]) !== JSON.stringify(after.tables[table]));
const unchanged = changed.length === 0 && before.envHash === after.envHash;
const date = value => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "long", timeZone: "America/Cuiaba" }).format(new Date(value));
let leafTotal = 0;
const lines = ["# Relatório E2E completo — 18/11/2026", "", `Execução: ${date(result.iniciado)} até ${date(result.finalizado)} (America/Cuiaba).`, "",
  `Resultado do executor: **${result.aprovado ? "APROVADO" : "COM FALHAS — consultar diagnóstico"}**.`, "",
  "## Escopo e método", "", `Inventário atual: ${inventory.pages.length} páginas/rotas de página e ${inventory.endpoints.length} declarações de rotas HTTP. A suíte reúne navegação real no Chromium, formulários, API, banco, Redis, armazenamento e worker. O inventário não representa uma medição de cobertura de código ou aprovação individual de todos os endpoints.`, "",
  "Os percursos funcionais usam bancos e dados exclusivos de teste, removidos ao final. As verificações de infraestrutura que acessam o banco principal usam transações revertidas. A inicialização de produção consulta saúde e autenticação sem cadastrar dados. Não houve deploy, alteração de DNS ou envio ao GitHub.", "",
  "## Resultados por suíte", "", "| Suíte | Aprovados pelo executor | Falhas | Ignorados | Resultado |", "| --- | ---: | ---: | ---: | --- |"];
if (result.parcial) lines.splice(6, 0, "Esta é uma repetição parcial. O resultado aprova apenas as suítes listadas nesta execução; o mapa geral de funcionalidades não substitui os resultados das áreas não executadas aqui.", "");
for (const suite of result.suites) {
  const leaves = suite.casos.filter((item, index, all) => !item.skip && !item.todo && item.type === "test:pass" && !(index > 0 && all[index - 1].nesting > item.nesting));
  leafTotal += leaves.length;
  lines.push(`| ${suite.id} | ${suite.aprovados} | ${suite.falhas} | ${suite.naoExecutados} | ${suite.codigo === 0 && !suite.timeout && !suite.falhas ? "Aprovada" : "Falha"} |`);
}
lines.push("", `Totais do Node: **${result.totais.aprovados} aprovações, ${result.totais.falhas} falhas e ${result.totais.naoExecutados} ignorados**. As aprovações incluem testes agrupadores. Excluindo esses agrupadores, foram aprovados ${leafTotal} cenários individuais.`, "",
  "## Funcionalidades exercitadas", "",
  "- Login do painel e do cliente, sessão, persistência, logout, recuperação/redefinição de senha, cookies seguros e revogação de sessões.",
  "- Cadastro, consulta, edição, pesquisa, paginação, inativação e validação de categorias, produtos, clientes, fornecedores e usuários.",
  "- Permissões de administrador, operador e contadora; isolamento entre empresas; bloqueio de origem; usuário inativo e último administrador.",
  "- Fotos com upload real, processamento, variantes, organização, troca, remoção, restauração e recuperação do worker.",
  "- Lotes, validade, estoque decimal, custos, alertas, concorrência, estornos e preservação do histórico.",
  "- Vendas, compras, parcelas, recebimentos, despesas, caixa, transferências, conciliação e relatórios.",
  "- Serviços, fichas de insumos, vouchers, uso e cancelamento; XML de entrada, de-para e fila fiscal.",
  "- Loja, catálogo publicado, carrinho, conta, cadastro do cliente, checkout, reservas, consulta de pedidos e prevenção de duplicação.",
  "- Abertura dos módulos, formulários, menus, mensagens de erro, indisponibilidade simulada, responsividade e comparação com o HTML aprovado.", "",
  "A lista descreve o que foi exercitado. A aprovação de cada cenário consta no detalhamento abaixo; uma área com cenário reprovado não deve ser considerada totalmente aprovada.", "",
  "## Falhas identificadas", "");
const failures = result.suites.flatMap(suite => suite.casos.filter(item => item.type === "test:fail").map(item => ({ suite: suite.id, ...item })));
if (!failures.length && result.aprovado) lines.push("Nenhuma falha reportada nesta execução. Nenhuma funcionalidade da aplicação foi alterada para obter aprovação.");
else for (const failure of failures) lines.push(`- **${failure.suite}: ${failure.name}** — ${(failure.details?.error?.message || "Consultar o log").replaceAll("\n", " ")}`);
for (const suite of result.suites.filter(suite => suite.codigo !== 0 && !suite.falhas)) lines.push(`- **${suite.id}**: encerramento do processo com código ${suite.codigo}; consultar o log. Timeout: ${suite.timeout}.`);
if (result.ajustesTeste?.length) {
  lines.push("", "### Diagnóstico e repetições", "");
  for (const note of result.ajustesTeste) lines.push("- " + note);
}
lines.push("", "## Não executado contra serviços reais", "", "| Validação externa | Motivo | O que foi possível testar |", "| --- | --- | --- |",
  "| Cobrança, liquidação e reembolso nos gateways | Contas e credenciais adiadas | Contratos simulados, idempotência, valores e bloqueio quando desativados |",
  "| Correios: contrato, preço, prazo, etiqueta e rastreio reais | Contrato e credenciais não configurados | Contrato do adaptador com resposta simulada |",
  "| Emissão, cancelamento, correção fiscal e NFS-e municipal reais | Provedor e configuração tributária não homologados | XML, validações locais e processamento de fila com respostas simuladas |",
  "| Entrega de e-mail real | Remetente e conta não configurados | Tokens, filas e recuperação de senha sem enviar e-mail externo |",
  "| DNS, HTTPS público e webhooks pela internet | Fora do escopo; domínio/deploy proibidos nesta etapa | Origens, proxies e cookies de produção em processos locais |",
  "| Navegadores e dispositivos físicos adicionais | Suíte executada no Chromium local | Desktop e viewports móveis; sem certificação em Safari/Firefox/aparelhos reais |", "",
  "A newsletter do HTML permanece uma manifestação local de interesse; o envio não está implementado nem é considerado aprovado. Funções com exclusão física não disponível usam a inativação, cancelamento ou estorno já previstos; nenhuma exclusão nova foi criada.", "",
  "## Preservação do ambiente", "",
  `Comparação do banco principal e .env: **${unchanged ? "PRESERVADOS" : "DIFERENÇAS DETECTADAS"}**.`,
  `Tabelas com diferença de conteúdo/quantidade: ${changed.length ? changed.join(", ") : "nenhuma"}. .env: ${before.envHash === after.envHash ? "idêntico" : "alterado"}.`, "",
  "As assinaturas usadas na comparação ficam apenas nos artefatos locais; os registros e segredos não são copiados para o relatório.", "",
  "## Confirmação dos fluxos críticos", "",
  result.aprovado && unchanged ? "Os fluxos críticos cobertos pela suíte passaram nas condições locais descritas: autenticação e permissões, cadastros, estoque, vendas/compras, recebimentos e estornos, conta/carrinho/checkout e processamento de fotos. Isso não confirma as integrações reais listadas como não executadas." : "Não há confirmação integral de estabilidade: os cenários reprovados e/ou diferenças de ambiente precisam ser diagnosticados antes de avançar. As funções que passaram estão discriminadas nos resultados.", "",
  "## Detalhamento dos testes", "");
for (const suite of result.suites) {
  lines.push("### " + suite.id, "", "Tipo: " + suite.tipo + ". Log: `" + path.relative(root, suite.log).replaceAll(path.sep, "/") + "`.", "");
  for (const item of suite.casos) lines.push(`- ${item.type === "test:pass" ? "APROVADO" : "FALHA"}${item.skip ? " (ignorado)" : ""}: ${item.name}`);
  lines.push("");
}
lines.push("## Como repetir", "", "Consulte `TESTES-E2E.md`. Com build e infraestrutura locais prontos: `npx --yes pnpm@12.15.0 test:e2e`.", "", "Resultado estruturado: `" + path.relative(root, latest).replaceAll(path.sep, "/") + "/resultado.json`.", "");
const target = path.join(root, "output/e2e/RELATORIO-E2E-2026-11-18.md");
await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, lines.join("\n"));
console.log(JSON.stringify({ relatorio: target, aprovado: result.aprovado, ambientePreservado: unchanged, totais: result.totais, cenariosIndividuaisAprovados: leafTotal }));
