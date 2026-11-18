import { ProductComplement } from "../../../../components/product-complement";
import { ProductPhotos } from "../../../../components/product-photos";
import { currentUser } from "../../../../lib/auth";
import { catalogData } from "../../../../lib/catalogo-server";
import { CatalogForm } from "../../../../components/catalog-form";
import { CatalogDenied } from "../../../../components/catalog-denied";
import type { CategoriaDTO, ProdutoDTO } from "@sistema/shared";
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const user = await currentUser(); if (user.perfil === "CONTADORA") return <CatalogDenied />; const { id } = await params; const initial = await catalogData<ProdutoDTO>("/produtos/" + encodeURIComponent(id)); const categorias = await catalogData<CategoriaDTO[]>("/categorias/opcoes"); return <><CatalogForm kind="produtos" initial={initial} categorias={categorias} /><ProductComplement produtoId={id}/><ProductPhotos produtoId={id} nomeProduto={initial.nome} /></>; }
