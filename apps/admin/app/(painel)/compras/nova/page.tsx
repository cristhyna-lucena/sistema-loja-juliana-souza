import { currentUser } from "../../../../lib/auth";
import { CatalogDenied } from "../../../../components/catalog-denied";
import { PurchaseForm } from "../../../../components/purchases";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ notaId?: string }>;
}) {
  const user = await currentUser();
  if (user.perfil === "CONTADORA") return <CatalogDenied />;
  return <PurchaseForm notaId={(await searchParams).notaId} />;
}
