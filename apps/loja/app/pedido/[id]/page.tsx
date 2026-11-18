import { ShopOrder } from "../../../components/shop-account";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <ShopOrder id={(await params).id} />;
}
