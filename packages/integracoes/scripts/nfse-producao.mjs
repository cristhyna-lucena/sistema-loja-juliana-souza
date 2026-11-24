// NFS-e Nacional em PRODUÇÃO (documento fiscal real). Por padrão só mostra a PRÉVIA (nada é assinado nem enviado).
// Emitir exige as duas coisas: a ação "emitir" e NFSE_PRODUCAO_CONFIRMADA=sim (autorização expressa do dono).
// Uso: CERTIFICADO_A1_ARQUIVO=... CERTIFICADO_A1_SENHA_ARQUIVO=... node scripts/nfse-producao.mjs dados.json [previa|emitir]
import { readFileSync } from "node:fs";
import { carregarCertificadoA1, emitirNfse, montarDps } from "../dist/index.js";

const [arquivo, acao = "previa"] = process.argv.slice(2);
const dados = { ...JSON.parse(readFileSync(arquivo, "utf8")), ambiente: "producao" };
const agora = new Date();
const completo = { ...dados, numero: { ...dados.numero, emitidaEm: agora } };

if (acao === "previa") {
  const { id, xml } = montarDps(completo, agora);
  console.log("PRÉVIA (não assinada, não enviada) | DPS:", id);
  console.log(xml.replace(/></g, ">\n<"));
} else if (acao === "emitir") {
  if (process.env.NFSE_PRODUCAO_CONFIRMADA !== "sim") throw new Error("Emissão em produção sem a confirmação expressa (NFSE_PRODUCAO_CONFIRMADA=sim).");
  const r = await emitirNfse(completo, carregarCertificadoA1(), agora);
  console.log("DPS:", r.idDps);
  if (r.resultado.ok) {
    console.log("NFS-e AUTORIZADA | chave:", r.resultado.chave, "| número:", r.resultado.numero, "| verificação:", r.resultado.codigoVerificacao, "| processada:", r.resultado.processadaEm);
    console.log("XML_NFSE_INICIO\n" + r.resultado.xml + "\nXML_NFSE_FIM");
  } else {
    console.log("RECUSADA pela SEFIN (nenhuma nota foi gerada):");
    for (const e of r.resultado.erros) console.log(" -", e.codigo, e.descricao);
  }
} else throw new Error("Ação: previa ou emitir.");
