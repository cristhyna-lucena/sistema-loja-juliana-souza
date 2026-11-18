import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@sistema/db";
import type { BaixaInput, BaixaCampos, ContaInput, ContaEdicao, TituloInput, MotivoComercial, ListaTitulos, ConsultaCaixa, TituloFinanceiroDTO, ContaFinanceiraDTO, LancamentoFinanceiroDTO } from "@sistema/shared";
import type { Identity } from "../auth/auth.service";
import { DatabaseService } from "../database.service";
import { dataLoja } from "../gestao/data-loja";
import { ComercialService, Dinheiro } from "./comercial.service";
const lancamentoInclude = { conta: { select: { nome: true } }, titulo: { select: { descricao: true } }, estornos: { select: { id: true } } } as const;
type TituloRow = Prisma.TituloFinanceiroGetPayload<{}>;
type LancamentoRow = Prisma.LancamentoFinanceiroGetPayload<{ include: typeof lancamentoInclude }>;
@Injectable()
export class FinanceiroService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService, @Inject(ComercialService) private readonly comercial: ComercialService) {}
  tituloDTO(row: TituloRow, pago: Prisma.Decimal): TituloFinanceiroDTO {
    const saldo = new Dinheiro(row.valor.toString()).minus(pago);
    return { id: row.id, tipo: row.tipo, descricao: row.descricao, valor: row.valor.toFixed(2), valorPago: pago.toFixed(2), saldo: row.canceladoEm ? "0.00" : saldo.toFixed(2), vencimento: row.vencimento.toISOString().slice(0, 10), status: row.canceladoEm ? "CANCELADO" : saldo.isZero() ? "PAGO" : pago.greaterThan(0) ? "PARCIAL" : "ABERTO", atrasado: !row.canceladoEm && saldo.greaterThan(0) && row.vencimento.toISOString().slice(0, 10) < dataLoja(), origemTipo: row.origemTipo, origemId: row.origemId, vendaId: row.vendaId, clienteId: row.clienteId, fornecedorId: row.fornecedorId, canceladoEm: row.canceladoEm?.toISOString() ?? null, motivoCancelamento: row.motivoCancelamento };
  }
  lancamentoDTO(row: LancamentoRow): LancamentoFinanceiroDTO { return { id: row.id, tituloId: row.tituloId, contaId: row.contaId, valor: row.valor.toFixed(2), forma: row.forma, data: row.data.toISOString().slice(0, 10), motivo: row.motivo, estornoDeId: row.estornoDeId, estornado: row.estornos.length > 0, conta: row.conta.nome, descricao: row.titulo.descricao, conciliadoEm: row.conciliadoEm?.toISOString() ?? null, referenciaExterna: row.referenciaExterna }; }
  async tituloTx(tx: Prisma.TransactionClient, empresaId: string, id: string) {
    const row = await tx.tituloFinanceiro.findFirst({ where: { empresaId, id } });
    if (!row) throw new NotFoundException("Conta a pagar ou receber não encontrada.");
    const soma = await tx.lancamentoFinanceiro.aggregate({ where: { empresaId, tituloId: id }, _sum: { valor: true } });
    const total = new Dinheiro(soma._sum.valor?.toString() ?? "0");
    return { row, pago: row.tipo === "RECEBER" ? total : total.negated() };
  }
  private async lerTitulo(tx: Prisma.TransactionClient, empresaId: string, id: string) { const { row, pago } = await this.tituloTx(tx, empresaId, id); return this.tituloDTO(row, pago); }
  private async lerLancamento(tx: Prisma.TransactionClient, empresaId: string, id: string) { const row = await tx.lancamentoFinanceiro.findFirst({ where: { empresaId, id }, include: lancamentoInclude }); if (!row) throw new NotFoundException("Lançamento não encontrado."); return this.lancamentoDTO(row); }
  async detalhe(empresaId: string, id: string) {
    return this.db.client.$transaction(async tx => {
      const titulo = await this.lerTitulo(tx, empresaId, id);
      const vinculo = await tx.tituloFinanceiro.findFirstOrThrow({ where: { empresaId, id }, select: { cliente: { select: { nome: true } }, fornecedor: { select: { nome: true } } } });
      const lancamentos = await tx.lancamentoFinanceiro.findMany({ where: { empresaId, tituloId: id }, include: lancamentoInclude, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
      return { ...titulo, contatoNome: vinculo.cliente?.nome ?? vinculo.fornecedor?.nome ?? null, lancamentos: lancamentos.map(l => this.lancamentoDTO(l)) };
    }, { isolationLevel: "RepeatableRead" });
  }
  async contas(empresaId: string, opcoes = false): Promise<ContaFinanceiraDTO[]> {
    return this.db.client.$transaction(async tx => {
      const rows = await tx.contaFinanceira.findMany({ where: { empresaId, ...(opcoes ? { ativa: true } : {}) }, orderBy: [{ nome: "asc" }, { id: "asc" }] });
      const saldos = opcoes ? [] : await tx.lancamentoFinanceiro.groupBy({ by: ["contaId"], where: { empresaId }, _sum: { valor: true } });
      return rows.map(r => ({ id: r.id, nome: r.nome, tipo: r.tipo, ativa: r.ativa, versao: r.versao, ...(!opcoes ? { saldo: (saldos.find(s => s.contaId === r.id)?._sum.valor ?? new Dinheiro(0)).toFixed(2) } : {}) }));
    }, { isolationLevel: "RepeatableRead" });
  }
  async contatos(empresaId: string, tipo: "PAGAR" | "RECEBER", q: string) {
    const where = { empresaId, ativo: true, ...(q ? { nome: { contains: q, mode: "insensitive" as const } } : {}) };
    const args = { where, select: { id: true, nome: true }, orderBy: [{ nome: "asc" as const }, { id: "asc" as const }], take: 20 };
    return tipo === "PAGAR" ? this.db.client.fornecedor.findMany(args) : this.db.client.cliente.findMany(args);
  }
  criarConta(user: Identity, input: ContaInput) {
    return this.comercial.executar(user, "CRIAR_CONTA", input, async tx => {
      const row = await tx.contaFinanceira.create({ data: { empresaId: user.empresaId, nome: input.nome, nomeChave: input.nome.normalize("NFKC").toLocaleLowerCase("pt-BR"), tipo: input.tipo, ativa: input.ativa } });
      await this.comercial.auditar(tx, user, "ContaFinanceira", row.id, "CRIAR", { nome: row.nome, tipo: row.tipo, ativa: row.ativa }); return row.id;
    }, (tx, id) => tx.contaFinanceira.findFirstOrThrow({ where: { empresaId: user.empresaId, id } }));
  }
  editarConta(user: Identity, id: string, input: ContaEdicao) {
    return this.comercial.executar(user, "EDITAR_CONTA:" + id, input, async tx => {
      const { chaveOperacao, versao, ...data } = input;
      const before = await tx.contaFinanceira.findFirst({ where: { empresaId: user.empresaId, id } }); if (!before) throw new NotFoundException("Conta financeira não encontrada.");
      const changed = await tx.contaFinanceira.updateMany({ where: { empresaId: user.empresaId, id, versao }, data: { ...data, ...(data.nome ? { nomeChave: data.nome.normalize("NFKC").toLocaleLowerCase("pt-BR") } : {}), versao: { increment: 1 } } });
      if (!changed.count) throw new ConflictException("Conta alterada por outra pessoa. Recarregue antes de salvar.");
      await this.comercial.auditar(tx, user, "ContaFinanceira", id, "EDITAR", { versaoAnterior: versao, campos: Object.keys(data), ...data }); return id;
    }, (tx, result) => tx.contaFinanceira.findFirstOrThrow({ where: { empresaId: user.empresaId, id: result } }));
  }
  criarTitulo(user: Identity, input: TituloInput) {
    return this.comercial.executar(user, "CRIAR_TITULO", input, async tx => {
      if (input.clienteId && !await tx.cliente.findFirst({ where: { empresaId: user.empresaId, id: input.clienteId, ativo: true } })) throw new BadRequestException("Cliente inválido ou inativo.");
      if (input.fornecedorId && !await tx.fornecedor.findFirst({ where: { empresaId: user.empresaId, id: input.fornecedorId, ativo: true } })) throw new BadRequestException("Fornecedor inválido ou inativo.");
      if (input.categoriaId && !await tx.categoriaFinanceira.findFirst({ where: { empresaId: user.empresaId, id: input.categoriaId, tipo: input.tipo, ativa: true } })) throw new BadRequestException("Categoria financeira inválida ou inativa.");
      const { chaveOperacao, ...data } = input;
      const row = await tx.tituloFinanceiro.create({ data: { ...data, empresaId: user.empresaId, vencimento: new Date(input.vencimento + "T00:00:00Z") } });
      await this.comercial.auditar(tx, user, "TituloFinanceiro", row.id, "CRIAR", { descricao: row.descricao, tipo: row.tipo, valor: row.valor.toFixed(2), vencimento: input.vencimento }); return row.id;
    }, (tx, id) => this.lerTitulo(tx, user.empresaId, id));
  }
  async baixarTx(tx: Prisma.TransactionClient, user: Identity, id: string, input: BaixaCampos) {
    const { row, pago } = await this.tituloTx(tx, user.empresaId, id);
    if (row.canceladoEm) throw new ConflictException("Esta conta está cancelada.");
    const valor = new Dinheiro(input.valor), saldo = new Dinheiro(row.valor.toString()).minus(pago);
    if (valor.greaterThan(saldo)) throw new ConflictException("O valor informado excede o saldo em aberto.");
    const conta = await tx.contaFinanceira.findFirst({ where: { empresaId: user.empresaId, id: input.contaId, ativa: true } });
    if (!conta) throw new BadRequestException("Conta financeira inválida ou inativa.");
    const data = input.data ?? dataLoja(); if (data > dataLoja()) throw new BadRequestException("Uma baixa realizada não pode ter data futura.");
    const lancamento = await tx.lancamentoFinanceiro.create({ data: { empresaId: user.empresaId, tituloId: id, contaId: input.contaId, valor: row.tipo === "RECEBER" ? valor : valor.negated(), forma: input.forma, data: new Date(data + "T00:00:00Z"), motivo: row.tipo === "RECEBER" ? "Recebimento" : "Pagamento" } });
    if (input.taxa && new Dinheiro(input.taxa).greaterThan(0)) {
      if (row.tipo !== "RECEBER" || new Dinheiro(input.taxa).greaterThan(valor)) throw new BadRequestException("A taxa deve ser de um recebimento e não pode exceder seu valor.");
      const taxa = await tx.tituloFinanceiro.create({ data: { empresaId: user.empresaId, tipo: "PAGAR", descricao: "Taxa de recebimento · " + row.descricao.slice(0, 130), valor: input.taxa, vencimento: new Date(data + "T00:00:00Z"), origemTipo: "TAXA", origemId: lancamento.id } });
      await this.baixarTx(tx, user, taxa.id, { contaId: input.contaId, forma: input.forma, valor: input.taxa, data });
    }
    await this.comercial.auditar(tx, user, "LancamentoFinanceiro", lancamento.id, "BAIXAR", { tituloId: id, contaId: conta.id, valor: lancamento.valor.toFixed(2), forma: input.forma, data }); return lancamento.id;
  }
  baixar(user: Identity, id: string, input: BaixaInput) { return this.comercial.executar(user, "BAIXAR_TITULO:" + id, input, tx => this.baixarTx(tx, user, id, input), (tx, result) => this.lerLancamento(tx, user.empresaId, result)); }
  async estornarTx(tx: Prisma.TransactionClient, user: Identity, id: string, motivo: string) {
    const row = await tx.lancamentoFinanceiro.findFirst({ where: { empresaId: user.empresaId, id }, include: { estornos: { select: { id: true } } } });
    if (!row) throw new NotFoundException("Lançamento não encontrado.");
    if (row.estornoDeId) throw new BadRequestException("Um estorno não pode ser estornado.");
    if (row.estornos.length) throw new ConflictException("Lançamento já estornado.");
    const taxas = await tx.tituloFinanceiro.findMany({ where: { empresaId: user.empresaId, origemTipo: "TAXA", origemId: row.id, canceladoEm: null } });
    for (const taxa of taxas) {
      const baixas = await tx.lancamentoFinanceiro.findMany({ where: { empresaId: user.empresaId, tituloId: taxa.id, estornoDeId: null, estornos: { none: {} } } });
      for (const baixa of baixas) await this.estornarTx(tx, user, baixa.id, motivo);
      await tx.tituloFinanceiro.update({ where: { id: taxa.id }, data: { canceladoEm: new Date(), motivoCancelamento: motivo } });
    }
    const novo = await tx.lancamentoFinanceiro.create({ data: { empresaId: user.empresaId, tituloId: row.tituloId, contaId: row.contaId, valor: row.valor.negated(), forma: row.forma, data: new Date(dataLoja() + "T00:00:00Z"), motivo, estornoDeId: id } });
    await this.comercial.auditar(tx, user, "LancamentoFinanceiro", novo.id, "ESTORNAR", { originalId: id, motivo, valor: novo.valor.toFixed(2) }); return novo.id;
  }
  estornar(user: Identity, id: string, input: MotivoComercial) {
    return this.comercial.executar(user, "ESTORNAR_LANCAMENTO:" + id, input, async tx => {
      const row = await tx.lancamentoFinanceiro.findFirst({ where: { empresaId: user.empresaId, id }, include: { titulo: true } });
      if (row?.titulo.canceladoEm) throw new ConflictException("Corrija os lançamentos pela operação de origem deste título cancelado.");
      if (row?.titulo.origemTipo === "TRANSFERENCIA" || row?.titulo.origemTipo === "TAXA") throw new ConflictException("Estorne este lançamento pela operação de origem.");
      return this.estornarTx(tx, user, id, input.motivo);
    }, (tx, result) => this.lerLancamento(tx, user.empresaId, result));
  }
  cancelarTitulo(user: Identity, id: string, input: MotivoComercial) {
    return this.comercial.executar(user, "CANCELAR_TITULO:" + id, input, async tx => {
      const { row, pago } = await this.tituloTx(tx, user.empresaId, id);
      if (row.vendaId) throw new ConflictException("Esta conta pertence a uma venda. Cancele a venda para devolver o estoque e estornar os recebimentos.");
      if (row.origemTipo) throw new ConflictException("Cancele esta conta pela operação de origem.");
      if (row.canceladoEm) throw new ConflictException("Conta já cancelada.");
      if (!pago.isZero()) throw new ConflictException("Estorne as baixas antes de cancelar esta conta.");
      await tx.tituloFinanceiro.update({ where: { id }, data: { canceladoEm: new Date(), motivoCancelamento: input.motivo } });
      await this.comercial.auditar(tx, user, "TituloFinanceiro", id, "CANCELAR", { motivo: input.motivo }); return id;
    }, (tx, result) => this.lerTitulo(tx, user.empresaId, result));
  }
  async titulos(empresaId: string, query: ListaTitulos) {
    const base = Prisma.sql`WITH saldos AS (SELECT t.*, COALESCE(SUM(l.valor),0) * CASE t.tipo WHEN 'RECEBER' THEN 1 ELSE -1 END AS pago FROM "TituloFinanceiro" t LEFT JOIN "LancamentoFinanceiro" l ON l."tituloId"=t.id AND l."empresaId"=t."empresaId" WHERE t."empresaId"=${empresaId} GROUP BY t.id), classificados AS (SELECT *, CASE WHEN "canceladoEm" IS NOT NULL THEN 'CANCELADO' WHEN pago=valor THEN 'PAGO' WHEN pago>0 THEN 'PARCIAL' ELSE 'ABERTO' END AS status FROM saldos), filtrados AS (SELECT * FROM classificados WHERE (${query.tipo}='todos' OR tipo::text=${query.tipo}) AND (${query.q}='' OR strpos(lower(descricao),lower(${query.q}))>0) AND (${query.status}='todos' OR status=${query.status} OR (${query.status}='ATRASADO' AND "canceladoEm" IS NULL AND pago<valor AND vencimento<${dataLoja()}::date)))`;
    return this.db.client.$transaction(async tx => {
      const [count] = await tx.$queryRaw<{ total: number }[]>(Prisma.sql`${base} SELECT COUNT(*)::int AS total FROM filtrados`);
      const rows = await tx.$queryRaw<(TituloRow & { pago: Prisma.Decimal })[]>(Prisma.sql`${base} SELECT * FROM filtrados ORDER BY vencimento ASC,id ASC LIMIT ${query.pageSize} OFFSET ${(query.page-1)*query.pageSize}`);
      return { itens: rows.map(r => this.tituloDTO(r, r.pago)), total: count.total, page: query.page, pageSize: query.pageSize, pages: Math.max(1, Math.ceil(count.total/query.pageSize)) };
    }, { isolationLevel: "RepeatableRead" });
  }
  async caixa(empresaId: string, query: ConsultaCaixa) {
    const hoje = dataLoja(), de = query.de ?? hoje.slice(0, 7) + "-01", ate = query.ate ?? hoje;
    if (de > ate) throw new BadRequestException("Confira o período informado.");
    return this.db.client.$transaction(async tx => {
      if (query.contaId && !await tx.contaFinanceira.findFirst({ where: { empresaId, id: query.contaId } })) throw new NotFoundException("Conta financeira não encontrada.");
      const where = { empresaId, ...(query.contaId ? { contaId: query.contaId } : {}), data: { gte: new Date(de + "T00:00:00Z"), lte: new Date(ate + "T00:00:00Z") } };
      const itens = await tx.lancamentoFinanceiro.findMany({ where, include: lancamentoInclude, orderBy: [{ data: "desc" }, { createdAt: "desc" }, { id: "desc" }], skip: (query.page-1)*query.pageSize, take: query.pageSize });
      const total = await tx.lancamentoFinanceiro.count({ where });
      const entradas = await tx.lancamentoFinanceiro.aggregate({ where: { ...where, valor: { gt: 0 } }, _sum: { valor: true } });
      const saidas = await tx.lancamentoFinanceiro.aggregate({ where: { ...where, valor: { lt: 0 } }, _sum: { valor: true } });
      const saldo = await tx.lancamentoFinanceiro.aggregate({ where: { empresaId, ...(query.contaId ? { contaId: query.contaId } : {}) }, _sum: { valor: true } });
      const pendentes = await tx.$queryRaw<{ tipo: string; valor: Prisma.Decimal }[]>`SELECT t.tipo::text, SUM(t.valor-COALESCE(p.pago,0)) AS valor FROM "TituloFinanceiro" t LEFT JOIN (SELECT "tituloId", SUM(valor)*CASE WHEN SUM(valor)>=0 THEN 1 ELSE -1 END AS pago FROM "LancamentoFinanceiro" WHERE "empresaId"=${empresaId} GROUP BY "tituloId") p ON p."tituloId"=t.id WHERE t."empresaId"=${empresaId} AND t."canceladoEm" IS NULL AND t.vencimento BETWEEN ${de}::date AND ${ate}::date GROUP BY t.tipo`;
      const entrada = new Dinheiro(entradas._sum.valor?.toString() ?? "0"), saida = new Dinheiro(saidas._sum.valor?.toString() ?? "0").negated();
      return { itens: itens.map(r => this.lancamentoDTO(r)), total, page: query.page, pageSize: query.pageSize, pages: Math.max(1, Math.ceil(total/query.pageSize)), de, ate, resumo: { entradas: entrada.toFixed(2), saidas: saida.toFixed(2), resultado: entrada.minus(saida).toFixed(2), saldoAtual: (saldo._sum.valor ?? new Dinheiro(0)).toFixed(2), aPagar: pendentes.find(p => p.tipo === "PAGAR")?.valor.toFixed(2) ?? "0.00", aReceber: pendentes.find(p => p.tipo === "RECEBER")?.valor.toFixed(2) ?? "0.00" } };
    }, { isolationLevel: "RepeatableRead" });
  }
}
