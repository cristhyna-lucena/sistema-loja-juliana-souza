import { currentUser } from "../../../lib/auth";
import { CatalogDenied } from "../../../components/catalog-denied";
import { SettingsPanel } from "../../../components/settings-panel";
export default async function Page() {
  if ((await currentUser()).perfil !== "ADMIN") return <CatalogDenied />;
  return <SettingsPanel />;
}
