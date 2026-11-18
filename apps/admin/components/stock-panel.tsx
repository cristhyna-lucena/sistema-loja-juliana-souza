"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { loteSchema, movimentoSchema, estornoSchema, formatPrice, type Pagina, type ProdutoDTO } from "@sistema/shared";
import { gestaoRequest, formatQuantidade, type SaldoDTO, type MovimentoDTO } from "../lib/gestao-client";
import { CatalogError } from "../lib/catalogo-client";

const tipos = { ENTRADA: "Entrada", SAIDA: "Saída", AJUSTE: "Ajuste", ESTORNO: "Estorno" };
function mensagem(error: unknown) { if (error instanceof TypeError) return "Não foi possível confirmar a operação. Tente novamente mantendo os mesmos dados."; return error instanceof CatalogError && error.errors?.length ? error.errors.map(e => e.message).join(" ") : error instanceof Error ? error.message : "Não foi possível concluir a operação."; }
export function StockPanel({ produto }: { produto: ProdutoDTO }) {
  const path = "estoque/produtos/" + produto.id;
  const [saldo, setSaldo] = useState<SaldoDTO | null>(null), [historico, setHistorico] = useState<Pagina<MovimentoDTO> | null>(null);
  const [page, setPage] = useState(1), [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(""), [error, setError] = useState(""), [success, setSuccess] = useState("");
  const [tipo, setTipo] = useState<"ENTRADA" | "SAIDA" | "AJUSTE">("ENTRADA"), [quantidade, setQuantidade] = useState(""), [loteId, setLoteId] = useState(""), [motivo, setMotivo] = useState("");
  const [numero, setNumero] = useState(""), [validade, setValidade] = useState("");
  const [custoUnitario, setCustoUnitario] = useState(produto.custoCompra?.replace(".", ",") ?? "");
  const [selecionado, setSelecionado] = useState<MovimentoDTO | null>(null), [motivoEstorno, setMotivoEstorno] = useState("");
  // Mantém a chave em caso de resposta perdida. Outra operação recebe outra chave.
  const operacao = useRef<{ assinatura: string; chave: string } | null>(null);
  const salvando = useRef(false);
  const feedback = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error || success) feedback.current?.focus(); }, [error, success]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setLoadError("");
    Promise.all([
      gestaoRequest<SaldoDTO>(path + "/saldo", { signal: controller.signal }),
      gestaoRequest<Pagina<MovimentoDTO>>(path + "/movimentos?page=" + page + "&pageSize=10", { signal: controller.signal }),
    ]).then(([s, h]) => { if (!controller.signal.aborted) { setSaldo(s); setHistorico(h); } })
      .catch(e => { if (!controller.signal.aborted) setLoadError(mensagem(e)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, page, refresh]);
  function chave(assinatura: string) {
    if (operacao.current?.assinatura !== assinatura) operacao.current = { assinatura, chave: crypto.randomUUID() };
    return operacao.current.chave;
  }
  function iniciar() { if (salvando.current) return false; salvando.current = true; setBusy(true); setError(""); setSuccess(""); return true; }
  function terminar() { salvando.current = false; setBusy(false); }
  function atualizado(texto: string) { operacao.current = null; setSuccess(texto); setPage(1); setRefresh(v => v + 1); setLoading(true); }
  async function movimentar(e: FormEvent) {
    e.preventDefault(); if (!iniciar()) return;
    try {
      const dados = { tipo, quantidade, loteId: loteId || null, motivo, ...(tipo !== "SAIDA" && !quantidade.trim().startsWith("-") && custoUnitario.trim() ? { custoUnitario } : {}) };
      const parsed = movimentoSchema.safeParse({ ...dados, chaveOperacao: chave(JSON.stringify(dados)) });
      if (!parsed.success) { setError(parsed.error.issues.map(i => i.message).join(" ")); return; }
      await gestaoRequest(path + "/movimentos", { method: "POST", body: JSON.stringify(parsed.data) });
      setQuantidade(""); setMotivo(""); atualizado("Movimentação registrada com sucesso.");
    } catch (e) { setError(mensagem(e)); } finally { terminar(); }
  }
  async function criarLote(e: FormEvent) {
    e.preventDefault(); if (!iniciar()) return;
    try {
      const parsed = loteSchema.safeParse({ numero, validade: validade || null });
      if (!parsed.success) { setError("Confira o número do lote e a validade."); return; }
      const lote = await gestaoRequest<{ id: string }>(path + "/lotes", { method: "POST", body: JSON.stringify(parsed.data) });
      setNumero(""); setValidade(""); setLoteId(lote.id); atualizado("Lote cadastrado com sucesso.");
    } catch (e) { setError(mensagem(e)); } finally { terminar(); }
  }
  async function estornar(e: FormEvent) {
    e.preventDefault(); if (!selecionado || !iniciar()) return;
    try {
      const dados = { id: selecionado.id, motivo: motivoEstorno };
      const parsed = estornoSchema.safeParse({ motivo: motivoEstorno, chaveOperacao: chave(JSON.stringify(dados)) });
      if (!parsed.success) { setError("Informe um motivo com pelo menos três caracteres."); return; }
      await gestaoRequest(path + "/movimentos/" + selecionado.id + "/estornar", { method: "POST", body: JSON.stringify(parsed.data) });
      setSelecionado(null); setMotivoEstorno(""); atualizado("Estorno registrado com sucesso.");
    } catch (e) { setError(mensagem(e)); } finally { terminar(); }
  }
  const indisponivel = busy || loading || !!loadError;
  const entradaComCusto = tipo !== "SAIDA" && !quantidade.trim().startsWith("-");
  function nomeLote(id: string | null) { return saldo?.lotes.find(l => l.id === id)?.numero ?? "Sem lote"; }
  return <><Link className="back-link" href="/estoque">← Voltar para estoque</Link><div className="page-heading"><div><p className="eyebrow">ESTOQUE · {produto.sku}</p><h1>Estoque de {produto.nome}</h1><p className="muted">Quantidades em {produto.unidade}. Cada entrada e saída fica no histórico.</p></div><Link href={"/produtos/" + produto.id} className="button-link secondary">Editar produto</Link></div>
    {!produto.ativo && <p className="notice">Produto inativo: novos lotes e movimentações estão bloqueados. O histórico e os estornos continuam disponíveis.</p>}
    {success && <p ref={feedback} tabIndex={-1} role="status" className="success-message">{success}</p>}{error && <p ref={feedback} tabIndex={-1} role="alert" className="notice">{error}</p>}
    {loadError && <section className="notice"><p role="alert">{loadError}</p><button className="secondary" onClick={() => setRefresh(v => v + 1)}>Tentar novamente</button></section>}
    {loading && <p role="status">Atualizando estoque…</p>}
    {saldo && !loadError && <><section className="stock-summary" aria-label="Resumo do estoque"><article className="metric-card"><p>Saldo total</p><strong className="metric-value" data-testid="saldo-total">{formatQuantidade(saldo.saldo)}</strong><span>{produto.unidade}</span></article><article className="metric-card"><p>Sem lote</p><strong className="metric-value">{formatQuantidade(saldo.semLote)}</strong><span>{produto.unidade}</span></article><article className="metric-card"><p>Lotes cadastrados</p><strong className="metric-value">{saldo.lotes.length}</strong><span>Com ou sem saldo</span></article></section>
      <section className="stock-summary stock-cost-summary" aria-label="Custos e reposição"><article className="metric-card"><p>Custo de compra de referência</p><strong className="stock-cost">{saldo.custoCompra === null ? "Não informado" : formatPrice(saldo.custoCompra)}</strong><span>Por {produto.unidade}</span></article><article className="metric-card"><p>Custo médio atual</p><strong className="stock-cost" data-testid="custo-medio">{saldo.custoMedio === null ? "Pendente" : formatPrice(saldo.custoMedio)}</strong><span>{saldo.valorEstoque === null ? "Há entradas sem custo no histórico" : "Valor em estoque: " + formatPrice(saldo.valorEstoque)}</span></article><article className="metric-card"><p>Estoque mínimo</p><strong className="metric-value">{formatQuantidade(saldo.estoqueMinimo)}</strong><span>{saldo.reposicao ? "Reposição necessária" : saldo.estoqueMinimo === "0.000" ? "Alerta de reposição desativado" : "Saldo acima do mínimo"}</span></article></section>
{saldo.reposicao && <p role="status" className="notice stock-warning">O saldo está no mínimo ou abaixo. Planeje a reposição deste produto.</p>}{saldo.custoMedio === null && <p className="notice">Custo médio pendente: há entradas sem custo no histórico. Novas compras não preenchem custos de entradas anteriores.</p>}
{saldo.lotes.length > 0 && <section className="stock-section"><h2>Saldo por lote</h2><div className="table-scroll" tabIndex={0} role="region" aria-label="Saldo por lote, com rolagem horizontal"><table><thead><tr><th>Lote</th><th>Validade</th><th>Saldo ({produto.unidade})</th><th>Situação</th></tr></thead><tbody>{saldo.lotes.map(l => <tr key={l.id}><td>{l.numero}</td><td>{l.validade ? l.validade.split("-").reverse().join("/") : "Não informada"}</td><td>{formatQuantidade(l.saldo)}</td><td>{l.alertaValidade ? <span className={"badge " + (l.alertaValidade === "VENCIDO" ? "stock-danger" : "stock-warning")}>{l.alertaValidade === "VENCIDO" ? "Vencido" : "Vence em até 30 dias"}</span> : "—"}</td></tr>)}</tbody></table></div><p className="table-hint">Deslize a tabela para ver todas as colunas.</p></section>}
    </>}
    <div className="stock-forms"><form className="catalog-form" onSubmit={movimentar}><h2>Registrar movimentação</h2><p className="muted">Entrada e saída usam quantidade positiva. No ajuste, use sinal negativo para reduzir o saldo.</p><fieldset disabled={indisponivel || !produto.ativo}><div className="form-grid"><div><label htmlFor="tipo-movimento">Tipo de movimento</label><select id="tipo-movimento" value={tipo} onChange={e => setTipo(e.target.value as typeof tipo)}><option value="ENTRADA">Entrada</option><option value="SAIDA">Saída</option><option value="AJUSTE">Ajuste</option></select></div><div><label htmlFor="quantidade">Quantidade ({produto.unidade})</label><input id="quantidade" inputMode={tipo === "AJUSTE" ? "text" : "decimal"} value={quantidade} onChange={e => setQuantidade(e.target.value)} required maxLength={15} placeholder="0,000"/></div>{entradaComCusto && <div className="span-full"><label htmlFor="custo-unitario">Custo unitário da entrada (R$)</label><input id="custo-unitario" inputMode="decimal" value={custoUnitario} onChange={e => setCustoUnitario(e.target.value)} maxLength={13} placeholder="Custo de referência do produto"/><p className="muted">Por {produto.unidade}, com até quatro casas decimais. Em branco, usa o custo de referência; se ele não estiver informado, o custo médio fica pendente.</p></div>}<div className="span-full"><label htmlFor="lote-movimento">Lote da movimentação</label><select id="lote-movimento" value={loteId} onChange={e => setLoteId(e.target.value)}><option value="">Sem lote</option>{saldo?.lotes.map(l => <option key={l.id} value={l.id}>{l.numero} · {formatQuantidade(l.saldo)} {produto.unidade}</option>)}</select><p className="muted">A saída usa apenas o saldo do lote escolhido.</p></div><div className="span-full"><label htmlFor="motivo">Motivo da movimentação</label><textarea id="motivo" value={motivo} onChange={e => setMotivo(e.target.value)} required minLength={3} maxLength={500} rows={3}/></div></div><div className="form-actions"><button type="submit">{busy ? "Salvando…" : "Registrar movimentação"}</button></div></fieldset></form>
    <form className="catalog-form" onSubmit={criarLote}><h2>Cadastrar lote</h2><p className="muted">Identifique o lote antes de registrar sua entrada.</p><fieldset disabled={indisponivel || !produto.ativo}><label htmlFor="numero-lote">Número do lote</label><input id="numero-lote" value={numero} onChange={e => setNumero(e.target.value)} required maxLength={80}/><label htmlFor="validade">Validade (opcional)</label><input id="validade" type="date" value={validade} onChange={e => setValidade(e.target.value)}/><div className="form-actions"><button type="submit">Cadastrar lote</button></div></fieldset></form></div>
    {selecionado && <section className="stock-section notice" aria-labelledby="titulo-estorno"><h2 id="titulo-estorno">Confirmar estorno</h2><p>Reverter {tipos[selecionado.tipo].toLowerCase()} de {formatQuantidade(selecionado.quantidade)} {produto.unidade} · {nomeLote(selecionado.loteId)}. O movimento original será preservado.</p><form onSubmit={estornar}><fieldset disabled={indisponivel}><label htmlFor="motivo-estorno">Motivo do estorno</label><textarea id="motivo-estorno" autoFocus value={motivoEstorno} onChange={e => setMotivoEstorno(e.target.value)} required minLength={3} maxLength={500} rows={3}/><div className="form-actions"><button type="submit">Confirmar estorno</button><button type="button" className="secondary" onClick={() => { setSelecionado(null); setMotivoEstorno(""); setError(""); }}>Cancelar estorno</button></div></fieldset></form></section>}
    <section className="stock-section"><h2>Histórico de movimentações</h2>{!loading && !loadError && historico && (historico.itens.length ? <><div className="table-scroll" tabIndex={0} role="region" aria-label="Histórico, com rolagem horizontal"><table><thead><tr><th>Data</th><th>Tipo</th><th>Lote</th><th>Quantidade ({produto.unidade})</th><th>Custo unitário</th><th>Motivo</th><th>Ação</th></tr></thead><tbody>{historico.itens.map(m => <tr key={m.id}><td>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Cuiaba" }).format(new Date(m.createdAt))}</td><td>{tipos[m.tipo]}</td><td>{nomeLote(m.loteId)}</td><td>{formatQuantidade(m.quantidade)}</td><td>{m.custoUnitario === null ? "Não informado" : formatPrice(m.custoUnitario)}</td><td className="stock-reason">{m.motivo}</td><td>{m.tipo === "ESTORNO" ? "Reversão registrada" : m.vendaId ? <Link href={"/vendas/" + m.vendaId}>Ver venda</Link> : <button type="button" className="secondary" disabled={indisponivel} aria-label={"Estornar movimento: " + m.motivo} onClick={() => { setSelecionado(m); setMotivoEstorno(""); setError(""); }}>Estornar</button>}</td></tr>)}</tbody></table></div><p className="table-hint">Deslize a tabela para ver todas as colunas.</p><div className="pagination"><p>{historico.total} movimento(s) · Página {page} de {historico.pages}</p><div><button className="secondary" disabled={indisponivel || page <= 1} onClick={() => setPage(v => v - 1)}>Anterior</button><button className="secondary" disabled={indisponivel || page >= historico.pages} onClick={() => setPage(v => v + 1)}>Próxima</button></div></div></> : <p className="notice">Nenhuma movimentação registrada. Comece com uma entrada ou ajuste de saldo inicial.</p>)}</section>
  </>;
}
