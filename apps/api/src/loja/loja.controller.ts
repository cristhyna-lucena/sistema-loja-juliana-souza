import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Prisma } from "@sistema/db";
import type { Request, Response } from "express";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import {
  lojaCadastroSchema,
  lojaLoginSchema,
  lojaCatalogoSchema,
  checkoutSchema,
  freteConsultaSchema,
  gestaoId,
  checkoutServicoSchema,
} from "@sistema/shared";
import type { GatewayName } from "@sistema/integracoes";
import { validar } from "../operacoes/operacoes.controller";
import { LojaService, clienteCookie } from "./loja.service";
import { FotosService } from "../fotos/fotos.service";
import { DatabaseService } from "../database.service";
import { recuperarSenhaSchema, redefinirSenhaSchema } from "@sistema/shared";

@Injectable()
export class LojaOriginGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    if (req.method === "GET") return true;
    if (
      req.headers.origin !==
      (process.env.LOJA_ORIGIN ?? "http://127.0.0.1:3000")
    )
      throw new ForbiddenException("Origem não permitida.");
    if (!req.is("application/json"))
      throw new BadRequestException("Envie os dados em JSON.");
    return true;
  }
}
const cookieOptions = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
});
@Controller("loja")
@UseGuards(LojaOriginGuard)
export class LojaController {
  constructor(
    @Inject(LojaService) private readonly service: LojaService,
    @Inject(FotosService) private readonly fotos: FotosService,
    @Inject(DatabaseService) private readonly db: DatabaseService,
  ) {}
  @Get("configuracao") configuracao() {
    return this.service.configuracao();
  }
  @Get("produtos") produtos(@Query() query: unknown) {
    return this.service.produtos(validar(lojaCatalogoSchema, query));
  }
  @Get("produtos/:slug") produto(@Param("slug") slug: string) {
    if (!/^[a-z0-9-]{1,160}$/.test(slug))
      throw new BadRequestException("Produto inválido.");
    return this.service.produto(slug);
  }
  @Get("categorias") categorias() {
    return this.service.categorias();
  }
  @Get("cep/:cep") cep(@Param("cep") cep: string) {
    return this.service.cep(cep);
  }
  @Post("frete") frete(@Body() body: unknown) {
    return this.service.frete(validar(freteConsultaSchema, body));
  }
  @Post("cadastro") async cadastro(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    const result = await this.service.cadastro(
      validar(lojaCadastroSchema, body),
      req.ip ?? "local",
    );
    res.cookie(clienteCookie(), result.token, {
      ...cookieOptions(),
      maxAge: 8 * 3600000,
    });
    return { cliente: result.cliente };
  }
  @Post("login") @HttpCode(200) async login(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    const input = validar(lojaLoginSchema, body);
    const result = await this.service.login(
      input.email,
      input.senha,
      req.ip ?? "local",
    );
    res.cookie(clienteCookie(), result.token, {
      ...cookieOptions(),
      maxAge: 8 * 3600000,
    });
    return { cliente: result.cliente };
  }
  @Post("logout") @HttpCode(200) async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.service.logout(req);
    res.clearCookie(clienteCookie(), cookieOptions());
    return { ok: true };
  }
  @Get("conta") async conta(@Req() req: Request) {
    return this.service.conta(await this.service.sessao(req));
  }
  @Post("conta/encerrar") async encerrar(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.service.encerrar(await this.service.sessao(req));
    res.clearCookie(clienteCookie(), cookieOptions());
    return result;
  }
  @Post("checkout") async checkout(@Req() req: Request, @Body() body: unknown) {
    return this.service.checkout(
      await this.service.sessao(req),
      validar(checkoutSchema, body),
      req.ip ?? "local",
    );
  }
  @Get("servicos") servicos() {
    return this.service.servicosPublicos();
  }
  @Post("recuperar") @HttpCode(200) recuperar(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    return this.service.recuperar(
      validar(recuperarSenhaSchema, body).email,
      req.ip ?? "local",
    );
  }
  @Post("redefinir") @HttpCode(200) redefinir(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    const input = validar(redefinirSenhaSchema, body);
    return this.service.redefinir(input.token, input.senha, req.ip ?? "local");
  }
  @Get("servicos/:id") servico(@Param("id") id: string) {
    return this.service.servicoPublico(validar(gestaoId, id));
  }
  @Post("checkout-servico") async checkoutServico(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    return this.service.checkoutServico(
      await this.service.sessao(req),
      validar(checkoutServicoSchema, body),
      req.ip ?? "local",
    );
  }
  @Get("pedidos/:id") async pedido(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    return this.service.pedido(
      await this.service.sessao(req),
      validar(gestaoId, id),
    );
  }
  @Get("imagens/:produtoId/:id/:variant") async imagem(
    @Param("produtoId") produtoId: string,
    @Param("id") id: string,
    @Param("variant") variant: string,
    @Res() res: Response,
  ) {
    const empresaId = await this.service.empresaId();
    if (
      !(await this.db.client.produtoComplemento.findFirst({
        where: {
          empresaId,
          produtoId: validar(gestaoId, produtoId),
          publicadoLoja: true,
          produto: { ativo: true },
        },
      }))
    ) {
      res.status(404).end();
      return;
    }
    const file = await this.fotos.file(
      empresaId,
      produtoId,
      validar(gestaoId, id),
      variant,
    );
    res.setHeader("Content-Type", file.mime);
    res.setHeader("Cache-Control", "no-store");
    if (!file.body) {
      res.status(404).end();
      return;
    }
    try {
      await pipeline(file.body as Readable, res);
    } catch {
      res.destroy();
    }
  }
}

function igual(a: string, b: string) {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
@Controller("webhooks/pagamento")
export class PagamentoWebhookController {
  constructor(@Inject(LojaService) private readonly service: LojaService) {}
  @Post(":gateway")
  @HttpCode(200)
  async receber(
    @Req() req: Request,
    @Param("gateway") gateway: string,
    @Body() body: unknown,
  ) {
    if (
      !["MERCADO_PAGO", "ASAAS", "PAGARME"].includes(gateway) ||
      !body ||
      typeof body !== "object"
    )
      throw new BadRequestException("Evento inválido.");
    const evento = body as {
      id?: string | number;
      action?: string;
      event?: string;
      type?: string;
      data?: { id?: string; order?: { id?: string } };
      payment?: { id?: string };
    };
    let pagamentoId: string;
    if (gateway === "MERCADO_PAGO") {
      const secret = process.env.MERCADO_PAGO_WEBHOOK_SECRET;
      const assinatura = String(req.headers["x-signature"] ?? "")
        .split(",")
        .map((item) => item.trim().split("="));
      const ts = assinatura.find(([key]) => key === "ts")?.[1],
        digest = assinatura.find(([key]) => key === "v1")?.[1];
      const requestId = req.headers["x-request-id"],
        id = req.query["data.id"] ?? evento.data?.id;
      if (
        !secret ||
        !ts ||
        !digest ||
        typeof requestId !== "string" ||
        (typeof id !== "string" && typeof id !== "number")
      )
        throw new ForbiddenException("Assinatura inválida.");
      const expected = createHmac("sha256", secret)
        .update(
          "id:" +
            String(id).toLowerCase() +
            ";request-id:" +
            requestId +
            ";ts:" +
            ts +
            ";",
        )
        .digest("hex");
      if (!igual(expected, digest))
        throw new ForbiddenException("Assinatura inválida.");
      pagamentoId = String(id);
      if (evento.type !== "payment" && !evento.action?.startsWith("payment."))
        return { recebido: true };
    } else if (gateway === "ASAAS") {
      const secret = process.env.ASAAS_WEBHOOK_TOKEN;
      if (
        !secret ||
        !igual(secret, String(req.headers["asaas-access-token"] ?? ""))
      )
        throw new ForbiddenException("Token inválido.");
      pagamentoId = String(evento.payment?.id ?? "");
    } else {
      const secret = process.env.PAGARME_WEBHOOK_PASSWORD;
      if (
        !secret ||
        !igual(
          "Basic " +
            Buffer.from(
              (process.env.PAGARME_WEBHOOK_USER ?? "webhook") + ":" + secret,
            ).toString("base64"),
          String(req.headers.authorization ?? ""),
        )
      )
        throw new ForbiddenException("Autenticação inválida.");
      pagamentoId = evento.type?.startsWith("charge.")
        ? String(evento.data?.order?.id ?? "")
        : String(evento.data?.id ?? "");
    }
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(pagamentoId) || !evento.id)
      throw new BadRequestException("Identificador do evento inválido.");
    await this.service.registrarEvento(
      gateway as GatewayName,
      String(evento.id),
      pagamentoId,
    );
    return { recebido: true };
  }
}

@Controller("webhooks/focus")
export class FocusWebhookController {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}
  @Post()
  @HttpCode(200)
  async receber(@Req() req: Request, @Body() body: unknown) {
    const token = process.env.FOCUS_WEBHOOK_TOKEN;
    if (
      !token ||
      !igual("Bearer " + token, String(req.headers.authorization ?? ""))
    )
      throw new ForbiddenException("Autenticação inválida.");
    const ref =
      body && typeof body === "object" ? (body as { ref?: unknown }).ref : null;
    if (typeof ref !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(ref))
      throw new BadRequestException("Referência inválida.");
    const nota = await this.db.client.notaEmitida.findUnique({
      where: { id: ref },
      select: { empresaId: true },
    });
    if (!nota) throw new BadRequestException("Referência desconhecida.");
    const chave = createHash("sha256")
      .update(JSON.stringify(body))
      .digest("hex");
    await this.db.client.$transaction(async (tx) => {
      await tx.webhookEvento.createMany({
        data: [
          {
            origem: "FOCUS",
            chaveExterna: chave,
            payload: body as Prisma.InputJsonObject,
            processadoEm: new Date(),
          },
        ],
        skipDuplicates: true,
      });
      await tx.integracaoJob.createMany({
        data: [
          {
            empresaId: nota.empresaId,
            tipo: "FOCUS_CONSULTAR",
            referencia: "hook-" + chave,
            payload: { notaId: ref },
          },
        ],
        skipDuplicates: true,
      });
    });
    return { recebido: true };
  }
}
