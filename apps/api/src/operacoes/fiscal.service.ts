import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@sistema/db";
import { IntegrationError, gerarDanfse, lerNfe, montarDps, type DadosDps } from "@sistema/integracoes";
import {
  enderecoSchema,
  type EmitirNotaInput,
  type ListaOperacoes,
} from "@sistema/shared";
import { DatabaseService } from "../database.service";
import {
  ComercialService,
  Dinheiro,
  ratearValor,
} from "../comercial/comercial.service";
import type { Identity } from "../auth/auth.service";
import { xmlZip } from "./xml-zip";

@Injectable()
export class FiscalService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(ComercialService) private readonly comercial: ComercialService,
  ) {}
  async recebidas(empresaId: string, query: ListaOperacoes) {
    const where: Prisma.NotaRecebidaWhereInput = {
      empresaId,
      ...(query.q
        ? {
            OR: [
              { numero: { contains: query.q } },
              { fornecedorNome: { contains: query.q, mode: "insensitive" } },
              { chave: { contains: query.q } },
            ],
          }
        : {}),
    };
    const [itens, total] = await this.db.client.$transaction([
      this.db.client.notaRecebida.findMany({
        where,
        select: {
          id: true,
          chave: true,
          numero: true,
          fornecedorNome: true,
          valorTotal: true,
          status: true,
          compraId: true,
          emitidaEm: true,
        },
        orderBy: [{ emitidaEm: "desc" }, { id: "desc" }],
        take: query.pageSize,
        skip: (query.page - 1) * query.pageSize,
      }),
      this.db.client.notaRecebida.count({ where }),
    ]);
    return {
      itens: itens.map((item) => ({
        ...item,
        valorTotal: item.valorTotal.toFixed(2),
      })),
      total,
      page: query.page,
      pages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }
  async recebida(empresaId: string, id: string) {
    const row = await this.db.client.notaRecebida.findFirst({
      where: { empresaId, id },
    });
    if (!row) throw new NotFoundException("Nota recebida não encontrada.");
    return {
      ...row,
      versaoFocus: row.versaoFocus.toString(),
      valorTotal: row.valorTotal.toFixed(2),
      ...(row.xml ? { dados: lerNfe(row.xml) } : {}),
    };
  }
  importar(user: Identity, input: { chaveOperacao: string; xml: string }) {
    let nota: ReturnType<typeof lerNfe>;
    try {
      nota = lerNfe(input.xml);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : "XML inválido.",
      );
    }
    return this.comercial.executar(
      user,
      "IMPORTAR_XML",
      input,
      async (tx) => {
        const empresa = await tx.empresa.findUniqueOrThrow({
          where: { id: user.empresaId },
        });
        if (!empresa.cnpj || empresa.cnpj !== nota.destinatarioDocumento)
          throw new BadRequestException(
            "O destinatário da nota deve corresponder ao CNPJ configurado para a empresa.",
          );
        const existente = await tx.notaRecebida.findUnique({
          where: {
            empresaId_chave: { empresaId: user.empresaId, chave: nota.chave },
          },
        });
        if (existente?.compraId)
          throw new ConflictException(
            "Esta nota já gerou entrada de mercadorias.",
          );
        const row = await tx.notaRecebida.upsert({
          where: {
            empresaId_chave: { empresaId: user.empresaId, chave: nota.chave },
          },
          create: {
            empresaId: user.empresaId,
            chave: nota.chave,
            numero: nota.numero,
            fornecedorNome: nota.fornecedorNome,
            fornecedorDocumento: nota.fornecedorDocumento,
            emitidaEm: new Date(nota.emitidaEm + "T00:00:00Z"),
            valorTotal: nota.valorTotal,
            xml: input.xml,
            dados: nota,
          },
          update: { xml: input.xml, dados: nota },
        });
        await this.comercial.auditar(
          tx,
          user,
          "NotaRecebida",
          row.id,
          "IMPORTAR_XML",
          { chave: nota.chave, total: nota.valorTotal },
        );
        return row.id;
      },
      async (tx, id) => {
        const row = await tx.notaRecebida.findFirstOrThrow({
          where: { empresaId: user.empresaId, id },
        });
        return { id: row.id, chave: row.chave };
      },
    );
  }
  agendar(
    user: Identity,
    tipo: string,
    referencia: string,
    payload: Prisma.InputJsonObject,
    input: { chaveOperacao: string },
  ) {
    const operacao = { ...input, referencia, payload };
    return this.comercial.executar(
      user,
      tipo + ":" + referencia,
      operacao,
      async (tx) => {
        const job = await tx.integracaoJob.create({
          data: {
            empresaId: user.empresaId,
            tipo,
            referencia: input.chaveOperacao,
            payload,
          },
        });
        await this.comercial.auditar(
          tx,
          user,
          "IntegracaoJob",
          job.id,
          "AGENDAR",
          { tipo, referencia },
        );
        return job.id;
      },
      (tx, id) =>
        tx.integracaoJob.findFirstOrThrow({
          where: { empresaId: user.empresaId, id },
          select: { id: true, status: true, tipo: true },
        }),
    );
  }
  async manifestar(
    user: Identity,
    id: string,
    input: { chaveOperacao: string },
  ) {
    const nota = await this.db.client.notaRecebida.findFirst({
      where: { empresaId: user.empresaId, id },
    });
    if (!nota) throw new NotFoundException("Nota não encontrada.");
    return this.agendar(
      user,
      "FOCUS_MANIFESTAR",
      id,
      { chave: nota.chave, tipo: "ciencia" },
      input,
    );
  }
  async emitidas(empresaId: string, query: ListaOperacoes) {
    const where = { empresaId };
    const [itens, total] = await this.db.client.$transaction([
      this.db.client.notaEmitida.findMany({
        where,
        select: {
          id: true,
          vendaId: true,
          voucherId: true,
          modelo: true,
          status: true,
          mensagem: true,
          danfeUrl: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.pageSize,
        skip: (query.page - 1) * query.pageSize,
      }),
      this.db.client.notaEmitida.count({ where }),
    ]);
    return {
      itens,
      total,
      page: query.page,
      pages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }
  emitir(user: Identity, input: EmitirNotaInput) {
    return this.comercial.executar(
      user,
      "EMITIR_NOTA",
      input,
      async (tx) => {
        const empresa = await tx.empresa.findUniqueOrThrow({
          where: { id: user.empresaId },
          include: { configuracao: true },
        });
        const config = empresa.configuracao,
          endereco = enderecoSchema.safeParse(config?.endereco);
        if (
          !empresa.cnpj ||
          !config?.razaoSocial ||
          !config.regimeTributario ||
          !endereco.success
        )
          throw new BadRequestException(
            "Complete os dados fiscais e o endereço da empresa nas configurações.",
          );
        const anterior = await tx.notaEmitida.findFirst({
          where: {
            empresaId: user.empresaId,
            vendaId: input.vendaId ?? null,
            voucherId: input.voucherId ?? null,
            status: { notIn: ["CANCELADA", "ERRO"] },
          },
        });
        if (anterior)
          throw new ConflictException(
            "Já existe uma nota ativa para esta operação.",
          );
        let payload: Prisma.InputJsonObject;
        if (input.modelo === "NFSE") {
          const voucher = await tx.voucher.findFirst({
            where: {
              empresaId: user.empresaId,
              id: input.voucherId,
              status: { not: "CANCELADO" },
            },
            include: { servico: true },
          });
          const cliente = voucher
            ? await tx.cliente.findFirst({
                where: { empresaId: user.empresaId, id: voucher.clienteId },
              })
            : null;
          if ((config.integracoes as { nfseNacional?: boolean } | null)?.nfseNacional) {
            payload = await this.payloadNfseNacional(tx, user.empresaId, empresa.cnpj, config, endereco.data.codigoIbge, voucher, cliente, input);
          } else {
          if (
            !voucher ||
            !cliente?.cpfCnpj ||
            !voucher.servico.codigoMunicipal ||
            !input.codigoListaServico ||
            !input.aliquotaIss
          )
            throw new BadRequestException(
              "Confira voucher, documento do cliente, código municipal, item da lista de serviços e alíquota do ISS.",
            );
          payload = {
            data_emissao: new Date().toISOString(),
            natureza_operacao: "1",
            optante_simples_nacional: config.regimeTributario === "SIMPLES",
            prestador: {
              cnpj: empresa.cnpj,
              inscricao_municipal: config.inscricaoMunicipal,
              codigo_municipio: endereco.data.codigoIbge,
            },
            tomador: {
              razao_social: cliente.nome,
              [cliente.cpfCnpj.length === 11 ? "cpf" : "cnpj"]: cliente.cpfCnpj,
              ...(cliente.email ? { email: cliente.email } : {}),
            },
            servico: {
              discriminacao: voucher.servicoNome,
              valor_servicos: voucher.valor.toFixed(2),
              item_lista_servico: input.codigoListaServico,
              codigo_tributario_municipio: voucher.servico.codigoMunicipal,
              aliquota: input.aliquotaIss,
              iss_retido: false,
              codigo_municipio: endereco.data.codigoIbge,
            },
          };
          }
        } else {
          const venda = await tx.venda.findFirst({
            where: {
              empresaId: user.empresaId,
              id: input.vendaId,
              status: "CONFIRMADA",
            },
            include: {
              itens: {
                include: { produto: { include: { complemento: true } } },
              },
              cliente: true,
            },
          });
          if (!venda)
            throw new NotFoundException("Venda confirmada não encontrada.");
          const pedido = await tx.pedidoOnline.findFirst({
            where: { empresaId: user.empresaId, vendaId: venda.id },
          });
          const destino = enderecoSchema.safeParse(
            input.endereco ?? pedido?.endereco,
          );
          if (
            input.modelo === "NFE" &&
            (!venda.cliente?.cpfCnpj || !destino.success)
          )
            throw new BadRequestException(
              "NF-e exige documento e endereço completo do destinatário.",
            );
          const descontos = ratearValor(
            venda.desconto,
            venda.itens.map((item) => item.total),
          );
          const fretes = ratearValor(
            venda.frete,
            venda.itens.map((item) => item.total),
          );
          const itens = venda.itens.map((item, index) => {
            const fiscal = item.produto.complemento;
            if (
              !fiscal?.ncm ||
              !fiscal.cfopVenda ||
              !(config.regimeTributario === "SIMPLES"
                ? fiscal.csosn
                : fiscal.cst)
            )
              throw new BadRequestException(
                "Complete NCM, CFOP e situação tributária de " +
                  item.nome +
                  ".",
              );
            const base = new Dinheiro(item.total.toString())
              .minus(descontos[index])
              .plus(fretes[index]);
            const tributo = (aliquota: Prisma.Decimal) =>
              base.times(aliquota).div(100).toFixed(2);
            const interestadual =
              destino.success && destino.data.uf !== endereco.data.uf;
            if (interestadual && !fiscal.cfopInterestadual)
              throw new BadRequestException(
                "Configure o CFOP interestadual de " + item.nome + ".",
              );
            return {
              numero_item: String(index + 1),
              valor_desconto: descontos[index].toFixed(2),
              valor_frete: fretes[index].toFixed(2),
              codigo_produto: item.sku,
              descricao: item.nome,
              codigo_ncm: fiscal.ncm,
              cfop: interestadual ? fiscal.cfopInterestadual : fiscal.cfopVenda,
              unidade_comercial: item.unidade,
              quantidade_comercial: item.quantidade.toFixed(3),
              valor_unitario_comercial: item.precoUnitario.toFixed(2),
              valor_bruto: item.total.toFixed(2),
              unidade_tributavel: item.unidade,
              quantidade_tributavel: item.quantidade.toFixed(3),
              valor_unitario_tributavel: item.precoUnitario.toFixed(2),
              icms_origem: String(fiscal.origem),
              icms_situacao_tributaria:
                config.regimeTributario === "SIMPLES"
                  ? fiscal.csosn
                  : fiscal.cst,
              ...(fiscal.cstPis
                ? { pis_situacao_tributaria: fiscal.cstPis }
                : {}),
              ...(fiscal.cstCofins
                ? { cofins_situacao_tributaria: fiscal.cstCofins }
                : {}),
              ...(fiscal.aliquotaPis !== null
                ? {
                    pis_aliquota_porcentual: fiscal.aliquotaPis.toFixed(4),
                    pis_base_calculo: base.toFixed(2),
                    pis_valor: tributo(fiscal.aliquotaPis),
                  }
                : {}),
              ...(fiscal.aliquotaCofins !== null
                ? {
                    cofins_aliquota_porcentual:
                      fiscal.aliquotaCofins.toFixed(4),
                    cofins_base_calculo: base.toFixed(2),
                    cofins_valor: tributo(fiscal.aliquotaCofins),
                  }
                : {}),
              ...(fiscal.cstIbsCbs && fiscal.classificacaoIbsCbs
                ? {
                    ibs_cbs_situacao_tributaria: fiscal.cstIbsCbs,
                    ibs_cbs_classificacao_tributaria:
                      fiscal.classificacaoIbsCbs,
                  }
                : {}),
              ...(fiscal.aliquotaIbs !== null &&
              fiscal.aliquotaCbs !== null &&
              fiscal.aliquotaIbsMunicipal !== null
                ? {
                    ibs_cbs_base_calculo: base.toFixed(2),
                    ibs_uf_aliquota: fiscal.aliquotaIbs.toFixed(4),
                    ibs_uf_valor: tributo(fiscal.aliquotaIbs),
                    ibs_mun_aliquota: fiscal.aliquotaIbsMunicipal.toFixed(4),
                    ibs_mun_valor: tributo(fiscal.aliquotaIbsMunicipal),
                    ibs_valor_total: new Dinheiro(tributo(fiscal.aliquotaIbs))
                      .plus(tributo(fiscal.aliquotaIbsMunicipal))
                      .toFixed(2),
                    cbs_aliquota: fiscal.aliquotaCbs.toFixed(4),
                    cbs_valor: tributo(fiscal.aliquotaCbs),
                  }
                : {}),
              ...(fiscal.aliquotaIcms !== null
                ? {
                    icms_aliquota: fiscal.aliquotaIcms.toFixed(4),
                    icms_base_calculo: base.toFixed(2),
                    icms_valor: tributo(fiscal.aliquotaIcms),
                  }
                : {}),
            };
          });
          payload = {
            natureza_operacao: "Venda de mercadorias",
            data_emissao: new Date().toISOString(),
            tipo_documento: "1",
            finalidade_emissao: "1",
            consumidor_final: "1",
            presenca_comprador: pedido ? "2" : "1",
            cnpj_emitente: empresa.cnpj,
            nome_emitente: config.razaoSocial,
            inscricao_estadual_emitente: config.inscricaoEstadual,
            regime_tributario_emitente:
              config.regimeTributario === "SIMPLES" ? "1" : "3",
            logradouro_emitente: endereco.data.logradouro,
            numero_emitente: endereco.data.numero,
            bairro_emitente: endereco.data.bairro,
            municipio_emitente: endereco.data.cidade,
            uf_emitente: endereco.data.uf,
            cep_emitente: endereco.data.cep,
            modalidade_frete: pedido ? "0" : "9",
            valor_produtos: venda.subtotal.toFixed(2),
            valor_desconto: venda.desconto.toFixed(2),
            valor_frete: venda.frete.toFixed(2),
            valor_total: venda.total.toFixed(2),
            serie: input.modelo === "NFCE" ? config.serieNfce : config.serieNfe,
            items: itens,
            ...(venda.cliente?.cpfCnpj
              ? {
                  nome_destinatario: venda.cliente.nome,
                  [venda.cliente.cpfCnpj.length === 11
                    ? "cpf_destinatario"
                    : "cnpj_destinatario"]: venda.cliente.cpfCnpj,
                }
              : {}),
            ...(destino.success
              ? {
                  logradouro_destinatario: destino.data.logradouro,
                  numero_destinatario: destino.data.numero,
                  bairro_destinatario: destino.data.bairro,
                  municipio_destinatario: destino.data.cidade,
                  uf_destinatario: destino.data.uf,
                  cep_destinatario: destino.data.cep,
                  indicador_destinatario:
                    destino.data.uf === endereco.data.uf ? "1" : "2",
                }
              : {}),
          };
        }
        const nota = await tx.notaEmitida.create({
          data: {
            empresaId: user.empresaId,
            modelo: input.modelo,
            vendaId: input.vendaId,
            voucherId: input.voucherId,
            payload,
          },
        });
        await tx.integracaoJob.create({
          data: {
            empresaId: user.empresaId,
            tipo: "FOCUS_EMITIR",
            referencia: nota.id,
            payload: { notaId: nota.id },
          },
        });
        await this.comercial.auditar(
          tx,
          user,
          "NotaEmitida",
          nota.id,
          "SOLICITAR_EMISSAO",
          { modelo: input.modelo, ambiente: config.ambienteFiscal },
        );
        return nota.id;
      },
      (tx, id) =>
        tx.notaEmitida.findFirstOrThrow({
          where: { empresaId: user.empresaId, id },
          select: { id: true, status: true, modelo: true },
        }),
    );
  }
  /** NFS-e Nacional: dados da DPS guardados na nota; conferidos aqui para o erro de cadastro aparecer na hora. */
  private async payloadNfseNacional(
    tx: Prisma.TransactionClient,
    empresaId: string,
    cnpj: string,
    config: { inscricaoMunicipal: string | null; regimeTributario: string | null; telefone: string | null; email: string | null; ambienteFiscal: string },
    codigoIbge: string,
    voucher: { valor: Prisma.Decimal; servicoNome: string } | null,
    cliente: { cpfCnpj: string | null; nome: string; email: string | null } | null,
    input: EmitirNotaInput,
  ): Promise<Prisma.InputJsonObject> {
    if (!voucher || !cliente?.cpfCnpj || !/^\d{2}\.\d{2}\.\d{2}$/.test(input.codigoListaServico ?? "") || !input.codigoNbs)
      throw new BadRequestException(
        "Confira voucher, documento do cliente, código de tributação nacional (00.00.00) e código NBS.",
      );
    // Numeração própria da DPS do sistema (série 1); notas recusadas também consomem número (lacunas são permitidas).
    const anteriores = await tx.notaEmitida.count({
      where: { empresaId, modelo: "NFSE", payload: { path: ["provedor"], equals: "NFSE_NACIONAL" } },
    });
    const percentual = input.aliquotaIss ? Number(input.aliquotaIss).toFixed(2) : null;
    const dados: Omit<DadosDps, "ambiente" | "numero"> & { numero: { serie: string; numero: number } } = {
      prestador: {
        cnpj,
        inscricaoMunicipal: config.inscricaoMunicipal,
        codigoMunicipio: codigoIbge,
        // ME/EPP do Simples (o ISS vai no DAS); fora do Simples, não optante.
        opcaoSimples: config.regimeTributario === "SIMPLES" ? 3 : 1,
        regimeApuracaoSimples: 1,
        telefone: config.telefone,
        email: config.email,
      },
      numero: { serie: "1", numero: anteriores + 1 },
      tomador: { documento: cliente.cpfCnpj, nome: cliente.nome, email: cliente.email },
      servico: {
        codigoMunicipioPrestacao: codigoIbge,
        codigoTributacaoNacional: input.codigoListaServico!.replace(/\D/g, ""),
        codigoNbs: input.codigoNbs.replace(/\D/g, ""),
        descricao: voucher.servicoNome,
      },
      valores: { valorServico: voucher.valor.toFixed(2), percentualTributosMunicipais: percentual },
    };
    try {
      const agora = new Date();
      montarDps({ ...dados, ambiente: config.ambienteFiscal, numero: { ...dados.numero, emitidaEm: agora } }, agora);
    } catch (error) {
      throw new BadRequestException(error instanceof IntegrationError ? error.provider : "Dados da NFS-e inválidos.");
    }
    return { provedor: "NFSE_NACIONAL", ...dados } as unknown as Prisma.InputJsonObject;
  }
  async acaoNota(
    user: Identity,
    id: string,
    tipo: string,
    input: { chaveOperacao: string; motivo?: string; correcao?: string },
  ) {
    const nota = await this.db.client.notaEmitida.findFirst({
      where: { empresaId: user.empresaId, id },
    });
    if (!nota) throw new NotFoundException("Nota emitida não encontrada.");
    if (
      ["FOCUS_CANCELAR", "FOCUS_CORRIGIR"].includes(tipo) &&
      nota.status !== "AUTORIZADA"
    )
      throw new ConflictException(
        "A nota deve estar autorizada para esta ação.",
      );
    if (tipo === "FOCUS_CORRIGIR" && nota.modelo !== "NFE")
      throw new BadRequestException("Carta de correção disponível para NF-e.");
    return this.agendar(
      user,
      tipo,
      id,
      {
        notaId: id,
        ...(input.motivo ? { motivo: input.motivo } : {}),
        ...(input.correcao ? { correcao: input.correcao } : {}),
      },
      input,
    );
  }
  async xml(empresaId: string, id: string) {
    const nota = await this.db.client.notaEmitida.findFirst({
      where: { empresaId, id },
      select: { xml: true },
    });
    if (!nota?.xml) throw new NotFoundException("XML ainda indisponível.");
    return nota.xml;
  }
  /** DANFSe (PDF) gerado pelo sistema a partir do XML da NFS-e Nacional autorizada. */
  async danfse(empresaId: string, id: string) {
    const nota = await this.db.client.notaEmitida.findFirst({
      where: { empresaId, id, modelo: "NFSE" },
      select: { xml: true, payload: true },
    });
    if (!nota?.xml || (nota.payload as { provedor?: unknown } | null)?.provedor !== "NFSE_NACIONAL")
      throw new NotFoundException("PDF disponível só para NFS-e Nacional autorizada.");
    return Buffer.from(await gerarDanfse(nota.xml));
  }
  jobs(empresaId: string) {
    return this.db.client.integracaoJob.findMany({
      where: { empresaId },
      select: {
        id: true,
        tipo: true,
        status: true,
        tentativas: true,
        erro: true,
        referencia: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }
  repetir(user: Identity, id: string, input: { chaveOperacao: string }) {
    return this.comercial.executar(
      user,
      "REPETIR_INTEGRACAO:" + id,
      input,
      async (tx) => {
        const job = await tx.integracaoJob.findFirst({
          where: { empresaId: user.empresaId, id, status: "ERRO" },
        });
        if (!job)
          throw new ConflictException(
            "A operação deve estar com erro para ser reenviada.",
          );
        await tx.integracaoJob.update({
          where: { id },
          data: {
            status: "PENDENTE",
            tentativas: 0,
            erro: null,
            proximaEm: new Date(),
            bloqueadoAte: null,
            bloqueioToken: null,
          },
        });
        await this.comercial.auditar(tx, user, "IntegracaoJob", id, "REPETIR", {
          tipo: job.tipo,
        });
        return id;
      },
      (tx, result) =>
        tx.integracaoJob.findFirstOrThrow({
          where: { empresaId: user.empresaId, id: result },
          select: { id: true, status: true },
        }),
    );
  }
  async opcoes(empresaId: string) {
    const [vendas, vouchers] = await Promise.all([
      this.db.client.venda.findMany({
        where: { empresaId, status: "CONFIRMADA" },
        select: { id: true, numero: true, clienteNome: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      this.db.client.voucher.findMany({
        where: { empresaId, status: { not: "CANCELADO" } },
        select: { id: true, codigo: true, servicoNome: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    ]);
    return { vendas, vouchers };
  }
  async exportar(empresaId: string, mes: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes))
      throw new BadRequestException("Informe o mês no formato AAAA-MM.");
    const inicio = new Date(mes + "-01T00:00:00Z"),
      fim = new Date(inicio);
    fim.setUTCMonth(fim.getUTCMonth() + 1);
    const files: { nome: string; xml: string }[] = [];
    let size = 0,
      cursor: string | undefined;
    while (true) {
      const notas = await this.db.client.notaEmitida.findMany({
        where: {
          empresaId,
          createdAt: { gte: inicio, lt: fim },
          xml: { not: null },
        },
        select: { id: true, xml: true },
        orderBy: { id: "asc" },
        take: 20,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const nota of notas) {
        size += Buffer.byteLength(nota.xml!);
        if (size > 50_000_000 || files.length >= 5000)
          throw new BadRequestException(
            "O arquivo do mês excede o limite de exportação de 50 MB ou 5.000 notas.",
          );
        files.push({ nome: nota.id + ".xml", xml: nota.xml! });
      }
      if (notas.length < 20) break;
      cursor = notas.at(-1)!.id;
    }
    if (!files.length)
      throw new NotFoundException("Não há XMLs disponíveis neste mês.");
    return xmlZip(files);
  }
}
