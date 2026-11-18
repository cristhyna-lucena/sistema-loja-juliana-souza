import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@sistema/db";
import type { CategoriaInput, CategoriaEdicao, CategoriaDTO, ProdutoInput, ProdutoEdicao, ProdutoDTO, ListaCatalogo } from "@sistema/shared";
import { DatabaseService } from "../database.service";
import type { Identity } from "../auth/auth.service";
type CategoriaRow = { id: string; nome: string; ativa: boolean; versao: number };
type ProdutoRow = Prisma.ProdutoGetPayload<{ include: { categoria: true } }> & { imagens?: {id:string;alt:string}[] };
@Injectable()
export class CatalogoService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}
  private categoriaDTO(row: CategoriaRow): CategoriaDTO { return { id: row.id, nome: row.nome, ativa: row.ativa, versao: row.versao }; }
  private produtoDTO(row: ProdutoRow): ProdutoDTO { return { id: row.id, nome: row.nome, descricao: row.descricao, sku: row.sku, tipo: row.tipo, unidade: row.unidade as ProdutoInput["unidade"], precoVenda: row.precoVenda.toFixed(2), custoCompra: row.custoCompra?.toFixed(4) ?? null, custoMedio: row.custoMedio?.toFixed(4) ?? null, estoqueMinimo: row.estoqueMinimo.toFixed(3), ativo: row.ativo, categoriaId: row.categoriaId, categoria: row.categoria ? this.categoriaDTO(row.categoria) : null, versao: row.versao, ...(row.imagens?.[0] ? { imagemPrincipal: { id: row.imagens[0].id, alt: row.imagens[0].alt } } : {}) }; }
  private duplicate(error: unknown, categoria = false): never {
    if ((error as { code?: string })?.code === "P2002") throw new ConflictException({ code: categoria ? "DUPLICATE_CATEGORY" : "DUPLICATE_SKU", message: categoria ? "Já existe uma categoria com esse nome." : "SKU já cadastrado nesta empresa." });
    throw error;
  }
  private async audit(tx: Prisma.TransactionClient, user: Identity, entidade: string, entidadeId: string, acao: string, dados: Prisma.InputJsonObject) {
    await tx.auditLog.create({ data: { empresaId: user.empresaId, usuarioId: user.id, entidade, entidadeId, acao, dados } });
  }
  private stale(): never { throw new ConflictException({ code: "CONCURRENT_EDIT", message: "Este cadastro foi alterado por outra pessoa. Recarregue antes de salvar." }); }
  async categorias(empresaId: string, query: ListaCatalogo) {
    const where: Prisma.CategoriaWhereInput = { empresaId, ...(query.q ? { nome: { contains: query.q, mode: "insensitive" } } : {}), ...(query.status !== "todos" ? { ativa: query.status === "ativos" } : {}) };
    const [rows, total] = await this.db.client.$transaction([
      this.db.client.categoria.findMany({ where, orderBy: [{ nome: "asc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.db.client.categoria.count({ where }),
    ]);
    return { itens: rows.map(row => this.categoriaDTO(row)), total, page: query.page, pageSize: query.pageSize, pages: Math.max(1, Math.ceil(total / query.pageSize)) };
  }
  async opcoes(empresaId: string) { return (await this.db.client.categoria.findMany({ where: { empresaId }, orderBy: [{ nome: "asc" }, { id: "asc" }] })).map(row => this.categoriaDTO(row)); }
  async categoria(empresaId: string, id: string) {
    const row = await this.db.client.categoria.findFirst({ where: { id, empresaId } });
    if (!row) throw new NotFoundException("Categoria não encontrada.");
    return this.categoriaDTO(row);
  }
  async criarCategoria(user: Identity, data: CategoriaInput) {
    try { return await this.db.client.$transaction(async tx => {
      const row = await tx.categoria.create({ data: { ...data, nomeChave: data.nome.normalize("NFKC").toLocaleLowerCase("pt-BR"), empresaId: user.empresaId } });
      const result = this.categoriaDTO(row);
      await this.audit(tx, user, "Categoria", row.id, "CRIAR", { depois: { ...result } });
      return result;
    }); } catch (error) { this.duplicate(error, true); }
  }
  async editarCategoria(user: Identity, id: string, input: CategoriaEdicao) {
    const { versao, ...data } = input;
    try { return await this.db.client.$transaction(async tx => {
      const before = await tx.categoria.findFirst({ where: { id, empresaId: user.empresaId } });
      if (!before) throw new NotFoundException("Categoria não encontrada.");
      const changed = await tx.categoria.updateMany({ where: { id, empresaId: user.empresaId, versao }, data: { ...data, ...(data.nome ? { nomeChave: data.nome.normalize("NFKC").toLocaleLowerCase("pt-BR") } : {}), versao: { increment: 1 } } });
      if (!changed.count) this.stale();
      const row = await tx.categoria.findFirstOrThrow({ where: { id, empresaId: user.empresaId } });
      const result = this.categoriaDTO(row);
      await this.audit(tx, user, "Categoria", id, "EDITAR", { antes: { ...this.categoriaDTO(before) }, depois: { ...result } });
      return result;
    }); } catch (error) { this.duplicate(error, true); }
  }
  async produtos(empresaId: string, query: ListaCatalogo) {
    const where: Prisma.ProdutoWhereInput = { empresaId, ...(query.q ? { OR: [{ nome: { contains: query.q, mode: "insensitive" } }, { sku: { contains: query.q, mode: "insensitive" } }] } : {}), ...(query.status !== "todos" ? { ativo: query.status === "ativos" } : {}) };
    const [rows, total] = await this.db.client.$transaction([
      this.db.client.produto.findMany({ where, include: { categoria: true, imagens: { where: { removidaEm: null, hash: { not: null } }, orderBy: [{ordem:"asc"},{id:"asc"}], take: 1, select: {id:true,alt:true} } }, orderBy: [{ nome: "asc" }, { id: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.db.client.produto.count({ where }),
    ]);
    return { itens: rows.map(row => this.produtoDTO(row)), total, page: query.page, pageSize: query.pageSize, pages: Math.max(1, Math.ceil(total / query.pageSize)) };
  }
  async produto(empresaId: string, id: string) {
    const row = await this.db.client.produto.findFirst({ where: { id, empresaId }, include: { categoria: true } });
    if (!row) throw new NotFoundException("Produto não encontrado.");
    return this.produtoDTO(row);
  }
  private async validarCategoria(tx: Prisma.TransactionClient, empresaId: string, id: string | null | undefined, atual?: string | null) {
    if (id && id !== atual && !await tx.categoria.findFirst({ where: { id, empresaId, ativa: true } })) throw new BadRequestException("Categoria inválida ou inativa.");
  }
  async criarProduto(user: Identity, data: ProdutoInput) {
    try { return await this.db.client.$transaction(async tx => {
      await this.validarCategoria(tx, user.empresaId, data.categoriaId);
      const row = await tx.produto.create({ data: { ...data, empresaId: user.empresaId }, include: { categoria: true } });
      const result = this.produtoDTO(row);
      await this.audit(tx, user, "Produto", row.id, "CRIAR", { depois: { ...result } });
      return result;
    }); } catch (error) { this.duplicate(error); }
  }
  async editarProduto(user: Identity, id: string, input: ProdutoEdicao) {
    const { versao, ...data } = input;
    try { return await this.db.client.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Produto" WHERE id = ${id} AND "empresaId" = ${user.empresaId} FOR UPDATE`;
      const before = await tx.produto.findFirst({ where: { id, empresaId: user.empresaId }, include: { categoria: true } });
      if (!before) throw new NotFoundException("Produto não encontrado.");
      if (data.unidade && data.unidade !== before.unidade && await tx.movimentoEstoque.count({ where: { empresaId: user.empresaId, produtoId: id } })) throw new BadRequestException("A unidade não pode ser alterada após movimentações de estoque. Cadastre outro produto para usar uma unidade diferente.");
      await this.validarCategoria(tx, user.empresaId, data.categoriaId, before.categoriaId);
      const changed = await tx.produto.updateMany({ where: { id, empresaId: user.empresaId, versao }, data: { ...data, versao: { increment: 1 } } });
      if (!changed.count) this.stale();
      const row = await tx.produto.findFirstOrThrow({ where: { id, empresaId: user.empresaId }, include: { categoria: true } });
      const result = this.produtoDTO(row);
      await this.audit(tx, user, "Produto", id, "EDITAR", { antes: { ...this.produtoDTO(before) }, depois: { ...result } });
      return result;
    }); } catch (error) { this.duplicate(error); }
  }
}
