"use client";
import { CatalogError } from "./catalogo-client";
export async function gestaoRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch("/api/gestao/" + path, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", ...init.headers } });
  if (response.status === 401) { window.location.assign("/login"); throw new CatalogError("Sua sessão expirou. Entre novamente.", 401); }
  const result = await response.json();
  if (!response.ok) throw new CatalogError(typeof result.message === "string" ? result.message : "Não foi possível concluir a operação.", response.status, result.code, result.errors);
  return result as T;
}
export type ContatoDTO = { id: string; nome: string; cpfCnpj: string | null; email: string | null; telefone: string | null; ativo: boolean; versao: number };
export type LoteDTO = { id: string; numero: string; validade: string | null; saldo: string; alertaValidade: "VENCIDO" | "A_VENCER" | null };
export type SaldoDTO = { produtoId: string; dataReferencia: string; saldo: string; semLote: string; lotes: LoteDTO[]; custoCompra: string | null; custoMedio: string | null; valorEstoque: string | null; estoqueMinimo: string; reposicao: boolean };
export type MovimentoDTO = { id: string; loteId: string | null; tipo: "ENTRADA" | "SAIDA" | "AJUSTE" | "ESTORNO"; quantidade: string; custoUnitario: string | null; valorMovimento: string | null; motivo: string; createdAt: string; estornoDeId: string | null; vendaId: string | null };
export function formatQuantidade(value: string) { const [inteiro, decimal = "000"] = value.split("."); return inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "," + decimal.padEnd(3, "0"); }
