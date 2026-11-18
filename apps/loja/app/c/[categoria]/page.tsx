import { ShopCatalog } from "../../../components/shop-catalog";
export default async function Page({
  params,
}: {
  params: Promise<{ categoria: string }>;
}) {
  return <ShopCatalog categoriaId={(await params).categoria} />;
}
