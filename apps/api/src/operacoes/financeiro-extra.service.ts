import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DatabaseService } from "../database.service";
import { ComercialService, Dinheiro } from "../comercial/comercial.service";
import { FinanceiroService } from "../comercial/financeiro.service";
import type { Identity } from "../auth/auth.service";
import { dataLoja } from "../gestao/data-loja";

@Injectable()
export class FinanceiroExtraService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(ComercialService) private readonly comercial: ComercialService,
    @Inject(FinanceiroService) private readonly financeiro: FinanceiroService,
  ) {}
  categorias(empresaId: string) {
    return this.db.client.categoriaFinanceira.findMany({
      where: { empresaId },
      orderBy: [{ tipo: "asc" }, { nome: "asc" }],
    });
  }
  categoria(
    user: Identity,
    input: {
      chaveOperacao: string;
      nome: string;
      tipo: "PAGAR" | "RECEBER";
      ativa: boolean;
    },
  ) {
    return this.comercial.executar(
      user,
      "CATEGORIA_FINANCEIRA",
      input,
      async (tx) => {
        const categoria = await tx.categoriaFinanceira.create({
          data: {
            empresaId: user.empresaId,
            nome: input.nome,
            nomeChave: input.nome.normalize("NFKC").toLocaleLowerCase("pt-BR"),
            tipo: input.tipo,
            ativa: input.ativa,
          },
        });
        await this.comercial.auditar(
          tx,
          user,
          "CategoriaFinanceira",
          categoria.id,
          "CRIAR",
          { nome: input.nome, tipo: input.tipo },
        );
        return categoria.id;
      },
      (tx, id) =>
        tx.categoriaFinanceira.findFirstOrThrow({
          where: { empresaId: user.empresaId, id },
        }),
    );
  }
  transferir(
    user: Identity,
    input: {
      chaveOperacao: string;
      origemId: string;
      destinoId: string;
      valor: string;
      data: string;
      motivo: string;
    },
  ) {
    return this.comercial.executar(
      user,
      "TRANSFERENCIA",
      input,
      async (tx) => {
        if (input.data > dataLoja())
          throw new BadRequestException(
            "A transferência não pode ter data futura.",
          );
        const contas = await tx.contaFinanceira.count({
          where: {
            empresaId: user.empresaId,
            id: { in: [input.origemId, input.destinoId] },
            ativa: true,
          },
        });
        if (input.origemId === input.destinoId || contas !== 2)
          throw new BadRequestException(
            "Selecione duas contas ativas diferentes.",
          );
        const origemId = randomUUID();
        for (const [tipo, contaId] of [
          ["PAGAR", input.origemId],
          ["RECEBER", input.destinoId],
        ] as const) {
          const titulo = await tx.tituloFinanceiro.create({
            data: {
              empresaId: user.empresaId,
              tipo,
              descricao: "Transferência · " + input.motivo,
              valor: input.valor,
              vencimento: new Date(input.data + "T00:00:00Z"),
              origemTipo: "TRANSFERENCIA",
              origemId,
            },
          });
          await this.financeiro.baixarTx(tx, user, titulo.id, {
            contaId,
            valor: input.valor,
            forma: "TRANSFERENCIA",
            data: input.data,
          });
        }
        await this.comercial.auditar(
          tx,
          user,
          "Transferencia",
          origemId,
          "TRANSFERIR",
          {
            origemId: input.origemId,
            destinoId: input.destinoId,
            valor: input.valor,
            motivo: input.motivo,
          },
        );
        return origemId;
      },
      (tx, id) =>
        tx.tituloFinanceiro.findMany({
          where: {
            empresaId: user.empresaId,
            origemTipo: "TRANSFERENCIA",
            origemId: id,
          },
        }),
    );
  }
  transferencias(empresaId: string) {
    return this.db.client.tituloFinanceiro.findMany({
      where: { empresaId, origemTipo: "TRANSFERENCIA", tipo: "PAGAR" },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }
  estornarTransferencia(
    user: Identity,
    id: string,
    input: { chaveOperacao: string; motivo: string },
  ) {
    return this.comercial.executar(
      user,
      "ESTORNAR_TRANSFERENCIA:" + id,
      input,
      async (tx) => {
        const titulos = await tx.tituloFinanceiro.findMany({
          where: {
            empresaId: user.empresaId,
            origemTipo: "TRANSFERENCIA",
            origemId: id,
          },
        });
        if (
          titulos.length !== 2 ||
          titulos.some((titulo) => titulo.canceladoEm)
        )
          throw new ConflictException(
            "Transferência indisponível ou já estornada.",
          );
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
        await this.comercial.auditar(
          tx,
          user,
          "Transferencia",
          id,
          "ESTORNAR",
          { motivo: input.motivo },
        );
        return id;
      },
      (tx, result) =>
        tx.tituloFinanceiro.findMany({
          where: {
            empresaId: user.empresaId,
            origemTipo: "TRANSFERENCIA",
            origemId: result,
          },
        }),
    );
  }
  parcelar(
    user: Identity,
    input: {
      chaveOperacao: string;
      tituloId: string;
      parcelas: { valor: string; vencimento: string }[];
    },
  ) {
    return this.comercial.executar(
      user,
      "PARCELAR:" + input.tituloId,
      input,
      async (tx) => {
        const { row, pago } = await this.financeiro.tituloTx(
          tx,
          user.empresaId,
          input.tituloId,
        );
        if (row.canceladoEm || row.origemTipo === "PARCELAMENTO")
          throw new ConflictException("Título cancelado ou já parcelado.");
        const saldo = new Dinheiro(row.valor.toString()).minus(pago);
        const soma = input.parcelas.reduce(
          (total, parcela) => total.plus(parcela.valor),
          new Dinheiro(0),
        );
        if (!saldo.greaterThan(0) || !saldo.equals(soma))
          throw new BadRequestException(
            "As parcelas devem somar o saldo em aberto.",
          );
        if (row.vendaId || row.origemTipo)
          throw new ConflictException(
            "O parcelamento desta operação deve ser definido na origem.",
          );
        await tx.tituloFinanceiro.update({
          where: { id: row.id },
          data: {
            canceladoEm: new Date(),
            motivoCancelamento: "Saldo substituído por parcelamento",
          },
        });
        await tx.tituloFinanceiro.createMany({
          data: input.parcelas.map((parcela, index) => ({
            empresaId: user.empresaId,
            tipo: row.tipo,
            descricao:
              row.descricao + " · " + (index + 1) + "/" + input.parcelas.length,
            valor: parcela.valor,
            vencimento: new Date(parcela.vencimento + "T00:00:00Z"),
            clienteId: row.clienteId,
            fornecedorId: row.fornecedorId,
            categoriaId: row.categoriaId,
            origemTipo: "PARCELAMENTO",
            origemId: row.id,
            parcela: index + 1,
            totalParcelas: input.parcelas.length,
          })),
        });
        await this.comercial.auditar(
          tx,
          user,
          "TituloFinanceiro",
          row.id,
          "PARCELAR",
          { saldo: saldo.toFixed(2), parcelas: input.parcelas.length },
        );
        return row.id;
      },
      (tx, id) =>
        tx.tituloFinanceiro.findMany({
          where: {
            empresaId: user.empresaId,
            origemTipo: "PARCELAMENTO",
            origemId: id,
          },
          orderBy: { parcela: "asc" },
        }),
    );
  }
  async fechamentos(empresaId: string) {
    const rows = await this.db.client.fechamentoCaixa.findMany({
      where: { empresaId },
      orderBy: [{ data: "desc" }, { id: "desc" }],
      take: 100,
    });
    return rows.map((row) => ({
      ...row,
      saldoEsperado: row.saldoEsperado.toFixed(2),
      saldoContado: row.saldoContado.toFixed(2),
      diferenca: row.diferenca.toFixed(2),
      data: row.data.toISOString().slice(0, 10),
    }));
  }
  fechar(
    user: Identity,
    input: {
      chaveOperacao: string;
      contaId: string;
      data: string;
      saldoContado: string;
      observacao: string;
    },
  ) {
    return this.comercial.executar(
      user,
      "FECHAR_CAIXA",
      input,
      async (tx) => {
        if (input.data > dataLoja())
          throw new BadRequestException(
            "O fechamento não pode ter data futura.",
          );
        const conta = await tx.contaFinanceira.findFirst({
          where: {
            empresaId: user.empresaId,
            id: input.contaId,
            tipo: "CAIXA",
            ativa: true,
          },
        });
        if (!conta)
          throw new BadRequestException("Selecione uma conta de caixa ativa.");
        const soma = await tx.lancamentoFinanceiro.aggregate({
          where: {
            empresaId: user.empresaId,
            contaId: input.contaId,
            forma: "DINHEIRO",
            data: { lte: new Date(input.data + "T00:00:00Z") },
          },
          _sum: { valor: true },
        });
        const esperado = new Dinheiro(soma._sum.valor?.toString() ?? "0");
        const row = await tx.fechamentoCaixa.create({
          data: {
            empresaId: user.empresaId,
            usuarioId: user.id,
            contaId: input.contaId,
            data: new Date(input.data + "T00:00:00Z"),
            saldoEsperado: esperado,
            saldoContado: input.saldoContado,
            diferenca: new Dinheiro(input.saldoContado).minus(esperado),
            observacao: input.observacao,
          },
        });
        await this.comercial.auditar(
          tx,
          user,
          "FechamentoCaixa",
          row.id,
          "FECHAR",
          {
            contaId: input.contaId,
            data: input.data,
            esperado: esperado.toFixed(2),
            contado: input.saldoContado,
          },
        );
        return row.id;
      },
      (tx, id) =>
        tx.fechamentoCaixa.findFirstOrThrow({
          where: { empresaId: user.empresaId, id },
        }),
    );
  }
  conciliar(
    user: Identity,
    id: string,
    input: { chaveOperacao: string; referenciaExterna: string },
  ) {
    return this.comercial.executar(
      user,
      "CONCILIAR:" + id,
      input,
      async (tx) => {
        const row = await tx.lancamentoFinanceiro.findFirst({
          where: { empresaId: user.empresaId, id },
        });
        if (!row) throw new NotFoundException("Lançamento não encontrado.");
        if (row.conciliadoEm)
          throw new ConflictException("Lançamento já conciliado.");
        await tx.lancamentoFinanceiro.update({
          where: { id },
          data: {
            conciliadoEm: new Date(),
            referenciaExterna: input.referenciaExterna,
          },
        });
        await this.comercial.auditar(
          tx,
          user,
          "LancamentoFinanceiro",
          id,
          "CONCILIAR",
          { referenciaExterna: input.referenciaExterna },
        );
        return id;
      },
      (tx, result) =>
        tx.lancamentoFinanceiro.findFirstOrThrow({
          where: { empresaId: user.empresaId, id: result },
        }),
    );
  }
}
