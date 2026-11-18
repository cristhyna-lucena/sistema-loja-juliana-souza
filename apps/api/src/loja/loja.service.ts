import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import * as argon2 from "argon2";
import type { Request } from "express";
import { Prisma } from "@sistema/db";
import {
  CorreiosClient,
  GatewayClient,
  requestJson,
  type GatewayName,
  type Frete,
  type PaymentResult,
} from "@sistema/integracoes";
import {
  lojaCadastroSchema,
  vendaSchema,
  type CheckoutLojaInput,
  type LojaProdutoDTO,
  type CheckoutServicoInput,
} from "@sistema/shared";
import { DatabaseService } from "../database.service";
import { AuthService, type Identity, tokenHash } from "../auth/auth.service";
import { PASSWORD_OPTIONS } from "../auth/config";
import { EstoqueService } from "../gestao/estoque.service";
import { ComercialService, Dinheiro } from "../comercial/comercial.service";
import { VendasService } from "../comercial/vendas.service";
import { FinanceiroService } from "../comercial/financeiro.service";
import {
  ServicosService,
  type ServicoSnapshot,
} from "../operacoes/servicos.service";
import { FiscalService } from "../operacoes/fiscal.service";
import { dataLoja } from "../gestao/data-loja";

type ClienteSession = { empresaId: string; clienteId: string; contaId: string };
type ItemPedido = {
  produtoId: string;
  quantidade: number;
  nome: string;
  precoUnitario: string;
  total: string;
};
type ItemServico = {
  servicoId: string;
  quantidade: number;
  nome: string;
  precoUnitario: string;
  total: string;
  ficha: ServicoSnapshot;
  voucherIds?: string[];
};
const contaCampos = {
  id: true,
  nome: true,
  email: true,
  cpfCnpj: true,
  telefone: true,
} as const;
export const clienteCookie = () =>
  process.env.NODE_ENV === "production"
    ? "__Host-loja_cliente"
    : "loja_cliente";

@Injectable()
export class LojaService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private processing = false;
  private dummyHash = "";
  private readonly correios = new CorreiosClient();
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(EstoqueService) private readonly estoque: EstoqueService,
    @Inject(ComercialService) private readonly comercial: ComercialService,
    @Inject(VendasService) private readonly vendas: VendasService,
    @Inject(ServicosService) private readonly servicos: ServicosService,
    @Inject(FinanceiroService) private readonly financeiro: FinanceiroService,
    @Inject(FiscalService) private readonly fiscal: FiscalService,
  ) {}
  async onModuleInit() {
    this.dummyHash = await argon2.hash(randomBytes(32), {
      ...PASSWORD_OPTIONS,
      type: argon2.argon2id,
    });
    this.timer = setInterval(() => {
      void this.processarEventos();
    }, 15_000);
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    while (this.processing)
      await new Promise((resolve) => setTimeout(resolve, 100));
  }
  async empresaId() {
    const empresas = await this.db.client.empresa.findMany({
      where: {
        ativa: true,
        ...(process.env.EMPRESA_ID ? { id: process.env.EMPRESA_ID } : {}),
      },
      select: { id: true },
      take: 2,
    });
    if (empresas.length !== 1)
      throw new ServiceUnavailableException(
        "A loja precisa ser configurada pelo administrador.",
      );
    return empresas[0].id;
  }
  async configuracao() {
    const empresaId = await this.empresaId();
    const empresa = await this.db.client.empresa.findUniqueOrThrow({
      where: { id: empresaId },
      include: { configuracao: true },
    });
    const flags = empresa.configuracao?.integracoes as {
      mercadoPago?: boolean;
      asaas?: boolean;
      pagarme?: boolean;
    } | null;
    return {
      nome: empresa.nome,
      email: empresa.configuracao?.email ?? null,
      telefone: empresa.configuracao?.telefone ?? null,
      gateways: [
        {
          codigo: "MERCADO_PAGO",
          nome: "Mercado Pago",
          disponivel:
            !!flags?.mercadoPago && !!process.env.MERCADO_PAGO_ACCESS_TOKEN,
        },
        {
          codigo: "ASAAS",
          nome: "Asaas",
          disponivel: !!flags?.asaas && !!process.env.ASAAS_API_KEY,
        },
        {
          codigo: "PAGARME",
          nome: "Pagar.me",
          disponivel: !!flags?.pagarme && !!process.env.PAGARME_SECRET_KEY,
        },
      ],
      freteGratisAtivo: empresa.configuracao?.freteGratisAtivo ?? false,
      freteGratisMinimo:
        empresa.configuracao?.freteGratisMinimo.toFixed(2) ?? "0.00",
      correiosAtivo: empresa.configuracao?.correiosAtivo ?? false,
    };
  }
  async produtos(query: {
    q: string;
    categoriaId?: string;
    page: number;
    pageSize: number;
  }) {
    const empresaId = await this.empresaId();
    const where: Prisma.ProdutoWhereInput = {
      empresaId,
      ativo: true,
      tipo: { in: ["REVENDA", "AMBOS"] },
      complemento: { publicadoLoja: true },
      ...(query.q ? { nome: { contains: query.q, mode: "insensitive" } } : {}),
      ...(query.categoriaId
        ? { categoriaId: query.categoriaId, categoria: { ativa: true } }
        : {}),
    };
    return this.db.client.$transaction(
      async (tx) => {
        const produtos = await tx.produto.findMany({
          where,
          include: {
            complemento: true,
            categoria: true,
            imagens: {
              where: { removidaEm: null, hash: { not: null } },
              select: { id: true, alt: true },
              orderBy: [{ ordem: "asc" }, { id: "asc" }],
            },
          },
          orderBy: [{ nome: "asc" }, { id: "asc" }],
          take: query.pageSize,
          skip: (query.page - 1) * query.pageSize,
        });
        const itens: LojaProdutoDTO[] = [];
        for (const produto of produtos)
          itens.push({
            id: produto.id,
            nome: produto.nome,
            descricao: produto.descricao,
            preco: produto.precoVenda.toFixed(2),
            slug: produto.complemento!.slug,
            categoria: produto.categoria?.nome ?? null,
            imagens: produto.imagens,
            disponivel: Dinheiro.max(
              0,
              await this.estoque.disponivelTx(tx, empresaId, produto.id),
            ).toFixed(3),
          });
        const total = await tx.produto.count({ where });
        return {
          itens,
          total,
          page: query.page,
          pages: Math.max(1, Math.ceil(total / query.pageSize)),
        };
      },
      { isolationLevel: "RepeatableRead", timeout: 15000 },
    );
  }
  async produto(slug: string) {
    const empresaId = await this.empresaId();
    const row = await this.db.client.produtoComplemento.findFirst({
      where: {
        empresaId,
        slug,
        publicadoLoja: true,
        produto: { ativo: true, tipo: { not: "INSUMO" } },
      },
      select: { produtoId: true },
    });
    if (!row) throw new NotFoundException("Produto não encontrado.");
    const produto = await this.db.client.produto.findUniqueOrThrow({
      where: { id: row.produtoId },
      include: {
        categoria: true,
        imagens: {
          where: { removidaEm: null, hash: { not: null } },
          select: { id: true, alt: true },
          orderBy: [{ ordem: "asc" }, { id: "asc" }],
        },
      },
    });
    const disponivel = await this.db.client.$transaction((tx) =>
      this.estoque.disponivelTx(tx, empresaId, produto.id),
    );
    return {
      id: produto.id,
      nome: produto.nome,
      descricao: produto.descricao,
      preco: produto.precoVenda.toFixed(2),
      slug,
      imagens: produto.imagens,
      categoria: produto.categoria?.nome ?? null,
      disponivel: Dinheiro.max(0, disponivel).toFixed(3),
    } satisfies LojaProdutoDTO;
  }
  async categorias() {
    return this.db.client.categoria.findMany({
      where: {
        empresaId: await this.empresaId(),
        ativa: true,
        produtos: {
          some: { ativo: true, complemento: { publicadoLoja: true } },
        },
      },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    });
  }
  async cep(cep: string) {
    if (!/^\d{8}$/.test(cep))
      throw new BadRequestException("Informe um CEP com oito dígitos.");
    try {
      const result = await requestJson<{
        erro?: boolean;
        logradouro: string;
        bairro: string;
        localidade: string;
        uf: string;
        ibge: string;
      }>("CEP", "https://viacep.com.br/ws/" + cep + "/json/");
      if (
        result.erro ||
        !/^\d{7}$/.test(result.ibge) ||
        !/^[A-Z]{2}$/.test(result.uf)
      )
        throw new NotFoundException("CEP não encontrado.");
      return {
        cep,
        logradouro: result.logradouro,
        bairro: result.bairro,
        cidade: result.localidade,
        uf: result.uf,
        codigoIbge: result.ibge,
      };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new ServiceUnavailableException(
        "Não foi possível consultar o CEP. Tente novamente.",
      );
    }
  }
  async sessao(req: Request): Promise<ClienteSession> {
    const token = req.headers.cookie
      ?.split(";")
      .map((value) => value.trim())
      .find((value) => value.startsWith(clienteCookie() + "="))
      ?.slice(clienteCookie().length + 1);
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new UnauthorizedException("Entre na sua conta para continuar.");
    const sessao = await this.db.client.sessaoCliente.findUnique({
      where: { tokenHash: tokenHash(token) },
      include: { conta: true },
    });
    if (
      !sessao ||
      sessao.expiresAt <= new Date() ||
      sessao.conta.excluidaEm ||
      sessao.conta.empresaId !== (await this.empresaId())
    )
      throw new UnauthorizedException("Sua sessão expirou. Entre novamente.");
    if (
      !(await this.db.client.cliente.findFirst({
        where: {
          empresaId: sessao.conta.empresaId,
          id: sessao.conta.clienteId,
          ativo: true,
        },
      }))
    )
      throw new UnauthorizedException(
        "Sua conta está indisponível. Fale com a loja.",
      );
    return {
      empresaId: sessao.conta.empresaId,
      clienteId: sessao.conta.clienteId,
      contaId: sessao.contaId,
    };
  }
  async cadastro(
    input: ReturnType<typeof lojaCadastroSchema.parse>,
    ip: string,
  ) {
    await this.auth.limitar("cliente:cadastro:" + input.email, ip);
    const empresaId = await this.empresaId(),
      senhaHash = await argon2.hash(input.senha, {
        ...PASSWORD_OPTIONS,
        type: argon2.argon2id,
      });
    try {
      await this.db.client.$transaction(async (tx) => {
        const cliente = await tx.cliente.create({
          data: {
            empresaId,
            nome: input.nome,
            cpfCnpj: input.cpfCnpj,
            email: input.email,
            telefone: input.telefone,
          },
        });
        await tx.contaCliente.create({
          data: {
            empresaId,
            clienteId: cliente.id,
            email: input.email,
            senhaHash,
            consentimentoEm: new Date(),
          },
        });
        await tx.auditLog.create({
          data: {
            empresaId,
            acao: "CADASTRO_CLIENTE",
            entidade: "Cliente",
            entidadeId: cliente.id,
            dados: {},
          },
        });
      });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002")
        throw new ConflictException(
          "Já existe cadastro com este documento ou e-mail. Entre na sua conta ou fale com a loja.",
        );
      throw error;
    }
    return this.login(input.email, input.senha, ip);
  }
  async login(email: string, senha: string, ip: string) {
    await this.auth.limitar("cliente:login:" + email, ip);
    const empresaId = await this.empresaId();
    const conta = await this.db.client.contaCliente.findUnique({
      where: { empresaId_email: { empresaId, email } },
    });
    const valid = await argon2
      .verify(conta?.senhaHash ?? this.dummyHash, senha)
      .catch(() => false);
    if (!valid || !conta || conta.excluidaEm)
      throw new UnauthorizedException("E-mail ou senha inválidos.");
    const cliente = await this.db.client.cliente.findFirst({
      where: { empresaId, id: conta.clienteId, ativo: true },
      select: contaCampos,
    });
    if (!cliente) throw new UnauthorizedException("E-mail ou senha inválidos.");
    const token = randomBytes(32).toString("base64url");
    await this.db.client.$transaction(async (tx) => {
      await tx.sessaoCliente.deleteMany({
        where: { contaId: conta.id, expiresAt: { lte: new Date() } },
      });
      await tx.sessaoCliente.create({
        data: {
          contaId: conta.id,
          tokenHash: tokenHash(token),
          expiresAt: new Date(Date.now() + 8 * 3600000),
        },
      });
    });
    return { token, cliente };
  }
  async logout(req: Request) {
    const token = req.headers.cookie
      ?.split(";")
      .map((value) => value.trim())
      .find((value) => value.startsWith(clienteCookie() + "="))
      ?.slice(clienteCookie().length + 1);
    if (token)
      await this.db.client.sessaoCliente.deleteMany({
        where: { tokenHash: tokenHash(token) },
      });
  }
  async conta(sessao: ClienteSession) {
    const cliente = await this.db.client.cliente.findFirstOrThrow({
      where: { empresaId: sessao.empresaId, id: sessao.clienteId },
      select: contaCampos,
    });
    const pedidos = await this.db.client.pedidoOnline.findMany({
      where: { empresaId: sessao.empresaId, clienteId: sessao.clienteId },
      select: {
        id: true,
        numero: true,
        total: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const vouchers = await this.db.client.voucher.findMany({
      where: { empresaId: sessao.empresaId, clienteId: sessao.clienteId },
      select: {
        codigo: true,
        servicoNome: true,
        status: true,
        validoAte: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return {
      cliente,
      pedidos: pedidos.map((pedido) => ({
        ...pedido,
        total: pedido.total.toFixed(2),
      })),
      vouchers,
    };
  }
  async encerrar(sessao: ClienteSession) {
    const senhaHash = await argon2.hash(randomBytes(32), {
      ...PASSWORD_OPTIONS,
      type: argon2.argon2id,
    });
    await this.db.client.$transaction(async (tx) => {
      await tx.sessaoCliente.deleteMany({ where: { contaId: sessao.contaId } });
      await tx.contaCliente.update({
        where: { id: sessao.contaId },
        data: {
          excluidaEm: new Date(),
          senhaHash,
          recuperacaoHash: null,
          recuperacaoAte: null,
        },
      });
      await tx.auditLog.create({
        data: {
          empresaId: sessao.empresaId,
          acao: "ENCERRAR_CONTA_CLIENTE",
          entidade: "Cliente",
          entidadeId: sessao.clienteId,
          dados: {},
        },
      });
    });
    return { message: "Sua conta foi encerrada." };
  }
  async recuperar(email: string, ip: string) {
    await this.auth.limitar("cliente:recuperar:" + email, ip);
    if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM)
      throw new ServiceUnavailableException(
        "O envio de e-mail precisa ser configurado pela loja.",
      );
    const empresaId = await this.empresaId(),
      token = randomBytes(32).toString("base64url");
    await this.db.client.$transaction(async (tx) => {
      const conta = await tx.contaCliente.findFirst({
        where: { empresaId, email, excluidaEm: null },
      });
      if (!conta) return;
      await tx.contaCliente.update({
        where: { id: conta.id },
        data: {
          recuperacaoHash: tokenHash(token),
          recuperacaoAte: new Date(Date.now() + 20 * 60_000),
        },
      });
      const link = new URL(
        "/redefinir-senha",
        process.env.LOJA_ORIGIN ?? "http://127.0.0.1:3000",
      );
      link.hash = token;
      await tx.integracaoJob.create({
        data: {
          empresaId,
          tipo: "EMAIL",
          referencia: randomUUID(),
          payload: {
            para: email,
            assunto: "Redefina a senha da sua conta",
            texto:
              "Para definir uma nova senha da sua conta na loja, abra " +
              link.toString() +
              ". O link vale por 20 minutos. Se você não pediu a alteração, ignore esta mensagem.",
          },
        },
      });
    });
    return {
      message:
        "Se o e-mail estiver cadastrado, você receberá as instruções para redefinir a senha.",
    };
  }
  async redefinir(token: string, senha: string, ip: string) {
    await this.auth.limitar("cliente:redefinir:" + tokenHash(token), ip);
    const senhaHash = await argon2.hash(senha, {
        ...PASSWORD_OPTIONS,
        type: argon2.argon2id,
      }),
      empresaId = await this.empresaId();
    await this.db.client.$transaction(async (tx) => {
      const digest = tokenHash(token);
      await tx.$queryRaw`SELECT id FROM "ContaCliente" WHERE "recuperacaoHash"=${digest} FOR UPDATE`;
      const conta = await tx.contaCliente.findFirst({
        where: {
          empresaId,
          recuperacaoHash: digest,
          recuperacaoAte: { gt: new Date() },
          excluidaEm: null,
        },
      });
      if (!conta)
        throw new UnauthorizedException(
          "Link inválido ou expirado. Solicite a recuperação novamente.",
        );
      await tx.contaCliente.update({
        where: { id: conta.id },
        data: { senhaHash, recuperacaoHash: null, recuperacaoAte: null },
      });
      await tx.sessaoCliente.deleteMany({ where: { contaId: conta.id } });
    });
    return { message: "Senha atualizada. Entre com sua nova senha." };
  }
  private async cotacao(
    empresaId: string,
    itens: { produtoId: string; quantidade: number }[],
    cep: string,
  ) {
    const produtos = await this.db.client.produto.findMany({
      where: {
        empresaId,
        id: { in: itens.map((item) => item.produtoId) },
        ativo: true,
        tipo: { not: "INSUMO" },
        complemento: { publicadoLoja: true },
      },
      include: { complemento: true },
    });
    if (produtos.length !== itens.length)
      throw new BadRequestException(
        "Um produto ficou indisponível. Atualize seu carrinho.",
      );
    const linhas: ItemPedido[] = itens.map((item) => {
      const produto = produtos.find(
        (produto) => produto.id === item.produtoId,
      )!;
      return {
        ...item,
        nome: produto.nome,
        precoUnitario: produto.precoVenda.toFixed(2),
        total: new Dinheiro(produto.precoVenda.toString())
          .times(item.quantidade)
          .toFixed(2),
      };
    });
    const subtotal = linhas.reduce(
      (sum, item) => sum.plus(item.total),
      new Dinheiro(0),
    );
    if (!subtotal.greaterThan(0) || subtotal.greaterThan("9999999999.99"))
      throw new BadRequestException("Confira o total dos itens.");
    const config = await this.db.client.configuracaoEmpresa.findUnique({
      where: { empresaId },
    });
    const fretes: Frete[] = [];
    if (
      config?.freteGratisAtivo &&
      subtotal.greaterThanOrEqualTo(config.freteGratisMinimo)
    )
      fretes.push({
        codigo: "GRATIS",
        nome: "Frete grátis",
        valor: "0.00",
        prazoDias: null,
      });
    if (config?.correiosAtivo && config.cepOrigem) {
      const pacotes = produtos.map((produto) => ({
        produto,
        quantidade: itens.find((item) => item.produtoId === produto.id)!
          .quantidade,
      }));
      if (
        pacotes.some(
          (item) =>
            !item.produto.complemento?.pesoGramas ||
            !item.produto.complemento.alturaCm ||
            !item.produto.complemento.larguraCm ||
            !item.produto.complemento.comprimentoCm,
        )
      ) {
        if (!fretes.length)
          throw new ConflictException(
            "Os dados de entrega de um produto precisam ser completados pela loja.",
          );
      } else {
        const pesoGramas = pacotes.reduce(
          (peso, item) =>
            peso + item.produto.complemento!.pesoGramas! * item.quantidade,
          0,
        );
        const alturaCm = pacotes.reduce(
          (altura, item) =>
            altura + item.produto.complemento!.alturaCm! * item.quantidade,
          0,
        );
        const larguraCm = Math.max(
          11,
          ...produtos.map((produto) => produto.complemento!.larguraCm!),
        );
        const comprimentoCm = Math.max(
          16,
          ...produtos.map((produto) => produto.complemento!.comprimentoCm!),
        );
        if (
          pesoGramas <= 30000 &&
          alturaCm <= 100 &&
          alturaCm + larguraCm + comprimentoCm <= 200
        ) {
          try {
            fretes.push(
              ...(await this.correios.cotar(config.cepOrigem, cep, {
                pesoGramas,
                alturaCm: Math.max(2, alturaCm),
                larguraCm,
                comprimentoCm,
              })),
            );
          } catch {
            if (!fretes.length)
              throw new ServiceUnavailableException(
                "Não foi possível calcular o frete. Tente novamente em instantes.",
              );
          }
        } else if (!fretes.length)
          throw new BadRequestException(
            "O pedido excede os limites de envio. Divida os itens em mais de um pedido.",
          );
      }
    }
    return { linhas, subtotal, fretes };
  }
  async frete(input: {
    itens: { produtoId: string; quantidade: number }[];
    cep: string;
  }) {
    const result = await this.cotacao(
      await this.empresaId(),
      input.itens,
      input.cep,
    );
    return { subtotal: result.subtotal.toFixed(2), fretes: result.fretes };
  }
  async checkout(
    sessao: ClienteSession,
    input: CheckoutLojaInput,
    ip = "local",
  ) {
    await this.auth.limitar("checkout:" + sessao.clienteId, ip);
    const hash = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    const anterior = await this.db.client.pedidoOnline.findUnique({
      where: {
        empresaId_chaveOperacao: {
          empresaId: sessao.empresaId,
          chaveOperacao: input.chaveOperacao,
        },
      },
    });
    if (anterior) {
      if (
        anterior.clienteId !== sessao.clienteId ||
        anterior.hashOperacao !== hash
      )
        throw new ConflictException(
          "Chave de operação utilizada com outros dados.",
        );
      return { id: anterior.id, numero: anterior.numero };
    }
    const providers = await this.configuracao();
    if (
      !providers.gateways.some(
        (provider) => provider.codigo === input.gateway && provider.disponivel,
      )
    )
      throw new ConflictException(
        "Este provedor de pagamento precisa ser configurado pela loja.",
      );
    const cotacao = await this.cotacao(
      sessao.empresaId,
      input.itens,
      input.endereco.cep,
    );
    const frete = cotacao.fretes.find(
      (frete) => frete.codigo === input.servicoFrete,
    );
    if (!frete)
      throw new ConflictException(
        "A entrega selecionada ficou indisponível. Calcule o frete novamente.",
      );
    return this.db.client.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${"comercial:" + sessao.empresaId}, 0))`;
        const repetido = await tx.pedidoOnline.findUnique({
          where: {
            empresaId_chaveOperacao: {
              empresaId: sessao.empresaId,
              chaveOperacao: input.chaveOperacao,
            },
          },
        });
        if (repetido) {
          if (
            repetido.clienteId !== sessao.clienteId ||
            repetido.hashOperacao !== hash
          )
            throw new ConflictException(
              "Chave de operação utilizada com outros dados.",
            );
          return { id: repetido.id, numero: repetido.numero };
        }
        const config = await tx.configuracaoEmpresa.findUnique({
          where: { empresaId: sessao.empresaId },
        });
        if (
          !config?.contaOnlineId ||
          !(await tx.contaFinanceira.findFirst({
            where: {
              empresaId: sessao.empresaId,
              id: config.contaOnlineId,
              ativa: true,
            },
          }))
        )
          throw new ConflictException(
            "A loja precisa configurar a conta de recebimento online.",
          );
        for (const produtoId of input.itens
          .map((item) => item.produtoId)
          .sort())
          await tx.$queryRaw`SELECT id FROM "Produto" WHERE "empresaId"=${sessao.empresaId} AND id=${produtoId} FOR UPDATE`;
        for (const item of cotacao.linhas) {
          const produto = await tx.produto.findFirst({
            where: {
              empresaId: sessao.empresaId,
              id: item.produtoId,
              ativo: true,
              complemento: { publicadoLoja: true },
            },
          });
          if (!produto || !produto.precoVenda.equals(item.precoUnitario))
            throw new ConflictException(
              "Um produto ou preço mudou. Atualize o carrinho.",
            );
          if (
            (
              await this.estoque.disponivelTx(
                tx,
                sessao.empresaId,
                item.produtoId,
              )
            ).lessThan(item.quantidade)
          )
            throw new ConflictException(
              "Estoque insuficiente para " + item.nome + ".",
            );
        }
        const total = cotacao.subtotal.plus(frete.valor);
        if (total.greaterThan("9999999999.99"))
          throw new BadRequestException("O total excede o limite permitido.");
        const expiresAt = new Date(Date.now() + 30 * 60_000);
        const pedido = await tx.pedidoOnline.create({
          data: {
            empresaId: sessao.empresaId,
            clienteId: sessao.clienteId,
            chaveOperacao: input.chaveOperacao,
            hashOperacao: hash,
            itens: cotacao.linhas,
            endereco: input.endereco,
            subtotal: cotacao.subtotal,
            frete: frete.valor,
            total,
            servicoFrete: frete.codigo,
            prazoDias: frete.prazoDias,
            gateway: input.gateway,
            cpfNaNota: input.cpfNaNota,
            notaPorEmail: input.notaPorEmail,
            expiresAt,
          },
        });
        await tx.reservaEstoque.createMany({
          data: input.itens.map((item) => ({
            empresaId: sessao.empresaId,
            produtoId: item.produtoId,
            pedidoId: pedido.id,
            quantidade: item.quantidade,
            expiresAt,
          })),
        });
        await tx.integracaoJob.create({
          data: {
            empresaId: sessao.empresaId,
            tipo: "PAGAMENTO_CRIAR",
            referencia: pedido.id,
            payload: {},
          },
        });
        await tx.auditLog.create({
          data: {
            empresaId: sessao.empresaId,
            acao: "CHECKOUT",
            entidade: "PedidoOnline",
            entidadeId: pedido.id,
            dados: {
              clienteId: sessao.clienteId,
              total: total.toFixed(2),
              gateway: input.gateway,
            },
          },
        });
        return { id: pedido.id, numero: pedido.numero };
      },
      { timeout: 30000 },
    );
  }
  async pedido(sessao: ClienteSession, id: string) {
    const row = await this.db.client.pedidoOnline.findFirst({
      where: { empresaId: sessao.empresaId, clienteId: sessao.clienteId, id },
    });
    if (!row) throw new NotFoundException("Pedido não encontrado.");
    const itens = (row.itens as unknown as (ItemPedido | ItemServico)[]).map(
      (item) => ({
        nome: item.nome,
        quantidade: item.quantidade,
        total: item.total,
        ...("servicoId" in item
          ? { servicoId: item.servicoId }
          : { produtoId: item.produtoId }),
      }),
    );
    return {
      id: row.id,
      numero: row.numero,
      status:
        row.status === "AGUARDANDO_PAGAMENTO" && row.expiresAt <= new Date()
          ? "EXPIRADO"
          : row.status,
      subtotal: row.subtotal.toFixed(2),
      frete: row.frete.toFixed(2),
      total: row.total.toFixed(2),
      itens,
      endereco: row.endereco,
      gateway: row.gateway,
      checkoutUrl:
        row.status === "AGUARDANDO_PAGAMENTO" && row.expiresAt > new Date()
          ? row.checkoutUrl
          : null,
      expiresAt: row.expiresAt.toISOString(),
      rastreio: row.rastreio,
      eventos: row.eventos,
      prazoDias: row.prazoDias,
    };
  }
  async servicosPublicos() {
    const itens = await this.db.client.servico.findMany({
      where: {
        empresaId: await this.empresaId(),
        ativo: true,
        publicadoLoja: true,
      },
      select: {
        id: true,
        nome: true,
        descricao: true,
        preco: true,
        duracaoMin: true,
        validadeDias: true,
      },
      orderBy: { nome: "asc" },
      take: 100,
    });
    return itens.map((item) => ({ ...item, preco: item.preco.toFixed(2) }));
  }
  async servicoPublico(id: string) {
    const servico = await this.db.client.servico.findFirst({
      where: {
        empresaId: await this.empresaId(),
        id,
        ativo: true,
        publicadoLoja: true,
      },
      select: {
        id: true,
        nome: true,
        descricao: true,
        preco: true,
        duracaoMin: true,
        validadeDias: true,
      },
    });
    if (!servico) throw new NotFoundException("Serviço não encontrado.");
    return { ...servico, preco: servico.preco.toFixed(2) };
  }
  async checkoutServico(
    sessao: ClienteSession,
    input: CheckoutServicoInput,
    ip: string,
  ) {
    await this.auth.limitar("checkout:" + sessao.clienteId, ip);
    const hash = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    const config = await this.configuracao();
    if (
      !config.gateways.some(
        (gateway) => gateway.codigo === input.gateway && gateway.disponivel,
      )
    )
      throw new ConflictException(
        "O provedor de pagamento precisa ser configurado pela loja.",
      );
    return this.db.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${"comercial:" + sessao.empresaId}, 0))`;
      const anterior = await tx.pedidoOnline.findUnique({
        where: {
          empresaId_chaveOperacao: {
            empresaId: sessao.empresaId,
            chaveOperacao: input.chaveOperacao,
          },
        },
      });
      if (anterior) {
        if (
          anterior.hashOperacao !== hash ||
          anterior.clienteId !== sessao.clienteId
        )
          throw new ConflictException(
            "Chave de operação utilizada com outros dados.",
          );
        return { id: anterior.id };
      }
      const empresa = await tx.configuracaoEmpresa.findUnique({
        where: { empresaId: sessao.empresaId },
      });
      if (!empresa?.contaOnlineId)
        throw new ConflictException(
          "A loja precisa configurar a conta de recebimento online.",
        );
      const servico = await tx.servico.findFirst({
        where: {
          empresaId: sessao.empresaId,
          id: input.servicoId,
          ativo: true,
          publicadoLoja: true,
        },
        include: { insumos: true },
      });
      if (!servico) throw new ConflictException("Serviço indisponível.");
      const total = new Dinheiro(servico.preco.toString()).times(
        input.quantidade,
      );
      if (total.greaterThan("9999999999.99"))
        throw new BadRequestException("Total acima do limite permitido.");
      const ficha: ServicoSnapshot = {
        nome: servico.nome,
        preco: servico.preco.toFixed(2),
        validadeDias: servico.validadeDias,
        insumos: servico.insumos.map((item) => ({
          produtoId: item.produtoId,
          quantidade: item.quantidade.toFixed(3),
        })),
      };
      const itens = [
        {
          servicoId: servico.id,
          nome: servico.nome,
          quantidade: input.quantidade,
          precoUnitario: servico.preco.toFixed(2),
          total: total.toFixed(2),
          ficha,
        },
      ];
      const pedido = await tx.pedidoOnline.create({
        data: {
          empresaId: sessao.empresaId,
          clienteId: sessao.clienteId,
          chaveOperacao: input.chaveOperacao,
          hashOperacao: hash,
          itens,
          endereco: { semEntrega: true },
          subtotal: total,
          frete: "0.00",
          total,
          servicoFrete: "SEM_ENTREGA",
          gateway: input.gateway,
          expiresAt: new Date(Date.now() + 30 * 60000),
          notaPorEmail: input.notaPorEmail,
        },
      });
      await tx.integracaoJob.create({
        data: {
          empresaId: sessao.empresaId,
          tipo: "PAGAMENTO_CRIAR",
          referencia: pedido.id,
          payload: {},
        },
      });
      return { id: pedido.id };
    });
  }
  async registrarEvento(
    origem: GatewayName,
    chaveExterna: string,
    pagamentoId: string,
  ) {
    await this.db.client.webhookEvento.createMany({
      data: [{ origem, chaveExterna, payload: { pagamentoId } }],
      skipDuplicates: true,
    });
  }
  private async confirmarPagamento(
    gateway: GatewayName,
    pagamento: PaymentResult,
  ) {
    const pedido = await this.db.client.pedidoOnline.findFirst({
      where: { id: pagamento.referencia, gateway },
    });
    if (
      !pedido ||
      pagamento.moeda !== "BRL" ||
      !pedido.total.equals(pagamento.valor)
    )
      throw new BadRequestException("O pagamento não corresponde ao pedido.");
    if (!pagamento.pago && !pagamento.estornado) return;
    const user: Identity = {
      id: "",
      empresaId: pedido.empresaId,
      nome: "Loja online",
      perfil: "ADMIN",
    };
    try {
      await this.db.client.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${"comercial:" + pedido.empresaId}, 0))`;
          const atual = await tx.pedidoOnline.findUniqueOrThrow({
            where: { id: pedido.id },
          });
          if (pagamento.estornado) {
            if (atual.pagamentoId === pagamento.id) {
              const ids = (atual.itens as unknown as ItemServico[]).flatMap(
                (item) => item.voucherIds ?? [],
              );
              const titulos = await tx.tituloFinanceiro.findMany({
                where: {
                  empresaId: pedido.empresaId,
                  OR: [
                    ...(atual.vendaId
                      ? [
                          { vendaId: atual.vendaId },
                          {
                            origemTipo: "VENDA_PARCELA",
                            origemId: atual.vendaId,
                          },
                        ]
                      : []),
                    ...(ids.length
                      ? [{ origemTipo: "VOUCHER", origemId: { in: ids } }]
                      : []),
                  ],
                },
              });
              const baixas = await tx.lancamentoFinanceiro.findMany({
                where: {
                  empresaId: pedido.empresaId,
                  tituloId: { in: titulos.map((titulo) => titulo.id) },
                  estornoDeId: null,
                  estornos: { none: {} },
                },
              });
              for (const baixa of baixas)
                await this.financeiro.estornarTx(
                  tx,
                  user,
                  baixa.id,
                  "Reembolso ou contestação confirmado pelo provedor",
                );
              await tx.tituloFinanceiro.updateMany({
                where: {
                  empresaId: pedido.empresaId,
                  id: { in: titulos.map((titulo) => titulo.id) },
                  canceladoEm: null,
                },
                data: {
                  canceladoEm: new Date(),
                  motivoCancelamento: "Reembolso confirmado pelo provedor",
                },
              });
              if (ids.length)
                await tx.voucher.updateMany({
                  where: {
                    empresaId: pedido.empresaId,
                    id: { in: ids },
                    status: "ATIVO",
                  },
                  data: {
                    status: "CANCELADO",
                    canceladoEm: new Date(),
                    motivo: "Reembolso confirmado pelo provedor",
                  },
                });
              await tx.pedidoOnline.update({
                where: { id: atual.id },
                data: { status: "REEMBOLSADO" },
              });
              await this.comercial.auditar(
                tx,
                user,
                "PedidoOnline",
                atual.id,
                "REEMBOLSO_CONFIRMADO",
                { gateway, pagamentoId: pagamento.id },
              );
            }
            return;
          }
          if (atual.pagamentoId) {
            if (atual.pagamentoId !== pagamento.id)
              await tx.integracaoJob.createMany({
                data: [
                  {
                    empresaId: pedido.empresaId,
                    tipo: "PAGAMENTO_REEMBOLSAR",
                    referencia: gateway + ":" + pagamento.id,
                    payload: {
                      gateway,
                      pagamentoId: pagamento.id,
                      pedidoId: pedido.id,
                    },
                  },
                ],
                skipDuplicates: true,
              });
            return;
          }
          if (atual.status === "CANCELADO")
            throw new ConflictException(
              "Pedido cancelado antes da confirmação do pagamento.",
            );
          const config = await tx.configuracaoEmpresa.findUniqueOrThrow({
            where: { empresaId: pedido.empresaId },
          });
          let vendaId: string | null = null;
          if (atual.servicoFrete === "SEM_ENTREGA") {
            const itens = atual.itens as unknown as ItemServico[];
            if (!config.contaOnlineId)
              throw new ConflictException("Conta de recebimento indisponível.");
            for (const item of itens) {
              item.voucherIds = [];
              for (
                let quantidade = 0;
                quantidade < item.quantidade;
                quantidade++
              ) {
                const voucherId = await this.servicos.venderTx(
                  tx,
                  user,
                  {
                    servicoId: item.servicoId,
                    clienteId: atual.clienteId,
                    vencimento: dataLoja(),
                  },
                  item.ficha,
                );
                const titulo = await tx.tituloFinanceiro.findFirstOrThrow({
                  where: {
                    empresaId: pedido.empresaId,
                    origemTipo: "VOUCHER",
                    origemId: voucherId,
                  },
                });
                await this.financeiro.baixarTx(tx, user, titulo.id, {
                  contaId: config.contaOnlineId,
                  valor: item.precoUnitario,
                  forma: pagamento.forma,
                  data: dataLoja(),
                });
                item.voucherIds.push(voucherId);
              }
            }
            await tx.pedidoOnline.update({
              where: { id: atual.id },
              data: { itens: itens as unknown as Prisma.InputJsonArray },
            });
          } else {
            const itens = atual.itens as unknown as ItemPedido[];
            for (const produtoId of itens.map((item) => item.produtoId).sort())
              await tx.$queryRaw`SELECT id FROM "Produto" WHERE "empresaId"=${pedido.empresaId} AND id=${produtoId} FOR UPDATE`;
            await tx.reservaEstoque.deleteMany({
              where: { empresaId: pedido.empresaId, pedidoId: atual.id },
            });
            const input = vendaSchema.parse({
              chaveOperacao: randomUUID(),
              clienteId: atual.clienteId,
              itens: itens.map((item) => ({
                produtoId: item.produtoId,
                quantidade: String(item.quantidade),
                precoUnitario: item.precoUnitario,
              })),
              recebimento: {
                contaId: config.contaOnlineId,
                forma: pagamento.forma,
                valor: atual.total.toFixed(2),
              },
              observacao: "Pedido online " + atual.numero,
            });
            vendaId = await this.vendas.criarTx(tx, user, input, {
              frete: atual.frete.toFixed(2),
              precosReservados: true,
            });
          }
          await tx.pedidoOnline.update({
            where: { id: atual.id },
            data: {
              status: "PAGO",
              vendaId,
              pagamentoId: pagamento.id,
              pagoEm: new Date(),
            },
          });
          await this.comercial.auditar(
            tx,
            user,
            "PedidoOnline",
            atual.id,
            "CONFIRMAR_PAGAMENTO",
            { gateway, pagamentoId: pagamento.id, vendaId },
          );
          const cliente = await tx.cliente.findFirstOrThrow({
            where: { empresaId: pedido.empresaId, id: atual.clienteId },
          });
          if (
            cliente.email &&
            process.env.RESEND_API_KEY &&
            process.env.EMAIL_FROM
          )
            await tx.integracaoJob.create({
              data: {
                empresaId: pedido.empresaId,
                tipo: "EMAIL",
                referencia: "pago-" + atual.id,
                payload: {
                  para: cliente.email,
                  assunto: "Pagamento confirmado · Pedido " + atual.numero,
                  texto:
                    "O pagamento do pedido " +
                    atual.numero +
                    " foi confirmado. Acompanhe sua entrega na área Minha conta da loja.",
                },
              },
            });
        },
        { timeout: 30000 },
      );
    } catch (error) {
      if (
        !(error instanceof HttpException) ||
        ![400, 409].includes(error.getStatus())
      )
        throw error;
      await this.db.client.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${"comercial:" + pedido.empresaId}, 0))`;
        const atual = await tx.pedidoOnline.findUniqueOrThrow({
          where: { id: pedido.id },
        });
        if (atual.pagamentoId) return;
        await tx.reservaEstoque.deleteMany({
          where: { empresaId: pedido.empresaId, pedidoId: pedido.id },
        });
        await tx.pedidoOnline.update({
          where: { id: pedido.id },
          data: {
            status: "REEMBOLSO_PENDENTE",
            pagamentoId: pagamento.id,
            pagoEm: new Date(),
          },
        });
        await tx.integracaoJob.createMany({
          data: [
            {
              empresaId: pedido.empresaId,
              tipo: "PAGAMENTO_REEMBOLSAR",
              referencia: gateway + ":" + pagamento.id,
              payload: {
                gateway,
                pagamentoId: pagamento.id,
                pedidoId: pedido.id,
              },
            },
          ],
          skipDuplicates: true,
        });
        await this.comercial.auditar(
          tx,
          user,
          "PedidoOnline",
          pedido.id,
          "SOLICITAR_REEMBOLSO",
          {
            motivo:
              "Não foi possível concluir a venda após a confirmação do pagamento.",
          },
        );
      });
    }
    await this.faturarAutomaticamente(user, pedido.id);
  }
  private async faturarAutomaticamente(user: Identity, pedidoId: string) {
    const config = await this.db.client.configuracaoEmpresa.findUnique({
      where: { empresaId: user.empresaId },
    });
    if (!(config?.integracoes as { focus?: boolean } | null)?.focus) return;
    const pedido = await this.db.client.pedidoOnline.findUniqueOrThrow({
      where: { id: pedidoId },
    });
    if (!["PAGO", "FATURADO"].includes(pedido.status)) return;
    const origens: { vendaId?: string; voucherId?: string }[] = pedido.vendaId
      ? [{ vendaId: pedido.vendaId }]
      : (pedido.itens as unknown as ItemServico[]).flatMap((item) =>
          (item.voucherIds ?? []).map((voucherId) => ({ voucherId })),
        );
    for (const origem of origens) {
      if (
        await this.db.client.notaEmitida.count({
          where: { empresaId: user.empresaId, ...origem },
        })
      )
        continue;
      const voucher = origem.voucherId
        ? await this.db.client.voucher.findUnique({
            where: { id: origem.voucherId },
            include: { servico: true },
          })
        : null;
      const modelo = origem.vendaId ? "NFE" : "NFSE";
      try {
        await this.fiscal.emitir(user, {
          chaveOperacao: randomUUID(),
          ...origem,
          modelo,
          endereco: null,
          ...(voucher?.servico.codigoListaServico
            ? { codigoListaServico: voucher.servico.codigoListaServico }
            : {}),
          ...(voucher?.servico.aliquotaIss !== null &&
          voucher?.servico.aliquotaIss !== undefined
            ? { aliquotaIss: voucher.servico.aliquotaIss.toFixed(4) }
            : {}),
        });
      } catch (error) {
        if (!(error instanceof HttpException) || error.getStatus() !== 400)
          throw error;
        await this.db.client.notaEmitida.create({
          data: {
            empresaId: user.empresaId,
            ...origem,
            modelo,
            status: "ERRO",
            payload: {},
            mensagem: error.message,
          },
        });
      }
    }
  }
  async processarEventos() {
    if (this.processing) return;
    this.processing = true;
    try {
      const eventos = await this.db.client.webhookEvento.findMany({
        where: {
          processadoEm: null,
          proximaEm: { lte: new Date() },
          tentativas: { lt: 12 },
          origem: { in: ["MERCADO_PAGO", "ASAAS", "PAGARME"] },
        },
        orderBy: { createdAt: "asc" },
        take: 10,
      });
      for (const evento of eventos) {
        try {
          const pagamentoId = String(
            (evento.payload as { pagamentoId: string }).pagamentoId,
          );
          const gateway = evento.origem as GatewayName;
          await this.confirmarPagamento(
            gateway,
            await new GatewayClient(gateway).pagamento(pagamentoId),
          );
          await this.db.client.webhookEvento.update({
            where: { id: evento.id },
            data: { processadoEm: new Date(), erro: null },
          });
        } catch {
          await this.db.client.webhookEvento.update({
            where: { id: evento.id },
            data: {
              tentativas: { increment: 1 },
              proximaEm: new Date(
                Date.now() + Math.min(3600000, 15000 * 2 ** evento.tentativas),
              ),
              erro: "Não foi possível conciliar o evento de pagamento. Confira a integração.",
            },
          });
        }
      }
    } catch {
      /* O evento permanece persistido para uma próxima tentativa. */
    } finally {
      this.processing = false;
    }
  }
}
