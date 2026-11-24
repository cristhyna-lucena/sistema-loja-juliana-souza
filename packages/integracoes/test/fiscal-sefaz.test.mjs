// Rotinas de notas recebidas pela SEFAZ, com banco em memória e respostas gravadas (sem rede).
import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import forge from "node-forge";
import { lerCertificadoA1, sincronizarSefaz, manifestarSefaz } from "../dist/index.js";

function certificado() {
  const chaves = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = chaves.publicKey;
  cert.serialNumber = "02";
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + 86400000);
  cert.setSubject([{ name: "commonName", value: "TESTE" }]);
  cert.setIssuer([{ name: "commonName", value: "TESTE" }]);
  cert.sign(chaves.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(chaves.privateKey, [cert], "s", { algorithm: "3des" });
  return lerCertificadoA1(Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary"), "s");
}
const CERT = certificado();
const CHAVE = "51261100000000000191550010000012341000012345";
const zip = (xml) => gzipSync(Buffer.from(xml)).toString("base64");
const resumo = (chave) =>
  `<resNFe xmlns="http://www.portalfiscal.inf.br/nfe"><chNFe>${chave}</chNFe><CNPJ>11222333000181</CNPJ><xNome>FORNECEDOR</xNome>` +
  `<dhEmi>2026-11-20T10:00:00-04:00</dhEmi><vNF>100.00</vNF><cSitNFe>1</cSitNFe></resNFe>`;
const NFE_COMPLETA =
  `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${CHAVE}"><ide><nNF>1234</nNF><dhEmi>2026-11-20T10:00:00-04:00</dhEmi></ide>` +
  `<emit><CNPJ>11222333000181</CNPJ><xNome>FORNECEDOR</xNome></emit><dest><CNPJ>00000000000191</CNPJ></dest>` +
  `<det nItem="1"><prod><cProd>A1</cProd><xProd>CREME</xProd><NCM>33049910</NCM><uCom>UN</uCom><qCom>2</qCom><vUnCom>50.00</vUnCom><vProd>100.00</vProd></prod></det>` +
  `<total><ICMSTot><vProd>100.00</vProd><vNF>100.00</vNF></ICMSTot></total></infNFe></NFe>` +
  `<protNFe><infProt><chNFe>${CHAVE}</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>`;
const distribuicao = (cStat, ult, max, docs = []) =>
  `<Envelope><Body><retDistDFeInt><cStat>${cStat}</cStat><xMotivo>m</xMotivo><ultNSU>${ult}</ultNSU><maxNSU>${max}</maxNSU>` +
  (docs.length ? `<loteDistDFeInt>${docs.join("")}</loteDistDFeInt>` : "") + `</retDistDFeInt></Body></Envelope>`;
const doc = (nsu, schema, xml) => `<docZip NSU="${nsu}" schema="${schema}">${zip(xml)}</docZip>`;
const evento = (cStat) => `<Envelope><Body><retEnvEvento><cStat>128</cStat><retEvento><infEvento><cStat>${cStat}</cStat><xMotivo>m</xMotivo></infEvento></retEvento></retEnvEvento></Body></Envelope>`;

function banco({ ultimoNsuDfe = 0n, notas = [] } = {}) {
  const estado = { config: { empresaId: "e1", ambienteFiscal: "producao", endereco: { uf: "MT" }, integracoes: { sefaz: true }, ultimoNsuDfe }, notas, jobs: [] };
  const db = {
    empresa: { findUniqueOrThrow: async () => ({ id: "e1", cnpj: "00000000000191" }) },
    configuracaoEmpresa: { update: async ({ data }) => Object.assign(estado.config, data) },
    notaRecebida: {
      findFirst: async ({ where }) => estado.notas.find((n) => n.chave === where.chave) ?? null,
      upsert: async ({ where, create, update }) => {
        const atual = estado.notas.find((n) => n.chave === where.empresaId_chave.chave);
        if (atual) Object.assign(atual, update);
        else estado.notas.push({ status: "NOVA", compraId: null, xml: null, ...create });
      },
      updateMany: async ({ where, data }) => {
        for (const n of estado.notas) if (n.chave === where.chave && (where.compraId !== null || !n.compraId)) Object.assign(n, data);
      },
    },
    integracaoJob: { createMany: async ({ data }) => estado.jobs.push(...data) },
  };
  return { db, estado };
}
const JOB = { id: "j1", empresaId: "e1" };

test("sincronizar: guarda o resumo como nota NOVA, avança o NSU e para no último disponível", async () => {
  const { db, estado } = banco({ ultimoNsuDfe: 10n });
  const pedidos = [];
  const envio = async (_u, _a, envelope) => {
    pedidos.push(envelope.match(/<ultNSU>(\d+)<\/ultNSU>/)[1]);
    return distribuicao("138", "000000000000012", "000000000000012", [
      doc("000000000000011", "resNFe_v1.01.xsd", resumo(CHAVE)),
      doc("000000000000012", "resEvento_v1.01.xsd", "<resEvento/>"),
    ]);
  };
  await sincronizarSefaz(db, JOB, estado.config, { certificado: () => CERT, envio });
  assert.deepEqual(pedidos, ["000000000000010"]);
  assert.equal(estado.config.ultimoNsuDfe, 12n);
  assert.equal(estado.notas.length, 1);
  assert.equal(estado.notas[0].status, "NOVA");
  assert.equal(estado.notas[0].fornecedorDocumento, "11222333000181");
  assert.equal(estado.notas[0].dados.origem, "SEFAZ");
  assert.equal(estado.jobs.length, 0);
});

test("sincronizar: nada novo (137) não muda nada; muitas páginas continuam numa nova rotina", async () => {
  const vazio = banco({ ultimoNsuDfe: 5n });
  await sincronizarSefaz(vazio.db, JOB, vazio.estado.config, { certificado: () => CERT, envio: async () => distribuicao("137", "5", "5") });
  assert.equal(vazio.estado.config.ultimoNsuDfe, 5n);
  let nsu = 0;
  const cheio = banco();
  await sincronizarSefaz(cheio.db, JOB, cheio.estado.config, {
    certificado: () => CERT,
    envio: async () => { nsu += 50; return distribuicao("138", String(nsu), "1000"); },
  });
  assert.equal(cheio.estado.config.ultimoNsuDfe, 500n);
  assert.deepEqual(cheio.estado.jobs.map((j) => j.tipo), ["FOCUS_SINCRONIZAR"]);
});

test("sincronizar: consumo indevido (656) para sem repetir na hora", async () => {
  const { db, estado } = banco();
  await assert.rejects(
    sincronizarSefaz(db, JOB, estado.config, { certificado: () => CERT, envio: async () => distribuicao("656", "0", "0") }),
    (e) => e.retryable === false && /consumo indevido/.test(e.provider),
  );
});

test("ciência: manifesta, baixa o XML completo pela chave e deixa a nota pronta para a entrada", async () => {
  const { db, estado } = banco({ notas: [{ chave: CHAVE, status: "NOVA", compraId: null, xml: null }] });
  const chamadas = [];
  const envio = async (url, _a, envelope) => {
    chamadas.push(url.includes("RecepcaoEvento") ? "evento" : envelope.includes("consChNFe") ? "chave" : "?");
    return url.includes("RecepcaoEvento") ? evento("135") : distribuicao("138", "0", "0", [doc("000000000000099", "procNFe_v4.00.xsd", NFE_COMPLETA)]);
  };
  await manifestarSefaz(db, JOB, estado.config, { chave: CHAVE, tipo: "ciencia" }, { certificado: () => CERT, envio, agora: () => new Date() });
  assert.deepEqual(chamadas, ["evento", "chave"]);
  assert.equal(estado.notas[0].status, "CIENCIA");
  assert.match(estado.notas[0].xml, /<nfeProc/);
  assert.equal(estado.notas[0].dados.itens[0].codigoFornecedor, "A1");
});

test("ciência: XML ainda indisponível vira erro temporário; na repetição não manifesta de novo", async () => {
  const { db, estado } = banco({ notas: [{ chave: CHAVE, status: "NOVA", compraId: null, xml: null }] });
  await assert.rejects(
    manifestarSefaz(db, JOB, estado.config, { chave: CHAVE, tipo: "ciencia" }, {
      certificado: () => CERT,
      envio: async (url) => (url.includes("RecepcaoEvento") ? evento("135") : distribuicao("137", "0", "0")),
    }),
    (e) => e.retryable === true,
  );
  assert.equal(estado.notas[0].status, "CIENCIA");
  const chamadas = [];
  await manifestarSefaz(db, JOB, estado.config, { chave: CHAVE, tipo: "ciencia" }, {
    certificado: () => CERT,
    envio: async (url) => { chamadas.push(url.includes("RecepcaoEvento") ? "evento" : "chave"); return distribuicao("138", "0", "0", [doc("1", "procNFe_v4.00.xsd", NFE_COMPLETA)]); },
  });
  assert.deepEqual(chamadas, ["chave"]);
});

test("manifestação recusada pela SEFAZ não é repetida; confirmação não baixa XML", async () => {
  const { db, estado } = banco({ notas: [{ chave: CHAVE, status: "CIENCIA", compraId: "c1", xml: "<x/>" }] });
  await assert.rejects(
    manifestarSefaz(db, JOB, estado.config, { chave: CHAVE, tipo: "confirmacao" }, { certificado: () => CERT, envio: async () => evento("494") }),
    (e) => e.retryable === false,
  );
  const chamadas = [];
  await manifestarSefaz(db, JOB, estado.config, { chave: CHAVE, tipo: "confirmacao" }, {
    certificado: () => CERT,
    envio: async (url) => { chamadas.push(url); return evento("135"); },
  });
  assert.equal(chamadas.length, 1);
});
