"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../../components/icon";
export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [visible,setVisible]=useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: data.get("email"), senha: data.get("senha") }) });
      if (!response.ok) { const result = await response.json(); setError(typeof result.message === "string" ? result.message : "Não foi possível entrar."); return; }
      router.replace("/"); router.refresh();
    } catch { setError("Não foi possível conectar. Tente novamente."); }
    finally { setBusy(false); }
  }
  return <form className="login-form" onSubmit={submit}><label htmlFor="email">E-mail</label><div className="input-with-icon"><Icon name="mail" size={18}/><input id="email" name="email" type="email" autoComplete="username" required maxLength={254} placeholder="voce@exemplo.com" /></div><label htmlFor="senha">Senha</label><div className="input-with-icon password-input"><Icon name="lock" size={18}/><input id="senha" name="senha" type={visible?"text":"password"} autoComplete="current-password" required maxLength={128} placeholder="Digite sua senha"/><button className="password-toggle" type="button" aria-label={visible?"Ocultar senha":"Mostrar senha"} aria-pressed={visible} onClick={()=>setVisible(value=>!value)}><Icon name={visible?"eyeOff":"eye"} size={18}/></button></div><div className="form-message" aria-live="polite">{error && <p role="alert">{error}</p>}</div><button type="submit" disabled={busy}><span>{busy ? "Entrando…" : "Entrar"}</span><Icon name="arrow" size={18}/></button><Link href="/recuperar-senha">Esqueci minha senha</Link></form>;
}
