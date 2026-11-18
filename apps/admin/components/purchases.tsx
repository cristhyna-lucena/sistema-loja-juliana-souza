"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { formatPrice, type ProdutoDTO, type Pagina } from "@sistema/shared";
import { catalogRequest } from "../lib/catalogo-client";
import {
  useComercialAction,
  useComercialData,
  diaLocal,
} from "../lib/comercial-client";
import { CommercialFeedback } from "./comercial-common";
import { gestaoRequest } from "../lib/gestao-client";

type Compra = {
  id: string;
  numero: string;
  status: string;
  total: string;
  fornecedor: { nome: string };
  emitidaEm: string;
  itens: {
    id: string;
    descricao: string;
    quantidade: string;
    fatorConversao: string;
    custoUnitario: string;
    total: string;
  }[];
  titulos: {
    id: string;
    descricao: string;
    saldo: string;
    vencimento: string;
  }[];
};
type Contato = { id: string; nome: string };
type Item = {
  produtoId: string;
  nome: string;
  codigoFornecedor: string;
  quantidade: string;
  fatorConversao: string;
  custoUnitario: string;
  numeroLote: string;
  validade: string;
};

export function PurchasesList() {
  const [q, setQ] = useState(""),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1);
  const data = useComercialData<{ itens: Compra[]; pages: number }>(
    "compras?q=" + encodeURIComponent(search) + "&page=" + page,
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Compras</h1>
          <p className="muted">Entradas de mercadorias e parcelas a pagar.</p>
        </div>
        <Link className="button-link" href="/compras/nova">
          Registrar compra
        </Link>
      </div>
      <form
        className="catalog-filters"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(q);
          setPage(1);
        }}
      >
        <label htmlFor="busca-compras">Buscar por número ou fornecedor</label>
        <input
          id="busca-compras"
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
        <button>Buscar</button>
      </form>
      {data.error && <p role="alert">{data.error}</p>}
      {data.loading && <p role="status">Carregando compras…</p>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Número</th>
              <th>Fornecedor</th>
              <th>Total</th>
              <th>Situação</th>
            </tr>
          </thead>
          <tbody>
            {data.data?.itens.map((compra) => (
              <tr key={compra.id}>
                <td>
                  <Link href={"/compras/" + compra.id}>{compra.numero}</Link>
                </td>
                <td>{compra.fornecedor.nome}</td>
                <td>{formatPrice(compra.total)}</td>
                <td>
                  {compra.status === "CANCELADA" ? "Cancelada" : "Confirmada"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!data.loading && data.data?.itens.length === 0 && (
        <p>Nenhuma compra encontrada.</p>
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

export function PurchaseForm({ notaId }: { notaId?: string }) {
  const router = useRouter(),
    action = useComercialAction();
  const fornecedores = useComercialData<{ itens: Contato[] }>(
    "fornecedores?status=ativos&pageSize=100",
  );
  const [fornecedorId, setFornecedorId] = useState(""),
    [numero, setNumero] = useState(""),
    [chaveNota, setChaveNota] = useState(""),
    [emissao, setEmissao] = useState(diaLocal());
  const [busca, setBusca] = useState(""),
    [produtos, setProdutos] = useState<ProdutoDTO[]>([]),
    [searchError, setSearchError] = useState("");
  const [itens, setItens] = useState<Item[]>([]),
    [parcelas, setParcelas] = useState([{ valor: "", vencimento: diaLocal() }]);
  const [observacao, setObservacao] = useState("");
  const [despesas, setDespesas] = useState("0"),
    [descontoCompra, setDescontoCompra] = useState("0");
  const [opcoesNota, setOpcoesNota] = useState<ProdutoDTO[]>([]);
  useEffect(() => {
    if (!notaId) return;
    let active = true;
    async function carregarNota() {
      try {
        const [nota, catalogo, fornecedoresNota] = await Promise.all([
          gestaoRequest<{
            xml: string | null;
            dados: {
              numero: string;
              chave: string;
              fornecedorDocumento: string;
              emitidaEm: string;
              valorTotal: string;
              frete: string;
              despesas: string;
              desconto: string;
              itens: {
                codigoFornecedor: string;
                descricao: string;
                quantidade: string;
                custoUnitario: string;
                lotes: {
                  numero: string;
                  quantidade: string;
                  validade: string | null;
                }[];
              }[];
              parcelas: { valor: string; vencimento: string }[];
            };
          }>("fiscal/recebidas/" + notaId),
          catalogRequest<Pagina<ProdutoDTO>>(
            "produtos?status=ativos&pageSize=100",
          ),
          gestaoRequest<{ itens: { id: string; cpfCnpj: string }[] }>(
            "fornecedores?status=ativos&pageSize=100",
          ),
        ]);
        if (!active) return;
        if (!nota.xml)
          throw new Error(
            "Aguarde o XML completo da nota antes de dar entrada.",
          );
        const fornecedor = fornecedoresNota.itens.find(
          (item) => item.cpfCnpj === nota.dados.fornecedorDocumento,
        );
        const vinculos = fornecedor
          ? await gestaoRequest<
              {
                codigoFornecedor: string;
                produtoId: string;
                fatorConversao: string;
              }[]
            >("compras/fornecedores/" + fornecedor.id + "/vinculos")
          : [];
        if (!active) return;
        const decimal = (value: string) =>
          value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
        setFornecedorId(fornecedor?.id ?? "");
        setNumero(nota.dados.numero);
        setChaveNota(nota.dados.chave);
        setEmissao(nota.dados.emitidaEm);
        setOpcoesNota(catalogo.itens);
        setItens(
          nota.dados.itens.flatMap((item) => {
            const vinculo = vinculos.find(
              (vinculo) => vinculo.codigoFornecedor === item.codigoFornecedor,
            );
            const base = {
              produtoId: vinculo?.produtoId ?? "",
              nome: item.descricao,
              codigoFornecedor: item.codigoFornecedor,
              fatorConversao: vinculo?.fatorConversao ?? "1",
              custoUnitario: decimal(item.custoUnitario),
            };
            return item.lotes.length
              ? item.lotes.map((lote) => ({
                  ...base,
                  quantidade: decimal(lote.quantidade),
                  numeroLote: lote.numero,
                  validade: lote.validade ?? "",
                }))
              : [
                  {
                    ...base,
                    quantidade: decimal(item.quantidade),
                    numeroLote: "",
                    validade: "",
                  },
                ];
          }),
        );
        setDespesas(nota.dados.despesas || "0");
        setDescontoCompra(nota.dados.desconto || "0");
        setParcelas(
          nota.dados.parcelas.length
            ? nota.dados.parcelas
            : [{ valor: nota.dados.valorTotal, vencimento: diaLocal() }],
        );
      } catch (error) {
        if (active)
          setSearchError(
            error instanceof Error ? error.message : "Erro ao carregar nota.",
          );
      }
    }
    void carregarNota();
    return () => {
      active = false;
    };
  }, [notaId]);
  async function buscar() {
    setSearchError("");
    try {
      setProdutos(
        (
          await catalogRequest<Pagina<ProdutoDTO>>(
            "produtos?status=ativos&q=" + encodeURIComponent(busca),
          )
        ).itens,
      );
    } catch (error) {
      setSearchError(
        error instanceof Error ? error.message : "Erro ao buscar produtos.",
      );
    }
  }
  function alterar(index: number, field: keyof Item, value: string) {
    setItens((rows) =>
      rows.map((row, n) => (n === index ? { ...row, [field]: value } : row)),
    );
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const payload = {
      fornecedorId,
      numero,
      despesas,
      desconto: descontoCompra,
      chaveNota: chaveNota || null,
      emitidaEm: emissao,
      observacao: observacao || null,
      ...(notaId ? { notaRecebidaId: notaId } : {}),
      itens: itens.map((item) => ({
        produtoId: item.produtoId,
        codigoFornecedor: item.codigoFornecedor,
        quantidade: item.quantidade,
        fatorConversao: item.fatorConversao,
        custoUnitario: item.custoUnitario,
        lote: item.numeroLote
          ? { numero: item.numeroLote, validade: item.validade || null }
          : null,
      })),
      parcelas,
    };
    const result = await action.run<{ id: string }>("compras", payload);
    if (result) router.push("/compras/" + result.id);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Registrar compra</h1>
          <p className="muted">
            A confirmação registra estoque, custo e contas a pagar.
          </p>
        </div>
      </div>
      <section className="dashboard-card">
        <h2>Adicionar produtos</h2>
        <label htmlFor="produto-compra">Buscar produto</label>
        <div className="form-actions">
          <input
            id="produto-compra"
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
          />
          <button type="button" disabled={action.locked} onClick={buscar}>
            Buscar produtos
          </button>
        </div>
        {searchError && <p role="alert">{searchError}</p>}
        {produtos.map((produto) => (
          <div className="form-actions" key={produto.id}>
            <span>
              {produto.nome} · {produto.sku}
            </span>
            <button
              type="button"
              className="secondary"
              disabled={action.locked}
              onClick={() =>
                setItens((rows) => [
                  ...rows,
                  {
                    produtoId: produto.id,
                    nome: produto.nome,
                    codigoFornecedor: produto.sku,
                    quantidade: "1",
                    fatorConversao: "1",
                    custoUnitario: produto.custoCompra ?? "0",
                    numeroLote: "",
                    validade: "",
                  },
                ])
              }
            >
              Adicionar {produto.nome}
            </button>
          </div>
        ))}
      </section>
      <form className="catalog-form" onSubmit={submit}>
        <fieldset disabled={action.locked}>
          <div className="form-grid">
            <div>
              <label htmlFor="fornecedor-compra">Fornecedor</label>
              <select
                id="fornecedor-compra"
                required
                value={fornecedorId}
                onChange={(event) => setFornecedorId(event.target.value)}
              >
                <option value="">Selecione</option>
                {fornecedores.data?.itens.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.nome}
                  </option>
                ))}
              </select>
              <Link href="/fornecedores/novo">Cadastrar fornecedor</Link>
            </div>
            <div>
              <label htmlFor="numero-compra">Número do documento</label>
              <input
                id="numero-compra"
                required
                maxLength={160}
                value={numero}
                onChange={(event) => setNumero(event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="emissao-compra">Data de emissão</label>
              <input
                id="emissao-compra"
                required
                type="date"
                max={diaLocal()}
                value={emissao}
                onChange={(event) => setEmissao(event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="chave-compra">Chave da NF-e (opcional)</label>
              <input
                id="chave-compra"
                inputMode="numeric"
                pattern="[0-9]{44}"
                maxLength={44}
                value={chaveNota}
                onChange={(event) => setChaveNota(event.target.value)}
              />
            </div>
          </div>
          <h2>Itens da compra</h2>
          {itens.map((item, index) => (
            <section className="dashboard-card" key={index}>
              <h3>{item.nome}</h3>
              {notaId && (
                <div>
                  <label htmlFor={"vinculo-produto" + index}>
                    Produto do estoque
                  </label>
                  <select
                    id={"vinculo-produto" + index}
                    required
                    value={item.produtoId}
                    onChange={(event) =>
                      alterar(index, "produtoId", event.target.value)
                    }
                  >
                    <option value="">Selecione o produto correspondente</option>
                    {opcoesNota.map((produto) => (
                      <option key={produto.id} value={produto.id}>
                        {produto.nome} · {produto.sku}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="form-grid">
                {(
                  [
                    ["codigoFornecedor", "Código no fornecedor"],
                    ["quantidade", "Quantidade comprada"],
                    [
                      "fatorConversao",
                      "Unidades de estoque por unidade comprada",
                    ],
                    ["custoUnitario", "Custo por unidade comprada (R$)"],
                    ["numeroLote", "Número do lote (opcional)"],
                    ["validade", "Validade do lote (opcional)"],
                  ] as const
                ).map(([field, label]) => (
                  <div key={field}>
                    <label htmlFor={field + index}>{label}</label>
                    <input
                      id={field + index}
                      type={field === "validade" ? "date" : "text"}
                      required={!["numeroLote", "validade"].includes(field)}
                      value={item[field]}
                      onChange={(event) =>
                        alterar(index, field, event.target.value)
                      }
                    />
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  setItens((rows) => rows.filter((_, n) => n !== index))
                }
              >
                Remover item
              </button>
            </section>
          ))}
          <div className="form-grid">
            <div>
              <label htmlFor="despesas-compra">
                Frete, impostos e outras despesas (R$)
              </label>
              <input
                id="despesas-compra"
                inputMode="decimal"
                value={despesas}
                onChange={(event) => setDespesas(event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="desconto-compra">Desconto da compra (R$)</label>
              <input
                id="desconto-compra"
                inputMode="decimal"
                value={descontoCompra}
                onChange={(event) => setDescontoCompra(event.target.value)}
              />
            </div>
          </div>
          <h2>Parcelas a pagar</h2>
          <p className="muted">
            A soma das parcelas deve corresponder ao total da compra.
          </p>
          {parcelas.map((parcela, index) => (
            <div className="form-grid" key={index}>
              <div>
                <label htmlFor={"valor-parcela" + index}>
                  Valor da parcela {index + 1} (R$)
                </label>
                <input
                  id={"valor-parcela" + index}
                  required
                  inputMode="decimal"
                  value={parcela.valor}
                  onChange={(event) =>
                    setParcelas((rows) =>
                      rows.map((row, n) =>
                        n === index
                          ? { ...row, valor: event.target.value }
                          : row,
                      ),
                    )
                  }
                />
              </div>
              <div>
                <label htmlFor={"vencimento-parcela" + index}>Vencimento</label>
                <input
                  id={"vencimento-parcela" + index}
                  required
                  type="date"
                  value={parcela.vencimento}
                  onChange={(event) =>
                    setParcelas((rows) =>
                      rows.map((row, n) =>
                        n === index
                          ? { ...row, vencimento: event.target.value }
                          : row,
                      ),
                    )
                  }
                />
              </div>
              <button
                type="button"
                className="secondary"
                disabled={parcelas.length === 1}
                onClick={() =>
                  setParcelas((rows) => rows.filter((_, n) => n !== index))
                }
              >
                Remover parcela {index + 1}
              </button>
            </div>
          ))}
          <button
            type="button"
            className="secondary"
            disabled={parcelas.length >= 120}
            onClick={() =>
              setParcelas((rows) => [
                ...rows,
                { valor: "", vencimento: diaLocal() },
              ])
            }
          >
            Adicionar parcela
          </button>
          <label htmlFor="observacao-compra">Observação</label>
          <textarea
            id="observacao-compra"
            maxLength={500}
            value={observacao}
            onChange={(event) => setObservacao(event.target.value)}
          />
        </fieldset>
        <CommercialFeedback error={action.error} uncertain={action.uncertain} />
        {fornecedores.error && <p role="alert">{fornecedores.error}</p>}
        <div className="form-actions">
          <button disabled={action.busy || !itens.length}>
            {action.busy
              ? "Registrando…"
              : action.uncertain
                ? "Reenviar confirmação"
                : "Confirmar compra"}
          </button>
          <Link href="/compras">Voltar</Link>
        </div>
      </form>
    </>
  );
}

export function PurchaseDetail({ id }: { id: string }) {
  const data = useComercialData<Compra>("compras/" + id),
    action = useComercialAction();
  const [motivo, setMotivo] = useState("");
  async function cancelar(event: FormEvent) {
    event.preventDefault();
    if (await action.run("compras/" + id + "/cancelar", { motivo })) {
      setMotivo("");
      data.reload();
    }
  }
  if (data.error) return <p role="alert">{data.error}</p>;
  if (!data.data) return <p role="status">Carregando compra…</p>;
  const compra = data.data;
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Compra {compra.numero}</h1>
          <p>
            {compra.fornecedor.nome} ·{" "}
            {compra.status === "CANCELADA" ? "Cancelada" : "Confirmada"}
          </p>
        </div>
        <strong>{formatPrice(compra.total)}</strong>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Produto</th>
              <th>Quantidade</th>
              <th>Conversão</th>
              <th>Custo</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {compra.itens.map((item) => (
              <tr key={item.id}>
                <td>{item.descricao}</td>
                <td>{item.quantidade}</td>
                <td>{item.fatorConversao}</td>
                <td>{item.custoUnitario}</td>
                <td>{formatPrice(item.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>Contas a pagar</h2>
      {compra.titulos.map((titulo) => (
        <p key={titulo.id}>
          <Link href={"/financeiro/titulos/" + titulo.id}>
            {titulo.descricao}
          </Link>{" "}
          · {titulo.vencimento} · Saldo {formatPrice(titulo.saldo)}
        </p>
      ))}
      {compra.status !== "CANCELADA" && (
        <form className="catalog-form" onSubmit={cancelar}>
          <h2>Cancelar compra</h2>
          <p className="muted">
            O cancelamento estorna o estoque e os pagamentos vinculados.
          </p>
          <label htmlFor="motivo-cancelamento">Motivo</label>
          <textarea
            id="motivo-cancelamento"
            required
            minLength={3}
            maxLength={500}
            disabled={action.locked}
            value={motivo}
            onChange={(event) => setMotivo(event.target.value)}
          />
          <CommercialFeedback
            error={action.error}
            uncertain={action.uncertain}
          />
          <button disabled={action.busy}>
            {action.uncertain ? "Reenviar cancelamento" : "Cancelar compra"}
          </button>
        </form>
      )}
      <Link href="/compras">Voltar para compras</Link>
    </>
  );
}
