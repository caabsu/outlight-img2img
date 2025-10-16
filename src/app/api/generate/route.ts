export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// ---------- ENV ----------
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Gemini (Nano Banana) — use stable, non-preview image endpoint
const NB_API_URL =
  process.env.NANO_BANANA_API_URL ||
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent";
const NB_API_KEY = process.env.NANO_BANANA_API_KEY!;
const NB_AUTH_HEADER = process.env.NANO_BANANA_AUTH_HEADER || "x-goog-api-key";

// Seedream (KIE)
const KIE_BASE = process.env.KIE_API_BASE || "https://api.kie.ai";
const KIE_KEY = process.env.KIE_API_KEY;

// ---------- TYPES ----------
type PostBody = {
  modelId: string;                 // "nanobanana-v1" | startsWith("seedream")
  productId: string | null;
  customUrl: string | null;
  prompt: string;
  options?: {
    image_size?: string;           // seedream-only
    image_resolution?: string;
    max_images?: number;
    seed?: number | null;
  };
};

// ---------- HELPERS ----------
async function fetchImageAsBase64(url: string): Promise<{ mime: string; base64: string }> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to fetch image: ${res.status} ${res.statusText} — ${text.slice(0, 200)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  let mime = res.headers.get("content-type") || "image/png";
  if (!mime.startsWith("image/")) {
    if (/\.(png)(\?|$)/i.test(url)) mime = "image/png";
    else if (/\.(jpe?g)(\?|$)/i.test(url)) mime = "image/jpeg";
    else if (/\.(webp)(\?|$)/i.test(url)) mime = "image/webp";
    else mime = "image/png";
  }
  return { mime, base64: buf.toString("base64") };
}

async function getReferenceUrl(productId: string | null, customUrl: string | null): Promise<string> {
  if (customUrl) return customUrl;
  if (!productId) throw new Error("Reference image URL required");

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error } = await supabase
    .from("products")
    .select("image_url")
    .eq("id", productId)
    .single();

  if (error) throw new Error(`DB error: ${error.message}`);
  if (!data?.image_url) throw new Error("No image_url found for product");
  return data.image_url as string;
}

// Robust extraction of image from Gemini response
function extractGeminiImage(json: any): { dataUrl?: string; url?: string; reason?: string } {
  const finishReason = json?.candidates?.[0]?.finishReason || json?.promptFeedback?.blockReason || "";
  const safety = json?.promptFeedback?.safetyRatings || [];
  const candidates = json?.candidates || [];
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { reason: `No candidates (finishReason=${finishReason || "n/a"})` };
  }

  const parts = candidates[0]?.content?.parts || [];

  // helpers to read both response shapes
  const getInlineData = (p: any) => p?.inline_data?.data ?? p?.inlineData?.data;
  const getInlineMime = (p: any) =>
    p?.inline_data?.mime_type ?? p?.inlineData?.mime_type ?? p?.inlineData?.mimeType ?? "image/png";
  const getFileUri = (p: any) => p?.file_data?.file_uri ?? p?.fileData?.file_uri ?? p?.fileData?.fileUri;

  // 1) inline image (base64)
  for (const p of parts) {
    const d = getInlineData(p);
    if (d) return { dataUrl: `data:${getInlineMime(p)};base64,${d}` };
  }

  // 2) hosted file url
  for (const p of parts) {
    const uri = getFileUri(p);
    if (uri) return { url: uri };
  }

  // 3) media[]
  for (const p of parts) {
    const media = p?.media;
    if (Array.isArray(media)) {
      for (const m of media) {
        if (m?.data && m?.mimeType?.startsWith("image/")) {
          return { dataUrl: `data:${m.mimeType};base64,${m.data}` };
        }
        if (m?.url) return { url: m.url };
      }
    }
  }

  // 4) data_uri
  for (const p of parts) {
    const du = p?.data_uri || p?.dataUri;
    if (du && /^data:image\//.test(du)) return { dataUrl: du };
  }

  const anyText = parts.map((p: any) => p?.text).filter(Boolean).slice(0, 1)[0];
  const safeSummary = safety.length ? ` safety=${JSON.stringify(safety)}` : "";
  const reason = `No image parts found. finishReason=${finishReason || "n/a"}${safeSummary}${
    anyText ? ` text="${anyText.slice(0, 120)}..."` : ""
  }`;
  return { reason };
}

// Call Gemini with IMAGE FIRST then TEXT — single turn
async function callGeminiImageEdit({ mime, base64, text }: { mime: string; base64: string; text: string }) {
  const payload = {
    contents: [
      {
        role: "user",
        parts: [
          { inline_data: { mime_type: mime, data: base64 } },
          { text: `Edit ONLY the attached image using these instructions. 
Return exactly ONE image (no text). Instructions:\n${text}` },
        ],
      },
    ],
    // No response_mime_type (text-only types are allowed; images would come via inline_data/file_data)
    // No tools; v1beta REST doesn't accept image_editing tool.
    // No safetySettings — defaults suffice; earlier errors came from mismatched category names.
    generationConfig: { temperature: 0.6 },
  };

  const nbRes = await fetch(NB_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", [NB_AUTH_HEADER]: NB_API_KEY },
    body: JSON.stringify(payload),
  });
  const nbJson = await nbRes.json().catch(() => ({}));
  return { nbRes, nbJson };
}

// ---------- ROUTE ----------
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as PostBody;
    const { modelId, productId, customUrl, prompt, options } = body;
    if (!prompt || !modelId) {
      return NextResponse.json({ error: "Missing modelId or prompt" }, { status: 400 });
    }

    const referenceUrl = await getReferenceUrl(productId, customUrl);

    // -------- Seedream (KIE) --------
    if (modelId.startsWith("seedream")) {
      if (!KIE_KEY) return NextResponse.json({ error: "Seedream API key missing" }, { status: 500 });

      const payload = {
        model: "bytedance/seedream-v4-edit",
        callBackUrl: "",
        input: {
          prompt,
          image_urls: [referenceUrl],
          image_size: options?.image_size || "square",
          image_resolution: options?.image_resolution || "1K",
          max_images: options?.max_images || 1,
          seed: options?.seed ?? null,
        },
      };

      // create task
      const createRes = await fetch(`${KIE_BASE}/api/v1/jobs/createTask`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${KIE_KEY}` },
        body: JSON.stringify(payload),
      });
      const createJson = await createRes.json().catch(() => ({}));
      if (!createRes.ok || createJson?.code !== 200) {
        const msg = createJson?.message || createJson?.msg || "Seedream createTask failed";
        return NextResponse.json({ error: msg }, { status: 502 });
      }
      const taskId: string | undefined = createJson?.data?.taskId;
      if (!taskId) return NextResponse.json({ error: "Seedream taskId missing" }, { status: 502 });

      // poll
      const started = Date.now();
      const MAX_MS = 180_000;
      let resultUrl: string | null = null;
      let lastState = "waiting";

      while (Date.now() - started < MAX_MS) {
        await new Promise((r) => setTimeout(r, 2000));
        const qRes = await fetch(`${KIE_BASE}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
          headers: { Authorization: `Bearer ${KIE_KEY}` },
        });
        const qJson = await qRes.json().catch(() => ({}));
        if (!qRes.ok || qJson?.code !== 200) {
          const msg = qJson?.message || qJson?.msg || "Seedream query failed";
          return NextResponse.json({ error: msg }, { status: 502 });
        }
        lastState = qJson?.data?.state as string;
        if (lastState === "success") {
          try {
            const parsed = JSON.parse(qJson?.data?.resultJson || "{}");
            const urls: string[] = parsed?.resultUrls || [];
            if (!urls.length) return NextResponse.json({ error: "Seedream returned no result URLs" }, { status: 502 });
            resultUrl = urls[0];
            break;
          } catch {
            return NextResponse.json({ error: "Malformed Seedream resultJson" }, { status: 502 });
          }
        }
        if (lastState === "fail") {
          const failMsg = qJson?.data?.failMsg || "Seedream reported failure";
          return NextResponse.json({ error: failMsg }, { status: 502 });
        }
      }

      if (!resultUrl) {
        return NextResponse.json({ error: `Seedream generation timed out (last state: ${lastState})` }, { status: 504 });
      }
      return NextResponse.json({ imageDataUrl: resultUrl });
    }

    // -------- Gemini (Nano Banana) --------
    if (!NB_API_KEY) return NextResponse.json({ error: "Nano Banana API key missing" }, { status: 500 });

    // load the reference image
    const { mime, base64 } = await fetchImageAsBase64(referenceUrl);
    if (!mime.startsWith("image/")) {
      return NextResponse.json({ error: `Reference URL is not an image (mime=${mime})` }, { status: 400 });
    }

    // single-turn, IMAGE FIRST then TEXT
    const { nbRes, nbJson } = await callGeminiImageEdit({ mime, base64, text: prompt });

    if (!nbRes.ok) {
      const msg = nbJson?.error?.message || `Gemini request failed (${nbRes.status})`;
      return NextResponse.json({ error: msg }, { status: nbRes.status || 502 });
    }

    const out = extractGeminiImage(nbJson);
    if (out.dataUrl) return NextResponse.json({ imageDataUrl: out.dataUrl });
    if (out.url) return NextResponse.json({ imageDataUrl: out.url });

    // still no image — return compact debug so we can see exactly what came back
    return NextResponse.json(
      {
        error: "Gemini returned no image data",
        debug: out.debug ?? null,
      },
      { status: 502 }
    );
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Unexpected error" }, { status: 500 });
  }
}
