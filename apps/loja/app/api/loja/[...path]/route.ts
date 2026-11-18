import { NextRequest } from "next/server";
async function proxy(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const route = path.join("/"),
    id = "[A-Za-z0-9_-]{1,160}";
  const get =
    /^(configuracao|produtos|categorias|conta|servicos)$/.test(route) ||
    new RegExp("^(produtos|pedidos|servicos|cep)/" + id + "$").test(route) ||
    new RegExp(
      "^imagens/" + id + "/" + id + "/(thumb|card|produto|zoom)\\.(webp|avif)$",
    ).test(route);
  const post =
    /^(frete|cadastro|login|logout|recuperar|redefinir|checkout|checkout-servico|conta\/encerrar)$/.test(
      route,
    );
  if (!((req.method === "GET" && get) || (req.method === "POST" && post)))
    return new Response(null, { status: 404 });
  if (
    req.method === "POST" &&
    req.headers.get("origin") !==
      (process.env.LOJA_ORIGIN ?? "http://127.0.0.1:3000")
  )
    return Response.json({ message: "Origem não permitida." }, { status: 403 });
  let body: string | undefined;
  if (req.method === "POST") {
    if (!req.headers.get("content-type")?.startsWith("application/json"))
      return Response.json(
        { message: "Envie os dados em JSON." },
        { status: 400 },
      );
    const reader = req.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader)
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 32768) {
          await reader.cancel();
          return Response.json(
            { message: "Requisição muito grande." },
            { status: 413 },
          );
        }
        chunks.push(chunk.value);
      }
    body = Buffer.concat(chunks).toString("utf8");
  }
  try {
    const response = await fetch(
      new URL(
        "/loja/" + path.map(encodeURIComponent).join("/") + req.nextUrl.search,
        process.env.API_INTERNAL_URL ?? "http://127.0.0.1:3002",
      ),
      {
        method: req.method,
        body,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(45000),
        headers: {
          cookie: req.headers.get("cookie") ?? "",
          origin: req.headers.get("origin") ?? "",
          "Content-Type": "application/json",
        },
      },
    );
    const headers = new Headers({
      "Content-Type":
        response.headers.get("content-type") ?? "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    for (const cookie of response.headers.getSetCookie())
      headers.append("Set-Cookie", cookie);
    return new Response(response.body, { status: response.status, headers });
  } catch {
    return Response.json(
      {
        message:
          "Não foi possível conectar à loja. Tente novamente em instantes.",
      },
      { status: 503 },
    );
  }
}
export const GET = proxy;
export const POST = proxy;
