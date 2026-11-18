import type { PrismaClient } from "@sistema/db";
import { hash, argon2id } from "argon2";
import { PASSWORD_OPTIONS } from "./config";

export async function createInitialAdmin(db: PrismaClient, input: { empresaId?: string; nomeEmpresa: string; nome: string; email: string; senha: string }) {
  const nomeEmpresa = input.nomeEmpresa.trim();
  const nome = input.nome.trim();
  const email = input.email.trim().toLowerCase();
  if (!nomeEmpresa || nomeEmpresa.length > 150 || !nome || nome.length > 150 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Nome ou e-mail inválido.");
  if (input.senha.length < 12 || input.senha.length > 128) throw new Error("A senha deve ter entre 12 e 128 caracteres.");
  const senhaHash = await hash(input.senha, { ...PASSWORD_OPTIONS, type: argon2id });
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(823641)::text`;
    const empresas = await tx.empresa.findMany({ where: input.empresaId ? { id: input.empresaId } : {}, take: 2 });
    if (empresas.length > 1) throw new Error("Há mais de uma empresa. Configure EMPRESA_ID antes de continuar.");
    if (input.empresaId && empresas.length !== 1) throw new Error("EMPRESA_ID não encontrada.");
    if (empresas[0] && !empresas[0].ativa) throw new Error("Empresa inativa.");
    const empresa = empresas[0] ?? await tx.empresa.create({ data: { nome: nomeEmpresa } });
    if (await tx.usuario.count({ where: { empresaId: empresa.id, perfil: "ADMIN" } })) throw new Error("Já existe administrador. Este comando cria apenas o primeiro.");
    const user = await tx.usuario.create({ data: { empresaId: empresa.id, nome, email, senhaHash, perfil: "ADMIN" } });
    await tx.auditLog.create({ data: { empresaId: empresa.id, usuarioId: user.id, acao: "CRIAR_ADMIN_INICIAL", entidade: "Usuario", entidadeId: user.id, dados: {} } });
    return { id: user.id, empresaId: empresa.id };
  }, { timeout: 10000 });
}
