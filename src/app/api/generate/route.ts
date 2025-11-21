export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/* ========================= ENV ========================= */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Gemini (Google AI Studio) image endpoint
const getGeminiApiUrl = (modelId: string) => {
  if (process.env.NANO_BANANA_API_URL) return process.env.NANO_BANANA_API_URL;
  if (modelId === "nanobanana-3-pro") {
    return "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent";
  }
  if (modelId === "nanobanana-1" || modelId === "nanobanana-2") {
    return "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent";
  }
  return "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent";
};
const NB_API_KEY = process.env.NANO_BANANA_API_KEY!;
const NB_AUTH_HEADER = process.env.NANO_BANANA_AUTH_HEADER || "x-goog-api-key";

// Seedream (KIE)
const KIE_BASE = process.env.KIE_API_BASE || "https://api.kie.ai";
const KIE_KEY = process.env.KIE_API_KEY;

/* ========================= TYPES ========================= */
type PostBody = {
  modelId: string; // "nanobanana-1", "nanobanana-2", "nanobanana-3-pro" or startsWith("seedream")
  productId: string | null;
  // legacy single custom url
  customUrl?: string | null;
  // new: multiple custom urls (http/https or data: URIs)
  customUrls?: string[];
  // new: additional refs when product is selected (http/https or data: URIs)
  additionalUrls?: string[];
  prompt: string;
  options?: {
    image_size?: string;       // used by Seedream & Nano Banana (Gemini)
    image_resolution?: string; // seedream-only
    max_images?: number;       // seedream-only
    seed?: number | null;      // seedream-only
    // nano banana (Gemini) image config
    aspect_ratio?: string;
    response_modalities?: string[];
  };
};

/* ========================= HELPERS ========================= */
function parseDataUrl(url: string): { mime: string; base64: string } | null {
  try {
    if (!url.startsWith("data:")) return null;
    const m = /^data:([^;]+);base64,(.*)$/i.exec(url);
    if (!m) return null;
    const mime = m[1] || "image/png";
    const base64 = m[2] || "";
    return { mime, base64 };
  } catch {
    return null;
  }
}

async function fetchImageAsBase64(url: string): Promise<{ mime: string; base64: string }> {
  const parsed = parseDataUrl(url);
  if (parsed) return parsed;
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      // helps some CDNs
      "User-Agent": "Outlight/1.0 (+image-fetch)",
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to fetch image: ${res.status} ${res.statusText} - ${text.slice(0, 200)}`);
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

/** Extract an image from Gemini responses across shapes */
function extractGeminiImage(json: any): {
  dataUrl?: string;
  url?: string;
  reason?: string;
  debug?: any;
} {
  const finishReason = json?.candidates?.[0]?.finishReason || json?.promptFeedback?.blockReason || "";
  const safety = json?.promptFeedback?.safetyRatings || [];
  const candidates = json?.candidates || [];
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { reason: `No candidates (finishReason=${finishReason || "n/a"})` };
  }

  const parts = candidates[0]?.content?.parts || [];

  // helpers for different shapes
  const getInlineData = (p: any) => p?.inline_data?.data ?? p?.inlineData?.data;
  const getInlineMime =
    (p: any) => p?.inline_data?.mime_type ?? p?.inlineData?.mime_type ?? p?.inlineData?.mimeType ?? "image/png";
  const getFileUri = (p: any) => p?.file_data?.file_uri ?? p?.fileData?.file_uri ?? p?.fileData?.fileUri;

  // 1) inline base64
  for (const p of parts) {
    const d = getInlineData(p);
    if (d) return { dataUrl: `data:${getInlineMime(p)};base64,${d}` };
  }
  // 2) hosted file uri
  for (const p of parts) {
    const uri = getFileUri(p);
    if (uri) return { url: uri };
  }
  // 3) media array
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
  const reason = `No image parts found. finishReason=${finishReason || "n/a"}${
    safeSummary
  }${anyText ? ` text="${anyText.slice(0, 140)}..."` : ""}`;

  return {
    reason,
    debug: {
      parts,
      finishReason: json?.candidates?.[0]?.finishReason,
      promptFeedback: json?.promptFeedback,
    },
  };
}

function buildGeminiConfigs(options: PostBody["options"] | undefined, modelId: string) {
  const generationConfig: Record<string, any> = {
    temperature: 0.6,
  };

  const imageConfig: Record<string, any> = {};
  if (options?.aspect_ratio) imageConfig.aspectRatio = options.aspect_ratio;
  if (options?.image_size && modelId === "nanobanana-3-pro") imageConfig.imageSize = options.image_size;

  const responseModalities =
    options?.response_modalities?.length ? options.response_modalities : ["IMAGE"];

  return {
    generationConfig,
    imageConfig: Object.keys(imageConfig).length ? imageConfig : undefined,
    responseModalities,
  };
}

/** Single-turn image edit: one or more IMAGES first, then TEXT (v1beta REST) */
async function callGeminiImageEdit({
  images,
  text,
  modelId,
  options,
}: {
  images: Array<{ mime: string; base64: string }>;
  text: string;
  modelId: string;
  options?: PostBody["options"];
}) {
  const { generationConfig, imageConfig, responseModalities } = buildGeminiConfigs(options, modelId);
  const payload = {
    contents: [
      {
        role: "user",
        parts: [
          ...images.map((img) => ({ inline_data: { mime_type: img.mime, data: img.base64 } })),
          {
            text:
              `Edit ONLY the attached image(s) using these instructions.\n` +
              `Return an IMAGE (not text). Instructions:\n${text}`,
          },
        ],
      },
    ],
    // DO NOT set response_mime_type (text-only values are accepted; images come via inline_data/file_data)
    // DO NOT send "tools" (image_editing) -- not supported on v1beta REST for this model
    generationConfig,
    ...(imageConfig ? { imageConfig } : {}),
    ...(responseModalities ? { responseModalities } : {}),
  };

  const nbRes = await fetch(getGeminiApiUrl(modelId), {
    method: "POST",
    headers: { "Content-Type": "application/json", [NB_AUTH_HEADER]: NB_API_KEY },
    body: JSON.stringify(payload),
  });
  const nbJson = await nbRes.json().catch(() => ({}));
  return { nbRes, nbJson };
}

async function callGeminiTextToImage(text: string, modelId: string, options?: PostBody["options"]) {
  const { generationConfig, imageConfig, responseModalities } = buildGeminiConfigs(options, modelId);
  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text }],
      },
    ],
    // Leave response_mime_type unset: the Gemini image endpoint only accepts text/application values here but still
    // returns inline image data when omitted, so we can parse it via extractGeminiImage.
    generationConfig,
    ...(imageConfig ? { imageConfig } : {}),
    ...(responseModalities ? { responseModalities } : {}),
  };

  const nbRes = await fetch(getGeminiApiUrl(modelId), {
    method: "POST",
    headers: { "Content-Type": "application/json", [NB_AUTH_HEADER]: NB_API_KEY },
    body: JSON.stringify(payload),
  });
  const nbJson = await nbRes.json().catch(() => ({}));
  return { nbRes, nbJson };
}

/* ========================= ROUTE ========================= */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as PostBody;
    const { modelId, productId, customUrl = null, customUrls = [], additionalUrls = [], prompt, options } = body;

    if (!prompt || !modelId) {
      return NextResponse.json({ error: "Missing modelId or prompt" }, { status: 400 });
    }

    const isSeedream = modelId.startsWith("seedream");
    const requiresReference = isSeedream;

    // Build the list of reference images (http(s) or data:) in priority order
    // product -> its image_url + any additionalUrls; otherwise use customUrls or fallback customUrl
    let referenceUrls: string[] = [];
    if (productId) {
      const main = await getReferenceUrl(productId, null);
      referenceUrls = [main, ...additionalUrls.filter((u) => typeof u === "string" && u.trim().length > 0)];
    } else {
      const cu = customUrl && customUrl.trim() ? [customUrl.trim()] : [];
      const cus = (customUrls || []).map((u) => (u || "").trim()).filter(Boolean);
      referenceUrls = [...cu, ...cus];
    }
    // Deduplicate while preserving order
    referenceUrls = Array.from(new Set(referenceUrls));
    if (requiresReference && referenceUrls.length === 0) {
      return NextResponse.json({ error: "Reference image URL(s) required" }, { status: 400 });
    }

    // For Gemini, imageConfig options tend to apply to text-to-image; when editing with references, omit extras.
    const geminiOptions = referenceUrls.length === 0 ? options : undefined;

    /* -------- Seedream (KIE) -------- */
    if (modelId.startsWith("seedream")) {
      if (!KIE_KEY) return NextResponse.json({ error: "Seedream API key missing" }, { status: 500 });
      // KIE Seedream requires publicly accessible URLs, not data: URIs
      const bad = referenceUrls.find((u) => !/^https?:\/\//i.test(u));
      if (bad) {
        return NextResponse.json(
          { error: "Seedream requires public HTTP/HTTPS URLs for reference images" },
          { status: 400 }
        );
      }

      // Enhance prompt for better instruction following
      const enhancedPrompt = `Edit the provided image(s) according to these instructions. Make sure to follow the instructions precisely and apply the requested changes to the image. Instructions: ${prompt}`;

      const payload = {
        model: "bytedance/seedream-v4-edit",
        callBackUrl: "",
        input: {
          prompt: enhancedPrompt,
          image_urls: referenceUrls,
          image_size: options?.image_size || "square",
          image_resolution: options?.image_resolution || "1K",
          max_images: options?.max_images || 1,
          seed: options?.seed ?? null,
        },
      };

      // 1) create task
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

      // 2) poll recordInfo
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

    /* -------- Gemini (Google AI Studio) -------- */
    if (!NB_API_KEY) return NextResponse.json({ error: "Nano Banana API key missing" }, { status: 500 });

    if (referenceUrls.length === 0) {
      const { nbRes, nbJson } = await callGeminiTextToImage(prompt, modelId, options);
      if (!nbRes.ok) {
        const msg = nbJson?.error?.message || `Gemini request failed (${nbRes.status})`;
        return NextResponse.json({ error: msg }, { status: nbRes.status || 502 });
      }
      const out = extractGeminiImage(nbJson);
      if (out.dataUrl) return NextResponse.json({ imageDataUrl: out.dataUrl });
      if (out.url) return NextResponse.json({ imageDataUrl: out.url });
      return NextResponse.json(
        { error: out.reason || "Gemini returned no image data", debug: out.debug ?? null },
        { status: 502 }
      );
    }

    // 1) load reference image(s)
    const imgBlobs: Array<{ mime: string; base64: string }> = [];
    for (const u of referenceUrls) {
      const { mime, base64 } = await fetchImageAsBase64(u);
      if (!mime.startsWith("image/")) {
        return NextResponse.json({ error: `Reference URL is not an image (mime=${mime})` }, { status: 400 });
      }
      imgBlobs.push({ mime, base64 });
    }

    // 2) single-turn (IMAGES first, then TEXT)
    const { nbRes, nbJson } = await callGeminiImageEdit({ images: imgBlobs, text: prompt, modelId, options: geminiOptions });

    if (!nbRes.ok) {
      const msg = nbJson?.error?.message || `Gemini request failed (${nbRes.status})`;
      return NextResponse.json({ error: msg }, { status: nbRes.status || 502 });
    }

    // 3) extract image
    const out = extractGeminiImage(nbJson);
    if (out.dataUrl) return NextResponse.json({ imageDataUrl: out.dataUrl });
    if (out.url) return NextResponse.json({ imageDataUrl: out.url });

    // Return concise debug to help diagnose (safe in prod too; it's compact)
    return NextResponse.json(
      {
        error: out.reason || "Gemini returned no image data",
        debug: out.debug ?? null,
      },
      { status: 502 }
    );
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Unexpected error" }, { status: 500 });
  }
}


