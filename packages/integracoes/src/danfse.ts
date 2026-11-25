// DANFSe (Documento Auxiliar da NFS-e) em PDF, gerado a partir do XML autorizado da NFS-e Nacional.
// O governo desativou a API de DANFSe (01/07/2026): o PDF passa a ser responsabilidade do emissor.
// Layout inspirado no DANFSe v2.0 oficial; o QR Code leva à consulta pública da chave.
import { XMLParser } from "fast-xml-parser";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";

export const URL_CONSULTA_PUBLICA_NFSE = "https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=";

type No = Record<string, unknown>;
const leitor = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false });
const no = (v: unknown): No => (v && typeof v === "object" && !Array.isArray(v) ? (v as No) : {});
const txt = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

export type DadosDanfse = ReturnType<typeof lerNfse>;

/** Extrai do XML da NFS-e (autorizado pela SEFIN) o que o DANFSe mostra. */
export function lerNfse(xml: string) {
  const raiz = no(leitor.parse(xml));
  const inf = no(no(raiz.NFSe).infNFSe);
  const chave = txt(inf["@_Id"]).replace(/^NFS/, "");
  if (!/^\d{50}$/.test(chave)) throw new Error("XML não é de uma NFS-e Nacional autorizada.");
  const dps = no(no(inf.DPS).infDPS);
  const emit = no(inf.emit);
  const end = no(emit.enderNac);
  const prest = no(dps.prest);
  const reg = no(prest.regTrib);
  const toma = no(dps.toma);
  const cServ = no(no(dps.serv).cServ);
  const valNfse = no(inf.valores);
  const valDps = no(dps.valores);
  const tribMun = no(no(valDps.trib).tribMun);
  const pTot = no(no(no(valDps.trib).totTrib).pTotTrib);
  return {
    chave,
    numero: txt(inf.nNFSe),
    municipio: txt(inf.xLocEmi),
    localPrestacao: txt(inf.xLocPrestacao),
    localIncidencia: txt(inf.xLocIncid),
    descricaoTributacao: txt(inf.xTribNac),
    descricaoNbs: txt(inf.xNBS),
    ambienteGerador: txt(inf.ambGer),
    processadaEm: txt(inf.dhProc),
    situacao: txt(inf.cStat),
    tipoAmbiente: txt(dps.tpAmb),
    serieDps: txt(dps.serie),
    numeroDps: txt(dps.nDPS),
    emissaoDps: txt(dps.dhEmi),
    competencia: txt(dps.dCompet),
    prestador: {
      documento: txt(emit.CNPJ ?? emit.CPF),
      nome: txt(emit.xNome),
      inscricaoMunicipal: txt(prest.IM),
      telefone: txt(emit.fone ?? prest.fone),
      email: txt(emit.email ?? prest.email),
      endereco: [txt(end.xLgr), txt(end.nro), txt(end.xBairro)].filter(Boolean).join(", "),
      cep: txt(end.CEP),
      uf: txt(end.UF),
      codigoMunicipio: txt(end.cMun),
      opcaoSimples: txt(reg.opSimpNac),
      regimeApuracao: txt(reg.regApTribSN),
    },
    tomador: Object.keys(toma).length
      ? { documento: txt(toma.CNPJ ?? toma.CPF), nome: txt(toma.xNome), email: txt(toma.email), telefone: txt(toma.fone) }
      : null,
    servico: { codigo: txt(cServ.cTribNac), codigoMunicipal: txt(cServ.cTribMun), nbs: txt(cServ.cNBS), descricao: txt(cServ.xDescServ) },
    valores: {
      servico: txt(no(valDps.vServPrest).vServ),
      baseCalculo: txt(valNfse.vBC),
      aliquotaAplicada: txt(valNfse.pAliqAplic),
      iss: txt(valNfse.vISSQN),
      totalRetido: txt(valNfse.vTotalRet),
      liquido: txt(valNfse.vLiq),
      retencao: txt(tribMun.tpRetISSQN),
      tributosFederais: txt(pTot.pTotTribFed),
      tributosEstaduais: txt(pTot.pTotTribEst),
      tributosMunicipais: txt(pTot.pTotTribMun),
    },
  };
}

const vazio = (v: string) => (v ? v : "-");
export function formatarDocumento(v: string) {
  if (/^\d{14}$/.test(v)) return v.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (/^\d{11}$/.test(v)) return v.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return vazio(v);
}
export function formatarReais(v: string) {
  if (!v || Number.isNaN(Number(v))) return "-";
  const [inteiro, centavos = "00"] = Number(v).toFixed(2).split(".");
  return "R$ " + inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "," + centavos;
}
/** Data e hora como vieram no XML (horário local do emissor), sem converter fuso. */
export function formatarDataHora(v: string) {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?/);
  if (!m) return vazio(v);
  return `${m[3]}/${m[2]}/${m[1]}` + (m[4] ? ` ${m[4]}:${m[5]}:${m[6]}` : "");
}
const formatarCodigoServico = (v: string) => (/^\d{6}$/.test(v) ? `${v.slice(0, 2)}.${v.slice(2, 4)}.${v.slice(4)}` : vazio(v));
const formatarNbs = (v: string) => (/^\d{9}$/.test(v) ? `${v[0]}.${v.slice(1, 5)}.${v.slice(5, 7)}.${v.slice(7)}` : vazio(v));
const formatarIbge = (v: string) => (/^\d{7}$/.test(v) ? `${v.slice(0, 2)}.${v.slice(2)}` : vazio(v));
const formatarCep = (v: string) => (/^\d{8}$/.test(v) ? `${v.slice(0, 2)}.${v.slice(2, 5)}-${v.slice(5)}` : vazio(v));
const formatarPercentual = (v: string) => (v ? Number(v).toFixed(2).replace(".", ",") + " %" : "-");
const formatarTelefone = (v: string) => {
  const d = v.replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return vazio(v);
};
const SITUACAO: Record<string, string> = { "100": "NFS-e Gerada", "101": "NFS-e de Substituição Gerada", "102": "NFS-e de Decisão Judicial", "103": "NFS-e Avulsa" };
const RETENCAO: Record<string, string> = { "1": "Não Retido", "2": "Retido pelo Tomador", "3": "Retido pelo Intermediário" };
const SIMPLES: Record<string, string> = {
  "1": "Não Optante",
  "2": "Optante - Microempreendedor Individual (MEI)",
  "3": "Optante - Microempresa ou Empresa de Pequeno Porte (ME/EPP)",
};
const APURACAO: Record<string, string> = {
  "1": "Regime de apuração dos tributos federais e municipal pelo Simples Nacional",
  "2": "Federais pelo Simples Nacional e ISSQN fora dele",
  "3": "Federais e municipal fora do Simples Nacional",
};

const A4 = { largura: 595.28, altura: 841.89 };
const MARGEM = 28;
const LARGURA_UTIL = A4.largura - 2 * MARGEM;
const COR_LINHA = rgb(0.25, 0.25, 0.25);
const COR_FUNDO = rgb(0.9, 0.9, 0.9);

/** Deixa o texto só com caracteres da fonte padrão (WinAnsi): troca pontuação tipográfica e remove emojis e afins. */
export function textoParaPdf(t: string) {
  return t
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/[^\n\x20-\x7E\u00A0-\u00FF]/gu, "")
    .replace(/ {2,}/g, " ");
}

/** Quebra o texto em linhas que cabem na largura (fonte Helvetica, caracteres WinAnsi). */
function quebrar(texto: string, fonte: PDFFont, tamanho: number, largura: number) {
  const linhas: string[] = [];
  for (const paragrafo of textoParaPdf(texto).split(/\r?\n/)) {
    let atual = "";
    for (const palavra of paragrafo.split(/\s+/).filter(Boolean)) {
      const tentativa = atual ? atual + " " + palavra : palavra;
      if (fonte.widthOfTextAtSize(tentativa, tamanho) <= largura) atual = tentativa;
      else {
        if (atual) linhas.push(atual);
        atual = palavra;
      }
    }
    linhas.push(atual);
  }
  return linhas;
}

class Desenho {
  y = A4.altura - MARGEM;
  constructor(readonly pagina: PDFPage, readonly normal: PDFFont, readonly negrito: PDFFont) {}
  texto(t: string, x: number, y: number, tamanho: number, negrito = false) {
    this.pagina.drawText(textoParaPdf(t), { x, y, size: tamanho, font: negrito ? this.negrito : this.normal, color: rgb(0, 0, 0) });
  }
  linha(y = this.y) {
    this.pagina.drawLine({ start: { x: MARGEM, y }, end: { x: A4.largura - MARGEM, y }, thickness: 0.6, color: COR_LINHA });
  }
  /** Faixa de título da seção (fundo cinza), com o título à esquerda. */
  secao(titulo: string) {
    this.y -= 2;
    this.pagina.drawRectangle({ x: MARGEM, y: this.y - 11, width: LARGURA_UTIL, height: 11, color: COR_FUNDO });
    this.texto(titulo, MARGEM + 3, this.y - 8, 7.5, true);
    this.y -= 13;
  }
  /** Linha de até 4 campos (rótulo pequeno em negrito, valor abaixo). `largura` em colunas (1 a 4). */
  campos(itens: { rotulo: string; valor: string; largura?: number }[]) {
    const coluna = LARGURA_UTIL / 4;
    let x = MARGEM + 3;
    let alturaMax = 0;
    for (const item of itens) {
      const largura = (item.largura ?? 1) * coluna - 6;
      this.texto(item.rotulo, x, this.y - 6.5, 6, true);
      const linhas = quebrar(vazio(item.valor), this.normal, 7.5, largura);
      linhas.forEach((l, i) => this.texto(l, x, this.y - 15 - i * 9, 7.5));
      alturaMax = Math.max(alturaMax, 10 + linhas.length * 9);
      x += (item.largura ?? 1) * coluna;
    }
    this.y -= alturaMax + 2;
  }
  /** Texto corrido em toda a largura. */
  paragrafo(rotulo: string, valor: string) {
    this.campos([{ rotulo, valor, largura: 4 }]);
  }
}

/** Gera o PDF do DANFSe a partir do XML autorizado da NFS-e. */
export async function gerarDanfse(xmlNfse: string, opcoes: { logo?: Uint8Array | null } = {}): Promise<Uint8Array> {
  const d = lerNfse(xmlNfse);
  const pdf = await PDFDocument.create();
  pdf.setTitle(`NFS-e ${d.numero} - ${d.chave}`);
  pdf.setProducer("sistema-loja");
  const pagina = pdf.addPage([A4.largura, A4.altura]);
  const g = new Desenho(pagina, await pdf.embedFont(StandardFonts.Helvetica), await pdf.embedFont(StandardFonts.HelveticaBold));

  // Cabeçalho: título, município e ambiente; QR Code da consulta pública à direita.
  const png = await QRCode.toBuffer(URL_CONSULTA_PUBLICA_NFSE + d.chave, { errorCorrectionLevel: "M", margin: 0, width: 240 });
  const qr = await pdf.embedPng(png);
  const tamanhoQr = 62;
  pagina.drawImage(qr, { x: A4.largura - MARGEM - tamanhoQr, y: g.y - tamanhoQr, width: tamanhoQr, height: tamanhoQr });
  // Logo do prestador (opcional, PNG ou JPEG) à esquerda; o texto do cabeçalho vem depois dela.
  let x = MARGEM;
  if (opcoes.logo?.length) {
    const bytes = opcoes.logo;
    const ehPng = bytes[0] === 0x89 && bytes[1] === 0x50;
    const imagem = ehPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    const escala = Math.min(110 / imagem.width, 56 / imagem.height);
    const w = imagem.width * escala, h = imagem.height * escala;
    pagina.drawImage(imagem, { x: MARGEM, y: g.y - h, width: w, height: h });
    x = MARGEM + w + 10;
  }
  g.texto("NFS-e - Nota Fiscal de Serviço eletrônica", x, g.y - 12, 11, true);
  g.texto("DANFSe v2.0 - Documento Auxiliar da NFS-e", x, g.y - 25, 9, true);
  g.texto(`Município: ${vazio(d.municipio)}   |   Ambiente Gerador: ${vazio(d.ambienteGerador)}   |   Tipo de Ambiente: ${vazio(d.tipoAmbiente)}`, x, g.y - 37, 7.5);
  if (d.tipoAmbiente === "2") g.texto("HOMOLOGAÇÃO - SEM VALOR FISCAL", x, g.y - 49, 9, true);
  g.texto("Consulte a autenticidade pelo QR Code", A4.largura - MARGEM - 150, g.y - tamanhoQr - 8, 6);
  g.texto("ou pela chave no portal nacional da NFS-e.", A4.largura - MARGEM - 150, g.y - tamanhoQr - 15, 6);
  g.y -= tamanhoQr + 20;
  g.linha();

  g.campos([{ rotulo: "CHAVE DE ACESSO DA NFS-e", valor: d.chave, largura: 4 }]);
  g.campos([
    { rotulo: "NÚMERO DA NFS-e", valor: d.numero },
    { rotulo: "COMPETÊNCIA DA NFS-e", valor: formatarDataHora(d.competencia) },
    { rotulo: "DATA E HORA DA EMISSÃO DA NFS-e", valor: formatarDataHora(d.processadaEm) },
    { rotulo: "SITUAÇÃO DA NFS-e", valor: SITUACAO[d.situacao] ?? vazio(d.situacao) },
  ]);
  g.campos([
    { rotulo: "NÚMERO DA DPS", valor: d.numeroDps },
    { rotulo: "SÉRIE DA DPS", valor: d.serieDps },
    { rotulo: "DATA E HORA DA EMISSÃO DA DPS", valor: formatarDataHora(d.emissaoDps) },
    { rotulo: "EMITENTE DA NFS-e", valor: "Prestador" },
  ]);

  const p = d.prestador;
  g.secao("PRESTADOR / FORNECEDOR");
  g.campos([
    { rotulo: "CNPJ / CPF / NIF", valor: formatarDocumento(p.documento) },
    { rotulo: "Indicador Municipal (Inscrição)", valor: p.inscricaoMunicipal },
    { rotulo: "Telefone", valor: formatarTelefone(p.telefone) },
    { rotulo: "E-mail", valor: p.email.toLowerCase() },
  ]);
  g.campos([
    { rotulo: "Nome / Nome Empresarial", valor: p.nome, largura: 2 },
    { rotulo: "Município / Sigla UF", valor: `${vazio(d.municipio)} / ${vazio(p.uf)}` },
    { rotulo: "Código IBGE / CEP", valor: `${formatarIbge(p.codigoMunicipio)} / ${formatarCep(p.cep)}` },
  ]);
  g.campos([
    { rotulo: "Endereço", valor: p.endereco, largura: 2 },
    { rotulo: "Simples Nacional na Data de Competência", valor: SIMPLES[p.opcaoSimples] ?? vazio(p.opcaoSimples), largura: 2 },
  ]);
  if (p.regimeApuracao) g.paragrafo("Regime de Apuração Tributária pelo SN", APURACAO[p.regimeApuracao] ?? p.regimeApuracao);
  g.linha();

  g.secao("TOMADOR / ADQUIRENTE");
  if (d.tomador) {
    g.campos([
      { rotulo: "CNPJ / CPF / NIF", valor: formatarDocumento(d.tomador.documento) },
      { rotulo: "Nome / Nome Empresarial", valor: d.tomador.nome, largura: 2 },
      { rotulo: "E-mail", valor: d.tomador.email },
    ]);
  } else g.paragrafo("", "TOMADOR NÃO IDENTIFICADO NA NFS-e");
  g.linha();

  const s = d.servico;
  g.secao("SERVIÇO PRESTADO");
  g.campos([
    { rotulo: "Código de Tributação Nacional / Municipal", valor: `${formatarCodigoServico(s.codigo)} / ${vazio(s.codigoMunicipal)}` },
    { rotulo: "Código da NBS", valor: formatarNbs(s.nbs) },
    { rotulo: "Local da Prestação", valor: d.localPrestacao, largura: 2 },
  ]);
  if (d.descricaoTributacao) g.paragrafo("Descrição da Tributação Nacional", d.descricaoTributacao);
  g.paragrafo("Descrição do Serviço", s.descricao);
  g.linha();

  const v = d.valores;
  g.secao("TRIBUTAÇÃO MUNICIPAL (ISSQN)");
  g.campos([
    { rotulo: "Município de Incidência do ISSQN", valor: d.localIncidencia },
    { rotulo: "BC ISSQN", valor: formatarReais(v.baseCalculo) },
    { rotulo: "Alíquota Aplicada", valor: v.aliquotaAplicada ? formatarPercentual(v.aliquotaAplicada) : "-" },
    { rotulo: "Retenção do ISSQN", valor: RETENCAO[v.retencao] ?? vazio(v.retencao) },
  ]);
  g.campos([{ rotulo: "ISSQN Apurado", valor: formatarReais(v.iss) }, { rotulo: "Total das Retenções", valor: formatarReais(v.totalRetido) }]);
  g.linha();

  g.secao("VALOR TOTAL DA NFS-e");
  g.campos([
    { rotulo: "VALOR DO SERVIÇO", valor: formatarReais(v.servico) },
    { rotulo: "Desconto Incondicionado", valor: "-" },
    { rotulo: "Total das Retenções", valor: formatarReais(v.totalRetido) },
    { rotulo: "VALOR LÍQUIDO DA NFS-e", valor: formatarReais(v.liquido) },
  ]);
  g.linha();

  g.secao("INFORMAÇÕES COMPLEMENTARES");
  if (v.tributosMunicipais || v.tributosFederais || v.tributosEstaduais)
    g.paragrafo("", `Totais aproximados dos Tributos cfe. Lei nº 12.741/2012: Federais: ${formatarPercentual(v.tributosFederais || "0")}; Estaduais: ${formatarPercentual(v.tributosEstaduais || "0")}; Municipais: ${formatarPercentual(v.tributosMunicipais || "0")}`);

  // Canhoto no rodapé.
  const yCanhoto = MARGEM + 26;
  pagina.drawRectangle({ x: MARGEM, y: MARGEM, width: LARGURA_UTIL, height: 26, borderColor: COR_LINHA, borderWidth: 0.6 });
  g.texto("DATA CIENTIFICAÇÃO:", MARGEM + 3, yCanhoto - 8, 6, true);
  g.texto("IDENTIFICAÇÃO E ASSINATURA", MARGEM + LARGURA_UTIL / 4 + 3, yCanhoto - 8, 6, true);
  g.texto("Nº NFS-e / CHAVE NFS-e", MARGEM + LARGURA_UTIL / 2 + 3, yCanhoto - 8, 6, true);
  g.texto(`${d.numero} / ${d.chave}`, MARGEM + LARGURA_UTIL / 2 + 3, yCanhoto - 18, 7);
  return pdf.save();
}
