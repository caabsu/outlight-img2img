export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const productId = searchParams.get("productId");

  if (!productId) {
    return Response.json({ error: "productId required" }, { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data, error } = await supabase
    .from("ad_studio_learnings")
    .select("*")
    .eq("is_active", true)
    .or(`product_id.eq.${productId},product_id.is.null`)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    return Response.json({ error: "Failed to fetch learnings" }, { status: 500 });
  }

  return Response.json({ learnings: data });
}
