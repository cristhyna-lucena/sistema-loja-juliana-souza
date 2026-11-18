import { requestJson, secret, IntegrationError } from "./http";
export type Pacote = {
  pesoGramas: number;
  alturaCm: number;
  larguraCm: number;
  comprimentoCm: number;
};
export type Frete = {
  codigo: string;
  nome: string;
  valor: string;
  prazoDias: number | null;
};
export class CorreiosClient {
  private token = "";
  private tokenAte = 0;
  private readonly base =
    process.env.CORREIOS_AMBIENTE === "producao"
      ? "https://api.correios.com.br"
      : "https://apihom.correios.com.br";
  private async headers() {
    if (Date.now() >= this.tokenAte) {
      const auth =
        "Basic " +
        Buffer.from(
          secret("CORREIOS_USUARIO") + ":" + secret("CORREIOS_CODIGO_ACESSO"),
        ).toString("base64");
      const result = await requestJson<{ token: string; expiraEm?: string }>(
        "Correios",
        this.base + "/token/v1/autentica/cartaopostagem",
        {
          method: "POST",
          headers: { Authorization: auth },
          body: JSON.stringify({
            numero: secret("CORREIOS_CARTAO_POSTAGEM"),
            ...(process.env.CORREIOS_CONTRATO
              ? { contrato: process.env.CORREIOS_CONTRATO }
              : {}),
          }),
        },
      );
      this.token = result.token;
      this.tokenAte =
        Math.min(
          Date.parse(result.expiraEm ?? "") || Date.now() + 5 * 60_000,
          Date.now() + 30 * 60_000,
        ) - 30_000;
    }
    return { Authorization: "Bearer " + this.token };
  }
  async cotar(
    origem: string,
    destino: string,
    pacote: Pacote,
  ): Promise<Frete[]> {
    const headers = await this.headers();
    const servicos = [
      { codigo: process.env.CORREIOS_PAC ?? "03298", nome: "Correios PAC" },
      { codigo: process.env.CORREIOS_SEDEX ?? "03220", nome: "Correios SEDEX" },
    ];
    const results = await Promise.allSettled(
      servicos.map(async (servico): Promise<Frete> => {
        const parametros = new URLSearchParams({
          cepOrigem: origem,
          cepDestino: destino,
          psObjeto: String(pacote.pesoGramas),
          tpObjeto: "2",
          comprimento: String(pacote.comprimentoCm),
          largura: String(pacote.larguraCm),
          altura: String(pacote.alturaCm),
        });
        const preco = await requestJson<{ pcFinal: string; coErro?: string }>(
          "Correios",
          this.base + "/preco/v1/nacional/" + servico.codigo + "?" + parametros,
          { headers },
        );
        const prazo = await requestJson<{
          prazoEntrega: number;
          coErro?: string;
        }>(
          "Correios",
          this.base +
            "/prazo/v1/nacional/" +
            servico.codigo +
            "?cepOrigem=" +
            origem +
            "&cepDestino=" +
            destino,
          { headers },
        );
        if (
          !/^\d+([.,]\d{1,2})?$/.test(preco.pcFinal) ||
          !Number.isInteger(prazo.prazoEntrega) ||
          prazo.prazoEntrega < 0 ||
          (preco.coErro && preco.coErro !== "0") ||
          (prazo.coErro && prazo.coErro !== "0")
        )
          throw new IntegrationError("Correios", 422, false);
        return {
          codigo: servico.codigo,
          nome: servico.nome,
          valor: preco.pcFinal.replace(",", "."),
          prazoDias: prazo.prazoEntrega,
        };
      }),
    );
    const validos = results
      .filter(
        (result): result is PromiseFulfilledResult<Frete> =>
          result.status === "fulfilled",
      )
      .map((result) => result.value);
    if (!validos.length) throw new IntegrationError("Correios", 503, true);
    return validos;
  }
  async prepostar(payload: unknown) {
    return requestJson<{ id: string; codigoObjeto: string }>(
      "Correios",
      this.base + "/prepostagem/v1/prepostagens",
      {
        method: "POST",
        headers: await this.headers(),
        body: JSON.stringify(payload),
      },
    );
  }
  async rotulo(id: string) {
    return requestJson<{ idRecibo: string }>(
      "Correios",
      this.base + "/prepostagem/v1/prepostagens/rotulo/assincrono/pdf",
      {
        method: "POST",
        headers: await this.headers(),
        body: JSON.stringify({
          idsPrePostagem: [id],
          tipoRotulo: "P",
          formatoRotulo: "ET",
        }),
      },
    );
  }
  async baixarRotulo(recibo: string) {
    const response = await fetch(
      this.base +
        "/prepostagem/v1/prepostagens/rotulo/download/assincrono/" +
        encodeURIComponent(recibo),
      {
        headers: await this.headers(),
        signal: AbortSignal.timeout(20000),
        redirect: "error",
      },
    );
    if (!response.ok)
      throw new IntegrationError(
        "Correios",
        response.status,
        response.status === 404 || response.status >= 500,
      );
    if (!response.headers.get("content-type")?.includes("application/pdf"))
      throw new IntegrationError("Correios", 503, true);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (
      buffer.length > 15 * 1024 * 1024 ||
      buffer.subarray(0, 5).toString() !== "%PDF-"
    )
      throw new IntegrationError("Correios", 502, false);
    return buffer;
  }
  async rastrear(codigo: string) {
    return requestJson<{
      objetos: {
        codObjeto: string;
        eventos?: {
          descricao: string;
          dtHrCriado: string;
          unidade?: { endereco?: { cidade?: string; uf?: string } };
        }[];
      }[];
    }>(
      "Correios",
      this.base +
        "/srorastro/v1/objetos/" +
        encodeURIComponent(codigo) +
        "?resultado=T",
      { headers: await this.headers() },
    );
  }
}
