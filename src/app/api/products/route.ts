// src/app/api/products/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// little helper
function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search")?.trim().toLowerCase();
    const source = searchParams.get("source"); // "shopify" | "manual" | null (all)

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let query = supabase
      .from("products")
      .select("id,name,slug,image_url,shopify_id,shopify_handle,shopify_vendor,shopify_product_type,shopify_status,shopify_images,shopify_sku,shopify_price,created_at,updated_at")
      .order("name", { ascending: true });

    // Filter by source
    if (source === "shopify") {
      query = query.not("shopify_id", "is", null);
    } else if (source === "manual") {
      query = query.is("shopify_id", null);
    }

    const { data, error } = await query;

    if (error) throw error;

    // Client-side search filter (for flexibility)
    let products = data ?? [];
    if (search) {
      products = products.filter(
        (p) =>
          p.name?.toLowerCase().includes(search) ||
          p.slug?.toLowerCase().includes(search) ||
          p.shopify_vendor?.toLowerCase().includes(search) ||
          p.shopify_product_type?.toLowerCase().includes(search) ||
          p.shopify_sku?.toLowerCase().includes(search)
      );
    }

    return NextResponse.json({ products });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Failed to fetch products" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const name: string | undefined = body?.name?.trim();
    const image_url: string | undefined = body?.image_url?.trim();
    let slug: string | undefined = body?.slug?.trim();

    if (!name || !image_url) {
      return NextResponse.json({ error: "name and image_url are required" }, { status: 400 });
    }
    if (!slug) slug = slugify(name);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data, error } = await supabase
      .from("products")
      .insert([{ name, slug, image_url }])
      .select("id,name,slug,image_url")
      .single();

    if (error) throw error;

    return NextResponse.json({ product: data }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Failed to create product" }, { status: 500 });
  }
}
