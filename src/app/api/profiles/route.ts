import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "gmltn123";

function sb() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
}

export async function GET() {
  try {
    const { data, error } = await sb()
      .from("user_profiles")
      .select("id,name,role,client_id,created_at")
      .order("created_at", { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ profiles: data || [] });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Unexpected error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { clientId, name, role, adminPassword } = body as {
      clientId?: string;
      name?: string;
      role?: string;
      adminPassword?: string;
    };

    if (!clientId || !name || !role) return NextResponse.json({ error: "Missing clientId, name, or role" }, { status: 400 });
    const allowedRoles = ["Graphic Designer", "Catalog Manager", "Video Editor", "Creative Strategist", "Admin"];
    if (!allowedRoles.includes(role)) return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    if (role === "Admin" && adminPassword !== ADMIN_PASSWORD) {
      return NextResponse.json({ error: "Invalid admin password" }, { status: 401 });
    }

    const { data, error } = await sb()
      .from("user_profiles")
      .insert([{ client_id: clientId, name, role }])
      .select("id,name,role,client_id,created_at")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ profile: data });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Unexpected error" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const body = await req.json();
    const { profileId, adminPassword } = body as { profileId?: string; adminPassword?: string };
    if (!profileId) return NextResponse.json({ error: "profileId required" }, { status: 400 });
    if (!adminPassword || adminPassword !== ADMIN_PASSWORD) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { error } = await sb().from("user_profiles").delete().eq("id", profileId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Unexpected error" }, { status: 500 });
  }
}
