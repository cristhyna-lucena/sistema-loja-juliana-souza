import { NextRequest } from "next/server";
import { apiUrl } from "../../../../lib/auth";
async function proxy(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (path.length < 1 || path.length > 2 || !["produtos", "categorias"].includes(path[0]) || (path[1] && !/^[A-Za-z0-9_-]{1,80}$/.test(path[1]))) return new Response(null, { status: 404 });
  if ((req.method === "POST" && path.length !== 1) || (req.method === "PATCH" && path.length !== 2)) return new Response(null, { status: 405 });
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
      if (size > 32768) { await reader.cancel(); return Response.json({ message: "Requisição muito grande." }, { status: 413 }); }
      chunks.push(chunk.value);
    }
    body = Buffer.concat(chunks).toString("utf8");
  }
  try {
    const response = await fetch(new URL("/" + path.map(encodeURIComponent).join("/") + req.nextUrl.search, apiUrl()), { method: req.method, body, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000), headers: { cookie: req.headers.get("cookie") ?? "", origin: req.headers.get("origin") ?? "", "Content-Type": "application/json" } });
    return new Response(await response.text(), { status: response.status, headers: { "Cache-Control": "no-store", "Content-Type": "application/json" } });
  } catch { return Response.json({ message: "Serviço indisponível. Tente novamente em instantes." }, { status: 503 }); }
}
export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
