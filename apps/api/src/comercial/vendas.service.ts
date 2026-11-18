import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@sistema/db";
import type { VendaInput, ListaVendas, MotivoComercial, BaixaInput, VendaDTO } from "@sistema/shared";
import type { Identity } from "../auth/auth.service";
import { DatabaseService } from "../database.service";
import { dataLoja } from "../gestao/data-loja";
import { EstoqueService } from "../gestao/estoque.service";
import { ComercialService, Dinheiro, ratearValor } from "./comercial.service";
import { FinanceiroService } from "./financeiro.service";
@Injectable()
export class VendasService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService, @Inject(ComercialService) private readonly comercial: ComercialService, @Inject(EstoqueService) private readonly estoque: EstoqueService, @Inject(FinanceiroService) private readonly financeiro: FinanceiroService) {}
  async detalheTx(tx: Prisma.TransactionClient, empresaId: string, id: string): Promise<VendaDTO> {
    const row = await tx.venda.findFirst({ where: { empresaId, id }, include: { itens: { orderBy: { id: "asc" } }, titulo: true } });
    if (!row) throw new NotFoundException("Venda não encontrada.");
    if (!row.titulo) throw new ConflictException("Venda sem conta a receber. Confira a integridade do cadastro.");
    const titulo = await this.financeiro.tituloTx(tx, empresaId, row.titulo.id);
    const parcelas = await tx.tituloFinanceiro.findMany({ where: { empresaId, origemTipo: "VENDA_PARCELA", origemId: id }, orderBy: [{ vencimento: "asc" }, { parcela: "asc" }] });
    const recebimentos = await tx.lancamentoFinanceiro.findMany({ where: { empresaId, tituloId: { in: [row.titulo.id, ...parcelas.map(parcela => parcela.id)] } }, include: { conta: { select: { nome: true } }, titulo: { select: { descricao: true } }, estornos: { select: { id: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    const parcelasDTO = [];
    for (const parcela of parcelas) { const saldoParcela = await this.financeiro.tituloTx(tx, empresaId, parcela.id); parcelasDTO.push(this.financeiro.tituloDTO(parcela, saldoParcela.pago)); }
    const tituloDTO = this.financeiro.tituloDTO(titulo.row, titulo.pago);
    if (parcelas.length && row.status !== "CANCELADA") {
      const pago = recebimentos.reduce((sum, recebimento) => sum.plus(recebimento.valor), new Dinheiro(0)), saldo = new Dinheiro(row.total.toString()).minus(pago);
      Object.assign(tituloDTO, { vencimento: parcelasDTO.find(parcela => parcela.saldo !== "0.00")?.vencimento ?? tituloDTO.vencimento, atrasado: parcelasDTO.some(parcela => parcela.atrasado), valor: row.total.toFixed(2), valorPago: pago.toFixed(2), saldo: saldo.toFixed(2), status: saldo.isZero() ? "PAGO" : pago.greaterThan(0) ? "PARCIAL" : "ABERTO", canceladoEm: null, motivoCancelamento: null });
    }
    return { id: row.id, numero: row.numero, clienteId: row.clienteId, clienteNome: row.clienteNome, status: row.status, subtotal: row.subtotal.toFixed(2), desconto: row.desconto.toFixed(2), total: row.total.toFixed(2), observacao: row.observacao, createdAt: row.createdAt.toISOString(), canceladaEm: row.canceladaEm?.toISOString() ?? null, motivoCancelamento: row.motivoCancelamento, titulo: tituloDTO, itens: row.itens.map(i => ({ id: i.id, produtoId: i.produtoId, nome: i.nome, sku: i.sku, unidade: i.unidade, quantidade: i.quantidade.toFixed(3), precoUnitario: i.precoUnitario.toFixed(2), total: i.total.toFixed(2) })), parcelas: parcelasDTO, recebimentos: recebimentos.map(r => this.financeiro.lancamentoDTO(r)) };
  }
  detalhe(empresaId: string, id: string) { return this.db.client.$transaction(tx => this.detalheTx(tx, empresaId, id), { isolationLevel: "RepeatableRead" }); }
  async listar(empresaId: string, query: ListaVendas) {
    const numero = /^\d{1,9}$/.test(query.q) ? Number(query.q) : undefined;
    const where: Prisma.VendaWhereInput = { empresaId, ...(query.status !== "todos" ? { status: query.status } : {}), ...(query.q ? { OR: [{ clienteNome: { contains: query.q, mode: "insensitive" } }, ...(numero !== undefined ? [{ numero }] : [])] } : {}) };
    return this.db.client.$transaction(async tx => {
      const rows = await tx.venda.findMany({ where, select: { id: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (query.page-1)*query.pageSize, take: query.pageSize });
      const itens = []; for (const row of rows) itens.push(await this.detalheTx(tx, empresaId, row.id));
      const total = await tx.venda.count({ where });
      return { itens, total, page: query.page, pageSize: query.pageSize, pages: Math.max(1, Math.ceil(total/query.pageSize)) };
    }, { isolationLevel: "RepeatableRead", timeout: 15000 });
  }
  criar(user: Identity, input: VendaInput) {
    return this.comercial.executar(user, "CRIAR_VENDA", input, tx => this.criarTx(tx, user, input), (tx, id) => this.detalheTx(tx, user.empresaId, id));
  }
  async criarTx(tx: Prisma.TransactionClient, user: Identity, input: VendaInput, opcoes?: { frete: string; precosReservados: boolean }) {
      const cliente = input.clienteId ? await tx.cliente.findFirst({ where: { empresaId: user.empresaId, id: input.clienteId, ativo: true } }) : null;
      if (input.clienteId && !cliente) throw new BadRequestException("Cliente inválido ou inativo.");
      for (const id of input.itens.map(i => i.produtoId).sort()) await tx.$queryRaw`SELECT id FROM "Produto" WHERE "empresaId"=${user.empresaId} AND id=${id} FOR UPDATE`;
      const produtos = await tx.produto.findMany({ where: { empresaId: user.empresaId, id: { in: input.itens.map(i => i.produtoId) } } });
      const itens = input.itens.map(i => {
        const produto = produtos.find(p => p.id === i.produtoId);
        if (!produto || !produto.ativo || produto.tipo === "INSUMO") throw new BadRequestException("Produto inválido, inativo ou destinado apenas a insumo.");
        if (!opcoes?.precosReservados && !produto.precoVenda.equals(i.precoUnitario)) throw new ConflictException("O preço de " + produto.nome + " foi alterado. Atualize o produto na venda.");
        const total = new Dinheiro(i.quantidade).times(i.precoUnitario).toDecimalPlaces(2);
        if (total.greaterThan("9999999999.99")) throw new BadRequestException("O valor do item excede o limite permitido.");
        return { empresaId: user.empresaId, produtoId: produto.id, nome: produto.nome, sku: produto.sku, unidade: produto.unidade, quantidade: i.quantidade, precoUnitario: i.precoUnitario, total };
      });
      const subtotal = itens.reduce((s,i) => s.plus(i.total), new Dinheiro(0)), desconto = new Dinheiro(input.desconto), frete = new Dinheiro(opcoes?.frete ?? "0"), total = subtotal.minus(desconto).plus(frete);
      if (total.lessThanOrEqualTo(0) || subtotal.greaterThan("9999999999.99")) throw new BadRequestException("Confira os itens e o desconto. O total deve ser maior que zero e respeitar o limite permitido.");
      const recebido = new Dinheiro(input.recebimento?.valor ?? "0");
      if (recebido.greaterThan(total)) throw new BadRequestException("O recebimento não pode exceder o total da venda.");
      if (recebido.lessThan(total) && (!cliente || !input.vencimento || input.vencimento < dataLoja())) throw new BadRequestException("Venda com saldo a receber exige cliente e vencimento a partir de hoje.");
      const venda = await tx.venda.create({ data: { empresaId: user.empresaId, clienteId: cliente?.id ?? null, clienteNome: cliente?.nome ?? null, subtotal, desconto, frete, total, observacao: input.observacao } });
      await tx.vendaItem.createMany({ data: itens.map(item => ({ ...item, vendaId: venda.id })) });
      for (const item of [...itens].sort((a,b) => a.produtoId.localeCompare(b.produtoId))) await this.estoque.baixarVenda(tx, user, item.produtoId, new Dinheiro(item.quantidade), venda.id, venda.numero);
      const titulo = await tx.tituloFinanceiro.create({ data: { empresaId: user.empresaId, tipo: "RECEBER", descricao: "Venda " + venda.numero + (cliente ? " · " + cliente.nome : " · Consumidor não identificado"), valor: total, vencimento: new Date((input.vencimento ?? dataLoja()) + "T00:00:00Z"), clienteId: cliente?.id ?? null, vendaId: venda.id } });
      if (input.recebimento) await this.financeiro.baixarTx(tx, user, titulo.id, input.recebimento);
      await this.comercial.auditar(tx, user, "Venda", venda.id, "CONFIRMAR", { numero: venda.numero, clienteId: cliente?.id ?? null, subtotal: subtotal.toFixed(2), desconto: desconto.toFixed(2), total: total.toFixed(2), tituloId: titulo.id });
      return venda.id;
  }
  receber(user: Identity, id: string, input: BaixaInput) {
    return this.comercial.executar(user, "RECEBER_VENDA:" + id, input, async tx => {
      const venda = await tx.venda.findFirst({ where: { empresaId: user.empresaId, id }, include: { titulo: true } });
      if (!venda) throw new NotFoundException("Venda não encontrada.");
      if (venda.status === "CANCELADA" || !venda.titulo) throw new ConflictException("Venda cancelada ou sem conta a receber.");
      const parcelas = await tx.tituloFinanceiro.findMany({ where: { empresaId: user.empresaId, origemTipo: "VENDA_PARCELA", origemId: id, canceladoEm: null }, orderBy: [{ vencimento: "asc" }, { parcela: "asc" }] });
      if (!parcelas.length) await this.financeiro.baixarTx(tx, user, venda.titulo.id, input);
      else {
        let restante = new Dinheiro(input.valor);
        const alocacoes: { id: string; valor: Prisma.Decimal }[] = [];
        for (const parcela of parcelas) {
          const { pago } = await this.financeiro.tituloTx(tx, user.empresaId, parcela.id);
          const usar = Dinheiro.min(restante, new Dinheiro(parcela.valor.toString()).minus(pago));
          if (usar.greaterThan(0)) { alocacoes.push({ id: parcela.id, valor: usar }); restante = restante.minus(usar); }
        }
        if (restante.greaterThan(0)) throw new ConflictException("O recebimento excede o saldo das parcelas.");
        const taxas = input.taxa ? ratearValor(new Dinheiro(input.taxa), alocacoes.map(alocacao => alocacao.valor)) : null;
        for (const [index, alocacao] of alocacoes.entries()) await this.financeiro.baixarTx(tx, user, alocacao.id, { ...input, valor: alocacao.valor.toFixed(2), taxa: taxas?.[index].toFixed(2) });
      }
      return id;
    }, (tx, result) => this.detalheTx(tx, user.empresaId, result));
  }
  cancelar(user: Identity, id: string, input: MotivoComercial) {
    return this.comercial.executar(user, "CANCELAR_VENDA:" + id, input, tx => this.cancelarTx(tx, user, id, input.motivo), (tx, result) => this.detalheTx(tx, user.empresaId, result));
  }
  parcelar(user: Identity, id: string, input: { chaveOperacao: string; parcelas: { valor: string; vencimento: string }[] }) {
    return this.comercial.executar(user, "PARCELAR_VENDA:" + id, input, async tx => {
      const venda = await tx.venda.findFirst({ where: { empresaId: user.empresaId, id, status: "CONFIRMADA" }, include: { titulo: true } });
      if (!venda?.titulo || !venda.clienteId) throw new ConflictException("Selecione uma venda confirmada com cliente cadastrado.");
      const { row, pago } = await this.financeiro.tituloTx(tx, user.empresaId, venda.titulo.id);
      if (row.canceladoEm || await tx.tituloFinanceiro.count({ where: { empresaId: user.empresaId, origemTipo: "VENDA_PARCELA", origemId: id } })) throw new ConflictException("O saldo desta venda já foi parcelado ou cancelado.");
      const saldo = new Dinheiro(row.valor.toString()).minus(pago), soma = input.parcelas.reduce((sum, parcela) => sum.plus(parcela.valor), new Dinheiro(0));
      if (!saldo.greaterThan(0) || !saldo.equals(soma) || input.parcelas.some(parcela => parcela.vencimento < dataLoja())) throw new BadRequestException("As parcelas devem somar o saldo da venda e vencer a partir de hoje.");
      await tx.tituloFinanceiro.update({ where: { id: row.id }, data: { canceladoEm: new Date(), motivoCancelamento: "Saldo substituído por parcelas da venda" } });
      await tx.tituloFinanceiro.createMany({ data: input.parcelas.map((parcela, index) => ({ empresaId: user.empresaId, tipo: "RECEBER" as const, clienteId: venda.clienteId, descricao: "Venda " + venda.numero + " · " + (index + 1) + "/" + input.parcelas.length, valor: parcela.valor, vencimento: new Date(parcela.vencimento + "T00:00:00Z"), origemTipo: "VENDA_PARCELA", origemId: id, parcela: index + 1, totalParcelas: input.parcelas.length })) });
      await this.comercial.auditar(tx, user, "Venda", id, "PARCELAR", { saldo: saldo.toFixed(2), parcelas: input.parcelas.length });
      return id;
    }, (tx, result) => this.detalheTx(tx, user.empresaId, result));
  }
  async cancelarTx(tx: Prisma.TransactionClient, user: Identity, id: string, motivo: string) {
      const venda = await tx.venda.findFirst({ where: { empresaId: user.empresaId, id }, include: { titulo: true } });
      if (!venda) throw new NotFoundException("Venda não encontrada.");
      if (venda.status === "CANCELADA" || !venda.titulo) throw new ConflictException("Venda já cancelada ou sem conta a receber.");
      if (await tx.notaEmitida.count({ where: { empresaId: user.empresaId, vendaId: id, status: { in: ["PENDENTE", "PROCESSANDO", "AUTORIZADA"] } } })) throw new ConflictException("Conclua o cancelamento da nota fiscal na área Fiscal antes de cancelar esta venda.");
      await this.estoque.devolverVenda(tx, user, id, ("Cancelamento da venda " + venda.numero + ": " + motivo).slice(0, 500));
      const titulos = await tx.tituloFinanceiro.findMany({ where: { empresaId: user.empresaId, OR: [{ vendaId: id }, { origemTipo: "VENDA_PARCELA", origemId: id }] } });
      const baixas = await tx.lancamentoFinanceiro.findMany({ where: { empresaId: user.empresaId, tituloId: { in: titulos.map(titulo => titulo.id) }, estornoDeId: null, estornos: { none: {} } } });
      for (const baixa of baixas) await this.financeiro.estornarTx(tx, user, baixa.id, motivo);
      await tx.tituloFinanceiro.updateMany({ where: { empresaId: user.empresaId, id: { in: titulos.map(titulo => titulo.id) } }, data: { canceladoEm: new Date(), motivoCancelamento: motivo } });
      await tx.venda.update({ where: { id }, data: { status: "CANCELADA", canceladaEm: new Date(), motivoCancelamento: motivo } });
      await this.comercial.auditar(tx, user, "Venda", id, "CANCELAR", { motivo, numero: venda.numero }); return id;
  }
}
