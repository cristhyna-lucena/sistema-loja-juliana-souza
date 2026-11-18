"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  formatPrice,
  checkoutSchema,
  type CheckoutLojaInput,
  type LojaProdutoDTO,
} from "@sistema/shared";
import {
  ShopFrame,
  shopRequest,
  ShopError,
  useCart,
  useShopData,
  ShopPaymentMethods,
} from "./shop-common";

type Frete = {
  codigo: string;
  nome: string;
  valor: string;
  prazoDias: number | null;
};
type Config = {
  gateways: { codigo: string; nome: string; disponivel: boolean }[];
};
const enderecoInicial = {
  cep: "",
  logradouro: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "",
  uf: "",
  codigoIbge: "",
};
const pendingKey = "juliana-checkout-pendente";

export function ShopCheckout({ checkout = false }: { checkout?: boolean }) {
  const router = useRouter(),
    cart = useCart(),
    config = useShopData<Config>("configuracao");
  const [produtos, setProdutos] = useState<LojaProdutoDTO[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [endereco, setEndereco] = useState(enderecoInicial),
    [fretes, setFretes] = useState<Frete[]>([]),
    [servicoFrete, setServicoFrete] = useState(""),
    [gateway, setGateway] = useState("MERCADO_PAGO");
  const [cpfNaNota, setCpfNaNota] = useState(false),
    [notaPorEmail, setNotaPorEmail] = useState(true),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<CheckoutLojaInput | null>(null);
  const running = useRef(false),
    [quoteBusy, setQuoteBusy] = useState(false);
  const cartSignature = JSON.stringify(cart.itens);
  useEffect(() => {
    if (!cart.ready) return;
    const controller = new AbortController();
    setLoading(true);
    setFretes([]);
    setServicoFrete("");
    Promise.all(
      cart.itens.map((item) =>
        shopRequest<LojaProdutoDTO>(
          "produtos/" + encodeURIComponent(item.slug),
          undefined,
          controller.signal,
        ),
      ),
    )
      .then((rows) => {
        if (!controller.signal.aborted) {
          setProdutos(rows);
          setError("");
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [cart.ready, cartSignature]);
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(pendingKey);
      if (stored && checkout) {
        const result = checkoutSchema.safeParse(JSON.parse(stored));
        if (!result.success) {
          sessionStorage.removeItem(pendingKey);
          return;
        }
        const input = result.data;
        setPending(input);
        setEndereco(input.endereco);
        setGateway(input.gateway);
        setCpfNaNota(input.cpfNaNota);
        setNotaPorEmail(input.notaPorEmail);
      }
    } catch {
      setError(
        "Não foi possível recuperar o pedido pendente. Confira seus pedidos na área Minha conta.",
      );
    }
  }, [checkout]);
  function alterarEndereco(field: keyof typeof enderecoInicial, value: string) {
    setEndereco((current) => ({
      ...current,
      [field]: value,
      ...(field === "cep" ? { codigoIbge: "" } : {}),
    }));
    if (field === "cep") {
      setFretes([]);
      setServicoFrete("");
    }
  }
  async function buscarCep() {
    if (!checkout || !/^\d{8}$/.test(endereco.cep)) return;
    const cep = endereco.cep;
    try {
      const result = await shopRequest<
        Pick<
          typeof enderecoInicial,
          "cep" | "logradouro" | "bairro" | "cidade" | "uf" | "codigoIbge"
        >
      >("cep/" + cep);
      setEndereco((current) =>
        current.cep === cep ? { ...current, ...result } : current,
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Não foi possível consultar o CEP.",
      );
    }
  }
  async function calcularFrete() {
    setQuoteBusy(true);
    setError("");
    try {
      if (checkout && !endereco.codigoIbge) await buscarCep();
      const result = await shopRequest<{ fretes: Frete[] }>("frete", {
        cep: endereco.cep.replace(/\D/g, ""),
        itens: cart.itens.map(({ produtoId, quantidade }) => ({
          produtoId,
          quantidade,
        })),
      });
      setFretes(result.fretes);
      setServicoFrete(result.fretes[0]?.codigo ?? "");
      if (!result.fretes.length)
        setError(
          "A loja ainda precisa configurar as opções de entrega para este pedido.",
        );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Não foi possível calcular o frete.",
      );
    } finally {
      setQuoteBusy(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    const input = pending ?? {
      chaveOperacao: crypto.randomUUID(),
      itens: cart.itens.map(({ produtoId, quantidade }) => ({
        produtoId,
        quantidade,
      })),
      endereco: { ...endereco, cep: endereco.cep.replace(/\D/g, "") },
      gateway: gateway as CheckoutLojaInput["gateway"],
      servicoFrete,
      cpfNaNota,
      notaPorEmail,
    };
    try {
      sessionStorage.setItem(pendingKey, JSON.stringify(input));
      setPending(input);
      const result = await shopRequest<{ id: string }>("checkout", input);
      sessionStorage.removeItem(pendingKey);
      setPending(null);
      cart.salvar([]);
      router.push("/pedido/" + result.id);
    } catch (error) {
      if (
        error instanceof ShopError &&
        error.status < 500 &&
        error.status !== 401
      ) {
        sessionStorage.removeItem(pendingKey);
        setPending(null);
      }
      if (error instanceof ShopError && error.status === 401)
        router.push("/entrar?retorno=checkout");
      else
        setError(
          error instanceof Error
            ? error.message
            : "A resposta não foi confirmada. Reenvie o mesmo pedido.",
        );
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  const totalCentavos = cart.itens.reduce((sum, item) => {
    const produto = produtos.find((produto) => produto.id === item.produtoId);
    return (
      sum +
      (produto
        ? BigInt(produto.preco.replace(".", "")) * BigInt(item.quantidade)
        : 0n)
    );
  }, 0n);
  const entrega = fretes.find((frete) => frete.codigo === servicoFrete);
  const formatCentavos = (value: bigint) =>
    formatPrice(
      (value / 100n).toString() +
        "." +
        (value % 100n).toString().padStart(2, "0"),
    );
  const invalido =
    produtos.length !== cart.itens.length ||
    cart.itens.some(
      (item) =>
        item.quantidade >
        Number(
          produtos.find((produto) => produto.id === item.produtoId)
            ?.disponivel ?? "0",
        ),
    );
  return (
    <ShopFrame>
      <h1>{checkout ? "Finalizar pedido" : "Carrinho"}</h1>
      {loading && <p role="status">Atualizando produtos e preços…</p>}
      {!cart.itens.length && !pending ? (
        <p>
          Seu carrinho está vazio.{" "}
          <Link href="/produtos">Conheça os produtos</Link>
        </p>
      ) : (
        <>
          <div className="shop-cart">
            {cart.itens.map((item) => {
              const produto = produtos.find(
                (produto) => produto.id === item.produtoId,
              );
              return (
                <article key={item.produtoId}>
                  <div>
                    <Link href={"/p/" + item.slug}>{item.nome}</Link>
                    <p>
                      {produto
                        ? formatPrice(produto.preco)
                        : "Produto indisponível"}
                    </p>
                  </div>
                  <div>
                    <label htmlFor={"quantidade-" + item.produtoId}>
                      Quantidade de {item.nome}
                    </label>
                    <input
                      id={"quantidade-" + item.produtoId}
                      type="number"
                      min={1}
                      max={1000}
                      disabled={busy || !!pending}
                      value={item.quantidade}
                      onChange={(event) => {
                        const quantidade = Number(event.target.value);
                        if (
                          Number.isInteger(quantidade) &&
                          quantidade >= 1 &&
                          quantidade <= 1000
                        )
                          cart.salvar(
                            cart.itens.map((row) =>
                              row.produtoId === item.produtoId
                                ? { ...row, quantidade }
                                : row,
                            ),
                          );
                      }}
                    />
                  </div>
                  <button
                    className="shop-secondary"
                    disabled={busy || !!pending}
                    onClick={() =>
                      cart.salvar(
                        cart.itens.filter(
                          (row) => row.produtoId !== item.produtoId,
                        ),
                      )
                    }
                  >
                    Remover {item.nome}
                  </button>
                  {produto && item.quantidade > Number(produto.disponivel) && (
                    <p role="alert">Quantidade acima do estoque disponível.</p>
                  )}
                </article>
              );
            })}
          </div>
          <p className="shop-price">Subtotal {formatCentavos(totalCentavos)}</p>
          <form
            className="shop-form"
            onSubmit={
              checkout
                ? submit
                : (event) => {
                    event.preventDefault();
                    void calcularFrete();
                  }
            }
          >
            <fieldset disabled={busy || !!pending}>
              <h2>Entrega</h2>
              <div className="shop-form-grid">
                <div>
                  <label htmlFor="cep-entrega">CEP</label>
                  <input
                    id="cep-entrega"
                    onBlur={buscarCep}
                    inputMode="numeric"
                    required
                    pattern="[0-9]{8}"
                    maxLength={8}
                    value={endereco.cep}
                    onChange={(event) =>
                      alterarEndereco(
                        "cep",
                        event.target.value.replace(/\D/g, ""),
                      )
                    }
                  />
                </div>
                {checkout &&
                  (
                    [
                      ["logradouro", "Logradouro"],
                      ["numero", "Número"],
                      ["complemento", "Complemento"],
                      ["bairro", "Bairro"],
                      ["cidade", "Cidade"],
                      ["uf", "UF"],
                    ] as const
                  ).map(([field, label]) => (
                    <div key={field}>
                      <label htmlFor={"entrega-" + field}>{label}</label>
                      <input
                        id={"entrega-" + field}
                        required={field !== "complemento"}
                        maxLength={field === "uf" ? 2 : 160}
                        value={endereco[field]}
                        onChange={(event) =>
                          alterarEndereco(
                            field,
                            field === "uf"
                              ? event.target.value.toUpperCase()
                              : event.target.value,
                          )
                        }
                      />
                    </div>
                  ))}
              </div>
              <button
                type={checkout ? "button" : "submit"}
                disabled={quoteBusy || loading || invalido}
                onClick={checkout ? calcularFrete : undefined}
              >
                {quoteBusy ? "Calculando…" : "Calcular frete"}
              </button>
              {!!fretes.length && (
                <div>
                  <label htmlFor="servico-frete">Opção de entrega</label>
                  <select
                    id="servico-frete"
                    required
                    value={servicoFrete}
                    onChange={(event) => setServicoFrete(event.target.value)}
                  >
                    {fretes.map((frete) => (
                      <option value={frete.codigo} key={frete.codigo}>
                        {frete.nome} · {formatPrice(frete.valor)}
                        {frete.prazoDias !== null
                          ? " · " + frete.prazoDias + " dias úteis"
                          : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {checkout && (
                <>
                  <h2>Pagamento</h2>
                  <label htmlFor="gateway">Provedor de pagamento</label>
                  <select
                    id="gateway"
                    value={gateway}
                    onChange={(event) => setGateway(event.target.value)}
                  >
                    {config.data?.gateways.map((provider) => (
                      <option
                        key={provider.codigo}
                        value={provider.codigo}
                        disabled={!provider.disponivel}
                      >
                        {provider.nome}
                        {!provider.disponivel ? " · Em configuração" : ""}
                      </option>
                    ))}
                  </select>
                  <ShopPaymentMethods
                    configurado={
                      config.data
                        ? config.data.gateways.some(
                            (provider) => provider.disponivel,
                          )
                        : null
                    }
                  />
                  <label className="shop-checkbox">
                    <input
                      type="checkbox"
                      checked={cpfNaNota}
                      onChange={(event) => setCpfNaNota(event.target.checked)}
                    />
                    Incluir meu CPF/CNPJ na nota
                  </label>
                  <label className="shop-checkbox">
                    <input
                      type="checkbox"
                      checked={notaPorEmail}
                      onChange={(event) =>
                        setNotaPorEmail(event.target.checked)
                      }
                    />
                    Receber nota por e-mail
                  </label>
                </>
              )}
            </fieldset>
            {entrega && (
              <p className="shop-price">
                Total {formatCentavos(totalCentavos + centavos(entrega.valor))}
              </p>
            )}
            {pending && (
              <p role="status">
                Há um pedido aguardando confirmação da resposta. Reenvie para
                conferir o resultado. Você também pode consultar{" "}
                <Link href="/conta">seus pedidos</Link>.
              </p>
            )}
            {checkout && (
              <button
                disabled={
                  busy ||
                  (!pending &&
                    (loading ||
                      invalido ||
                      !entrega ||
                      !config.data?.gateways.some(
                        (provider) =>
                          provider.codigo === gateway && provider.disponivel,
                      )))
                }
              >
                {busy
                  ? "Confirmando…"
                  : pending
                    ? "Reenviar pedido"
                    : "Confirmar pedido e seguir para pagamento"}
              </button>
            )}
          </form>
          {!checkout && (
            <Link className="shop-button" href="/checkout">
              Continuar para checkout
            </Link>
          )}
        </>
      )}
      {[error, cart.error, config.error]
        .filter(Boolean)
        .map((message, index) => (
          <p role="alert" key={index}>
            {message}
          </p>
        ))}
      <Link href="/produtos">Continuar comprando</Link>
    </ShopFrame>
  );
}

function centavos(value: string) {
  const [inteiro, decimal = ""] = value.split(".");
  return BigInt(inteiro) * 100n + BigInt(decimal.padEnd(2, "0"));
}
