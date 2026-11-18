import { z } from "zod";
import { clienteSchema, gestaoId } from "./gestao";
import { enderecoSchema } from "./administracao";
import { operacaoId } from "./operacoes";
export const lojaLoginSchema = z.strictObject({
  email: z
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  senha: z.string().min(1).max(128),
});
export const lojaCadastroSchema = z.strictObject({
  nome: clienteSchema.shape.nome,
  cpfCnpj: clienteSchema.shape.cpfCnpj.refine(
    (value) => !!value,
    "Informe CPF/CNPJ.",
  ),
  telefone: clienteSchema.shape.telefone,
  email: z
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  senha: z.string().min(12).max(128),
  consentimento: z.literal(true),
});
export const carrinhoSchema = z
  .array(
    z.strictObject({
      produtoId: gestaoId,
      quantidade: z.number().int().min(1).max(1000),
    }),
  )
  .min(1)
  .max(30)
  .refine(
    (value) =>
      new Set(value.map((item) => item.produtoId)).size === value.length,
    "Cada produto deve aparecer uma vez.",
  );
export const freteConsultaSchema = z.strictObject({
  itens: carrinhoSchema,
  cep: z.string().regex(/^\d{8}$/),
});
export const checkoutSchema = z.strictObject({
  chaveOperacao: operacaoId,
  itens: carrinhoSchema,
  endereco: enderecoSchema,
  gateway: z.enum(["MERCADO_PAGO", "ASAAS", "PAGARME"]),
  servicoFrete: z.string().regex(/^(GRATIS|\d{5})$/),
  cpfNaNota: z.boolean(),
  notaPorEmail: z.boolean(),
});
export type CheckoutLojaInput = z.infer<typeof checkoutSchema>;
export const lojaCatalogoSchema = z.strictObject({
  q: z.string().trim().max(100).default(""),
  categoriaId: gestaoId.optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(40).default(12),
});
export type LojaProdutoDTO = {
  id: string;
  nome: string;
  descricao: string | null;
  preco: string;
  slug: string;
  categoria: string | null;
  disponivel: string;
  imagens: { id: string; alt: string }[];
};
export const checkoutServicoSchema = z.strictObject({
  chaveOperacao: operacaoId,
  servicoId: gestaoId,
  quantidade: z.number().int().min(1).max(10),
  gateway: z.enum(["MERCADO_PAGO", "ASAAS", "PAGARME"]),
  notaPorEmail: z.boolean(),
});
export type CheckoutServicoInput = z.infer<typeof checkoutServicoSchema>;
