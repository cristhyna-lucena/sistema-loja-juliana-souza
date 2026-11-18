import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  GatewayClient,
  CorreiosClient,
  FocusClient,
  lerNfe,
  IntegrationError,
  requestJson,
} from "@sistema/integracoes";
import { xmlZip } from "../dist/operacoes/xml-zip.js";

test("Adaptadores respeitam os contratos dos provedores com respostas simuladas", async (t) => {
  const originalFetch = globalThis.fetch;
  const keys = [
    "MERCADO_PAGO_ACCESS_TOKEN",
    "MERCADO_PAGO_AMBIENTE",
    "ASAAS_API_KEY",
    "ASAAS_AMBIENTE",
    "PAGARME_SECRET_KEY",
    "PAGARME_AMBIENTE",
    "CORREIOS_USUARIO",
    "CORREIOS_CODIGO_ACESSO",
    "CORREIOS_CARTAO_POSTAGEM",
    "CORREIOS_AMBIENTE",
    "FOCUS_TOKEN",
  ];
  const old = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const calls = [];
  const input = {
    id: "pedido-qa",
    numero: 12,
    total: "19.90",
    nome: "Cliente QA",
    email: "cliente@example.invalid",
    cpfCnpj: "52998224725",
    expiresAt: new Date(Date.now() + 1800000).toISOString(),
    retorno: "http://127.0.0.1:3000/pedido/pedido-qa",
  };
  const response = (value) =>
    new Response(JSON.stringify(value), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  try {
    process.env.MERCADO_PAGO_ACCESS_TOKEN = "ficticio";
    process.env.MERCADO_PAGO_AMBIENTE = "homologacao";
    process.env.ASAAS_API_KEY = "ficticio";
    process.env.ASAAS_AMBIENTE = "homologacao";
    process.env.PAGARME_SECRET_KEY = "sk_test_ficticio";
    process.env.PAGARME_AMBIENTE = "homologacao";
    process.env.CORREIOS_USUARIO = "ficticio";
    process.env.CORREIOS_CODIGO_ACESSO = "ficticio";
    process.env.CORREIOS_CARTAO_POSTAGEM = "0000000000";
    process.env.CORREIOS_AMBIENTE = "homologacao";
    process.env.FOCUS_TOKEN = "ficticio";
    await t.test(
      "Mercado Pago preserva referência, moeda e chave de idempotência",
      async () => {
        globalThis.fetch = async (url, init) => {
          calls.push({ url: String(url), init });
          if (String(url).includes("/v1/payments/"))
            return response({
              id: 123,
              external_reference: input.id,
              status: "approved",
              transaction_amount: 19.9,
              currency_id: "BRL",
              payment_type_id: "bank_transfer",
              payment_method_id: "pix",
            });
          return response({
            id: "preferencia-qa",
            init_point: "https://www.mercadopago.com.br/pagar",
            sandbox_init_point: "https://sandbox.mercadopago.com.br/pagar",
          });
        };
        const gateway = new GatewayClient("MERCADO_PAGO"),
          result = await gateway.checkout(input);
        assert.ok(result.url.includes("sandbox"));
        const sent = calls.at(-1);
        assert.equal(sent.init.headers["X-Idempotency-Key"], input.id);
        const body = JSON.parse(sent.init.body);
        assert.equal(body.external_reference, input.id);
        assert.equal(body.items[0].currency_id, "BRL");
        assert.equal(body.items[0].unit_price, 19.9);
        assert.deepEqual(await gateway.pagamento("123"), {
          id: "123",
          referencia: input.id,
          pago: true,
          estornado: false,
          valor: "19.90",
          moeda: "BRL",
          forma: "PIX",
        });
      },
    );
    await t.test(
      "Asaas consulta cobrança anterior antes de criar e usa checkout hospedado",
      async () => {
        calls.length = 0;
        globalThis.fetch = async (url, init) => {
          calls.push({ url: String(url), init });
          if (String(url).includes("?")) return response({ data: [] });
          if (String(url).endsWith("/customers"))
            return response({ id: "cus_qa" });
          return response({
            id: "pay_qa",
            invoiceUrl: "https://sandbox.asaas.com/i/qa",
          });
        };
        const result = await new GatewayClient("ASAAS").checkout(input);
        assert.equal(result.id, "pay_qa");
        assert.ok(calls[0].url.includes("externalReference=pedido-qa"));
        const body = JSON.parse(calls.at(-1).init.body);
        assert.equal(body.externalReference, input.id);
        assert.equal(body.customer, "cus_qa");
        assert.equal(body.billingType, "UNDEFINED");
      },
    );
    await t.test(
      "Pagar.me usa centavos e estorna cobranças do pedido",
      async () => {
        calls.length = 0;
        globalThis.fetch = async (url, init) => {
          calls.push({ url: String(url), init });
          if (String(url).endsWith("/orders/or_qa"))
            return response({ charges: [{ id: "ch_qa", status: "paid" }] });
          return response({ id: "pl_qa", url: "https://checkout.pagar.me/qa" });
        };
        const gateway = new GatewayClient("PAGARME");
        await gateway.checkout(input);
        const body = JSON.parse(calls[0].init.body);
        assert.equal(body.cart_settings.items[0].amount, 1990);
        assert.deepEqual(body.payment_settings.accepted_payment_methods, [
          "credit_card",
          "boleto",
          "pix",
        ]);
        assert.equal(body.max_paid_sessions, 1);
        await gateway.reembolsar("or_qa", "reembolso-qa");
        assert.ok(calls.at(-1).url.endsWith("/charges/ch_qa"));
        assert.equal(calls.at(-1).init.method, "DELETE");
      },
    );
    await t.test(
      "Correios calcula preço e prazo com credencial no cabeçalho",
      async () => {
        calls.length = 0;
        globalThis.fetch = async (url, init) => {
          calls.push({ url: String(url), init });
          if (String(url).includes("/token/"))
            return response({
              token: "token-qa",
              expiraEm: new Date(Date.now() + 3600000).toISOString(),
            });
          if (String(url).includes("/preco/"))
            return response({ pcFinal: "15,90" });
          return response({ prazoEntrega: 5 });
        };
        const fretes = await new CorreiosClient().cotar(
          "78000000",
          "01001000",
          { pesoGramas: 500, alturaCm: 8, larguraCm: 12, comprimentoCm: 20 },
        );
        assert.equal(fretes.length, 2);
        assert.ok(
          fretes.every(
            (frete) => frete.valor === "15.90" && frete.prazoDias === 5,
          ),
        );
        assert.ok(
          calls
            .slice(1)
            .every(
              (call) => call.init.headers.Authorization === "Bearer token-qa",
            ),
        );
      },
    );
    await t.test(
      "Focus reutiliza referência e bloqueia download fora da origem do provedor",
      async () => {
        calls.length = 0;
        globalThis.fetch = async (url, init) => {
          calls.push({ url: String(url), init });
          return response({ status: "processando_autorizacao" });
        };
        const focus = new FocusClient("homologacao");
        await focus.emitir("NFE", "ref-qa", { total: "19.90" });
        assert.ok(
          calls[0].url.startsWith(
            "https://homologacao.focusnfe.com.br/v2/nfe?ref=ref-qa",
          ),
        );
        await assert.rejects(
          focus.baixar("https://externo.invalid/documento.xml"),
          IntegrationError,
        );
        assert.equal(calls.length, 1);
      },
    );
    await t.test(
      "Falhas temporárias são identificadas para nova tentativa",
      async () => {
        globalThis.fetch = async () => new Response("", { status: 429 });
        await assert.rejects(
          requestJson("QA", "https://example.invalid"),
          (error) =>
            error instanceof IntegrationError &&
            error.retryable &&
            error.status === 429,
        );
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (old[key] === undefined) delete process.env[key];
      else process.env[key] = old[key];
    }
  }
});

test("XML preserva códigos e lotes, recusa entidades externas e exporta ZIP interoperável", () => {
  const chave = "35261111444777000161550010000009001000000001";
  const xml = `<nfeProc><NFe><infNFe Id="NFe${chave}"><ide><nNF>900</nNF><dhEmi>2026-11-17T10:00:00-04:00</dhEmi></ide><emit><CNPJ>11444777000161</CNPJ><xNome>Fornecedor &amp; Cia</xNome></emit><dest><CNPJ>11222333000181</CNPJ></dest><det><prod><cProd>001</cProd><xProd>Creme</xProd><NCM>03304999</NCM><uCom>UN</uCom><qCom>2.0000</qCom><vUnCom>4.0000</vUnCom><vProd>8.00</vProd><rastro><nLote>A</nLote><qLote>1.000</qLote><dVal>2030-01-01</dVal></rastro><rastro><nLote>B</nLote><qLote>1.000</qLote><dVal>2030-02-01</dVal></rastro></prod></det><total><ICMSTot><vProd>8.00</vProd><vFrete>2.00</vFrete><vDesc>1.00</vDesc><vNF>9.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>${chave}</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>`;
  const nota = lerNfe(xml);
  assert.equal(nota.itens[0].codigoFornecedor, "001");
  assert.equal(nota.itens[0].ncm, "03304999");
  assert.equal(nota.itens[0].lotes.length, 2);
  assert.equal(nota.fornecedorNome, "Fornecedor & Cia");
  assert.equal(nota.despesas, "2.00");
  assert.throws(
    () =>
      lerNfe('<!DOCTYPE x [<!ENTITY a SYSTEM "file:///etc/passwd">]>' + xml),
    /XML inválido/,
  );
  const zip = xmlZip([{ nome: "nota.xml", xml }]);
  const result = execFileSync(
    "python",
    [
      "-c",
      "import io,sys,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; assert z.namelist()==['nota.xml']; print(z.read('nota.xml').decode('utf-8'))",
    ],
    { input: zip, encoding: "utf8" },
  );
  assert.equal(result.trim(), xml);
});
