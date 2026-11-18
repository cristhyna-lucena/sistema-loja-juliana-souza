import { currentUser } from "../../../../lib/auth";
import { ContactForm } from "../../../../components/contact-form";
import { CatalogDenied } from "../../../../components/catalog-denied";
export default async function Page() {
  const user = await currentUser(); if (user.perfil === "CONTADORA") return <CatalogDenied />;
  return <ContactForm kind="fornecedores"/>;
}