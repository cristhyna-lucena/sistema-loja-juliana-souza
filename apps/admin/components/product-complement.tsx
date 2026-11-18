"use client";
import { useEffect, useState, type FormEvent } from "react";
import { type ComplementoProdutoInput } from "@sistema/shared";
import { gestaoRequest } from "../lib/gestao-client";
import { useComercialAction } from "../lib/comercial-client";
import { CommercialFeedback } from "./comercial-common";

type Complemento = Omit<ComplementoProdutoInput, "chaveOperacao">;
const defaults: Complemento = {
  versao: 1,
  ncm: null,
  cest: null,
  ean: null,
  cfopVenda: null,
  origem: 0,
  csosn: null,
  cst: null,
  aliquotaIcms: null,
  aliquotaIbs: null,
  aliquotaCbs: null,
  cstIbsCbs: null,
  classificacaoIbsCbs: null,
  aliquotaIbsMunicipal: null,
  cfopInterestadual: null,
  cstPis: null,
  cstCofins: null,
  aliquotaPis: null,
  aliquotaCofins: null,
  pesoGramas: null,
  alturaCm: null,
  larguraCm: null,
  comprimentoCm: null,
  publicadoLoja: false,
  slug: "",
};

export function ProductComplement({ produtoId }: { produtoId: string }) {
  const [data, setData] = useState<Complemento | null>(null),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const action = useComercialAction();
  async function carregar() {
    try {
      const row = await gestaoRequest<Complemento>(
        "administracao/produtos/" + produtoId,
      );
      setData(
        Object.fromEntries(
          Object.keys(defaults).map((key) => [
            key,
            row[key as keyof Complemento] ?? defaults[key as keyof Complemento],
          ]),
        ) as Complemento,
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Erro ao carregar dados fiscais.",
      );
    }
  }
  useEffect(() => {
    void carregar();
  }, [produtoId]);
  async function salvar(event: FormEvent) {
    event.preventDefault();
    if (
      data &&
      (await action.run("administracao/produtos/" + produtoId, data))
    ) {
      setSuccess("Dados fiscais e de publicação salvos.");
      await carregar();
    }
  }
  if (!data)
    return (
      <p role={error ? "alert" : "status"}>
        {error || "Carregando dados complementares…"}
      </p>
    );
  return (
    <section>
      <form className="catalog-form" onSubmit={salvar}>
        <h2>Dados fiscais e loja online</h2>
        <fieldset disabled={action.locked}>
          <div className="form-grid">
            {(
              [
                ["ncm", "NCM (8 dígitos)"],
                ["cest", "CEST (7 dígitos)"],
                ["ean", "Código de barras"],
                ["cfopVenda", "CFOP de venda"],
                ["csosn", "CSOSN"],
                ["cst", "CST"],
                ["aliquotaIcms", "Alíquota ICMS (%)"],
                ["aliquotaIbs", "Alíquota IBS (%)"],
                ["aliquotaCbs", "Alíquota CBS (%)"],
                ["cstIbsCbs", "CST IBS/CBS"],
                ["classificacaoIbsCbs", "Classificação tributária IBS/CBS"],
                ["aliquotaIbsMunicipal", "Alíquota IBS municipal (%)"],
                ["cfopInterestadual", "CFOP interestadual"],
                ["cstPis", "CST PIS"],
                ["cstCofins", "CST Cofins"],
                ["aliquotaPis", "Alíquota PIS (%)"],
                ["aliquotaCofins", "Alíquota Cofins (%)"],
              ] as const
            ).map(([field, label]) => (
              <div key={field}>
                <label htmlFor={"fiscal-" + field}>{label}</label>
                <input
                  id={"fiscal-" + field}
                  maxLength={14}
                  value={data[field] ?? ""}
                  onChange={(event) =>
                    setData({ ...data, [field]: event.target.value || null })
                  }
                />
              </div>
            ))}
            <div>
              <label htmlFor="origem-produto">
                Origem fiscal do produto (0 a 8)
              </label>
              <input
                id="origem-produto"
                type="number"
                required
                min={0}
                max={8}
                value={data.origem}
                onChange={(event) =>
                  setData({ ...data, origem: Number(event.target.value) })
                }
              />
            </div>
          </div>
          <h3>Dados de entrega</h3>
          <div className="form-grid">
            {(
              [
                ["pesoGramas", "Peso em gramas"],
                ["alturaCm", "Altura em cm"],
                ["larguraCm", "Largura em cm"],
                ["comprimentoCm", "Comprimento em cm"],
              ] as const
            ).map(([field, label]) => (
              <div key={field}>
                <label htmlFor={"entrega-" + field}>{label}</label>
                <input
                  id={"entrega-" + field}
                  type="number"
                  min={1}
                  max={field === "pesoGramas" ? 30000 : 100}
                  value={data[field] ?? ""}
                  onChange={(event) =>
                    setData({
                      ...data,
                      [field]: event.target.value
                        ? Number(event.target.value)
                        : null,
                    })
                  }
                />
              </div>
            ))}
          </div>
          <label htmlFor="slug-produto">Endereço do produto na loja</label>
          <input
            id="slug-produto"
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            maxLength={160}
            value={data.slug}
            onChange={(event) => setData({ ...data, slug: event.target.value })}
          />
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={data.publicadoLoja}
              onChange={(event) =>
                setData({ ...data, publicadoLoja: event.target.checked })
              }
            />
            Publicar produto na loja
          </label>
        </fieldset>
        <CommercialFeedback error={action.error} uncertain={action.uncertain} />
        {success && <p role="status">{success}</p>}
        <button disabled={action.busy}>
          {action.uncertain
            ? "Reenviar dados"
            : "Salvar dados fiscais e publicação"}
        </button>
      </form>
    </section>
  );
}
