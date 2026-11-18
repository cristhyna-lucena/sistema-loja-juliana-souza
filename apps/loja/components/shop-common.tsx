"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { LojaProdutoDTO } from "@sistema/shared";
import { StoreIcon } from "../app/premium";
import { originalLogo } from "../lib/original-assets";

export class ShopError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}
export async function shopRequest<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch("/api/loja/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: "no-store",
    signal,
  });
  const result = await response.json();
  if (!response.ok)
    throw new ShopError(
      typeof result.message === "string"
        ? result.message
        : "Não foi possível concluir a operação.",
      response.status,
    );
  return result as T;
}
export function useShopData<T>(path: string) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [tick, setTick] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    shopRequest<T>(path, undefined, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, tick]);
  return { data, error, loading, reload: () => setTick((value) => value + 1) };
}
export function ShopPaymentMethods({
  configurado,
}: {
  configurado: boolean | null;
}) {
  return (
    <>
      <p>
        Pix, boleto e cartões de crédito ou débito, conforme as opções
        habilitadas no provedor escolhido.
      </p>
      {configurado === false && (
        <p role="status">
          As opções de pagamento estão em configuração. A loja ativará as
          compras online após concluir essa etapa.
        </p>
      )}
    </>
  );
}
export function ShopFrame({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="shop-page">
      <a className="skip" href="#conteudo">
        Ir para o conteúdo
      </a>
      <div className="top-strip">
        <div className="wrap">
          <span>
            <StoreIcon name="diamond" /> Amor em cada detalhe
          </span>
          <span>
            <StoreIcon name="leaf" /> Cabelos, pele e cuidado diário
          </span>
          <span>
            <StoreIcon name="heart" /> Uma escolha feita com carinho
          </span>
        </div>
      </div>
      <header className="store-header">
        <div className="header-row wrap">
          <button
            className="icon-button menu-button"
            type="button"
            aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}
            aria-expanded={menuOpen}
            aria-controls="shop-navigation"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <StoreIcon name="menu" />
          </button>
          <Link className="brand" href="/" aria-label="Juliana Souza — início">
            <img
              className="brand-logo"
              src={originalLogo}
              alt="Juliana Souza — Amor em cada detalhe"
            />
          </Link>
          <form className="search" role="search" action="/produtos">
            <label className="sr-only" htmlFor="shop-header-search">
              O que você procura?
            </label>
            <input
              id="shop-header-search"
              name="q"
              type="search"
              placeholder="O que você procura?"
            />
            <button type="submit" aria-label="Buscar no catálogo">
              <StoreIcon name="search" />
            </button>
          </form>
          <div className="header-actions">
            <button onClick={() => window.location.assign("/conta")}>
              <StoreIcon name="user" />
              <small>Minha conta</small>
            </button>
            <button
              onClick={() => window.location.assign("/?favoritos=1#destaques")}
            >
              <StoreIcon name="heart" />
              <small>Favoritos</small>
            </button>
            <button onClick={() => window.location.assign("/carrinho")}>
              <StoreIcon name="bag" />
              <small>Meu carrinho</small>
            </button>
          </div>
        </div>
        <nav
          id="shop-navigation"
          className={"store-nav" + (menuOpen ? " open" : "")}
          aria-label="Menu da loja"
          onClick={() => setMenuOpen(false)}
        >
          <Link href="/">Início</Link>
          <Link href="/#categorias">Categorias</Link>
          <Link href="/produtos">Produtos</Link>
          <Link href="/servicos">Serviços</Link>
          <Link href="/#linhas">Nossas linhas</Link>
          <Link href="/carrinho">Carrinho</Link>
          <Link href="/conta">Minha conta</Link>
          <Link href="/trocas">Atendimento</Link>
        </nav>
      </header>
      <main id="conteudo" className="shop-main wrap">
        {children}
      </main>
      <footer className="store-footer">
        <div className="wrap footer-grid">
          <div>
            <Link
              className="brand"
              href="/"
              aria-label="Juliana Souza — início"
            >
              <img
                className="brand-logo"
                src={originalLogo}
                alt="Juliana Souza"
              />
            </Link>
            <p>
              Beleza, cuidado e carinho
              <br />
              em cada escolha.
            </p>
          </div>
          <div>
            <h3>Institucional</h3>
            <Link href="/#categorias">Nossas categorias</Link>
            <Link href="/#linhas">Nossas linhas</Link>
            <Link href="/privacidade">Privacidade</Link>
          </div>
          <div>
            <h3>Seu cuidado</h3>
            <Link href="/produtos">Catálogo de produtos</Link>
            <Link href="/#videos">O cuidado na vida real</Link>
            <Link href="/servicos">Serviços</Link>
          </div>
          <div>
            <h3>Uma escolha com carinho</h3>
            <Link href="/conta">Minha conta</Link>
            <Link href="/trocas">Trocas e atendimento</Link>
            <Link href="/">Conheça nossas linhas</Link>
          </div>
        </div>
        <div className="wrap footer-bottom">
          <span>© {new Date().getFullYear()} Juliana Souza</span>
          <span>Amor em cada detalhe</span>
          <a href="#">Voltar ao início ↑</a>
        </div>
      </footer>
    </div>
  );
}
export type CartItem = {
  produtoId: string;
  slug: string;
  nome: string;
  quantidade: number;
};
const cartKey = "juliana-souza-carrinho";
function lerCarrinho(): CartItem[] {
  try {
    const itens: unknown = JSON.parse(localStorage.getItem(cartKey) ?? "[]");
    if (!Array.isArray(itens)) return [];
    return itens
      .filter(
        (item): item is CartItem =>
          !!item &&
          typeof item === "object" &&
          typeof item.produtoId === "string" &&
          /^[A-Za-z0-9_-]{1,80}$/.test(item.produtoId) &&
          typeof item.slug === "string" &&
          /^[a-z0-9-]{1,160}$/.test(item.slug) &&
          typeof item.nome === "string" &&
          Number.isInteger(item.quantidade) &&
          item.quantidade > 0 &&
          item.quantidade <= 1000,
      )
      .slice(0, 30);
  } catch {
    return [];
  }
}
export function useCart() {
  const [itens, setItens] = useState<CartItem[]>([]),
    [ready, setReady] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const atualizar = () => setItens(lerCarrinho());
    atualizar();
    setReady(true);
    window.addEventListener("storage", atualizar);
    return () => window.removeEventListener("storage", atualizar);
  }, []);
  function salvar(rows: CartItem[]) {
    try {
      localStorage.setItem(cartKey, JSON.stringify(rows));
      setItens(rows);
      setError("");
    } catch {
      setError("Não foi possível salvar o carrinho neste navegador.");
    }
  }
  function adicionar(produto: LojaProdutoDTO, quantidade: number) {
    const atuais = lerCarrinho(),
      existente = atuais.find((item) => item.produtoId === produto.id);
    const novoTotal = (existente?.quantidade ?? 0) + quantidade;
    if (
      novoTotal > Number(produto.disponivel) ||
      novoTotal > 1000 ||
      (!existente && atuais.length >= 30)
    ) {
      setError("A quantidade excede o disponível ou o limite do carrinho.");
      return false;
    }
    salvar(
      existente
        ? atuais.map((item) =>
            item.produtoId === produto.id
              ? { ...item, quantidade: novoTotal }
              : item,
          )
        : [
            ...atuais,
            {
              produtoId: produto.id,
              nome: produto.nome,
              slug: produto.slug,
              quantidade,
            },
          ],
    );
    return true;
  }
  return { itens, ready, error, adicionar, salvar };
}
