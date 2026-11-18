import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma } from "@sistema/db";
import type { CompraInput, ListaOperacoes } from "@sistema/shared";
import type { Identity } from "../auth/auth.service";
import { DatabaseService } from "../database.service";
import {
  ComercialService,
  Dinheiro,
  ratearValor,
} from "../comercial/comercial.service";
import { FinanceiroService } from "../comercial/financeiro.service";
import { EstoqueService } from "../gestao/estoque.service";
import { dataLoja } from "../gestao/data-loja";

@Injectable()
export class ComprasService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(ComercialService) private readonly comercial: ComercialService,
    @Inject(EstoqueService) private readonly estoque: EstoqueService,
    @Inject(FinanceiroService) private readonly financeiro: FinanceiroService,
  ) {}

  async detalheTx(tx: Prisma.TransactionClient, empresaId: string, id: string) {
    const compra = await tx.compra.findFirst({
      where: { empresaId, id },
      include: { fornecedor: { select: { nome: true } }, itens: true },
    });
    if (!compra) throw new NotFoundException("Compra não encontrada.");
    const titulos = await tx.tituloFinanceiro.findMany({
      where: { empresaId, origemTipo: "COMPRA", origemId: id },
      orderBy: { parcela: "asc" },
    });
    const titulosDTO = [];
    for (const titulo of titulos) {
      const { pago } = await this.financeiro.tituloTx(tx, empresaId, titulo.id);
      titulosDTO.push(this.financeiro.tituloDTO(titulo, pago));
    }
    return {
      ...compra,
      total: compra.total.toFixed(2),
      emitidaEm: compra.emitidaEm.toISOString().slice(0, 10),
      itens: compra.itens.map((item) => ({
        ...item,
        quantidade: item.quantidade.toFixed(3),
        fatorConversao: item.fatorConversao.toFixed(3),
        custoUnitario: item.custoUnitario.toFixed(4),
        total: item.total.toFixed(2),
      })),
      titulos: titulosDTO,
    };
  }

  detalhe(empresaId: string, id: string) {
    return this.db.client.$transaction(
      (tx) => this.detalheTx(tx, empresaId, id),
      { isolationLevel: "RepeatableRead" },
    );
  }

  async listar(empresaId: string, query: ListaOperacoes) {
    const where: Prisma.CompraWhereInput = {
      empresaId,
      ...(query.q
        ? {
            OR: [
              { numero: { contains: query.q, mode: "insensitive" } },
              {
                fornecedor: {
                  nome: { contains: query.q, mode: "insensitive" },
                },
              },
            ],
          }
        : {}),
    };
    const [itens, total] = await this.db.client.$transaction([
      this.db.client.compra.findMany({
        where,
        include: { fornecedor: { select: { nome: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.db.client.compra.count({ where }),
    ]);
    return {
      itens: itens.map((item) => ({ ...item, total: item.total.toFixed(2) })),
      total,
      page: query.page,
      pages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  vinculos(empresaId: string, fornecedorId: string) {
    return this.db.client.vinculoFornecedorProduto.findMany({
      where: { empresaId, fornecedorId },
    });
  }

  criar(user: Identity, input: CompraInput) {
    return this.comercial.executar(
      user,
      "CRIAR_COMPRA",
      input,
      async (tx) => {
        if (input.emitidaEm > dataLoja())
          throw new BadRequestException(
            "A emissão da compra não pode ser futura.",
          );
        if (
          !(await tx.fornecedor.findFirst({
            where: {
              empresaId: user.empresaId,
              id: input.fornecedorId,
              ativo: true,
            },
          }))
        )
          throw new BadRequestException("Fornecedor inválido ou inativo.");
        for (const id of [
          ...new Set(input.itens.map((item) => item.produtoId)),
        ].sort()) {
          await tx.$queryRaw`SELECT id FROM "Produto" WHERE "empresaId"=${user.empresaId} AND id=${id} FOR UPDATE`;
        }
        const valores = input.itens.map((item) =>
          new Dinheiro(item.quantidade)
            .times(item.custoUnitario)
            .toDecimalPlaces(2),
        );
        const subtotal = valores.reduce(
          (sum, valor) => sum.plus(valor),
          new Dinheiro(0),
        );
        const total = subtotal.plus(input.despesas).minus(input.desconto);
        const parcelasTotal = input.parcelas.reduce(
          (sum, parcela) => sum.plus(parcela.valor),
          new Dinheiro(0),
        );
        if (
          !total.greaterThan(0) ||
          total.greaterThan("9999999999.99") ||
          !total.equals(parcelasTotal)
        )
          throw new BadRequestException(
            "A soma das parcelas deve corresponder ao total dos itens da compra.",
          );
        if (input.notaRecebidaId) {
          const nota = await tx.notaRecebida.findFirst({
            where: { empresaId: user.empresaId, id: input.notaRecebidaId },
          });
          const fornecedor = await tx.fornecedor.findFirstOrThrow({
            where: { empresaId: user.empresaId, id: input.fornecedorId },
          });
          if (
            !nota?.xml ||
            nota.compraId ||
            nota.status === "IMPORTADA" ||
            nota.chave !== input.chaveNota ||
            !nota.valorTotal.equals(total) ||
            fornecedor.cpfCnpj !== nota.fornecedorDocumento
          )
            throw new ConflictException(
              "Confira o fornecedor, o total e a chave da nota recebida. Ela deve estar disponível para entrada.",
            );
        }
        if (!subtotal.greaterThan(0))
          throw new BadRequestException(
            "Informe ao menos um item com custo maior que zero.",
          );
        const avaliacao = ratearValor(total, valores);
        const compra = await tx.compra.create({
          data: {
            empresaId: user.empresaId,
            fornecedorId: input.fornecedorId,
            numero: input.numero,
            chaveNota: input.chaveNota,
            emitidaEm: new Date(input.emitidaEm + "T00:00:00Z"),
            total,
            despesas: input.despesas,
            desconto: input.desconto,
            observacao: input.observacao,
          },
        });
        for (const [index, item] of input.itens.entries()) {
          const produto = await tx.produto.findFirst({
            where: {
              empresaId: user.empresaId,
              id: item.produtoId,
              ativo: true,
            },
          });
          if (!produto)
            throw new BadRequestException("Produto inválido ou inativo.");
          const exata = new Dinheiro(item.quantidade).times(
            item.fatorConversao,
          );
          if (exata.decimalPlaces() > 3 || exata.greaterThan("999999999.999"))
            throw new BadRequestException(
              "A conversão da quantidade excede a precisão ou o limite do estoque.",
            );
          const custo = avaliacao[index].div(exata).toDecimalPlaces(4);
          if (custo.greaterThan("99999999.9999"))
            throw new BadRequestException(
              "O custo convertido excede o limite permitido.",
            );
          let loteId: string | null = null;
          if (item.lote) {
            const existente = await tx.lote.findUnique({
              where: {
                empresaId_produtoId_numero: {
                  empresaId: user.empresaId,
                  produtoId: item.produtoId,
                  numero: item.lote.numero,
                },
              },
            });
            if (
              existente &&
              (existente.validade?.toISOString().slice(0, 10) ?? null) !==
                item.lote.validade
            )
              throw new ConflictException(
                "O lote informado já existe com outra validade.",
              );
            loteId =
              existente?.id ??
              (
                await tx.lote.create({
                  data: {
                    empresaId: user.empresaId,
                    produtoId: item.produtoId,
                    numero: item.lote.numero,
                    validade: item.lote.validade
                      ? new Date(item.lote.validade + "T00:00:00Z")
                      : null,
                  },
                })
              ).id;
          }
          await tx.compraItem.create({
            data: {
              empresaId: user.empresaId,
              compraId: compra.id,
              produtoId: item.produtoId,
              codigoFornecedor: item.codigoFornecedor,
              descricao: produto.nome,
              quantidade: item.quantidade,
              fatorConversao: item.fatorConversao,
              custoUnitario: item.custoUnitario,
              total: valores[index],
              loteId,
            },
          });
          await this.estoque.gravar(tx, user, item.produtoId, {
            loteId,
            tipo: "ENTRADA",
            quantidade: exata,
            custoUnitario: custo,
            valorMovimento: avaliacao[index],
            motivo: "Compra " + input.numero,
            chaveOperacao: randomUUID(),
            origemTipo: "COMPRA",
            origemId: compra.id,
          });
          const vinculo = {
            empresaId: user.empresaId,
            fornecedorId: input.fornecedorId,
            codigoFornecedor: item.codigoFornecedor,
          };
          await tx.vinculoFornecedorProduto.upsert({
            where: { empresaId_fornecedorId_codigoFornecedor: vinculo },
            create: {
              ...vinculo,
              produtoId: item.produtoId,
              fatorConversao: item.fatorConversao,
            },
            update: {
              produtoId: item.produtoId,
              fatorConversao: item.fatorConversao,
            },
          });
        }
        await tx.tituloFinanceiro.createMany({
          data: input.parcelas.map((parcela, index) => ({
            empresaId: user.empresaId,
            tipo: "PAGAR" as const,
            descricao:
              "Compra " +
              input.numero +
              " · parcela " +
              (index + 1) +
              "/" +
              input.parcelas.length,
            valor: parcela.valor,
            vencimento: new Date(parcela.vencimento + "T00:00:00Z"),
            fornecedorId: input.fornecedorId,
            origemTipo: "COMPRA",
            origemId: compra.id,
            parcela: index + 1,
            totalParcelas: input.parcelas.length,
          })),
        });
        if (input.notaRecebidaId) {
          await tx.notaRecebida.update({
            where: { id: input.notaRecebidaId },
            data: { status: "IMPORTADA", compraId: compra.id },
          });
          const configuracao = await tx.configuracaoEmpresa.findUnique({
            where: { empresaId: user.empresaId },
          });
          if ((configuracao?.integracoes as { focus?: boolean } | null)?.focus)
            await tx.integracaoJob.create({
              data: {
                empresaId: user.empresaId,
                tipo: "FOCUS_MANIFESTAR",
                referencia: compra.id,
                payload: { chave: input.chaveNota, tipo: "confirmacao" },
              },
            });
        }
        await this.comercial.auditar(
          tx,
          user,
          "Compra",
          compra.id,
          "CONFIRMAR",
          {
            numero: input.numero,
            total: total.toFixed(2),
            itens: input.itens.length,
          },
        );
        return compra.id;
      },
      (tx, id) => this.detalheTx(tx, user.empresaId, id),
    );
  }

  cancelar(
    user: Identity,
    id: string,
    input: { chaveOperacao: string; motivo: string },
  ) {
    return this.comercial.executar(
      user,
      "CANCELAR_COMPRA:" + id,
      input,
      async (tx) => {
        const compra = await tx.compra.findFirst({
          where: { empresaId: user.empresaId, id },
        });
        if (!compra) throw new NotFoundException("Compra não encontrada.");
        if (compra.status === "CANCELADA")
          throw new ConflictException("Compra já cancelada.");
        const movimentos = await tx.movimentoEstoque.findMany({
          where: {
            empresaId: user.empresaId,
            origemTipo: "COMPRA",
            origemId: id,
            tipo: "ENTRADA",
          },
          orderBy: [
            { produtoId: "asc" },
            { createdAt: "desc" },
            { id: "desc" },
          ],
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
            motivo: input.motivo,
            chaveOperacao: randomUUID(),
            estornoDeId: movimento.id,
            origemTipo: "COMPRA",
            origemId: id,
          });
        const titulos = await tx.tituloFinanceiro.findMany({
          where: {
            empresaId: user.empresaId,
            origemTipo: "COMPRA",
            origemId: id,
          },
        });
        for (const titulo of titulos) {
          const baixas = await tx.lancamentoFinanceiro.findMany({
            where: {
              empresaId: user.empresaId,
              tituloId: titulo.id,
              estornoDeId: null,
              estornos: { none: {} },
            },
          });
          for (const baixa of baixas)
            await this.financeiro.estornarTx(tx, user, baixa.id, input.motivo);
          await tx.tituloFinanceiro.update({
            where: { id: titulo.id },
            data: { canceladoEm: new Date(), motivoCancelamento: input.motivo },
          });
        }
        await tx.compra.update({
          where: { id },
          data: {
            status: "CANCELADA",
            canceladaEm: new Date(),
            motivoCancelamento: input.motivo,
          },
        });
        await this.comercial.auditar(tx, user, "Compra", id, "CANCELAR", {
          motivo: input.motivo,
        });
        return id;
      },
      (tx, result) => this.detalheTx(tx, user.empresaId, result),
    );
  }
}
