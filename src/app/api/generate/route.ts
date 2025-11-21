export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  IMAGE_RESOLUTIONS,
  IMAGE_SIZES,
  NANOBANANA_ASPECT_RATIOS,
  NANOBANANA_RESOLUTIONS,
} from "@/lib/models";

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
    return "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent";
  }
  return "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent";
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
    image_size?: string;       // seedream-only (resolution)
    image_resolution?: string; // seedream-only
    max_images?: number;       // seedream-only
    seed?: number | null;      // seedream-only
    // nano banana (KIE) image config
    aspect_ratio?: string;     // mapped to image_size for KIE
  };
};

type SeedreamOptions = {
  image_size: (typeof IMAGE_SIZES)[number];
  image_resolution: (typeof IMAGE_RESOLUTIONS)[number];
  max_images: number;
  seed: number | null;
};

type NanoBananaOptions = {
  aspect_ratio?: (typeof NANOBANANA_ASPECT_RATIOS)[number];
  image_size?: (typeof NANOBANANA_RESOLUTIONS)[number];
};

const SAFETY_OFF = [
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
];

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
  // Gemini image endpoint rejects unknown fields; keep config minimal.
  const generationConfig: Record<string, any> = { temperature: 0.6 };
  const image_config: Record<string, any> = {};
  if (options?.aspect_ratio) image_config.aspect_ratio = options.aspect_ratio;
  if (options?.image_size && modelId === "nanobanana-3-pro") image_config.image_size = options.image_size;
  return { generationConfig, image_config: Object.keys(image_config).length ? image_config : undefined };
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
  const { generationConfig, image_config } = buildGeminiConfigs(options, modelId);
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
    safetySettings: SAFETY_OFF,
    generationConfig,
    ...(image_config ? { image_config } : {}),
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
  const { generationConfig, image_config } = buildGeminiConfigs(options, modelId);
  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text }],
      },
    ],
    // Leave response_mime_type unset: the Gemini image endpoint only accepts text/application values here but still
    // returns inline image data when omitted, so we can parse it via extractGeminiImage.
    safetySettings: SAFETY_OFF,
    generationConfig,
    ...(image_config ? { image_config } : {}),
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

    const normalizeSeedream = (): SeedreamOptions => {
      const sizes = new Set<string>(IMAGE_SIZES);
      const resolutions = new Set<string>(IMAGE_RESOLUTIONS);
      const image_size = sizes.has(options?.image_size || "") ? (options!.image_size as SeedreamOptions["image_size"]) : "square";
      const image_resolution = resolutions.has(options?.image_resolution || "")
        ? (options!.image_resolution as SeedreamOptions["image_resolution"])
        : "1K";
      const max_images =
        typeof options?.max_images === "number" && options.max_images > 0
          ? Math.min(Math.floor(options.max_images), 4)
          : 1;
      const seed = typeof options?.seed === "number" ? options.seed : null;
      return { image_size, image_resolution, max_images, seed };
    };

    const normalizeNano = (model: string, allowResolution: boolean): NanoBananaOptions => {
      const arSet = new Set<string>(NANOBANANA_ASPECT_RATIOS);
      const resSet = new Set<string>(NANOBANANA_RESOLUTIONS);
      const aspect_ratio =
        options?.aspect_ratio && arSet.has(options.aspect_ratio)
          ? (options.aspect_ratio as NanoBananaOptions["aspect_ratio"])
          : undefined;
      const allowResForModel = allowResolution && model === "nanobanana-3-pro";
      const image_size =
        allowResForModel && options?.image_size && resSet.has(options.image_size)
          ? (options.image_size as NanoBananaOptions["image_size"])
          : undefined;
      return { aspect_ratio, image_size };
    };

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

      const seedreamOpts = normalizeSeedream();

      const payload = {
        model: "bytedance/seedream-v4-edit",
        callBackUrl: "",
        input: {
          prompt: enhancedPrompt,
          image_urls: referenceUrls,
          image_size: seedreamOpts.image_size,
          image_resolution: seedreamOpts.image_resolution,
          max_images: seedreamOpts.max_images,
          seed: seedreamOpts.seed,
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

    /* -------- Nano Banana via KIE -------- */
    if (modelId.startsWith("nanobanana")) {
      if (!KIE_KEY) return NextResponse.json({ error: "Nano Banana API key missing" }, { status: 500 });

      const httpRefs = referenceUrls.filter((u) => /^https?:\/\//i.test(u));
      const hasDataRefs = referenceUrls.length > httpRefs.length;
      const isPro = modelId === "nanobanana-3-pro";

      // Nano Banana Pro: route everything through Gemini so image_config (aspect/resolution) is respected.
      if (isPro) {
        const nanoOpts = normalizeNano(modelId, true);
        if (referenceUrls.length > 0) {
          const images = await Promise.all(referenceUrls.map((url) => fetchImageAsBase64(url)));
          const { nbRes, nbJson } = await callGeminiImageEdit({
            images,
            text: prompt,
            modelId,
            options: nanoOpts,
          });
          if (!nbRes.ok) {
            const msg =
              nbJson?.error?.message ||
              nbJson?.error?.status ||
              nbJson?.error?.code ||
              "Nano Banana Pro edit failed";
            return NextResponse.json({ error: msg, debug: nbJson || null }, { status: 502 });
          }
          const { dataUrl, url, reason, debug } = extractGeminiImage(nbJson);
          if (!dataUrl && !url) {
            return NextResponse.json(
              { error: reason || "Nano Banana Pro returned no image", debug: debug || nbJson || null },
              { status: 502 }
            );
          }
          return NextResponse.json({ imageDataUrl: dataUrl || url });
        }

        // No references: text-to-image
        const { nbRes, nbJson } = await callGeminiTextToImage(prompt, modelId, nanoOpts);
        if (!nbRes.ok) {
          const msg =
            nbJson?.error?.message ||
            nbJson?.error?.status ||
            nbJson?.error?.code ||
            "Nano Banana Pro generation failed";
          return NextResponse.json({ error: msg, debug: nbJson || null }, { status: 502 });
        }
        const { dataUrl, url, reason, debug } = extractGeminiImage(nbJson);
        if (!dataUrl && !url) {
          return NextResponse.json(
            { error: reason || "Nano Banana Pro returned no image", debug: debug || nbJson || null },
            { status: 502 }
          );
        }
        return NextResponse.json({ imageDataUrl: dataUrl || url });
      }

      // If any refs are data: URIs/uploads, fall back to direct Gemini with inline_data support.
      if (hasDataRefs) {
        const images = await Promise.all(referenceUrls.map((url) => fetchImageAsBase64(url)));
        const nanoOpts = normalizeNano(modelId, true); // allow image_size only for Gemini (Pro)
        const { nbRes, nbJson } = await callGeminiImageEdit({
          images,
          text: prompt,
          modelId,
          options: nanoOpts,
        });
        if (!nbRes.ok) {
          const msg =
            nbJson?.error?.message ||
            nbJson?.error?.status ||
            nbJson?.error?.code ||
            "Nano Banana (Gemini) edit failed";
          return NextResponse.json({ error: msg, debug: nbJson || null }, { status: 502 });
        }

        const { dataUrl, url, reason, debug } = extractGeminiImage(nbJson);
        if (!dataUrl && !url) {
          return NextResponse.json(
            { error: reason || "Nano Banana returned no image", debug: debug || nbJson || null },
            { status: 502 }
          );
        }
        return NextResponse.json({ imageDataUrl: dataUrl || url });
      }

      const nanoModel =
        referenceUrls.length > 0 ? "google/nano-banana-edit" : "google/nano-banana";
      const nanoOpts = normalizeNano(modelId, false); // KIE rejects image_size, so disable
      const inputPayload: Record<string, any> = {
        prompt,
        output_format: "png",
      };
      if (httpRefs.length) inputPayload.image_urls = httpRefs;
      const ar = nanoOpts.aspect_ratio || undefined;
      if (ar) inputPayload.aspect_ratio = ar;
      if (nanoOpts.image_size) inputPayload.image_size = nanoOpts.image_size;

      const payload = {
        model: nanoModel,
        callBackUrl: "",
        input: inputPayload,
      };

      const createRes = await fetch(`${KIE_BASE}/api/v1/jobs/createTask`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${KIE_KEY}` },
        body: JSON.stringify(payload),
      });
      const createJson = await createRes.json().catch(() => ({}));
      if (!createRes.ok || createJson?.code !== 200) {
        const msg = createJson?.message || createJson?.msg || "Nano Banana createTask failed";
        console.error("Nano Banana createTask error", { status: createRes.status, body: createJson });
        return NextResponse.json({ error: msg, debug: createJson || null }, { status: 502 });
      }
      const taskId: string | undefined = createJson?.data?.taskId;
      if (!taskId) return NextResponse.json({ error: "Nano Banana taskId missing" }, { status: 502 });

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
          const msg = qJson?.message || qJson?.msg || "Nano Banana query failed";
          console.error("Nano Banana recordInfo error", { status: qRes.status, body: qJson });
          return NextResponse.json({ error: msg, debug: qJson || null }, { status: 502 });
        }

        lastState = qJson?.data?.state as string;
        if (lastState === "success") {
          try {
            const parsed = JSON.parse(qJson?.data?.resultJson || "{}");
            const urls: string[] = parsed?.resultUrls || [];
            if (!urls.length) return NextResponse.json({ error: "Nano Banana returned no result URLs" }, { status: 502 });
            resultUrl = urls[0];
            break;
          } catch {
            return NextResponse.json({ error: "Malformed Nano Banana resultJson" }, { status: 502 });
          }
        }
        if (lastState === "fail") {
          const failMsg = qJson?.data?.failMsg || "Nano Banana reported failure";
          return NextResponse.json({ error: failMsg }, { status: 502 });
        }
      }

      if (!resultUrl) {
        return NextResponse.json({ error: `Nano Banana generation timed out (last state: ${lastState})` }, { status: 504 });
      }
      return NextResponse.json({ imageDataUrl: resultUrl });
    }

    return NextResponse.json({ error: "Unsupported model" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Unexpected error" }, { status: 500 });
  }
}


