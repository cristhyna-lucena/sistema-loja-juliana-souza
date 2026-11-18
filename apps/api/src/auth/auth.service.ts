import { ForbiddenException, Inject, Injectable, OnModuleDestroy, OnModuleInit, ServiceUnavailableException, UnauthorizedException, HttpException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { createClient } from "redis";
import * as argon2 from "argon2";
import type { Request } from "express";
import { DatabaseService } from "../database.service";
import { cookieName, PASSWORD_OPTIONS, SESSION_SECONDS } from "./config";
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export type Identity = { id: string; empresaId: string; nome: string; perfil: "ADMIN" | "CONTADORA" | "OPERADOR" };
@Injectable()
export class AuthService implements OnModuleInit, OnModuleDestroy {
  private readonly redis = createClient({ url: process.env.REDIS_URL, socket: { connectTimeout: 5000, reconnectStrategy: false } });
  private dummyHash = "";
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {
    if (!process.env.REDIS_URL) throw new Error("REDIS_URL é obrigatória");
    this.redis.on("error", () => { /* Falhas são respondidas sem expor credenciais. */ });
  }
  async onModuleInit() {
    this.dummyHash = await argon2.hash(randomBytes(32), { ...PASSWORD_OPTIONS, type: argon2.argon2id });
    await this.redis.connect();
  }
  async onModuleDestroy() { if (this.redis.isOpen) await this.redis.quit(); }
  private async throttle(email: string, ip: string) {
    const prefix = process.env.AUTH_REDIS_PREFIX ?? "sistema-loja:auth";
    const script = "local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; return n;";
    try {
      const counts = await Promise.all([
        this.redis.eval(script, { keys: [prefix + ":ip:" + tokenHash(ip)], arguments: ["60"] }),
        this.redis.eval(script, { keys: [prefix + ":email:" + tokenHash(email)], arguments: ["900"] }),
      ]);
      if (Number(counts[0]) > 30 || Number(counts[1]) > 5) throw new HttpException("Muitas tentativas. Aguarde e tente novamente.", 429);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException("Acesso temporariamente indisponível.");
    }
  }
  limitar(chave: string, ip: string) { return this.throttle(chave, ip); }
  async login(email: string, password: string, ip: string, previousToken?: string) {
    await this.throttle(email, ip);
    const empresas = await this.db.client.empresa.findMany({ where: { ativa: true, ...(process.env.EMPRESA_ID ? { id: process.env.EMPRESA_ID } : {}) }, select: { id: true }, take: 2 });
    const empresaId = empresas.length === 1 ? empresas[0].id : undefined;
    const usuario = empresaId ? await this.db.client.usuario.findUnique({ where: { empresaId_email: { empresaId, email } }, include: { empresa: true } }) : null;
    const valid = await argon2.verify(usuario?.senhaHash ?? this.dummyHash, password).catch(() => false);
    if (!valid || !usuario?.ativo || !usuario.empresa.ativa) throw new UnauthorizedException("E-mail ou senha inválidos.");
    const token = randomBytes(32).toString("base64url");
    await this.db.client.$transaction(async tx => {
      if (previousToken) await tx.sessao.deleteMany({ where: { tokenHash: tokenHash(previousToken), empresaId: usuario.empresaId } });
      await tx.sessao.deleteMany({ where: { usuarioId: usuario.id, expiresAt: { lte: new Date() } } });
      await tx.sessao.create({ data: { empresaId: usuario.empresaId, usuarioId: usuario.id, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000) } });
      await tx.auditLog.create({ data: { empresaId: usuario.empresaId, usuarioId: usuario.id, acao: "LOGIN", entidade: "Usuario", entidadeId: usuario.id, dados: {} } });
    });
    return { token, usuario: this.identity(usuario) };
  }
  readToken(req: Request) {
    const entries = req.headers.cookie?.split(";").map(part => part.trim()) ?? [];
    const raw = entries.find(part => part.startsWith(cookieName() + "="))?.slice(cookieName().length + 1);
    return raw && /^[A-Za-z0-9_-]{43}$/.test(raw) ? raw : undefined;
  }
  private identity(user: Identity): Identity { return { id: user.id, empresaId: user.empresaId, nome: user.nome, perfil: user.perfil }; }
  async recuperarSenha(email: string, ip: string) {
    await this.throttle("recuperar:" + email, ip);
    if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) throw new ServiceUnavailableException("O envio de e-mail precisa ser configurado pelo administrador.");
    const empresas = await this.db.client.empresa.findMany({ where: { ativa: true, ...(process.env.EMPRESA_ID ? { id: process.env.EMPRESA_ID } : {}) }, select: { id: true }, take: 2 });
    const usuario = empresas.length === 1 ? await this.db.client.usuario.findFirst({ where: { empresaId: empresas[0].id, email, ativo: true } }) : null;
    if (usuario) {
      const token = randomBytes(32).toString("base64url");
      await this.db.client.$transaction(async tx => {
        await tx.recuperacaoSenha.updateMany({ where: { usuarioId: usuario.id, usadaEm: null }, data: { usadaEm: new Date() } });
        const recuperacao = await tx.recuperacaoSenha.create({ data: { usuarioId: usuario.id, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 20 * 60 * 1000) } });
        const link = new URL("/redefinir-senha", process.env.ADMIN_ORIGIN ?? "http://127.0.0.1:3001");
        link.hash = token;
        await tx.integracaoJob.create({ data: { empresaId: usuario.empresaId, tipo: "EMAIL", referencia: recuperacao.id, payload: { para: email, assunto: "Redefina sua senha", texto: "Recebemos um pedido para redefinir sua senha do painel. O link vale por 20 minutos. Abra " + link.toString() + ". Se você não solicitou, ignore esta mensagem." } } });
      });
    }
    return { message: "Se o e-mail estiver cadastrado, você receberá as instruções para redefinir a senha." };
  }
  async redefinirSenha(token: string, senha: string, ip: string) {
    await this.throttle("redefinir:" + tokenHash(token), ip);
    const senhaHash = await argon2.hash(senha, { ...PASSWORD_OPTIONS, type: argon2.argon2id });
    await this.db.client.$transaction(async tx => {
      const digest = tokenHash(token);
      await tx.$queryRaw`SELECT id FROM "RecuperacaoSenha" WHERE "tokenHash"=${digest} FOR UPDATE`;
      const recuperacao = await tx.recuperacaoSenha.findUnique({ where: { tokenHash: digest }, include: { usuario: { include: { empresa: true } } } });
      if (!recuperacao || recuperacao.usadaEm || recuperacao.expiresAt <= new Date() || !recuperacao.usuario.ativo || !recuperacao.usuario.empresa.ativa) throw new UnauthorizedException("Link inválido ou expirado. Solicite a recuperação novamente.");
      await tx.usuario.update({ where: { id: recuperacao.usuarioId }, data: { senhaHash } });
      await tx.recuperacaoSenha.updateMany({ where: { usuarioId: recuperacao.usuarioId, usadaEm: null }, data: { usadaEm: new Date() } });
      await tx.sessao.deleteMany({ where: { usuarioId: recuperacao.usuarioId } });
      await tx.auditLog.create({ data: { empresaId: recuperacao.usuario.empresaId, usuarioId: recuperacao.usuarioId, acao: "REDEFINIR_SENHA", entidade: "Usuario", entidadeId: recuperacao.usuarioId, dados: {} } });
    });
    return { message: "Senha atualizada. Entre com sua nova senha." };
  }
  async authenticate(req: Request): Promise<Identity> {
    const token = this.readToken(req);
    if (!token) throw new UnauthorizedException("Entre para continuar.");
    const session = await this.db.client.sessao.findUnique({ where: { tokenHash: tokenHash(token) }, include: { usuario: { include: { empresa: true } } } });
    if (!session || session.expiresAt <= new Date() || !session.usuario.ativo || !session.usuario.empresa.ativa || (process.env.EMPRESA_ID && session.empresaId !== process.env.EMPRESA_ID)) throw new UnauthorizedException("Sessão inválida ou expirada.");
    return this.identity(session.usuario);
  }
  async logout(req: Request) {
    const token = this.readToken(req);
    if (!token) return;
    await this.db.client.$transaction(async tx => {
      const session = await tx.sessao.findUnique({ where: { tokenHash: tokenHash(token) } });
      if (!session) return;
      const removed = await tx.sessao.deleteMany({ where: { id: session.id } });
      if (!removed.count) return;
      await tx.auditLog.create({ data: { empresaId: session.empresaId, usuarioId: session.usuarioId, acao: "LOGOUT", entidade: "Usuario", entidadeId: session.usuarioId, dados: {} } });
    });
  }
}
