import { currentUser } from "../../../../../lib/auth";
import { CatalogDenied } from "../../../../../components/catalog-denied";
import { ReceivedInvoice } from "../../../../../components/fiscal-panel";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await currentUser();
  if (user.perfil === "OPERADOR") return <CatalogDenied />;
  return (
    <ReceivedInvoice
      id={(await params).id}
      podeDarEntrada={user.perfil === "ADMIN"}
    />
  );
}
