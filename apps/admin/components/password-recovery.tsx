"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";

export function PasswordRecovery({
  redefinir = false,
}: {
  redefinir?: boolean;
}) {
  const [email, setEmail] = useState(""),
    [senha, setSenha] = useState(""),
    [confirmacao, setConfirmacao] = useState("");
  const [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
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
      const body = redefinir
        ? { token: window.location.hash.slice(1), senha }
        : { email };
      const response = await fetch(
        "/api/auth/" + (redefinir ? "redefinir" : "recuperar"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
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
    <main
      className="login-form"
      style={{ maxWidth: 480, margin: "60px auto", padding: 24 }}
    >
      <h1>{redefinir ? "Definir nova senha" : "Recuperar senha"}</h1>
      <form onSubmit={submit}>
        {redefinir ? (
          <>
            <label htmlFor="nova-senha">Nova senha</label>
            <input
              id="nova-senha"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
              value={senha}
              onChange={(event) => setSenha(event.target.value)}
            />
            <label htmlFor="confirmar-senha">Confirme a nova senha</label>
            <input
              id="confirmar-senha"
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
            <label htmlFor="email-recuperacao">E-mail cadastrado</label>
            <input
              id="email-recuperacao"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </>
        )}
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
      <Link href="/login">Voltar para o login</Link>
    </main>
  );
}
