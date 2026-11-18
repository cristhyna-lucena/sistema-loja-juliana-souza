import { currentUser } from "../../../../lib/auth";
import { CatalogDenied } from "../../../../components/catalog-denied";
import { ServiceForm } from "../../../../components/services-panel";
export default async function Page() {
  const user = await currentUser();
  if (user.perfil === "CONTADORA") return <CatalogDenied />;
  return <ServiceForm />;
}
