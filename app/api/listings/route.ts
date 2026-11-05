import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser, errorResponse } from "@/lib/auth/server";

const createListingSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(200),
    description: z.string().trim().max(5000).optional().nullable(),
    price: z.number().positive("Price must be greater than 0").max(100000),
    floor_price: z
      .number()
      .nonnegative("Floor price cannot be negative")
      .optional()
      .nullable(),
  })
  .strict();

// Public browse list. floor_price is private to the seller and never selected here.
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("listings")
      .select(
        "id, seller_id, title, description, price, created_at, seller:users!seller_id(id, email)",
      )
      .order("created_at", { ascending: false });
    if (error)
      return NextResponse.json(
        { error: "Failed to fetch listings" },
        { status: 500 },
      );
    return NextResponse.json(data ?? []);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser("seller");
    const parsed = createListingSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid listing data" },
        { status: 400 },
      );
    }
    const { title, description, price, floor_price } = parsed.data;
    if (floor_price != null && floor_price > price) {
      return NextResponse.json(
        { error: "Floor price cannot exceed the asking price" },
        { status: 400 },
      );
    }
    const { data, error } = await supabaseAdmin
      .from("listings")
      .insert({
        seller_id: user.id,
        title,
        description: description || null,
        price,
        floor_price: floor_price ?? null,
      })
      .select(
        "id, seller_id, title, description, price, floor_price, created_at",
      ) // owner-only response
      .single();
    if (error)
      return NextResponse.json(
        { error: "Failed to create listing" },
        { status: 500 },
      );
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
