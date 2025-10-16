import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function sb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, anon, { auth: { persistSession: false } });
}

// GET /api/prompts?q=...&productId=...
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();
    const productId = searchParams.get("productId") || "";

    let query = sb()
      .from("saved_prompts")
      .select("id,product_id,product_name,model_name,prompt,created_at")
      .order("created_at", { ascending: false })
      .limit(200);

    if (productId) query = query.eq("product_id", productId);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const filtered = q
      ? (data || []).filter((row) => row.prompt.toLowerCase().includes(q.toLowerCase()))
      : (data || []);

    return NextResponse.json({ prompts: filtered });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unexpected error" }, { status: 500 });
  }
}

// POST /api/prompts  { productId, productName, modelName, prompts: string[] }
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { productId, productName, modelName, prompts } = body as {
      productId?: string | null;
      productName?: string | null;
      modelName: string;
      prompts: string[];
    };

    if (!Array.isArray(prompts) || prompts.length === 0) {
      return NextResponse.json({ error: "No prompts provided" }, { status: 400 });
    }

    const rows = prompts.map((p) => ({
      product_id: productId || null,
      product_name: productName || null,
      model_name: modelName,
      prompt: p,
    }));

    const { error } = await sb().from("saved_prompts").insert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, saved: rows.length });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unexpected error" }, { status: 500 });
  }
}
