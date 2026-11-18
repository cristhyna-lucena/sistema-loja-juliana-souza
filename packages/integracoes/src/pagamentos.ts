import { basic, requestJson, secret } from "./http";
export type GatewayName = "MERCADO_PAGO" | "ASAAS" | "PAGARME";
export type CheckoutInput = {
  id: string;
  numero: number;
  total: string;
  nome: string;
  email: string;
  cpfCnpj: string;
  expiresAt: string;
  retorno: string;
};
export type CheckoutResult = { id: string; url: string };
export type PaymentResult = {
  id: string;
  referencia: string;
  pago: boolean;
  estornado: boolean;
  valor: string;
  moeda: string;
  forma: "PIX" | "BOLETO" | "CARTAO_CREDITO" | "CARTAO_DEBITO";
};

export class GatewayClient {
  private readonly base: string;
  private readonly headers: Record<string, string>;
  constructor(public readonly name: GatewayName) {
    if (name === "MERCADO_PAGO") {
      this.base = "https://api.mercadopago.com";
      this.headers = {
        Authorization: "Bearer " + secret("MERCADO_PAGO_ACCESS_TOKEN"),
      };
    } else if (name === "ASAAS") {
      this.base =
        process.env.ASAAS_AMBIENTE === "producao"
          ? "https://api.asaas.com/v3"
          : "https://api-sandbox.asaas.com/v3";
      this.headers = {
        access_token: secret("ASAAS_API_KEY"),
        "User-Agent": "SistemaLoja/1.0",
      };
    } else {
      this.base =
        process.env.PAGARME_AMBIENTE === "producao"
          ? "https://api.pagar.me/core/v5"
          : "https://sdx-api.pagar.me/core/v5";
      this.headers = { Authorization: basic(secret("PAGARME_SECRET_KEY")) };
    }
  }
  private call<T>(
    path: string,
    method = "GET",
    body?: unknown,
    idempotency?: string,
  ) {
    return requestJson<T>(this.name, this.base + path, {
      method,
      headers: {
        ...this.headers,
        ...(idempotency
          ? { "X-Idempotency-Key": idempotency, "Idempotency-Key": idempotency }
          : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async checkout(input: CheckoutInput): Promise<CheckoutResult> {
    if (this.name === "MERCADO_PAGO") {
      const result = await this.call<{
        id: string;
        init_point: string;
        sandbox_init_point: string;
      }>(
        "/checkout/preferences",
        "POST",
        {
          external_reference: input.id,
          items: [
            {
              id: input.id,
              title: "Pedido " + input.numero,
              quantity: 1,
              currency_id: "BRL",
              unit_price: Number(input.total),
            },
          ],
          payer: { name: input.nome, email: input.email },
          back_urls: {
            success: input.retorno,
            failure: input.retorno,
            pending: input.retorno,
          },
          expires: true,
          expiration_date_to: input.expiresAt,
          ...(process.env.PUBLIC_API_URL
            ? {
                notification_url: new URL(
                  "/webhooks/pagamento/MERCADO_PAGO",
                  process.env.PUBLIC_API_URL,
                ).toString(),
              }
            : {}),
        },
        input.id,
      );
      return {
        id: result.id,
        url:
          process.env.MERCADO_PAGO_AMBIENTE === "producao"
            ? result.init_point
            : result.sandbox_init_point,
      };
    }
    if (this.name === "ASAAS") {
      const anteriores = await this.call<{
        data: { id: string; invoiceUrl: string }[];
      }>("/payments?externalReference=" + encodeURIComponent(input.id));
      if (anteriores.data.length)
        return {
          id: anteriores.data[0].id,
          url: anteriores.data[0].invoiceUrl,
        };
      const clientes = await this.call<{ data: { id: string }[] }>(
        "/customers?cpfCnpj=" + encodeURIComponent(input.cpfCnpj),
      );
      const customer =
        clientes.data[0] ??
        (await this.call<{ id: string }>("/customers", "POST", {
          name: input.nome,
          email: input.email,
          cpfCnpj: input.cpfCnpj,
          notificationDisabled: true,
        }));
      const result = await this.call<{ id: string; invoiceUrl: string }>(
        "/payments",
        "POST",
        {
          customer: customer.id,
          billingType: "UNDEFINED",
          value: Number(input.total),
          dueDate: input.expiresAt.slice(0, 10),
          description: "Pedido " + input.numero,
          externalReference: input.id,
        },
        input.id,
      );
      return { id: result.id, url: result.invoiceUrl };
    }
    const centavos = Number(input.total.replace(".", ""));
    const result = await this.call<{ id: string; url: string }>(
      "/paymentlinks",
      "POST",
      {
        type: "order",
        name: "Pedido " + input.numero,
        order_code: input.id,
        expires_at: input.expiresAt,
        max_paid_sessions: 1,
        payment_settings: {
          accepted_payment_methods: ["credit_card", "boleto", "pix"],
          credit_card_settings: {
            operation_type: "auth_and_capture",
            installments: [{ number: 1, total: centavos }],
          },
          boleto_settings: { due_in: 1 },
          pix_settings: { expires_in: 1800 },
        },
        cart_settings: {
          items: [
            {
              name: "Pedido " + input.numero,
              amount: centavos,
              default_quantity: 1,
            },
          ],
        },
        customer_settings: {
          customer: {
            name: input.nome,
            email: input.email,
            document: input.cpfCnpj,
            type: input.cpfCnpj.length === 11 ? "individual" : "company",
          },
        },
      },
      input.id,
    );
    return { id: result.id, url: result.url };
  }
  async pagamento(id: string): Promise<PaymentResult> {
    const safeId = encodeURIComponent(id);
    if (this.name === "MERCADO_PAGO") {
      const row = await this.call<{
        id: number;
        external_reference: string;
        status: string;
        transaction_amount: number;
        currency_id: string;
        payment_type_id: string;
        payment_method_id: string;
      }>("/v1/payments/" + safeId);
      return {
        id: String(row.id),
        referencia: row.external_reference,
        pago: row.status === "approved",
        estornado: ["refunded", "charged_back"].includes(row.status),
        valor: row.transaction_amount.toFixed(2),
        moeda: row.currency_id,
        forma:
          row.payment_method_id === "pix"
            ? "PIX"
            : row.payment_type_id === "ticket"
              ? "BOLETO"
              : row.payment_type_id === "debit_card"
                ? "CARTAO_DEBITO"
                : "CARTAO_CREDITO",
      };
    }
    if (this.name === "ASAAS") {
      const row = await this.call<{
        id: string;
        externalReference: string;
        status: string;
        value: number;
        billingType: string;
      }>("/payments/" + safeId);
      return {
        id: row.id,
        referencia: row.externalReference,
        pago: ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(
          row.status,
        ),
        estornado: [
          "REFUNDED",
          "CHARGEBACK_REQUESTED",
          "CHARGEBACK_DISPUTE",
        ].includes(row.status),
        valor: row.value.toFixed(2),
        moeda: "BRL",
        forma:
          row.billingType === "PIX"
            ? "PIX"
            : row.billingType === "BOLETO"
              ? "BOLETO"
              : "CARTAO_CREDITO",
      };
    }
    const row = await this.call<{
      id: string;
      code: string;
      status: string;
      amount: number;
      charges: { status: string; payment_method: string }[];
    }>("/orders/" + safeId);
    return {
      id: row.id,
      referencia: row.code,
      pago: row.status === "paid",
      estornado: row.charges.some((charge) =>
        ["refunded", "chargedback"].includes(charge.status),
      ),
      valor: (row.amount / 100).toFixed(2),
      moeda: "BRL",
      forma:
        row.charges[0]?.payment_method === "pix"
          ? "PIX"
          : row.charges[0]?.payment_method === "boleto"
            ? "BOLETO"
            : "CARTAO_CREDITO",
    };
  }
  async reembolsar(id: string, operacao: string) {
    if (this.name === "MERCADO_PAGO")
      return this.call(
        "/v1/payments/" + encodeURIComponent(id) + "/refunds",
        "POST",
        {},
        operacao,
      );
    if (this.name === "ASAAS")
      return this.call(
        "/payments/" + encodeURIComponent(id) + "/refund",
        "POST",
        {},
        operacao,
      );
    const pedido = await this.call<{
      charges: { id: string; status: string }[];
    }>("/orders/" + encodeURIComponent(id));
    for (const charge of pedido.charges.filter(
      (item) => item.status === "paid",
    ))
      await this.call(
        "/charges/" + encodeURIComponent(charge.id),
        "DELETE",
        {},
        operacao + ":" + charge.id,
      );
  }
}
