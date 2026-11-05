import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

const DEMO_SELLER_ID = '11111111-1111-1111-1111-111111111111';
const DEMO_BUYER_ID = '22222222-2222-2222-2222-222222222222';

const DEMO_USERS = [
  {
    id: DEMO_SELLER_ID,
    email: 'seller@escrowmate.demo',
    role: 'seller' as const,
  },
  {
    id: DEMO_BUYER_ID,
    email: 'buyer@escrowmate.demo',
    role: 'buyer' as const,
  },
];

const DEMO_LISTINGS = [
  {
    id: '33333333-3333-3333-3333-333333333331',
    seller_id: DEMO_SELLER_ID,
    title: 'MacBook Pro 14-inch M2 Pro (512GB, Space Gray)',
    description:
      'Flawless condition MacBook Pro 14" with Apple M2 Pro chip, 16GB unified memory, 512GB SSD. Battery health at 98%. Includes original 67W USB-C power adapter and MagSafe 3 cable.',
    price: 1200,
    floor_price: 1050,
  },
  {
    id: '33333333-3333-3333-3333-333333333332',
    seller_id: DEMO_SELLER_ID,
    title: 'Sony A7IV Mirrorless Camera Body (Low Shutter Count)',
    description:
      'Sony Alpha 7 IV 33MP Full-Frame mirrorless camera body. Shutter count under 4,200. Screen protector applied since day one. Comes with 2 Sony NP-FZ100 batteries, dual charger, and original box.',
    price: 1850,
    floor_price: 1650,
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    seller_id: DEMO_SELLER_ID,
    title: 'Herman Miller Aeron Ergonomic Chair (Size B, Graphite)',
    description:
      'Fully-loaded remastered Herman Miller Aeron size B. Includes PostureFit SL lumbar support, forward tilt limiter, and fully adjustable arms. Pristine condition mesh.',
    price: 650,
    floor_price: 550,
  },
];

const DEMO_BUYER_PROFILES = [
  {
    id: '44444444-4444-4444-4444-444444444441',
    name: 'Alex Chen',
    email: 'alex.chen@techbuyer.io',
    budget_min: 900,
    budget_max: 1300,
    interest_tags: ['laptop', 'apple', 'macbook', 'workstation', 'development'],
  },
  {
    id: '44444444-4444-4444-4444-444444444442',
    name: 'Maya Lin',
    email: 'maya.lin@lenscraft.studio',
    budget_min: 1500,
    budget_max: 2000,
    interest_tags: ['camera', 'sony', 'mirrorless', 'photography', 'videography', 'full-frame'],
  },
  {
    id: '44444444-4444-4444-4444-444444444443',
    name: 'David Miller',
    email: 'david.m@remotehome.org',
    budget_min: 450,
    budget_max: 700,
    interest_tags: ['chair', 'ergonomics', 'herman miller', 'office furniture', 'wfh setup'],
  },
  {
    id: '44444444-4444-4444-4444-444444444444',
    name: 'Sarah Jenkins',
    email: 'sarah.j@creativepro.net',
    budget_min: 1000,
    budget_max: 1900,
    interest_tags: ['tech', 'gadgets', 'apple', 'camera', 'gear'],
  },
];

export async function POST(request: Request) {
  // Dev-only: never available in production, and requires an explicit server-side secret.
  if (process.env.NODE_ENV === 'production' || !process.env.SEED_SECRET) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (request.headers.get('x-seed-secret') !== process.env.SEED_SECRET) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    // 1. Ensure demo users exist
    const { error: userError } = await supabaseAdmin
      .from('users')
      .upsert(DEMO_USERS, { onConflict: 'id' });

    if (userError) {
      console.error('Error seeding users:', userError);
      return NextResponse.json(
        { error: `Failed to seed users: ${userError.message}` },
        { status: 500 }
      );
    }

    // 2. Ensure demo listings exist
    const { error: listingError } = await supabaseAdmin
      .from('listings')
      .upsert(DEMO_LISTINGS, { onConflict: 'id' });

    if (listingError) {
      console.error('Error seeding listings:', listingError);
      return NextResponse.json(
        { error: `Failed to seed listings: ${listingError.message}` },
        { status: 500 }
      );
    }

    // 3. Ensure demo buyer profiles exist
    const { error: profileError } = await supabaseAdmin
      .from('buyer_profiles')
      .upsert(DEMO_BUYER_PROFILES, { onConflict: 'id' });

    if (profileError) {
      console.error('Error seeding buyer profiles:', profileError);
      return NextResponse.json(
        { error: `Failed to seed buyer profiles: ${profileError.message}` },
        { status: 500 }
      );
    }

    // Fetch and return the active listings
    const { data: listings, error: fetchError } = await supabaseAdmin
      .from('listings')
      .select('id, seller_id, title, description, price, created_at')
      .order('created_at', { ascending: false });

    if (fetchError) {
      return NextResponse.json(
        { error: `Seeded but failed to fetch listings: ${fetchError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Database seeded successfully',
      seeded: {
        usersCount: DEMO_USERS.length,
        listingsCount: DEMO_LISTINGS.length,
        buyerProfilesCount: DEMO_BUYER_PROFILES.length,
      },
      listings,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

