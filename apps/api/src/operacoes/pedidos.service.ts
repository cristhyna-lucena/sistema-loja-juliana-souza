import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@sistema/db";
import { enderecoSchema, type ListaOperacoes } from "@sistema/shared";
import type { Identity } from "../auth/auth.service";
import { DatabaseService } from "../database.service";
import { ComercialService } from "../comercial/comercial.service";
import { VendasService } from "../comercial/vendas.service";
import { MediaStorage } from "@sistema/media";
import { ServicosService } from "./servicos.service";

@Injectable()
export class PedidosService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(ComercialService) private readonly comercial: ComercialService,
    @Inject(VendasService) private readonly vendas: VendasService,
    @Inject(ServicosService) private readonly servicos: ServicosService,
  ) {}
  async detalheTx(tx: Prisma.TransactionClient, empresaId: string, id: string) {
    const pedido = await tx.pedidoOnline.findFirst({
      where: { empresaId, id },
    });
    if (!pedido) throw new NotFoundException("Pedido não encontrado.");
    const cliente = await tx.cliente.findFirst({
      where: { empresaId, id: pedido.clienteId },
      select: { nome: true, cpfCnpj: true, email: true, telefone: true },
    });
    const notas = pedido.vendaId
      ? await tx.notaEmitida.findMany({
          where: { empresaId, vendaId: pedido.vendaId },
          select: { id: true, modelo: true, status: true },
        })
      : [];
    return {
      ...pedido,
      total: pedido.total.toFixed(2),
      subtotal: pedido.subtotal.toFixed(2),
      frete: pedido.frete.toFixed(2),
      cliente,
      notas,
    };
  }
  detalhe(empresaId: string, id: string) {
    return this.db.client.$transaction(
      (tx) => this.detalheTx(tx, empresaId, id),
      { isolationLevel: "RepeatableRead" },
    );
  }
  async listar(empresaId: string, query: ListaOperacoes) {
    const numero = /^\d{1,9}$/.test(query.q) ? Number(query.q) : undefined;
    const clientes = query.q
      ? await this.db.client.cliente.findMany({
          where: {
            empresaId,
            nome: { contains: query.q, mode: "insensitive" },
          },
          select: { id: true },
          take: 100,
        })
      : [];
    const where: Prisma.PedidoOnlineWhereInput = {
      empresaId,
      ...(query.q
        ? {
            OR: [
              { clienteId: { in: clientes.map((cliente) => cliente.id) } },
              ...(numero === undefined ? [] : [{ numero }]),
            ],
          }
        : {}),
    };
    const [itens, total] = await this.db.client.$transaction([
      this.db.client.pedidoOnline.findMany({
        where,
        select: {
          id: true,
          numero: true,
          status: true,
          total: true,
          createdAt: true,
          gateway: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.pageSize,
        skip: (query.page - 1) * query.pageSize,
      }),
      this.db.client.pedidoOnline.count({ where }),
    ]);
    return {
      itens: itens.map((item) => ({ ...item, total: item.total.toFixed(2) })),
      total,
      page: query.page,
      pages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }
  cancelar(
    user: Identity,
    id: string,
    input: { chaveOperacao: string; motivo: string },
  ) {
    return this.comercial.executar(
      user,
      "CANCELAR_PEDIDO:" + id,
      input,
      async (tx) => {
        const pedido = await tx.pedidoOnline.findFirst({
          where: { empresaId: user.empresaId, id },
        });
        if (!pedido) throw new NotFoundException("Pedido não encontrado.");
        if (
          [
            "CANCELADO",
            "REEMBOLSADO",
            "REEMBOLSO_PENDENTE",
            "REEMBOLSO_SOLICITADO",
          ].includes(pedido.status)
        )
          throw new ConflictException(
            "Pedido já cancelado ou com reembolso em andamento.",
          );
        if (pedido.vendaId)
          await this.vendas.cancelarTx(tx, user, pedido.vendaId, input.motivo);
        if (pedido.servicoFrete === "SEM_ENTREGA") {
          const itens = pedido.itens as unknown as { voucherIds?: string[] }[];
          for (const voucherId of itens.flatMap(
            (item) => item.voucherIds ?? [],
          ))
            await this.servicos.cancelarTx(tx, user, voucherId, input.motivo);
        }
        await tx.reservaEstoque.deleteMany({
          where: { empresaId: user.empresaId, pedidoId: id },
        });
        await tx.pedidoOnline.update({
          where: { id },
          data: {
            status: pedido.pagamentoId ? "REEMBOLSO_PENDENTE" : "CANCELADO",
          },
        });
        if (pedido.pagamentoId)
          await tx.integracaoJob.createMany({
            data: [
              {
                empresaId: user.empresaId,
                tipo: "PAGAMENTO_REEMBOLSAR",
                referencia: pedido.gateway + ":" + pedido.pagamentoId,
                payload: {
                  gateway: pedido.gateway,
                  pagamentoId: pedido.pagamentoId,
                  pedidoId: pedido.id,
                },
              },
            ],
            skipDuplicates: true,
          });
        await this.comercial.auditar(tx, user, "PedidoOnline", id, "CANCELAR", {
          motivo: input.motivo,
        });
        return id;
      },
      (tx, result) => this.detalheTx(tx, user.empresaId, result),
    );
  }
  enviar(
    user: Identity,
    id: string,
    input: { chaveOperacao: string; rastreio: string },
  ) {
    return this.comercial.executar(
      user,
      "ENVIAR_PEDIDO:" + id,
      input,
      async (tx) => {
        const pedido = await tx.pedidoOnline.findFirst({
          where: { empresaId: user.empresaId, id },
        });
        if (
          !pedido ||
          pedido.servicoFrete === "SEM_ENTREGA" ||
          !["PAGO", "FATURADO"].includes(pedido.status)
        )
          throw new ConflictException(
            "O pedido deve conter produtos, estar pago e aguardando envio.",
          );
        await tx.pedidoOnline.update({
          where: { id },
          data: { status: "ENVIADO", rastreio: input.rastreio },
        });
        await tx.integracaoJob.create({
          data: {
            empresaId: user.empresaId,
            tipo: "CORREIOS_RASTREAR",
            referencia: input.chaveOperacao,
            payload: { pedidoId: id },
          },
        });
        const cliente = await tx.cliente.findFirst({
          where: { empresaId: user.empresaId, id: pedido.clienteId },
          select: { email: true },
        });
        if (
          cliente?.email &&
          process.env.RESEND_API_KEY &&
          process.env.EMAIL_FROM
        )
          await tx.integracaoJob.create({
            data: {
              empresaId: user.empresaId,
              tipo: "EMAIL",
              referencia: "enviado-" + id,
              payload: {
                para: cliente.email,
                assunto: "Seu pedido foi enviado",
                texto:
                  "O pedido " +
                  pedido.numero +
                  " foi enviado. Código de rastreio " +
                  input.rastreio +
                  ". Acompanhe a entrega na sua conta da loja.",
              },
            },
          });
        await this.comercial.auditar(tx, user, "PedidoOnline", id, "ENVIAR", {
          rastreio: input.rastreio,
        });
        return id;
      },
      (tx, result) => this.detalheTx(tx, user.empresaId, result),
    );
  }
  etiqueta(
    user: Identity,
    id: string,
    input: { chaveOperacao: string; codigoServico: string },
  ) {
    return this.comercial.executar(
      user,
      "ETIQUETA_PEDIDO:" + id,
      input,
      async (tx) => {
        const pedido = await tx.pedidoOnline.findFirst({
          where: { empresaId: user.empresaId, id },
        });
        if (!pedido || !["PAGO", "FATURADO"].includes(pedido.status))
          throw new ConflictException(
            "O pedido deve estar pago e aguardando envio.",
          );
        const empresa = await tx.empresa.findUniqueOrThrow({
          where: { id: user.empresaId },
          include: { configuracao: true },
        });
        const endereco = enderecoSchema.safeParse(
            empresa.configuracao?.endereco,
          ),
          destino = enderecoSchema.safeParse(pedido.endereco);
        if (
          !empresa.cnpj ||
          !endereco.success ||
          !destino.success ||
          !empresa.configuracao?.razaoSocial
        )
          throw new BadRequestException(
            "Complete os dados e o endereço da empresa e confira o destinatário.",
          );
        if ((pedido.envio as { prepostagemId?: string } | null)?.prepostagemId)
          throw new ConflictException(
            "Já existe uma pré-postagem para este pedido.",
          );
        const cliente = await tx.cliente.findFirstOrThrow({
          where: { empresaId: user.empresaId, id: pedido.clienteId },
        });
        const itens = pedido.itens as unknown as {
          produtoId: string;
          quantidade: number;
        }[];
        const produtos = await tx.produtoComplemento.findMany({
          where: {
            empresaId: user.empresaId,
            produtoId: { in: itens.map((item) => item.produtoId) },
          },
        });
        if (
          produtos.length !== itens.length ||
          produtos.some(
            (produto) =>
              !produto.pesoGramas ||
              !produto.alturaCm ||
              !produto.larguraCm ||
              !produto.comprimentoCm,
          )
        )
          throw new BadRequestException(
            "Complete peso e dimensões dos produtos.",
          );
        const peso = produtos.reduce(
          (sum, produto) =>
            sum +
            produto.pesoGramas! *
              itens.find((item) => item.produtoId === produto.produtoId)!
                .quantidade,
          0,
        );
        const altura = produtos.reduce(
          (sum, produto) =>
            sum +
            produto.alturaCm! *
              itens.find((item) => item.produtoId === produto.produtoId)!
                .quantidade,
          0,
        );
        const largura = Math.max(
            11,
            ...produtos.map((produto) => produto.larguraCm!),
          ),
          comprimento = Math.max(
            16,
            ...produtos.map((produto) => produto.comprimentoCm!),
          );
        if (
          peso > 30000 ||
          altura > 100 ||
          altura + largura + comprimento > 200
        )
          throw new BadRequestException("O pacote excede os limites de envio.");
        const payload = {
          remetente: {
            nome: empresa.configuracao.razaoSocial,
            cpfCnpj: empresa.cnpj,
            endereco: {
              cep: endereco.data.cep,
              logradouro: endereco.data.logradouro,
              numero: endereco.data.numero,
              complemento: endereco.data.complemento,
              bairro: endereco.data.bairro,
              cidade: endereco.data.cidade,
              uf: endereco.data.uf,
            },
          },
          destinatario: {
            nome: cliente.nome,
            cpfCnpj: cliente.cpfCnpj,
            email: cliente.email,
            endereco: {
              cep: destino.data.cep,
              logradouro: destino.data.logradouro,
              numero: destino.data.numero,
              complemento: destino.data.complemento,
              bairro: destino.data.bairro,
              cidade: destino.data.cidade,
              uf: destino.data.uf,
            },
          },
          codigoServico: input.codigoServico,
          pesoInformado: String(peso),
          codigoFormatoObjetoInformado: "2",
          alturaInformada: String(Math.max(2, altura)),
          larguraInformada: String(largura),
          comprimentoInformado: String(comprimento),
          numeroCartaoPostagem: process.env.CORREIOS_CARTAO_POSTAGEM ?? "",
        };
        await tx.integracaoJob.createMany({
          data: [
            {
              empresaId: user.empresaId,
              tipo: "CORREIOS_ETIQUETA",
              referencia: id,
              payload: { pedidoId: id, prepostagem: payload },
            },
          ],
          skipDuplicates: true,
        });
        await this.comercial.auditar(
          tx,
          user,
          "PedidoOnline",
          id,
          "SOLICITAR_ETIQUETA",
          { codigoServico: input.codigoServico },
        );
        return id;
      },
      (tx, result) => this.detalheTx(tx, user.empresaId, result),
    );
  }
  async arquivoEtiqueta(empresaId: string, id: string) {
    const pedido = await this.db.client.pedidoOnline.findFirst({
      where: { empresaId, id },
    });
    if (!pedido?.etiquetaUrl)
      throw new NotFoundException("Etiqueta ainda indisponível.");
    const prefixo = "empresas/" + empresaId + "/pedidos/" + id + "/";
    if (!pedido.etiquetaUrl.startsWith(prefixo))
      throw new BadRequestException("Arquivo de etiqueta inválido.");
    const storage = new MediaStorage();
    try {
      return await storage.read(pedido.etiquetaUrl);
    } finally {
      storage.close();
    }
  }
}
