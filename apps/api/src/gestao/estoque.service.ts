import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@sistema/db";
import type { LoteInput, MovimentoInput, EstornoInput, ListaMovimentos } from "@sistema/shared";
import type { Identity } from "../auth/auth.service";
import { DatabaseService } from "../database.service";
import { dataLoja, somarDias } from "./data-loja";
import { randomUUID } from "node:crypto";
type Movimento = Prisma.MovimentoEstoqueGetPayload<{}>;
// Quantidade (3 casas) × custo (4 casas) exige mais precisão que o padrão do Decimal.
const Decimal = Prisma.Decimal.clone({ precision: 40, rounding: Prisma.Decimal.ROUND_HALF_UP });
@Injectable()
export class EstoqueService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}
  private dto(row: Movimento) { return { ...row, quantidade: row.quantidade.toFixed(3), custoUnitario: row.custoUnitario?.toFixed(4) ?? null, valorMovimento: row.valorMovimento?.toFixed(7) ?? null }; }
  private async produto(tx: Prisma.TransactionClient, empresaId: string, produtoId: string, bloquear = false) {
    if (bloquear) await tx.$queryRaw`SELECT id FROM "Produto" WHERE id = ${produtoId} AND "empresaId" = ${empresaId} FOR UPDATE`;
    const row = await tx.produto.findFirst({ where: { empresaId, id: produtoId } });
    if (!row) throw new NotFoundException("Produto não encontrado.");
    return row;
  }
  private async auditar(tx: Prisma.TransactionClient, user: Identity, entidade: string, id: string, dados: Prisma.InputJsonObject) {
    await tx.auditLog.create({ data: { empresaId: user.empresaId, usuarioId: user.id || null, entidade, entidadeId: id, acao: "CRIAR", dados } });
  }
  private async saldo(tx: Prisma.TransactionClient, empresaId: string, produtoId: string, loteId?: string | null) {
    const sum = await tx.movimentoEstoque.aggregate({ where: { empresaId, produtoId, ...(loteId !== undefined ? { loteId } : {}) }, _sum: { quantidade: true } });
    return sum._sum.quantidade ?? new Prisma.Decimal(0);
  }
  async disponivelTx(tx: Prisma.TransactionClient, empresaId: string, produtoId: string) {
    const grupos = await tx.movimentoEstoque.groupBy({ by: ["loteId"], where: { empresaId, produtoId }, _sum: { quantidade: true } });
    const vencidos = await tx.lote.findMany({ where: { empresaId, produtoId, validade: { lt: new Date(dataLoja() + "T00:00:00Z") } }, select: { id: true } });
    const saldo = grupos.filter(grupo => !vencidos.some(lote => lote.id === grupo.loteId)).reduce((total, grupo) => total.plus(grupo._sum.quantidade ?? 0), new Decimal(0));
    const reservas = await tx.reservaEstoque.aggregate({ where: { empresaId, produtoId, expiresAt: { gt: new Date() } }, _sum: { quantidade: true } });
    return saldo.minus(reservas._sum.quantidade ?? 0);
  }
  async consultarSaldo(empresaId: string, produtoId: string) {
    return this.db.client.$transaction(async tx => {
      const produto = await this.produto(tx, empresaId, produtoId);
      const grupos = await tx.movimentoEstoque.groupBy({ by: ["loteId"], where: { empresaId, produtoId }, _sum: { quantidade: true } });
      const lotes = await tx.lote.findMany({ where: { empresaId, produtoId }, orderBy: [{ validade: "asc" }, { numero: "asc" }] });
      const saldo = grupos.reduce((sum, g) => sum.plus(g._sum.quantidade ?? 0), new Prisma.Decimal(0));
      const hoje = dataLoja();
      const limite = somarDias(hoje, 30);
      return { produtoId, dataReferencia: hoje, saldo: saldo.toFixed(3), estoqueMinimo: produto.estoqueMinimo.toFixed(3), custoCompra: produto.custoCompra?.toFixed(4) ?? null, custoMedio: produto.custoMedio?.toFixed(4) ?? null, valorEstoque: produto.valorEstoque?.toFixed(2) ?? null, reposicao: produto.ativo && produto.estoqueMinimo.greaterThan(0) && saldo.lessThanOrEqualTo(produto.estoqueMinimo), lotes: lotes.map(l => ({ ...l, validade: l.validade?.toISOString().slice(0, 10) ?? null, alertaValidade: produto.ativo && l.validade && (grupos.find(g => g.loteId === l.id)?._sum.quantidade?.greaterThan(0)) ? (l.validade.toISOString().slice(0, 10) < hoje ? "VENCIDO" : l.validade.toISOString().slice(0, 10) <= limite ? "A_VENCER" : null) : null, saldo: (grupos.find(g => g.loteId === l.id)?._sum.quantidade ?? new Prisma.Decimal(0)).toFixed(3) })), semLote: (grupos.find(g => g.loteId === null)?._sum.quantidade ?? new Prisma.Decimal(0)).toFixed(3) };
    }, { isolationLevel: "RepeatableRead" });
  }
  async criarLote(user: Identity, produtoId: string, input: LoteInput) {
    try { return await this.db.client.$transaction(async tx => {
      const produto = await this.produto(tx, user.empresaId, produtoId, true);
      if (!produto.ativo) throw new BadRequestException("Produto inativo.");
      const row = await tx.lote.create({ data: { empresaId: user.empresaId, produtoId, numero: input.numero, validade: input.validade ? new Date(input.validade + "T00:00:00.000Z") : null } });
      await this.auditar(tx, user, "Lote", row.id, { produtoId, numero: input.numero, validade: input.validade });
      return { ...row, validade: input.validade };
    }); } catch (error) {
      if ((error as { code?: string })?.code === "P2002") throw new ConflictException("Lote já cadastrado para este produto.");
      throw error;
    }
  }
  async historico(empresaId: string, produtoId: string, query: ListaMovimentos) {
    return this.db.client.$transaction(async tx => {
      await this.produto(tx, empresaId, produtoId);
      const where = { empresaId, produtoId, ...(query.loteId ? { loteId: query.loteId } : {}) };
      const itens = await tx.movimentoEstoque.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize });
      const total = await tx.movimentoEstoque.count({ where });
      return { itens: itens.map(row => this.dto(row)), total, page: query.page, pageSize: query.pageSize, pages: Math.max(1, Math.ceil(total / query.pageSize)) };
    }, { isolationLevel: "RepeatableRead" });
  }
  async gravar(tx: Prisma.TransactionClient, user: Identity, produtoId: string, data: { loteId: string | null; tipo: Movimento["tipo"]; quantidade: Prisma.Decimal; motivo: string; chaveOperacao: string; estornoDeId?: string; custoUnitario?: Prisma.Decimal | null; valorMovimento?: Prisma.Decimal | null; vendaId?: string; origemTipo?: string; origemId?: string }) {
    const atual = await this.saldo(tx, user.empresaId, produtoId, data.loteId);
    const novo = atual.plus(data.quantidade);
    if (novo.isNegative()) throw new ConflictException("Saldo insuficiente neste lote ou no estoque sem lote.");
    if (novo.greaterThan("999999999.999")) throw new BadRequestException("Saldo excede o limite permitido.");
    const produto = await this.produto(tx, user.empresaId, produtoId);
    const saldoAnterior = new Decimal((await this.saldo(tx, user.empresaId, produtoId)).toString());
    const saldoNovo = saldoAnterior.plus(data.quantidade);
    if (data.quantidade.isNegative()) {
      const lote = data.loteId ? await tx.lote.findFirst({ where: { empresaId: user.empresaId, produtoId, id: data.loteId } }) : null;
      const elegivel = !lote?.validade || lote.validade.toISOString().slice(0, 10) >= dataLoja();
      if (elegivel && (await this.disponivelTx(tx, user.empresaId, produtoId)).plus(data.quantidade).isNegative()) throw new ConflictException("Este saldo está reservado para pedidos da loja. Aguarde a conclusão ou o vencimento das reservas.");
    }
    const valorAnterior = produto.valorEstoque === null ? null : new Decimal(produto.valorEstoque.toString());
    let custo: Prisma.Decimal | null;
    let valor: Prisma.Decimal | null;
    if (data.tipo === "ESTORNO") {
      custo = data.custoUnitario ?? null; valor = data.valorMovimento ?? null;
    } else if (data.quantidade.isPositive()) {
      const referencia = data.custoUnitario ?? produto.custoCompra;
      custo = referencia === null ? null : new Decimal(referencia.toString());
      valor = data.valorMovimento !== undefined ? data.valorMovimento : custo === null ? null : new Decimal(data.quantidade.toString()).times(custo).toDecimalPlaces(7);
    } else {
      custo = produto.custoMedio;
      valor = valorAnterior === null ? null : saldoNovo.isZero() ? valorAnterior.negated() : valorAnterior.times(data.quantidade).div(saldoAnterior).toDecimalPlaces(7);
    }
    let valorNovo = valorAnterior === null || valor === null ? null : valorAnterior.plus(valor);
    if (saldoNovo.isZero()) {
      if (data.tipo === "ESTORNO" && valorNovo !== null && !valorNovo.isZero()) throw new ConflictException("Este estorno deixaria valor sem saldo. Estorne primeiro os movimentos posteriores que alteraram o custo.");
      valorNovo = new Decimal(0);
    }
    if (valorNovo?.isNegative()) throw new ConflictException("Este estorno deixaria o valor do estoque negativo. Estorne primeiro os movimentos posteriores que alteraram o custo.");
    const custoMedio = valorNovo === null ? null : saldoNovo.isZero() ? new Decimal(0) : valorNovo.div(saldoNovo).toDecimalPlaces(4);
    if (custoMedio?.greaterThan("99999999.9999") || valorNovo?.greaterThan("999999999999999999999.9999999")) throw new ConflictException("O custo resultante excede o limite permitido. Confira os movimentos e estornos.");
    const row = await tx.movimentoEstoque.create({ data: { ...data, custoUnitario: custo, valorMovimento: valor, empresaId: user.empresaId, produtoId } });
    await tx.produto.update({ where: { id: produtoId }, data: { custoMedio, valorEstoque: valorNovo } });
    await this.auditar(tx, user, "MovimentoEstoque", row.id, { produtoId, loteId: data.loteId, quantidade: data.quantidade.toFixed(3), tipo: data.tipo, motivo: data.motivo, estornoDeId: data.estornoDeId ?? null, custoUnitario: custo?.toFixed(4) ?? null, valorMovimento: valor?.toFixed(7) ?? null, custoMedioAntes: produto.custoMedio?.toFixed(4) ?? null, custoMedioDepois: custoMedio?.toFixed(4) ?? null });
    return this.dto(row);
  }
  private repetida(row: Movimento, produtoId: string, data: { loteId: string | null; tipo: Movimento["tipo"]; quantidade: Prisma.Decimal; motivo: string; estornoDeId?: string; custoUnitario?: Prisma.Decimal | null }) {
    const custoDiferente = data.custoUnitario !== undefined && (row.custoUnitario === null ? data.custoUnitario !== null : data.custoUnitario === null || !row.custoUnitario.equals(data.custoUnitario));
    if (row.produtoId !== produtoId || row.loteId !== data.loteId || row.tipo !== data.tipo || !row.quantidade.equals(data.quantidade) || row.motivo !== data.motivo || row.estornoDeId !== (data.estornoDeId ?? null) || custoDiferente) throw new ConflictException("Chave de operação já utilizada com outros dados.");
    return this.dto(row);
  }
  async movimentar(user: Identity, produtoId: string, input: MovimentoInput) {
    const quantidade = new Prisma.Decimal(input.quantidade);
    const data = { ...input, custoUnitario: input.custoUnitario === undefined ? undefined : new Decimal(input.custoUnitario), quantidade: input.tipo === "SAIDA" ? quantidade.negated() : quantidade };
    return this.db.client.$transaction(async tx => {
      const produto = await this.produto(tx, user.empresaId, produtoId, true);
      const repetida = await tx.movimentoEstoque.findUnique({ where: { empresaId_chaveOperacao: { empresaId: user.empresaId, chaveOperacao: input.chaveOperacao } } });
      if (repetida) return this.repetida(repetida, produtoId, data);
      if (!produto.ativo) throw new BadRequestException("Produto inativo.");
      if (input.loteId && !await tx.lote.findFirst({ where: { empresaId: user.empresaId, produtoId, id: input.loteId } })) throw new BadRequestException("Lote inválido para este produto.");
      return this.gravar(tx, user, produtoId, data);
    }).catch(error => this.conflito(error));
  }
  async estornar(user: Identity, produtoId: string, id: string, input: EstornoInput) {
    return this.db.client.$transaction(async tx => {
      await this.produto(tx, user.empresaId, produtoId, true);
      const original = await tx.movimentoEstoque.findFirst({ where: { empresaId: user.empresaId, produtoId, id } });
      if (!original) throw new NotFoundException("Movimentação não encontrada.");
      if (original.vendaId) throw new ConflictException("Movimentação vinculada a uma venda. Cancele a venda para devolver o estoque.");
      if (original.origemTipo) throw new ConflictException("Corrija este movimento pela operação de origem.");
      if (original.tipo === "ESTORNO") throw new BadRequestException("Um estorno não pode ser estornado.");
      const data = { ...input, loteId: original.loteId, tipo: "ESTORNO" as const, quantidade: original.quantidade.negated(), estornoDeId: id, custoUnitario: original.custoUnitario, valorMovimento: original.valorMovimento === null ? null : new Decimal(original.valorMovimento.toString()).negated() };
      const repetida = await tx.movimentoEstoque.findUnique({ where: { empresaId_chaveOperacao: { empresaId: user.empresaId, chaveOperacao: input.chaveOperacao } } });
      if (repetida) return this.repetida(repetida, produtoId, data);
      if (await tx.movimentoEstoque.findFirst({ where: { empresaId: user.empresaId, estornoDeId: id } })) throw new ConflictException("Movimentação já estornada.");
      return this.gravar(tx, user, produtoId, data);
    }).catch(error => this.conflito(error));
  }
  private conflito(error: unknown): never {
    if ((error as { code?: string })?.code === "P2002") throw new ConflictException("Chave de operação já utilizada.");
    throw error;
  }
  async baixarVenda(tx: Prisma.TransactionClient, user: Identity, produtoId: string, quantidade: Prisma.Decimal, vendaId: string, numero: number) {
    return this.consumir(tx, user, produtoId, quantidade, { vendaId, motivo: "Venda " + numero });
  }
  async consumir(tx: Prisma.TransactionClient, user: Identity, produtoId: string, quantidade: Prisma.Decimal, origem: { vendaId?: string; origemTipo?: string; origemId?: string; motivo: string }) {
    const produto = await this.produto(tx, user.empresaId, produtoId, true);
    if (!produto.ativo || origem.vendaId && produto.tipo === "INSUMO") throw new BadRequestException("Produto inativo ou destinado apenas a insumo.");
    const grupos = await tx.movimentoEstoque.groupBy({ by: ["loteId"], where: { empresaId: user.empresaId, produtoId }, _sum: { quantidade: true } });
    const lotes = await tx.lote.findMany({ where: { empresaId: user.empresaId, produtoId } });
    const hoje = dataLoja();
    const disponiveis = grupos.filter(g => g._sum.quantidade?.greaterThan(0)).map(g => ({ loteId: g.loteId, saldo: g._sum.quantidade!, validade: lotes.find(l => l.id === g.loteId)?.validade?.toISOString().slice(0, 10) ?? null }))
      .filter(g => !g.validade || g.validade >= hoje).sort((a,b) => (a.validade ?? "9999-12-31").localeCompare(b.validade ?? "9999-12-31") || (a.loteId === null ? 1 : b.loteId === null ? -1 : a.loteId.localeCompare(b.loteId)));
    const saldo = disponiveis.reduce((s,g) => s.plus(g.saldo), new Decimal(0));
    if (saldo.lessThan(quantidade)) throw new ConflictException("Saldo disponível insuficiente para " + produto.nome + ". Lotes vencidos não entram na venda.");
    let restante = new Decimal(quantidade.toString()), alocacoes = 0;
    for (const grupo of disponiveis) {
      if (restante.isZero()) break;
      if (++alocacoes > 50) throw new BadRequestException("A venda exige mais de 50 lotes para um produto. Divida a operação.");
      const usar = Decimal.min(restante, grupo.saldo);
      await this.gravar(tx, user, produtoId, { ...origem, loteId: grupo.loteId, tipo: "SAIDA", quantidade: usar.negated(), chaveOperacao: randomUUID() });
      restante = restante.minus(usar);
    }
  }
  async devolverVenda(tx: Prisma.TransactionClient, user: Identity, vendaId: string, motivo: string) {
    const originais = await tx.movimentoEstoque.findMany({ where: { empresaId: user.empresaId, vendaId, tipo: "SAIDA" }, orderBy: [{ produtoId: "asc" }, { createdAt: "desc" }, { id: "desc" }] });
    for (const produtoId of [...new Set(originais.map(m => m.produtoId))].sort()) await this.produto(tx, user.empresaId, produtoId, true);
    for (const original of originais) {
      if (await tx.movimentoEstoque.findFirst({ where: { empresaId: user.empresaId, estornoDeId: original.id } })) throw new ConflictException("A baixa de estoque desta venda já foi estornada.");
      await this.gravar(tx, user, original.produtoId, { loteId: original.loteId, tipo: "ESTORNO", quantidade: original.quantidade.negated(), motivo, chaveOperacao: randomUUID(), vendaId, estornoDeId: original.id, custoUnitario: original.custoUnitario, valorMovimento: original.valorMovimento === null ? null : new Decimal(original.valorMovimento.toString()).negated() });
    }
  }
}
