import "server-only";
import { redirect, notFound } from "next/navigation";
import { apiFetch } from "./auth";
export async function catalogData<T>(path: string): Promise<T> {
  const response = await apiFetch(path);
  if (response.status === 401) redirect("/login");
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error("Não foi possível carregar o cadastro.");
  return await response.json() as T;
}
