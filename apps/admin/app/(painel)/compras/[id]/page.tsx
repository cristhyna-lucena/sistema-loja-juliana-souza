import { currentUser } from "../../../../lib/auth";
import { CatalogDenied } from "../../../../components/catalog-denied";
import { PurchaseDetail } from "../../../../components/purchases";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await currentUser();
  if (user.perfil === "CONTADORA") return <CatalogDenied />;
  return <PurchaseDetail id={(await params).id} />;
}
