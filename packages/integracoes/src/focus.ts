import { basic, requestJson, secret, IntegrationError } from "./http";
export type FocusResult = {
  status: string;
  mensagem_sefaz?: string;
  mensagem?: string;
  caminho_xml_nota_fiscal?: string;
  caminho_danfe?: string;
  caminho_xml_cancelamento?: string;
  chave_nfe?: string;
};
export class FocusClient {
  private readonly base: string;
  private readonly headers: Record<string, string>;
  constructor(ambiente: string) {
    this.base =
      ambiente === "producao"
        ? "https://api.focusnfe.com.br"
        : "https://homologacao.focusnfe.com.br";
    this.headers = {
      Authorization: basic(
        secret(
          ambiente === "producao" ? "FOCUS_TOKEN_PRODUCAO" : "FOCUS_TOKEN",
        ),
      ),
    };
  }
  emitir(modelo: string, ref: string, payload: unknown) {
    return requestJson<FocusResult>(
      "Focus",
      this.base +
        "/v2/" +
        modelo.toLowerCase() +
        "?ref=" +
        encodeURIComponent(ref),
      { method: "POST", headers: this.headers, body: JSON.stringify(payload) },
    );
  }
  consultar(modelo: string, ref: string) {
    return requestJson<FocusResult>(
      "Focus",
      this.base + "/v2/" + modelo.toLowerCase() + "/" + encodeURIComponent(ref),
      { headers: this.headers },
    );
  }
  cancelar(modelo: string, ref: string, justificativa: string) {
    return requestJson<FocusResult>(
      "Focus",
      this.base + "/v2/" + modelo.toLowerCase() + "/" + encodeURIComponent(ref),
      {
        method: "DELETE",
        headers: this.headers,
        body: JSON.stringify({ justificativa }),
      },
    );
  }
  corrigir(ref: string, correcao: string) {
    return requestJson<FocusResult>(
      "Focus",
      this.base + "/v2/nfe/" + encodeURIComponent(ref) + "/carta_correcao",
      {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({ correcao }),
      },
    );
  }
  recebidas(cnpj: string, versao: string) {
    return requestJson<Record<string, unknown>[]>(
      "Focus",
      this.base +
        "/v2/nfes_recebidas?cnpj=" +
        encodeURIComponent(cnpj) +
        "&versao=" +
        encodeURIComponent(versao),
      { headers: this.headers },
    );
  }
  manifestar(chave: string, tipo: string) {
    return requestJson<{ status?: string; status_sefaz?: string }>(
      "Focus",
      this.base +
        "/v2/nfes_recebidas/" +
        encodeURIComponent(chave) +
        "/manifesto",
      { method: "POST", headers: this.headers, body: JSON.stringify({ tipo }) },
    );
  }
  async baixar(path: string) {
    const target = new URL(path, this.base);
    if (target.origin !== this.base)
      throw new IntegrationError("Focus", 400, false);
    const response = await fetch(target, {
      headers: this.headers,
      signal: AbortSignal.timeout(20000),
      redirect: "error",
    });
    if (!response.ok)
      throw new IntegrationError(
        "Focus",
        response.status,
        response.status >= 500,
      );
    const body = await response.text();
    if (Buffer.byteLength(body) > 2_000_000)
      throw new IntegrationError("Focus", 413, false);
    return body;
  }
}
