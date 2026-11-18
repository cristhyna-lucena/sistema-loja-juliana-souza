import { currentUser } from "../../../../lib/auth";
import { CatalogDenied } from "../../../../components/catalog-denied";
import { SaleForm } from "../../../../components/sale-form";
export default async function Page(){const user=await currentUser();if(user.perfil==="CONTADORA")return <CatalogDenied/>;return <SaleForm/>;}