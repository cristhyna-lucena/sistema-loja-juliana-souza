import { BadRequestException, Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { vendaSchema, listaVendasSchema, motivoComercialSchema, baixaFinanceiraSchema, contaFinanceiraSchema, contaFinanceiraEdicaoSchema, tituloFinanceiroSchema, listaTitulosSchema, caixaSchema, gestaoId } from "@sistema/shared";
import { AuthGuard, AuthRequest, Perfis } from "../auth/auth.guard";
import { CatalogoOriginGuard } from "../catalogo/catalogo.controller";
import { VendasService } from "./vendas.service";
import { FinanceiroService } from "./financeiro.service";
import { contatosFinanceirosSchema } from "@sistema/shared";
import { parcelasVendaSchema } from "@sistema/shared";
function parse<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }, value: unknown): T {
  const result = schema.safeParse(value); if (!result.success) throw new BadRequestException({ message: "Confira os campos informados.", errors: result.error.issues.map(i => ({ campo: i.path.join("."), message: i.message })) }); return result.data;
}
@Controller("vendas")
@UseGuards(AuthGuard, CatalogoOriginGuard)
@Perfis("ADMIN", "OPERADOR")
export class VendasController {
  constructor(@Inject(VendasService) private readonly service: VendasService) {}
  @Get() listar(@Req() req: AuthRequest, @Query() query: unknown) { return this.service.listar(req.usuario.empresaId, parse(listaVendasSchema, query)); }
  @Get(":id") detalhe(@Req() req: AuthRequest, @Param("id") id: string) { return this.service.detalhe(req.usuario.empresaId, parse(gestaoId, id)); }
  @Post() criar(@Req() req: AuthRequest, @Body() body: unknown) { return this.service.criar(req.usuario, parse(vendaSchema, body)); }
  @Post(":id/recebimentos") receber(@Req() req: AuthRequest, @Param("id") id: string, @Body() body: unknown) { return this.service.receber(req.usuario, parse(gestaoId, id), parse(baixaFinanceiraSchema, body)); }
  @Post(":id/cancelar") cancelar(@Req() req: AuthRequest, @Param("id") id: string, @Body() body: unknown) { return this.service.cancelar(req.usuario, parse(gestaoId, id), parse(motivoComercialSchema, body)); }
  @Post(":id/parcelar") parcelar(@Req() req: AuthRequest, @Param("id") id: string, @Body() body: unknown) { return this.service.parcelar(req.usuario, parse(gestaoId, id), parse(parcelasVendaSchema, body)); }
}
@Controller("financeiro")
@UseGuards(AuthGuard, CatalogoOriginGuard)
@Perfis("ADMIN", "CONTADORA")
export class FinanceiroController {
  constructor(@Inject(FinanceiroService) private readonly service: FinanceiroService) {}
  @Get("contatos") contatos(@Req() req: AuthRequest, @Query() query: unknown) { const input = parse(contatosFinanceirosSchema, query); return this.service.contatos(req.usuario.empresaId, input.tipo, input.q); }
  @Get("contas/opcoes") @Perfis("ADMIN", "CONTADORA", "OPERADOR") opcoes(@Req() req: AuthRequest) { return this.service.contas(req.usuario.empresaId, true); }
  @Get("contas") contas(@Req() req: AuthRequest) { return this.service.contas(req.usuario.empresaId); }
  @Post("contas") @Perfis("ADMIN") criarConta(@Req() req: AuthRequest, @Body() body: unknown) { return this.service.criarConta(req.usuario, parse(contaFinanceiraSchema, body)); }
  @Patch("contas/:id") @Perfis("ADMIN") editarConta(@Req() req: AuthRequest, @Param("id") id: string, @Body() body: unknown) { return this.service.editarConta(req.usuario, parse(gestaoId, id), parse(contaFinanceiraEdicaoSchema, body)); }
  @Get("titulos") titulos(@Req() req: AuthRequest, @Query() query: unknown) { return this.service.titulos(req.usuario.empresaId, parse(listaTitulosSchema, query)); }
  @Get("titulos/:id") titulo(@Req() req: AuthRequest, @Param("id") id: string) { return this.service.detalhe(req.usuario.empresaId, parse(gestaoId, id)); }
  @Post("titulos") criarTitulo(@Req() req: AuthRequest, @Body() body: unknown) { return this.service.criarTitulo(req.usuario, parse(tituloFinanceiroSchema, body)); }
  @Post("titulos/:id/baixas") baixar(@Req() req: AuthRequest, @Param("id") id: string, @Body() body: unknown) { return this.service.baixar(req.usuario, parse(gestaoId, id), parse(baixaFinanceiraSchema, body)); }
  @Post("titulos/:id/cancelar") cancelar(@Req() req: AuthRequest, @Param("id") id: string, @Body() body: unknown) { return this.service.cancelarTitulo(req.usuario, parse(gestaoId, id), parse(motivoComercialSchema, body)); }
  @Post("lancamentos/:id/estornar") estornar(@Req() req: AuthRequest, @Param("id") id: string, @Body() body: unknown) { return this.service.estornar(req.usuario, parse(gestaoId, id), parse(motivoComercialSchema, body)); }
  @Get("caixa") caixa(@Req() req: AuthRequest, @Query() query: unknown) { return this.service.caixa(req.usuario.empresaId, parse(caixaSchema, query)); }
}
