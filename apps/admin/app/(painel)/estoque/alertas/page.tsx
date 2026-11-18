import { currentUser } from "../../../../lib/auth";
import { CatalogDenied } from "../../../../components/catalog-denied";
import { StockAlerts } from "../../../../components/stock-alerts";
export default async function Page() { const user = await currentUser(); if (user.perfil === "CONTADORA") return <CatalogDenied/>; return <StockAlerts/>; }
