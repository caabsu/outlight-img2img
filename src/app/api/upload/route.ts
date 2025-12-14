// src/app/api/upload/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BUCKET_NAME = "reference-images";

// Determine file extension from mime type
const extMap: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

async function uploadBuffer(
  supabase: any,
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  const ext = extMap[mimeType] || "png";
  const filename = `${crypto.randomUUID()}.${ext}`;
  const filePath = `uploads/${filename}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(filePath, buffer, {
      contentType: mimeType,
      upsert: false,
    });

  if (uploadError) {
    throw new Error(uploadError.message || "Upload failed");
  }

  const { data: urlData } = supabase.storage.from(BUCKET_NAME).getPublicUrl(filePath);

  if (!urlData?.publicUrl) {
    throw new Error("Failed to get public URL");
  }

  return urlData.publicUrl;
}

/**
 * Upload images to Supabase storage and return the public URL(s).
 * Supports two formats:
 * 1. FormData with "files" field (File objects) → returns { urls: string[] }
 * 2. JSON with "dataUrl" field (base64 data URI) → returns { url: string }
 */
export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") || "";
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Handle FormData uploads (multiple files)
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const files = formData.getAll("files") as File[];

      if (!files || files.length === 0) {
        return NextResponse.json({ error: "No files provided" }, { status: 400 });
      }

      const urls: string[] = [];
      for (const file of files) {
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const mimeType = file.type || "image/png";
        const url = await uploadBuffer(supabase, buffer, mimeType);
        urls.push(url);
      }

      return NextResponse.json({ urls });
    }

    // Handle JSON uploads (single base64 data URL)
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

    const url = await uploadBuffer(supabase, buffer, mimeType);
    return NextResponse.json({ url });
  } catch (err: any) {
    console.error("Upload error:", err);
    return NextResponse.json({ error: err?.message || "Upload failed" }, { status: 500 });
  }
}
