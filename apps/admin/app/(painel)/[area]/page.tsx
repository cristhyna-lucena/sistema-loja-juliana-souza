import { notFound,redirect } from "next/navigation";
import { apiFetch } from "../../../lib/auth";
import { Icon,type IconName } from "../../../components/icon";
import Link from "next/link";
const titles:Record<string,string>={financeiro:"Financeiro",operacao:"Operação",configuracoes:"Configurações"};
const icons:Record<string,IconName>={financeiro:"wallet",operacao:"activity",configuracoes:"settings"};
export default async function AreaPage({params}:{params:Promise<{area:string}>}){
 const{area}=await params;if(!Object.hasOwn(titles,area))notFound();
 const response=await apiFetch("/acesso/"+area);if(response.status===401)redirect("/login");
 if(response.status===403)return <section className="module-placeholder"><span className="module-icon"><Icon name="lock" size={28}/></span><h1>Acesso restrito</h1><p>Você não tem permissão para acessar esta área.</p></section>;
 if(!response.ok)throw new Error("Área temporariamente indisponível.");
 if(area==="operacao")return <><div className="page-heading"><div><p className="eyebrow">GESTÃO DA LOJA</p><h1>Operação</h1><p className="muted">Cadastros e estoque para cuidar do dia a dia da loja.</p></div></div><div className="stock-summary">{[{href:"/vendas",title:"Vendas",text:"Registre vendas, recebimentos e cancelamentos."},{href:"/clientes",title:"Clientes",text:"Cadastre contatos e mantenha os dados atualizados."},{href:"/fornecedores",title:"Fornecedores",text:"Organize os parceiros que abastecem a loja."},{href:"/estoque",title:"Estoque",text:"Confira saldos, lotes e registre entradas e saídas."}].map(item=><article className="dashboard-card" key={item.href}><h2>{item.title}</h2><p className="muted">{item.text}</p><Link className="button-link" href={item.href}>Acessar {item.title.toLowerCase()}</Link></article>)}</div></>;
 return <><p className="eyebrow">GESTÃO DA LOJA</p><h1>{titles[area]}</h1><p className="muted">Mais organização para a sua operação.</p><section className="module-placeholder"><span className="module-icon"><Icon name={icons[area]} size={30}/></span><span className="upcoming-badge"><Icon name="clock" size={13}/>Em preparação</span><h2>Uma nova etapa para sua gestão.</h2><p>As ferramentas desta área serão disponibilizadas aqui.</p></section></>;
}
