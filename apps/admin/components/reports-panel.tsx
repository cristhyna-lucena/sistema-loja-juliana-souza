"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { formatPrice } from "@sistema/shared";
import { useComercialData, diaLocal } from "../lib/comercial-client";

type Relatorio = {
  totalVendas: string;
  quantidadeVendas: number;
  ticketMedio: string;
  entradas: string;
  saidas: string;
  resultado: string;
  custoVendido: string | null;
  valorEstoque: string;
  estoquePendente: number;
  aPagar: string;
  aReceber: string;
  pedidosEnviar: number;
  notasRecebidas: number;
  vendasPorDia: { dia: string; quantidade: number; total: string }[];
  caixaPorDia: {
    dia: string;
    entradas: string;
    saidas: string;
    resultado: string;
  }[];
};
export function ManagementSummary() {
  const hoje = diaLocal(),
    data = useComercialData<Relatorio>(
      "relatorios?de=" + hoje + "&ate=" + hoje,
    );
  if (data.error) return <p role="alert">{data.error}</p>;
  if (!data.data) return <p role="status">Carregando indicadores…</p>;
  return (
    <section aria-label="Resumo da operação">
      <div className="stock-summary">
        {[
          ["Vendas de hoje", formatPrice(data.data.totalVendas)],
          ["A receber hoje", formatPrice(data.data.aReceber)],
          ["A pagar hoje", formatPrice(data.data.aPagar)],
          ["Pedidos a enviar", String(data.data.pedidosEnviar)],
          ["Notas aguardando entrada", String(data.data.notasRecebidas)],
        ].map(([label, valor]) => (
          <article className="metric-card" key={label}>
            <p>{label}</p>
            <strong className="stock-cost">{valor}</strong>
          </article>
        ))}
      </div>
      <Link href="/relatorios">Ver relatórios</Link>
    </section>
  );
}
export function ReportsPanel() {
  const hoje = diaLocal(),
    [de, setDe] = useState(hoje.slice(0, 7) + "-01"),
    [ate, setAte] = useState(hoje),
    [periodo, setPeriodo] = useState({ de, ate });
  const data = useComercialData<Relatorio>(
    "relatorios?" + new URLSearchParams(periodo),
  );
  function filtrar(event: FormEvent) {
    event.preventDefault();
    setPeriodo({ de, ate });
  }
  function exportar() {
    if (!data.data) return;
    const rows = [
      ["Data", "Entradas", "Saídas", "Resultado"],
      ...data.data.caixaPorDia.map((row) => [
        row.dia,
        row.entradas,
        row.saidas,
        row.resultado,
      ]),
    ];
    const csv =
      "\uFEFF" +
      rows
        .map((row) =>
          row.map((value) => '"' + value.replaceAll('"', '""') + '"').join(";"),
        )
        .join("\r\n");
    const url = URL.createObjectURL(
        new Blob([csv], { type: "text/csv;charset=utf-8" }),
      ),
      link = document.createElement("a");
    link.href = url;
    link.download = "fluxo-" + periodo.de + "-" + periodo.ate + ".csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <>
      <div className="page-heading">
        <h1>Relatórios</h1>
        <button className="secondary" disabled={!data.data} onClick={exportar}>
          Exportar fluxo em CSV
        </button>
      </div>
      <form className="filter-bar" onSubmit={filtrar}>
        <div>
          <label htmlFor="relatorio-de">Data inicial</label>
          <input
            id="relatorio-de"
            type="date"
            required
            value={de}
            onChange={(event) => setDe(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="relatorio-ate">Data final</label>
          <input
            id="relatorio-ate"
            type="date"
            required
            min={de}
            value={ate}
            onChange={(event) => setAte(event.target.value)}
          />
        </div>
        <button>Consultar período</button>
      </form>
      {data.error && <p role="alert">{data.error}</p>}
      {data.loading && <p role="status">Calculando relatório…</p>}
      {data.data && (
        <>
          <section className="stock-summary">
            {(
              [
                ["Vendas confirmadas", data.data.totalVendas],
                ["Ticket médio", data.data.ticketMedio],
                ["Entradas no período", data.data.entradas],
                ["Saídas no período", data.data.saidas],
                ["Resultado de caixa", data.data.resultado],
                ["A pagar no período", data.data.aPagar],
                ["A receber no período", data.data.aReceber],
                ["Custo dos produtos vendidos", data.data.custoVendido],
                ["Valor atual do estoque avaliado", data.data.valorEstoque],
              ] as const
            ).map(([label, valor]) => (
              <article className="metric-card" key={label}>
                <p>{label}</p>
                <strong className="stock-cost">
                  {valor === null ? "Custo pendente" : formatPrice(valor)}
                </strong>
              </article>
            ))}
          </section>
          <p>{data.data.quantidadeVendas} vendas confirmadas no período.</p>
          {data.data.estoquePendente > 0 && (
            <p role="status">
              {data.data.estoquePendente} produtos possuem avaliação de estoque
              pendente.
            </p>
          )}
          <h2>Vendas por dia</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Vendas</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {data.data.vendasPorDia.map((row) => (
                  <tr key={row.dia}>
                    <td>{row.dia}</td>
                    <td>{row.quantidade}</td>
                    <td>{formatPrice(row.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2>Caixa realizado por dia</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Entradas</th>
                  <th>Saídas</th>
                  <th>Resultado</th>
                </tr>
              </thead>
              <tbody>
                {data.data.caixaPorDia.map((row) => (
                  <tr key={row.dia}>
                    <td>{row.dia}</td>
                    <td>{formatPrice(row.entradas)}</td>
                    <td>{formatPrice(row.saidas)}</td>
                    <td>{formatPrice(row.resultado)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
