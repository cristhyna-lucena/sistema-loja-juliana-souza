import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import * as argon2 from "argon2";
import { Prisma } from "@sistema/db";
import type {
  ConfiguracaoInput,
  ComplementoProdutoInput,
} from "@sistema/shared";
import { DatabaseService } from "../database.service";
import { ComercialService } from "../comercial/comercial.service";
import { PASSWORD_OPTIONS } from "../auth/config";
import type { Identity } from "../auth/auth.service";
const usuarioCampos = {
  id: true,
  nome: true,
  email: true,
  perfil: true,
  ativo: true,
} as const;

@Injectable()
export class AdministracaoService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(ComercialService) private readonly comercial: ComercialService,
  ) {}
  async configuracao(empresaId: string) {
    const empresa = await this.db.client.empresa.findUniqueOrThrow({
      where: { id: empresaId },
      include: { configuracao: true },
    });
    return {
      nome: empresa.nome,
      cnpj: empresa.cnpj,
      razaoSocial: null,
      inscricaoEstadual: null,
      inscricaoMunicipal: null,
      regimeTributario: null,
      endereco: null,
      email: null,
      telefone: null,
      cepOrigem: null,
      serieNfe: 1,
      serieNfce: 1,
      ambienteFiscal: "homologacao",
      freteGratisAtivo: false,
      correiosAtivo: false,
      contaOnlineId: null,
      versao: 1,
      ...empresa.configuracao,
      freteGratisMinimo:
        empresa.configuracao?.freteGratisMinimo.toFixed(2) ?? "0.00",
      integracoes: {
        mercadoPago: !!(
          empresa.configuracao?.integracoes as { mercadoPago?: boolean } | null
        )?.mercadoPago,
        asaas: !!(
          empresa.configuracao?.integracoes as { asaas?: boolean } | null
        )?.asaas,
        pagarme: !!(
          empresa.configuracao?.integracoes as { pagarme?: boolean } | null
        )?.pagarme,
        focus: !!(
          empresa.configuracao?.integracoes as { focus?: boolean } | null
        )?.focus,
        sefaz: !!(
          empresa.configuracao?.integracoes as { sefaz?: boolean } | null
        )?.sefaz,
        nfseNacional: !!(
          empresa.configuracao?.integracoes as { nfseNacional?: boolean } | null
        )?.nfseNacional,
      },
      credenciais: {
        mercadoPago: !!process.env.MERCADO_PAGO_ACCESS_TOKEN,
        asaas: !!process.env.ASAAS_API_KEY,
        pagarme: !!process.env.PAGARME_SECRET_KEY,
        focus: !!process.env.FOCUS_TOKEN || !!process.env.FOCUS_TOKEN_PRODUCAO,
        sefaz:
          !!process.env.CERTIFICADO_A1_ARQUIVO &&
          !!process.env.CERTIFICADO_A1_SENHA_ARQUIVO,
        nfseNacional:
          !!process.env.CERTIFICADO_A1_ARQUIVO &&
          !!process.env.CERTIFICADO_A1_SENHA_ARQUIVO,
        correios:
          !!process.env.CORREIOS_USUARIO &&
          !!process.env.CORREIOS_CODIGO_ACESSO &&
          !!process.env.CORREIOS_CARTAO_POSTAGEM,
        email: !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM,
      },
    };
  }
  salvar(user: Identity, input: ConfiguracaoInput) {
    return this.comercial.executar(
      user,
      "CONFIGURAR_EMPRESA",
      input,
      async (tx) => {
        const atual = await tx.configuracaoEmpresa.findUnique({
          where: { empresaId: user.empresaId },
        });
        if ((atual?.versao ?? 1) !== input.versao)
          throw new ConflictException(
            "Configurações alteradas. Recarregue antes de salvar.",
          );
        if (
          input.contaOnlineId &&
          !(await tx.contaFinanceira.findFirst({
            where: {
              empresaId: user.empresaId,
              id: input.contaOnlineId,
              ativa: true,
            },
          }))
        )
          throw new BadRequestException(
            "Selecione uma conta financeira ativa.",
          );
        const { chaveOperacao, nome, cnpj, versao, endereco, ...data } = input;
        await tx.empresa.update({
          where: { id: user.empresaId },
          data: { nome, cnpj },
        });
        await tx.configuracaoEmpresa.upsert({
          where: { empresaId: user.empresaId },
          create: {
            ...data,
            empresaId: user.empresaId,
            endereco: endereco ?? Prisma.DbNull,
            versao: 2,
          },
          update: {
            ...data,
            endereco: endereco ?? Prisma.DbNull,
            versao: { increment: 1 },
          },
        });
        await this.comercial.auditar(
          tx,
          user,
          "Empresa",
          user.empresaId,
          "CONFIGURAR",
          {
            campos: Object.keys(data),
            integracoes: input.integracoes,
            ambienteFiscal: input.ambienteFiscal,
          },
        );
        return user.empresaId;
      },
      async (tx, id) =>
        tx.configuracaoEmpresa.findUniqueOrThrow({ where: { empresaId: id } }),
    );
  }
  usuarios(empresaId: string) {
    return this.db.client.usuario.findMany({
      where: { empresaId },
      select: usuarioCampos,
      orderBy: { nome: "asc" },
    });
  }
  async criarUsuario(
    user: Identity,
    input: {
      chaveOperacao: string;
      nome: string;
      email: string;
      perfil: Identity["perfil"];
      senha: string;
    },
  ) {
    const senhaHash = await argon2.hash(input.senha, {
      ...PASSWORD_OPTIONS,
      type: argon2.argon2id,
    });
    return this.comercial.executar(
      user,
      "CRIAR_USUARIO",
      input,
      async (tx) => {
        const row = await tx.usuario.create({
          data: {
            empresaId: user.empresaId,
            nome: input.nome,
            email: input.email,
            perfil: input.perfil,
            senhaHash,
          },
        });
        await this.comercial.auditar(tx, user, "Usuario", row.id, "CRIAR", {
          nome: row.nome,
          perfil: row.perfil,
        });
        return row.id;
      },
      (tx, id) =>
        tx.usuario.findFirstOrThrow({
          where: { empresaId: user.empresaId, id },
          select: usuarioCampos,
        }),
    );
  }
  editarUsuario(
    user: Identity,
    id: string,
    input: {
      chaveOperacao: string;
      nome: string;
      perfil: Identity["perfil"];
      ativo: boolean;
    },
  ) {
    return this.comercial.executar(
      user,
      "EDITAR_USUARIO:" + id,
      input,
      async (tx) => {
        const atual = await tx.usuario.findFirst({
          where: { empresaId: user.empresaId, id },
        });
        if (!atual) throw new NotFoundException("Usuário não encontrado.");
        if (
          atual.ativo &&
          atual.perfil === "ADMIN" &&
          (!input.ativo || input.perfil !== "ADMIN") &&
          (await tx.usuario.count({
            where: { empresaId: user.empresaId, ativo: true, perfil: "ADMIN" },
          })) === 1
        )
          throw new ConflictException(
            "Mantenha ao menos um administrador ativo.",
          );
        await tx.usuario.update({
          where: { id },
          data: { nome: input.nome, perfil: input.perfil, ativo: input.ativo },
        });
        if (!input.ativo || atual.perfil !== input.perfil)
          await tx.sessao.deleteMany({
            where: { empresaId: user.empresaId, usuarioId: id },
          });
        await this.comercial.auditar(tx, user, "Usuario", id, "EDITAR", {
          nome: input.nome,
          perfil: input.perfil,
          ativo: input.ativo,
        });
        return id;
      },
      (tx, result) =>
        tx.usuario.findFirstOrThrow({
          where: { empresaId: user.empresaId, id: result },
          select: usuarioCampos,
        }),
    );
  }
  async complemento(empresaId: string, produtoId: string) {
    const produto = await this.db.client.produto.findFirst({
      where: { empresaId, id: produtoId },
      include: { complemento: true },
    });
    if (!produto) throw new NotFoundException("Produto não encontrado.");
    return (
      produto.complemento ?? {
        produtoId,
        empresaId,
        versao: 1,
        origem: 0,
        publicadoLoja: false,
        slug:
          produto.sku
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "") || produto.id,
      }
    );
  }
  salvarComplemento(
    user: Identity,
    produtoId: string,
    input: ComplementoProdutoInput,
  ) {
    const operacao = { ...input, produtoId };
    return this.comercial.executar(
      user,
      "COMPLEMENTAR_PRODUTO:" + produtoId,
      operacao,
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Produto" WHERE "empresaId"=${user.empresaId} AND id=${produtoId} FOR UPDATE`;
        const produto = await tx.produto.findFirst({
          where: { empresaId: user.empresaId, id: produtoId },
          include: { complemento: true },
        });
        if (!produto) throw new NotFoundException("Produto não encontrado.");
        if ((produto.complemento?.versao ?? 1) !== input.versao)
          throw new ConflictException(
            "Dados alterados. Recarregue antes de salvar.",
          );
        const { chaveOperacao, versao, ...data } = input;
        await tx.produtoComplemento.upsert({
          where: { produtoId },
          create: { ...data, empresaId: user.empresaId, produtoId, versao: 2 },
          update: { ...data, versao: { increment: 1 } },
        });
        await this.comercial.auditar(
          tx,
          user,
          "Produto",
          produtoId,
          "COMPLEMENTAR",
          { publicadoLoja: input.publicadoLoja, campos: Object.keys(data) },
        );
        return produtoId;
      },
      (tx, result) =>
        tx.produtoComplemento.findUniqueOrThrow({
          where: { produtoId: result },
        }),
    );
  }
}
