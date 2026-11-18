import { currentUser } from "../../../../lib/auth";
import { CatalogDenied } from "../../../../components/catalog-denied";
import { ServiceForm } from "../../../../components/services-panel";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await currentUser();
  if (user.perfil === "CONTADORA") return <CatalogDenied />;
  return <ServiceForm id={(await params).id} />;
}
