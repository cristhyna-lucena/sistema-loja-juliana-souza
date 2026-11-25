import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import {
  compraSchema,
  servicoSchema,
  servicoEdicaoSchema,
  voucherSchema,
  listaOperacoesSchema,
  acaoOperacaoSchema,
  gestaoId,
  categoriaFinanceiraSchema,
  transferenciaSchema,
  fechamentoSchema,
  conciliacaoSchema,
  parcelamentoSchema,
} from "@sistema/shared";
import { AuthGuard, AuthRequest, Perfis } from "../auth/auth.guard";
import { CatalogoOriginGuard } from "../catalogo/catalogo.controller";
import { ComprasService } from "./compras.service";
import { ServicosService } from "./servicos.service";
import { FinanceiroExtraService } from "./financeiro-extra.service";
import { AdministracaoService } from "./administracao.service";
import {
  configuracaoSchema,
  usuarioSchema,
  usuarioEdicaoSchema,
  complementoProdutoSchema,
} from "@sistema/shared";
import {
  importarXmlSchema,
  emitirNotaSchema,
  cancelarNotaSchema,
  correcaoNotaSchema,
  operacaoId,
} from "@sistema/shared";
import { FiscalService } from "./fiscal.service";
import { RelatoriosService } from "./relatorios.service";
import { relatorioSchema } from "@sistema/shared";
import { enviarPedidoSchema, etiquetaPedidoSchema } from "@sistema/shared";
import { PedidosService } from "./pedidos.service";

export function validar<T>(
  schema: {
    safeParse(
      value: unknown,
    ):
      | { success: true; data: T }
      | {
          success: false;
          error: { issues: { path: PropertyKey[]; message: string }[] };
        };
  },
  value: unknown,
): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BadRequestException({
      message: "Confira os campos informados.",
      errors: result.error.issues.map((issue) => ({
        campo: issue.path.join("."),
        message: issue.message,
      })),
    });
  return result.data;
}

@Controller("pedidos")
@UseGuards(AuthGuard, CatalogoOriginGuard)
@Perfis("ADMIN", "OPERADOR")
export class PedidosController {
  constructor(
    @Inject(PedidosService) private readonly service: PedidosService,
  ) {}
  @Get() listar(@Req() req: AuthRequest, @Query() query: unknown) {
    return this.service.listar(
      req.usuario.empresaId,
      validar(listaOperacoesSchema, query),
    );
  }
  @Get(":id") detalhe(@Req() req: AuthRequest, @Param("id") id: string) {
    return this.service.detalhe(req.usuario.empresaId, validar(gestaoId, id));
  }
  @Post(":id/cancelar") cancelar(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.service.cancelar(
      req.usuario,
      validar(gestaoId, id),
      validar(acaoOperacaoSchema, body),
    );
  }
  @Post(":id/enviar") enviar(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.service.enviar(
      req.usuario,
      validar(gestaoId, id),
      validar(enviarPedidoSchema, body),
    );
  }
  @Post(":id/etiqueta") etiqueta(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.service.etiqueta(
      req.usuario,
      validar(gestaoId, id),
      validar(etiquetaPedidoSchema, body),
    );
  }
  @Get(":id/etiqueta") async arquivo(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Res() response: Response,
  ) {
    const validId = validar(gestaoId, id),
      buffer = await this.service.arquivoEtiqueta(
        req.usuario.empresaId,
        validId,
      );
    response.setHeader("Content-Type", "application/pdf");
    response.setHeader(
      "Content-Disposition",
      'attachment; filename="etiqueta-' + validId + '.pdf"',
    );
    response.send(buffer);
  }
}

@Controller("relatorios")
@UseGuards(AuthGuard, CatalogoOriginGuard)
@Perfis("ADMIN", "CONTADORA")
export class RelatoriosController {
  constructor(
    @Inject(RelatoriosService) private readonly service: RelatoriosService,
  ) {}
  @Get() resumo(@Req() req: AuthRequest, @Query() query: unknown) {
    return this.service.resumo(
      req.usuario.empresaId,
      validar(relatorioSchema, query),
    );
  }
}

@Controller("fiscal")
@UseGuards(AuthGuard, CatalogoOriginGuard)
@Perfis("ADMIN", "CONTADORA")
export class FiscalController {
  constructor(@Inject(FiscalService) private readonly service: FiscalService) {}
  @Get("recebidas") recebidas(
    @Req() req: AuthRequest,
    @Query() query: unknown,
  ) {
    return this.service.recebidas(
      req.usuario.empresaId,
      validar(listaOperacoesSchema, query),
    );
  }
  @Get("recebidas/:id") recebida(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    return this.service.recebida(req.usuario.empresaId, validar(gestaoId, id));
  }
  @Post("recebidas/xml") importar(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return this.service.importar(req.usuario, validar(importarXmlSchema, body));
  }
  @Post("sincronizar") sincronizar(
    @Req() req: AuthRequest,
    @Body("chaveOperacao") chave: unknown,
  ) {
    return this.service.agendar(
      req.usuario,
      "FOCUS_SINCRONIZAR",
      "manual",
      {},
      { chaveOperacao: validar(operacaoId, chave) },
    );
  }
  @Post("recebidas/:id/ciencia") ciencia(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body("chaveOperacao") chave: unknown,
  ) {
    return this.service.manifestar(req.usuario, validar(gestaoId, id), {
      chaveOperacao: validar(operacaoId, chave),
    });
  }
  @Get("emitidas") emitidas(@Req() req: AuthRequest, @Query() query: unknown) {
    return this.service.emitidas(
      req.usuario.empresaId,
      validar(listaOperacoesSchema, query),
    );
  }
  @Get("exportar") async exportar(
    @Req() req: AuthRequest,
    @Query("mes") mes: string,
    @Res() response: Response,
  ) {
    const buffer = await this.service.exportar(req.usuario.empresaId, mes);
    response.setHeader("Content-Type", "application/zip");
    response.setHeader(
      "Content-Disposition",
      'attachment; filename="notas-' + mes + '.zip"',
    );
    response.send(buffer);
  }
  @Post("emitidas") emitir(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.service.emitir(req.usuario, validar(emitirNotaSchema, body));
  }
  @Post("emitidas/:id/consultar") consultar(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body("chaveOperacao") chave: unknown,
  ) {
    return this.service.acaoNota(
      req.usuario,
      validar(gestaoId, id),
      "FOCUS_CONSULTAR",
      { chaveOperacao: validar(operacaoId, chave) },
    );
  }
  @Post("emitidas/:id/cancelar") cancelar(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.service.acaoNota(
      req.usuario,
      validar(gestaoId, id),
      "FOCUS_CANCELAR",
      validar(cancelarNotaSchema, body),
    );
  }
  @Post("emitidas/:id/corrigir") corrigir(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.service.acaoNota(
      req.usuario,
      validar(gestaoId, id),
      "FOCUS_CORRIGIR",
      validar(correcaoNotaSchema, body),
    );
  }
  @Get("emitidas/:id/xml") async xml(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Res() response: Response,
  ) {
    const validId = validar(gestaoId, id);
    response.setHeader("Content-Type", "application/xml; charset=utf-8");
    response.setHeader(
      "Content-Disposition",
      'attachment; filename="nota-' + validId + '.xml"',
    );
    response.send(await this.service.xml(req.usuario.empresaId, validId));
  }
  @Get("emitidas/:id/danfse") async danfse(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Res() response: Response,
  ) {
    const validId = validar(gestaoId, id);
    const pdf = await this.service.danfse(req.usuario.empresaId, validId);
    response.setHeader("Content-Type", "application/pdf");
    response.setHeader("Content-Disposition", 'inline; filename="nfse-' + validId + '.pdf"');
    response.send(pdf);
  }
  @Get("integracoes") jobs(@Req() req: AuthRequest) {
    return this.service.jobs(req.usuario.empresaId);
  }
  @Post("integracoes/:id/repetir") repetir(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body("chaveOperacao") chave: unknown,
  ) {
    return this.service.repetir(req.usuario, validar(gestaoId, id), {
      chaveOperacao: validar(operacaoId, chave),
    });
  }
  @Get("opcoes") opcoes(@Req() req: AuthRequest) {
    return this.service.opcoes(req.usuario.empresaId);
  }
}

@Controller("administracao")
@UseGuards(AuthGuard, CatalogoOriginGuard)
@Perfis("ADMIN")
export class AdministracaoController {
  constructor(
    @Inject(AdministracaoService)
    private readonly service: AdministracaoService,
  ) {}
  @Get("configuracao") configuracao(@Req() req: AuthRequest) {
    return this.service.configuracao(req.usuario.empresaId);
  }
  @Post("configuracao") salvar(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.service.salvar(req.usuario, validar(configuracaoSchema, body));
  }
  @Get("usuarios") usuarios(@Req() req: AuthRequest) {
    return this.service.usuarios(req.usuario.empresaId);
  }
  @Post("usuarios") criar(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.service.criarUsuario(req.usuario, validar(usuarioSchema, body));
  }
  @Patch("usuarios/:id") editar(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.service.editarUsuario(
      req.usuario,
      validar(gestaoId, id),
      validar(usuarioEdicaoSchema, body),
    );
  }
  @Get("produtos/:id") @Perfis("ADMIN", "OPERADOR") complemento(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    return this.service.complemento(
      req.usuario.empresaId,
      validar(gestaoId, id),
    );
  }
  @Post("produtos/:id") @Perfis("ADMIN", "OPERADOR") salvarComplemento(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.service.salvarComplemento(
      req.usuario,
      validar(gestaoId, id),
      validar(complementoProdutoSchema, body),
    );
  }
}

@Controller("financeiro")
@UseGuards(AuthGuard, CatalogoOriginGuard)
@Perfis("ADMIN", "CONTADORA")
export class FinanceiroExtraController {
  constructor(
    @Inject(FinanceiroExtraService)
    private readonly service: FinanceiroExtraService,
  ) {}
  @Get("categorias") categorias(@Req() req: AuthRequest) {
    return this.service.categorias(req.usuario.empresaId);
  }
  @Post("categorias") categoria(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return this.service.categoria(
      req.usuario,
      validar(categoriaFinanceiraSchema, body),
    );
  }
  @Post("transferencias") transferir(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return this.service.transferir(
      req.usuario,
      validar(transferenciaSchema, body),
    );
  }
  @Get("transferencias") transferencias(@Req() req: AuthRequest) {
    return this.service.transferencias(req.usuario.empresaId);
  }
  @Post("transferencias/:id/estornar") estornarTransferencia(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.service.estornarTransferencia(
      req.usuario,
      validar(gestaoId, id),
      validar(acaoOperacaoSchema, body),
    );
  }
  @Get("fechamentos") fechamentos(@Req() req: AuthRequest) {
    return this.service.fechamentos(req.usuario.empresaId);
  }
  @Post("fechamentos") fechar(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.service.fechar(req.usuario, validar(fechamentoSchema, body));
  }
  @Post("lancamentos/:id/conciliar") conciliar(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.service.conciliar(
      req.usuario,
      validar(gestaoId, id),
      validar(conciliacaoSchema, body),
    );
  }
  @Post("parcelamentos") parcelar(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return this.service.parcelar(
      req.usuario,
      validar(parcelamentoSchema, body),
    );
  }
}

@Controller("compras")
@UseGuards(AuthGuard, CatalogoOriginGuard)
@Perfis("ADMIN", "OPERADOR")
export class ComprasController {
  constructor(
    @Inject(ComprasService) private readonly service: ComprasService,
  ) {}
  @Get() listar(@Req() req: AuthRequest, @Query() query: unknown) {
    return this.service.listar(
      req.usuario.empresaId,
      validar(listaOperacoesSchema, query),
    );
  }
  @Get("fornecedores/:id/vinculos") vinculos(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    return this.service.vinculos(req.usuario.empresaId, validar(gestaoId, id));
  }
  @Get(":id") detalhe(@Req() req: AuthRequest, @Param("id") id: string) {
    return this.service.detalhe(req.usuario.empresaId, validar(gestaoId, id));
  }
  @Post() criar(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.service.criar(req.usuario, validar(compraSchema, body));
  }
  @Post(":id/cancelar") cancelar(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.service.cancelar(
      req.usuario,
      validar(gestaoId, id),
      validar(acaoOperacaoSchema, body),
    );
  }
}

@Controller("servicos")
@UseGuards(AuthGuard, CatalogoOriginGuard)
@Perfis("ADMIN", "OPERADOR")
export class ServicosController {
  constructor(
    @Inject(ServicosService) private readonly service: ServicosService,
  ) {}
  @Get() listar(@Req() req: AuthRequest, @Query() query: unknown) {
    return this.service.listar(
      req.usuario.empresaId,
      validar(listaOperacoesSchema, query),
    );
  }
  @Get(":id") detalhe(@Req() req: AuthRequest, @Param("id") id: string) {
    return this.service.detalhe(req.usuario.empresaId, validar(gestaoId, id));
  }
  @Post() criar(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.service.salvar(req.usuario, validar(servicoSchema, body));
  }
  @Patch(":id") editar(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const { versao, ...input } = validar(servicoEdicaoSchema, body);
    return this.service.salvar(
      req.usuario,
      input,
      validar(gestaoId, id),
      versao,
    );
  }
}

@Controller("vouchers")
@UseGuards(AuthGuard, CatalogoOriginGuard)
@Perfis("ADMIN", "OPERADOR")
export class VouchersController {
  constructor(
    @Inject(ServicosService) private readonly service: ServicosService,
  ) {}
  @Get() listar(@Req() req: AuthRequest, @Query() query: unknown) {
    return this.service.vouchers(
      req.usuario.empresaId,
      validar(listaOperacoesSchema, query),
    );
  }
  @Post() vender(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.service.vender(req.usuario, validar(voucherSchema, body));
  }
  @Post(":id/usar") usar(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.service.usar(
      req.usuario,
      validar(gestaoId, id),
      validar(acaoOperacaoSchema, body),
    );
  }
  @Post(":id/cancelar") cancelar(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.service.cancelar(
      req.usuario,
      validar(gestaoId, id),
      validar(acaoOperacaoSchema, body),
    );
  }
}
