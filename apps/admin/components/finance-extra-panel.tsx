"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import {
  formatPrice,
  type ContaFinanceiraDTO,
  type CaixaDTO,
  type TituloFinanceiroDTO,
} from "@sistema/shared";
import {
  useComercialAction,
  useComercialData,
  diaLocal,
} from "../lib/comercial-client";
import { CommercialFeedback } from "./comercial-common";

export function FinanceExtraPanel() {
  const action = useComercialAction(),
    contas = useComercialData<ContaFinanceiraDTO[]>("financeiro/contas");
  const categorias = useComercialData<
    { id: string; nome: string; tipo: string }[]
  >("financeiro/categorias");
  const transferencias = useComercialData<
    {
      id: string;
      origemId: string;
      descricao: string;
      valor: string;
      canceladoEm: string | null;
    }[]
  >("financeiro/transferencias");
  const fechamentos = useComercialData<
    {
      id: string;
      data: string;
      saldoEsperado: string;
      saldoContado: string;
      diferenca: string;
    }[]
  >("financeiro/fechamentos");
  const caixa = useComercialData<CaixaDTO>("financeiro/caixa?pageSize=100");
  const titulos = useComercialData<{ itens: TituloFinanceiroDTO[] }>(
    "financeiro/titulos?status=ABERTO&pageSize=100",
  );
  const [origemId, setOrigemId] = useState(""),
    [destinoId, setDestinoId] = useState(""),
    [valor, setValor] = useState(""),
    [dia, setDia] = useState(diaLocal()),
    [motivo, setMotivo] = useState("");
  const [nomeCategoria, setNomeCategoria] = useState(""),
    [tipoCategoria, setTipoCategoria] = useState("PAGAR"),
    [success, setSuccess] = useState("");
  const [contaFechamento, setContaFechamento] = useState(""),
    [dataFechamento, setDataFechamento] = useState(diaLocal()),
    [contado, setContado] = useState(""),
    [observacao, setObservacao] = useState("");
  const [lancamentoId, setLancamentoId] = useState(""),
    [referenciaExterna, setReferenciaExterna] = useState("");
  const [tituloId, setTituloId] = useState(""),
    [parcelas, setParcelas] = useState([
      { valor: "", vencimento: diaLocal() },
      { valor: "", vencimento: diaLocal() },
    ]);
  const [estornoId, setEstornoId] = useState(""),
    [motivoEstorno, setMotivoEstorno] = useState("");
  async function executar(path: string, body: object, mensagem: string) {
    setSuccess("");
    if (await action.run(path, body)) {
      setSuccess(mensagem);
      contas.reload();
      categorias.reload();
      transferencias.reload();
      fechamentos.reload();
      caixa.reload();
      titulos.reload();
      return true;
    }
    return false;
  }
  async function transferir(event: FormEvent) {
    event.preventDefault();
    await executar(
      "financeiro/transferencias",
      { origemId, destinoId, valor, data: dia, motivo },
      "Transferência registrada.",
    );
  }
  async function categoria(event: FormEvent) {
    event.preventDefault();
    if (
      await executar(
        "financeiro/categorias",
        { nome: nomeCategoria, tipo: tipoCategoria, ativa: true },
        "Categoria criada.",
      )
    )
      setNomeCategoria("");
  }
  async function fechar(event: FormEvent) {
    event.preventDefault();
    await executar(
      "financeiro/fechamentos",
      {
        contaId: contaFechamento,
        data: dataFechamento,
        saldoContado: contado,
        observacao,
      },
      "Conferência de caixa registrada.",
    );
  }
  async function conciliar(event: FormEvent) {
    event.preventDefault();
    await executar(
      "financeiro/lancamentos/" + lancamentoId + "/conciliar",
      { referenciaExterna },
      "Lançamento conciliado.",
    );
  }
  async function parcelar(event: FormEvent) {
    event.preventDefault();
    await executar(
      "financeiro/parcelamentos",
      { tituloId, parcelas },
      "Parcelas registradas.",
    );
  }
  async function estornar(event: FormEvent) {
    event.preventDefault();
    if (
      await executar(
        "financeiro/transferencias/" + estornoId + "/estornar",
        { motivo: motivoEstorno },
        "Transferência estornada.",
      )
    )
      setEstornoId("");
  }
  return (
    <>
      <h1>Conferência financeira</h1>
      <Link href="/financeiro">Voltar para financeiro</Link>
      <CommercialFeedback error={action.error} uncertain={action.uncertain} />
      {success && <p role="status">{success}</p>}
      {[
        contas.error,
        categorias.error,
        transferencias.error,
        fechamentos.error,
        caixa.error,
        titulos.error,
      ]
        .filter(Boolean)
        .map((error, index) => (
          <p role="alert" key={index}>
            {error}
          </p>
        ))}
      <form className="catalog-form" onSubmit={transferir}>
        <h2>Transferir entre contas</h2>
        <fieldset disabled={action.locked}>
          <div className="form-grid">
            <div>
              <label htmlFor="origem-transferencia">Conta de origem</label>
              <select
                id="origem-transferencia"
                required
                value={origemId}
                onChange={(event) => setOrigemId(event.target.value)}
              >
                <option value="">Selecione</option>
                {contas.data
                  ?.filter((conta) => conta.ativa)
                  .map((conta) => (
                    <option key={conta.id} value={conta.id}>
                      {conta.nome}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label htmlFor="destino-transferencia">Conta de destino</label>
              <select
                id="destino-transferencia"
                required
                value={destinoId}
                onChange={(event) => setDestinoId(event.target.value)}
              >
                <option value="">Selecione</option>
                {contas.data
                  ?.filter((conta) => conta.ativa && conta.id !== origemId)
                  .map((conta) => (
                    <option key={conta.id} value={conta.id}>
                      {conta.nome}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label htmlFor="valor-transferencia">
                Valor da transferência (R$)
              </label>
              <input
                id="valor-transferencia"
                required
                inputMode="decimal"
                value={valor}
                onChange={(event) => setValor(event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="data-transferencia">Data da transferência</label>
              <input
                id="data-transferencia"
                required
                type="date"
                max={diaLocal()}
                value={dia}
                onChange={(event) => setDia(event.target.value)}
              />
            </div>
            <div className="span-full">
              <label htmlFor="motivo-transferencia">Motivo</label>
              <input
                id="motivo-transferencia"
                required
                minLength={3}
                maxLength={500}
                value={motivo}
                onChange={(event) => setMotivo(event.target.value)}
              />
            </div>
          </div>
        </fieldset>
        <button disabled={action.busy}>Registrar transferência</button>
      </form>
      <h2>Transferências registradas</h2>
      {transferencias.data?.map((item) => (
        <div className="form-actions" key={item.id}>
          <span>
            {item.descricao} · {formatPrice(item.valor)} ·{" "}
            {item.canceladoEm ? "Estornada" : "Registrada"}
          </span>
          {!item.canceladoEm && (
            <button
              className="secondary"
              disabled={action.locked}
              onClick={() => setEstornoId(item.origemId)}
            >
              Estornar transferência
            </button>
          )}
        </div>
      ))}
      {estornoId && (
        <form className="catalog-form" onSubmit={estornar}>
          <label htmlFor="motivo-estorno-transferencia">
            Motivo do estorno
          </label>
          <input
            id="motivo-estorno-transferencia"
            required
            minLength={3}
            maxLength={500}
            disabled={action.locked}
            value={motivoEstorno}
            onChange={(event) => setMotivoEstorno(event.target.value)}
          />
          <button disabled={action.busy}>
            Confirmar estorno da transferência
          </button>
        </form>
      )}
      <form className="catalog-form" onSubmit={fechar}>
        <h2>Conferir e fechar caixa</h2>
        <p className="muted">
          O saldo esperado considera os lançamentos em dinheiro até a data
          escolhida.
        </p>
        <fieldset disabled={action.locked}>
          <div className="form-grid">
            <div>
              <label htmlFor="conta-fechamento">Caixa</label>
              <select
                id="conta-fechamento"
                required
                value={contaFechamento}
                onChange={(event) => setContaFechamento(event.target.value)}
              >
                <option value="">Selecione</option>
                {contas.data
                  ?.filter((conta) => conta.ativa && conta.tipo === "CAIXA")
                  .map((conta) => (
                    <option key={conta.id} value={conta.id}>
                      {conta.nome}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label htmlFor="data-fechamento">Data do fechamento</label>
              <input
                id="data-fechamento"
                required
                type="date"
                max={diaLocal()}
                value={dataFechamento}
                onChange={(event) => setDataFechamento(event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="saldo-contado">Dinheiro contado (R$)</label>
              <input
                id="saldo-contado"
                required
                inputMode="decimal"
                value={contado}
                onChange={(event) => setContado(event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="observacao-fechamento">
                Observação da conferência
              </label>
              <input
                id="observacao-fechamento"
                required
                minLength={3}
                maxLength={500}
                value={observacao}
                onChange={(event) => setObservacao(event.target.value)}
              />
            </div>
          </div>
        </fieldset>
        <button disabled={action.busy}>Registrar fechamento</button>
      </form>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Esperado</th>
              <th>Contado</th>
              <th>Diferença</th>
            </tr>
          </thead>
          <tbody>
            {fechamentos.data?.map((item) => (
              <tr key={item.id}>
                <td>{item.data}</td>
                <td>{formatPrice(item.saldoEsperado)}</td>
                <td>{formatPrice(item.saldoContado)}</td>
                <td>{formatPrice(item.diferenca)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className="catalog-form" onSubmit={conciliar}>
        <h2>Conciliar com extrato</h2>
        <fieldset disabled={action.locked}>
          <label htmlFor="lancamento-conciliacao">Lançamento</label>
          <select
            id="lancamento-conciliacao"
            required
            value={lancamentoId}
            onChange={(event) => setLancamentoId(event.target.value)}
          >
            <option value="">Selecione</option>
            {caixa.data?.itens
              .filter((item) => !item.conciliadoEm)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.data} · {item.conta} · {item.descricao} ·{" "}
                  {formatPrice(item.valor)}
                </option>
              ))}
          </select>
          <label htmlFor="referencia-conciliacao">Referência do extrato</label>
          <input
            id="referencia-conciliacao"
            required
            maxLength={160}
            value={referenciaExterna}
            onChange={(event) => setReferenciaExterna(event.target.value)}
          />
        </fieldset>
        <button disabled={action.busy}>Confirmar conciliação</button>
      </form>
      <form className="catalog-form" onSubmit={parcelar}>
        <h2>Parcelar saldo de conta manual</h2>
        <fieldset disabled={action.locked}>
          <label htmlFor="titulo-parcelamento">Conta em aberto</label>
          <select
            id="titulo-parcelamento"
            required
            value={tituloId}
            onChange={(event) => setTituloId(event.target.value)}
          >
            <option value="">Selecione</option>
            {titulos.data?.itens
              .filter((item) => !item.vendaId)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.descricao} · {formatPrice(item.saldo)}
                </option>
              ))}
          </select>
          {parcelas.map((parcela, index) => (
            <div className="form-grid" key={index}>
              <div>
                <label htmlFor={"parcela-valor" + index}>
                  Valor da parcela {index + 1}
                </label>
                <input
                  id={"parcela-valor" + index}
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
                <label htmlFor={"parcela-data" + index}>
                  Vencimento da parcela {index + 1}
                </label>
                <input
                  id={"parcela-data" + index}
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
        </fieldset>
        <button disabled={action.busy}>Confirmar parcelamento</button>
      </form>
      <form className="catalog-form" onSubmit={categoria}>
        <h2>Categorias financeiras</h2>
        <ul>
          {categorias.data?.map((item) => (
            <li key={item.id}>
              {item.nome} · {item.tipo === "PAGAR" ? "Despesa" : "Receita"}
            </li>
          ))}
        </ul>
        <fieldset disabled={action.locked}>
          <label htmlFor="categoria-financeira-nome">
            Nome da categoria financeira
          </label>
          <input
            id="categoria-financeira-nome"
            required
            maxLength={160}
            value={nomeCategoria}
            onChange={(event) => setNomeCategoria(event.target.value)}
          />
          <label htmlFor="categoria-financeira-tipo">Tipo da categoria</label>
          <select
            id="categoria-financeira-tipo"
            value={tipoCategoria}
            onChange={(event) => setTipoCategoria(event.target.value)}
          >
            <option value="PAGAR">Despesa</option>
            <option value="RECEBER">Receita</option>
          </select>
        </fieldset>
        <button disabled={action.busy}>Criar categoria financeira</button>
      </form>
    </>
  );
}
