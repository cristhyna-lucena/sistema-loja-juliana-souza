"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ShopFrame, shopRequest } from "./shop-common";
export function ShopRecovery({ redefinir = false }: { redefinir?: boolean }) {
  const [email, setEmail] = useState(""),
    [senha, setSenha] = useState(""),
    [confirmacao, setConfirmacao] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (redefinir && senha !== confirmacao) {
      setError("As senhas devem ser iguais.");
      return;
    }
    setBusy(true);
    try {
      const result = await shopRequest<{ message: string }>(
        redefinir ? "redefinir" : "recuperar",
        redefinir ? { token: window.location.hash.slice(1), senha } : { email },
      );
      setMessage(result.message);
      if (redefinir) {
        setSenha("");
        setConfirmacao("");
        history.replaceState(null, "", window.location.pathname);
      }
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Não foi possível concluir. Tente novamente.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <ShopFrame>
      <div className="shop-account-form">
        <h1>{redefinir ? "Definir nova senha" : "Recuperar senha"}</h1>
        <form className="shop-form" onSubmit={submit}>
          <fieldset disabled={busy}>
            {redefinir ? (
              <>
                <label htmlFor="senha-nova">Nova senha</label>
                <input
                  id="senha-nova"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={128}
                  value={senha}
                  onChange={(event) => setSenha(event.target.value)}
                />
                <label htmlFor="senha-confirmacao">Confirme a nova senha</label>
                <input
                  id="senha-confirmacao"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={128}
                  value={confirmacao}
                  onChange={(event) => setConfirmacao(event.target.value)}
                />
              </>
            ) : (
              <>
                <label htmlFor="email-recuperar">E-mail cadastrado</label>
                <input
                  id="email-recuperar"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </>
            )}
          </fieldset>
          {error && <p role="alert">{error}</p>}
          {message && <p role="status">{message}</p>}
          <button disabled={busy}>
            {busy
              ? "Enviando…"
              : redefinir
                ? "Salvar nova senha"
                : "Enviar instruções"}
          </button>
        </form>
        <Link href="/entrar">Voltar para o login</Link>
      </div>
    </ShopFrame>
  );
}
