import { SaleInstallments } from "../../../../components/sale-installments";
import { currentUser } from "../../../../lib/auth";
import { catalogData } from "../../../../lib/catalogo-server";
import { CatalogDenied } from "../../../../components/catalog-denied";
import { SaleDetail } from "../../../../components/sale-detail";
import type { VendaDTO } from "@sistema/shared";
export default async function Page({params}:{params:Promise<{id:string}>}){const user=await currentUser();if(user.perfil==="CONTADORA")return <CatalogDenied/>;const {id}=await params;return <><SaleDetail initial={await catalogData<VendaDTO>("/vendas/"+encodeURIComponent(id))} canFinance={user.perfil==="ADMIN"}/><SaleInstallments id={id}/></>;}