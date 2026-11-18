"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import type { Pagina } from "@sistema/shared";
import { gestaoRequest, type ContatoDTO } from "../lib/gestao-client";
import { Icon } from "./icon";
export function ContactList({ kind, success }: { kind: "clientes" | "fornecedores"; success: boolean }) {
  const cliente = kind === "clientes";
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("todos");
  const [query, setQuery] = useState({ q: "", status: "todos" });
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [data, setData] = useState<Pagina<ContatoDTO> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    const params = new URLSearchParams({ ...query, page: String(page), pageSize: "20" });
    gestaoRequest<Pagina<ContatoDTO>>(kind + "?" + params, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Não foi possível carregar os cadastros."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [kind, query, page, retry]);
  function filter(e: FormEvent) { e.preventDefault(); setQuery({ q: draft, status }); setPage(1); }
  return <><div className="page-heading"><div><p className="eyebrow">GESTÃO DA LOJA</p><h1>{cliente ? "Clientes" : "Fornecedores"}</h1><p className="muted">{cliente ? "Contatos e dados dos seus clientes em um só lugar." : "Organize os parceiros que abastecem sua loja."}</p></div><Link className="button-link" href={"/" + kind + "/novo"}><Icon name="plus" size={17}/>{cliente ? "Novo cliente" : "Novo fornecedor"}</Link></div>
    {success && <p role="status" className="success-message">Cadastro salvo com sucesso.</p>}
    <form className="filter-bar" onSubmit={filter}><div><label htmlFor="busca">{cliente ? "Buscar cliente" : "Buscar fornecedor"}</label><input id="busca" value={draft} onChange={e => setDraft(e.target.value)} maxLength={100} placeholder="Nome, CPF/CNPJ ou e-mail"/></div><div><label htmlFor="status">Status</label><select id="status" value={status} onChange={e => setStatus(e.target.value)}><option value="todos">Todos</option><option value="ativos">Ativos</option><option value="inativos">Inativos</option></select></div><button type="submit">Filtrar</button></form>
    {error ? <section className="notice"><p role="alert">{error}</p><button className="secondary" onClick={() => setRetry(v => v + 1)}>Tentar novamente</button></section> : loading ? <p role="status">Carregando cadastros…</p> : data?.itens.length ? <><div className="table-scroll contact-table" tabIndex={0} role="region" aria-label="Cadastros, com rolagem horizontal"><table><caption className="sr-only">{cliente ? "Lista de clientes" : "Lista de fornecedores"}</caption><thead><tr><th>Nome</th><th>CPF/CNPJ</th><th>Contato</th><th>Status</th><th>Ações</th></tr></thead><tbody>{data.itens.map(item => <tr key={item.id}><td>{item.nome}</td><td className="sku-cell">{item.cpfCnpj ?? "Não informado"}</td><td><div>{item.email ?? "Sem e-mail"}</div><small>{item.telefone ?? "Sem telefone"}</small></td><td><span className={item.ativo ? "badge active" : "badge"}>{item.ativo ? "Ativo" : "Inativo"}</span></td><td><Link href={"/" + kind + "/" + item.id} aria-label={"Editar " + item.nome}><Icon name="pencil" size={13}/>Editar</Link></td></tr>)}</tbody></table></div><p className="table-hint">Deslize a tabela para ver todas as colunas.</p><div className="pagination"><p>{data.total} cadastro(s) · Página {page} de {data.pages}</p><div><button className="secondary" disabled={page <= 1} onClick={() => setPage(v => v - 1)}>Anterior</button><button className="secondary" disabled={page >= data.pages} onClick={() => setPage(v => v + 1)}>Próxima</button></div></div></> : <section className="notice empty-catalog"><h2>{cliente ? "Nenhum cliente encontrado" : "Nenhum fornecedor encontrado"}</h2><p>Cadastre um contato ou ajuste os filtros da busca.</p>{page > 1 && <button onClick={() => setPage(1)}>Voltar à primeira página</button>}</section>}
  </>;
}
