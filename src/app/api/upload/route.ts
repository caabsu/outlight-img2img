// src/app/api/upload/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BUCKET_NAME = "reference-images";
const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);

// Determine file extension from mime type
const extMap: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

function normalizeMimeType(value: string | null): string {
  const raw = (value || "").split(";")[0].trim().toLowerCase();
  if (raw === "image/jpg") return "image/jpeg";
  return raw;
}

function isPrivateHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  if (!h) return true;
  if (h === "localhost") return true;
  if (h === "127.0.0.1" || h === "::1") return true;
  if (h.endsWith(".local")) return true;

  // If it's an IP, block private ranges.
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const parts = m.slice(1).map((p) => Number.parseInt(p, 10));
  if (parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

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

    // Handle JSON uploads
    const body = await req.json().catch(() => ({}));
    const dataUrl: string | undefined = body?.dataUrl;
    const sourceUrl: string | undefined = body?.sourceUrl;

    // 1) Ingest from a remote HTTP/HTTPS URL
    if (sourceUrl) {
      let parsed: URL;
      try {
        parsed = new URL(sourceUrl);
      } catch {
        return NextResponse.json({ error: "Invalid sourceUrl" }, { status: 400 });
      }
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return NextResponse.json({ error: "sourceUrl must be http/https" }, { status: 400 });
      }
      if (isPrivateHostname(parsed.hostname)) {
        return NextResponse.json({ error: "sourceUrl hostname not allowed" }, { status: 400 });
      }

      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 20_000);
      const res = await fetch(sourceUrl, {
        redirect: "follow",
        headers: {
          "User-Agent": "Outlight/1.0 (+upload)",
          Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        },
        signal: ac.signal,
      }).finally(() => clearTimeout(t));

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return NextResponse.json(
          { error: `Failed to fetch sourceUrl: ${res.status} ${res.statusText}`, debug: text.slice(0, 200) },
          { status: 400 }
        );
      }

      const mimeType = normalizeMimeType(res.headers.get("content-type")) || "application/octet-stream";
      if (!ALLOWED_MIME_TYPES.has(mimeType)) {
        return NextResponse.json(
          { error: `Unsupported sourceUrl content-type: ${mimeType}. Please use PNG/JPG/WEBP.` },
          { status: 400 }
        );
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      const url = await uploadBuffer(supabase, buffer, mimeType);
      return NextResponse.json({ url });
    }

    // 2) Ingest from a base64 data URI
    if (!dataUrl || !dataUrl.startsWith("data:")) {
      return NextResponse.json({ error: "dataUrl is required (base64 data URI)" }, { status: 400 });
    }

    // Parse the data URL
    const match = /^data:([^;]+);base64,(.*)$/i.exec(dataUrl);
    if (!match) {
      return NextResponse.json({ error: "Invalid data URL format" }, { status: 400 });
    }

    const mimeType = normalizeMimeType(match[1] || "image/png");
    const base64Data = match[2];
    const buffer = Buffer.from(base64Data, "base64");

    const url = await uploadBuffer(supabase, buffer, mimeType);
    return NextResponse.json({ url });
  } catch (err: any) {
    console.error("Upload error:", err);
    return NextResponse.json({ error: err?.message || "Upload failed" }, { status: 500 });
  }
}
