import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@sistema/db";
import type { ClienteInput, FornecedorInput, ContatoEdicao, ListaCatalogo } from "@sistema/shared";
import type { Identity } from "../auth/auth.service";
import { DatabaseService } from "../database.service";
type Cadastro = "cliente" | "fornecedor";
@Injectable()
export class CadastrosService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}
  private snapshot(row: { nome: string; cpfCnpj: string | null; email: string | null; telefone: string | null; ativo: boolean; versao: number }): Prisma.InputJsonObject {
    return { nome: row.nome, cpfCnpj: row.cpfCnpj, email: row.email, telefone: row.telefone, ativo: row.ativo, versao: row.versao };
  }
  async listar(tipo: Cadastro, empresaId: string, query: ListaCatalogo) {
    const documentoBusca = query.q.replace(/[.\/-]/g, "").toUpperCase();
    const where = { empresaId, ...(query.status !== "todos" ? { ativo: query.status === "ativos" } : {}), ...(query.q ? { OR: [{ nome: { contains: query.q, mode: "insensitive" as const } }, ...(documentoBusca ? [{ cpfCnpj: { contains: documentoBusca } }] : []), { email: { contains: query.q, mode: "insensitive" as const } }] } : {}) };
    return this.db.client.$transaction(async tx => {
      const args = { where, orderBy: [{ nome: "asc" as const }, { id: "asc" as const }], skip: (query.page - 1) * query.pageSize, take: query.pageSize };
      const itens = tipo === "cliente" ? await tx.cliente.findMany(args) : await tx.fornecedor.findMany(args);
      const total = tipo === "cliente" ? await tx.cliente.count({ where }) : await tx.fornecedor.count({ where });
      return { itens, total, page: query.page, pageSize: query.pageSize, pages: Math.max(1, Math.ceil(total / query.pageSize)) };
    }, { isolationLevel: "RepeatableRead" });
  }
  async detalhe(tipo: Cadastro, empresaId: string, id: string) {
    const where = { empresaId, id };
    const row = tipo === "cliente" ? await this.db.client.cliente.findFirst({ where }) : await this.db.client.fornecedor.findFirst({ where });
    if (!row) throw new NotFoundException("Cadastro não encontrado.");
    return row;
  }
  private erro(error: unknown): never {
    if ((error as { code?: string })?.code === "P2002") throw new ConflictException("CPF/CNPJ já cadastrado nesta empresa.");
    throw error;
  }
  async criar(tipo: Cadastro, user: Identity, input: ClienteInput | FornecedorInput) {
    try { return await this.db.client.$transaction(async tx => {
      const data = { ...input, empresaId: user.empresaId };
      const row = tipo === "cliente" ? await tx.cliente.create({ data }) : await tx.fornecedor.create({ data: { ...data, cpfCnpj: input.cpfCnpj! } });
      await tx.auditLog.create({ data: { empresaId: user.empresaId, usuarioId: user.id, entidade: tipo, entidadeId: row.id, acao: "CRIAR", dados: { depois: this.snapshot(row) } } });
      return row;
    }); } catch (error) { this.erro(error); }
  }
  async editar(tipo: Cadastro, user: Identity, id: string, input: ContatoEdicao) {
    const { versao, ...data } = input;
    try { return await this.db.client.$transaction(async tx => {
      const where = { id, empresaId: user.empresaId };
      const before = tipo === "cliente" ? await tx.cliente.findFirst({ where }) : await tx.fornecedor.findFirst({ where });
      if (!before) throw new NotFoundException("Cadastro não encontrado.");
      const args = { where: { ...where, versao }, data: { ...data, versao: { increment: 1 } } };
      const changed = tipo === "cliente" ? await tx.cliente.updateMany(args) : await tx.fornecedor.updateMany({ ...args, data: { ...args.data, cpfCnpj: data.cpfCnpj ?? undefined } });
      if (!changed.count) throw new ConflictException("Cadastro alterado por outra pessoa. Recarregue antes de salvar.");
      const row = tipo === "cliente" ? await tx.cliente.findFirstOrThrow({ where }) : await tx.fornecedor.findFirstOrThrow({ where });
      await tx.auditLog.create({ data: { empresaId: user.empresaId, usuarioId: user.id, entidade: tipo, entidadeId: id, acao: "EDITAR", dados: { antes: this.snapshot(before), depois: this.snapshot(row), campos: Object.keys(data) } } });
      return row;
    }); } catch (error) { this.erro(error); }
  }
}
