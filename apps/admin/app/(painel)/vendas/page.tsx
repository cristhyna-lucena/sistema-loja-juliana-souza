import { currentUser } from "../../../lib/auth";
import { CatalogDenied } from "../../../components/catalog-denied";
import { SalesList } from "../../../components/sales-list";
export default async function Page(){const user=await currentUser();if(user.perfil==="CONTADORA")return <CatalogDenied/>;return <SalesList/>;}