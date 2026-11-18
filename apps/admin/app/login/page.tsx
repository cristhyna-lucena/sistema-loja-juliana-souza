import { LoginForm } from "./login-form";
import { Icon } from "../../components/icon";

export default function LoginPage() {
  return <div className="login-page">
    <header className="login-header"><img src="/brand/juliana-souza.webp" alt="Juliana Souza — Amor em cada detalhe" width={1100} height={261}/><span>ÁREA ADMINISTRATIVA</span></header>
    <main className="login-shell">
      <section className="login-brand" aria-labelledby="login-title">
        <div className="login-brand-copy"><p className="eyebrow">CATÁLOGO E OPERAÇÃO</p><h1 id="login-title">Gestão da loja</h1><p>Acompanhe os produtos, organize as categorias e gerencie as imagens do catálogo.</p></div>
      </section>
      <section className="login-right"><div className="login-card"><p className="eyebrow">BEM-VINDO</p><h2>Entre no painel</h2><p className="muted login-intro">Informe seu e-mail e sua senha para continuar.</p><LoginForm/><p className="login-trust"><Icon name="lock" size={14}/>Acesso restrito à equipe.</p></div></section>
    </main>
  </div>;
}
