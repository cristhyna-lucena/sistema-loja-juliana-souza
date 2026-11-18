import { NextRequest } from "next/server";
import { apiUrl } from "../../../../lib/auth";
async function proxy(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const id = /^[A-Za-z0-9_-]{1,80}$/;
  const alerta = path.length === 2 && path[0] === "estoque" && path[1] === "alertas";
  const cadastro = ["clientes", "fornecedores"].includes(path[0]) && (path.length === 1 || path.length === 2 && id.test(path[1]));
  const estoque = path[0] === "estoque" && path[1] === "produtos" && id.test(path[2] ?? "") && ((path.length === 4 && ["saldo", "movimentos", "lotes"].includes(path[3])) || (path.length === 6 && path[3] === "movimentos" && id.test(path[4]) && path[5] === "estornar"));
  const trecho = "[A-Za-z0-9_-]{1,80}";
  const comerciais: [RegExp,string[]][] = [
    [/^pedidos$/, ["GET"]],
    [new RegExp("^pedidos/"+trecho+"$"), ["GET"]],
    [new RegExp("^pedidos/"+trecho+"/(cancelar|enviar)$"), ["POST"]],
    [new RegExp("^pedidos/"+trecho+"/etiqueta$"), ["GET", "POST"]],
    [/^relatorios$/, ["GET"]],
    [new RegExp("^fiscal/integracoes/"+trecho+"/repetir$"), ["POST"]],
    [/^fiscal\/(recebidas|integracoes|opcoes|exportar)$/, ["GET"]],
    [/^fiscal\/emitidas$/, ["GET", "POST"]],
    [/^fiscal\/(recebidas\/xml|sincronizar)$/, ["POST"]],
    [new RegExp("^fiscal/recebidas/"+trecho+"$"), ["GET"]],
    [new RegExp("^fiscal/recebidas/"+trecho+"/ciencia$"), ["POST"]],
    [new RegExp("^fiscal/emitidas/"+trecho+"/(consultar|cancelar|corrigir)$"), ["POST"]],
    [new RegExp("^fiscal/emitidas/"+trecho+"/xml$"), ["GET"]],
    [/^administracao\/(configuracao|usuarios)$/, ["GET", "POST"]],
    [new RegExp("^administracao/usuarios/"+trecho+"$"), ["PATCH"]],
    [new RegExp("^administracao/produtos/"+trecho+"$"), ["GET", "POST"]],
    [/^financeiro\/(categorias|fechamentos)$/, ["GET", "POST"]],
    [/^financeiro\/transferencias$/, ["GET", "POST"]],
    [/^financeiro\/parcelamentos$/, ["POST"]],
    [new RegExp("^financeiro/transferencias/"+trecho+"/estornar$"), ["POST"]],
    [new RegExp("^financeiro/lancamentos/"+trecho+"/conciliar$"), ["POST"]],
    [/^(compras|servicos|vouchers)$/, ["GET", "POST"]],
    [new RegExp("^compras/fornecedores/"+trecho+"/vinculos$"), ["GET"]],
    [new RegExp("^(compras|servicos)/"+trecho+"$"), ["GET", "PATCH"]],
    [new RegExp("^(compras|vouchers)/"+trecho+"/(cancelar|usar)$"), ["POST"]],
    [/^vendas$/, ["GET","POST"]], [new RegExp("^vendas/"+trecho+"$"), ["GET"]], [new RegExp("^vendas/"+trecho+"/(recebimentos|cancelar|parcelar)$"), ["POST"]],
    [/^financeiro\/(contatos|caixa|contas\/opcoes)$/, ["GET"]], [/^financeiro\/contas$/, ["GET","POST"]], [new RegExp("^financeiro/contas/"+trecho+"$"), ["PATCH"]],
    [/^financeiro\/titulos$/, ["GET","POST"]], [new RegExp("^financeiro/titulos/"+trecho+"$"), ["GET"]], [new RegExp("^financeiro/titulos/"+trecho+"/(baixas|cancelar)$"), ["POST"]], [new RegExp("^financeiro/lancamentos/"+trecho+"/estornar$"), ["POST"]],
  ];
  const comercial = comerciais.find(([pattern])=>pattern.test(path.join("/")));
  if (!cadastro && !estoque && !alerta && !comercial) return new Response(null, { status: 404 });
  const permitido = comercial ? comercial[1].includes(req.method) : alerta ? req.method === "GET" : cadastro ? req.method === "GET" || req.method === "POST" && path.length === 1 || req.method === "PATCH" && path.length === 2 : req.method === "GET" && path.length === 4 && ["saldo", "movimentos"].includes(path[3]) || req.method === "POST" && (path.length === 6 || path.length === 4 && ["lotes", "movimentos"].includes(path[3]));
  if (!permitido) return new Response(null, { status: 405 });
  const origin = process.env.ADMIN_ORIGIN ?? "http://127.0.0.1:3001";
  if (req.method !== "GET" && req.headers.get("origin") !== origin) return Response.json({ message: "Origem não permitida." }, { status: 403 });
  let body: string | undefined;
  if (req.method !== "GET") {
    if (!req.headers.get("content-type")?.startsWith("application/json")) return Response.json({ message: "Envie os dados em JSON." }, { status: 400 });
    const reader = req.body?.getReader();
    if (!reader) return Response.json({ message: "Dados inválidos." }, { status: 400 });
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.length;
      if (size > (path.join("/") === "fiscal/recebidas/xml" ? 2_000_000 : 32768)) { await reader.cancel(); return Response.json({ message: "Requisição muito grande." }, { status: 413 }); }
      chunks.push(chunk.value);
    }
    body = Buffer.concat(chunks).toString("utf8");
  }
  try {
    const response = await fetch(new URL("/" + path.map(encodeURIComponent).join("/") + req.nextUrl.search, apiUrl()), { method: req.method, body, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(comercial ? 40000 : 10000), headers: { cookie: req.headers.get("cookie") ?? "", origin: req.headers.get("origin") ?? "", "Content-Type": "application/json" } });
    const headers = new Headers({ "Cache-Control": "no-store", "Content-Type": response.headers.get("content-type") ?? "application/json", "X-Content-Type-Options": "nosniff" });
    if (response.headers.has("content-disposition")) headers.set("Content-Disposition", response.headers.get("content-disposition")!);
    return new Response(response.body, { status: response.status, headers });
  } catch { return Response.json({ message: "Serviço indisponível. Tente novamente em instantes." }, { status: 503 }); }
}
export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
