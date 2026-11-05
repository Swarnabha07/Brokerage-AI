import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/auth/server";
import { getSellerDashboard } from "@/lib/api/deals";

export async function GET() {
  try {
    const user = await requireUser("seller");
    return NextResponse.json(await getSellerDashboard(user));
  } catch (err) {
    return errorResponse(err);
  }
}
