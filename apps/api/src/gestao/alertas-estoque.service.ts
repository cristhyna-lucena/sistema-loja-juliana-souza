import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@sistema/db";
import type { ConsultaAlertasEstoque, AlertasEstoqueDTO, AlertaEstoqueDTO } from "@sistema/shared";
import { DatabaseService } from "../database.service";
import { dataLoja, somarDias } from "./data-loja";
type AlertaRow = Omit<AlertaEstoqueDTO, "saldo" | "estoqueMinimo" | "validade"> & { saldo: Prisma.Decimal; estoqueMinimo: Prisma.Decimal; validade: Date | null };
@Injectable()
export class AlertasEstoqueService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}
  async listar(empresaId: string, query: ConsultaAlertasEstoque, agora = new Date()): Promise<AlertasEstoqueDTO> {
    const hoje = dataLoja(agora);
    const limite = somarDias(hoje, query.dias);
    const base = Prisma.sql`
      WITH saldos AS (
        SELECT "produtoId", "loteId", SUM(quantidade) AS saldo
        FROM "MovimentoEstoque" WHERE "empresaId" = ${empresaId}
        GROUP BY "produtoId", "loteId"
      ), alertas AS (
        SELECT p.id AS "produtoId", p.nome, p.sku, p.unidade, 'REPOSICAO'::text AS tipo,
          NULL::text AS "loteId", NULL::text AS numero, NULL::date AS validade,
          COALESCE(SUM(s.saldo), 0) AS saldo, p."estoqueMinimo"
        FROM "Produto" p LEFT JOIN saldos s ON s."produtoId" = p.id
        WHERE p."empresaId" = ${empresaId} AND p.ativo AND p."estoqueMinimo" > 0
        GROUP BY p.id HAVING COALESCE(SUM(s.saldo), 0) <= p."estoqueMinimo"
        UNION ALL
        SELECT p.id, p.nome, p.sku, p.unidade,
          CASE WHEN l.validade < ${hoje}::date THEN 'VENCIDO' ELSE 'A_VENCER' END,
          l.id, l.numero, l.validade, s.saldo, p."estoqueMinimo"
        FROM "Lote" l JOIN "Produto" p ON p.id = l."produtoId" AND p."empresaId" = l."empresaId"
        JOIN saldos s ON s."produtoId" = l."produtoId" AND s."loteId" = l.id
        WHERE l."empresaId" = ${empresaId} AND p.ativo AND s.saldo > 0 AND l.validade <= ${limite}::date
      ), filtrados AS (
        SELECT * FROM alertas WHERE ${query.q} = '' OR strpos(lower(nome), lower(${query.q})) > 0 OR strpos(lower(sku), lower(${query.q})) > 0
      )`;
    return this.db.client.$transaction(async tx => {
      const [resumo] = await tx.$queryRaw<{ reposicao: number; vencidos: number; aVencer: number; total: number }[]>(Prisma.sql`${base}
        SELECT (COUNT(*) FILTER (WHERE tipo = 'REPOSICAO'))::int AS reposicao,
          (COUNT(*) FILTER (WHERE tipo = 'VENCIDO'))::int AS vencidos,
          (COUNT(*) FILTER (WHERE tipo = 'A_VENCER'))::int AS "aVencer",
          (COUNT(*) FILTER (WHERE ${query.tipo} = 'todos' OR tipo = ${query.tipo}))::int AS total FROM filtrados`);
      const rows = await tx.$queryRaw<AlertaRow[]>(Prisma.sql`${base}
        SELECT * FROM filtrados WHERE ${query.tipo} = 'todos' OR tipo = ${query.tipo}
        ORDER BY CASE tipo WHEN 'VENCIDO' THEN 0 WHEN 'A_VENCER' THEN 1 ELSE 2 END, validade ASC NULLS LAST, nome ASC, "produtoId" ASC, "loteId" ASC NULLS LAST
        LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`);
      return { itens: rows.map(row => ({ ...row, saldo: row.saldo.toFixed(3), estoqueMinimo: row.estoqueMinimo.toFixed(3), validade: row.validade?.toISOString().slice(0, 10) ?? null })), total: resumo.total, page: query.page, pageSize: query.pageSize, pages: Math.max(1, Math.ceil(resumo.total / query.pageSize)), dataReferencia: hoje, dias: query.dias, resumo: { reposicao: resumo.reposicao, vencidos: resumo.vencidos, aVencer: resumo.aVencer } };
    }, { isolationLevel: "RepeatableRead" });
  }
}
