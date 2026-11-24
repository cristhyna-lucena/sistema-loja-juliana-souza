// NFS-e de padrão nacional, direto na SEFIN Nacional (Emissor Nacional, gratuito):
// monta a DPS, assina com o certificado A1 e envia (TLS mútuo, JSON com o XML em gzip+base64).
// Leiaute 1.01. A produção restrita (homologação) já usa a versão de 20/10/2026 da reforma
// tributária, com pequenas diferenças de ordem/campos (ver `leiauteNovo`).
import { request } from "node:https";
import { gunzipSync, gzipSync } from "node:zlib";
import { SignedXml } from "xml-crypto";
import { IntegrationError } from "./http";
import type { AmbienteFiscal, CertificadoA1 } from "./sefaz";

export const NFSE_NAMESPACE = "http://www.sped.fazenda.gov.br/nfse";
const URL_SEFIN = {
  producao: "https://sefin.nfse.gov.br/sefinnacional",
  homologacao: "https://sefin.producaorestrita.nfse.gov.br/SefinNacional",
};
const URL_ADN = {
  producao: "https://adn.nfse.gov.br",
  homologacao: "https://adn.producaorestrita.nfse.gov.br",
};
const producao = (ambiente: AmbienteFiscal) => ambiente === "producao";
export const urlSefin = (ambiente: AmbienteFiscal) => (producao(ambiente) ? URL_SEFIN.producao : URL_SEFIN.homologacao);
export const urlAdn = (ambiente: AmbienteFiscal) => (producao(ambiente) ? URL_ADN.producao : URL_ADN.homologacao);

export type DadosDps = {
  ambiente: AmbienteFiscal;
  /** Leiaute de 20/10/2026 (produção restrita). Padrão: homologação = novo; produção = 1.01 vigente. */
  leiauteNovo?: boolean;
  prestador: {
    cnpj: string;
    inscricaoMunicipal?: string | null;
    codigoMunicipio: string; // IBGE, 7 dígitos
    /** 1 não optante; 2 MEI; 3 ME/EPP do Simples Nacional. */
    opcaoSimples: 1 | 2 | 3;
    /** Só para ME/EPP: 1 tributos federais e municipal pelo Simples (padrão). */
    regimeApuracaoSimples?: 1 | 2 | 3;
    telefone?: string | null;
    email?: string | null;
  };
  numero: { serie: string; numero: number; emitidaEm: Date };
  tomador?: { documento: string; nome: string; email?: string | null } | null;
  servico: {
    codigoMunicipioPrestacao: string;
    /** Código de tributação nacional (6 dígitos, item + subitem + desdobro da LC 116). */
    codigoTributacaoNacional: string;
    codigoTributacaoMunicipal?: string | null;
    /** Nomenclatura Brasileira de Serviços (9 dígitos). */
    codigoNbs: string;
    descricao: string;
  };
  valores: {
    valorServico: string;
    /** pAliq: só quando a prefeitura não aplica a alíquota cadastrada (ex.: ISS retido). Em município conveniado, a SEFIN usa a dela. */
    aliquotaIss?: string | null;
    /** pTotTribMun (Lei 12.741, informativo): percentual aproximado dos tributos municipais. Padrão: a alíquota informada. */
    percentualTributosMunicipais?: string | null;
  };
};

const somenteDigitos = (v: string) => v.replace(/\D/g, "");
const escapar = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Texto livre: sem caracteres de controle, espaços normalizados e no tamanho máximo do campo. */
const textoLivre = (v: string, max: number) => escapar(v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/[ \t]+/g, " ").trim().slice(0, max));
const tag = (nome: string, valor: string) => `<${nome}>${valor}</${nome}>`;

/** Horário de Brasília (-03:00), 60 s antes de agora para não cair "no futuro" do relógio da SEFIN. */
export function horarioDps(agora: Date) {
  const local = new Date(agora.getTime() - 60_000 - 3 * 3600_000).toISOString();
  return { dhEmi: local.slice(0, 19) + "-03:00", dCompet: local.slice(0, 10) };
}

/** Id da DPS: "DPS" + município (7) + tipo de inscrição (2 = CNPJ) + CNPJ (14) + série (5) + número (15). */
export function idDps(codigoMunicipio: string, cnpj: string, serie: string, numero: number) {
  return `DPS${codigoMunicipio}2${somenteDigitos(cnpj)}${serie.padStart(5, "0")}${String(numero).padStart(15, "0")}`;
}

/** Confere o que a SEFIN rejeitaria por formato, antes de assinar e enviar. */
function conferir(d: DadosDps) {
  const erros: string[] = [];
  if (somenteDigitos(d.prestador.cnpj).length !== 14) erros.push("CNPJ do prestador");
  if (!/^\d{7}$/.test(d.prestador.codigoMunicipio)) erros.push("código IBGE do município do prestador");
  if (!/^\d{7}$/.test(d.servico.codigoMunicipioPrestacao)) erros.push("código IBGE do local da prestação");
  if (!/^\d{6}$/.test(d.servico.codigoTributacaoNacional)) erros.push("código de tributação nacional (6 dígitos)");
  if (!/^\d{9}$/.test(d.servico.codigoNbs)) erros.push("código NBS (9 dígitos)");
  if (!/^\d{1,5}$/.test(d.numero.serie) || !Number.isInteger(d.numero.numero) || d.numero.numero < 1) erros.push("série ou número da DPS");
  if (!/^\d{1,13}\.\d{2}$/.test(d.valores.valorServico) || Number(d.valores.valorServico) <= 0) erros.push("valor do serviço");
  if (d.valores.aliquotaIss && !/^\d{1,2}\.\d{2}$/.test(d.valores.aliquotaIss)) erros.push("alíquota do ISS (ex.: 2.00)");
  if (d.valores.percentualTributosMunicipais && !/^\d{1,2}\.\d{2}$/.test(d.valores.percentualTributosMunicipais)) erros.push("percentual de tributos (ex.: 2.00)");
  if (d.servico.descricao.trim().length < 1) erros.push("descrição do serviço");
  // E0625 (confirmado em produção, 24/11/2026): ME/EPP do Simples sem retenção não informa alíquota (o ISS vai no DAS).
  if (d.prestador.opcaoSimples === 3 && d.valores.aliquotaIss) erros.push("alíquota: ME/EPP do Simples sem retenção não informa alíquota (use o percentual de tributos)");
  const doc = d.tomador ? somenteDigitos(d.tomador.documento) : "";
  if (d.tomador && doc.length !== 11 && doc.length !== 14) erros.push("CPF ou CNPJ do tomador");
  if (erros.length) throw new IntegrationError("NFS-e (" + erros.join(", ") + ")", 422, false);
}

/** XML da DPS sem assinatura. */
export function montarDps(d: DadosDps, agora: Date): { id: string; xml: string } {
  conferir(d);
  const novo = d.leiauteNovo ?? !producao(d.ambiente);
  const { dhEmi, dCompet } = horarioDps(agora);
  const cnpj = somenteDigitos(d.prestador.cnpj);
  const id = idDps(d.prestador.codigoMunicipio, cnpj, d.numero.serie, d.numero.numero);
  const p = d.prestador;
  const cabecalho =
    tag("tpAmb", producao(d.ambiente) ? "1" : "2") + tag("dhEmi", dhEmi) + tag("verAplic", "sistema-loja-1.0") +
    tag("serie", d.numero.serie) + tag("nDPS", String(d.numero.numero)) + tag("dCompet", dCompet) + tag("tpEmit", "1") +
    (novo ? tag("finNFSe", "0") : "") + tag("cLocEmi", p.codigoMunicipio);
  const regTrib =
    tag("opSimpNac", String(p.opcaoSimples)) +
    (p.opcaoSimples === 3 ? tag("regApTribSN", String(p.regimeApuracaoSimples ?? 1)) : "") +
    tag("regEspTrib", "0");
  const fone = p.telefone ? somenteDigitos(p.telefone) : "";
  const prest =
    tag("CNPJ", cnpj) + (p.inscricaoMunicipal ? tag("IM", textoLivre(p.inscricaoMunicipal, 15)) : "") +
    (fone ? tag("fone", fone) : "") + (p.email ? tag("email", textoLivre(p.email, 80)) : "") + tag("regTrib", regTrib);
  let toma = "";
  if (d.tomador) {
    const doc = somenteDigitos(d.tomador.documento);
    toma = tag("toma", tag(doc.length === 11 ? "CPF" : "CNPJ", doc) + tag("xNome", textoLivre(d.tomador.nome, 300)) +
      (d.tomador.email ? tag("email", textoLivre(d.tomador.email, 80)) : ""));
  }
  const s = d.servico;
  const descricao = tag("xDescServ", textoLivre(s.descricao, 2000));
  const nbs = tag("cNBS", s.codigoNbs);
  const cServ = tag("cServ",
    tag("cTribNac", s.codigoTributacaoNacional) + (s.codigoTributacaoMunicipal ? tag("cTribMun", s.codigoTributacaoMunicipal) : "") +
    (novo ? nbs + descricao : descricao + nbs));
  const serv = tag("serv", tag("locPrest", tag("cLocPrestacao", s.codigoMunicipioPrestacao)) + cServ);
  // ISS tributável, sem retenção (1); alíquota só quando informada. Retenção antes da alíquota nos dois leiautes
  // (XSD 1.01 de produção e da produção restrita; conferido também numa NFS-e real do emissor web).
  const aliquota = d.valores.aliquotaIss ? tag("pAliq", d.valores.aliquotaIss) : "";
  const tribMun = tag("tribMun", tag("tribISSQN", "1") + tag("tpRetISSQN", "1") + aliquota);
  // ME/EPP: percentual aproximado dos tributos = alíquota do ISS (como o emissor web); sem alíquota, "não informado".
  const percentual = d.valores.percentualTributosMunicipais ?? d.valores.aliquotaIss;
  const totTrib = tag("totTrib", percentual
    ? tag("pTotTrib", tag("pTotTribFed", "0.00") + tag("pTotTribEst", "0.00") + tag("pTotTribMun", percentual))
    : tag("indTotTrib", "0"));
  const valores = tag("valores", tag("vServPrest", tag("vServ", d.valores.valorServico)) + tag("trib", tribMun + totTrib));
  const xml =
    `<DPS xmlns="${NFSE_NAMESPACE}" versao="1.01"><infDPS Id="${id}">` +
    cabecalho + tag("prest", prest) + toma + serv + valores + `</infDPS></DPS>`;
  return { id, xml };
}

/** Assina o elemento com o Id (infDPS ou infPedReg): XMLDSig envelopado, RSA-SHA1, C14N; a assinatura fica logo depois dele. */
export function assinarXml(xml: string, elemento: string, certificado: CertificadoA1) {
  const assinatura = new SignedXml({
    privateKey: certificado.chavePem,
    publicCert: certificado.certificadoPem,
    signatureAlgorithm: "http://www.w3.org/2000/09/xmldsig#rsa-sha1",
    canonicalizationAlgorithm: "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
  });
  const caminho = `//*[local-name(.)='${elemento}']`;
  assinatura.addReference({
    xpath: caminho,
    transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/TR/2001/REC-xml-c14n-20010315"],
    digestAlgorithm: "http://www.w3.org/2000/09/xmldsig#sha1",
  });
  assinatura.computeSignature(xml, { location: { reference: caminho, action: "after" } });
  return assinatura.getSignedXml();
}

export type RespostaHttp = { status: number; corpo: string };
export type EnvioHttps = (metodo: "GET" | "POST", url: string, corpo: string | null, certificado: CertificadoA1) => Promise<RespostaHttp>;

/** HTTPS com o certificado do cliente (TLS mútuo), JSON, resposta limitada a 10 MB. */
export const enviarHttps: EnvioHttps = (metodo, url, corpo, certificado) =>
  new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: metodo,
        key: certificado.chavePem,
        cert: certificado.certificadoPem,
        timeout: 60000,
        headers: { Accept: "application/json", ...(corpo ? { "Content-Type": "application/json" } : {}) },
      },
      (res) => {
        const partes: Buffer[] = [];
        let tamanho = 0;
        res.on("data", (parte: Buffer) => {
          tamanho += parte.length;
          if (tamanho > 10_000_000) {
            req.destroy();
            reject(new IntegrationError("SEFIN Nacional", 413, false));
          } else partes.push(parte);
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 500, corpo: Buffer.concat(partes).toString("utf8") }));
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", () => reject(new IntegrationError("SEFIN Nacional", 503, true)));
    req.end(corpo ?? undefined);
  });

const gzipB64 = (xml: string) => gzipSync(Buffer.from(xml, "utf8")).toString("base64");
const deGzipB64 = (valor: string) => gunzipSync(Buffer.from(valor, "base64"), { maxOutputLength: 5_000_000 }).toString("utf8");
const tagDe = (xml: string, nome: string) => xml.match(new RegExp(`<(?:\\w+:)?${nome}>([^<]*)</(?:\\w+:)?${nome}>`))?.[1] ?? null;

export type ResultadoSefin =
  | { ok: true; chave: string; numero: string | null; codigoVerificacao: string | null; xml: string; processadaEm: string | null }
  | { ok: false; erros: { codigo: string; descricao: string }[] };

/** Interpreta a resposta JSON da SEFIN: XML da nota (…XmlGZipB64) ou lista de erros. */
export function lerRespostaSefin(r: RespostaHttp): ResultadoSefin {
  if (r.status === 401 || r.status === 403) throw new IntegrationError("SEFIN Nacional (certificado recusado: vencido ou inválido)", r.status, false);
  if (r.status >= 500) throw new IntegrationError("SEFIN Nacional", r.status, true);
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(r.corpo) as Record<string, unknown>;
  } catch {
    throw new IntegrationError(`SEFIN Nacional (resposta não JSON, HTTP ${r.status})`, 502, true);
  }
  const lista = (json.erros ?? json.erro ?? json.Erros) as unknown;
  if (Array.isArray(lista) && lista.length) {
    return {
      ok: false,
      erros: lista.map((e) => {
        const item = (e ?? {}) as Record<string, unknown>;
        const codigo = String(item.Codigo ?? item.codigo ?? "");
        const descricao = [item.Descricao ?? item.descricao, item.Complemento ?? item.complemento].filter(Boolean).join(" — ");
        return { codigo, descricao: String(descricao).slice(0, 500) };
      }),
    };
  }
  const campo = Object.keys(json).find((k) => k.endsWith("XmlGZipB64") && typeof json[k] === "string");
  if (!campo) throw new IntegrationError(`SEFIN Nacional (resposta inesperada, HTTP ${r.status})`, 502, false);
  const xml = deGzipB64(String(json[campo]));
  const chave = typeof json.chaveAcesso === "string" ? json.chaveAcesso : tagDe(xml, "chNFSe");
  if (!chave) throw new IntegrationError("SEFIN Nacional (nota sem chave de acesso)", 502, false);
  return {
    ok: true,
    chave,
    numero: tagDe(xml, "nNFSe"),
    codigoVerificacao: tagDe(xml, "cVerif"),
    xml,
    processadaEm: typeof json.dataHoraProcessamento === "string" ? json.dataHoraProcessamento : tagDe(xml, "dhProc"),
  };
}

/** Monta, assina e envia a DPS. A SEFIN devolve a NFS-e autorizada ou os erros de validação. */
export async function emitirNfse(d: DadosDps, certificado: CertificadoA1, agora: Date, envio: EnvioHttps = enviarHttps) {
  const { id, xml } = montarDps(d, agora);
  // A SEFIN exige a declaração de codificação (E1229 sem ela).
  const assinado = `<?xml version="1.0" encoding="UTF-8"?>` + assinarXml(xml, "infDPS", certificado);
  const resposta = await envio("POST", urlSefin(d.ambiente) + "/nfse", JSON.stringify({ dpsXmlGZipB64: gzipB64(assinado) }), certificado);
  return { idDps: id, dpsAssinada: assinado, resultado: lerRespostaSefin(resposta) };
}

/** Situação do município no Emissor Nacional (convênio) — só leitura. */
export async function consultarConvenioMunicipio(ambiente: AmbienteFiscal, codigoMunicipio: string, certificado: CertificadoA1, envio: EnvioHttps = enviarHttps) {
  if (!/^\d{7}$/.test(codigoMunicipio)) throw new IntegrationError("NFS-e (código IBGE do município)", 422, false);
  const r = await envio("GET", `${urlAdn(ambiente)}/parametrizacao/${codigoMunicipio}/convenio`, null, certificado);
  return { status: r.status, corpo: r.corpo.slice(0, 4000) };
}

/** Motivos de cancelamento da NFS-e Nacional. */
export const MOTIVOS_CANCELAMENTO_NFSE = { erroEmissao: "1", servicoNaoPrestado: "2", outros: "9" } as const;

/** Pedido de registro do evento 101101 (cancelamento), sem assinatura. */
export function montarCancelamentoNfse(opcoes: {
  ambiente: AmbienteFiscal;
  cnpj: string;
  chave: string;
  motivo: keyof typeof MOTIVOS_CANCELAMENTO_NFSE;
  justificativa: string;
  agora: Date;
}) {
  const cnpj = somenteDigitos(opcoes.cnpj);
  const justificativa = opcoes.justificativa.trim();
  if (cnpj.length !== 14 || !/^\d{50}$/.test(opcoes.chave) || !MOTIVOS_CANCELAMENTO_NFSE[opcoes.motivo])
    throw new IntegrationError("NFS-e (cancelamento: CNPJ, chave de 50 dígitos ou motivo)", 422, false);
  if (justificativa.length < 15 || justificativa.length > 200)
    throw new IntegrationError("NFS-e (justificativa de 15 a 200 caracteres)", 422, false);
  const id = `PRE${opcoes.chave}101101`;
  const xml =
    `<pedRegEvento xmlns="${NFSE_NAMESPACE}" versao="1.01"><infPedReg Id="${id}">` +
    tag("tpAmb", producao(opcoes.ambiente) ? "1" : "2") + tag("verAplic", "sistema-loja-1.0") +
    tag("dhEvento", horarioDps(opcoes.agora).dhEmi) + tag("CNPJAutor", cnpj) + tag("chNFSe", opcoes.chave) +
    tag("e101101", tag("xDesc", "Cancelamento de NFS-e") + tag("cMotivo", MOTIVOS_CANCELAMENTO_NFSE[opcoes.motivo]) + tag("xMotivo", textoLivre(justificativa, 200))) +
    `</infPedReg></pedRegEvento>`;
  return { id, xml };
}

/** Cancela a NFS-e: evento assinado enviado para a chave. Devolve o XML do evento registrado ou os erros. */
export async function cancelarNfse(
  opcoes: Parameters<typeof montarCancelamentoNfse>[0],
  certificado: CertificadoA1,
  envio: EnvioHttps = enviarHttps,
): Promise<{ ok: true; xml: string } | { ok: false; erros: { codigo: string; descricao: string }[] }> {
  const { xml } = montarCancelamentoNfse(opcoes);
  const assinado = `<?xml version="1.0" encoding="UTF-8"?>` + assinarXml(xml, "infPedReg", certificado);
  const r = await envio(
    "POST",
    `${urlSefin(opcoes.ambiente)}/nfse/${opcoes.chave}/eventos`,
    JSON.stringify({ pedidoRegistroEventoXmlGZipB64: gzipB64(assinado) }),
    certificado,
  );
  if (r.status === 401 || r.status === 403) throw new IntegrationError("SEFIN Nacional (certificado recusado: vencido ou inválido)", r.status, false);
  if (r.status >= 500) throw new IntegrationError("SEFIN Nacional", r.status, true);
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(r.corpo) as Record<string, unknown>;
  } catch {
    throw new IntegrationError(`SEFIN Nacional (resposta não JSON, HTTP ${r.status})`, 502, true);
  }
  const campo = Object.keys(json).find((k) => k.endsWith("XmlGZipB64") && typeof json[k] === "string");
  if (campo) return { ok: true, xml: deGzipB64(String(json[campo])) };
  const lido = lerRespostaSefin({ status: r.status, corpo: r.corpo });
  if (!lido.ok) return lido;
  throw new IntegrationError(`SEFIN Nacional (resposta inesperada ao cancelar, HTTP ${r.status})`, 502, false);
}
