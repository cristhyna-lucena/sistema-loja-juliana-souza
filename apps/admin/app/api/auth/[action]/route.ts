import { NextRequest } from "next/server";
import { apiUrl } from "../../../../lib/auth";
async function proxy(req: NextRequest, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  if (!["login", "me", "logout", "recuperar", "redefinir"].includes(action)) return new Response(null, { status: 404 });
  if ((req.method === "GET" && action !== "me") || (req.method === "POST" && action === "me")) return new Response(null, { status: 405 });
  const origin = process.env.ADMIN_ORIGIN ?? "http://127.0.0.1:3001";
  if (req.method === "POST" && req.headers.get("origin") !== origin) return Response.json({ message: "Origem não permitida." }, { status: 403 });
  let body: string | undefined;
  if (req.method === "POST" && ["login", "recuperar", "redefinir"].includes(action)) {
    if (!req.headers.get("content-type")?.startsWith("application/json")) return Response.json({ message: "Dados inválidos." }, { status: 400 });
    const reader = req.body?.getReader();
    if (!reader) return Response.json({ message: "Dados inválidos." }, { status: 400 });
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 8192) { await reader.cancel(); return Response.json({ message: "Requisição muito grande." }, { status: 413 }); }
      chunks.push(chunk.value);
    }
    body = Buffer.concat(chunks).toString("utf8");
  }
  try {
    const response = await fetch(new URL("/auth/" + action, apiUrl()), {
      method: req.method, body, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000),
      headers: { "content-type": "application/json", cookie: req.headers.get("cookie") ?? "", origin: req.headers.get("origin") ?? "" },
    });
    const headers = new Headers({ "Cache-Control": "no-store", "Content-Type": "application/json" });
    for (const cookie of response.headers.getSetCookie()) headers.append("Set-Cookie", cookie);
    return new Response(response.status === 204 ? null : await response.text(), { status: response.status, headers });
  } catch { return Response.json({ message: "Serviço indisponível. Tente novamente em instantes." }, { status: 503 }); }
}
export const GET = proxy;
export const POST = proxy;
