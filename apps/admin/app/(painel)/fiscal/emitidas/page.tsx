import { currentUser } from "../../../../lib/auth";
import { CatalogDenied } from "../../../../components/catalog-denied";
import { FiscalPanel } from "../../../../components/fiscal-panel";
export default async function Page() {
  if ((await currentUser()).perfil === "OPERADOR") return <CatalogDenied />;
  return <FiscalPanel />;
}
