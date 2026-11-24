// Conexão direta e gratuita com os serviços nacionais da NF-e (sem intermediário pago):
// Distribuição DF-e (notas emitidas contra o CNPJ) e Manifestação do Destinatário.
// Referências: NT 2014.002 (NFeDistribuicaoDFe) e NT 2012.002 (eventos de manifestação).
import { readFileSync } from "node:fs";
import { request } from "node:https";
import { gunzipSync } from "node:zlib";
import forge from "node-forge";
import { SignedXml } from "xml-crypto";
import { XMLParser } from "fast-xml-parser";
import { IntegrationError } from "./http";

export type CertificadoA1 = {
  pfx: Buffer;
  senha: string;
  chavePem: string;
  certificadoPem: string;
  validoAte: Date;
};

/** Lê o .pfx (A1). Senha errada ou arquivo sem chave: erro sem expor detalhes do certificado. */
export function lerCertificadoA1(pfx: Buffer, senha: string): CertificadoA1 {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(pfx.toString("binary")), false, senha);
  } catch {
    throw new IntegrationError("Certificado A1 (arquivo ou senha inválidos)", 401, false);
  }
  const oids = forge.pki.oids;
  const chave = [
    ...(p12.getBags({ bagType: oids.pkcs8ShroudedKeyBag })[oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: oids.keyBag })[oids.keyBag] ?? []),
  ][0]?.key as forge.pki.rsa.PrivateKey | undefined;
  if (!chave) throw new IntegrationError("Certificado A1 (sem chave privada)", 422, false);
  // O certificado do titular é o que tem a mesma chave pública (o .pfx pode trazer a cadeia junto).
  const certificados = (p12.getBags({ bagType: oids.certBag })[oids.certBag] ?? [])
    .map((bag) => bag.cert)
    .filter((c): c is forge.pki.Certificate => !!c);
  const titular = certificados.find((c) => (c.publicKey as forge.pki.rsa.PublicKey).n.equals(chave.n));
  if (!titular) throw new IntegrationError("Certificado A1 (sem certificado do titular)", 422, false);
  return {
    pfx,
    senha,
    chavePem: forge.pki.privateKeyToPem(chave),
    certificadoPem: forge.pki.certificateToPem(titular),
    validoAte: titular.validity.notAfter,
  };
}

/** Certificado da instalação: caminho do .pfx e da senha vêm do ambiente, nunca do código. */
export function carregarCertificadoA1(): CertificadoA1 {
  const arquivo = process.env.CERTIFICADO_A1_ARQUIVO;
  const arquivoSenha = process.env.CERTIFICADO_A1_SENHA_ARQUIVO;
  if (!arquivo || !arquivoSenha) throw new IntegrationError("CERTIFICADO_A1_ARQUIVO", 503, false);
  let pfx: Buffer, senha: string;
  try {
    pfx = readFileSync(arquivo);
    senha = readFileSync(arquivoSenha, "utf8").replace(/\r?\n$/, "");
  } catch {
    throw new IntegrationError("Certificado A1 (arquivo não encontrado)", 503, false);
  }
  const certificado = lerCertificadoA1(pfx, senha);
  if (certificado.validoAte.getTime() < Date.now()) throw new IntegrationError("Certificado A1 (vencido)", 422, false);
  return certificado;
}

export type EnvioSoap = (url: string, acao: string, envelope: string, certificado: CertificadoA1) => Promise<string>;

/** SOAP 1.2 com o certificado do cliente (TLS mútuo), resposta limitada a 10 MB. */
export const enviarSoap: EnvioSoap = (url, acao, envelope, certificado) =>
  new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "POST",
        pfx: certificado.pfx,
        passphrase: certificado.senha,
        timeout: 30000,
        headers: { "Content-Type": `application/soap+xml; charset=utf-8; action="${acao}"` },
      },
      (res) => {
        const partes: Buffer[] = [];
        let tamanho = 0;
        res.on("data", (parte: Buffer) => {
          tamanho += parte.length;
          if (tamanho > 10_000_000) {
            req.destroy();
            reject(new IntegrationError("SEFAZ", 413, false));
          } else partes.push(parte);
        });
        res.on("end", () => {
          const corpo = Buffer.concat(partes).toString("utf8");
          if ((res.statusCode ?? 500) >= 500) reject(new IntegrationError("SEFAZ", res.statusCode ?? 500, true));
          else resolve(corpo);
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", () => reject(new IntegrationError("SEFAZ", 503, true)));
    req.end(envelope);
  });

export type AmbienteFiscal = "producao" | "homologacao" | string;
const producao = (ambiente: AmbienteFiscal) => ambiente === "producao";
const URL_DISTRIBUICAO = {
  producao: "https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx",
  homologacao: "https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx",
};
const WSDL_DISTRIBUICAO = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe";

/** Código IBGE das UFs (cUFAutor da distribuição). */
export const CODIGO_UF: Record<string, number> = {
  RO: 11, AC: 12, AM: 13, RR: 14, PA: 15, AP: 16, TO: 17, MA: 21, PI: 22, CE: 23, RN: 24, PB: 25, PE: 26, AL: 27,
  SE: 28, BA: 29, MG: 31, ES: 32, RJ: 33, SP: 35, PR: 41, SC: 42, RS: 43, MS: 50, MT: 51, GO: 52, DF: 53,
};

export type DocumentoDistribuido = { nsu: bigint; schema: string; xml: string };
export type RetornoDistribuicao = {
  cStat: string;
  motivo: string;
  ultNSU: bigint;
  maxNSU: bigint;
  documentos: DocumentoDistribuido[];
};

const leitor = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false });
function filho(objeto: unknown, ...caminho: string[]): Record<string, unknown> {
  let atual = objeto;
  for (const passo of caminho) {
    if (!atual || typeof atual !== "object") throw new IntegrationError("SEFAZ (resposta inesperada)", 502, true);
    atual = (atual as Record<string, unknown>)[passo];
  }
  if (!atual || typeof atual !== "object") throw new IntegrationError("SEFAZ (resposta inesperada)", 502, true);
  return atual as Record<string, unknown>;
}
/** Procura um elemento pelo nome em qualquer nível (o embrulho SOAP varia entre versões do serviço). */
function procurar(objeto: unknown, nome: string): Record<string, unknown> {
  const fila: unknown[] = [objeto];
  while (fila.length) {
    const atual = fila.shift();
    if (!atual || typeof atual !== "object") continue;
    const registro = atual as Record<string, unknown>;
    const achado = registro[nome];
    if (achado && typeof achado === "object" && !Array.isArray(achado)) return achado as Record<string, unknown>;
    fila.push(...Object.values(registro));
  }
  throw new IntegrationError("SEFAZ (resposta inesperada)", 502, true);
}
const texto = (valor: unknown) => (typeof valor === "string" ? valor : "");
const lista = (valor: unknown): unknown[] => (valor === undefined ? [] : Array.isArray(valor) ? valor : [valor]);
const somenteDigitos = (valor: string) => valor.replace(/\D/g, "");

/**
 * Pede à SEFAZ os documentos do CNPJ a partir do último NSU lido (ou um documento pela chave).
 * cStat 137 = nada novo (esperar ~1 h antes de perguntar de novo); 138 = documentos;
 * 656 = consumo indevido (bloqueio temporário por consultas seguidas).
 */
export async function distribuicaoDFe(
  opcoes: { ambiente: AmbienteFiscal; cnpj: string; uf: string; certificado: CertificadoA1; ultNSU?: bigint; chave?: string },
  envio: EnvioSoap = enviarSoap,
): Promise<RetornoDistribuicao> {
  const cnpj = somenteDigitos(opcoes.cnpj);
  const cUF = CODIGO_UF[opcoes.uf.toUpperCase()];
  if (cnpj.length !== 14 || !cUF) throw new IntegrationError("SEFAZ (CNPJ ou UF da empresa)", 422, false);
  if (opcoes.chave !== undefined && !/^\d{44}$/.test(opcoes.chave)) throw new IntegrationError("SEFAZ (chave)", 422, false);
  const consulta = opcoes.chave
    ? `<consChNFe><chNFe>${opcoes.chave}</chNFe></consChNFe>`
    : `<distNSU><ultNSU>${(opcoes.ultNSU ?? 0n).toString().padStart(15, "0")}</ultNSU></distNSU>`;
  const pedido =
    `<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>${producao(opcoes.ambiente) ? 1 : 2}</tpAmb>` +
    `<cUFAutor>${cUF}</cUFAutor><CNPJ>${cnpj}</CNPJ>${consulta}</distDFeInt>`;
  const envelope =
    `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body>` +
    `<nfeDistDFeInteresse xmlns="${WSDL_DISTRIBUICAO}"><nfeDadosMsg>${pedido}</nfeDadosMsg></nfeDistDFeInteresse></soap12:Body></soap12:Envelope>`;
  const url = producao(opcoes.ambiente) ? URL_DISTRIBUICAO.producao : URL_DISTRIBUICAO.homologacao;
  const resposta = await envio(url, `${WSDL_DISTRIBUICAO}/nfeDistDFeInteresse`, envelope, opcoes.certificado);
  const ret = procurar(leitor.parse(resposta), "retDistDFeInt");
  const cStat = texto(ret.cStat);
  const documentos = lista(ret.loteDistDFeInt ? (ret.loteDistDFeInt as Record<string, unknown>).docZip : undefined).map((item) => {
    const doc = item as Record<string, unknown>;
    return {
      nsu: BigInt(texto(doc["@_NSU"]) || "0"),
      schema: texto(doc["@_schema"]),
      xml: gunzipSync(Buffer.from(texto(doc["#text"]), "base64"), { maxOutputLength: 2_000_000 }).toString("utf8"),
    };
  });
  return {
    cStat,
    motivo: texto(ret.xMotivo),
    ultNSU: BigInt(texto(ret.ultNSU) || "0"),
    maxNSU: BigInt(texto(ret.maxNSU) || "0"),
    documentos,
  };
}

/** Resumo da NF-e (resNFe), que chega antes da ciência; o XML completo vem depois dela. */
export function lerResumoNfe(xml: string) {
  const res = filho(leitor.parse(xml), "resNFe");
  const chave = texto(res.chNFe);
  if (!/^\d{44}$/.test(chave)) throw new IntegrationError("SEFAZ (resumo sem chave)", 502, false);
  return {
    chave,
    numero: chave.slice(25, 34),
    fornecedorNome: texto(res.xNome),
    fornecedorDocumento: texto(res.CNPJ ?? res.CPF),
    emitidaEm: texto(res.dhEmi).slice(0, 10),
    valorTotal: texto(res.vNF),
    situacao: texto(res.cSitNFe), // 1 autorizada, 2 denegada, 3 cancelada
  };
}

const URL_EVENTO = {
  producao: "https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx",
  homologacao: "https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx",
};
const WSDL_EVENTO = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4";

/** Tipos de manifestação do destinatário (mesmos nomes usados pela Focus no sistema). */
export const MANIFESTACOES = {
  ciencia: { codigo: "210210", descricao: "Ciencia da Operacao" },
  confirmacao: { codigo: "210200", descricao: "Confirmacao da Operacao" },
  desconhecimento: { codigo: "210220", descricao: "Desconhecimento da Operacao" },
  nao_realizada: { codigo: "210240", descricao: "Operacao nao Realizada" },
} as const;
export type TipoManifestacao = keyof typeof MANIFESTACOES;

/** Data/hora no horário de Brasília (-03:00; o Brasil não tem horário de verão desde 2019). */
export function dataHoraEvento(agora: Date) {
  return new Date(agora.getTime() - 3 * 3600_000).toISOString().slice(0, 19) + "-03:00";
}
const escaparXml = (valor: string) =>
  valor.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** O evento assinado (XMLDSig envelopado, RSA-SHA1 e C14N, como o leiaute exige). */
export function montarEventoManifestacao(opcoes: {
  ambiente: AmbienteFiscal;
  cnpj: string;
  chave: string;
  tipo: TipoManifestacao;
  justificativa?: string;
  agora: Date;
  certificado: CertificadoA1;
}) {
  const evento = MANIFESTACOES[opcoes.tipo];
  const cnpj = somenteDigitos(opcoes.cnpj);
  if (!evento || cnpj.length !== 14 || !/^\d{44}$/.test(opcoes.chave)) throw new IntegrationError("SEFAZ (manifestação)", 422, false);
  const justificativa = (opcoes.justificativa ?? "").trim();
  if (opcoes.tipo === "nao_realizada" && (justificativa.length < 15 || justificativa.length > 255))
    throw new IntegrationError("SEFAZ (justificativa de 15 a 255 caracteres)", 422, false);
  const id = `ID${evento.codigo}${opcoes.chave}01`;
  const detalhe =
    `<detEvento versao="1.00"><descEvento>${evento.descricao}</descEvento>` +
    (opcoes.tipo === "nao_realizada" ? `<xJust>${escaparXml(justificativa)}</xJust>` : "") +
    `</detEvento>`;
  const xml =
    `<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><infEvento Id="${id}">` +
    `<cOrgao>91</cOrgao><tpAmb>${producao(opcoes.ambiente) ? 1 : 2}</tpAmb><CNPJ>${cnpj}</CNPJ><chNFe>${opcoes.chave}</chNFe>` +
    `<dhEvento>${dataHoraEvento(opcoes.agora)}</dhEvento><tpEvento>${evento.codigo}</tpEvento><nSeqEvento>1</nSeqEvento>` +
    `<verEvento>1.00</verEvento>${detalhe}</infEvento></evento>`;
  const assinatura = new SignedXml({
    privateKey: opcoes.certificado.chavePem,
    publicCert: opcoes.certificado.certificadoPem,
    signatureAlgorithm: "http://www.w3.org/2000/09/xmldsig#rsa-sha1",
    canonicalizationAlgorithm: "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
  });
  assinatura.addReference({
    xpath: "//*[local-name(.)='infEvento']",
    transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/TR/2001/REC-xml-c14n-20010315"],
    digestAlgorithm: "http://www.w3.org/2000/09/xmldsig#sha1",
  });
  assinatura.computeSignature(xml, { location: { reference: "//*[local-name(.)='infEvento']", action: "after" } });
  return { id, xml: assinatura.getSignedXml() };
}

/** Envia a manifestação. 135/136 = registrada; 573 = já registrada antes (tratado como sucesso). */
export async function manifestarDestinatario(
  opcoes: Parameters<typeof montarEventoManifestacao>[0],
  envio: EnvioSoap = enviarSoap,
) {
  const { xml } = montarEventoManifestacao(opcoes);
  const lote = String(opcoes.agora.getTime()).slice(-15);
  const envelope =
    `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body>` +
    `<nfeDadosMsg xmlns="${WSDL_EVENTO}"><envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><idLote>${lote}</idLote>${xml.replace(/^<\?xml[^>]*>/, "")}</envEvento></nfeDadosMsg>` +
    `</soap12:Body></soap12:Envelope>`;
  const url = producao(opcoes.ambiente) ? URL_EVENTO.producao : URL_EVENTO.homologacao;
  const resposta = await envio(url, `${WSDL_EVENTO}/nfeRecepcaoEvento`, envelope, opcoes.certificado);
  const ret = procurar(leitor.parse(resposta), "retEnvEvento");
  const lote_cStat = texto(ret.cStat);
  const info = lista(ret.retEvento).map((r) => filho(r, "infEvento"))[0];
  const cStat = info ? texto(info.cStat) : lote_cStat;
  return { cStat, motivo: info ? texto(info.xMotivo) : texto(ret.xMotivo), registrada: ["135", "136", "573"].includes(cStat) };
}
