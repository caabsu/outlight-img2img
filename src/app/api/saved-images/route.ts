import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function sb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, anon, { auth: { persistSession: false } });
}

// GET /api/saved-images?productId=...&modelName=...&limit=...
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const productId = searchParams.get("productId") || "";
    const modelName = searchParams.get("modelName") || "";
    const limit = parseInt(searchParams.get("limit") || "100", 10);

    let query = sb()
      .from("saved_images")
      .select("id,image_data,prompt,model_name,product_id,product_name,reference_url,created_at")
      .order("created_at", { ascending: false })
      .limit(Math.min(limit, 500)); // Cap at 500 max

    if (productId) {
      query = query.eq("product_id", productId);
    }

    if (modelName) {
      query = query.eq("model_name", modelName);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ images: data || [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unexpected error" }, { status: 500 });
  }
}

// POST /api/saved-images
// Body: { imageData, prompt, modelName, productId?, productName?, referenceUrl? }
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { imageData, prompt, modelName, productId, productName, referenceUrl } = body as {
      imageData: string;
      prompt: string;
      modelName: string;
      productId?: string | null;
      productName?: string | null;
      referenceUrl?: string | null;
    };

    if (!imageData || !prompt || !modelName) {
      return NextResponse.json(
        { error: "imageData, prompt, and modelName are required" },
        { status: 400 }
      );
    }

    const row = {
      image_data: imageData,
      prompt,
      model_name: modelName,
      product_id: productId || null,
      product_name: productName || null,
      reference_url: referenceUrl || null,
    };

    const { data, error } = await sb()
      .from("saved_images")
      .insert([row])
      .select("id,image_data,prompt,model_name,product_id,product_name,reference_url,created_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ image: data }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unexpected error" }, { status: 500 });
  }
}
