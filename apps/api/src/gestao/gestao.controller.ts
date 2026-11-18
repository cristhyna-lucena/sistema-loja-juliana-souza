import { BadRequestException, Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { clienteSchema, clienteEdicaoSchema, fornecedorSchema, fornecedorEdicaoSchema, listaCatalogoSchema, loteSchema, movimentoSchema, estornoSchema, listaMovimentosSchema, gestaoId } from "@sistema/shared";
import { AuthGuard, AuthRequest, Perfis } from "../auth/auth.guard";
import { CatalogoOriginGuard } from "../catalogo/catalogo.controller";
import { CadastrosService } from "./cadastros.service";
import { EstoqueService } from "./estoque.service";
import { alertasEstoqueSchema } from "@sistema/shared";
import { AlertasEstoqueService } from "./alertas-estoque.service";
function parse<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException({ message: "Confira os campos informados.", errors: result.error.issues.map(i => ({ campo: i.path.join("."), message: i.message })) });
  return result.data;
}
@Controller("estoque/alertas")
@UseGuards(AuthGuard, CatalogoOriginGuard)
@Perfis("ADMIN", "OPERADOR")
export class AlertasEstoqueController {
  constructor(@Inject(AlertasEstoqueService) private readonly service: AlertasEstoqueService) {}
  @Get() listar(@Req() req: AuthRequest, @Query() query: unknown) { return this.service.listar(req.usuario.empresaId, parse(alertasEstoqueSchema, query)); }
}
@Controller("clientes")
@UseGuards(AuthGuard, CatalogoOriginGuard)
@Perfis("ADMIN", "OPERADOR")
export class ClientesController {
  constructor(@Inject(CadastrosService) private readonly service: CadastrosService) {}
  @Get() listar(@Req() req: AuthRequest, @Query() query: unknown) { return this.service.listar("cliente", req.usuario.empresaId, parse(listaCatalogoSchema, query)); }
  @Get(":id") detalhe(@Req() req: AuthRequest, @Param("id") id: string) { return this.service.detalhe("cliente", req.usuario.empresaId, parse(gestaoId, id)); }
  @Post() criar(@Req() req: AuthRequest, @Body() body: unknown) { return this.service.criar("cliente", req.usuario, parse(clienteSchema, body)); }
  @Patch(":id") editar(@Req() req: AuthRequest, @Param("id") id: string, @Body() body: unknown) { return this.service.editar("cliente", req.usuario, parse(gestaoId, id), parse(clienteEdicaoSchema, body)); }
}
@Controller("fornecedores")
@UseGuards(AuthGuard, CatalogoOriginGuard)
@Perfis("ADMIN", "OPERADOR")
export class FornecedoresController {
  constructor(@Inject(CadastrosService) private readonly service: CadastrosService) {}
  @Get() listar(@Req() req: AuthRequest, @Query() query: unknown) { return this.service.listar("fornecedor", req.usuario.empresaId, parse(listaCatalogoSchema, query)); }
  @Get(":id") detalhe(@Req() req: AuthRequest, @Param("id") id: string) { return this.service.detalhe("fornecedor", req.usuario.empresaId, parse(gestaoId, id)); }
  @Post() criar(@Req() req: AuthRequest, @Body() body: unknown) { return this.service.criar("fornecedor", req.usuario, parse(fornecedorSchema, body)); }
  @Patch(":id") editar(@Req() req: AuthRequest, @Param("id") id: string, @Body() body: unknown) { return this.service.editar("fornecedor", req.usuario, parse(gestaoId, id), parse(fornecedorEdicaoSchema, body)); }
}
@Controller("estoque/produtos/:produtoId")
@UseGuards(AuthGuard, CatalogoOriginGuard)
@Perfis("ADMIN", "OPERADOR")
export class EstoqueController {
  constructor(@Inject(EstoqueService) private readonly service: EstoqueService) {}
  @Get("saldo") saldo(@Req() req: AuthRequest, @Param("produtoId") produtoId: string) { return this.service.consultarSaldo(req.usuario.empresaId, parse(gestaoId, produtoId)); }
  @Get("movimentos") movimentos(@Req() req: AuthRequest, @Param("produtoId") produtoId: string, @Query() query: unknown) { return this.service.historico(req.usuario.empresaId, parse(gestaoId, produtoId), parse(listaMovimentosSchema, query)); }
  @Post("lotes") lote(@Req() req: AuthRequest, @Param("produtoId") produtoId: string, @Body() body: unknown) { return this.service.criarLote(req.usuario, parse(gestaoId, produtoId), parse(loteSchema, body)); }
  @Post("movimentos") movimentar(@Req() req: AuthRequest, @Param("produtoId") produtoId: string, @Body() body: unknown) { return this.service.movimentar(req.usuario, parse(gestaoId, produtoId), parse(movimentoSchema, body)); }
  @Post("movimentos/:id/estornar") estornar(@Req() req: AuthRequest, @Param("produtoId") produtoId: string, @Param("id") id: string, @Body() body: unknown) { return this.service.estornar(req.usuario, parse(gestaoId, produtoId), parse(gestaoId, id), parse(estornoSchema, body)); }
}
