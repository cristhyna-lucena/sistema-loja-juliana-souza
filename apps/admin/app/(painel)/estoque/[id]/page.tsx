import { currentUser } from "../../../../lib/auth";
import { catalogData } from "../../../../lib/catalogo-server";
import { CatalogDenied } from "../../../../components/catalog-denied";
import { StockPanel } from "../../../../components/stock-panel";
import type { ProdutoDTO } from "@sistema/shared";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser(); if (user.perfil === "CONTADORA") return <CatalogDenied/>;
  const { id } = await params;
  const produto = await catalogData<ProdutoDTO>("/produtos/" + encodeURIComponent(id));
  return <StockPanel produto={produto}/>;
}
