"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../../components/icon";
export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function logout() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error();
      router.replace("/login"); router.refresh();
    } catch { setError("Não foi possível sair. Tente novamente."); }
    finally { setBusy(false); }
  }
  return <div><button className="logout-button" onClick={logout} disabled={busy}><Icon name="logout" size={17}/><span>{busy ? "Saindo…" : "Sair"}</span></button>{error && <p role="alert">{error}</p>}</div>;
}
