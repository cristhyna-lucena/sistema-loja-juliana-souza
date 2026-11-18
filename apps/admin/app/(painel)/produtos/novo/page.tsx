import { currentUser } from "../../../../lib/auth";
import { catalogData } from "../../../../lib/catalogo-server";
import { CatalogForm } from "../../../../components/catalog-form";
import { CatalogDenied } from "../../../../components/catalog-denied";
import type { CategoriaDTO } from "@sistema/shared";
export default async function Page() { const user = await currentUser(); if (user.perfil === "CONTADORA") return <CatalogDenied />; const categorias = await catalogData<CategoriaDTO[]>("/categorias/opcoes"); return <CatalogForm kind="produtos" categorias={categorias} />; }
