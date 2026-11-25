// Rotinas do processador para NFS-e emitidas pelo Emissor Nacional (nota criada com payload.provedor = "NFSE_NACIONAL").
import { Prisma, type PrismaClient } from "@sistema/db";
import { IntegrationError } from "./http";
import { carregarCertificadoA1, type CertificadoA1 } from "./sefaz";
import { cancelarNfse, emitirNfse, enviarHttps, type DadosDps, type EnvioHttps } from "./nfse-nacional";

type Job = Prisma.IntegracaoJobGetPayload<{}>;
type Nota = Prisma.NotaEmitidaGetPayload<{}>;
export type DependenciasNfse = { certificado?: () => CertificadoA1; envio?: EnvioHttps; agora?: () => Date };

export const ehNfseNacional = (nota: Nota) => (nota.payload as { provedor?: unknown } | null)?.provedor === "NFSE_NACIONAL";
/** Endereço do PDF (DANFSe) gerado pelo próprio sistema a partir do XML. */
export const urlDanfseSistema = (notaId: string) => `/api/gestao/fiscal/emitidas/${notaId}/danfse`;

export async function processarNfseNacional(
  db: PrismaClient,
  job: Job,
  nota: Nota,
  ambiente: string,
  payload: { motivo?: unknown },
  dep: DependenciasNfse = {},
) {
  const certificado = (dep.certificado ?? carregarCertificadoA1)();
  const envio = dep.envio ?? enviarHttps;
  const agora = (dep.agora ?? (() => new Date()))();
  const retorno = (nota.retorno ?? {}) as Record<string, unknown>;
  if (job.tipo === "FOCUS_EMITIR") {
    // Repetição da rotina depois da autorização: nada a fazer (evita DPS em duplicidade).
    if (nota.status === "AUTORIZADA" || nota.status === "CANCELADA") return;
    const dados = nota.payload as unknown as Omit<DadosDps, "ambiente" | "numero"> & { numero: { serie: string; numero: number } };
    const r = await emitirNfse({ ...dados, ambiente, numero: { ...dados.numero, emitidaEm: agora } }, certificado, agora, envio);
    if (r.resultado.ok) {
      const { chave, numero, codigoVerificacao, processadaEm } = r.resultado;
      await db.notaEmitida.updateMany({
        where: { empresaId: job.empresaId, id: nota.id },
        data: {
          status: "AUTORIZADA",
          xml: r.resultado.xml,
          danfeUrl: urlDanfseSistema(nota.id),
          mensagem: `NFS-e nº ${numero ?? "-"} autorizada`,
          retorno: { provedor: "NFSE_NACIONAL", chave, numero, codigoVerificacao, processadaEm, idDps: r.idDps } as Prisma.InputJsonObject,
        },
      });
    } else {
      const mensagem = r.resultado.erros.map((e) => `${e.codigo} ${e.descricao}`).join(" | ").slice(0, 1000);
      await db.notaEmitida.updateMany({
        where: { empresaId: job.empresaId, id: nota.id },
        data: { status: "ERRO", mensagem, retorno: { provedor: "NFSE_NACIONAL", erros: r.resultado.erros, idDps: r.idDps } as Prisma.InputJsonObject },
      });
    }
    return;
  }
  if (job.tipo === "FOCUS_CANCELAR") {
    if (nota.status !== "AUTORIZADA" || typeof retorno.chave !== "string") throw new IntegrationError("NFS-e (só nota autorizada pode ser cancelada)", 409, false);
    const dados = nota.payload as unknown as { prestador: { cnpj: string } };
    const r = await cancelarNfse(
      { ambiente, cnpj: dados.prestador.cnpj, chave: retorno.chave, motivo: "erroEmissao", justificativa: String(payload.motivo ?? "").slice(0, 200), agora },
      certificado,
      envio,
    );
    if (!r.ok) {
      const mensagem = r.erros.map((e) => `${e.codigo} ${e.descricao}`).join(" | ").slice(0, 1000);
      await db.notaEmitida.updateMany({ where: { empresaId: job.empresaId, id: nota.id }, data: { mensagem: "Cancelamento recusado: " + mensagem } });
      throw new IntegrationError("NFS-e (cancelamento recusado)", 422, false);
    }
    await db.notaEmitida.updateMany({
      where: { empresaId: job.empresaId, id: nota.id },
      data: { status: "CANCELADA", mensagem: "NFS-e cancelada", retorno: { ...retorno, cancelamentoXml: r.xml } as Prisma.InputJsonObject },
    });
    return;
  }
  // Consulta e carta de correção não se aplicam: a autorização volta na hora e NFS-e não tem carta de correção.
  if (job.tipo === "FOCUS_CONSULTAR") return;
  throw new IntegrationError("NFS-e Nacional (operação não disponível)", 400, false);
}
