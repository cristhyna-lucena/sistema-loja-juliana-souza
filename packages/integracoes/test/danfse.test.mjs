// DANFSe gerado pelo sistema a partir do XML autorizado da NFS-e (nota fictícia).
import { test } from "node:test";
import assert from "node:assert/strict";
import { lerNfse, gerarDanfse, formatarReais, formatarDocumento, formatarDataHora, textoParaPdf } from "../dist/index.js";

const CHAVE = "51085012200000000000191000000000001226110000000001";
const XML = `<?xml version="1.0" encoding="utf-8"?><NFSe versao="1.01" xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe Id="NFS${CHAVE}">` +
  `<xLocEmi>Vera</xLocEmi><xLocPrestacao>Vera</xLocPrestacao><nNFSe>12</nNFSe><xLocIncid>Vera</xLocIncid>` +
  `<xTribNac>Banhos, duchas, sauna, massagens e congêneres.</xTribNac><ambGer>2</ambGer><cStat>100</cStat><dhProc>2026-11-24T20:04:06-03:00</dhProc>` +
  `<emit><CNPJ>00000000000191</CNPJ><xNome>ESTETICA TESTE LTDA</xNome><enderNac><xLgr>RUA A</xLgr><nro>1</nro><xBairro>CENTRO</xBairro><cMun>5108501</cMun><UF>MT</UF><CEP>78880000</CEP></enderNac><fone>6699990000</fone></emit>` +
  `<valores><vLiq>1234.50</vLiq></valores>` +
  `<DPS versao="1.01"><infDPS Id="DPS1"><tpAmb>2</tpAmb><dhEmi>2026-11-24T20:03:04-03:00</dhEmi><serie>1</serie><nDPS>12</nDPS><dCompet>2026-11-24</dCompet>` +
  `<prest><CNPJ>00000000000191</CNPJ><IM>123</IM><regTrib><opSimpNac>3</opSimpNac><regApTribSN>1</regApTribSN><regEspTrib>0</regEspTrib></regTrib></prest>` +
  `<toma><CPF>52998224725</CPF><xNome>Maria Cliente</xNome></toma>` +
  `<serv><cServ><cTribNac>060301</cTribNac><xDescServ>Drenagem linfática – 1 sessão 💆</xDescServ><cNBS>126021000</cNBS></cServ></serv>` +
  `<valores><vServPrest><vServ>1234.50</vServ></vServPrest><trib><tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>1</tpRetISSQN></tribMun>` +
  `<totTrib><pTotTrib><pTotTribFed>0.00</pTotTribFed><pTotTribEst>0.00</pTotTribEst><pTotTribMun>2.00</pTotTribMun></pTotTrib></totTrib></trib></valores></infDPS></DPS></infNFSe></NFSe>`;

test("lê do XML autorizado o que o DANFSe mostra", () => {
  const d = lerNfse(XML);
  assert.equal(d.chave, CHAVE);
  assert.equal(d.numero, "12");
  assert.equal(d.tipoAmbiente, "2");
  assert.equal(d.tomador.nome, "Maria Cliente");
  assert.equal(d.servico.codigo, "060301");
  assert.equal(d.valores.liquido, "1234.50");
  assert.equal(d.valores.retencao, "1");
  assert.equal(d.prestador.opcaoSimples, "3");
  assert.throws(() => lerNfse("<NFSe><infNFSe Id='x'/></NFSe>"), /NFS-e Nacional autorizada/);
});

test("formatadores do DANFSe", () => {
  assert.equal(formatarReais("1234.5"), "R$ 1.234,50");
  assert.equal(formatarReais(""), "-");
  assert.equal(formatarDocumento("00000000000191"), "00.000.000/0001-91");
  assert.equal(formatarDocumento("52998224725"), "529.982.247-25");
  assert.equal(formatarDataHora("2026-11-24T20:04:06-03:00"), "24/11/2026 20:04:06");
  assert.equal(formatarDataHora("2026-11-24"), "24/11/2026");
  assert.equal(textoParaPdf("Drenagem \u2013 1 sess\u00e3o \u201cpremium\u201d \u{1F486}"), 'Drenagem - 1 sess\u00e3o "premium" ');
});

test("gera um PDF válido de uma página, mesmo com caracteres fora da fonte (emoji, travessão)", async () => {
  const pdf = Buffer.from(await gerarDanfse(XML));
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.length > 3000);
  const { PDFDocument } = await import("pdf-lib");
  assert.equal((await PDFDocument.load(pdf)).getPageCount(), 1);
});
