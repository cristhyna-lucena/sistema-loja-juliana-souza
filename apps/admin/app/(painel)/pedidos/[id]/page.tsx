import { currentUser } from "../../../../lib/auth";
import { CatalogDenied } from "../../../../components/catalog-denied";
import { OrderDetail } from "../../../../components/orders-panel";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if ((await currentUser()).perfil === "CONTADORA") return <CatalogDenied />;
  return <OrderDetail id={(await params).id} />;
}
