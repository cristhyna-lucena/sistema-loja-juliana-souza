import { Inject, BadRequestException, Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards, ForbiddenException } from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthService } from "./auth.service";
import { AuthGuard, AuthRequest, Perfis } from "./auth.guard";
import { adminOrigin, cookieName, SESSION_SECONDS } from "./config";
import { recuperarSenhaSchema, redefinirSenhaSchema } from "@sistema/shared";
function checkOrigin(req: Request) {
  if (req.headers.origin !== adminOrigin()) throw new ForbiddenException("Origem não permitida.");
}
function cookieOptions() { return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/" }; }
@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  @Post("recuperar") @HttpCode(200)
  recuperar(@Req() req: Request, @Body() body: unknown) {
    checkOrigin(req);
    const input = recuperarSenhaSchema.safeParse(body);
    if (!req.is("application/json") || !input.success) throw new BadRequestException("Informe um e-mail válido.");
    return this.auth.recuperarSenha(input.data.email, req.ip ?? "local");
  }
  @Post("redefinir") @HttpCode(200)
  redefinir(@Req() req: Request, @Body() body: unknown) {
    checkOrigin(req);
    const input = redefinirSenhaSchema.safeParse(body);
    if (!req.is("application/json") || !input.success) throw new BadRequestException("Informe o link de recuperação e uma senha com 12 a 128 caracteres.");
    return this.auth.redefinirSenha(input.data.token, input.data.senha, req.ip ?? "local");
  }
  @Post("login") @HttpCode(200)
  async login(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown) {
    checkOrigin(req);
    if (!req.is("application/json") || !body || typeof body !== "object") throw new BadRequestException("Dados inválidos.");
    const { email, senha } = body as Record<string, unknown>;
    if (typeof email !== "string" || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || typeof senha !== "string" || senha.length < 1 || senha.length > 128) throw new BadRequestException("Informe e-mail e senha válidos.");
    const result = await this.auth.login(email.trim().toLowerCase(), senha, req.ip ?? "local", this.auth.readToken(req));
    res.cookie(cookieName(), result.token, { ...cookieOptions(), maxAge: SESSION_SECONDS * 1000 });
    return { usuario: result.usuario };
  }
  @Get("me") @UseGuards(AuthGuard)
  me(@Req() req: AuthRequest) { return { usuario: req.usuario }; }
  @Post("logout") @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    checkOrigin(req);
    await this.auth.logout(req);
    res.clearCookie(cookieName(), cookieOptions());
  }
}
@Controller("acesso")
@UseGuards(AuthGuard)
export class AccessController {
  @Get("configuracoes") @Perfis("ADMIN")
  administracao() { return { area: "configuracoes" }; }
  @Get("financeiro") @Perfis("ADMIN", "CONTADORA")
  financeiro() { return { area: "financeiro" }; }
  @Get("operacao") @Perfis("ADMIN", "OPERADOR")
  operacao() { return { area: "operacao" }; }
}
