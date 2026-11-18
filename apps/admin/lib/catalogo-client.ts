"use client";
export class CatalogError extends Error { constructor(message: string, public status: number, public code?: string, public errors?: { campo: string; message: string }[]) { super(message); } }
export async function catalogRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch("/api/catalogo/" + path, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", ...init.headers } });
  if (response.status === 401) { window.location.assign("/login"); throw new CatalogError("Sua sessão expirou. Entre novamente.", 401); }
  const result = await response.json();
  if (!response.ok) throw new CatalogError(typeof result.message === "string" ? result.message : "Não foi possível concluir a operação.", response.status, result.code, result.errors);
  return result as T;
}
