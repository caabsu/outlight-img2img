// src/app/api/shopify/sync/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN!;
const SHOPIFY_ADMIN_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN!;
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-01";

type ShopifyProduct = {
  id: number;
  title: string;
  handle: string;
  vendor: string;
  product_type: string;
  status: string;
  images: Array<{
    id: number;
    src: string;
    alt: string | null;
    position: number;
  }>;
  variants: Array<{
    id: number;
    sku: string;
    price: string;
  }>;
};

type ShopifyProductsResponse = {
  products: ShopifyProduct[];
};

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function fetchAllShopifyProducts(): Promise<ShopifyProduct[]> {
  const allProducts: ShopifyProduct[] = [];
  let pageInfo: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const url = new URL(
      `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/products.json`
    );
    url.searchParams.set("limit", "250");
    url.searchParams.set("status", "active");

    if (pageInfo) {
      url.searchParams.set("page_info", pageInfo);
    }

    const res = await fetch(url.toString(), {
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_ACCESS_TOKEN,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Shopify API error: ${res.status} - ${text}`);
    }

    const data: ShopifyProductsResponse = await res.json();
    allProducts.push(...data.products);

    // Check for pagination via Link header
    const linkHeader = res.headers.get("Link");
    if (linkHeader && linkHeader.includes('rel="next"')) {
      const match = linkHeader.match(/<[^>]*page_info=([^>&]+)[^>]*>;\s*rel="next"/);
      pageInfo = match ? match[1] : null;
      hasNextPage = !!pageInfo;
    } else {
      hasNextPage = false;
    }
  }

  return allProducts;
}

export async function POST() {
  try {
    if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_ACCESS_TOKEN) {
      return NextResponse.json(
        { error: "Shopify credentials not configured" },
        { status: 500 }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch all products from Shopify
    const shopifyProducts = await fetchAllShopifyProducts();

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const sp of shopifyProducts) {
      // Get the hero image (first image)
      const heroImage = sp.images?.[0]?.src || null;

      if (!heroImage) {
        skipped++;
        continue;
      }

      const shopifyId = String(sp.id);
      const productData = {
        name: sp.title,
        slug: sp.handle || slugify(sp.title),
        image_url: heroImage,
        shopify_id: shopifyId,
        shopify_handle: sp.handle,
        shopify_vendor: sp.vendor || null,
        shopify_product_type: sp.product_type || null,
        shopify_status: sp.status,
        shopify_images: sp.images?.map((img) => img.src) || [],
        shopify_sku: sp.variants?.[0]?.sku || null,
        shopify_price: sp.variants?.[0]?.price || null,
        updated_at: new Date().toISOString(),
      };

      // Check if product with this shopify_id already exists
      const { data: existing } = await supabase
        .from("products")
        .select("id")
        .eq("shopify_id", shopifyId)
        .single();

      if (existing) {
        // Update existing product
        const { error } = await supabase
          .from("products")
          .update(productData)
          .eq("shopify_id", shopifyId);

        if (error) {
          console.error(`Failed to update product ${sp.title}:`, error);
        } else {
          updated++;
        }
      } else {
        // Insert new product
        const { error } = await supabase.from("products").insert([productData]);

        if (error) {
          console.error(`Failed to insert product ${sp.title}:`, error);
        } else {
          created++;
        }
      }
    }

    return NextResponse.json({
      success: true,
      stats: {
        total: shopifyProducts.length,
        created,
        updated,
        skipped,
      },
    });
  } catch (err: any) {
    console.error("Shopify sync error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to sync with Shopify" },
      { status: 500 }
    );
  }
}

// GET to check sync status / last sync time
export async function GET() {
  try {
    if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_ACCESS_TOKEN) {
      return NextResponse.json({
        configured: false,
        message: "Shopify credentials not configured",
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get count of shopify-synced products
    const { count } = await supabase
      .from("products")
      .select("*", { count: "exact", head: true })
      .not("shopify_id", "is", null);

    // Get most recent sync time
    const { data: latest } = await supabase
      .from("products")
      .select("updated_at")
      .not("shopify_id", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();

    return NextResponse.json({
      configured: true,
      syncedProducts: count || 0,
      lastSync: latest?.updated_at || null,
      storeDomain: SHOPIFY_STORE_DOMAIN,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to get sync status" },
      { status: 500 }
    );
  }
}
