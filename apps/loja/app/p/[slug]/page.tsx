import { ShopProduct } from "../../../components/shop-catalog";
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  return <ShopProduct slug={(await params).slug} />;
}
