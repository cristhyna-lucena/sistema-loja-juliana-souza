import { currentUser } from "../../../lib/auth";
import { ContactList } from "../../../components/contact-list";
import { CatalogDenied } from "../../../components/catalog-denied";
export default async function Page({ searchParams }: { searchParams: Promise<{ salvo?: string }> }) {
  const user = await currentUser(); if (user.perfil === "CONTADORA") return <CatalogDenied />;
  return <ContactList kind="fornecedores" success={(await searchParams).salvo === "1"}/>;
}