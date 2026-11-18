import Link from "next/link";
import { currentUser } from "../../../lib/auth";
import { CatalogDenied } from "../../../components/catalog-denied";
import { FinancePanel } from "../../../components/finance-panel";
export default async function Page(){const user=await currentUser();if(user.perfil==="OPERADOR")return <CatalogDenied/>;return <><div className="form-actions"><Link href="/financeiro/conferencia">Transferências, conciliação e fechamento</Link><Link href="/relatorios">Relatórios</Link></div><FinancePanel admin={user.perfil==="ADMIN"}/></>;}