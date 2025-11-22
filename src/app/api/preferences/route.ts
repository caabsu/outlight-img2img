import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function sb() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const profileId = searchParams.get("profileId");
    if (!profileId) return NextResponse.json({ error: "profileId required" }, { status: 400 });

    const { data, error } = await sb()
      .from("user_preferences")
      .select("profile_id,selected_kb_id,variation_count,assistant_thread")
      .eq("profile_id", profileId)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
      preferences:
        data || {
          profile_id: profileId,
          selected_kb_id: null,
          variation_count: 3,
          assistant_thread: [],
        },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Unexpected error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { profileId, selectedKbId, variationCount, assistantThread } = body as {
      profileId?: string;
      selectedKbId?: string | null;
      variationCount?: number;
      assistantThread?: Array<{ role: string; content: string }>;
    };
    if (!profileId) return NextResponse.json({ error: "profileId required" }, { status: 400 });

    const trimmedThread = Array.isArray(assistantThread) ? assistantThread.slice(-30) : [];
    const payload = {
      profile_id: profileId,
      selected_kb_id: selectedKbId || null,
      variation_count: typeof variationCount === "number" ? variationCount : 3,
      assistant_thread: trimmedThread,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await sb()
      .from("user_preferences")
      .upsert(payload, { onConflict: "profile_id" })
      .select("profile_id,selected_kb_id,variation_count,assistant_thread")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ preferences: data });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Unexpected error" }, { status: 500 });
  }
}
