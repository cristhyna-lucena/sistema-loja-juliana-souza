import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fotoInicioSchema, fotoVersaoSchema, fotoAltSchema, fotoOrdemSchema, fotoConfirmarSchema } from "@sistema/shared";
import { AuthGuard, AuthRequest, Perfis } from "../auth/auth.guard";
import { CatalogoOriginGuard } from "../catalogo/catalogo.controller";
import { FotosService } from "./fotos.service";
function parse<T>(schema: { safeParse(input: unknown): { success: true; data: T } | { success: false; error: { issues: { message: string }[] } } }, input: unknown): T { const result = schema.safeParse(input); if (!result.success) throw new BadRequestException({ message: result.error.issues[0]?.message ?? "Dados inválidos." }); return result.data; }
@Controller("produtos/:produtoId/imagens")
@UseGuards(AuthGuard,CatalogoOriginGuard)
@Perfis("ADMIN","OPERADOR")
export class FotosController {
  constructor(@Inject(FotosService) private readonly fotos: FotosService) {}
  @Get() list(@Req() req: AuthRequest,@Param("produtoId") product: string) { return this.fotos.list(req.usuario.empresaId,product); }
  @Post("iniciar") begin(@Req() req: AuthRequest,@Param("produtoId") product: string,@Body() body: unknown) { return this.fotos.begin(req.usuario,product,parse(fotoInicioSchema,body)); }
  @Post("ordenar") @HttpCode(200)
  order(@Req() req: AuthRequest,@Param("produtoId") product: string,@Body() body: unknown) { const data = parse(fotoOrdemSchema,body); return this.fotos.reorder(req.usuario,product,data.ids,data.versao); }
  @Post(":id/confirmar") @HttpCode(202)
  confirm(@Req() req: AuthRequest,@Param("produtoId") product: string,@Param("id") id: string,@Body() body: unknown) { parse(fotoConfirmarSchema,body); return this.fotos.confirm(req.usuario,product,id); }
  @Patch(":id") alt(@Req() req: AuthRequest,@Param("produtoId") product: string,@Param("id") id: string,@Body() body: unknown) { const data = parse(fotoAltSchema,body); return this.fotos.alt(req.usuario,product,id,data.alt,data.versao); }
  @Post(":id/remover") @HttpCode(200)
  remove(@Req() req: AuthRequest,@Param("produtoId") product: string,@Param("id") id: string,@Body() body: unknown) { return this.fotos.remove(req.usuario,product,id,parse(fotoVersaoSchema,body).versao); }
  @Post(":id/restaurar") @HttpCode(200)
  restore(@Req() req: AuthRequest,@Param("produtoId") product: string,@Param("id") id: string,@Body() body: unknown) { return this.fotos.restore(req.usuario,product,id,parse(fotoVersaoSchema,body).versao); }
  @Post(":id/cancelar") @HttpCode(200)
  cancel(@Req() req: AuthRequest,@Param("produtoId") product: string,@Param("id") id: string,@Body() body: unknown) { return this.fotos.cancel(req.usuario,product,id,parse(fotoVersaoSchema,body).versao); }
  @Get(":id/arquivo/:variant")
  async file(@Req() req: AuthRequest,@Param("produtoId") product: string,@Param("id") id: string,@Param("variant") variant: string,@Res() res: Response) {
    const file = await this.fotos.file(req.usuario.empresaId,product,id,variant);
    res.setHeader("Content-Type",file.mime); res.setHeader("Cache-Control","private, no-store"); res.setHeader("X-Content-Type-Options","nosniff");
    if (!file.body) { res.status(404).end(); return; }
    try { await pipeline(file.body as Readable,res); } catch { res.destroy(); }
  }
}
