"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { formatPrice, type CheckoutServicoInput } from "@sistema/shared";
import {
  ShopFrame,
  ShopError,
  shopRequest,
  useShopData,
  ShopPaymentMethods,
} from "./shop-common";
type Servico = {
  id: string;
  nome: string;
  descricao: string | null;
  preco: string;
  duracaoMin: number;
  validadeDias: number;
};
export function ShopServices() {
  const data = useShopData<Servico[]>("servicos");
  return (
    <ShopFrame>
      <h1>Serviços e cuidados</h1>
      {data.error && <p role="alert">{data.error}</p>}
      {data.loading && <p role="status">Carregando serviços…</p>}
      <div className="shop-products">
        {data.data?.map((servico) => (
          <article className="shop-product-card" key={servico.id}>
            <h2>{servico.nome}</h2>
            <p>{servico.descricao}</p>
            <p>Duração de {servico.duracaoMin} minutos</p>
            <p className="shop-price">{formatPrice(servico.preco)}</p>
            <Link className="shop-button" href={"/servicos/" + servico.id}>
              Ver serviço
            </Link>
          </article>
        ))}
      </div>
      {!data.loading && data.data?.length === 0 && (
        <p>Os serviços disponíveis serão apresentados aqui.</p>
      )}
    </ShopFrame>
  );
}
export function ShopService({ id }: { id: string }) {
  const router = useRouter(),
    data = useShopData<Servico>("servicos/" + encodeURIComponent(id)),
    config = useShopData<{
      gateways: { codigo: string; nome: string; disponivel: boolean }[];
    }>("configuracao");
  const [quantidade, setQuantidade] = useState(1),
    [gateway, setGateway] = useState("MERCADO_PAGO"),
    [notaPorEmail, setNotaPorEmail] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<CheckoutServicoInput | null>(null);
  const running = useRef(false),
    key = "juliana-servico-pendente-" + id;
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(key);
      if (saved) {
        const input = JSON.parse(saved) as CheckoutServicoInput;
        setPending(input);
        setQuantidade(input.quantidade);
        setGateway(input.gateway);
        setNotaPorEmail(input.notaPorEmail);
      }
    } catch {
      setError(
        "Confira os pedidos em Minha conta antes de iniciar outra compra.",
      );
    }
  }, [key]);
  async function comprar(event: FormEvent) {
    event.preventDefault();
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    const input: CheckoutServicoInput = pending ?? {
      chaveOperacao: crypto.randomUUID(),
      servicoId: id,
      quantidade,
      gateway: gateway as CheckoutServicoInput["gateway"],
      notaPorEmail,
    };
    try {
      sessionStorage.setItem(key, JSON.stringify(input));
      setPending(input);
      const result = await shopRequest<{ id: string }>(
        "checkout-servico",
        input,
      );
      sessionStorage.removeItem(key);
      router.push("/pedido/" + result.id);
    } catch (error) {
      if (
        error instanceof ShopError &&
        error.status < 500 &&
        error.status !== 401
      ) {
        sessionStorage.removeItem(key);
        setPending(null);
      }
      if (error instanceof ShopError && error.status === 401)
        router.push("/entrar?servicoId=" + encodeURIComponent(id));
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
  return (
    <ShopFrame>
      {data.error ? (
        <p role="alert">{data.error}</p>
      ) : !data.data ? (
        <p role="status">Carregando serviço…</p>
      ) : (
        <>
          <h1>{data.data.nome}</h1>
          <p className="shop-description">{data.data.descricao}</p>
          <p>
            Duração de {data.data.duracaoMin} minutos. O voucher vale por{" "}
            {data.data.validadeDias} dias após a confirmação do pagamento.
          </p>
          <p className="shop-price">{formatPrice(data.data.preco)}</p>
          <form className="shop-form" onSubmit={comprar}>
            <fieldset disabled={busy || !!pending}>
              <label htmlFor="quantidade-vouchers">
                Quantidade de vouchers
              </label>
              <input
                id="quantidade-vouchers"
                type="number"
                required
                min={1}
                max={10}
                value={quantidade}
                onChange={(event) => setQuantidade(Number(event.target.value))}
              />
              <label htmlFor="gateway-servico">Provedor de pagamento</label>
              <select
                id="gateway-servico"
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
                  checked={notaPorEmail}
                  onChange={(event) => setNotaPorEmail(event.target.checked)}
                />
                Receber nota por e-mail
              </label>
            </fieldset>
            {pending && (
              <p role="status">Reenvie o pedido para confirmar a resposta.</p>
            )}
            {error && <p role="alert">{error}</p>}
            {config.error && <p role="alert">{config.error}</p>}
            <button
              disabled={
                busy ||
                (!pending &&
                  !config.data?.gateways.some(
                    (provider) =>
                      provider.codigo === gateway && provider.disponivel,
                  ))
              }
            >
              {busy
                ? "Confirmando…"
                : pending
                  ? "Reenviar pedido"
                  : "Comprar voucher"}
            </button>
            <p>
              Seus códigos ficarão disponíveis na área Minha conta após a
              confirmação do pagamento.
            </p>
          </form>
        </>
      )}
    </ShopFrame>
  );
}
