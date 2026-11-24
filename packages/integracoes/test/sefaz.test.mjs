// Testes do conector direto com a SEFAZ (sem rede: o envio SOAP é substituído por respostas gravadas).
import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import forge from "node-forge";
import { SignedXml } from "xml-crypto";
import {
  lerCertificadoA1, distribuicaoDFe, lerResumoNfe, montarEventoManifestacao, manifestarDestinatario, dataHoraEvento,
} from "../dist/sefaz.js";

// Certificado A1 de teste, gerado na hora (nenhum dado real).
function pfxDeTeste(senha) {
  const chaves = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = chaves.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86400000);
  const nome = [{ name: "commonName", value: "EMPRESA TESTE:00000000000191" }];
  cert.setSubject(nome);
  cert.setIssuer(nome);
  cert.sign(chaves.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(chaves.privateKey, [cert], senha, { algorithm: "3des" });
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary");
}
const PFX = pfxDeTeste("segredo-teste");
const CERT = lerCertificadoA1(PFX, "segredo-teste");
const CNPJ = "00000000000191";
const CHAVE = "51261100000000000191550010000012341000012345";

test("certificado A1: lê chave e certificado; senha errada dá erro sem detalhes", () => {
  assert.match(CERT.chavePem, /BEGIN RSA PRIVATE KEY/);
  assert.match(CERT.certificadoPem, /BEGIN CERTIFICATE/);
  assert.ok(CERT.validoAte > new Date());
  assert.throws(() => lerCertificadoA1(PFX, "errada"), /Certificado A1/);
});

const zip = (xml) => gzipSync(Buffer.from(xml)).toString("base64");
const RESUMO =
  `<resNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><chNFe>${CHAVE}</chNFe><CNPJ>11222333000181</CNPJ>` +
  `<xNome>DISTRIBUIDORA DE COSMETICOS LTDA</xNome><IE>1</IE><dhEmi>2026-11-20T10:00:00-04:00</dhEmi><tpNF>1</tpNF>` +
  `<vNF>1530.40</vNF><digVal>x</digVal><dhRecbto>2026-11-20T10:01:00-04:00</dhRecbto><nProt>1</nProt><cSitNFe>1</cSitNFe></resNFe>`;
const respostaDistribuicao = (cStat, docs) =>
  `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeDistDFeInteresseResponse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">` +
  `<nfeDistDFeInteresseResult><retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>1</tpAmb><verAplic>1</verAplic>` +
  `<cStat>${cStat}</cStat><xMotivo>ok</xMotivo><dhResp>2026-11-24T10:00:00-03:00</dhResp><ultNSU>000000000000042</ultNSU><maxNSU>000000000000050</maxNSU>` +
  (docs.length ? `<loteDistDFeInt>${docs.join("")}</loteDistDFeInt>` : "") +
  `</retDistDFeInt></nfeDistDFeInteresseResult></nfeDistDFeInteresseResponse></soap:Body></soap:Envelope>`;

test("distribuição: pede a partir do último NSU (15 dígitos), com UF e ambiente; descompacta os documentos", async () => {
  let pedido;
  const envio = async (url, acao, envelope) => {
    pedido = { url, acao, envelope };
    return respostaDistribuicao("138", [`<docZip NSU="000000000000041" schema="resNFe_v1.01.xsd">${zip(RESUMO)}</docZip>`]);
  };
  const r = await distribuicaoDFe({ ambiente: "producao", cnpj: "00.000.000/0001-91", uf: "mt", certificado: CERT, ultNSU: 40n }, envio);
  assert.equal(pedido.url, "https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx");
  assert.match(pedido.acao, /nfeDistDFeInteresse$/);
  assert.match(pedido.envelope, /<tpAmb>1<\/tpAmb><cUFAutor>51<\/cUFAutor><CNPJ>00000000000191<\/CNPJ><distNSU><ultNSU>000000000000040<\/ultNSU><\/distNSU>/);
  assert.equal(r.cStat, "138");
  assert.equal(r.ultNSU, 42n);
  assert.equal(r.maxNSU, 50n);
  assert.equal(r.documentos.length, 1);
  assert.equal(r.documentos[0].nsu, 41n);
  assert.equal(r.documentos[0].schema, "resNFe_v1.01.xsd");
  assert.deepEqual(lerResumoNfe(r.documentos[0].xml), {
    chave: CHAVE, numero: "000001234", fornecedorNome: "DISTRIBUIDORA DE COSMETICOS LTDA", fornecedorDocumento: "11222333000181",
    emitidaEm: "2026-11-20", valorTotal: "1530.40", situacao: "1",
  });
});

test("distribuição: homologação usa tpAmb 2 e o endereço de homologação; por chave usa consChNFe; nada novo (137) sem documentos", async () => {
  let pedido;
  const r = await distribuicaoDFe({ ambiente: "homologacao", cnpj: CNPJ, uf: "MT", certificado: CERT, chave: CHAVE }, async (url, acao, envelope) => {
    pedido = { url, envelope };
    return respostaDistribuicao("137", []);
  });
  assert.match(pedido.url, /^https:\/\/hom1\./);
  assert.match(pedido.envelope, /<tpAmb>2<\/tpAmb>.*<consChNFe><chNFe>51261100000000000191550010000012341000012345<\/chNFe><\/consChNFe>/);
  assert.equal(r.cStat, "137");
  assert.deepEqual(r.documentos, []);
});

test("distribuição: CNPJ ou UF inválidos não chegam a chamar a SEFAZ", async () => {
  const envio = async () => assert.fail("não devia chamar");
  await assert.rejects(distribuicaoDFe({ ambiente: "producao", cnpj: "123", uf: "MT", certificado: CERT }, envio));
  await assert.rejects(distribuicaoDFe({ ambiente: "producao", cnpj: CNPJ, uf: "XX", certificado: CERT }, envio));
});

const AGORA = new Date("2026-11-24T13:30:00Z");

test("horário do evento em Brasília (-03:00)", () => {
  assert.equal(dataHoraEvento(AGORA), "2026-11-24T10:30:00-03:00");
});

test("ciência da operação: evento 210210 com Id do leiaute e assinatura válida sobre o infEvento", () => {
  const { id, xml } = montarEventoManifestacao({ ambiente: "producao", cnpj: CNPJ, chave: CHAVE, tipo: "ciencia", agora: AGORA, certificado: CERT });
  assert.equal(id, `ID210210${CHAVE}01`);
  assert.match(xml, /<cOrgao>91<\/cOrgao><tpAmb>1<\/tpAmb><CNPJ>00000000000191<\/CNPJ>/);
  assert.match(xml, /<dhEvento>2026-11-24T10:30:00-03:00<\/dhEvento><tpEvento>210210<\/tpEvento><nSeqEvento>1<\/nSeqEvento>/);
  assert.match(xml, /<descEvento>Ciencia da Operacao<\/descEvento>/);
  // A assinatura fica dentro do <evento>, logo depois do <infEvento>, referenciando o Id.
  assert.match(xml, /<\/infEvento><Signature xmlns="http:\/\/www.w3.org\/2000\/09\/xmldsig#">/);
  assert.match(xml, new RegExp(`<Reference URI="#${id}">`));
  assert.match(xml, /<X509Certificate>/);
  const conferir = new SignedXml({ publicCert: CERT.certificadoPem });
  const assinatura = xml.match(/<Signature[\s\S]*<\/Signature>/)[0];
  conferir.loadSignature(assinatura);
  assert.equal(conferir.checkSignature(xml), true);
});

test("operação não realizada exige justificativa de 15 a 255 caracteres, escapada no XML", () => {
  const base = { ambiente: "producao", cnpj: CNPJ, chave: CHAVE, tipo: "nao_realizada", agora: AGORA, certificado: CERT };
  assert.throws(() => montarEventoManifestacao({ ...base, justificativa: "curta" }), /justificativa/);
  const { xml } = montarEventoManifestacao({ ...base, justificativa: "Mercadoria <devolvida> & recusada" });
  assert.match(xml, /<tpEvento>210240<\/tpEvento>/);
  assert.match(xml, /<xJust>Mercadoria &lt;devolvida&gt; &amp; recusada<\/xJust>/);
});

const respostaEvento = (cStat) =>
  `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">` +
  `<retEnvEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><idLote>1</idLote><tpAmb>1</tpAmb><verAplic>AN</verAplic><cOrgao>91</cOrgao>` +
  `<cStat>128</cStat><xMotivo>Lote de evento processado</xMotivo><retEvento versao="1.00"><infEvento><tpAmb>1</tpAmb><verAplic>AN</verAplic>` +
  `<cOrgao>91</cOrgao><cStat>${cStat}</cStat><xMotivo>motivo ${cStat}</xMotivo><chNFe>${CHAVE}</chNFe></infEvento></retEvento></retEnvEvento>` +
  `</nfeResultMsg></soap:Body></soap:Envelope>`;

test("manifestação enviada ao Ambiente Nacional: 135 e 573 (já registrada) contam como registrada; outro código não", async () => {
  let pedido;
  const opcoes = { ambiente: "producao", cnpj: CNPJ, chave: CHAVE, tipo: "ciencia", agora: AGORA, certificado: CERT };
  const ok = await manifestarDestinatario(opcoes, async (url, acao, envelope) => {
    pedido = { url, acao, envelope };
    return respostaEvento("135");
  });
  assert.equal(pedido.url, "https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx");
  assert.match(pedido.acao, /NFeRecepcaoEvento4\/nfeRecepcaoEvento$/);
  assert.match(pedido.envelope, /<envEvento xmlns="http:\/\/www.portalfiscal.inf.br\/nfe" versao="1.00"><idLote>\d{1,15}<\/idLote><evento /);
  assert.doesNotMatch(pedido.envelope, /<envEvento[^]*<\?xml/);
  assert.deepEqual(ok, { cStat: "135", motivo: "motivo 135", registrada: true });
  assert.equal((await manifestarDestinatario(opcoes, async () => respostaEvento("573"))).registrada, true);
  assert.equal((await manifestarDestinatario(opcoes, async () => respostaEvento("494"))).registrada, false);
});
