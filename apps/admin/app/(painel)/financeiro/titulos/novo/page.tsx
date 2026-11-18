import { currentUser } from "../../../../../lib/auth";
import { CatalogDenied } from "../../../../../components/catalog-denied";
import { FinancialTitleForm } from "../../../../../components/financial-title";
export default async function Page(){const user=await currentUser();if(user.perfil==="OPERADOR")return <CatalogDenied/>;return <FinancialTitleForm/>;}