import { ShopService } from "../../../components/shop-services";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <ShopService id={(await params).id} />;
}
