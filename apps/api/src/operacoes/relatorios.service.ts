import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@sistema/db";
import { DatabaseService } from "../database.service";
import { Dinheiro } from "../comercial/comercial.service";

@Injectable()
export class RelatoriosService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}
  async resumo(empresaId: string, query: { de: string; ate: string }) {
    if ((Date.parse(query.ate) - Date.parse(query.de)) / 86400000 > 366)
      throw new BadRequestException("Consulte períodos de até 366 dias.");
    return this.db.client.$transaction(
      async (tx) => {
        const vendas = await tx.$queryRaw<
          { dia: string; quantidade: number; total: Prisma.Decimal }[]
        >`SELECT ("createdAt" AT TIME ZONE 'America/Cuiaba')::date::text AS dia, COUNT(*)::int AS quantidade, SUM(total) AS total FROM "Venda" WHERE "empresaId"=${empresaId} AND status='CONFIRMADA' AND ("createdAt" AT TIME ZONE 'America/Cuiaba')::date BETWEEN ${query.de}::date AND ${query.ate}::date GROUP BY 1 ORDER BY 1`;
        const financeiro = await tx.$queryRaw<
          { dia: string; entradas: Prisma.Decimal; saidas: Prisma.Decimal }[]
        >`SELECT l.data::text AS dia, SUM(CASE WHEN l.valor>0 THEN l.valor ELSE 0 END) AS entradas, SUM(CASE WHEN l.valor<0 THEN -l.valor ELSE 0 END) AS saidas FROM "LancamentoFinanceiro" l JOIN "TituloFinanceiro" t ON t.id=l."tituloId" AND t."empresaId"=l."empresaId" WHERE l."empresaId"=${empresaId} AND l.data BETWEEN ${query.de}::date AND ${query.ate}::date AND (t."origemTipo" IS NULL OR t."origemTipo"<>'TRANSFERENCIA') GROUP BY l.data ORDER BY l.data`;
        const [custos] = await tx.$queryRaw<
          { valor: Prisma.Decimal; pendentes: number }[]
        >`SELECT COALESCE(-SUM(m."valorMovimento"),0) AS valor, COUNT(*) FILTER (WHERE m."valorMovimento" IS NULL)::int AS pendentes FROM "MovimentoEstoque" m JOIN "Venda" v ON v.id=m."vendaId" AND v."empresaId"=m."empresaId" WHERE m."empresaId"=${empresaId} AND v.status='CONFIRMADA' AND (v."createdAt" AT TIME ZONE 'America/Cuiaba')::date BETWEEN ${query.de}::date AND ${query.ate}::date`;
        const estoque = await tx.produto.aggregate({
          where: { empresaId },
          _sum: { valorEstoque: true },
        });
        const estoquePendente = await tx.produto.count({
          where: { empresaId, valorEstoque: null },
        });
        const pendentes = await tx.$queryRaw<
          { tipo: string; valor: Prisma.Decimal }[]
        >`SELECT t.tipo::text, SUM(t.valor-COALESCE(p.pago,0)) AS valor FROM "TituloFinanceiro" t LEFT JOIN (SELECT "tituloId", SUM(valor) AS pago FROM "LancamentoFinanceiro" WHERE "empresaId"=${empresaId} GROUP BY "tituloId") p0 ON p0."tituloId"=t.id LEFT JOIN LATERAL (SELECT COALESCE(p0.pago,0)*CASE t.tipo WHEN 'PAGAR' THEN -1 ELSE 1 END AS pago) p ON TRUE WHERE t."empresaId"=${empresaId} AND t."canceladoEm" IS NULL AND t.vencimento BETWEEN ${query.de}::date AND ${query.ate}::date GROUP BY t.tipo`;
        const totalVendas = vendas.reduce(
            (sum, row) => sum.plus(row.total),
            new Dinheiro(0),
          ),
          quantidadeVendas = vendas.reduce(
            (sum, row) => sum + row.quantidade,
            0,
          );
        const entradas = financeiro.reduce(
            (sum, row) => sum.plus(row.entradas),
            new Dinheiro(0),
          ),
          saidas = financeiro.reduce(
            (sum, row) => sum.plus(row.saidas),
            new Dinheiro(0),
          );
        const pedidosEnviar = await tx.pedidoOnline.count({
          where: {
            empresaId,
            servicoFrete: { not: "SEM_ENTREGA" },
            status: { in: ["PAGO", "FATURADO"] },
          },
        });
        const notasRecebidas = await tx.notaRecebida.count({
          where: { empresaId, compraId: null },
        });
        return {
          de: query.de,
          ate: query.ate,
          totalVendas: totalVendas.toFixed(2),
          quantidadeVendas,
          ticketMedio: quantidadeVendas
            ? totalVendas.div(quantidadeVendas).toFixed(2)
            : "0.00",
          entradas: entradas.toFixed(2),
          saidas: saidas.toFixed(2),
          resultado: entradas.minus(saidas).toFixed(2),
          custoVendido: custos.pendentes ? null : custos.valor.toFixed(2),
          valorEstoque: (estoque._sum.valorEstoque ?? new Dinheiro(0)).toFixed(
            2,
          ),
          estoquePendente,
          aPagar:
            pendentes.find((row) => row.tipo === "PAGAR")?.valor.toFixed(2) ??
            "0.00",
          aReceber:
            pendentes.find((row) => row.tipo === "RECEBER")?.valor.toFixed(2) ??
            "0.00",
          pedidosEnviar,
          notasRecebidas,
          vendasPorDia: vendas.map((row) => ({
            ...row,
            total: row.total.toFixed(2),
          })),
          caixaPorDia: financeiro.map((row) => ({
            dia: row.dia,
            entradas: row.entradas.toFixed(2),
            saidas: row.saidas.toFixed(2),
            resultado: new Dinheiro(row.entradas.toString())
              .minus(row.saidas)
              .toFixed(2),
          })),
        };
      },
      { isolationLevel: "RepeatableRead", timeout: 20000 },
    );
  }
}
