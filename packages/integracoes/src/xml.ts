import { XMLParser, XMLValidator } from "fast-xml-parser";
import { Prisma } from "@sistema/db";

type Node = Record<string, unknown>;
function node(value: unknown): Node {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Estrutura da NF-e inválida.");
  return value as Node;
}
function text(value: unknown) {
  return typeof value === "string" ? value : "";
}
function array(value: unknown): unknown[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}
export function lerNfe(xml: string) {
  if (
    Buffer.byteLength(xml) > 2_000_000 ||
    /<!DOCTYPE|<!ENTITY/i.test(xml) ||
    XMLValidator.validate(xml) !== true
  )
    throw new Error("XML inválido ou maior que 2 MB.");
  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: false,
    processEntities: true,
  });
  const documento = node(parser.parse(xml));
  const processo = node(documento.nfeProc ?? documento);
  const info = node(node(processo.NFe).infNFe);
  const protocolo = processo.protNFe
    ? node(node(processo.protNFe).infProt)
    : null;
  if (!protocolo || !["100", "150"].includes(text(protocolo.cStat)))
    throw new Error("Importe uma NF-e completa com protocolo de autorização.");
  const chave = text(info["@_Id"]).replace(/^NFe/, "");
  if (!/^\d{44}$/.test(chave) || text(protocolo.chNFe) !== chave)
    throw new Error("Chave da NF-e inválida.");
  const emitente = node(info.emit),
    destinatario = node(info.dest),
    ide = node(info.ide);
  const total = node(node(info.total).ICMSTot);
  return {
    chave,
    numero: text(ide.nNF),
    emitidaEm: text(ide.dhEmi ?? ide.dEmi).slice(0, 10),
    fornecedorNome: text(emitente.xNome),
    fornecedorDocumento: text(emitente.CNPJ ?? emitente.CPF),
    destinatarioDocumento: text(destinatario.CNPJ ?? destinatario.CPF),
    valorTotal: text(total.vNF),
    frete: text(total.vFrete) || "0.00",
    despesas: new Prisma.Decimal(text(total.vNF))
      .minus(text(total.vProd))
      .plus(text(total.vDesc) || "0")
      .toFixed(2),
    desconto: text(total.vDesc) || "0.00",
    itens: array(info.det).map((detalhe, index) => {
      const produto = node(node(detalhe).prod);
      const rastreios = array(produto.rastro).map((item) => {
        const rastro = node(item);
        return {
          numero: text(rastro.nLote),
          quantidade: text(rastro.qLote),
          validade: text(rastro.dVal) || null,
        };
      });
      return {
        numero: index + 1,
        codigoFornecedor: text(produto.cProd),
        descricao: text(produto.xProd),
        ncm: text(produto.NCM),
        unidade: text(produto.uCom),
        quantidade: text(produto.qCom),
        custoUnitario: text(produto.vUnCom),
        total: text(produto.vProd),
        lotes: rastreios,
      };
    }),
    parcelas: array(info.cobr ? node(info.cobr).dup : undefined).map((item) => {
      const duplicata = node(item);
      return { valor: text(duplicata.vDup), vencimento: text(duplicata.dVenc) };
    }),
  };
}
export type NfeLida = ReturnType<typeof lerNfe>;
