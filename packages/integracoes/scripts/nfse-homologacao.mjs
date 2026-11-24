// Teste de ponta a ponta da NFS-e Nacional na PRODUÇÃO RESTRITA (homologação, sem valor fiscal).
// Uso: CERTIFICADO_A1_ARQUIVO=... CERTIFICADO_A1_SENHA_ARQUIVO=... node scripts/nfse-homologacao.mjs dados.json [convenio|emitir]
// dados.json: { prestador: {...}, servico: {...}, valores: {...}, tomador?: {...}, numero: { serie, numero } } (ver DadosDps).
// Nunca emite em produção: o ambiente é fixo em homologação.
import { readFileSync } from "node:fs";
import { carregarCertificadoA1, consultarConvenioMunicipio, emitirNfse } from "../dist/index.js";

const [arquivo, acao = "convenio"] = process.argv.slice(2);
if (!arquivo) throw new Error("Informe o arquivo de dados.");
const dados = JSON.parse(readFileSync(arquivo, "utf8"));
const AMBIENTE = "homologacao";
if (dados.ambiente && dados.ambiente !== AMBIENTE) throw new Error("Este script só roda em homologação.");
const certificado = carregarCertificadoA1();

if (acao === "convenio") {
  const r = await consultarConvenioMunicipio(AMBIENTE, dados.prestador.codigoMunicipio, certificado);
  console.log("convênio do município (HTTP " + r.status + "):", r.corpo);
} else if (acao === "emitir") {
  const agora = new Date();
  const r = await emitirNfse({ ...dados, ambiente: AMBIENTE, numero: { ...dados.numero, emitidaEm: agora } }, certificado, agora);
  console.log("DPS:", r.idDps);
  if (r.resultado.ok) {
    console.log("NFS-e AUTORIZADA (homologação) | chave:", r.resultado.chave, "| número:", r.resultado.numero, "| verificação:", r.resultado.codigoVerificacao);
  } else {
    console.log("RECUSADA pela SEFIN:");
    for (const e of r.resultado.erros) console.log(" -", e.codigo, e.descricao);
  }
} else throw new Error("Ação: convenio ou emitir.");
