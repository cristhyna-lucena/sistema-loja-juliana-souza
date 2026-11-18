import { z } from "zod";
import { gestaoId } from "./gestao";
import { operacaoId } from "./operacoes";
import { enderecoSchema } from "./administracao";
export const importarXmlSchema = z.strictObject({
  chaveOperacao: operacaoId,
  xml: z.string().min(1).max(2_000_000),
});
export const emitirNotaSchema = z
  .strictObject({
    chaveOperacao: operacaoId,
    vendaId: gestaoId.optional(),
    voucherId: gestaoId.optional(),
    modelo: z.enum(["NFE", "NFCE", "NFSE"]),
    endereco: enderecoSchema.nullable().default(null),
    codigoListaServico: z
      .string()
      .regex(/^\d{2}\.\d{2}$/)
      .optional(),
    aliquotaIss: z
      .string()
      .regex(/^\d{1,2}(\.\d{1,4})?$/)
      .optional(),
  })
  .refine(
    (value) =>
      value.modelo === "NFSE"
        ? !!value.voucherId && !value.vendaId
        : !!value.vendaId && !value.voucherId,
    "Selecione a venda ou o voucher conforme o modelo da nota.",
  );
export type EmitirNotaInput = z.infer<typeof emitirNotaSchema>;
export const correcaoNotaSchema = z.strictObject({
  chaveOperacao: operacaoId,
  correcao: z.string().trim().min(15).max(1000),
});
export const cancelarNotaSchema = z.strictObject({
  chaveOperacao: operacaoId,
  motivo: z.string().trim().min(15).max(255),
});
