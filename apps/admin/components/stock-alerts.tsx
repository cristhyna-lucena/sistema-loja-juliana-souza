"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import type { AlertasEstoqueDTO } from "@sistema/shared";
import { gestaoRequest, formatQuantidade } from "../lib/gestao-client";
const nomes = { REPOSICAO: "Reposição", VENCIDO: "Vencido", A_VENCER: "A vencer" };
export function StockAlerts() {
  const [draft, setDraft] = useState({ q: "", tipo: "todos", dias: "30" });
  const [query, setQuery] = useState(draft), [page, setPage] = useState(1), [retry, setRetry] = useState(0);
  const [data, setData] = useState<AlertasEstoqueDTO | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    const params = new URLSearchParams({ ...query, page: String(page), pageSize: "20" });
    gestaoRequest<AlertasEstoqueDTO>("estoque/alertas?" + params, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Não foi possível carregar os alertas."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, page, retry]);
  function filtrar(e: FormEvent) { e.preventDefault(); setQuery({ ...draft }); setPage(1); }
  return <><Link className="back-link" href="/estoque">← Voltar para estoque</Link><div className="page-heading"><div><p className="eyebrow">GESTÃO DO ESTOQUE</p><h1>Alertas de estoque</h1><p className="muted">Confira o que precisa de reposição e os lotes que exigem atenção.</p></div></div>
    <form className="filter-bar stock-alert-filter" onSubmit={filtrar}><div><label htmlFor="busca-alerta">Buscar produto nos alertas</label><input id="busca-alerta" value={draft.q} onChange={e => setDraft(v => ({ ...v, q: e.target.value }))} maxLength={100} placeholder="Nome ou SKU"/></div><div><label htmlFor="tipo-alerta">Tipo de alerta</label><select id="tipo-alerta" value={draft.tipo} onChange={e => setDraft(v => ({ ...v, tipo: e.target.value }))}><option value="todos">Todos</option><option value="REPOSICAO">Reposição</option><option value="VENCIDO">Vencidos</option><option value="A_VENCER">A vencer</option></select></div><div><label htmlFor="dias-alerta">Prazo de validade</label><select id="dias-alerta" value={draft.dias} onChange={e => setDraft(v => ({ ...v, dias: e.target.value }))}>{[0,7,15,30,60,90,180,365].map(d => <option key={d} value={String(d)}>{d === 0 ? "Até hoje" : "Próximos " + d + " dias"}</option>)}</select></div><button type="submit">Filtrar alertas</button></form>
    {error ? <section className="notice"><p role="alert">{error}</p><button className="secondary" onClick={() => setRetry(v => v + 1)}>Tentar novamente</button></section> : loading ? <p role="status">Carregando alertas…</p> : data && <>
      <section className="stock-summary" aria-label="Resumo dos alertas"><article className="metric-card"><p>Produtos para repor</p><strong className="metric-value">{data.resumo.reposicao}</strong><span>Saldo no mínimo ou abaixo</span></article><article className="metric-card"><p>Lotes vencidos</p><strong className="metric-value">{data.resumo.vencidos}</strong><span>Com saldo em estoque</span></article><article className="metric-card"><p>Lotes a vencer</p><strong className="metric-value">{data.resumo.aVencer}</strong><span>{data.dias === 0 ? "Vencem hoje" : "Nos próximos " + data.dias + " dias, incluindo hoje"}</span></article></section>
      <p className="muted">Referência: {data.dataReferencia.split("-").reverse().join("/")} · Cuiabá. Os totais acompanham a busca e o prazo selecionado, abrangendo todos os tipos de alerta.</p>
      {data.itens.length ? <><div className="table-scroll stock-alert-table" tabIndex={0} role="region" aria-label="Alertas de estoque, com rolagem horizontal"><table><thead><tr><th>Produto</th><th>Alerta</th><th>Lote</th><th>Saldo</th><th>Mínimo</th><th>Validade</th><th>Ação</th></tr></thead><tbody>{data.itens.map(a => <tr key={a.produtoId + a.tipo + (a.loteId ?? "")}><td><strong>{a.nome}</strong><div className="sku-cell">{a.sku}</div></td><td><span className={"badge " + (a.tipo === "VENCIDO" ? "stock-danger" : "stock-warning")}>{nomes[a.tipo]}</span></td><td>{a.numero ?? "—"}</td><td>{formatQuantidade(a.saldo)} {a.unidade}</td><td>{a.tipo === "REPOSICAO" ? formatQuantidade(a.estoqueMinimo) + " " + a.unidade : "—"}</td><td>{a.validade?.split("-").reverse().join("/") ?? "—"}</td><td><Link href={"/estoque/" + a.produtoId} aria-label={"Gerenciar estoque de " + a.nome}>Gerenciar estoque</Link></td></tr>)}</tbody></table></div><p className="table-hint">Deslize a tabela para ver todas as colunas.</p><div className="pagination"><p>{data.total} alerta(s) · Página {data.page} de {data.pages}</p><div><button className="secondary" disabled={page <= 1} onClick={() => setPage(v => v - 1)}>Anterior</button><button className="secondary" disabled={page >= data.pages} onClick={() => setPage(v => v + 1)}>Próxima</button></div></div></> : <section className="notice empty-catalog"><h2>Nenhum alerta encontrado</h2><p>Ajuste os filtros ou confira os mínimos e validades cadastrados.</p>{page > 1 && <button onClick={() => setPage(1)}>Voltar à primeira página</button>}</section>}
    </>}
    <p className="muted">São considerados apenas produtos ativos. Alertas de validade exigem lote com saldo positivo. Estoque mínimo zero desativa o alerta de reposição.</p>
  </>;
}
