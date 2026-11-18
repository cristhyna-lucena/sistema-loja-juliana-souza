import { z } from "zod";
import { precoSchema } from "./catalogo";
import { gestaoId } from "./gestao";
const chaveOperacao = z.string().uuid().transform(v => v.toLowerCase());
const positivo = precoSchema.refine(v => v !== "0.00", "Informe um valor maior que zero.");
const quantidade = z.string().trim().regex(/^\d{1,9}([.,]\d{1,3})?$/, "Informe quantidade positiva com até três casas decimais.").transform(v => { const [i, d = ""] = v.replace(",", ".").split("."); return BigInt(i).toString() + "." + d.padEnd(3, "0"); }).refine(v => v !== "0.000", "Informe quantidade maior que zero.");
export const formaFinanceiraSchema = z.enum(["DINHEIRO", "PIX", "CARTAO_CREDITO", "CARTAO_DEBITO", "TRANSFERENCIA", "BOLETO"]);
export const baixaCampos = z.strictObject({ contaId: gestaoId, forma: formaFinanceiraSchema, valor: positivo, data: z.iso.date().nullable().default(null), taxa: precoSchema.optional() });
export const baixaFinanceiraSchema = baixaCampos.extend({ chaveOperacao });
export const vendaSchema = z.strictObject({
  clienteId: gestaoId.nullable().default(null),
  itens: z.array(z.strictObject({ produtoId: gestaoId, quantidade, precoUnitario: precoSchema })).min(1).max(30).refine(v => new Set(v.map(i => i.produtoId)).size === v.length, "Cada produto deve aparecer uma única vez na venda."),
  desconto: precoSchema.default("0.00"), vencimento: z.iso.date().nullable().default(null),
  recebimento: baixaCampos.nullable().default(null),
  observacao: z.string().trim().max(500).nullable().default(null), chaveOperacao,
});
export const motivoComercialSchema = z.strictObject({ motivo: z.string().trim().min(3, "Informe um motivo com pelo menos três caracteres.").max(500), chaveOperacao });
export const tituloFinanceiroSchema = z.strictObject({ tipo: z.enum(["PAGAR", "RECEBER"]), descricao: z.string().trim().min(3).max(160), valor: positivo, vencimento: z.iso.date(), clienteId: gestaoId.nullable().default(null), fornecedorId: gestaoId.nullable().default(null), categoriaId: gestaoId.nullable().optional(), chaveOperacao }).refine(v => v.tipo === "PAGAR" ? v.clienteId === null : v.fornecedorId === null, "Vincule cliente a contas a receber e fornecedor a contas a pagar.");
const contaCampos = z.strictObject({ nome: z.string().trim().min(1).max(100).transform(v => v.replace(/\s+/g, " ")), tipo: z.enum(["CAIXA", "BANCO"]), ativa: z.boolean() });
export const contaFinanceiraSchema = contaCampos.extend({ ativa: z.boolean().default(true), chaveOperacao });
export const contaFinanceiraEdicaoSchema = contaCampos.partial().extend({ versao: z.number().int().positive(), chaveOperacao }).refine(v => Object.keys(v).length > 2, "Informe uma alteração.");
const paginacao = { page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) };
export const listaVendasSchema = z.strictObject({ ...paginacao, q: z.string().trim().max(100).default(""), status: z.enum(["todos", "CONFIRMADA", "CANCELADA"]).default("todos") });
export const listaTitulosSchema = z.strictObject({ ...paginacao, q: z.string().trim().max(100).default(""), tipo: z.enum(["todos", "PAGAR", "RECEBER"]).default("todos"), status: z.enum(["todos", "ABERTO", "PARCIAL", "PAGO", "CANCELADO", "ATRASADO"]).default("todos") });
export const contatosFinanceirosSchema = z.strictObject({ tipo: z.enum(["PAGAR", "RECEBER"]), q: z.string().trim().max(100).default("") });
export const caixaSchema = z.strictObject({ ...paginacao, de: z.iso.date().optional(), ate: z.iso.date().optional(), contaId: gestaoId.optional() }).refine(v => !v.de || !v.ate || v.de <= v.ate, "A data inicial deve ser anterior à final.");
export type VendaInput = z.infer<typeof vendaSchema>;
export type BaixaInput = z.infer<typeof baixaFinanceiraSchema>;
export type BaixaCampos = z.infer<typeof baixaCampos>;
export type MotivoComercial = z.infer<typeof motivoComercialSchema>;
export type TituloInput = z.infer<typeof tituloFinanceiroSchema>;
export type ContaInput = z.infer<typeof contaFinanceiraSchema>;
export type ContaEdicao = z.infer<typeof contaFinanceiraEdicaoSchema>;
export type ListaVendas = z.infer<typeof listaVendasSchema>;
export type ListaTitulos = z.infer<typeof listaTitulosSchema>;
export type ConsultaCaixa = z.infer<typeof caixaSchema>;
export type ContaFinanceiraDTO = { id: string; nome: string; tipo: string; ativa: boolean; versao: number; saldo?: string };
export type TituloFinanceiroDTO = { id: string; tipo: "PAGAR" | "RECEBER"; descricao: string; valor: string; valorPago: string; saldo: string; vencimento: string; status: "ABERTO" | "PARCIAL" | "PAGO" | "CANCELADO"; atrasado: boolean; origemTipo?: string | null; origemId?: string | null; vendaId: string | null; clienteId: string | null; fornecedorId: string | null; canceladoEm: string | null; motivoCancelamento: string | null };
export type LancamentoFinanceiroDTO = { id: string; tituloId: string; contaId: string; valor: string; forma: z.infer<typeof formaFinanceiraSchema>; data: string; motivo: string; estornoDeId: string | null; estornado: boolean; conta: string; descricao: string; conciliadoEm?: string | null; referenciaExterna?: string | null };
export type VendaDTO = { id: string; numero: number; clienteId: string | null; clienteNome: string | null; status: "CONFIRMADA" | "CANCELADA"; subtotal: string; desconto: string; total: string; observacao: string | null; createdAt: string; canceladaEm: string | null; motivoCancelamento: string | null; titulo: TituloFinanceiroDTO; itens: { id: string; produtoId: string; nome: string; sku: string; unidade: string; quantidade: string; precoUnitario: string; total: string }[]; recebimentos: LancamentoFinanceiroDTO[]; parcelas?: TituloFinanceiroDTO[] };
export type CaixaDTO = { itens: LancamentoFinanceiroDTO[]; total: number; page: number; pageSize: number; pages: number; de: string; ate: string; resumo: { entradas: string; saidas: string; resultado: string; saldoAtual: string; aPagar: string; aReceber: string } };
