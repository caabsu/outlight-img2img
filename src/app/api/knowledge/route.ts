export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET() {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data, error } = await supabase
      .from("knowledge_bases")
      .select("*")
      .order("name", { ascending: true });

    if (error) throw error;

    return NextResponse.json({ items: data ?? [] });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Failed to fetch knowledge bases" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const name: string | undefined = body?.name?.trim();
    const content: string | undefined = body?.content?.trim();
    const description: string | undefined = body?.description?.trim();

    if (!name || !content) {
      return NextResponse.json({ error: "Name and content are required" }, { status: 400 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data, error } = await supabase
      .from("knowledge_bases")
      .insert([{ name, content, description }])
      .select("*")
      .single();

    if (error) throw error;

    return NextResponse.json({ item: data }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Failed to create knowledge base" }, { status: 500 });
  }
}
