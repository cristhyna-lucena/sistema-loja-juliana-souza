"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { formatPrice } from "@sistema/shared";
import { useComercialAction, useComercialData } from "../lib/comercial-client";
import { CommercialFeedback } from "./comercial-common";
const statuses: Record<string, string> = {
  AGUARDANDO_PAGAMENTO: "Aguardando pagamento",
  PAGO: "Pago",
  FATURADO: "Nota emitida",
  ENVIADO: "Enviado",
  ENTREGUE: "Entregue",
  EXPIRADO: "Expirado",
  CANCELADO: "Cancelado",
  REEMBOLSO_PENDENTE: "Reembolso pendente",
  REEMBOLSO_SOLICITADO: "Reembolso solicitado",
  REEMBOLSADO: "Reembolsado",
};
type Pedido = {
  id: string;
  numero: number;
  status: string;
  total: string;
  gateway: string;
  vendaId: string | null;
  servicoFrete: string;
  cliente: { nome: string; email: string; cpfCnpj: string };
  endereco: {
    logradouro: string;
    numero: string;
    complemento: string;
    bairro: string;
    cidade: string;
    uf: string;
    cep: string;
  };
  itens: {
    produtoId: string;
    nome: string;
    quantidade: number;
    total: string;
  }[];
  rastreio: string | null;
  etiquetaUrl: string | null;
  notas: { id: string; modelo: string; status: string }[];
  eventos: { descricao: string; dtHrCriado: string }[] | null;
};
export function OrdersList() {
  const [query, setQuery] = useState(""),
    [page, setPage] = useState(1);
  const data = useComercialData<{ itens: Pedido[]; pages: number }>(
    "pedidos?q=" + encodeURIComponent(query) + "&page=" + page,
  );
  return (
    <>
      <h1>Pedidos da loja</h1>
      <label htmlFor="buscar-pedido">Buscar por número ou cliente</label>
      <input
        id="buscar-pedido"
        maxLength={100}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setPage(1);
        }}
      />
      {data.error && <p role="alert">{data.error}</p>}
      {data.loading && <p role="status">Carregando pedidos…</p>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Pedido</th>
              <th>Situação</th>
              <th>Total</th>
              <th>Pagamento</th>
            </tr>
          </thead>
          <tbody>
            {data.data?.itens.map((pedido) => (
              <tr key={pedido.id}>
                <td>
                  <Link href={"/pedidos/" + pedido.id}>
                    Pedido {pedido.numero}
                  </Link>
                </td>
                <td>{statuses[pedido.status] ?? pedido.status}</td>
                <td>{formatPrice(pedido.total)}</td>
                <td>{pedido.gateway.replaceAll("_", " ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!data.loading && data.data?.itens.length === 0 && (
        <p>Nenhum pedido encontrado.</p>
      )}
      <div className="form-actions">
        <button
          className="secondary"
          disabled={page === 1}
          onClick={() => setPage(page - 1)}
        >
          Anterior
        </button>
        <span>
          Página {page} de {data.data?.pages ?? 1}
        </span>
        <button
          className="secondary"
          disabled={page >= (data.data?.pages ?? 1)}
          onClick={() => setPage(page + 1)}
        >
          Próxima
        </button>
      </div>
    </>
  );
}
export function OrderDetail({ id }: { id: string }) {
  const data = useComercialData<Pedido>("pedidos/" + id),
    action = useComercialAction();
  const [rastreio, setRastreio] = useState(""),
    [motivo, setMotivo] = useState(""),
    [codigoServico, setCodigoServico] = useState("03298"),
    [success, setSuccess] = useState("");
  async function executar(path: string, payload: object, mensagem: string) {
    if (await action.run(path, payload)) {
      data.reload();
      setSuccess(mensagem);
    }
  }
  async function enviar(event: FormEvent) {
    event.preventDefault();
    await executar(
      "pedidos/" + id + "/enviar",
      { rastreio: rastreio || data.data?.rastreio || "" },
      "Envio registrado.",
    );
  }
  async function cancelar(event: FormEvent) {
    event.preventDefault();
    await executar(
      "pedidos/" + id + "/cancelar",
      { motivo },
      "Cancelamento registrado. Acompanhe o reembolso quando houver pagamento.",
    );
  }
  if (data.error) return <p role="alert">{data.error}</p>;
  if (!data.data) return <p role="status">Carregando pedido…</p>;
  const pedido = data.data;
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Pedido {pedido.numero}</h1>
          <p>{statuses[pedido.status] ?? pedido.status}</p>
        </div>
        <button className="secondary" onClick={data.reload}>
          Atualizar pedido
        </button>
      </div>
      <CommercialFeedback error={action.error} uncertain={action.uncertain} />
      {success && <p role="status">{success}</p>}
      <section className="dashboard-card">
        <h2>{pedido.cliente.nome}</h2>
        <p>
          {pedido.cliente.email} · {pedido.cliente.cpfCnpj}
        </p>
        <p>
          {pedido.endereco.logradouro}, {pedido.endereco.numero}{" "}
          {pedido.endereco.complemento} · {pedido.endereco.bairro} ·{" "}
          {pedido.endereco.cidade}/{pedido.endereco.uf} · {pedido.endereco.cep}
        </p>
        {pedido.itens.map((item) => (
          <p key={item.produtoId}>
            {item.quantidade} × {item.nome} · {formatPrice(item.total)}
          </p>
        ))}
        <strong>{formatPrice(pedido.total)}</strong>
      </section>
      <div className="form-actions">
        {pedido.vendaId && (
          <Link href={"/vendas/" + pedido.vendaId}>
            Ver venda e recebimentos
          </Link>
        )}
        <Link href="/fiscal/emitidas">Emitir e acompanhar nota fiscal</Link>
      </div>
      {pedido.notas.map((nota) => (
        <p key={nota.id}>
          {nota.modelo} · {nota.status}
        </p>
      ))}
      {pedido.servicoFrete !== "SEM_ENTREGA" &&
        ["PAGO", "FATURADO"].includes(pedido.status) && (
          <>
            <section className="catalog-form">
              <h2>Etiqueta dos Correios</h2>
              <label htmlFor="servico-etiqueta">
                Código do serviço contratado
              </label>
              <input
                id="servico-etiqueta"
                required
                pattern="[0-9]{5}"
                maxLength={5}
                disabled={action.locked}
                value={codigoServico}
                onChange={(event) => setCodigoServico(event.target.value)}
              />
              <button
                disabled={action.busy}
                onClick={() =>
                  executar(
                    "pedidos/" + id + "/etiqueta",
                    { codigoServico },
                    "Etiqueta solicitada. Atualize o pedido para acompanhar.",
                  )
                }
              >
                Gerar etiqueta
              </button>
              {pedido.etiquetaUrl && (
                <a href={"/api/gestao/pedidos/" + id + "/etiqueta"}>
                  Baixar etiqueta em PDF
                </a>
              )}
            </section>
            <form className="catalog-form" onSubmit={enviar}>
              <h2>Registrar envio</h2>
              <label htmlFor="rastreio-pedido">Código de rastreio</label>
              <input
                id="rastreio-pedido"
                required
                maxLength={13}
                disabled={action.locked}
                value={rastreio || pedido.rastreio || ""}
                onChange={(event) =>
                  setRastreio(event.target.value.toUpperCase())
                }
              />
              <button disabled={action.busy}>Confirmar envio</button>
            </form>
          </>
        )}
      {pedido.rastreio && (
        <section>
          <h2>Rastreamento</h2>
          <p>{pedido.rastreio}</p>
          <ol>
            {pedido.eventos?.map((evento, index) => (
              <li key={index}>
                {evento.descricao} · {evento.dtHrCriado}
              </li>
            ))}
          </ol>
        </section>
      )}
      {![
        "CANCELADO",
        "REEMBOLSADO",
        "REEMBOLSO_PENDENTE",
        "REEMBOLSO_SOLICITADO",
      ].includes(pedido.status) && (
        <form className="catalog-form" onSubmit={cancelar}>
          <h2>Cancelar pedido</h2>
          <label htmlFor="motivo-cancelar-pedido">Motivo do cancelamento</label>
          <textarea
            id="motivo-cancelar-pedido"
            required
            minLength={3}
            maxLength={500}
            disabled={action.locked}
            value={motivo}
            onChange={(event) => setMotivo(event.target.value)}
          />
          <button disabled={action.busy}>
            Confirmar cancelamento do pedido
          </button>
        </form>
      )}
      <Link href="/pedidos">Voltar para pedidos</Link>
    </>
  );
}
