export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  IMAGE_RESOLUTIONS,
  IMAGE_SIZES,
  NANOBANANA_ASPECT_RATIOS,
  NANOBANANA_RESOLUTIONS,
  SEEDREAM_QUALITY_OPTIONS,
  GPT15_SIZE_OPTIONS,
  GPT15_QUALITY_OPTIONS,
  GPT15_BACKGROUND_OPTIONS,
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

// OpenAI
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/* ========================= TYPES ========================= */
type PostBody = {
  modelId: string; // "nanobanana-1", "nanobanana-2", "nanobanana-3-pro" or startsWith("seedream")
  profileId: string;
  productId: string | null;
  // legacy single custom url
  customUrl?: string | null;
  // new: multiple custom urls (http/https or data: URIs)
  customUrls?: string[];
  // new: additional refs when product is selected (http/https or data: URIs)
  additionalUrls?: string[];
  prompt: string;
  options?: {
    image_size?: string;       // seedream edit (resolution)
    image_resolution?: string; // seedream edit
    max_images?: number;       // seedream edit
    seed?: number | null;      // seedream edit
    // nano banana (KIE) image config
    aspect_ratio?: string;     // shared: nano banana & seedream 4.5
    // seedream 4.5 text-to-image
    quality?: string;          // "basic" or "high" for Seedream, or "auto"|"low"|"medium"|"high" for GPT 1.5
    // GPT 1.5 options
    gpt_size?: string;         // "auto"|"1024x1024"|"1536x1024"|"1024x1536"
    gpt_background?: string;   // "auto"|"opaque"|"transparent"
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
  resolution?: (typeof NANOBANANA_RESOLUTIONS)[number];
};

type Gpt15Options = {
  size: (typeof GPT15_SIZE_OPTIONS)[number];
  quality: (typeof GPT15_QUALITY_OPTIONS)[number];
  background: (typeof GPT15_BACKGROUND_OPTIONS)[number];
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

function normalizeKieState(state: unknown): string {
  if (typeof state !== "string") return "";
  return state.trim().toLowerCase();
}

function extractKieResultUrls(resultJson: unknown): { urls: string[]; parseError: boolean } {
  if (typeof resultJson !== "string" || !resultJson) return { urls: [], parseError: false };
  try {
    const parsed = JSON.parse(resultJson);
    const urls = parsed?.resultUrls;
    if (!Array.isArray(urls)) return { urls: [], parseError: false };
    return { urls: urls.filter((u): u is string => typeof u === "string" && u.length > 0), parseError: false };
  } catch {
    return { urls: [], parseError: true };
  }
}

function isKieSuccessState(state: string): boolean {
  return ["success", "succeed", "succeeded", "done", "complete", "completed"].includes(state);
}

function isKieFailState(state: string): boolean {
  return ["fail", "failed", "error", "errored"].includes(state);
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

async function logUsage(profileId: string, modelId: string) {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    await supabase.from("usage_events").insert({ profile_id: profileId, model_id: modelId });
  } catch (err) {
    console.error("Failed to record usage", err);
  }
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
  // Gemini generateContent endpoint does NOT support aspectRatio in generationConfig
  // Aspect ratio is only supported through the KIE API, not direct Gemini REST calls
  const generationConfig: Record<string, any> = { temperature: 0.6 };

  return { generationConfig };
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
  const { generationConfig } = buildGeminiConfigs(options, modelId);
  const apiUrl = getGeminiApiUrl(modelId);

  console.log("[Gemini Edit] URL:", apiUrl);
  console.log("[Gemini Edit] Images count:", images.length, "Image sizes:", images.map(i => i.base64.length));

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
  };

  const nbRes = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", [NB_AUTH_HEADER]: NB_API_KEY },
    body: JSON.stringify(payload),
  });
  const nbJson = await nbRes.json().catch(() => ({}));

  console.log("[Gemini Edit] Response status:", nbRes.status, nbRes.statusText);
  if (!nbRes.ok) {
    console.log("[Gemini Edit] Error response:", JSON.stringify(nbJson, null, 2));
  }

  return { nbRes, nbJson };
}

async function callGeminiTextToImage(text: string, modelId: string, options?: PostBody["options"]) {
  const { generationConfig } = buildGeminiConfigs(options, modelId);
  const payload = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              `Generate an image based on the following description. ` +
              `You MUST return an IMAGE, not text. Do not describe the image - create it.\n\n` +
              `Image description: ${text}`,
          },
        ],
      },
    ],
    // Leave response_mime_type unset: the Gemini image endpoint only accepts text/application values here but still
    // returns inline image data when omitted, so we can parse it via extractGeminiImage.
    safetySettings: SAFETY_OFF,
    generationConfig,
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
    const { modelId, profileId, productId, customUrl = null, customUrls = [], additionalUrls = [], prompt, options } =
      body;

    if (!prompt || !modelId || !profileId) {
      return NextResponse.json({ error: "Missing modelId, profileId, or prompt" }, { status: 400 });
    }

    const isSeedream = modelId.startsWith("seedream");
    const isSeedream45 = modelId === "seedream-4.5";
    // Seedream 4.5 is text-to-image, doesn't require reference; old seedream edit does
    const requiresReference = isSeedream && !isSeedream45;

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
      const resolution =
        allowResForModel && options?.image_size && resSet.has(options.image_size)
          ? (options.image_size as NanoBananaOptions["resolution"])
          : undefined;
      return { aspect_ratio, resolution };
    };

    const normalizeGpt15 = (): Gpt15Options => {
      const sizeSet = new Set<string>(GPT15_SIZE_OPTIONS);
      const qualitySet = new Set<string>(GPT15_QUALITY_OPTIONS);
      const bgSet = new Set<string>(GPT15_BACKGROUND_OPTIONS);
      const size = sizeSet.has(options?.gpt_size || "")
        ? (options!.gpt_size as Gpt15Options["size"])
        : "auto";
      const quality = qualitySet.has(options?.quality || "")
        ? (options!.quality as Gpt15Options["quality"])
        : "auto";
      const background = bgSet.has(options?.gpt_background || "")
        ? (options!.gpt_background as Gpt15Options["background"])
        : "auto";
      return { size, quality, background };
    };

    /* -------- GPT 1.5 (OpenAI Image API) -------- */
    if (modelId === "gpt-1.5") {
      if (!OPENAI_API_KEY) return NextResponse.json({ error: "OpenAI API key missing" }, { status: 500 });

      const gpt15Opts = normalizeGpt15();
      const hasReferences = referenceUrls.length > 0;

      console.log("[GPT 1.5] modelId:", modelId, "hasReferences:", hasReferences);
      console.log("[GPT 1.5] options:", gpt15Opts);

      // Use OpenAI SDK for cleaner implementation
      const OpenAI = (await import("openai")).default;
      const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

      if (hasReferences) {
        // Image Edit mode - use images.edit endpoint
        try {
          // Fetch all reference images and convert to File objects
          const imageFiles: File[] = [];
          for (let i = 0; i < referenceUrls.length; i++) {
            const imgData = await fetchImageAsBase64(referenceUrls[i]);
            const imgBuffer = Buffer.from(imgData.base64, "base64");
            const blob = new Blob([imgBuffer], { type: imgData.mime });
            const ext = imgData.mime.includes("png") ? "png" : imgData.mime.includes("webp") ? "webp" : "png";
            imageFiles.push(new File([blob], `image_${i}.${ext}`, { type: imgData.mime }));
          }

          const editParams: any = {
            model: "gpt-image-1.5",
            prompt,
            image: imageFiles.length === 1 ? imageFiles[0] : imageFiles,
          };

          // Add quality if not auto
          if (gpt15Opts.quality !== "auto") {
            editParams.quality = gpt15Opts.quality;
          }

          // Add size if not auto
          if (gpt15Opts.size !== "auto") {
            editParams.size = gpt15Opts.size;
          }

          console.log("[GPT 1.5 Edit] Calling API with", imageFiles.length, "images");

          const result = await openai.images.edit(editParams);
          const b64 = result.data?.[0]?.b64_json;

          if (!b64) {
            console.error("[GPT 1.5 Edit] No b64_json in response:", JSON.stringify(result, null, 2));
            return NextResponse.json({ error: "GPT 1.5 returned no image", debug: result }, { status: 502 });
          }

          await logUsage(profileId, modelId);
          return NextResponse.json({ imageDataUrl: `data:image/png;base64,${b64}` });
        } catch (err: any) {
          console.error("[GPT 1.5 Edit] Exception:", err);
          const msg = err?.message || err?.error?.message || "GPT 1.5 edit failed";
          return NextResponse.json({ error: msg, debug: err?.error || null }, { status: 502 });
        }
      } else {
        // Text-to-image mode - use images.generate endpoint
        try {
          const genParams: any = {
            model: "gpt-image-1.5",
            prompt,
          };

          // Add quality if not auto
          if (gpt15Opts.quality !== "auto") {
            genParams.quality = gpt15Opts.quality;
          }

          // Add size if not auto
          if (gpt15Opts.size !== "auto") {
            genParams.size = gpt15Opts.size;
          }

          // Add background if not auto (only supported with png/webp)
          if (gpt15Opts.background !== "auto") {
            genParams.background = gpt15Opts.background;
          }

          console.log("[GPT 1.5 Generate] Params:", JSON.stringify(genParams, null, 2));

          const result = await openai.images.generate(genParams);
          const b64 = result.data?.[0]?.b64_json;

          if (!b64) {
            console.error("[GPT 1.5 Generate] No b64_json in response:", JSON.stringify(result, null, 2));
            return NextResponse.json({ error: "GPT 1.5 returned no image", debug: result }, { status: 502 });
          }

          await logUsage(profileId, modelId);
          return NextResponse.json({ imageDataUrl: `data:image/png;base64,${b64}` });
        } catch (err: any) {
          console.error("[GPT 1.5 Generate] Exception:", err);
          const msg = err?.message || err?.error?.message || "GPT 1.5 generation failed";
          return NextResponse.json({ error: msg, debug: err?.error || null }, { status: 502 });
        }
      }
    }

    /* -------- Seedream 4.5 (auto-switch: text-to-image or edit) -------- */
    if (isSeedream45) {
      if (!KIE_KEY) return NextResponse.json({ error: "Seedream API key missing" }, { status: 500 });

      // Normalize options for Seedream 4.5
      const aspectRatioSet = new Set(["1:1", "4:3", "3:4", "16:9", "9:16", "2:3", "3:2", "21:9"]);
      const qualitySet = new Set<string>(SEEDREAM_QUALITY_OPTIONS);
      const aspect_ratio = aspectRatioSet.has(options?.aspect_ratio || "")
        ? options!.aspect_ratio!
        : "1:1";
      const quality = qualitySet.has(options?.quality || "")
        ? options!.quality!
        : "basic";

      // Determine mode based on whether reference images are provided
      const hasReferences = referenceUrls.length > 0;
      const useEditMode = hasReferences;

      // Edit mode requires HTTP/HTTPS URLs (not data: URIs)
      if (useEditMode) {
        const badUrl = referenceUrls.find((u) => !/^https?:\/\//i.test(u));
        if (badUrl) {
          return NextResponse.json(
            { error: "Seedream 4.5 Edit requires public HTTP/HTTPS URLs for reference images (uploaded images not supported)" },
            { status: 400 }
          );
        }
      }

      const payload = useEditMode
        ? {
            model: "seedream/4.5-edit",
            callBackUrl: "",
            input: {
              prompt,
              image_urls: referenceUrls,
              aspect_ratio,
              quality,
            },
          }
        : {
            model: "seedream/4.5-text-to-image",
            callBackUrl: "",
            input: {
              prompt,
              aspect_ratio,
              quality,
            },
          };

      const modeLabel = useEditMode ? "Seedream 4.5 Edit" : "Seedream 4.5";

      // 1) create task
      const createRes = await fetch(`${KIE_BASE}/api/v1/jobs/createTask`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${KIE_KEY}` },
        body: JSON.stringify(payload),
      });
      const createJson = await createRes.json().catch(() => ({}));
      if (!createRes.ok || createJson?.code !== 200) {
        const msg = createJson?.message || createJson?.msg || `${modeLabel} createTask failed`;
        return NextResponse.json({ error: msg }, { status: 502 });
      }
      const taskId: string | undefined = createJson?.data?.taskId;
      if (!taskId) return NextResponse.json({ error: `${modeLabel} taskId missing` }, { status: 502 });

      // 2) poll recordInfo
      const started = Date.now();
      const MAX_MS = 300_000;  // 5 minutes total timeout for concurrent requests
      let resultUrl: string | null = null;
      let lastState = "waiting";

      while (Date.now() - started < MAX_MS) {
        await new Promise((r) => setTimeout(r, 2000));
        const qRes = await fetch(`${KIE_BASE}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
          headers: { Authorization: `Bearer ${KIE_KEY}` },
        });
        const qJson = await qRes.json().catch(() => ({}));
        if (!qRes.ok || qJson?.code !== 200) {
          const isTransient =
            [429, 500, 502, 503, 504].includes(qRes.status) ||
            [429, 500, 502, 503, 504].includes(Number(qJson?.code));
          if (isTransient) continue;
          const msg = qJson?.message || qJson?.msg || `${modeLabel} query failed`;
          return NextResponse.json({ error: msg, debug: qJson || null }, { status: 502 });
        }

        const { urls, parseError } = extractKieResultUrls(qJson?.data?.resultJson);
        lastState = normalizeKieState(qJson?.data?.state) || "unknown";

        if (urls.length) {
          resultUrl = urls[0];
          break;
        }

        if (parseError && isKieSuccessState(lastState)) {
          return NextResponse.json({ error: `Malformed ${modeLabel} resultJson`, debug: { taskId, state: lastState } }, { status: 502 });
        }

        if (isKieSuccessState(lastState)) {
          // Wait for resultJson to become available instead of failing immediately.
          continue;
        }

        if (isKieFailState(lastState)) {
          const failMsg = qJson?.data?.failMsg || `${modeLabel} reported failure`;
          return NextResponse.json({ error: failMsg }, { status: 502 });
        }
      }

      if (!resultUrl) {
        return NextResponse.json({ error: `${modeLabel} generation timed out (last state: ${lastState})` }, { status: 504 });
      }
      await logUsage(profileId, modelId);
      return NextResponse.json({ imageDataUrl: resultUrl });
    }

    /* -------- Seedream Edit (KIE) -------- */
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
      const MAX_MS = 300_000;  // 5 minutes total timeout for concurrent requests
      let resultUrl: string | null = null;
      let lastState = "waiting";

      while (Date.now() - started < MAX_MS) {
        await new Promise((r) => setTimeout(r, 2000));
        const qRes = await fetch(`${KIE_BASE}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
          headers: { Authorization: `Bearer ${KIE_KEY}` },
        });
        const qJson = await qRes.json().catch(() => ({}));
        if (!qRes.ok || qJson?.code !== 200) {
          const isTransient =
            [429, 500, 502, 503, 504].includes(qRes.status) ||
            [429, 500, 502, 503, 504].includes(Number(qJson?.code));
          if (isTransient) continue;
          const msg = qJson?.message || qJson?.msg || "Seedream query failed";
          return NextResponse.json({ error: msg, debug: qJson || null }, { status: 502 });
        }

        const { urls, parseError } = extractKieResultUrls(qJson?.data?.resultJson);
        lastState = normalizeKieState(qJson?.data?.state) || "unknown";

        if (urls.length) {
          resultUrl = urls[0];
          break;
        }

        if (parseError && isKieSuccessState(lastState)) {
          return NextResponse.json({ error: "Malformed Seedream resultJson", debug: { taskId, state: lastState } }, { status: 502 });
        }

        if (isKieSuccessState(lastState)) {
          // Wait for resultJson to become available instead of failing immediately.
          continue;
        }

        if (isKieFailState(lastState)) {
          const failMsg = qJson?.data?.failMsg || "Seedream reported failure";
          return NextResponse.json({ error: failMsg }, { status: 502 });
        }
      }

      if (!resultUrl) {
        return NextResponse.json({ error: `Seedream generation timed out (last state: ${lastState})` }, { status: 504 });
      }
      await logUsage(profileId, modelId);
      return NextResponse.json({ imageDataUrl: resultUrl });
    }

    /* -------- Nano Banana via KIE -------- */
    if (modelId.startsWith("nanobanana")) {
      if (!KIE_KEY) return NextResponse.json({ error: "Nano Banana API key missing" }, { status: 500 });

      const httpRefs = referenceUrls.filter((u) => /^https?:\/\//i.test(u));
      const hasDataRefs = referenceUrls.length > httpRefs.length;
      const isPro = modelId === "nanobanana-3-pro";

      console.log("[Nano Banana] modelId:", modelId, "isPro:", isPro);
      console.log("[Nano Banana] referenceUrls:", referenceUrls.length, referenceUrls.map(u => u.slice(0, 50)));
      console.log("[Nano Banana] httpRefs:", httpRefs.length, "hasDataRefs:", hasDataRefs);
      console.log("[Nano Banana] options from request:", options);

      // If any refs are data: URIs/uploads, fall back to direct Gemini with inline_data support.
      // Note: Gemini doesn't support aspect_ratio, so data URI inputs won't respect aspect ratio settings.
      if (hasDataRefs) {
        console.log("[Nano Banana] FALLBACK TO GEMINI (has data URIs)");
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
        await logUsage(profileId, modelId);
        return NextResponse.json({ imageDataUrl: dataUrl || url });
      }

      console.log("[Nano Banana] USING KIE API");

      // nano-banana-pro uses different model name and param (image_input vs image_urls)
      const nanoModel = isPro
        ? "nano-banana-pro"
        : (referenceUrls.length > 0 ? "google/nano-banana-edit" : "google/nano-banana");
      // KIE nano-banana-pro supports resolution, others don't
      const nanoOpts = normalizeNano(modelId, isPro);

      console.log("[Nano Banana KIE] model:", nanoModel);
      console.log("[Nano Banana KIE] nanoOpts normalized:", nanoOpts);

      const inputPayload: Record<string, any> = {
        prompt,
        output_format: "png",
      };
      if (httpRefs.length) {
        // nano-banana-pro uses image_input, others use image_urls
        if (isPro) {
          inputPayload.image_input = httpRefs;
        } else {
          inputPayload.image_urls = httpRefs;
        }
      }
      const ar = nanoOpts.aspect_ratio || undefined;
      if (ar) inputPayload.aspect_ratio = ar;
      if (nanoOpts.resolution) inputPayload.resolution = nanoOpts.resolution;

      const payload = {
        model: nanoModel,
        callBackUrl: "",
        input: inputPayload,
      };

      console.log("[Nano Banana KIE] Final payload:", JSON.stringify(payload, null, 2));

      const createRes = await fetch(`${KIE_BASE}/api/v1/jobs/createTask`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${KIE_KEY}` },
        body: JSON.stringify(payload),
      });
      const createJson = await createRes.json().catch(() => ({}));
      console.log("[Nano Banana] createTask response:", JSON.stringify(createJson, null, 2));
      if (!createRes.ok || createJson?.code !== 200) {
        const msg = createJson?.message || createJson?.msg || "Nano Banana createTask failed";
        console.error("Nano Banana createTask error", { status: createRes.status, body: createJson });
        return NextResponse.json({ error: msg, debug: createJson || null }, { status: 502 });
      }
      const taskId: string | undefined = createJson?.data?.taskId;
      if (!taskId) return NextResponse.json({ error: "Nano Banana taskId missing" }, { status: 502 });

      const started = Date.now();
      const MAX_MS = 600_000;  // 10 minutes total timeout for queued requests
      let resultUrl: string | null = null;
      let lastState = "waiting";
      let pollCount = 0;

      console.log(`[Nano Banana] Task ${taskId} created, starting poll loop`);

      while (Date.now() - started < MAX_MS) {
        await new Promise((r) => setTimeout(r, 2000));
        pollCount++;
        const qRes = await fetch(`${KIE_BASE}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
          headers: { Authorization: `Bearer ${KIE_KEY}` },
        });
        const qJson = await qRes.json().catch(() => ({}));
        if (!qRes.ok || qJson?.code !== 200) {
          const isTransient =
            [429, 500, 502, 503, 504].includes(qRes.status) ||
            [429, 500, 502, 503, 504].includes(Number(qJson?.code));
          if (isTransient) {
            console.warn(
              `[Nano Banana] Task ${taskId} poll #${pollCount}: transient error (http=${qRes.status}, code=${qJson?.code}), retrying...`
            );
            continue;
          }
          const msg = qJson?.message || qJson?.msg || "Nano Banana query failed";
          console.error("Nano Banana recordInfo error", { status: qRes.status, body: qJson });
          return NextResponse.json({ error: msg, debug: qJson || null }, { status: 502 });
        }

        const { urls, parseError } = extractKieResultUrls(qJson?.data?.resultJson);
        lastState = normalizeKieState(qJson?.data?.state) || "unknown";

        // Log full response on first poll or when state changes
        if (pollCount === 1 || pollCount % 10 === 0) {
          console.log(`[Nano Banana] Task ${taskId} poll #${pollCount} FULL response:`, JSON.stringify(qJson, null, 2));
        } else {
          console.log(`[Nano Banana] Task ${taskId} poll #${pollCount}: state=${lastState}`);
        }

        // Some KIE responses include resultJson before state flips to "success".
        if (urls.length) {
          resultUrl = urls[0];
          break;
        }

        if (parseError && isKieSuccessState(lastState)) {
          return NextResponse.json({ error: "Malformed Nano Banana resultJson", debug: { taskId, state: lastState } }, { status: 502 });
        }

        if (isKieSuccessState(lastState)) {
          // Wait for resultJson to become available instead of failing immediately.
          continue;
        }

        if (isKieFailState(lastState)) {
          const failMsg = qJson?.data?.failMsg || "Nano Banana reported failure";
          return NextResponse.json({ error: failMsg }, { status: 502 });
        }
      }

      if (!resultUrl) {
        console.error(`[Nano Banana] Task ${taskId} TIMED OUT after ${pollCount} polls, lastState=${lastState}`);
        return NextResponse.json({ error: `Nano Banana generation timed out (last state: ${lastState})` }, { status: 504 });
      }
      await logUsage(profileId, modelId);
      return NextResponse.json({ imageDataUrl: resultUrl });
    }

    return NextResponse.json({ error: "Unsupported model" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Unexpected error" }, { status: 500 });
  }
}
