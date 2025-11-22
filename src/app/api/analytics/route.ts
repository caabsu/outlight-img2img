import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const ANALYTICS_PASSWORD = process.env.ADMIN_PASSWORD || "gmltn123";

function sb() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const pass = searchParams.get("password") || req.headers.get("x-analytics-key") || "";
    if (!ANALYTICS_PASSWORD || pass !== ANALYTICS_PASSWORD) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = sb();
    const [{ data: profiles, error: profileErr }, { data: events, error: eventsErr }] = await Promise.all([
      supabase.from("user_profiles").select("id,name,role"),
      supabase.from("usage_events").select("profile_id,model_id,created_at"),
    ]);
    if (profileErr) return NextResponse.json({ error: profileErr.message }, { status: 500 });
    if (eventsErr) return NextResponse.json({ error: eventsErr.message }, { status: 500 });

    const totalsByModel: Record<string, number> = {};
    const usageByProfile: Record<
      string,
      { total: number; models: Record<string, number> }
    > = {};
    const totalsByRole: Record<string, number> = {};
    const byDay: Record<string, number> = {};

    (events || []).forEach((e) => {
      totalsByModel[e.model_id] = (totalsByModel[e.model_id] || 0) + 1;
      if (!usageByProfile[e.profile_id]) usageByProfile[e.profile_id] = { total: 0, models: {} };
      usageByProfile[e.profile_id].total += 1;
      usageByProfile[e.profile_id].models[e.model_id] = (usageByProfile[e.profile_id].models[e.model_id] || 0) + 1;
      const day = (e.created_at || "").slice(0, 10);
      if (day) byDay[day] = (byDay[day] || 0) + 1;
    });

    (profiles || []).forEach((p) => {
      totalsByRole[p.role] = (totalsByRole[p.role] || 0) + (usageByProfile[p.id]?.total || 0);
    });

    const profileStats = (profiles || []).map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      total: usageByProfile[p.id]?.total || 0,
      models: usageByProfile[p.id]?.models || {},
    }));

    const dailySeries = Object.entries(byDay)
      .map(([day, count]) => ({ day, count }))
      .sort((a, b) => (a.day < b.day ? -1 : 1));

    return NextResponse.json({ totalsByModel, totalsByRole, profiles: profileStats, dailySeries });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Unexpected error" }, { status: 500 });
  }
}
