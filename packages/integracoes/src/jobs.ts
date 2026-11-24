import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@sistema/db";
import { FocusClient, type FocusResult } from "./focus";
import {
  GatewayClient,
  type GatewayName,
  type CheckoutInput,
} from "./pagamentos";
import { CorreiosClient } from "./correios";
import { IntegrationError, requestJson, secret } from "./http";
import { lerNfe } from "./xml";
import { manifestarSefaz, sincronizarSefaz } from "./fiscal-sefaz";

type Job = Prisma.IntegracaoJobGetPayload<{}>;
type Payload = { [key: string]: Prisma.JsonValue };
type DocumentStorage = {
  put(key: string, body: Buffer, mime: string): Promise<void>;
};

async function salvarNota(
  db: PrismaClient,
  empresaId: string,
  id: string,
  result: FocusResult,
  focus: FocusClient,
  storage?: DocumentStorage,
) {
  const status =
    result.status === "autorizado"
      ? "AUTORIZADA"
      : result.status === "cancelado"
        ? "CANCELADA"
        : result.status.includes("erro")
          ? "ERRO"
          : "PROCESSANDO";
  const xml = result.caminho_xml_nota_fiscal
    ? await focus.baixar(result.caminho_xml_nota_fiscal)
    : undefined;
  const danfe = result.caminho_danfe
    ? new URL(
        result.caminho_danfe,
        process.env.FOCUS_ARQUIVOS_ORIGIN ?? "https://api.focusnfe.com.br",
      ).toString()
    : undefined;
  await db.notaEmitida.updateMany({
    where: { empresaId, id },
    data: {
      status,
      retorno: result as unknown as Prisma.InputJsonObject,
      mensagem: result.mensagem_sefaz ?? result.mensagem ?? null,
      ...(xml ? { xml } : {}),
      ...(danfe ? { danfeUrl: danfe } : {}),
    },
  });
  if (xml && storage)
    await storage.put(
      "empresas/" + empresaId + "/fiscal/" + id + ".xml",
      Buffer.from(xml),
      "application/xml",
    );
  if (status === "AUTORIZADA") {
    const nota = await db.notaEmitida.findUniqueOrThrow({ where: { id } });
    const pedido = nota.vendaId
      ? await db.pedidoOnline.findFirst({
          where: { empresaId, vendaId: nota.vendaId },
        })
      : nota.voucherId
        ? await db.pedidoOnline.findFirst({
            where: {
              empresaId,
              itens: { array_contains: [{ voucherIds: [nota.voucherId] }] },
            },
          })
        : null;
    if (pedido) {
      const voucherIds = (pedido.itens as { voucherIds?: string[] }[]).flatMap(
        (item) => item.voucherIds ?? [],
      );
      const autorizadas = voucherIds.length
        ? await db.notaEmitida.findMany({
            where: {
              empresaId,
              voucherId: { in: voucherIds },
              status: "AUTORIZADA",
            },
            select: { voucherId: true },
          })
        : [];
      if (
        !voucherIds.length ||
        new Set(autorizadas.map((nota) => nota.voucherId)).size ===
          voucherIds.length
      )
        await db.pedidoOnline.updateMany({
          where: { id: pedido.id, status: "PAGO" },
          data: { status: "FATURADO" },
        });
      const cliente = await db.cliente.findFirst({
        where: { empresaId, id: pedido.clienteId },
      });
      if (
        xml &&
        pedido.notaPorEmail &&
        cliente?.email &&
        process.env.RESEND_API_KEY &&
        process.env.EMAIL_FROM
      )
        await db.integracaoJob.createMany({
          data: [
            {
              empresaId,
              tipo: "EMAIL",
              referencia: "nota-" + id,
              payload: {
                para: cliente.email,
                assunto: "Nota fiscal do pedido " + pedido.numero,
                texto:
                  "Sua nota fiscal está anexada. Acompanhe a entrega pela sua conta na loja.",
                anexos: [
                  {
                    filename: "nota.xml",
                    content: Buffer.from(xml).toString("base64"),
                  },
                ],
              },
            },
          ],
          skipDuplicates: true,
        });
    }
  }
}

export async function processarJob(
  db: PrismaClient,
  job: Job,
  storage?: DocumentStorage,
) {
  const payload = job.payload as Payload;
  const config = await db.configuracaoEmpresa.findUnique({
    where: { empresaId: job.empresaId },
  });
  if (job.tipo === "EMAIL") {
    await requestJson("E-mail", "https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + secret("RESEND_API_KEY"),
        "Idempotency-Key": job.id,
      },
      body: JSON.stringify({
        from: secret("EMAIL_FROM"),
        to: [String(payload.para)],
        subject: String(payload.assunto),
        text: String(payload.texto),
        ...(payload.anexos ? { attachments: payload.anexos } : {}),
      }),
    });
    return;
  }
  if (job.tipo === "PAGAMENTO_CRIAR") {
    const pedido = await db.pedidoOnline.findFirst({
      where: { empresaId: job.empresaId, id: job.referencia },
    });
    if (
      !pedido ||
      pedido.status !== "AGUARDANDO_PAGAMENTO" ||
      pedido.expiresAt <= new Date()
    )
      return;
    const cliente = await db.cliente.findFirstOrThrow({
      where: { empresaId: job.empresaId, id: pedido.clienteId },
    });
    if (!cliente.email || !cliente.cpfCnpj)
      throw new IntegrationError("Pagamento", 422, false);
    const result = await new GatewayClient(
      pedido.gateway as GatewayName,
    ).checkout({
      id: pedido.id,
      numero: pedido.numero,
      nome: cliente.nome,
      email: cliente.email,
      cpfCnpj: cliente.cpfCnpj,
      total: pedido.total.toFixed(2),
      expiresAt: pedido.expiresAt.toISOString(),
      retorno: new URL(
        "/pedido/" + pedido.id,
        process.env.LOJA_ORIGIN ?? "http://127.0.0.1:3000",
      ).toString(),
    } satisfies CheckoutInput);
    const url = new URL(result.url);
    if (url.protocol !== "https:")
      throw new IntegrationError("Pagamento", 502, false);
    await db.pedidoOnline.updateMany({
      where: { id: pedido.id, status: "AGUARDANDO_PAGAMENTO" },
      data: { gatewayId: result.id, checkoutUrl: result.url },
    });
    return;
  }
  if (job.tipo === "PAGAMENTO_REEMBOLSAR") {
    await new GatewayClient(String(payload.gateway) as GatewayName).reembolsar(
      String(payload.pagamentoId),
      job.id,
    );
    await db.pedidoOnline.updateMany({
      where: {
        empresaId: job.empresaId,
        id: String(payload.pedidoId),
        status: "REEMBOLSO_PENDENTE",
      },
      data: { status: "REEMBOLSO_SOLICITADO" },
    });
    return;
  }
  if (job.tipo === "CORREIOS_RASTREAR") {
    const pedido = await db.pedidoOnline.findFirst({
      where: {
        empresaId: job.empresaId,
        id: String(payload.pedidoId),
        rastreio: { not: null },
      },
    });
    if (!pedido?.rastreio) return;
    const result = await new CorreiosClient().rastrear(pedido.rastreio);
    const eventos = result.objetos[0]?.eventos ?? [];
    const entregue = eventos.some((evento) =>
      /objeto entregue ao destinatário/i.test(evento.descricao),
    );
    await db.pedidoOnline.update({
      where: { id: pedido.id },
      data: {
        eventos: eventos as unknown as Prisma.InputJsonArray,
        ...(entregue ? { status: "ENTREGUE" } : {}),
      },
    });
    return;
  }
  if (job.tipo === "CORREIOS_ETIQUETA") {
    const pedido = await db.pedidoOnline.findFirst({
      where: { empresaId: job.empresaId, id: String(payload.pedidoId) },
    });
    if (!pedido || !["PAGO", "FATURADO"].includes(pedido.status)) return;
    const correios = new CorreiosClient();
    let envio = pedido.envio as {
      prepostagemId?: string;
      recibo?: string;
    } | null;
    if (!envio?.prepostagemId) {
      const result = await correios.prepostar(payload.prepostagem);
      envio = { prepostagemId: result.id };
      await db.pedidoOnline.update({
        where: { id: pedido.id },
        data: { envio, rastreio: result.codigoObjeto },
      });
    }
    if (!envio.recibo) {
      const rotulo = await correios.rotulo(envio.prepostagemId!);
      envio = { ...envio, recibo: rotulo.idRecibo };
      await db.pedidoOnline.update({
        where: { id: pedido.id },
        data: { envio },
      });
    }
    if (!storage) throw new IntegrationError("Armazenamento", 503, false);
    const buffer = await correios.baixarRotulo(envio.recibo!);
    const key =
      "empresas/" + job.empresaId + "/pedidos/" + pedido.id + "/etiqueta.pdf";
    await storage.put(key, buffer, "application/pdf");
    await db.pedidoOnline.update({
      where: { id: pedido.id },
      data: { etiquetaUrl: key },
    });
    return;
  }
  // Notas recebidas direto na SEFAZ (gratuito), quando a integração "sefaz" está ligada.
  if (config && (config.integracoes as { sefaz?: boolean } | null)?.sefaz) {
    if (job.tipo === "FOCUS_SINCRONIZAR") return sincronizarSefaz(db, job, config);
    if (job.tipo === "FOCUS_MANIFESTAR") return manifestarSefaz(db, job, config, payload);
  }
  const focus = new FocusClient(config?.ambienteFiscal ?? "homologacao");
  if (job.tipo === "FOCUS_SINCRONIZAR") {
    const empresa = await db.empresa.findUniqueOrThrow({
      where: { id: job.empresaId },
    });
    if (!empresa.cnpj) throw new IntegrationError("Focus", 422, false);
    const ultima = await db.notaRecebida.aggregate({
      where: { empresaId: job.empresaId },
      _max: { versaoFocus: true },
    });
    const notas = await focus.recebidas(
      empresa.cnpj,
      (ultima._max.versaoFocus ?? 0n).toString(),
    );
    for (const nota of notas) {
      const chave = String(nota.chave_nfe);
      if (!/^\d{44}$/.test(chave)) continue;
      const where = { empresaId: job.empresaId, chave };
      await db.notaRecebida.upsert({
        where: { empresaId_chave: where },
        create: {
          ...where,
          numero: chave.slice(25, 34),
          fornecedorNome: String(nota.nome_emitente),
          fornecedorDocumento: String(nota.documento_emitente),
          emitidaEm: new Date(
            String(nota.data_emissao).slice(0, 10) + "T00:00:00Z",
          ),
          valorTotal: String(nota.valor_total),
          versaoFocus: BigInt(String(nota.versao)),
          dados: nota as Prisma.InputJsonObject,
        },
        update: {
          versaoFocus: BigInt(String(nota.versao)),
          dados: nota as Prisma.InputJsonObject,
        },
      });
    }
    if (notas.length === 100)
      await db.integracaoJob.createMany({
        data: [
          {
            empresaId: job.empresaId,
            tipo: "FOCUS_SINCRONIZAR",
            referencia: job.id,
            payload: {},
          },
        ],
        skipDuplicates: true,
      });
    return;
  }
  if (job.tipo === "FOCUS_MANIFESTAR") {
    const manifesto = await focus.manifestar(
      String(payload.chave),
      String(payload.tipo),
    );
    if (manifesto.status === "erro" && manifesto.status_sefaz !== "573")
      throw new IntegrationError("Focus", 422, false);
    if (payload.tipo === "ciencia") {
      const xml = await focus.baixar(
        "/v2/nfes_recebidas/" +
          encodeURIComponent(String(payload.chave)) +
          ".xml",
      );
      const nota = lerNfe(xml);
      await db.notaRecebida.updateMany({
        where: { empresaId: job.empresaId, chave: nota.chave, compraId: null },
        data: { xml, status: "CIENCIA", dados: nota },
      });
    }
    return;
  }
  const id = String(payload.notaId ?? job.referencia);
  const nota = await db.notaEmitida.findFirst({
    where: { empresaId: job.empresaId, id },
  });
  if (!nota) throw new IntegrationError("Focus", 404, false);
  let result: FocusResult;
  if (job.tipo === "FOCUS_EMITIR")
    result = await focus.emitir(nota.modelo, nota.id, nota.payload);
  else if (job.tipo === "FOCUS_CONSULTAR")
    result = await focus.consultar(nota.modelo, nota.id);
  else if (job.tipo === "FOCUS_CANCELAR")
    result = await focus.cancelar(nota.modelo, nota.id, String(payload.motivo));
  else if (job.tipo === "FOCUS_CORRIGIR") {
    await focus.corrigir(nota.id, String(payload.correcao));
    return;
  } else throw new IntegrationError("Fila", 400, false);
  await salvarNota(db, job.empresaId, nota.id, result, focus, storage);
}

export function startIntegrationWorker(
  db: PrismaClient,
  storage?: DocumentStorage,
) {
  let running = false,
    closing = false,
    lastSchedule = 0;
  async function agendar() {
    const configuracoes = await db.configuracaoEmpresa.findMany({
      include: { empresa: { select: { ativa: true } } },
    });
    for (const config of configuracoes) {
      if (!config.empresa.ativa) continue;
      const flags = config.integracoes as { focus?: boolean; sefaz?: boolean } | null;
      const jobs: Prisma.IntegracaoJobCreateManyInput[] = [];
      if (flags?.focus || flags?.sefaz)
        jobs.push({
          empresaId: config.empresaId,
          tipo: "FOCUS_SINCRONIZAR",
          referencia: "periodo-" + Math.floor(Date.now() / 7_200_000),
          payload: {},
        });
      const notas = flags?.focus
        ? await db.notaEmitida.findMany({
            where: {
              empresaId: config.empresaId,
              status: "PROCESSANDO",
              updatedAt: { lt: new Date(Date.now() - 600_000) },
            },
            take: 100,
          })
        : [];
      for (const nota of notas)
        jobs.push({
          empresaId: config.empresaId,
          tipo: "FOCUS_CONSULTAR",
          referencia: nota.id + "-" + Math.floor(Date.now() / 600_000),
          payload: { notaId: nota.id },
        });
      const pedidos = await db.pedidoOnline.findMany({
        where: {
          empresaId: config.empresaId,
          status: "ENVIADO",
          rastreio: { not: null },
        },
        take: 100,
      });
      for (const pedido of pedidos)
        jobs.push({
          empresaId: config.empresaId,
          tipo: "CORREIOS_RASTREAR",
          referencia: pedido.id + "-" + Math.floor(Date.now() / 14_400_000),
          payload: { pedidoId: pedido.id },
        });
      if (jobs.length)
        await db.integracaoJob.createMany({ data: jobs, skipDuplicates: true });
    }
    await db.pedidoOnline.updateMany({
      where: { status: "AGUARDANDO_PAGAMENTO", expiresAt: { lte: new Date() } },
      data: { status: "EXPIRADO" },
    });
    await db.reservaEstoque.deleteMany({
      where: { expiresAt: { lte: new Date() } },
    });
  }
  async function tick() {
    if (running || closing) return;
    running = true;
    try {
      if (Date.now() - lastSchedule > 60_000) {
        await agendar();
        lastSchedule = Date.now();
      }
      const token = randomUUID();
      const jobs = await db.$queryRaw<
        Job[]
      >`UPDATE "IntegracaoJob" SET status='PROCESSANDO', "bloqueioToken"=${token}, "bloqueadoAte"=NOW()+INTERVAL '2 minutes', tentativas=tentativas+1 WHERE id=(SELECT id FROM "IntegracaoJob" WHERE (status='PENDENTE' AND "proximaEm"<=NOW()) OR (status='PROCESSANDO' AND "bloqueadoAte"<NOW()) ORDER BY "proximaEm",id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`;
      const job = jobs[0];
      if (!job) return;
      const heartbeat = setInterval(() => {
        void db.integracaoJob
          .updateMany({
            where: { id: job.id, bloqueioToken: token },
            data: { bloqueadoAte: new Date(Date.now() + 120_000) },
          })
          .catch(() => undefined);
      }, 30_000);
      try {
        await processarJob(db, job, storage);
        await db.integracaoJob.updateMany({
          where: { id: job.id, bloqueioToken: token },
          data: {
            status: "CONCLUIDO",
            bloqueadoAte: null,
            bloqueioToken: null,
            erro: null,
            ...(job.tipo === "EMAIL" ? { payload: {} } : {}),
          },
        });
      } catch (error) {
        const retry =
          job.tentativas < 8 &&
          (!(error instanceof IntegrationError) || error.retryable);
        await db.integracaoJob.updateMany({
          where: { id: job.id, bloqueioToken: token },
          data: {
            status: retry ? "PENDENTE" : "ERRO",
            bloqueadoAte: null,
            bloqueioToken: null,
            proximaEm: new Date(
              Date.now() + Math.min(3_600_000, 5000 * 2 ** job.tentativas),
            ),
            erro:
              error instanceof IntegrationError
                ? error.message
                : "Não foi possível concluir a integração. Confira os dados e tente novamente.",
          },
        });
        if (!retry && job.tipo === "FOCUS_EMITIR")
          await db.notaEmitida.updateMany({
            where: {
              empresaId: job.empresaId,
              id: job.referencia,
              status: { in: ["PENDENTE", "PROCESSANDO"] },
            },
            data: {
              status:
                error instanceof IntegrationError && !error.retryable
                  ? "ERRO"
                  : "PROCESSANDO",
              mensagem:
                "A integração precisa de revisão. Consulte a fila de integrações e confira a nota no provedor.",
            },
          });
      } finally {
        clearInterval(heartbeat);
      }
    } catch {
      console.error("Não foi possível consultar a fila de integrações.");
    } finally {
      running = false;
    }
  }
  const timer = setInterval(() => {
    void tick();
  }, 2000);
  return {
    async close() {
      closing = true;
      clearInterval(timer);
      while (running) await new Promise((resolve) => setTimeout(resolve, 100));
    },
  };
}
