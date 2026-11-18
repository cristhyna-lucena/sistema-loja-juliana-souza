import { currentUser } from "../../../lib/auth";
import { CatalogDenied } from "../../../components/catalog-denied";
import { OrdersList } from "../../../components/orders-panel";
export default async function Page() {
  if ((await currentUser()).perfil === "CONTADORA") return <CatalogDenied />;
  return <OrdersList />;
}
