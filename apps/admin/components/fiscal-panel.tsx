"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { formatPrice } from "@sistema/shared";
import {
  useComercialAction,
  useComercialData,
  diaLocal,
} from "../lib/comercial-client";
import { CommercialFeedback } from "./comercial-common";

type Recebida = {
  id: string;
  numero: string;
  chave: string;
  fornecedorNome: string;
  valorTotal: string;
  status: string;
  compraId: string | null;
};
type Emitida = {
  id: string;
  modelo: string;
  status: string;
  mensagem: string | null;
  danfeUrl: string | null;
  createdAt: string;
};
const status: Record<string, string> = {
  NOVA: "Nova",
  CIENCIA: "Ciência registrada",
  IMPORTADA: "Entrada registrada",
  PENDENTE: "Na fila",
  PROCESSANDO: "Em processamento",
  AUTORIZADA: "Autorizada",
  CANCELADA: "Cancelada",
  ERRO: "Requer revisão",
  CONCLUIDO: "Concluído",
};

export function FiscalPanel({
  initialTab = "emitidas",
}: {
  initialTab?: string;
}) {
  const [tab, setTab] = useState(initialTab),
    [page, setPage] = useState(1),
    [mes, setMes] = useState(diaLocal().slice(0, 7));
  const recebidas = useComercialData<{ itens: Recebida[]; pages: number }>(
      "fiscal/recebidas?page=" + page,
    ),
    emitidas = useComercialData<{ itens: Emitida[]; pages: number }>(
      "fiscal/emitidas?page=" + page,
    );
  const opcoes = useComercialData<{
    vendas: { id: string; numero: number; clienteNome: string | null }[];
    vouchers: { id: string; codigo: string; servicoNome: string }[];
  }>("fiscal/opcoes");
  const jobs =
    useComercialData<
      {
        id: string;
        tipo: string;
        status: string;
        tentativas: number;
        erro: string | null;
      }[]
    >("fiscal/integracoes");
  const [xml, setXml] = useState(""),
    [fileError, setFileError] = useState(""),
    [success, setSuccess] = useState(""),
    [downloadBusy, setDownloadBusy] = useState(false);
  const [modelo, setModelo] = useState("NFCE"),
    [origemId, setOrigemId] = useState(""),
    [codigoListaServico, setCodigoListaServico] = useState(""),
    [aliquotaIss, setAliquotaIss] = useState(""),
    [codigoNbs, setCodigoNbs] = useState("");
  const [selected, setSelected] = useState<{
      id: string;
      acao: "cancelar" | "corrigir";
    } | null>(null),
    [justificativa, setJustificativa] = useState("");
  const action = useComercialAction();
  function atualizar() {
    recebidas.reload();
    emitidas.reload();
    jobs.reload();
    opcoes.reload();
  }
  async function executar(path: string, payload: object, mensagem: string) {
    if (await action.run(path, payload)) {
      setSuccess(mensagem);
      atualizar();
      return true;
    }
    return false;
  }
  async function importar(event: FormEvent) {
    event.preventDefault();
    await executar(
      "fiscal/recebidas/xml",
      { xml },
      "XML importado. Confira os itens antes de dar entrada.",
    );
  }
  async function emitir(event: FormEvent) {
    event.preventDefault();
    await executar(
      "fiscal/emitidas",
      {
        modelo,
        ...(modelo === "NFSE"
          ? {
              voucherId: origemId,
              codigoListaServico,
              ...(aliquotaIss ? { aliquotaIss } : {}),
              ...(codigoNbs ? { codigoNbs } : {}),
            }
          : { vendaId: origemId }),
        endereco: null,
      },
      "Emissão enviada para a fila. Atualize para acompanhar o retorno.",
    );
  }
  async function corrigir(event: FormEvent) {
    event.preventDefault();
    if (
      selected &&
      (await executar(
        "fiscal/emitidas/" + selected.id + "/" + selected.acao,
        selected.acao === "cancelar"
          ? { motivo: justificativa }
          : { correcao: justificativa },
        "Solicitação enviada para a fila.",
      ))
    ) {
      setSelected(null);
      setJustificativa("");
    }
  }
  async function exportar() {
    setDownloadBusy(true);
    setFileError("");
    try {
      const response = await fetch(
        "/api/gestao/fiscal/exportar?mes=" + encodeURIComponent(mes),
        { cache: "no-store" },
      );
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.message);
      }
      const url = URL.createObjectURL(await response.blob()),
        link = document.createElement("a");
      link.href = url;
      link.download = "notas-" + mes + ".zip";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setFileError(
        error instanceof Error ? error.message : "Erro ao exportar XMLs.",
      );
    } finally {
      setDownloadBusy(false);
    }
  }
  const lista = tab === "recebidas" ? recebidas : emitidas;
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Fiscal</h1>
          <p className="muted">
            Notas recebidas, emissão e acompanhamento das integrações.
          </p>
        </div>
        <button className="secondary" onClick={atualizar}>
          Atualizar notas
        </button>
      </div>
      <nav className="commercial-tabs" aria-label="Áreas fiscais">
        {[
          ["emitidas", "Notas emitidas"],
          ["recebidas", "Notas recebidas"],
          ["integracoes", "Fila de integrações"],
        ].map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? "" : "secondary"}
            aria-pressed={tab === key}
            onClick={() => {
              setTab(key);
              setPage(1);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      <CommercialFeedback error={action.error} uncertain={action.uncertain} />
      {success && <p role="status">{success}</p>}
      {fileError && <p role="alert">{fileError}</p>}
      {tab === "recebidas" && (
        <>
          <button
            disabled={action.busy}
            onClick={() =>
              executar(
                "fiscal/sincronizar",
                {},
                "Consulta de notas recebidas agendada.",
              )
            }
          >
            Consultar notas na Focus
          </button>
          {recebidas.error && <p role="alert">{recebidas.error}</p>}
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Nota</th>
                  <th>Fornecedor</th>
                  <th>Total</th>
                  <th>Situação</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {recebidas.data?.itens.map((nota) => (
                  <tr key={nota.id}>
                    <td>
                      <Link href={"/fiscal/recebidas/" + nota.id}>
                        {nota.numero}
                      </Link>
                    </td>
                    <td>{nota.fornecedorNome}</td>
                    <td>{formatPrice(nota.valorTotal)}</td>
                    <td>{status[nota.status] ?? nota.status}</td>
                    <td>
                      {!nota.compraId && (
                        <button
                          className="secondary"
                          disabled={action.locked}
                          onClick={() =>
                            executar(
                              "fiscal/recebidas/" + nota.id + "/ciencia",
                              {},
                              "Manifestação de ciência solicitada. Aguarde o XML completo.",
                            )
                          }
                        >
                          Manifestar ciência
                        </button>
                      )}
                      {nota.compraId && (
                        <Link href={"/compras/" + nota.compraId}>
                          Ver entrada
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form className="catalog-form" onSubmit={importar}>
            <h2>Importar XML de NF-e recebida</h2>
            <fieldset disabled={action.locked}>
              <label htmlFor="xml-recebido">Arquivo XML completo</label>
              <input
                id="xml-recebido"
                type="file"
                accept=".xml,application/xml,text/xml"
                required
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  setFileError("");
                  if (!file) {
                    setXml("");
                    return;
                  }
                  if (file.size > 1_900_000) {
                    setFileError("O XML deve ter até 1,9 MB.");
                    setXml("");
                    return;
                  }
                  setXml(await file.text());
                }}
              />
            </fieldset>
            <button disabled={action.busy || !xml}>Importar XML</button>
          </form>
        </>
      )}
      {tab === "emitidas" && (
        <>
          {emitidas.error && <p role="alert">{emitidas.error}</p>}
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Modelo e referência</th>
                  <th>Situação</th>
                  <th>Retorno</th>
                  <th>Documentos e ações</th>
                </tr>
              </thead>
              <tbody>
                {emitidas.data?.itens.map((nota) => (
                  <tr key={nota.id}>
                    <td>
                      {nota.modelo}
                      <br />
                      {nota.id}
                    </td>
                    <td>{status[nota.status] ?? nota.status}</td>
                    <td>{nota.mensagem}</td>
                    <td>
                      <div className="form-actions">
                        <button
                          className="secondary"
                          disabled={action.locked}
                          onClick={() =>
                            executar(
                              "fiscal/emitidas/" + nota.id + "/consultar",
                              {},
                              "Consulta agendada.",
                            )
                          }
                        >
                          Consultar
                        </button>
                        <a
                          href={
                            "/api/gestao/fiscal/emitidas/" + nota.id + "/xml"
                          }
                        >
                          Baixar XML
                        </a>
                        {nota.danfeUrl && (
                          <a
                            href={nota.danfeUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Abrir DANFE
                          </a>
                        )}
                        {nota.status === "AUTORIZADA" && (
                          <>
                            <button
                              className="secondary"
                              disabled={action.locked}
                              onClick={() =>
                                setSelected({ id: nota.id, acao: "cancelar" })
                              }
                            >
                              Cancelar nota
                            </button>
                            {nota.modelo === "NFE" && (
                              <button
                                className="secondary"
                                disabled={action.locked}
                                onClick={() =>
                                  setSelected({ id: nota.id, acao: "corrigir" })
                                }
                              >
                                Carta de correção
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selected && (
            <form className="catalog-form" onSubmit={corrigir}>
              <h2>
                {selected.acao === "cancelar"
                  ? "Solicitar cancelamento da nota"
                  : "Registrar carta de correção"}
              </h2>
              <label htmlFor="justificativa-fiscal">
                {selected.acao === "cancelar"
                  ? "Justificativa"
                  : "Texto da correção"}
              </label>
              <textarea
                id="justificativa-fiscal"
                required
                minLength={15}
                maxLength={selected.acao === "cancelar" ? 255 : 1000}
                disabled={action.locked}
                value={justificativa}
                onChange={(event) => setJustificativa(event.target.value)}
              />
              <button disabled={action.busy}>Enviar solicitação</button>
            </form>
          )}
          <form className="catalog-form" onSubmit={emitir}>
            <h2>Emitir nota fiscal</h2>
            <fieldset disabled={action.locked}>
              <label htmlFor="modelo-nota">Modelo</label>
              <select
                id="modelo-nota"
                value={modelo}
                onChange={(event) => {
                  setModelo(event.target.value);
                  setOrigemId("");
                }}
              >
                <option value="NFCE">NFC-e de venda no balcão</option>
                <option value="NFE">NF-e de venda com entrega</option>
                <option value="NFSE">NFS-e de serviço</option>
              </select>
              <label htmlFor="operacao-nota">
                {modelo === "NFSE" ? "Voucher de serviço" : "Venda"}
              </label>
              <select
                id="operacao-nota"
                required
                value={origemId}
                onChange={(event) => setOrigemId(event.target.value)}
              >
                <option value="">Selecione</option>
                {modelo === "NFSE"
                  ? opcoes.data?.vouchers.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.servicoNome} · {item.codigo}
                      </option>
                    ))
                  : opcoes.data?.vendas.map((item) => (
                      <option key={item.id} value={item.id}>
                        Venda {item.numero} ·{" "}
                        {item.clienteNome ?? "Consumidor não identificado"}
                      </option>
                    ))}
              </select>
              {modelo === "NFSE" && (
                <>
                  <label htmlFor="lista-servico">
                    Código do serviço (NFS-e Nacional: 00.00.00, ex.: 06.03.01;
                    Focus: 00.00)
                  </label>
                  <input
                    id="lista-servico"
                    required
                    value={codigoListaServico}
                    onChange={(event) =>
                      setCodigoListaServico(event.target.value)
                    }
                  />
                  <label htmlFor="codigo-nbs">
                    Código NBS (só NFS-e Nacional, ex.: 1.2602.10.00)
                  </label>
                  <input
                    id="codigo-nbs"
                    value={codigoNbs}
                    onChange={(event) => setCodigoNbs(event.target.value)}
                  />
                  <label htmlFor="aliquota-iss">
                    Alíquota ISS / tributos aproximados (%) — no Simples sem
                    retenção vale só como informação
                  </label>
                  <input
                    id="aliquota-iss"
                    inputMode="decimal"
                    value={aliquotaIss}
                    onChange={(event) => setAliquotaIss(event.target.value)}
                  />
                </>
              )}
            </fieldset>
            <button disabled={action.busy}>Solicitar emissão</button>
            {opcoes.error && <p role="alert">{opcoes.error}</p>}
          </form>
          <section className="catalog-form">
            <h2>Exportar XMLs para a contadora</h2>
            <label htmlFor="mes-exportacao">Mês de emissão</label>
            <input
              id="mes-exportacao"
              type="month"
              required
              value={mes}
              onChange={(event) => setMes(event.target.value)}
            />
            <button disabled={downloadBusy} onClick={exportar}>
              {downloadBusy ? "Preparando arquivo…" : "Baixar XMLs do mês"}
            </button>
          </section>
        </>
      )}
      {tab === "integracoes" && (
        <>
          {jobs.error && <p role="alert">{jobs.error}</p>}
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Operação</th>
                  <th>Situação</th>
                  <th>Tentativas</th>
                  <th>Retorno</th>
                </tr>
              </thead>
              <tbody>
                {jobs.data?.map((job) => (
                  <tr key={job.id}>
                    <td>{job.tipo.replaceAll("_", " ")}</td>
                    <td>{status[job.status] ?? job.status}</td>
                    <td>{job.tentativas}</td>
                    <td>
                      {job.erro}
                      {job.status === "ERRO" && (
                        <button
                          className="secondary"
                          disabled={action.locked}
                          onClick={() =>
                            executar(
                              "fiscal/integracoes/" + job.id + "/repetir",
                              {},
                              "Operação reenviada para a fila.",
                            )
                          }
                        >
                          Reenviar integração
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {tab !== "integracoes" && (
        <div className="form-actions">
          <button
            className="secondary"
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            Anterior
          </button>
          <span>
            Página {page} de {lista.data?.pages ?? 1}
          </span>
          <button
            className="secondary"
            disabled={page >= (lista.data?.pages ?? 1)}
            onClick={() => setPage(page + 1)}
          >
            Próxima
          </button>
        </div>
      )}
    </>
  );
}

export function ReceivedInvoice({
  id,
  podeDarEntrada,
}: {
  id: string;
  podeDarEntrada: boolean;
}) {
  const data = useComercialData<
    Recebida & {
      xml: string | null;
      dados: {
        itens?: {
          numero: number;
          descricao: string;
          quantidade: string;
          total: string;
        }[];
      };
    }
  >("fiscal/recebidas/" + id);
  if (data.error) return <p role="alert">{data.error}</p>;
  if (!data.data) return <p role="status">Carregando nota…</p>;
  const nota = data.data;
  return (
    <>
      <h1>Nota recebida {nota.numero}</h1>
      <p>{nota.fornecedorNome}</p>
      <p>{nota.chave}</p>
      <p>Total {formatPrice(nota.valorTotal)}</p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Descrição</th>
              <th>Quantidade</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {nota.dados.itens?.map((item) => (
              <tr key={item.numero}>
                <td>{item.descricao}</td>
                <td>{item.quantidade}</td>
                <td>{formatPrice(item.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="form-actions">
        {podeDarEntrada && nota.xml && !nota.compraId && (
          <Link className="button-link" href={"/compras/nova?notaId=" + id}>
            Conferir produtos e dar entrada
          </Link>
        )}
        {nota.compraId && (
          <Link href={"/compras/" + nota.compraId}>Ver compra registrada</Link>
        )}
        <Link href="/fiscal/recebidas">Voltar para notas recebidas</Link>
      </div>
    </>
  );
}
