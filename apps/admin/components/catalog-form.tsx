"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { categoriaSchema, produtoSchema, formatPrice, type CategoriaDTO, type ProdutoDTO } from "@sistema/shared";
import { catalogRequest, CatalogError } from "../lib/catalogo-client";
import { Icon } from "./icon";
export function CatalogForm({ kind, initial, categorias = [] }: { kind: "produtos" | "categorias"; initial?: ProdutoDTO | CategoriaDTO; categorias?: CategoriaDTO[] }) {
  const products = kind === "produtos";
  const product = products ? initial as ProdutoDTO | undefined : undefined;
  const category = !products ? initial as CategoriaDTO | undefined : undefined;
  const router = useRouter();
  const [nome, setNome] = useState(initial?.nome ?? "");
  const [descricao, setDescricao] = useState(product?.descricao ?? "");
  const [sku, setSku] = useState(product?.sku ?? "");
  const [preco, setPreco] = useState(product?.precoVenda.replace(".", ",") ?? "");
  const [custoCompra, setCustoCompra] = useState(product?.custoCompra?.replace(".", ",") ?? "");
  const [estoqueMinimo, setEstoqueMinimo] = useState(product?.estoqueMinimo?.replace(".", ",") ?? "0");
  const [tipo, setTipo] = useState(product?.tipo ?? "REVENDA");
  const [unidade, setUnidade] = useState(product?.unidade ?? "UN");
  const [categoriaId, setCategoriaId] = useState(product?.categoriaId ?? "");
  const [ativo, setAtivo] = useState(product?.ativo ?? category?.ativa ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState(false);
  function fieldError(field: string) { return errors[field] ? <p className="field-error" id={field + "-error"}>{errors[field]}</p> : null; }
  function invalid(field: string) { return { "aria-invalid": !!errors[field], "aria-describedby": errors[field] ? field + "-error" : undefined }; }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setErrors({}); setConflict(false);
    const parsed = products ? produtoSchema.safeParse({ nome, descricao: descricao || null, sku, precoVenda: preco, custoCompra: custoCompra.trim() || null, estoqueMinimo, tipo, unidade, categoriaId: categoriaId || null, ativo }) : categoriaSchema.safeParse({ nome, ativa: ativo });
    if (!parsed.success) { setErrors(Object.fromEntries(parsed.error.issues.map(issue => [issue.path.join("."), issue.message]))); setError("Confira os campos destacados."); return; }
    setBusy(true);
    try {
      await catalogRequest(kind + (initial ? "/" + initial.id : ""), { method: initial ? "PATCH" : "POST", body: JSON.stringify({ ...parsed.data, ...(initial ? { versao: initial.versao } : {}) }) });
      router.push("/" + kind + "?salvo=1"); router.refresh();
    } catch (error) {
      setError(error instanceof CatalogError ? error.message : "Não foi possível salvar. Tente novamente.");
      if (error instanceof CatalogError) { setConflict(error.code === "CONCURRENT_EDIT"); if (error.errors) setErrors(Object.fromEntries(error.errors.map(issue => [issue.campo, issue.message]))); }
      setBusy(false);
    }
  }
  return <><Link className="back-link" href={"/" + kind}>← Voltar para {products ? "produtos" : "categorias"}</Link><p className="eyebrow">CATÁLOGO</p><h1>{initial ? (products ? "Editar produto" : "Editar categoria") : (products ? "Novo produto" : "Nova categoria")}</h1>{products && initial && <p className="product-management-links"><a href="#fotos-produto">Gerenciar fotos deste produto</a><Link href={"/estoque/" + initial.id}>Gerenciar estoque</Link></p>}{products && !initial && <p className="muted">Após salvar, abra o produto para adicionar suas fotos.</p>}<form className="catalog-form" onSubmit={submit}><div className="form-card-heading"><span className="form-card-icon"><Icon name={products?"box":"layers"} size={19}/></span><div><h2>{products?"Informações do produto":"Informações da categoria"}</h2><p>{products?"Os detalhes que deixam seu catálogo completo.":"Uma boa organização começa por aqui."}</p></div></div><fieldset disabled={busy}><div className="form-grid">
    <div className="span-full"><label htmlFor="nome">Nome</label><input id="nome" value={nome} onChange={event => setNome(event.target.value)} required maxLength={160} {...invalid("nome")} />{fieldError("nome")}</div>
    {products && <><div><label htmlFor="sku">SKU</label><input id="sku" value={sku} onChange={event => setSku(event.target.value)} required maxLength={64} {...invalid("sku")} />{fieldError("sku")}</div><div><label htmlFor="preco">Preço de venda (R$)</label><input id="preco" inputMode="decimal" value={preco} onChange={event => setPreco(event.target.value)} required placeholder="0,00" maxLength={13} {...invalid("precoVenda")} />{fieldError("precoVenda")}</div><div><label htmlFor="tipo">Tipo</label><select id="tipo" value={tipo} onChange={event => setTipo(event.target.value as typeof tipo)}><option value="REVENDA">Revenda</option><option value="INSUMO">Insumo</option><option value="AMBOS">Revenda e insumo</option></select></div><div><label htmlFor="unidade">Unidade</label><select id="unidade" value={unidade} onChange={event => setUnidade(event.target.value as typeof unidade)}><option value="UN">Unidade (UN)</option><option value="ML">Mililitro (ML)</option><option value="G">Grama (G)</option><option value="L">Litro (L)</option><option value="KG">Quilograma (KG)</option></select></div><div><label htmlFor="custo-compra">Custo de compra de referência (R$)</label><input id="custo-compra" inputMode="decimal" value={custoCompra} onChange={event => setCustoCompra(event.target.value)} maxLength={13} placeholder="Não informado" {...invalid("custoCompra")}/>{fieldError("custoCompra")}<p className="muted">Por {unidade}. Sugerido nas próximas entradas; não altera custos anteriores.</p></div><div><label htmlFor="estoque-minimo">Estoque mínimo</label><input id="estoque-minimo" inputMode="decimal" value={estoqueMinimo} onChange={event => setEstoqueMinimo(event.target.value)} required maxLength={13} {...invalid("estoqueMinimo")}/>{fieldError("estoqueMinimo")}<p className="muted">Em {unidade}. Zero desativa o alerta de reposição.</p></div>{product && <div className="span-full"><p className="muted">Custo médio atual: <strong>{product.custoMedio === null ? "Pendente: há entradas sem custo" : formatPrice(product.custoMedio)}</strong>. Calculado pelas movimentações de estoque.</p></div>}<div className="span-full"><label htmlFor="categoria">Categoria</label><select id="categoria" value={categoriaId} onChange={event => setCategoriaId(event.target.value)} {...invalid("categoriaId")}><option value="">Sem categoria</option>{categorias.map(item => <option key={item.id} value={item.id} disabled={!item.ativa && item.id !== product?.categoriaId}>{item.nome}{!item.ativa ? " (inativa)" : ""}</option>)}</select>{fieldError("categoriaId")}{categorias.length === 0 && <p className="muted">Você pode cadastrar categorias pelo menu ou salvar sem categoria.</p>}</div><div className="span-full"><label htmlFor="descricao">Descrição</label><textarea id="descricao" value={descricao} onChange={event => setDescricao(event.target.value)} maxLength={5000} rows={5} {...invalid("descricao")} />{fieldError("descricao")}</div></>}
    <div className="span-full"><label className="checkbox-label"><input type="checkbox" checked={ativo} onChange={event => setAtivo(event.target.checked)} />{products ? "Produto ativo" : "Categoria ativa"}</label></div>
    </div></fieldset>{error && <p role="alert">{error}</p>}{conflict && <button type="button" className="secondary" onClick={() => window.location.reload()}>Recarregar cadastro</button>}<div className="form-actions"><button type="submit" disabled={busy}><Icon name="check" size={17}/>{busy ? "Salvando…" : products ? "Salvar produto" : "Salvar categoria"}</button><Link href={"/" + kind}>Cancelar</Link></div></form></>;
}
