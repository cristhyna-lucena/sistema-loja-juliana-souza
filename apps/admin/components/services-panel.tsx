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
import { gestaoRequest } from "../lib/gestao-client";
import { CommercialFeedback } from "./comercial-common";

type Servico = {
  id: string;
  nome: string;
  descricao: string | null;
  preco: string;
  duracaoMin: number;
  codigoMunicipal: string | null;
  codigoListaServico: string | null;
  aliquotaIss: string | null;
  publicadoLoja: boolean;
  validadeDias: number;
  ativo: boolean;
  versao: number;
  insumos: {
    produtoId: string;
    quantidade: string;
    produto: { nome: string; unidade: string };
  }[];
};
type Voucher = {
  id: string;
  codigo: string;
  servicoNome: string;
  clienteNome: string;
  valor: string;
  status: string;
  expirado: boolean;
  validoAte: string;
  tituloId: string;
};

export function ServicesList() {
  const [query, setQuery] = useState(""),
    [page, setPage] = useState(1);
  const data = useComercialData<{ itens: Servico[]; pages: number }>(
    "servicos?q=" + encodeURIComponent(query) + "&page=" + page,
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Serviços</h1>
          <p className="muted">Procedimentos, preços e ficha de insumos.</p>
        </div>
        <Link className="button-link" href="/servicos/novo">
          Cadastrar serviço
        </Link>
      </div>
      <label htmlFor="buscar-servico">Buscar serviço</label>
      <input
        id="buscar-servico"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setPage(1);
        }}
      />
      {data.error && <p role="alert">{data.error}</p>}
      {data.loading && <p role="status">Carregando serviços…</p>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Serviço</th>
              <th>Preço</th>
              <th>Duração</th>
              <th>Situação</th>
            </tr>
          </thead>
          <tbody>
            {data.data?.itens.map((item) => (
              <tr key={item.id}>
                <td>
                  <Link href={"/servicos/" + item.id}>{item.nome}</Link>
                </td>
                <td>{formatPrice(item.preco)}</td>
                <td>{item.duracaoMin} min</td>
                <td>{item.ativo ? "Ativo" : "Inativo"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!data.loading && data.data?.itens.length === 0 && (
        <p>Nenhum serviço encontrado.</p>
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
        <Link href="/vouchers">Vender e acompanhar vouchers</Link>
      </div>
    </>
  );
}

export function ServiceForm({ id }: { id?: string }) {
  const [publicadoLoja, setPublicadoLoja] = useState(false),
    [codigoLista, setCodigoLista] = useState(""),
    [aliquotaIss, setAliquotaIss] = useState("");
  const router = useRouter(),
    action = useComercialAction();
  const [nome, setNome] = useState(""),
    [descricao, setDescricao] = useState(""),
    [preco, setPreco] = useState(""),
    [duracao, setDuracao] = useState(60);
  const [codigo, setCodigo] = useState(""),
    [validade, setValidade] = useState(365),
    [ativo, setAtivo] = useState(true),
    [versao, setVersao] = useState(1);
  const [insumos, setInsumos] = useState<
    { produtoId: string; nome: string; quantidade: string }[]
  >([]);
  const [busca, setBusca] = useState(""),
    [produtos, setProdutos] = useState<ProdutoDTO[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(!!id);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    gestaoRequest<Servico>("servicos/" + id, { signal: controller.signal })
      .then((row) => {
        setNome(row.nome);
        setDescricao(row.descricao ?? "");
        setPreco(row.preco);
        setDuracao(row.duracaoMin);
        setCodigo(row.codigoMunicipal ?? "");
        setCodigoLista(row.codigoListaServico ?? "");
        setAliquotaIss(row.aliquotaIss ?? "");
        setPublicadoLoja(row.publicadoLoja);
        setValidade(row.validadeDias);
        setAtivo(row.ativo);
        setVersao(row.versao);
        setInsumos(
          row.insumos.map((item) => ({
            produtoId: item.produtoId,
            nome: item.produto.nome + " · " + item.produto.unidade,
            quantidade: item.quantidade,
          })),
        );
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id]);
  async function buscar() {
    try {
      setProdutos(
        (
          await catalogRequest<Pagina<ProdutoDTO>>(
            "produtos?status=ativos&q=" + encodeURIComponent(busca),
          )
        ).itens.filter((item) => item.tipo !== "REVENDA"),
      );
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Erro ao buscar insumos.",
      );
    }
  }
  async function salvar(event: FormEvent) {
    event.preventDefault();
    const payload = {
      nome,
      descricao: descricao || null,
      preco,
      duracaoMin: duracao,
      codigoMunicipal: codigo || null,
      codigoListaServico: codigoLista || null,
      aliquotaIss: aliquotaIss || null,
      publicadoLoja,
      validadeDias: validade,
      ativo,
      insumos: insumos.map(({ produtoId, quantidade }) => ({
        produtoId,
        quantidade,
      })),
      ...(id ? { versao } : {}),
    };
    if (
      await action.run(
        "servicos" + (id ? "/" + id : ""),
        payload,
        id ? "PATCH" : "POST",
      )
    )
      router.push("/servicos");
  }
  if (loading) return <p role="status">Carregando serviço…</p>;
  return (
    <>
      <h1>{id ? "Editar serviço" : "Cadastrar serviço"}</h1>
      {error && <p role="alert">{error}</p>}
      <form className="catalog-form" onSubmit={salvar}>
        <fieldset disabled={action.locked}>
          <div className="form-grid">
            <div>
              <label htmlFor="nome-servico">Nome</label>
              <input
                id="nome-servico"
                required
                maxLength={160}
                value={nome}
                onChange={(event) => setNome(event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="preco-servico">Preço (R$)</label>
              <input
                id="preco-servico"
                required
                inputMode="decimal"
                value={preco}
                onChange={(event) => setPreco(event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="duracao-servico">Duração em minutos</label>
              <input
                id="duracao-servico"
                required
                type="number"
                min={1}
                max={1440}
                value={duracao}
                onChange={(event) => setDuracao(Number(event.target.value))}
              />
            </div>
            <div>
              <label htmlFor="codigo-servico">
                Código municipal (opcional)
              </label>
              <input
                id="codigo-servico"
                maxLength={30}
                value={codigo}
                onChange={(event) => setCodigo(event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="validade-servico">
                Validade do voucher em dias
              </label>
              <input
                id="validade-servico"
                required
                type="number"
                min={1}
                max={3650}
                value={validade}
                onChange={(event) => setValidade(Number(event.target.value))}
              />
            </div>
            <div>
              <label htmlFor="ativo-servico">Situação</label>
              <select
                id="ativo-servico"
                value={ativo ? "ativo" : "inativo"}
                onChange={(event) => setAtivo(event.target.value === "ativo")}
              >
                <option value="ativo">Ativo</option>
                <option value="inativo">Inativo</option>
              </select>
            </div>
            <div className="span-full">
              <label htmlFor="descricao-servico">Descrição</label>
              <textarea
                id="descricao-servico"
                maxLength={5000}
                value={descricao}
                onChange={(event) => setDescricao(event.target.value)}
              />
            </div>
          </div>
          <div className="form-grid">
            <div>
              <label htmlFor="codigo-lista-servico">
                Item da lista de serviços (00.00)
              </label>
              <input
                id="codigo-lista-servico"
                value={codigoLista}
                onChange={(event) => setCodigoLista(event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="iss-servico">Alíquota ISS (%)</label>
              <input
                id="iss-servico"
                inputMode="decimal"
                value={aliquotaIss}
                onChange={(event) => setAliquotaIss(event.target.value)}
              />
            </div>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={publicadoLoja}
                onChange={(event) => setPublicadoLoja(event.target.checked)}
              />
              Publicar serviço na loja
            </label>
          </div>
          <h2>Ficha de insumos</h2>
          <p className="muted">
            As quantidades são consumidas quando o atendimento for registrado.
          </p>
          <label htmlFor="buscar-insumo">Buscar insumo</label>
          <div className="form-actions">
            <input
              id="buscar-insumo"
              value={busca}
              onChange={(event) => setBusca(event.target.value)}
            />
            <button type="button" className="secondary" onClick={buscar}>
              Buscar insumos
            </button>
          </div>
          {produtos.map((produto) => (
            <div className="form-actions" key={produto.id}>
              <span>
                {produto.nome} · {produto.unidade}
              </span>
              <button
                type="button"
                className="secondary"
                disabled={insumos.some((item) => item.produtoId === produto.id)}
                onClick={() =>
                  setInsumos((rows) => [
                    ...rows,
                    {
                      produtoId: produto.id,
                      nome: produto.nome + " · " + produto.unidade,
                      quantidade: "1",
                    },
                  ])
                }
              >
                Adicionar {produto.nome}
              </button>
            </div>
          ))}
          {insumos.map((item, index) => (
            <div className="form-grid" key={item.produtoId}>
              <div>
                <label htmlFor={"insumo" + index}>{item.nome}</label>
                <input
                  id={"insumo" + index}
                  required
                  inputMode="decimal"
                  value={item.quantidade}
                  onChange={(event) =>
                    setInsumos((rows) =>
                      rows.map((row, n) =>
                        n === index
                          ? { ...row, quantidade: event.target.value }
                          : row,
                      ),
                    )
                  }
                />
              </div>
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  setInsumos((rows) => rows.filter((_, n) => n !== index))
                }
              >
                Remover {item.nome}
              </button>
            </div>
          ))}
        </fieldset>
        <CommercialFeedback error={action.error} uncertain={action.uncertain} />
        <div className="form-actions">
          <button disabled={action.busy}>
            {action.uncertain ? "Reenviar alteração" : "Salvar serviço"}
          </button>
          <Link href="/servicos">Voltar</Link>
        </div>
      </form>
    </>
  );
}

export function VouchersPanel() {
  const [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [servicoId, setServicoId] = useState(""),
    [clienteId, setClienteId] = useState(""),
    [vencimento, setVencimento] = useState(diaLocal());
  const [motivo, setMotivo] = useState(""),
    [selected, setSelected] = useState<{
      id: string;
      acao: "usar" | "cancelar";
    } | null>(null);
  const data = useComercialData<{ itens: Voucher[]; pages: number }>(
    "vouchers?q=" + encodeURIComponent(query) + "&page=" + page,
  );
  const servicos = useComercialData<{ itens: Servico[] }>(
      "servicos?pageSize=100",
    ),
    clientes = useComercialData<{ itens: { id: string; nome: string }[] }>(
      "clientes?status=ativos&pageSize=100",
    );
  const action = useComercialAction();
  async function vender(event: FormEvent) {
    event.preventDefault();
    if (await action.run("vouchers", { servicoId, clienteId, vencimento })) {
      data.reload();
      setServicoId("");
      setClienteId("");
    }
  }
  async function confirmar(event: FormEvent) {
    event.preventDefault();
    if (
      selected &&
      (await action.run("vouchers/" + selected.id + "/" + selected.acao, {
        motivo,
      }))
    ) {
      setSelected(null);
      setMotivo("");
      data.reload();
    }
  }
  return (
    <>
      <h1>Vouchers e atendimentos</h1>
      <form className="catalog-form" onSubmit={vender}>
        <h2>Vender serviço</h2>
        <fieldset disabled={action.locked || !!selected}>
          <div className="form-grid">
            <div>
              <label htmlFor="voucher-servico">Serviço</label>
              <select
                id="voucher-servico"
                required
                value={servicoId}
                onChange={(event) => setServicoId(event.target.value)}
              >
                <option value="">Selecione</option>
                {servicos.data?.itens
                  .filter((item) => item.ativo)
                  .map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.nome} · {formatPrice(item.preco)}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label htmlFor="voucher-cliente">Cliente</label>
              <select
                id="voucher-cliente"
                required
                value={clienteId}
                onChange={(event) => setClienteId(event.target.value)}
              >
                <option value="">Selecione</option>
                {clientes.data?.itens.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.nome}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="voucher-vencimento">
                Vencimento da conta a receber
              </label>
              <input
                id="voucher-vencimento"
                type="date"
                required
                min={diaLocal()}
                value={vencimento}
                onChange={(event) => setVencimento(event.target.value)}
              />
            </div>
          </div>
          <button disabled={action.busy}>
            Gerar voucher e conta a receber
          </button>
        </fieldset>
      </form>
      <CommercialFeedback error={action.error} uncertain={action.uncertain} />
      {[data.error, servicos.error, clientes.error]
        .filter(Boolean)
        .map((error, index) => (
          <p role="alert" key={index}>
            {error}
          </p>
        ))}
      <label htmlFor="buscar-voucher">Buscar por código ou serviço</label>
      <input
        id="buscar-voucher"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setPage(1);
        }}
      />
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Cliente e serviço</th>
              <th>Validade</th>
              <th>Situação</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {data.data?.itens.map((item) => (
              <tr key={item.id}>
                <td>{item.codigo}</td>
                <td>
                  {item.clienteNome}
                  <br />
                  {item.servicoNome}
                </td>
                <td>{item.validoAte}</td>
                <td>
                  {item.expirado
                    ? "Expirado"
                    : {
                        ATIVO: "Ativo",
                        USADO: "Atendido",
                        CANCELADO: "Cancelado",
                      }[item.status]}
                </td>
                <td>
                  <Link href={"/financeiro/titulos/" + item.tituloId}>
                    Conta a receber
                  </Link>
                  <div className="form-actions">
                    {item.status === "ATIVO" && !item.expirado && (
                      <button
                        className="secondary"
                        disabled={action.locked}
                        onClick={() =>
                          setSelected({ id: item.id, acao: "usar" })
                        }
                      >
                        Registrar atendimento
                      </button>
                    )}
                    {item.status !== "CANCELADO" && (
                      <button
                        className="secondary"
                        disabled={action.locked}
                        onClick={() =>
                          setSelected({ id: item.id, acao: "cancelar" })
                        }
                      >
                        Cancelar voucher
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected && (
        <form className="catalog-form" onSubmit={confirmar}>
          <h2>
            {selected.acao === "usar"
              ? "Confirmar atendimento e consumir insumos"
              : "Cancelar voucher e estornar operações"}
          </h2>
          <label htmlFor="motivo-voucher">Motivo ou observação</label>
          <textarea
            id="motivo-voucher"
            required
            minLength={3}
            maxLength={500}
            disabled={action.locked}
            value={motivo}
            onChange={(event) => setMotivo(event.target.value)}
          />
          <div className="form-actions">
            <button disabled={action.busy}>
              {action.uncertain ? "Reenviar confirmação" : "Confirmar"}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={action.locked}
              onClick={() => setSelected(null)}
            >
              Voltar
            </button>
          </div>
        </form>
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
