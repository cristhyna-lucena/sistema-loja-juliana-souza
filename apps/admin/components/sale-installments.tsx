"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { formatPrice, type VendaDTO } from "@sistema/shared";
import {
  diaLocal,
  useComercialAction,
  useComercialData,
} from "../lib/comercial-client";
import { CommercialFeedback } from "./comercial-common";
export function SaleInstallments({ id }: { id: string }) {
  const data = useComercialData<VendaDTO>("vendas/" + id),
    action = useComercialAction();
  const [parcelas, setParcelas] = useState([
    { valor: "", vencimento: diaLocal() },
    { valor: "", vencimento: diaLocal() },
  ]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await action.run("vendas/" + id + "/parcelar", { parcelas }))
      window.location.reload();
  }
  if (!data.data || data.data.status === "CANCELADA")
    return data.error ? <p role="alert">{data.error}</p> : null;
  if (data.data.parcelas?.length)
    return (
      <section>
        <h2>Parcelas da venda</h2>
        {data.data.parcelas.map((parcela) => (
          <p key={parcela.id}>
            <Link href={"/financeiro/titulos/" + parcela.id}>
              {parcela.descricao}
            </Link>{" "}
            · {parcela.vencimento} · Saldo {formatPrice(parcela.saldo)}
          </p>
        ))}
      </section>
    );
  if (!data.data.clienteId || data.data.titulo.saldo === "0.00") return null;
  return (
    <form className="catalog-form" onSubmit={submit}>
      <h2>Parcelar saldo da venda</h2>
      <p>Saldo a distribuir {formatPrice(data.data.titulo.saldo)}.</p>
      <fieldset disabled={action.locked}>
        {parcelas.map((parcela, index) => (
          <div className="form-grid" key={index}>
            <div>
              <label htmlFor={"venda-parcela-valor" + index}>
                Valor da parcela {index + 1}
              </label>
              <input
                id={"venda-parcela-valor" + index}
                inputMode="decimal"
                required
                value={parcela.valor}
                onChange={(event) =>
                  setParcelas((rows) =>
                    rows.map((row, n) =>
                      n === index ? { ...row, valor: event.target.value } : row,
                    ),
                  )
                }
              />
            </div>
            <div>
              <label htmlFor={"venda-parcela-data" + index}>
                Vencimento da parcela {index + 1}
              </label>
              <input
                id={"venda-parcela-data" + index}
                type="date"
                min={diaLocal()}
                required
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
      <CommercialFeedback error={action.error} uncertain={action.uncertain} />
      <button disabled={action.busy}>
        {action.uncertain
          ? "Reenviar parcelamento"
          : "Confirmar parcelas da venda"}
      </button>
    </form>
  );
}
