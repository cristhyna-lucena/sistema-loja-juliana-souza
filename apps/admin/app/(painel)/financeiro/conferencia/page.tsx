import { currentUser } from "../../../../lib/auth";
import { CatalogDenied } from "../../../../components/catalog-denied";
import { FinanceExtraPanel } from "../../../../components/finance-extra-panel";
export default async function Page() {
  if ((await currentUser()).perfil === "OPERADOR") return <CatalogDenied />;
  return <FinanceExtraPanel />;
}
