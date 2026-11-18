import { currentUser } from "../../../lib/auth";
import { CatalogList } from "../../../components/catalog-list";
import { CatalogDenied } from "../../../components/catalog-denied";
export default async function Page() { const user = await currentUser(); if (user.perfil === "CONTADORA") return <CatalogDenied/>; return <CatalogList kind="produtos" estoque/>; }
