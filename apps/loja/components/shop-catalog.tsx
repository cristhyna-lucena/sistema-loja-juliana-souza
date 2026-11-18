"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatPrice, type LojaProdutoDTO } from "@sistema/shared";
import { ShopFrame, useShopData, useCart } from "./shop-common";

export function ShopCatalog({ categoriaId }: { categoriaId?: string }) {
  const [q, setQ] = useState(""),
    [categoria, setCategoria] = useState(categoriaId ?? ""),
    [page, setPage] = useState(1);
  useEffect(() => { setQ(new URLSearchParams(window.location.search).get("q") ?? ""); }, []);
  const params = new URLSearchParams({ q, page: String(page) });
  if (categoria) params.set("categoriaId", categoria);
  const data = useShopData<{ itens: LojaProdutoDTO[]; pages: number }>(
      "produtos?" + params,
    ),
    categorias = useShopData<{ id: string; nome: string }[]>("categorias");
  return (
    <ShopFrame>
      <h1>Produtos</h1>
      <div className="shop-filters">
        <div>
          <label htmlFor="buscar-produto">Buscar produto</label>
          <input
            id="buscar-produto"
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <div>
          <label htmlFor="categoria-produto">Categoria</label>
          <select
            id="categoria-produto"
            value={categoria}
            onChange={(event) => {
              setCategoria(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Todas</option>
            {categorias.data?.map((item) => (
              <option key={item.id} value={item.id}>
                {item.nome}
              </option>
            ))}
          </select>
        </div>
      </div>
      {data.error && <p role="alert">{data.error}</p>}
      {data.loading && <p role="status">Carregando produtos…</p>}
      <div className="shop-products">
        {data.data?.itens.map((produto) => (
          <article className="shop-product-card" key={produto.id}>
            <Link href={"/p/" + produto.slug}>
              {produto.imagens[0] ? (
                <img
                  src={
                    "/api/loja/imagens/" +
                    produto.id +
                    "/" +
                    produto.imagens[0].id +
                    "/card.webp"
                  }
                  alt={produto.imagens[0].alt}
                  width={480}
                  height={480}
                  loading="lazy"
                />
              ) : (
                <div className="shop-no-photo">{produto.nome}</div>
              )}
              <h2>{produto.nome}</h2>
              <p>{produto.categoria}</p>
              <strong>{formatPrice(produto.preco)}</strong>
              <p>
                {Number(produto.disponivel) >= 1
                  ? "Ver produto"
                  : "Sem estoque"}
              </p>
            </Link>
          </article>
        ))}
      </div>
      {!data.loading && data.data?.itens.length === 0 && (
        <p>Nenhum produto disponível com estes filtros.</p>
      )}
      <div className="shop-actions">
        <button disabled={page === 1} onClick={() => setPage(page - 1)}>
          Anterior
        </button>
        <span>
          Página {page} de {data.data?.pages ?? 1}
        </span>
        <button
          disabled={page >= (data.data?.pages ?? 1)}
          onClick={() => setPage(page + 1)}
        >
          Próxima
        </button>
      </div>
    </ShopFrame>
  );
}

export function ShopProduct({ slug }: { slug: string }) {
  const data = useShopData<LojaProdutoDTO>(
      "produtos/" + encodeURIComponent(slug),
    ),
    cart = useCart();
  const [quantidade, setQuantidade] = useState(1),
    [added, setAdded] = useState(false),
    [image, setImage] = useState(0);
  const produto = data.data;
  return (
    <ShopFrame>
      {data.error ? (
        <p role="alert">{data.error}</p>
      ) : !produto ? (
        <p role="status">Carregando produto…</p>
      ) : (
        <>
          <div className="shop-product-detail">
            <section aria-label="Fotos do produto">
              {produto.imagens[image] ? (
                <img
                  src={
                    "/api/loja/imagens/" +
                    produto.id +
                    "/" +
                    produto.imagens[image].id +
                    "/produto.webp"
                  }
                  alt={produto.imagens[image].alt}
                  width={1024}
                  height={1024}
                />
              ) : (
                <div className="shop-no-photo">{produto.nome}</div>
              )}
              <div className="shop-thumbnails">
                {produto.imagens.map((foto, index) => (
                  <button
                    key={foto.id}
                    aria-label={"Ver foto " + (index + 1)}
                    aria-pressed={image === index}
                    onClick={() => setImage(index)}
                  >
                    <img
                      src={
                        "/api/loja/imagens/" +
                        produto.id +
                        "/" +
                        foto.id +
                        "/thumb.webp"
                      }
                      alt={foto.alt}
                      width={80}
                      height={80}
                    />
                  </button>
                ))}
              </div>
            </section>
            <section>
              <p>{produto.categoria}</p>
              <h1>{produto.nome}</h1>
              <p className="shop-price">{formatPrice(produto.preco)}</p>
              <p className="shop-description">{produto.descricao}</p>
              <label htmlFor="quantidade-produto">Quantidade</label>
              <input
                id="quantidade-produto"
                type="number"
                min={1}
                max={Math.min(1000, Math.floor(Number(produto.disponivel)))}
                value={quantidade}
                onChange={(event) => {
                  setQuantidade(Number(event.target.value));
                  setAdded(false);
                }}
              />
              <button
                disabled={
                  !cart.ready ||
                  !Number.isInteger(quantidade) ||
                  quantidade < 1 ||
                  quantidade > Number(produto.disponivel)
                }
                onClick={() => setAdded(cart.adicionar(produto, quantidade))}
              >
                {Number(produto.disponivel) >= 1
                  ? "Adicionar ao carrinho"
                  : "Sem estoque"}
              </button>
              {cart.error && <p role="alert">{cart.error}</p>}
              {added && (
                <p role="status">
                  Produto adicionado. <Link href="/carrinho">Ver carrinho</Link>
                </p>
              )}
              <p>Calcule as opções de entrega no carrinho.</p>
            </section>
          </div>
        </>
      )}
    </ShopFrame>
  );
}
