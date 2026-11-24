// Notas recebidas direto na SEFAZ (gratuito): sincronizar pela Distribuição DF-e e manifestar.
// Usa as mesmas rotinas (FOCUS_SINCRONIZAR e FOCUS_MANIFESTAR) quando a integração "sefaz" está ligada.
import { Prisma, type PrismaClient } from "@sistema/db";
import { IntegrationError } from "./http";
import {
  carregarCertificadoA1,
  distribuicaoDFe,
  enviarSoap,
  lerResumoNfe,
  manifestarDestinatario,
  MANIFESTACOES,
  type CertificadoA1,
  type EnvioSoap,
  type TipoManifestacao,
} from "./sefaz";
import { lerNfe } from "./xml";

type Job = Prisma.IntegracaoJobGetPayload<{}>;
type Config = Prisma.ConfiguracaoEmpresaGetPayload<{}>;
export type DependenciasSefaz = { certificado?: () => CertificadoA1; envio?: EnvioSoap; agora?: () => Date };

/** Lotes por rodada: cada consulta traz até 50 documentos; o resto fica para a rotina seguinte. */
const CONSULTAS_POR_RODADA = 10;

function ufDaEmpresa(config: Config) {
  const uf = (config.endereco as { uf?: unknown } | null)?.uf;
  if (typeof uf !== "string") throw new IntegrationError("SEFAZ (UF no endereço da empresa)", 422, false);
  return uf;
}

async function guardarDocumento(db: PrismaClient, empresaId: string, nsu: bigint, schema: string, xml: string) {
  if (schema.startsWith("resNFe")) {
    const resumo = lerResumoNfe(xml);
    if (!/^\d{11,14}$/.test(resumo.fornecedorDocumento) || !resumo.emitidaEm || !resumo.valorTotal) return;
    const where = { empresaId, chave: resumo.chave };
    const dados = { origem: "SEFAZ", nsu: nsu.toString(), ...resumo } as Prisma.InputJsonObject;
    await db.notaRecebida.upsert({
      where: { empresaId_chave: where },
      create: {
        ...where,
        numero: resumo.numero,
        fornecedorNome: resumo.fornecedorNome,
        fornecedorDocumento: resumo.fornecedorDocumento,
        emitidaEm: new Date(resumo.emitidaEm + "T00:00:00Z"),
        valorTotal: resumo.valorTotal,
        dados,
      },
      // Nota já com XML completo não volta a ser resumo.
      update: {},
    });
    return;
  }
  if (schema.startsWith("procNFe")) {
    const nota = lerNfe(xml);
    const where = { empresaId, chave: nota.chave };
    await db.notaRecebida.upsert({
      where: { empresaId_chave: where },
      create: {
        ...where,
        numero: nota.numero,
        fornecedorNome: nota.fornecedorNome,
        fornecedorDocumento: nota.fornecedorDocumento,
        emitidaEm: new Date(nota.emitidaEm + "T00:00:00Z"),
        valorTotal: nota.valorTotal,
        xml,
        status: "CIENCIA",
        dados: nota as unknown as Prisma.InputJsonObject,
      },
      update: { xml, dados: nota as unknown as Prisma.InputJsonObject },
    });
  }
  // Eventos (resEvento, procEventoNFe) não mudam a lista de notas recebidas.
}

/** Busca as notas novas a partir do último NSU; guarda o NSU a cada lote para não reler. */
export async function sincronizarSefaz(db: PrismaClient, job: Job, config: Config, dep: DependenciasSefaz = {}) {
  const empresa = await db.empresa.findUniqueOrThrow({ where: { id: job.empresaId } });
  if (!empresa.cnpj) throw new IntegrationError("SEFAZ (CNPJ da empresa)", 422, false);
  const certificado = (dep.certificado ?? carregarCertificadoA1)();
  const uf = ufDaEmpresa(config);
  let ultNSU = config.ultimoNsuDfe;
  for (let consulta = 0; consulta < CONSULTAS_POR_RODADA; consulta++) {
    const r = await distribuicaoDFe(
      { ambiente: config.ambienteFiscal, cnpj: empresa.cnpj, uf, certificado, ultNSU },
      dep.envio ?? enviarSoap,
    );
    // 656 (consumo indevido): a SEFAZ bloqueia por cerca de 1 h; a rotina periódica tenta depois.
    if (r.cStat === "656") throw new IntegrationError("SEFAZ (consulta bloqueada por 1 hora: consumo indevido)", 429, false);
    if (r.cStat !== "137" && r.cStat !== "138") throw new IntegrationError(`SEFAZ (${r.cStat} ${r.motivo})`, 422, false);
    for (const doc of r.documentos) await guardarDocumento(db, job.empresaId, doc.nsu, doc.schema, doc.xml);
    if (r.ultNSU > ultNSU) {
      ultNSU = r.ultNSU;
      await db.configuracaoEmpresa.update({ where: { empresaId: job.empresaId }, data: { ultimoNsuDfe: ultNSU } });
    }
    // 137 = nada novo; ou já alcançou o último disponível.
    if (r.cStat === "137" || r.ultNSU >= r.maxNSU) return;
  }
  // Ainda há documentos: continua numa nova rotina (não prende o processador).
  await db.integracaoJob.createMany({
    data: [{ empresaId: job.empresaId, tipo: "FOCUS_SINCRONIZAR", referencia: job.id, payload: {} }],
    skipDuplicates: true,
  });
}

/** Manifesta; na ciência, baixa o XML completo pela chave (pode levar alguns minutos para ficar disponível). */
export async function manifestarSefaz(
  db: PrismaClient,
  job: Job,
  config: Config,
  payload: { chave?: unknown; tipo?: unknown; justificativa?: unknown },
  dep: DependenciasSefaz = {},
) {
  const chave = String(payload.chave ?? "");
  const tipo = String(payload.tipo ?? "") as TipoManifestacao;
  if (!/^\d{44}$/.test(chave) || !(tipo in MANIFESTACOES)) throw new IntegrationError("SEFAZ (manifestação)", 422, false);
  const empresa = await db.empresa.findUniqueOrThrow({ where: { id: job.empresaId } });
  if (!empresa.cnpj) throw new IntegrationError("SEFAZ (CNPJ da empresa)", 422, false);
  const certificado = (dep.certificado ?? carregarCertificadoA1)();
  const envio = dep.envio ?? enviarSoap;
  const nota = await db.notaRecebida.findFirst({ where: { empresaId: job.empresaId, chave } });
  // Repetição da rotina depois de a manifestação já ter sido aceita: só falta o XML.
  const jaManifestada = tipo === "ciencia" && nota?.status === "CIENCIA";
  if (!jaManifestada) {
    const r = await manifestarDestinatario(
      {
        ambiente: config.ambienteFiscal,
        cnpj: empresa.cnpj,
        chave,
        tipo,
        justificativa: typeof payload.justificativa === "string" ? payload.justificativa : undefined,
        agora: (dep.agora ?? (() => new Date()))(),
        certificado,
      },
      envio,
    );
    if (!r.registrada) throw new IntegrationError(`SEFAZ (${r.cStat} ${r.motivo})`, 422, false);
  }
  if (tipo !== "ciencia") return;
  await db.notaRecebida.updateMany({ where: { empresaId: job.empresaId, chave, compraId: null }, data: { status: "CIENCIA" } });
  if (nota?.xml) return;
  const r = await distribuicaoDFe({ ambiente: config.ambienteFiscal, cnpj: empresa.cnpj, uf: ufDaEmpresa(config), certificado, chave }, envio);
  const completo = r.documentos.find((d) => d.schema.startsWith("procNFe"));
  // Ainda não disponível: erro temporário, a rotina tenta de novo com espera crescente.
  if (!completo) throw new IntegrationError("SEFAZ (XML completo ainda não disponível)", 404, true);
  const lida = lerNfe(completo.xml);
  await db.notaRecebida.updateMany({
    where: { empresaId: job.empresaId, chave: lida.chave, compraId: null },
    data: { xml: completo.xml, status: "CIENCIA", dados: lida as unknown as Prisma.InputJsonObject },
  });
}
