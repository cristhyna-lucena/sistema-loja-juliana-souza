import { z } from "zod";
import { custoSchema } from "./catalogo";
export const gestaoId = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/, "Identificador inválido.");
const nome = z.string().trim().min(1).max(160).transform(v => v.replace(/\s+/g, " "));
// CNPJ numérico/alfanumérico: DV conforme manual da Receita Federal (ASCII - 48).
function documentoValido(v: string) {
  if (!/^(?:\d{11}|[A-Z0-9]{12}\d{2})$/.test(v) || /^(\d)\1+$/.test(v)) return false;
  const digito = (base: string, pesos: number[]) => {
    const resto = [...base].reduce((sum, n, i) => sum + (n.charCodeAt(0) - 48) * pesos[i], 0) % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  if (v.length === 11) return [9, 10].every(n => digito(v.slice(0, n), Array.from({ length: n }, (_, i) => n + 1 - i)) === Number(v[n]));
  return digito(v.slice(0, 12), [5,4,3,2,9,8,7,6,5,4,3,2]) === Number(v[12]) && digito(v.slice(0, 13), [6,5,4,3,2,9,8,7,6,5,4,3,2]) === Number(v[13]);
}
const documento = z.string().trim().toUpperCase().regex(/^[A-Z0-9.\/-]+$/).transform(v => v.replace(/[.\/-]/g, "")).refine(documentoValido, "CPF/CNPJ inválido.");
const contato = {
  nome,
  cpfCnpj: documento.nullable(),
  email: z.email().max(254).transform(v => v.toLowerCase()).nullable(),
  telefone: z.string().trim().regex(/^\+?[\d ()-]{8,25}$/).nullable(),
  ativo: z.boolean(),
};
const contatoCriacao = { ...contato, cpfCnpj: contato.cpfCnpj.default(null), email: contato.email.default(null), telefone: contato.telefone.default(null), ativo: contato.ativo.default(true) };
export const clienteSchema = z.strictObject(contatoCriacao);
export const fornecedorSchema = z.strictObject({ ...contatoCriacao, cpfCnpj: documento });
export const clienteEdicaoSchema = z.strictObject(contato).partial().extend({ versao: z.number().int().positive() }).refine(v => Object.keys(v).length > 1, "Informe uma alteração.");
export const fornecedorEdicaoSchema = z.strictObject({ ...contato, cpfCnpj: documento }).partial().extend({ versao: z.number().int().positive() }).refine(v => Object.keys(v).length > 1, "Informe uma alteração.");
export const quantidadeSchema = z.string().trim().regex(/^-?\d{1,9}([.,]\d{1,3})?$/, "Use até três casas decimais.").transform(v => v.replace(",", ".")).refine(v => !/^-?0+(\.0+)?$/.test(v), "A quantidade não pode ser zero.");
const data = z.iso.date();
export const loteSchema = z.strictObject({ numero: z.string().trim().min(1).max(80).transform(v => v.normalize("NFKC").toUpperCase()), validade: data.nullable().default(null) });
const motivo = z.string().trim().min(3).max(500);
const chaveOperacao = z.string().uuid();
export const movimentoSchema = z.strictObject({
  tipo: z.enum(["ENTRADA", "SAIDA", "AJUSTE"]),
  quantidade: quantidadeSchema,
  loteId: gestaoId.nullable().default(null), motivo, chaveOperacao,
  custoUnitario: custoSchema.optional(),
}).refine(v => v.tipo === "AJUSTE" || !v.quantidade.startsWith("-"), "Informe quantidade positiva para entrada ou saída.")
  .refine(v => v.custoUnitario === undefined || v.tipo !== "SAIDA" && !v.quantidade.startsWith("-"), { message: "Saídas e ajustes negativos usam o custo médio do estoque.", path: ["custoUnitario"] });
export const alertasEstoqueSchema = z.strictObject({
  q: z.string().trim().max(100).default(""),
  tipo: z.enum(["todos", "REPOSICAO", "VENCIDO", "A_VENCER"]).default("todos"),
  dias: z.coerce.number().int().min(0).max(365).default(30),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ConsultaAlertasEstoque = z.infer<typeof alertasEstoqueSchema>;
export type AlertaEstoqueDTO = { produtoId: string; nome: string; sku: string; unidade: string; tipo: "REPOSICAO" | "VENCIDO" | "A_VENCER"; loteId: string | null; numero: string | null; validade: string | null; saldo: string; estoqueMinimo: string };
export type AlertasEstoqueDTO = { itens: AlertaEstoqueDTO[]; total: number; page: number; pageSize: number; pages: number; dataReferencia: string; dias: number; resumo: { reposicao: number; vencidos: number; aVencer: number } };
export const estornoSchema = z.strictObject({ motivo, chaveOperacao });
export const listaMovimentosSchema = z.strictObject({
  loteId: gestaoId.optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ClienteInput = z.infer<typeof clienteSchema>;
export type FornecedorInput = z.infer<typeof fornecedorSchema>;
export type ContatoEdicao = z.infer<typeof clienteEdicaoSchema>;
export type LoteInput = z.infer<typeof loteSchema>;
export type MovimentoInput = z.infer<typeof movimentoSchema>;
export type EstornoInput = z.infer<typeof estornoSchema>;
export type ListaMovimentos = z.infer<typeof listaMovimentosSchema>;
