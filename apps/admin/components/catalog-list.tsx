"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { formatPrice, type Pagina, type CategoriaDTO } from "@sistema/shared";
import { catalogRequest, CatalogError } from "../lib/catalogo-client";
import { Icon } from "./icon";
type Item = { id: string; nome: string; ativo?: boolean; ativa?: boolean; sku?: string; precoVenda?: string; categoria?: CategoriaDTO | null; imagemPrincipal?: {id:string;alt:string} };
export function CatalogList({ kind, success = false, estoque = false }: { kind: "produtos" | "categorias"; success?: boolean; estoque?: boolean }) {
  const products = kind === "produtos";
  const [draft, setDraft] = useState("");
  const [statusDraft, setStatusDraft] = useState("todos");
  const [query, setQuery] = useState({ q: "", status: "todos" });
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [data, setData] = useState<Pagina<Item> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    const params = new URLSearchParams({ ...query, page: String(page), pageSize: "20" });
    catalogRequest<Pagina<Item>>(kind + "?" + params, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(error => { if (!controller.signal.aborted) setError(error instanceof CatalogError ? error.message : "Não foi possível carregar a lista."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [kind, query, page, retry]);
  function filter(event: FormEvent) { event.preventDefault(); setQuery({ q: draft, status: statusDraft }); setPage(1); }
  return <><div className="page-heading"><div><p className="eyebrow">CATÁLOGO</p><h1>{estoque ? "Estoque" : products ? "Produtos" : "Categorias"}</h1><p className="muted">{estoque ? "Escolha um produto para conferir saldos, lotes e movimentações." : products ? "Organize seus produtos e mantenha os dados atualizados." : "Organize os produtos em categorias."}</p></div><div className="page-heading-actions">{estoque && <Link href="/estoque/alertas" className="button-link secondary"><Icon name="clock" size={17}/>Alertas de estoque</Link>}<Link className="button-link" href={"/" + kind + "/novo"}><Icon name="plus" size={17}/>{products ? "Novo produto" : "Nova categoria"}</Link></div></div>
    {success && <p role="status" className="success-message">Cadastro salvo com sucesso.</p>}
    <form className="filter-bar" onSubmit={filter}><div><label htmlFor="busca">{products ? "Buscar produto" : "Buscar categoria"}</label><div className="input-with-icon"><Icon name="search" size={17}/><input id="busca" value={draft} onChange={event => setDraft(event.target.value)} maxLength={100} placeholder={products ? "Nome ou SKU" : "Nome da categoria"} /></div></div><div><label htmlFor="status">Status</label><select id="status" value={statusDraft} onChange={event => setStatusDraft(event.target.value)}><option value="todos">Todos</option><option value="ativos">Ativos</option><option value="inativos">Inativos</option></select></div><button type="submit"><Icon name="search" size={15}/>Filtrar</button></form>
    {error ? <section className="notice"><p role="alert">{error}</p><button className="secondary" onClick={() => setRetry(value => value + 1)}>Tentar novamente</button></section> : loading ? <div className="table-loading"><p role="status">Carregando cadastros…</p><div className="skeleton-line" aria-hidden="true"/><div className="skeleton-line" aria-hidden="true"/><div className="skeleton-line" aria-hidden="true"/></div> : data?.itens.length ? <><div className="table-scroll" tabIndex={0} role="region" aria-label={products ? "Tabela de produtos, com rolagem horizontal" : "Tabela de categorias, com rolagem horizontal"}><table><caption className="sr-only">{products ? "Lista de produtos" : "Lista de categorias"}</caption><thead><tr><th>Nome</th>{products && <><th>SKU</th><th>Categoria</th><th>Preço</th></>}<th>Status</th><th>Ações</th></tr></thead><tbody>{data.itens.map(item => <tr key={item.id}><td><div className="product-cell">{item.imagemPrincipal ? <img src={"/api/fotos/produtos/"+item.id+"/imagens/"+item.imagemPrincipal.id+"/arquivo/thumb.webp"} alt={item.imagemPrincipal.alt} width={48} height={48} loading="lazy" /> : <span className="cell-placeholder"><Icon name={products?"box":"layers"} size={20}/></span>}<span>{item.nome}</span></div></td>{products && <><td className="sku-cell">{item.sku}</td><td className="category-cell">{item.categoria?.nome ?? "Sem categoria"}</td><td className="money">{formatPrice(item.precoVenda ?? "0.00")}</td></>}<td><span className={(item.ativo ?? item.ativa) ? "badge active" : "badge"}>{(item.ativo ?? item.ativa) ? "Ativo" : "Inativo"}</span></td><td><Link href={"/" + (estoque ? "estoque" : kind) + "/" + item.id} aria-label={(estoque ? "Gerenciar estoque de " : "Editar ") + item.nome}><Icon name={estoque ? "box" : "pencil"} size={13}/>{estoque ? "Gerenciar estoque" : "Editar"}</Link></td></tr>)}</tbody></table></div><p className="table-hint">Deslize a tabela para ver todas as colunas.</p><div className="pagination"><p>{data.total} {products ? "produto(s)" : "categoria(s)"} · Página {data.page} de {data.pages}</p><div><button className="secondary" onClick={() => setPage(value => value - 1)} disabled={page <= 1}>Anterior</button><button className="secondary" onClick={() => setPage(value => value + 1)} disabled={page >= data.pages}>Próxima</button></div></div></> : <section className="notice empty-catalog"><span className="module-icon"><Icon name={products?"box":"layers"} size={30}/></span><h2>{products ? "Nenhum produto encontrado" : "Nenhuma categoria encontrada"}</h2><p>Cadastre um item ou ajuste os filtros da busca.</p>{page > 1 && <button onClick={() => setPage(1)}>Voltar à primeira página</button>}</section>}
  </>;
}
