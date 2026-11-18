import { BadRequestException, Body, CanActivate, Controller, ExecutionContext, ForbiddenException, Get, Inject, Injectable, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { produtoSchema, produtoEdicaoSchema, categoriaSchema, categoriaEdicaoSchema, listaCatalogoSchema } from "@sistema/shared";
import { AuthGuard, AuthRequest, Perfis } from "../auth/auth.guard";
import { adminOrigin } from "../auth/config";
import { CatalogoService } from "./catalogo.service";
function parse<T>(schema: { safeParse(input: unknown): { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException({ message: "Confira os campos informados.", errors: result.error.issues.map(issue => ({ campo: issue.path.join("."), message: issue.message })) });
  return result.data;
}
@Injectable()
export class CatalogoOriginGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    if (!["GET", "HEAD"].includes(req.method) && req.headers.origin !== adminOrigin()) throw new ForbiddenException("Origem não permitida.");
    if (!["GET", "HEAD"].includes(req.method) && !req.is("application/json")) throw new BadRequestException("Envie os dados em JSON.");
    return true;
  }
}
@Controller("categorias")
@UseGuards(AuthGuard, CatalogoOriginGuard)
@Perfis("ADMIN", "OPERADOR")
export class CategoriasController {
  constructor(@Inject(CatalogoService) private readonly service: CatalogoService) {}
  @Get() list(@Req() req: AuthRequest, @Query() query: unknown) { return this.service.categorias(req.usuario.empresaId, parse(listaCatalogoSchema, query)); }
  @Get("opcoes") options(@Req() req: AuthRequest) { return this.service.opcoes(req.usuario.empresaId); }
  @Get(":id") detail(@Req() req: AuthRequest, @Param("id") id: string) { return this.service.categoria(req.usuario.empresaId, id); }
  @Post() create(@Req() req: AuthRequest, @Body() body: unknown) { return this.service.criarCategoria(req.usuario, parse(categoriaSchema, body)); }
  @Patch(":id") update(@Req() req: AuthRequest, @Param("id") id: string, @Body() body: unknown) { return this.service.editarCategoria(req.usuario, id, parse(categoriaEdicaoSchema, body)); }
}
@Controller("produtos")
@UseGuards(AuthGuard, CatalogoOriginGuard)
@Perfis("ADMIN", "OPERADOR")
export class ProdutosController {
  constructor(@Inject(CatalogoService) private readonly service: CatalogoService) {}
  @Get() list(@Req() req: AuthRequest, @Query() query: unknown) { return this.service.produtos(req.usuario.empresaId, parse(listaCatalogoSchema, query)); }
  @Get(":id") detail(@Req() req: AuthRequest, @Param("id") id: string) { return this.service.produto(req.usuario.empresaId, id); }
  @Post() create(@Req() req: AuthRequest, @Body() body: unknown) { return this.service.criarProduto(req.usuario, parse(produtoSchema, body)); }
  @Patch(":id") update(@Req() req: AuthRequest, @Param("id") id: string, @Body() body: unknown) { return this.service.editarProduto(req.usuario, id, parse(produtoEdicaoSchema, body)); }
}
