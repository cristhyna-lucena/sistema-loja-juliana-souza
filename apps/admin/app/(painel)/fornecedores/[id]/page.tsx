import { currentUser } from "../../../../lib/auth";
import { catalogData } from "../../../../lib/catalogo-server";
import { ContactForm } from "../../../../components/contact-form";
import { CatalogDenied } from "../../../../components/catalog-denied";
import type { ContatoDTO } from "../../../../lib/gestao-client";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser(); if (user.perfil === "CONTADORA") return <CatalogDenied />;
  const { id } = await params;
  const initial = await catalogData<ContatoDTO>("/fornecedores/" + encodeURIComponent(id));
  return <ContactForm kind="fornecedores" initial={initial}/>;
}