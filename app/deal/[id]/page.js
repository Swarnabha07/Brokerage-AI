import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { DealWorkspace } from "@/components/features/deal/DealWorkspace";
import { getDealById, isUuid } from "@/lib/api/deals";
import { getVerifiedUser } from "@/lib/auth/server";
import { DEMO_RETURN_WINDOW_SECONDS } from "@/lib/config";
import { FEE_RATE_LABEL } from "@/lib/fees";

export const metadata = { title: "Deal" };

// Real deals are private and per-user: no generateStaticParams, rendered per request.
export default async function DealPage({ params, searchParams }) {
  await connection();
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const paymentParam = ["return", "cancelled"].includes(sp.payment) ? sp.payment : null;
  const user = isUuid(id) ? await getVerifiedUser() : null;
  if (isUuid(id) && !user) redirect("/login");

  const deal = await getDealById(id, user);
  if (!deal) notFound(); // non-members get the same 404 as a missing deal

  return (
    <DealWorkspace
      deal={deal}
      returnWindowSeconds={DEMO_RETURN_WINDOW_SECONDS}
      feeLabel={FEE_RATE_LABEL}
      paymentParam={paymentParam}
    />
  );
}
