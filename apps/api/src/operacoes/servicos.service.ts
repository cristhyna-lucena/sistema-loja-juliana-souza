import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import { Prisma } from "@sistema/db";
import {
  quantidadePositiva,
  type ServicoInput,
  type ListaOperacoes,
} from "@sistema/shared";
import type { Identity } from "../auth/auth.service";
import { DatabaseService } from "../database.service";
import { ComercialService, Dinheiro } from "../comercial/comercial.service";
import { FinanceiroService } from "../comercial/financeiro.service";
import { EstoqueService } from "../gestao/estoque.service";
import { dataLoja, somarDias } from "../gestao/data-loja";
export type ServicoSnapshot = {
  nome: string;
  preco: string;
  validadeDias: number;
  insumos: { produtoId: string; quantidade: string }[];
};

@Injectable()
export class ServicosService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(ComercialService) private readonly comercial: ComercialService,
    @Inject(EstoqueService) private readonly estoque: EstoqueService,
    @Inject(FinanceiroService) private readonly financeiro: FinanceiroService,
  ) {}
  async detalheTx(tx: Prisma.TransactionClient, empresaId: string, id: string) {
    const row = await tx.servico.findFirst({
      where: { empresaId, id },
      include: {
        insumos: {
          include: { produto: { select: { nome: true, unidade: true } } },
        },
      },
    });
    if (!row) throw new NotFoundException("Serviço não encontrado.");
    return {
      ...row,
      preco: row.preco.toFixed(2),
      insumos: row.insumos.map((item) => ({
        ...item,
        quantidade: item.quantidade.toFixed(3),
      })),
    };
  }
  detalhe(empresaId: string, id: string) {
    return this.db.client.$transaction(
      (tx) => this.detalheTx(tx, empresaId, id),
      { isolationLevel: "RepeatableRead" },
    );
  }
  async listar(empresaId: string, query: ListaOperacoes) {
    const where = {
      empresaId,
      ...(query.q
        ? { nome: { contains: query.q, mode: "insensitive" as const } }
        : {}),
    };
    const [itens, total] = await this.db.client.$transaction([
      this.db.client.servico.findMany({
        where,
        orderBy: [{ nome: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.db.client.servico.count({ where }),
    ]);
    return {
      itens: itens.map((row) => ({ ...row, preco: row.preco.toFixed(2) })),
      total,
      page: query.page,
      pages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }
  salvar(user: Identity, input: ServicoInput, id?: string, versao?: number) {
    const operacao = { ...input, versao };
    return this.comercial.executar(
      user,
      "SALVAR_SERVICO:" + (id ?? "novo"),
      operacao,
      async (tx) => {
        const produtos = await tx.produto.findMany({
          where: {
            empresaId: user.empresaId,
            id: { in: input.insumos.map((item) => item.produtoId) },
            ativo: true,
            tipo: { in: ["INSUMO", "AMBOS"] },
          },
        });
        if (produtos.length !== input.insumos.length)
          throw new BadRequestException(
            "Selecione insumos ativos do tipo insumo ou ambos.",
          );
        const { chaveOperacao, insumos, ...data } = input;
        let servicoId: string;
        if (id) {
          const changed = await tx.servico.updateMany({
            where: { empresaId: user.empresaId, id, versao },
            data: { ...data, versao: { increment: 1 } },
          });
          if (!changed.count)
            throw new ConflictException(
              "Serviço alterado ou indisponível. Recarregue antes de salvar.",
            );
          await tx.servicoInsumo.deleteMany({
            where: { empresaId: user.empresaId, servicoId: id },
          });
          servicoId = id;
        } else
          servicoId = (
            await tx.servico.create({
              data: { ...data, empresaId: user.empresaId },
            })
          ).id;
        await tx.servicoInsumo.createMany({
          data: insumos.map((item) => ({
            ...item,
            empresaId: user.empresaId,
            servicoId,
          })),
        });
        await this.comercial.auditar(
          tx,
          user,
          "Servico",
          servicoId,
          id ? "EDITAR" : "CRIAR",
          { nome: input.nome, preco: input.preco, insumos: insumos.length },
        );
        return servicoId;
      },
      (tx, result) => this.detalheTx(tx, user.empresaId, result),
    );
  }
  async voucherTx(tx: Prisma.TransactionClient, empresaId: string, id: string) {
    const voucher = await tx.voucher.findFirst({ where: { empresaId, id } });
    if (!voucher) throw new NotFoundException("Voucher não encontrado.");
    const cliente = await tx.cliente.findFirst({
      where: { empresaId, id: voucher.clienteId },
      select: { nome: true },
    });
    const titulo = await tx.tituloFinanceiro.findFirst({
      where: { empresaId, origemTipo: "VOUCHER", origemId: id },
    });
    return {
      ...voucher,
      valor: voucher.valor.toFixed(2),
      validoAte: voucher.validoAte.toISOString().slice(0, 10),
      expirado:
        voucher.status === "ATIVO" &&
        voucher.validoAte.toISOString().slice(0, 10) < dataLoja(),
      clienteNome: cliente?.nome,
      tituloId: titulo?.id,
    };
  }
  async vouchers(empresaId: string, query: ListaOperacoes) {
    return this.db.client.$transaction(
      async (tx) => {
        const where: Prisma.VoucherWhereInput = {
          empresaId,
          ...(query.q
            ? {
                OR: [
                  { codigo: { contains: query.q, mode: "insensitive" } },
                  { servicoNome: { contains: query.q, mode: "insensitive" } },
                ],
              }
            : {}),
        };
        const rows = await tx.voucher.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        });
        const total = await tx.voucher.count({ where });
        const itens = [];
        for (const row of rows)
          itens.push(await this.voucherTx(tx, empresaId, row.id));
        return {
          itens,
          total,
          page: query.page,
          pages: Math.max(1, Math.ceil(total / query.pageSize)),
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
  }
  vender(
    user: Identity,
    input: {
      chaveOperacao: string;
      servicoId: string;
      clienteId: string;
      vencimento: string;
    },
  ) {
    return this.comercial.executar(
      user,
      "VENDER_SERVICO",
      input,
      (tx) => this.venderTx(tx, user, input),
      (tx, result) => this.voucherTx(tx, user.empresaId, result),
    );
  }
  async venderTx(
    tx: Prisma.TransactionClient,
    user: Identity,
    input: { servicoId: string; clienteId: string; vencimento: string },
    snapshot?: ServicoSnapshot,
  ) {
    const servico = await tx.servico.findFirst({
      where: { empresaId: user.empresaId, id: input.servicoId, ativo: true },
      include: { insumos: true },
    });
    const cliente = await tx.cliente.findFirst({
      where: { empresaId: user.empresaId, id: input.clienteId, ativo: true },
    });
    if (!servico || !cliente)
      throw new BadRequestException("Selecione serviço e cliente ativos.");
    if (input.vencimento < dataLoja())
      throw new BadRequestException("O vencimento deve ser a partir de hoje.");
    const dados = snapshot ?? {
      nome: servico.nome,
      preco: servico.preco.toFixed(2),
      validadeDias: servico.validadeDias,
      insumos: servico.insumos.map((item) => ({
        produtoId: item.produtoId,
        quantidade: item.quantidade.toFixed(3),
      })),
    };
    const voucher = await tx.voucher.create({
      data: {
        empresaId: user.empresaId,
        servicoId: servico.id,
        clienteId: cliente.id,
        codigo: randomBytes(12).toString("hex").toUpperCase(),
        servicoNome: dados.nome,
        valor: dados.preco,
        ficha: dados.insumos,
        validoAte: new Date(
          somarDias(dataLoja(), dados.validadeDias) + "T00:00:00Z",
        ),
      },
    });
    await tx.tituloFinanceiro.create({
      data: {
        empresaId: user.empresaId,
        tipo: "RECEBER",
        descricao: "Serviço " + dados.nome + " · " + voucher.codigo,
        clienteId: cliente.id,
        valor: dados.preco,
        vencimento: new Date(input.vencimento + "T00:00:00Z"),
        origemTipo: "VOUCHER",
        origemId: voucher.id,
      },
    });
    await this.comercial.auditar(tx, user, "Voucher", voucher.id, "VENDER", {
      servicoId: servico.id,
      clienteId: cliente.id,
      valor: dados.preco,
    });
    return voucher.id;
  }
  usar(
    user: Identity,
    id: string,
    input: { chaveOperacao: string; motivo: string },
  ) {
    return this.comercial.executar(
      user,
      "USAR_VOUCHER:" + id,
      input,
      async (tx) => {
        const voucher = await tx.voucher.findFirst({
          where: { empresaId: user.empresaId, id },
        });
        if (!voucher) throw new NotFoundException("Voucher não encontrado.");
        if (
          voucher.status !== "ATIVO" ||
          voucher.validoAte.toISOString().slice(0, 10) < dataLoja()
        )
          throw new ConflictException(
            "Voucher utilizado, cancelado ou expirado.",
          );
        const ficha = voucher.ficha as {
          produtoId: string;
          quantidade: string;
        }[];
        for (const item of [...ficha].sort((a, b) =>
          a.produtoId.localeCompare(b.produtoId),
        )) {
          const quantidade = quantidadePositiva.parse(item.quantidade);
          await this.estoque.consumir(
            tx,
            user,
            item.produtoId,
            new Dinheiro(quantidade),
            {
              origemTipo: "VOUCHER",
              origemId: id,
              motivo: "Atendimento " + voucher.codigo,
            },
          );
        }
        await tx.voucher.update({
          where: { id },
          data: { status: "USADO", usadoEm: new Date(), motivo: input.motivo },
        });
        await this.comercial.auditar(tx, user, "Voucher", id, "UTILIZAR", {
          motivo: input.motivo,
          insumos: ficha.length,
        });
        return id;
      },
      (tx, result) => this.voucherTx(tx, user.empresaId, result),
    );
  }
  cancelar(
    user: Identity,
    id: string,
    input: { chaveOperacao: string; motivo: string },
  ) {
    return this.comercial.executar(
      user,
      "CANCELAR_VOUCHER:" + id,
      input,
      (tx) => this.cancelarTx(tx, user, id, input.motivo),
      (tx, result) => this.voucherTx(tx, user.empresaId, result),
    );
  }
  async cancelarTx(
    tx: Prisma.TransactionClient,
    user: Identity,
    id: string,
    motivo: string,
  ) {
    const voucher = await tx.voucher.findFirst({
      where: { empresaId: user.empresaId, id },
    });
    if (!voucher || voucher.status === "CANCELADO")
      throw new ConflictException("Voucher indisponível ou cancelado.");
    if (
      await tx.notaEmitida.count({
        where: {
          empresaId: user.empresaId,
          voucherId: id,
          status: { in: ["PENDENTE", "PROCESSANDO", "AUTORIZADA"] },
        },
      })
    )
      throw new ConflictException(
        "Conclua o cancelamento da nota fiscal antes de cancelar o voucher.",
      );
    const movimentos = await tx.movimentoEstoque.findMany({
      where: {
        empresaId: user.empresaId,
        origemTipo: "VOUCHER",
        origemId: id,
        tipo: "SAIDA",
      },
      orderBy: [{ produtoId: "asc" }, { createdAt: "desc" }, { id: "desc" }],
    });
    for (const produtoId of [
      ...new Set(movimentos.map((item) => item.produtoId)),
    ].sort())
      await tx.$queryRaw`SELECT id FROM "Produto" WHERE "empresaId"=${user.empresaId} AND id=${produtoId} FOR UPDATE`;
    for (const movimento of movimentos)
      await this.estoque.gravar(tx, user, movimento.produtoId, {
        loteId: movimento.loteId,
        tipo: "ESTORNO",
        quantidade: movimento.quantidade.negated(),
        custoUnitario: movimento.custoUnitario,
        valorMovimento: movimento.valorMovimento?.negated() ?? null,
        motivo,
        chaveOperacao: randomUUID(),
        estornoDeId: movimento.id,
        origemTipo: "VOUCHER",
        origemId: id,
      });
    const titulo = await tx.tituloFinanceiro.findFirst({
      where: { empresaId: user.empresaId, origemTipo: "VOUCHER", origemId: id },
    });
    if (titulo) {
      const baixas = await tx.lancamentoFinanceiro.findMany({
        where: {
          empresaId: user.empresaId,
          tituloId: titulo.id,
          estornoDeId: null,
          estornos: { none: {} },
        },
      });
      for (const baixa of baixas)
        await this.financeiro.estornarTx(tx, user, baixa.id, motivo);
      await tx.tituloFinanceiro.update({
        where: { id: titulo.id },
        data: { canceladoEm: new Date(), motivoCancelamento: motivo },
      });
    }
    await tx.voucher.update({
      where: { id },
      data: { status: "CANCELADO", canceladoEm: new Date(), motivo },
    });
    await this.comercial.auditar(tx, user, "Voucher", id, "CANCELAR", {
      motivo,
    });
    return id;
  }
}
