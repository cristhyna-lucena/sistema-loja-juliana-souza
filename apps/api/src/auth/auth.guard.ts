import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { AuthService, Identity } from "./auth.service";
export const Perfis = (...perfis: Identity["perfil"][]) => SetMetadata("perfis", perfis);
export type AuthRequest = Request & { usuario: Identity };
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(Reflector) private readonly reflector: Reflector) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    req.usuario = await this.auth.authenticate(req);
    const perfis = this.reflector.getAllAndOverride<Identity["perfil"][]>("perfis", [context.getHandler(), context.getClass()]);
    if (perfis && !perfis.includes(req.usuario.perfil)) throw new ForbiddenException("Você não tem permissão para acessar esta área.");
    return true;
  }
}
