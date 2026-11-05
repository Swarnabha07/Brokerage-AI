import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/auth/server";
import { getBuyerDashboard } from "@/lib/api/deals";

export async function GET() {
  try {
    const user = await requireUser("buyer");
    return NextResponse.json(await getBuyerDashboard(user));
  } catch (err) {
    return errorResponse(err);
  }
}
