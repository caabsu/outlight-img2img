// src/app/api/upload/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BUCKET_NAME = "reference-images";

/**
 * Upload a base64 image to Supabase storage and return the public URL.
 * Used for Seedream which requires public HTTP URLs (not data URIs).
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const dataUrl: string | undefined = body?.dataUrl;

    if (!dataUrl || !dataUrl.startsWith("data:")) {
      return NextResponse.json({ error: "dataUrl is required (base64 data URI)" }, { status: 400 });
    }

    // Parse the data URL
    const match = /^data:([^;]+);base64,(.*)$/i.exec(dataUrl);
    if (!match) {
      return NextResponse.json({ error: "Invalid data URL format" }, { status: 400 });
    }

    const mimeType = match[1] || "image/png";
    const base64Data = match[2];
    const buffer = Buffer.from(base64Data, "base64");

    // Determine file extension
    const extMap: Record<string, string> = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/jpg": "jpg",
      "image/webp": "webp",
      "image/gif": "gif",
    };
    const ext = extMap[mimeType] || "png";

    // Generate unique filename
    const filename = `${crypto.randomUUID()}.${ext}`;
    const filePath = `uploads/${filename}`;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Upload to storage
    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filePath, buffer, {
        contentType: mimeType,
        upsert: false,
      });

    if (uploadError) {
      console.error("Supabase upload error:", uploadError);
      return NextResponse.json({ error: uploadError.message || "Upload failed" }, { status: 500 });
    }

    // Get public URL
    const { data: urlData } = supabase.storage.from(BUCKET_NAME).getPublicUrl(filePath);

    if (!urlData?.publicUrl) {
      return NextResponse.json({ error: "Failed to get public URL" }, { status: 500 });
    }

    return NextResponse.json({ url: urlData.publicUrl });
  } catch (err: any) {
    console.error("Upload error:", err);
    return NextResponse.json({ error: err?.message || "Upload failed" }, { status: 500 });
  }
}
