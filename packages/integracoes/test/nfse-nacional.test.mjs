// Emissor da NFS-e Nacional: DPS, assinatura e leitura das respostas (sem rede).
import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync, gunzipSync } from "node:zlib";
import forge from "node-forge";
import { SignedXml } from "xml-crypto";
import { lerCertificadoA1, montarDps, idDps, horarioDps, emitirNfse, lerRespostaSefin } from "../dist/index.js";

function certificado() {
  const k = forge.pki.rsa.generateKeyPair(1024);
  const c = forge.pki.createCertificate();
  c.publicKey = k.publicKey; c.serialNumber = "03";
  c.validity.notBefore = new Date(Date.now() - 86400000); c.validity.notAfter = new Date(Date.now() + 86400000);
  c.setSubject([{ name: "commonName", value: "TESTE" }]); c.setIssuer([{ name: "commonName", value: "TESTE" }]);
  c.sign(k.privateKey, forge.md.sha256.create());
  return lerCertificadoA1(Buffer.from(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(k.privateKey, [c], "s", { algorithm: "3des" })).getBytes(), "binary"), "s");
}
const CERT = certificado();
const AGORA = new Date("2026-11-24T13:30:00Z");
const DADOS = {
  ambiente: "homologacao",
  prestador: { cnpj: "00.000.000/0001-91", codigoMunicipio: "5108600", opcaoSimples: 3, inscricaoMunicipal: "123" },
  numero: { serie: "1", numero: 7, emitidaEm: AGORA },
  tomador: { documento: "529.982.247-25", nome: "Maria & Filhos <teste>" },
  servico: { codigoMunicipioPrestacao: "5108600", codigoTributacaoNacional: "060301", codigoNbs: "126021000", descricao: "Drenagem linfática - 1 sessão" },
  valores: { valorServico: "150.00", aliquotaIss: "2.00" },
};

test("Id e horário da DPS no formato do leiaute", () => {
  assert.equal(idDps("5108600", "00000000000191", "1", 7), "DPS5108600200000000000191" + "00001" + "000000000000007");
  assert.deepEqual(horarioDps(AGORA), { dhEmi: "2026-11-24T10:29:00-03:00", dCompet: "2026-11-24" });
});

test("DPS de ME/EPP do Simples na homologação (leiaute novo): ordem dos grupos, finNFSe, cNBS antes da descrição", () => {
  const { id, xml } = montarDps(DADOS, AGORA);
  assert.equal(id.length, 45);
  assert.match(xml, /^<DPS xmlns="http:\/\/www.sped.fazenda.gov.br\/nfse" versao="1.01"><infDPS Id="DPS5108600200000000000191/);
  assert.match(xml, /<tpAmb>2<\/tpAmb><dhEmi>2026-11-24T10:29:00-03:00<\/dhEmi><verAplic>[^<]+<\/verAplic><serie>1<\/serie><nDPS>7<\/nDPS><dCompet>2026-11-24<\/dCompet><tpEmit>1<\/tpEmit><finNFSe>0<\/finNFSe><cLocEmi>5108600<\/cLocEmi>/);
  assert.match(xml, /<prest><CNPJ>00000000000191<\/CNPJ><IM>123<\/IM><regTrib><opSimpNac>3<\/opSimpNac><regApTribSN>1<\/regApTribSN><regEspTrib>0<\/regEspTrib><\/regTrib><\/prest>/);
  assert.match(xml, /<toma><CPF>52998224725<\/CPF><xNome>Maria &amp; Filhos &lt;teste&gt;<\/xNome><\/toma>/);
  assert.match(xml, /<cServ><cTribNac>060301<\/cTribNac><cNBS>126021000<\/cNBS><xDescServ>Drenagem linfática - 1 sessão<\/xDescServ><\/cServ>/);
  assert.match(xml, /<valores><vServPrest><vServ>150.00<\/vServ><\/vServPrest><trib><tribMun><tribISSQN>1<\/tribISSQN><pAliq>2.00<\/pAliq><tpRetISSQN>1<\/tpRetISSQN><\/tribMun><totTrib><pTotTrib><pTotTribFed>0.00<\/pTotTribFed><pTotTribEst>0.00<\/pTotTribEst><pTotTribMun>2.00<\/pTotTribMun><\/pTotTrib><\/totTrib><\/trib><\/valores>/);
});

test("produção usa o leiaute vigente: sem finNFSe e com a descrição antes do cNBS", () => {
  const { xml } = montarDps({ ...DADOS, ambiente: "producao" }, AGORA);
  assert.match(xml, /<tpAmb>1<\/tpAmb>/);
  assert.doesNotMatch(xml, /finNFSe/);
  assert.match(xml, /<xDescServ>[^<]+<\/xDescServ><cNBS>126021000<\/cNBS>/);
  // Mesma ordem da NFS-e real do emissor web em produção: retenção antes da alíquota.
  assert.match(xml, /<tribMun><tribISSQN>1<\/tribISSQN><tpRetISSQN>1<\/tpRetISSQN><pAliq>2.00<\/pAliq><\/tribMun>/);
  const semAliquota = montarDps({ ...DADOS, ambiente: "producao", valores: { valorServico: "10.00" } }, AGORA).xml;
  assert.match(semAliquota, /<totTrib><indTotTrib>0<\/indTotTrib><\/totTrib>/);
});

test("dados inválidos não chegam à SEFIN", () => {
  assert.throws(() => montarDps({ ...DADOS, servico: { ...DADOS.servico, codigoTributacaoNacional: "6.03" } }, AGORA), /tributação nacional/);
  assert.throws(() => montarDps({ ...DADOS, valores: { valorServico: "0.00" } }, AGORA), /valor do serviço/);
  assert.throws(() => montarDps({ ...DADOS, tomador: { documento: "123", nome: "X" } }, AGORA), /tomador/);
});

const NFSE = `<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe Id="NFS51086002000000000001910000000000000071"><nNFSe>71</nNFSe><cVerif>ABC123</cVerif><dhProc>2026-11-24T10:30:00-03:00</dhProc><chNFSe>51086002000000000001910000000000000071999999</chNFSe></infNFSe></NFSe>`;

test("emitir: envia a DPS assinada (gzip+base64) à produção restrita e lê a nota autorizada", async () => {
  let pedido;
  const envio = async (metodo, url, corpo) => {
    pedido = { metodo, url, corpo };
    return { status: 201, corpo: JSON.stringify({ chaveAcesso: "5108600200000000000191000000000000007199", dataHoraProcessamento: "2026-11-24T10:30:00-03:00", nfseXmlGZipB64: gzipSync(NFSE).toString("base64") }) };
  };
  const r = await emitirNfse(DADOS, CERT, AGORA, envio);
  assert.equal(pedido.metodo, "POST");
  assert.equal(pedido.url, "https://sefin.producaorestrita.nfse.gov.br/SefinNacional/nfse");
  const dps = gunzipSync(Buffer.from(JSON.parse(pedido.corpo).dpsXmlGZipB64, "base64")).toString("utf8");
  assert.equal(dps, r.dpsAssinada);
  assert.match(dps, /<\/infDPS><Signature xmlns="http:\/\/www.w3.org\/2000\/09\/xmldsig#">/);
  assert.match(dps, new RegExp(`<Reference URI="#${r.idDps}">`));
  const conferir = new SignedXml({ publicCert: CERT.certificadoPem });
  conferir.loadSignature(dps.match(/<Signature[\s\S]*<\/Signature>/)[0]);
  assert.equal(conferir.checkSignature(dps), true);
  assert.deepEqual({ ...r.resultado, xml: undefined }, {
    ok: true, chave: "5108600200000000000191000000000000007199", numero: "71", codigoVerificacao: "ABC123",
    xml: undefined, processadaEm: "2026-11-24T10:30:00-03:00",
  });
});

test("resposta com erros de validação vira lista legível; 403 é certificado recusado; 5xx é temporário", () => {
  const r = lerRespostaSefin({ status: 400, corpo: JSON.stringify({ erros: [{ Codigo: "E0312", Descricao: "Código de tributação nacional inexistente", Complemento: "cTribNac" }] }) });
  assert.deepEqual(r, { ok: false, erros: [{ codigo: "E0312", descricao: "Código de tributação nacional inexistente — cTribNac" }] });
  assert.throws(() => lerRespostaSefin({ status: 403, corpo: "<html>" }), (e) => e.retryable === false && /certificado recusado/.test(e.provider));
  assert.throws(() => lerRespostaSefin({ status: 503, corpo: "" }), (e) => e.retryable === true);
});

test("cancelamento: evento 101101 com Id PRE+chave+tipo, motivo e justificativa; assinatura válida; leitura do retorno", async () => {
  const { cancelarNfse, montarCancelamentoNfse } = await import("../dist/index.js");
  const CHAVE = "5".repeat(50);
  const base = { ambiente: "homologacao", cnpj: "00000000000191", chave: CHAVE, motivo: "erroEmissao", justificativa: "Nota emitida em teste de integração", agora: AGORA };
  const { id, xml } = montarCancelamentoNfse(base);
  assert.equal(id, `PRE${CHAVE}101101`);
  assert.match(xml, /<tpAmb>2<\/tpAmb><verAplic>[^<]+<\/verAplic><dhEvento>2026-11-24T10:29:00-03:00<\/dhEvento><CNPJAutor>00000000000191<\/CNPJAutor><chNFSe>5{50}<\/chNFSe>/);
  assert.match(xml, /<e101101><xDesc>Cancelamento de NFS-e<\/xDesc><cMotivo>1<\/cMotivo><xMotivo>Nota emitida em teste de integração<\/xMotivo><\/e101101>/);
  assert.throws(() => montarCancelamentoNfse({ ...base, justificativa: "curta" }), /justificativa/);
  let pedido;
  const r = await cancelarNfse(base, CERT, async (metodo, url, corpo) => {
    pedido = { metodo, url, corpo };
    return { status: 201, corpo: JSON.stringify({ eventoXmlGZipB64: gzipSync("<evento>ok</evento>").toString("base64") }) };
  });
  assert.equal(pedido.url, `https://sefin.producaorestrita.nfse.gov.br/SefinNacional/nfse/${CHAVE}/eventos`);
  const enviado = gunzipSync(Buffer.from(JSON.parse(pedido.corpo).pedidoRegistroEventoXmlGZipB64, "base64")).toString("utf8");
  assert.match(enviado, /^<\?xml version="1.0" encoding="UTF-8"\?><pedRegEvento /);
  const conferir = new SignedXml({ publicCert: CERT.certificadoPem });
  conferir.loadSignature(enviado.match(/<Signature[\s\S]*<\/Signature>/)[0]);
  assert.equal(conferir.checkSignature(enviado), true);
  assert.deepEqual(r, { ok: true, xml: "<evento>ok</evento>" });
  const recusa = await cancelarNfse(base, CERT, async () => ({ status: 400, corpo: JSON.stringify({ erros: [{ Codigo: "E0840", Descricao: "Prazo expirado" }] }) }));
  assert.deepEqual(recusa, { ok: false, erros: [{ codigo: "E0840", descricao: "Prazo expirado" }] });
});
