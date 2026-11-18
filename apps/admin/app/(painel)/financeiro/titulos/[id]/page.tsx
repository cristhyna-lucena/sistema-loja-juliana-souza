import { currentUser } from "../../../../../lib/auth";
import { catalogData } from "../../../../../lib/catalogo-server";
import { CatalogDenied } from "../../../../../components/catalog-denied";
import { FinancialTitle,type FinancialTitleDetail } from "../../../../../components/financial-title";
export default async function Page({params}:{params:Promise<{id:string}>}){const user=await currentUser();if(user.perfil==="OPERADOR")return <CatalogDenied/>;const {id}=await params;return <FinancialTitle initial={await catalogData<FinancialTitleDetail>("/financeiro/titulos/"+encodeURIComponent(id))} canSales={user.perfil==="ADMIN"}/>;}