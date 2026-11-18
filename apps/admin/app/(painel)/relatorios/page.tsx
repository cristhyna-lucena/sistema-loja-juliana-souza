import { currentUser } from "../../../lib/auth";
import { CatalogDenied } from "../../../components/catalog-denied";
import { ReportsPanel } from "../../../components/reports-panel";
export default async function Page() {
  if ((await currentUser()).perfil === "OPERADOR") return <CatalogDenied />;
  return <ReportsPanel />;
}
