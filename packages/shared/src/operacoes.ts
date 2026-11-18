import { z } from "zod";
import { custoSchema, precoSchema } from "./catalogo";
import { gestaoId, quantidadeSchema, loteSchema } from "./gestao";

export const operacaoId = z.string().uuid();
export const quantidadePositiva = quantidadeSchema.refine(
  (value) => !value.startsWith("-"),
  "Informe quantidade positiva.",
);
export const valorPositivo = precoSchema.refine(
  (value) => BigInt(value.replace(".", "")) > 0n,
  "Informe valor maior que zero.",
);
const texto = z.string().trim().min(1).max(160);
export const parcelaSchema = z.strictObject({
  valor: valorPositivo,
  vencimento: z.iso.date(),
});
export const compraSchema = z.strictObject({
  chaveOperacao: operacaoId,
  fornecedorId: gestaoId,
  notaRecebidaId: gestaoId.optional(),
  despesas: precoSchema.default("0.00"),
  desconto: precoSchema.default("0.00"),
  numero: texto,
  chaveNota: z
    .string()
    .regex(/^\d{44}$/)
    .nullable()
    .default(null),
  emitidaEm: z.iso.date(),
  observacao: z.string().trim().max(500).nullable().default(null),
  itens: z
    .array(
      z.strictObject({
        produtoId: gestaoId,
        codigoFornecedor: texto,
        quantidade: quantidadePositiva,
        fatorConversao: quantidadePositiva.default("1.000"),
        custoUnitario: custoSchema,
        lote: loteSchema.nullable().default(null),
      }),
    )
    .min(1)
    .max(100),
  parcelas: z.array(parcelaSchema).min(1).max(120),
});
export type CompraInput = z.infer<typeof compraSchema>;
export const servicoSchema = z.strictObject({
  chaveOperacao: operacaoId,
  nome: texto,
  descricao: z.string().trim().max(5000).nullable().default(null),
  preco: valorPositivo,
  duracaoMin: z.number().int().min(1).max(1440),
  codigoMunicipal: z.string().trim().max(30).nullable().default(null),
  codigoListaServico: z
    .string()
    .regex(/^\d{2}\.\d{2}$/)
    .nullable()
    .default(null),
  aliquotaIss: z
    .string()
    .regex(/^\d{1,2}(\.\d{1,4})?$/)
    .nullable()
    .default(null),
  publicadoLoja: z.boolean().default(false),
  validadeDias: z.number().int().min(1).max(3650).default(365),
  ativo: z.boolean().default(true),
  insumos: z
    .array(
      z.strictObject({ produtoId: gestaoId, quantidade: quantidadePositiva }),
    )
    .max(50)
    .refine(
      (itens) =>
        new Set(itens.map((item) => item.produtoId)).size === itens.length,
      "Insumos repetidos.",
    ),
});
export const servicoEdicaoSchema = servicoSchema.extend({
  versao: z.number().int().positive(),
});
export type ServicoInput = z.infer<typeof servicoSchema>;
export const voucherSchema = z.strictObject({
  chaveOperacao: operacaoId,
  servicoId: gestaoId,
  clienteId: gestaoId,
  vencimento: z.iso.date(),
});
export const acaoOperacaoSchema = z.strictObject({
  chaveOperacao: operacaoId,
  motivo: z.string().trim().min(3).max(500),
});
export const listaOperacoesSchema = z.strictObject({
  q: z.string().trim().max(100).default(""),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListaOperacoes = z.infer<typeof listaOperacoesSchema>;
export const categoriaFinanceiraSchema = z.strictObject({
  chaveOperacao: operacaoId,
  nome: texto,
  tipo: z.enum(["PAGAR", "RECEBER"]),
  ativa: z.boolean().default(true),
});
export const transferenciaSchema = z
  .strictObject({
    chaveOperacao: operacaoId,
    origemId: gestaoId,
    destinoId: gestaoId,
    valor: valorPositivo,
    data: z.iso.date(),
    motivo: z.string().trim().min(3).max(500),
  })
  .refine(
    (value) => value.origemId !== value.destinoId,
    "Selecione contas diferentes.",
  );
export const fechamentoSchema = z.strictObject({
  chaveOperacao: operacaoId,
  contaId: gestaoId,
  data: z.iso.date(),
  saldoContado: precoSchema,
  observacao: z.string().trim().min(3).max(500),
});
export const conciliacaoSchema = z.strictObject({
  chaveOperacao: operacaoId,
  referenciaExterna: z.string().trim().min(1).max(160),
});
export const parcelamentoSchema = z.strictObject({
  chaveOperacao: operacaoId,
  tituloId: gestaoId,
  parcelas: z.array(parcelaSchema).min(2).max(120),
});
export const relatorioSchema = z
  .strictObject({ de: z.iso.date(), ate: z.iso.date() })
  .refine((value) => value.de <= value.ate, "Confira o período.");
export const enviarPedidoSchema = z.strictObject({
  chaveOperacao: operacaoId,
  rastreio: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      /^[A-Z]{2}\d{9}[A-Z]{2}$/,
      "Informe o código de rastreio dos Correios.",
    ),
});
export const etiquetaPedidoSchema = z.strictObject({
  chaveOperacao: operacaoId,
  codigoServico: z.string().regex(/^\d{5}$/),
});
export const parcelasVendaSchema = z.strictObject({
  chaveOperacao: operacaoId,
  parcelas: z.array(parcelaSchema).min(2).max(120),
});
