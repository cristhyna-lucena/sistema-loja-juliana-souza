"use client";
import { useEffect, useState, type FormEvent } from "react";
import {
  configuracaoSchema,
  type ConfiguracaoInput,
  type ContaFinanceiraDTO,
} from "@sistema/shared";
import { gestaoRequest } from "../lib/gestao-client";
import { useComercialAction, useComercialData } from "../lib/comercial-client";
import { CommercialFeedback } from "./comercial-common";

type Config = Omit<ConfiguracaoInput, "chaveOperacao"> & {
  credenciais: Record<string, boolean>;
};
type Usuario = {
  id: string;
  nome: string;
  email: string;
  perfil: "ADMIN" | "CONTADORA" | "OPERADOR";
  ativo: boolean;
};

export function SettingsPanel() {
  const [config, setConfig] = useState<Config | null>(null),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const action = useComercialAction(),
    contas = useComercialData<ContaFinanceiraDTO[]>("financeiro/contas/opcoes");
  async function carregar() {
    try {
      setConfig(await gestaoRequest<Config>("administracao/configuracao"));
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Erro ao carregar configurações.",
      );
    }
  }
  useEffect(() => {
    void carregar();
  }, []);
  async function salvar(event: FormEvent) {
    event.preventDefault();
    if (!config) return;
    const payload = Object.fromEntries(
      Object.keys(configuracaoSchema.shape)
        .filter((key) => key !== "chaveOperacao")
        .map((key) => [key, config[key as keyof Config]]),
    );
    if (await action.run("administracao/configuracao", payload)) {
      setSuccess("Configurações salvas.");
      await carregar();
    }
  }
  if (!config)
    return (
      <p role={error ? "alert" : "status"}>
        {error || "Carregando configurações…"}
      </p>
    );
  function alterar(field: keyof ConfiguracaoInput, value: unknown) {
    setConfig((current) =>
      current ? { ...current, [field]: value } : current,
    );
  }
  return (
    <>
      <h1>Configurações</h1>
      <form className="catalog-form" onSubmit={salvar}>
        <fieldset disabled={action.locked}>
          <h2>Dados da empresa</h2>
          <div className="form-grid">
            {(
              [
                ["nome", "Nome da loja"],
                ["razaoSocial", "Razão social"],
                ["cnpj", "CNPJ sem pontuação"],
                ["inscricaoEstadual", "Inscrição estadual"],
                ["inscricaoMunicipal", "Inscrição municipal"],
                ["email", "E-mail da empresa"],
                ["telefone", "Telefone"],
                ["cepOrigem", "CEP de origem sem pontuação"],
              ] as const
            ).map(([field, label]) => (
              <div key={field}>
                <label htmlFor={field}>{label}</label>
                <input
                  id={field}
                  required={field === "nome"}
                  maxLength={160}
                  value={config[field] ?? ""}
                  onChange={(event) =>
                    alterar(field, event.target.value || null)
                  }
                />
              </div>
            ))}
          </div>
          <h2>Endereço da empresa</h2>
          <div className="form-grid">
            {(
              [
                "cep",
                "logradouro",
                "numero",
                "complemento",
                "bairro",
                "cidade",
                "uf",
                "codigoIbge",
              ] as const
            ).map((field) => (
              <div key={field}>
                <label htmlFor={"endereco-" + field}>
                  {
                    {
                      cep: "CEP",
                      logradouro: "Logradouro",
                      numero: "Número",
                      complemento: "Complemento",
                      bairro: "Bairro",
                      cidade: "Cidade",
                      uf: "UF",
                      codigoIbge: "Código IBGE do município",
                    }[field]
                  }
                </label>
                <input
                  id={"endereco-" + field}
                  maxLength={160}
                  value={config.endereco?.[field] ?? ""}
                  onChange={(event) =>
                    alterar("endereco", {
                      cep: "",
                      logradouro: "",
                      numero: "",
                      complemento: "",
                      bairro: "",
                      cidade: "",
                      uf: "",
                      codigoIbge: "",
                      ...config.endereco,
                      [field]: event.target.value,
                    })
                  }
                />
              </div>
            ))}
          </div>
          <h2>Fiscal</h2>
          <div className="form-grid">
            <div>
              <label htmlFor="regime">Regime tributário</label>
              <select
                id="regime"
                value={config.regimeTributario ?? ""}
                onChange={(event) =>
                  alterar("regimeTributario", event.target.value || null)
                }
              >
                <option value="">Selecione</option>
                <option value="SIMPLES">Simples Nacional</option>
                <option value="PRESUMIDO">Lucro presumido</option>
                <option value="REAL">Lucro real</option>
              </select>
            </div>
            <div>
              <label htmlFor="ambiente-fiscal">Ambiente fiscal</label>
              <select
                id="ambiente-fiscal"
                value={config.ambienteFiscal}
                onChange={(event) =>
                  alterar("ambienteFiscal", event.target.value)
                }
              >
                <option value="homologacao">Homologação</option>
                <option value="producao">Produção</option>
              </select>
            </div>
            {(["serieNfe", "serieNfce"] as const).map((field) => (
              <div key={field}>
                <label htmlFor={field}>
                  {field === "serieNfe" ? "Série NF-e" : "Série NFC-e"}
                </label>
                <input
                  id={field}
                  type="number"
                  min={1}
                  max={999}
                  required
                  value={config[field]}
                  onChange={(event) =>
                    alterar(field, Number(event.target.value))
                  }
                />
              </div>
            ))}
          </div>
          <h2>Pagamentos e integrações</h2>
          <p className="muted">
            Você pode configurar e ativar os provedores depois. Mercado Pago,
            Asaas e Pagar.me ficam disponíveis para integração. As credenciais
            são configuradas no ambiente do servidor.
          </p>
          <p className="muted">
            No painel: dinheiro, Pix, crédito, débito, transferência e boleto.
            Na loja online: Pix, boleto e cartões conforme a habilitação do
            provedor.
          </p>
          {(
            [
              ["mercadoPago", "Mercado Pago"],
              ["asaas", "Asaas"],
              ["pagarme", "Pagar.me"],
              ["focus", "Focus NFe"],
              ["sefaz", "SEFAZ direta: notas recebidas (gratuito, certificado A1)"],
            ] as const
          ).map(([field, label]) => (
            <div className="form-actions" key={field}>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={config.integracoes[field]}
                  onChange={(event) =>
                    alterar("integracoes", {
                      ...config.integracoes,
                      [field]: event.target.checked,
                    })
                  }
                />
                {label}
              </label>
              <span>
                {config.credenciais[field]
                  ? "Credenciais configuradas"
                  : "Credenciais pendentes"}
              </span>
            </div>
          ))}
          <label htmlFor="conta-online">
            Conta financeira dos recebimentos online
          </label>
          <select
            id="conta-online"
            value={config.contaOnlineId ?? ""}
            onChange={(event) =>
              alterar("contaOnlineId", event.target.value || null)
            }
          >
            <option value="">Selecione</option>
            {contas.data?.map((conta) => (
              <option key={conta.id} value={conta.id}>
                {conta.nome}
              </option>
            ))}
          </select>
          <h2>Entrega</h2>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={config.correiosAtivo}
              onChange={(event) =>
                alterar("correiosAtivo", event.target.checked)
              }
            />
            Oferecer Correios
          </label>
          <p className="muted">
            {config.credenciais.correios
              ? "Credenciais dos Correios configuradas."
              : "Credenciais dos Correios pendentes."}
          </p>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={config.freteGratisAtivo}
              onChange={(event) =>
                alterar("freteGratisAtivo", event.target.checked)
              }
            />
            Oferecer frete grátis
          </label>
          <label htmlFor="minimo-frete-gratis">
            Valor mínimo para frete grátis (R$)
          </label>
          <input
            id="minimo-frete-gratis"
            inputMode="decimal"
            value={config.freteGratisMinimo}
            onChange={(event) =>
              alterar("freteGratisMinimo", event.target.value)
            }
          />
          <p className="muted">
            E-mail de recuperação e notificações{" "}
            {config.credenciais.email
              ? "configurado"
              : "com configuração pendente"}
            .
          </p>
        </fieldset>
        <CommercialFeedback error={action.error} uncertain={action.uncertain} />
        {success && <p role="status">{success}</p>}
        <button disabled={action.busy}>
          {action.uncertain ? "Reenviar configurações" : "Salvar configurações"}
        </button>
      </form>
      <UsersPanel />
    </>
  );
}

function UsersPanel() {
  const data = useComercialData<Usuario[]>("administracao/usuarios"),
    action = useComercialAction();
  const [nome, setNome] = useState(""),
    [email, setEmail] = useState(""),
    [senha, setSenha] = useState(""),
    [perfil, setPerfil] = useState<Usuario["perfil"]>("OPERADOR"),
    [ativo, setAtivo] = useState(true),
    [editing, setEditing] = useState<string | null>(null);
  function limpar() {
    setEditing(null);
    setNome("");
    setEmail("");
    setSenha("");
    setPerfil("OPERADOR");
    setAtivo(true);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const payload = editing
      ? { nome, perfil, ativo }
      : { nome, email, senha, perfil };
    if (
      await action.run(
        "administracao/usuarios" + (editing ? "/" + editing : ""),
        payload,
        editing ? "PATCH" : "POST",
      )
    ) {
      limpar();
      data.reload();
    }
  }
  return (
    <section>
      <h2>Usuários e permissões</h2>
      {data.error && <p role="alert">{data.error}</p>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>E-mail</th>
              <th>Perfil</th>
              <th>Situação</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {data.data?.map((usuario) => (
              <tr key={usuario.id}>
                <td>{usuario.nome}</td>
                <td>{usuario.email}</td>
                <td>
                  {
                    {
                      ADMIN: "Administrador",
                      OPERADOR: "Operador",
                      CONTADORA: "Contadora",
                    }[usuario.perfil]
                  }
                </td>
                <td>{usuario.ativo ? "Ativo" : "Inativo"}</td>
                <td>
                  <button
                    className="secondary"
                    disabled={action.locked}
                    onClick={() => {
                      setEditing(usuario.id);
                      setNome(usuario.nome);
                      setEmail(usuario.email);
                      setPerfil(usuario.perfil);
                      setAtivo(usuario.ativo);
                    }}
                  >
                    Editar {usuario.nome}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className="catalog-form" onSubmit={submit}>
        <h3>{editing ? "Editar usuário" : "Cadastrar usuário"}</h3>
        <fieldset disabled={action.locked}>
          <div className="form-grid">
            <div>
              <label htmlFor="usuario-nome">Nome do usuário</label>
              <input
                id="usuario-nome"
                required
                maxLength={160}
                value={nome}
                onChange={(event) => setNome(event.target.value)}
              />
            </div>
            {!editing && (
              <>
                <div>
                  <label htmlFor="usuario-email">E-mail do usuário</label>
                  <input
                    id="usuario-email"
                    type="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="usuario-senha">Senha inicial</label>
                  <input
                    id="usuario-senha"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    maxLength={128}
                    value={senha}
                    onChange={(event) => setSenha(event.target.value)}
                  />
                </div>
              </>
            )}
            <div>
              <label htmlFor="usuario-perfil">Perfil do usuário</label>
              <select
                id="usuario-perfil"
                value={perfil}
                onChange={(event) =>
                  setPerfil(event.target.value as Usuario["perfil"])
                }
              >
                <option value="ADMIN">Administrador</option>
                <option value="OPERADOR">Operador</option>
                <option value="CONTADORA">Contadora</option>
              </select>
            </div>
            {editing && (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={ativo}
                  onChange={(event) => setAtivo(event.target.checked)}
                />
                Usuário ativo
              </label>
            )}
          </div>
        </fieldset>
        <CommercialFeedback error={action.error} uncertain={action.uncertain} />
        <div className="form-actions">
          <button disabled={action.busy}>
            {action.uncertain ? "Reenviar alteração" : "Salvar usuário"}
          </button>
          {editing && (
            <button
              type="button"
              className="secondary"
              disabled={action.locked}
              onClick={limpar}
            >
              Cancelar edição
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
