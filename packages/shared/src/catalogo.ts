import { z } from "zod";
const nome = z.string().trim().min(1, "Informe o nome.").max(160, "Use até 160 caracteres.").transform(value => value.replace(/\s+/g, " "));
const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/, "Identificador inválido.");
export const precoSchema = z.string().trim().regex(/^\d{1,10}([.,]\d{1,2})?$/, "Informe um preço não negativo, com até duas casas decimais.").transform(value => { const [inteiro, decimal = ""] = value.replace(",", ".").split("."); return BigInt(inteiro).toString() + "." + decimal.padEnd(2, "0"); });
export const custoSchema = z.string().trim().regex(/^\d{1,8}([.,]\d{1,4})?$/, "Informe um custo não negativo, com até quatro casas decimais.").transform(value => { const [inteiro, decimal = ""] = value.replace(",", ".").split("."); return BigInt(inteiro).toString() + "." + decimal.padEnd(4, "0"); });
export const estoqueMinimoSchema = z.string().trim().regex(/^\d{1,9}([.,]\d{1,3})?$/, "Informe uma quantidade não negativa, com até três casas decimais.").transform(value => { const [inteiro, decimal = ""] = value.replace(",", ".").split("."); return BigInt(inteiro).toString() + "." + decimal.padEnd(3, "0"); });
const produtoCampos = z.strictObject({
  nome, descricao: z.string().trim().max(5000, "Use até 5000 caracteres.").nullable().transform(value => value || null),
  sku: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9._\/-]{0,63}$/, "Use até 64 letras sem acentos, números, ponto, barra, hífen ou sublinhado."),
  tipo: z.enum(["REVENDA", "INSUMO", "AMBOS"]),
  unidade: z.enum(["UN", "ML", "G", "L", "KG"]),
  precoVenda: precoSchema, categoriaId: id.nullable(), ativo: z.boolean(),
  custoCompra: custoSchema.nullable(), estoqueMinimo: estoqueMinimoSchema,
});
export const produtoSchema = produtoCampos.extend({ custoCompra: custoSchema.nullable().default(null), estoqueMinimo: estoqueMinimoSchema.default("0.000") });
export const categoriaSchema = z.strictObject({ nome, ativa: z.boolean() });
const versao = z.number().int().positive();
export const produtoEdicaoSchema = produtoCampos.partial().extend({ versao }).refine(value => Object.keys(value).length > 1, "Informe uma alteração.");
export const categoriaEdicaoSchema = categoriaSchema.partial().extend({ versao }).refine(value => Object.keys(value).length > 1, "Informe uma alteração.");
export const listaCatalogoSchema = z.strictObject({
  q: z.string().trim().max(100).default(""),
  status: z.enum(["todos", "ativos", "inativos"]).default("todos"),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ProdutoInput = z.infer<typeof produtoSchema>;
export type ProdutoEdicao = z.infer<typeof produtoEdicaoSchema>;
export type CategoriaInput = z.infer<typeof categoriaSchema>;
export type CategoriaEdicao = z.infer<typeof categoriaEdicaoSchema>;
export type ListaCatalogo = z.infer<typeof listaCatalogoSchema>;
export type CategoriaDTO = { id: string; nome: string; ativa: boolean; versao: number };
export type ProdutoDTO = Omit<ProdutoInput, "categoriaId"> & { id: string; categoriaId: string | null; categoria: CategoriaDTO | null; custoMedio: string | null; imagemPrincipal?: {id:string;alt:string}; versao: number };
export type Pagina<T> = { itens: T[]; total: number; page: number; pageSize: number; pages: number };
export function formatPrice(value: string) { const [whole, cents = "00"] = value.split("."); return "R$\u00a0" + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "," + cents.padEnd(2, "0"); }
