"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { formatPrice } from "@sistema/shared";
import { ShopFrame, shopRequest, useShopData } from "./shop-common";

const statusPedido: Record<string, string> = {
  AGUARDANDO_PAGAMENTO: "Aguardando pagamento",
  PAGO: "Pagamento confirmado",
  FATURADO: "Nota emitida",
  ENVIADO: "Enviado",
  ENTREGUE: "Entregue",
  EXPIRADO: "Prazo de pagamento encerrado",
  CANCELADO: "Cancelado",
  REEMBOLSO_PENDENTE: "Reembolso em processamento",
  REEMBOLSO_SOLICITADO: "Reembolso solicitado",
  REEMBOLSADO: "Pagamento reembolsado",
};

export function ShopLogin({ cadastro = false }: { cadastro?: boolean }) {
  const [retornoQuery, setRetornoQuery] = useState("");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("servicoId");
    setRetornoQuery(
      id && /^[A-Za-z0-9_-]{1,80}$/.test(id)
        ? "?servicoId=" + encodeURIComponent(id)
        : params.get("retorno") === "checkout"
          ? "?retorno=checkout"
          : "",
    );
  }, []);
  const router = useRouter();
  const [nome, setNome] = useState(""),
    [email, setEmail] = useState(""),
    [senha, setSenha] = useState(""),
    [documento, setDocumento] = useState(""),
    [telefone, setTelefone] = useState(""),
    [consentimento, setConsentimento] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await shopRequest(
        cadastro ? "cadastro" : "login",
        cadastro
          ? {
              nome,
              email,
              senha,
              cpfCnpj: documento,
              telefone: telefone || null,
              consentimento,
            }
          : { email, senha },
      );
      const retorno = new URLSearchParams(window.location.search).get(
        "retorno",
      );
      const servicoId = new URLSearchParams(window.location.search).get(
        "servicoId",
      );
      router.push(
        servicoId && /^[A-Za-z0-9_-]{1,80}$/.test(servicoId)
          ? "/servicos/" + servicoId
          : retorno === "checkout"
            ? "/checkout"
            : "/conta",
      );
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Não foi possível entrar.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <ShopFrame>
      <div className="shop-account-form">
        <h1>{cadastro ? "Criar conta" : "Entrar na sua conta"}</h1>
        <form className="shop-form" onSubmit={submit}>
          <fieldset disabled={busy}>
            {cadastro && (
              <>
                <label htmlFor="nome-cliente">Nome completo</label>
                <input
                  id="nome-cliente"
                  autoComplete="name"
                  required
                  maxLength={160}
                  value={nome}
                  onChange={(event) => setNome(event.target.value)}
                />
                <label htmlFor="documento-cliente">CPF/CNPJ</label>
                <input
                  id="documento-cliente"
                  required
                  maxLength={18}
                  value={documento}
                  onChange={(event) => setDocumento(event.target.value)}
                />
                <label htmlFor="telefone-cliente">Telefone</label>
                <input
                  id="telefone-cliente"
                  autoComplete="tel"
                  type="tel"
                  maxLength={25}
                  value={telefone}
                  onChange={(event) => setTelefone(event.target.value)}
                />
              </>
            )}
            <label htmlFor="email-cliente">E-mail</label>
            <input
              id="email-cliente"
              type="email"
              required
              maxLength={254}
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <label htmlFor="senha-cliente">Senha</label>
            <input
              id="senha-cliente"
              type="password"
              required
              minLength={cadastro ? 12 : 1}
              maxLength={128}
              autoComplete={cadastro ? "new-password" : "current-password"}
              value={senha}
              onChange={(event) => setSenha(event.target.value)}
            />
            {cadastro && (
              <label className="shop-checkbox">
                <input
                  type="checkbox"
                  required
                  checked={consentimento}
                  onChange={(event) => setConsentimento(event.target.checked)}
                />
                Li as informações sobre o uso dos meus dados na{" "}
                <Link href="/privacidade">política de privacidade</Link>.
              </label>
            )}
          </fieldset>
          {error && <p role="alert">{error}</p>}
          <button disabled={busy}>
            {busy ? "Aguarde…" : cadastro ? "Criar conta" : "Entrar"}
          </button>
        </form>
        {!cadastro && (
          <p>
            <Link href="/recuperar-senha">Esqueci minha senha</Link>
          </p>
        )}
        <Link href={(cadastro ? "/entrar" : "/cadastro") + retornoQuery}>
          {cadastro ? "Já tenho conta" : "Criar uma conta"}
        </Link>
      </div>
    </ShopFrame>
  );
}

type Account = {
  cliente: { nome: string; email: string };
  pedidos: { id: string; numero: number; total: string; status: string }[];
  vouchers: {
    codigo: string;
    servicoNome: string;
    status: string;
    validoAte: string;
  }[];
};
export function ShopAccount() {
  const router = useRouter(),
    data = useShopData<Account>("conta");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirmar, setConfirmar] = useState(false);
  async function sair() {
    setBusy(true);
    try {
      await shopRequest("logout", {});
      router.push("/entrar");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Erro ao sair.");
    } finally {
      setBusy(false);
    }
  }
  async function encerrar() {
    setBusy(true);
    try {
      await shopRequest("conta/encerrar", {});
      router.push("/entrar");
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Erro ao encerrar conta.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <ShopFrame>
      <h1>Minha conta</h1>
      {data.error ? (
        <p role="alert">
          {data.error} <Link href="/entrar">Entrar</Link>
        </p>
      ) : !data.data ? (
        <p role="status">Carregando sua conta…</p>
      ) : (
        <>
          <p>Olá, {data.data.cliente.nome}.</p>
          <p>{data.data.cliente.email}</p>
          <button className="shop-secondary" disabled={busy} onClick={sair}>
            Sair da conta
          </button>
          <h2>Seus pedidos</h2>
          {data.data.pedidos.length ? (
            <div className="shop-table">
              <table>
                <thead>
                  <tr>
                    <th>Pedido</th>
                    <th>Situação</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.pedidos.map((pedido) => (
                    <tr key={pedido.id}>
                      <td>
                        <Link href={"/pedido/" + pedido.id}>
                          Pedido {pedido.numero}
                        </Link>
                      </td>
                      <td>{statusPedido[pedido.status] ?? pedido.status}</td>
                      <td>{formatPrice(pedido.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>Você ainda não tem pedidos na loja online.</p>
          )}
          <h2>Seus vouchers</h2>
          {data.data.vouchers.length ? (
            data.data.vouchers.map((voucher) => (
              <article className="shop-card" key={voucher.codigo}>
                <h3>{voucher.servicoNome}</h3>
                <p>Código {voucher.codigo}</p>
                <p>
                  Validade{" "}
                  {voucher.validoAte
                    .slice(0, 10)
                    .split("-")
                    .reverse()
                    .join("/")}
                </p>
                <p>
                  {
                    {
                      ATIVO: "Disponível",
                      USADO: "Utilizado",
                      CANCELADO: "Cancelado",
                    }[voucher.status]
                  }
                </p>
              </article>
            ))
          ) : (
            <p>Você ainda não tem vouchers.</p>
          )}
          <details>
            <summary>Encerrar minha conta</summary>
            <p>
              O encerramento desativa seu acesso. Os registros das compras
              permanecem no histórico da loja.
            </p>
            <label className="shop-checkbox">
              <input
                type="checkbox"
                checked={confirmar}
                onChange={(event) => setConfirmar(event.target.checked)}
              />
              Quero encerrar minha conta.
            </label>
            <button disabled={!confirmar || busy} onClick={encerrar}>
              Confirmar encerramento da conta
            </button>
          </details>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </ShopFrame>
  );
}

type Pedido = {
  id: string;
  numero: number;
  status: string;
  total: string;
  subtotal: string;
  frete: string;
  checkoutUrl: string | null;
  expiresAt: string;
  rastreio: string | null;
  itens: {
    produtoId?: string;
    servicoId?: string;
    nome: string;
    quantidade: number;
    total: string;
  }[];
  eventos: { descricao: string; dtHrCriado: string }[] | null;
};
export function ShopOrder({ id }: { id: string }) {
  const data = useShopData<Pedido>("pedidos/" + encodeURIComponent(id));
  useEffect(() => {
    if (data.data?.status !== "AGUARDANDO_PAGAMENTO") return;
    const timer = setInterval(data.reload, 5000);
    return () => clearInterval(timer);
  }, [data.data?.status]);
  const pedido = data.data;
  return (
    <ShopFrame>
      {data.error ? (
        <p role="alert">
          {data.error} <Link href="/entrar">Entrar na sua conta</Link>
        </p>
      ) : !pedido ? (
        <p role="status">Carregando pedido…</p>
      ) : (
        <>
          <h1>Pedido {pedido.numero}</h1>
          <p role="status">{statusPedido[pedido.status] ?? pedido.status}</p>
          <div className="shop-card">
            {pedido.itens.map((item) => (
              <p key={item.produtoId ?? item.servicoId}>
                {item.quantidade} × {item.nome} · {formatPrice(item.total)}
              </p>
            ))}
            <p>Produtos {formatPrice(pedido.subtotal)}</p>
            <p>Frete {formatPrice(pedido.frete)}</p>
            <strong className="shop-price">
              Total {formatPrice(pedido.total)}
            </strong>
          </div>
          {pedido.status === "AGUARDANDO_PAGAMENTO" && (
            <section>
              <h2>Pagamento</h2>
              {pedido.checkoutUrl ? (
                <a
                  className="shop-button"
                  href={pedido.checkoutUrl}
                  rel="noreferrer"
                >
                  Abrir pagamento
                </a>
              ) : (
                <p>
                  Preparando o pagamento. Esta página será atualizada
                  automaticamente.
                </p>
              )}
              <p>
                Pagamento disponível até{" "}
                {new Date(pedido.expiresAt).toLocaleString("pt-BR", {
                  timeZone: "America/Cuiaba",
                })}
                .
              </p>
            </section>
          )}
          {pedido.rastreio && (
            <section>
              <h2>Acompanhe a entrega</h2>
              <p>Código de rastreio {pedido.rastreio}</p>
              <ol>
                {pedido.eventos?.map((evento, index) => (
                  <li key={index}>
                    {evento.descricao} · {evento.dtHrCriado}
                  </li>
                ))}
              </ol>
            </section>
          )}
          <div className="shop-actions">
            <button onClick={data.reload}>Atualizar pedido</button>
            <Link href="/conta">Todos os pedidos</Link>
            <Link href="/trocas">Falar com a loja</Link>
          </div>
        </>
      )}
    </ShopFrame>
  );
}
