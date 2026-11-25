import { z } from "zod";
import { precoSchema } from "./catalogo";
import { gestaoId } from "./gestao";
import { operacaoId } from "./operacoes";

const textoOpcional = z.string().trim().max(160).nullable().default(null);
export const enderecoSchema = z.strictObject({
  cep: z.string().regex(/^\d{8}$/),
  logradouro: z.string().trim().min(1).max(160),
  numero: z.string().trim().min(1).max(20),
  complemento: z.string().trim().max(100).default(""),
  bairro: z.string().trim().min(1).max(100),
  cidade: z.string().trim().min(1).max(100),
  uf: z.string().regex(/^[A-Z]{2}$/),
  codigoIbge: z.string().regex(/^\d{7}$/),
});
export const configuracaoSchema = z.strictObject({
  chaveOperacao: operacaoId,
  versao: z.number().int().positive(),
  nome: z.string().trim().min(1).max(160),
  cnpj: z
    .string()
    .regex(/^[A-Z0-9]{12}\d{2}$/)
    .nullable()
    .default(null),
  razaoSocial: textoOpcional,
  inscricaoEstadual: textoOpcional,
  inscricaoMunicipal: textoOpcional,
  regimeTributario: z
    .enum(["SIMPLES", "PRESUMIDO", "REAL"])
    .nullable()
    .default(null),
  endereco: enderecoSchema.nullable().default(null),
  email: z.email().nullable().default(null),
  telefone: textoOpcional,
  cepOrigem: z
    .string()
    .regex(/^\d{8}$/)
    .nullable()
    .default(null),
  serieNfe: z.number().int().min(1).max(999),
  serieNfce: z.number().int().min(1).max(999),
  ambienteFiscal: z.enum(["homologacao", "producao"]),
  integracoes: z.strictObject({
    mercadoPago: z.boolean(),
    asaas: z.boolean(),
    pagarme: z.boolean(),
    focus: z.boolean(),
    // Notas recebidas direto na SEFAZ, com o certificado A1 da empresa (sem custo de intermediário).
    sefaz: z.boolean().default(false),
    // NFS-e direto no Emissor Nacional (gratuito, certificado A1), no lugar da Focus.
    nfseNacional: z.boolean().default(false),
  }),
  freteGratisAtivo: z.boolean(),
  freteGratisMinimo: precoSchema,
  correiosAtivo: z.boolean(),
  contaOnlineId: gestaoId.nullable().default(null),
});
export type ConfiguracaoInput = z.infer<typeof configuracaoSchema>;
export const usuarioSchema = z.strictObject({
  chaveOperacao: operacaoId,
  nome: z.string().trim().min(1).max(160),
  email: z
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  perfil: z.enum(["ADMIN", "OPERADOR", "CONTADORA"]),
  senha: z.string().min(12).max(128),
});
export const usuarioEdicaoSchema = z.strictObject({
  chaveOperacao: operacaoId,
  nome: z.string().trim().min(1).max(160),
  perfil: z.enum(["ADMIN", "OPERADOR", "CONTADORA"]),
  ativo: z.boolean(),
});
const percentual = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,4})?$/)
  .refine((value) => Number(value) <= 100, "Percentual deve ser de até 100.")
  .nullable()
  .default(null);
export const complementoProdutoSchema = z.strictObject({
  chaveOperacao: operacaoId,
  versao: z.number().int().positive(),
  ncm: z
    .string()
    .regex(/^\d{8}$/)
    .nullable()
    .default(null),
  cest: z
    .string()
    .regex(/^\d{7}$/)
    .nullable()
    .default(null),
  ean: z
    .string()
    .regex(/^\d{8,14}$/)
    .nullable()
    .default(null),
  cfopVenda: z
    .string()
    .regex(/^[56]\d{3}$/)
    .nullable()
    .default(null),
  origem: z.number().int().min(0).max(8),
  csosn: z
    .string()
    .regex(/^\d{3}$/)
    .nullable()
    .default(null),
  cst: z
    .string()
    .regex(/^\d{2}$/)
    .nullable()
    .default(null),
  aliquotaIcms: percentual,
  aliquotaIbs: percentual,
  aliquotaCbs: percentual,
  cstIbsCbs: z
    .string()
    .regex(/^\d{3}$/)
    .nullable()
    .default(null),
  classificacaoIbsCbs: z
    .string()
    .regex(/^\d{6}$/)
    .nullable()
    .default(null),
  aliquotaIbsMunicipal: percentual,
  cfopInterestadual: z
    .string()
    .regex(/^6\d{3}$/)
    .nullable()
    .default(null),
  cstPis: z
    .string()
    .regex(/^\d{2}$/)
    .nullable()
    .default(null),
  cstCofins: z
    .string()
    .regex(/^\d{2}$/)
    .nullable()
    .default(null),
  aliquotaPis: percentual,
  aliquotaCofins: percentual,
  pesoGramas: z.number().int().min(1).max(30000).nullable().default(null),
  alturaCm: z.number().int().min(1).max(100).nullable().default(null),
  larguraCm: z.number().int().min(1).max(100).nullable().default(null),
  comprimentoCm: z.number().int().min(1).max(100).nullable().default(null),
  publicadoLoja: z.boolean(),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .min(1)
    .max(160),
});
export type ComplementoProdutoInput = z.infer<typeof complementoProdutoSchema>;
export const recuperarSenhaSchema = z.strictObject({
  email: z
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
});
export const redefinirSenhaSchema = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  senha: z.string().min(12).max(128),
});
