import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const html = await readFile(join(process.cwd(), "public", "original-storefront.html"), "utf8");
  const origin = process.env.ADMIN_ORIGIN ?? "http://127.0.0.1:3001";
  const config = `<script>window.lojaAdminOrigin=${JSON.stringify(origin).replace(/</g, "\\u003c")};</script>`;
  return new Response(html.replace('<script src="/original-storefront-bridge.js"', config + '<script src="/original-storefront-bridge.js"'), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
