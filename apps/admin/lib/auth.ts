import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
export type Usuario = { id: string; empresaId: string; nome: string; perfil: "ADMIN" | "CONTADORA" | "OPERADOR" };
export function apiUrl() { return process.env.API_INTERNAL_URL ?? "http://127.0.0.1:3002"; }
export async function apiFetch(path: string) {
  const jar = await cookies();
  return fetch(new URL(path, apiUrl()), { headers: { cookie: jar.toString() }, cache: "no-store", signal: AbortSignal.timeout(5000) });
}
export async function currentUser(): Promise<Usuario> {
  const jar = await cookies();
  if (!jar.has("loja_session") && !jar.has("__Host-loja_session")) redirect("/login");
  let response: Response;
  try { response = await apiFetch("/auth/me"); }
  catch { throw new Error("Não foi possível conectar ao serviço. Tente novamente em instantes."); }
  if (response.status === 401) redirect("/login");
  if (!response.ok) throw new Error("Acesso temporariamente indisponível.");
  return (await response.json()).usuario;
}
