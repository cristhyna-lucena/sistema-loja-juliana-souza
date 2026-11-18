"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { clienteSchema, fornecedorSchema } from "@sistema/shared";
import { CatalogError } from "../lib/catalogo-client";
import { gestaoRequest, type ContatoDTO } from "../lib/gestao-client";
export function ContactForm({ kind, initial }: { kind: "clientes" | "fornecedores"; initial?: ContatoDTO }) {
  const cliente = kind === "clientes", label = cliente ? "cliente" : "fornecedor";
  const router = useRouter();
  const [values, setValues] = useState({ nome: initial?.nome ?? "", cpfCnpj: initial?.cpfCnpj ?? "", email: initial?.email ?? "", telefone: initial?.telefone ?? "", ativo: initial?.ativo ?? true });
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [conflict, setConflict] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function submit(e: FormEvent) {
    e.preventDefault(); setError(""); setErrors({}); setConflict(false);
    const parsed = (cliente ? clienteSchema : fornecedorSchema).safeParse({ ...values, cpfCnpj: values.cpfCnpj.trim() || null, email: values.email.trim() || null, telefone: values.telefone.trim() || null });
    if (!parsed.success) { setErrors(Object.fromEntries(parsed.error.issues.map(i => [i.path.join("."), i.message]))); setError("Confira os campos destacados."); return; }
    setBusy(true);
    try {
      await gestaoRequest(kind + (initial ? "/" + initial.id : ""), { method: initial ? "PATCH" : "POST", body: JSON.stringify({ ...parsed.data, ...(initial ? { versao: initial.versao } : {}) }) });
      router.push("/" + kind + "?salvo=1"); router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível salvar.");
      if (e instanceof CatalogError) { setConflict(e.status === 409 && !!initial); if (e.errors) setErrors(Object.fromEntries(e.errors.map(i => [i.campo, i.message]))); }
      setBusy(false);
    }
  }
  return <><Link className="back-link" href={"/" + kind}>← Voltar para {kind}</Link><p className="eyebrow">GESTÃO DA LOJA</p><h1>{initial ? "Editar " : "Novo "}{label}</h1><p className="muted">{cliente ? "CPF/CNPJ e contatos são opcionais." : "Informe o CPF/CNPJ do fornecedor para identificar o cadastro."}</p><form className="catalog-form" onSubmit={submit}><fieldset disabled={busy}><div className="form-grid">{(["nome", "cpfCnpj", "email", "telefone"] as const).map(field => <div key={field} className={field === "nome" ? "span-full" : undefined}><label htmlFor={field}>{({ nome: "Nome", cpfCnpj: "CPF/CNPJ", email: "E-mail", telefone: "Telefone" })[field]}</label><input id={field} type={field === "email" ? "email" : field === "telefone" ? "tel" : "text"} value={values[field]} onChange={e => setValues(v => ({ ...v, [field]: e.target.value }))} required={field === "nome" || field === "cpfCnpj" && !cliente} maxLength={field === "nome" ? 160 : field === "email" ? 254 : field === "cpfCnpj" ? 18 : 25} aria-invalid={!!errors[field]} aria-describedby={errors[field] ? field + "-error" : undefined}/>{errors[field] && <p className="field-error" id={field + "-error"}>{errors[field]}</p>}</div>)}<div className="span-full"><label className="checkbox-label"><input type="checkbox" checked={values.ativo} onChange={e => setValues(v => ({ ...v, ativo: e.target.checked }))}/>{cliente ? "Cliente ativo" : "Fornecedor ativo"}</label></div></div></fieldset>{error && <p role="alert">{error}</p>}{conflict && <button type="button" className="secondary" onClick={() => window.location.reload()}>Recarregar cadastro</button>}<div className="form-actions"><button type="submit" disabled={busy}>{busy ? "Salvando…" : "Salvar " + label}</button><Link href={"/" + kind}>Cancelar</Link></div></form></>;
}
