// Rotinas do processador para NFS-e Nacional (banco em memória, sem rede).
import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import forge from "node-forge";
import { lerCertificadoA1, processarNfseNacional, ehNfseNacional, urlDanfseSistema } from "../dist/index.js";

function certificado() {
  const k = forge.pki.rsa.generateKeyPair(1024), c = forge.pki.createCertificate();
  c.publicKey = k.publicKey; c.serialNumber = "07";
  c.validity.notBefore = new Date(Date.now() - 864e5); c.validity.notAfter = new Date(Date.now() + 864e5);
  c.setSubject([{ name: "commonName", value: "T" }]); c.setIssuer([{ name: "commonName", value: "T" }]); c.sign(k.privateKey, forge.md.sha256.create());
  return lerCertificadoA1(Buffer.from(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(k.privateKey, [c], "s", { algorithm: "3des" })).getBytes(), "binary"), "s");
}
const CERT = certificado();
const CHAVE = "5".repeat(50);
const PAYLOAD = {
  provedor: "NFSE_NACIONAL",
  prestador: { cnpj: "00000000000191", codigoMunicipio: "5108501", opcaoSimples: 3, inscricaoMunicipal: "1" },
  numero: { serie: "1", numero: 3 },
  tomador: { documento: "52998224725", nome: "Cliente" },
  servico: { codigoMunicipioPrestacao: "5108501", codigoTributacaoNacional: "060301", codigoNbs: "126021000", descricao: "Drenagem" },
  valores: { valorServico: "150.00", percentualTributosMunicipais: "2.00" },
};
const NFSE = `<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe Id="NFS${CHAVE}"><nNFSe>9</nNFSe><cVerif>X</cVerif><chNFSe>${CHAVE}</chNFSe></infNFSe></NFSe>`;
function banco(nota) {
  const estado = { nota: { id: "n1", empresaId: "e1", modelo: "NFSE", status: "PENDENTE", payload: PAYLOAD, retorno: null, xml: null, ...nota } };
  return { estado, db: { notaEmitida: { updateMany: async ({ data }) => Object.assign(estado.nota, data) } } };
}
const dep = (envio) => ({ certificado: () => CERT, envio, agora: () => new Date("2026-11-24T13:30:00Z") });

test("nota da NFS-e Nacional é reconhecida pelo provedor gravado no payload", () => {
  assert.equal(ehNfseNacional({ payload: PAYLOAD }), true);
  assert.equal(ehNfseNacional({ payload: { tomador: {} } }), false);
});

test("emitir: autorizada guarda XML, chave, número e o link do PDF gerado pelo sistema", async () => {
  const { db, estado } = banco();
  await processarNfseNacional(db, { tipo: "FOCUS_EMITIR", empresaId: "e1" }, estado.nota, "homologacao", {},
    dep(async () => ({ status: 201, corpo: JSON.stringify({ chaveAcesso: CHAVE, nfseXmlGZipB64: gzipSync(NFSE).toString("base64") }) })));
  assert.equal(estado.nota.status, "AUTORIZADA");
  assert.equal(estado.nota.retorno.chave, CHAVE);
  assert.equal(estado.nota.retorno.numero, "9");
  assert.equal(estado.nota.danfeUrl, urlDanfseSistema("n1"));
  assert.match(estado.nota.xml, /<NFSe/);
});

test("emitir: recusa da SEFIN vira ERRO com a mensagem para a tela; autorizada não é reenviada", async () => {
  const { db, estado } = banco();
  await processarNfseNacional(db, { tipo: "FOCUS_EMITIR", empresaId: "e1" }, estado.nota, "homologacao", {},
    dep(async () => ({ status: 400, corpo: JSON.stringify({ erros: [{ Codigo: "E0037", Descricao: "Município sem convênio" }] }) })));
  assert.equal(estado.nota.status, "ERRO");
  assert.equal(estado.nota.mensagem, "E0037 Município sem convênio");
  const autorizada = banco({ status: "AUTORIZADA" });
  await processarNfseNacional(autorizada.db, { tipo: "FOCUS_EMITIR", empresaId: "e1" }, autorizada.estado.nota, "homologacao", {}, dep(async () => assert.fail("não devia enviar")));
});

test("cancelar: evento aceito marca CANCELADA; recusa mantém AUTORIZADA com a mensagem", async () => {
  const ok = banco({ status: "AUTORIZADA", retorno: { chave: CHAVE } });
  let url;
  await processarNfseNacional(ok.db, { tipo: "FOCUS_CANCELAR", empresaId: "e1" }, ok.estado.nota, "homologacao", { motivo: "Serviço lançado em duplicidade" },
    dep(async (_m, u) => { url = u; return { status: 201, corpo: JSON.stringify({ eventoXmlGZipB64: gzipSync("<ev/>").toString("base64") }) }; }));
  assert.match(url, new RegExp(`/nfse/${CHAVE}/eventos$`));
  assert.equal(ok.estado.nota.status, "CANCELADA");
  const recusa = banco({ status: "AUTORIZADA", retorno: { chave: CHAVE } });
  await assert.rejects(processarNfseNacional(recusa.db, { tipo: "FOCUS_CANCELAR", empresaId: "e1" }, recusa.estado.nota, "homologacao", { motivo: "Serviço lançado em duplicidade" },
    dep(async () => ({ status: 400, corpo: JSON.stringify({ erros: [{ Codigo: "E0840", Descricao: "Prazo expirado" }] }) }))));
  assert.equal(recusa.estado.nota.status, "AUTORIZADA");
  assert.match(recusa.estado.nota.mensagem, /E0840/);
});
