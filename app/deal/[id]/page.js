import { notFound } from "next/navigation";
import { DealWorkspace } from "@/components/features/deal/DealWorkspace";
import { getAllDealIds, getDealById } from "@/lib/api/deals";
import { DEMO_RETURN_WINDOW_SECONDS } from "@/lib/config";
import { FEE_RATE_LABEL } from "@/lib/fees";

export const metadata = { title: "Deal" };

export async function generateStaticParams() {
  const ids = await getAllDealIds();
  return ids.map((id) => ({ id }));
}

export default async function DealPage({ params }) {
  const { id } = await params;
  const deal = await getDealById(id);
  if (!deal) notFound();

  return (
    <DealWorkspace
      deal={deal}
      returnWindowSeconds={DEMO_RETURN_WINDOW_SECONDS}
      feeLabel={FEE_RATE_LABEL}
    />
  );
}
