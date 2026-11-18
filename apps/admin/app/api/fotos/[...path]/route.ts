import { NextRequest } from "next/server";
import { PHOTO_VARIANTS, type PhotoVariant } from "@sistema/shared";
import { apiUrl } from "../../../../lib/auth";
async function proxy(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const id = (value?: string) => !!value && /^[A-Za-z0-9_-]{1,80}$/.test(value);
  if (path[0] !== "produtos" || !id(path[1]) || path[2] !== "imagens") return new Response(null,{status:404});
  const gallery = path.length === 3 && req.method === "GET";
  const start = path.length === 4 && ["iniciar","ordenar"].includes(path[3]) && req.method === "POST";
  const edit = path.length === 4 && id(path[3]) && req.method === "PATCH";
  const action = path.length === 5 && id(path[3]) && ["confirmar","remover","restaurar","cancelar"].includes(path[4]) && req.method === "POST";
  const binary = path.length === 6 && id(path[3]) && path[4] === "arquivo" && PHOTO_VARIANTS.includes(path[5] as PhotoVariant) && req.method === "GET";
  if (!gallery && !start && !edit && !action && !binary) return new Response(null,{status:404});
  if (req.method !== "GET" && req.headers.get("origin") !== (process.env.ADMIN_ORIGIN ?? "http://127.0.0.1:3001")) return Response.json({message:"Origem não permitida."},{status:403});
  let body: string | undefined;
  if (req.method !== "GET") {
    if (!req.headers.get("content-type")?.startsWith("application/json")) return Response.json({message:"Envie os dados em JSON."},{status:400});
    const reader = req.body?.getReader(); if (!reader) return Response.json({message:"Dados inválidos."},{status:400});
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > 32768) { await reader.cancel(); return Response.json({message:"Requisição muito grande."},{status:413}); } chunks.push(chunk.value); }
    body = Buffer.concat(chunks).toString("utf8");
  }
  try {
    const response = await fetch(new URL("/"+path.map(encodeURIComponent).join("/"),apiUrl()), {method:req.method,body,cache:"no-store",redirect:"error",signal:AbortSignal.timeout(20000),headers:{"Content-Type":"application/json",cookie:req.headers.get("cookie") ?? "",origin:req.headers.get("origin") ?? ""}});
    const headers = new Headers({"Content-Type":response.headers.get("content-type") ?? "application/json","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"});
    return new Response(response.body,{status:response.status,headers});
  } catch { return Response.json({message:"Serviço de fotos indisponível. Tente novamente."},{status:503}); }
}
export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
