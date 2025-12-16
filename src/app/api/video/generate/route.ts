export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

// ---- ENV ----
const KIE_BASE = process.env.KIE_API_BASE || "https://api.kie.ai";
const KIE_KEY = process.env.KIE_API_KEY!;

// ---- TYPES from your UI ----
type VideoProvider = "kling" | "veo" | "sora";

type PostBody = {
  provider?: VideoProvider;
  model?: string;
  mode?: "kling26";
  // shared
  prompt: string;
  duration?: "5" | "10";          // KIE expects string "5" | "10"
  aspect_ratio?: "16:9" | "9:16" | "1:1"; // text2video and kling26

  // Kling 2.6 specific
  image_urls?: string[];          // Array of image URLs for Kling 2.6
  sound?: boolean;                // Generate with sound for Kling 2.6

  // Veo-specific
  aspectRatio?: "16:9" | "9:16" | "Auto";
  generationType?: "TEXT_2_VIDEO" | "FIRST_AND_LAST_FRAMES_2_VIDEO" | "REFERENCE_2_VIDEO";
  imageUrls?: string[];
  seeds?: number;

  // Sora-specific
  input?: {
    n_frames?: "10" | "15" | "25";
    image_urls?: string[];
    aspect_ratio?: "portrait" | "landscape";
    shots?: Array<{ duration: number; scene: string }>;
  };
};

// ---- Generic KIE API (for Kling, Sora) ----
async function kieCreateTask(payload: any) {
  const res = await fetch(`${KIE_BASE}/api/v1/jobs/createTask`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KIE_KEY}`,
    },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.code !== 200) {
    const msg = json?.message || json?.msg || `KIE createTask failed (${res.status})`;
    throw new Error(msg);
  }
  const taskId = json?.data?.taskId as string | undefined;
  if (!taskId) throw new Error("KIE taskId missing");
  return taskId;
}

async function kiePoll(taskId: string, maxMs = 240_000) {
  const start = Date.now();
  let lastState = "waiting";
  while (Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(`${KIE_BASE}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${KIE_KEY}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.code !== 200) {
      const msg = json?.message || json?.msg || "KIE query failed";
      throw new Error(msg);
    }
    lastState = json?.data?.state || "unknown";

    if (lastState === "success") {
      // resultJson: "{\"resultUrls\":[\"https://...mp4\"]}"
      try {
        const parsed = JSON.parse(json?.data?.resultJson || "{}");
        const urls: string[] = parsed?.resultUrls || [];
        if (!urls.length) throw new Error("KIE returned no resultUrls");
        return { url: urls[0] as string };
      } catch {
        throw new Error("Malformed KIE resultJson");
      }
    }
    if (lastState === "fail") {
      const failMsg = json?.data?.failMsg || "KIE reported failure";
      throw new Error(failMsg);
    }
  }
  throw new Error(`KIE generation timed out (last state: ${lastState})`);
}

// ---- Veo 3.1 Dedicated API ----
// Supports TEXT_2_VIDEO (no images) and FIRST_AND_LAST_FRAMES_2_VIDEO (1-2 images)
async function veoGenerate(payload: {
  prompt: string;
  model: string;
  generationType: "TEXT_2_VIDEO" | "FIRST_AND_LAST_FRAMES_2_VIDEO";
  aspectRatio: "16:9" | "9:16";
  imageUrls?: string[];
  seeds?: number;
}, maxRetries = 3) {
  // Build request body per API spec
  // Note: enableFallback is deprecated - KIE now auto-handles content review
  const requestBody: Record<string, any> = {
    prompt: payload.prompt,
    model: payload.model,
    generationType: payload.generationType,
    aspectRatio: payload.aspectRatio,
    enableTranslation: true,
  };

  // Add imageUrls only for image-to-video mode
  if (payload.generationType === "FIRST_AND_LAST_FRAMES_2_VIDEO" && payload.imageUrls && payload.imageUrls.length > 0) {
    // Limit to max 2 images for this mode
    requestBody.imageUrls = payload.imageUrls.slice(0, 2);
  }

  // Add seed if valid (10000-99999)
  if (typeof payload.seeds === "number" && payload.seeds >= 10000 && payload.seeds <= 99999) {
    requestBody.seeds = payload.seeds;
  }

  console.log("[Veo] Request:", JSON.stringify(requestBody, null, 2));

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(`${KIE_BASE}/api/v1/veo/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${KIE_KEY}`,
        },
        body: JSON.stringify(requestBody),
      });

      const json = await res.json().catch(() => ({}));
      console.log(`[Veo] Response (attempt ${attempt}):`, JSON.stringify(json, null, 2));

      // Handle rate limiting and temporary errors with retry
      if (json?.code === 429 || json?.code === 503 || json?.code === 500 || res.status === 429 || res.status === 503) {
        console.log(`[Veo] Rate limited or server error (attempt ${attempt}/${maxRetries}), waiting before retry...`);
        lastError = new Error(json?.message || json?.msg || `Veo temporarily unavailable (${json?.code || res.status})`);
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 5000 * attempt)); // Exponential backoff
          continue;
        }
        throw lastError;
      }

      if (!res.ok || json?.code !== 200) {
        const msg = json?.message || json?.msg || `Veo generate failed (${res.status})`;
        throw new Error(msg);
      }

      const taskId = json?.data?.taskId as string | undefined;
      if (!taskId) throw new Error("Veo taskId missing");
      return taskId;
    } catch (err: any) {
      lastError = err;
      if (attempt < maxRetries && (err.message?.includes("rate") || err.message?.includes("limit") || err.message?.includes("unavailable"))) {
        console.log(`[Veo] Error on attempt ${attempt}/${maxRetries}: ${err.message}, retrying...`);
        await new Promise((r) => setTimeout(r, 5000 * attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastError || new Error("Veo generate failed after retries");
}

async function veoPoll(taskId: string, maxMs = 420_000) {
  const start = Date.now();
  let lastFlag = 0;
  let pollCount = 0;
  let lastErrorData: any = null;

  while (Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 4000)); // Poll every 4s for Veo
    pollCount++;

    const res = await fetch(`${KIE_BASE}/api/v1/veo/record-info?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${KIE_KEY}` },
    });

    const json = await res.json().catch(() => ({}));

    // Handle non-200 response codes
    if (json?.code && json.code !== 200) {
      // Some error codes indicate the task is still processing
      if (json.code === 400 && (json.msg?.includes("processing") || json.msg?.includes("pending"))) {
        console.log(`[Veo] Poll #${pollCount}: Still processing...`);
        continue;
      }
      // Rate limit or temporary errors - wait and retry
      if (json.code === 429 || json.code === 503 || json.code === 500) {
        console.log(`[Veo] Poll #${pollCount}: Temporary error (${json.code}), retrying...`);
        await new Promise((r) => setTimeout(r, 5000)); // Extra wait for rate limits
        continue;
      }
      console.error(`[Veo] Poll #${pollCount}: Error response:`, JSON.stringify(json, null, 2));
      const msg = json?.message || json?.msg || `Veo query failed (code: ${json.code})`;
      throw new Error(msg);
    }

    const data = json?.data;
    lastFlag = data?.successFlag ?? 0;
    lastErrorData = data;

    console.log(`[Veo] Poll #${pollCount}: successFlag=${lastFlag}`);

    // successFlag: 0 = generating, 1 = success, 2 = failed, 3 = generation failed
    if (lastFlag === 1) {
      const urls: string[] = data?.response?.resultUrls || [];
      if (!urls.length) throw new Error("Veo returned no resultUrls");
      return { url: urls[0] as string };
    }
    if (lastFlag === 2 || lastFlag === 3) {
      // Log full error data for debugging
      console.error(`[Veo] Generation failed. Full data:`, JSON.stringify(data, null, 2));
      const errMsg = data?.errorMessage || data?.response?.errorMessage || data?.failReason || "Veo generation failed";
      throw new Error(errMsg);
    }
  }
  console.error(`[Veo] Timeout. Last data:`, JSON.stringify(lastErrorData, null, 2));
  throw new Error(`Veo generation timed out after ${Math.round((Date.now() - start) / 1000)}s (last flag: ${lastFlag})`);
}

export async function POST(req: Request) {
  console.log("[Video Generate] Request received");

  try {
    if (!KIE_KEY) {
      console.log("[Video Generate] ERROR: KIE_API_KEY missing");
      return NextResponse.json({ error: "KIE_API_KEY missing" }, { status: 500 });
    }

    let body: PostBody;
    try {
      body = (await req.json()) as PostBody;
      console.log("[Video Generate] Request body:", JSON.stringify(body, null, 2));
    } catch (parseError: any) {
      console.log("[Video Generate] ERROR parsing request body:", parseError?.message);
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const {
      provider = "kling",
      model,
      prompt,
      duration = "5",
      aspect_ratio,
      // Kling 2.6 specific
      image_urls,
      sound,
      // Veo
      aspectRatio,
      generationType,
      imageUrls,
      seeds,
      // Sora
      input,
    } = body;

    if (!prompt) return NextResponse.json({ error: "Missing prompt" }, { status: 400 });

    /* -------- KLING 2.6 -------- */
    if (provider === "kling") {
      // Kling 2.6 uses different payload structure
      // Model is determined by whether image_urls are provided
      const isImageToVideo = image_urls && image_urls.length > 0;
      const kling26Model = model || (isImageToVideo ? "kling-2.6/image-to-video" : "kling-2.6/text-to-video");

      const payload: any = {
        model: kling26Model,
        callBackUrl: "",
        input: {
          prompt,
          sound: sound ?? false,
          duration,
        },
      };

      // Add image_urls for image-to-video
      if (isImageToVideo) {
        payload.input.image_urls = image_urls;
      } else {
        // Text-to-video requires aspect_ratio
        if (aspect_ratio) {
          payload.input.aspect_ratio = aspect_ratio;
        }
      }

      const taskId = await kieCreateTask(payload);
      const { url } = await kiePoll(taskId, 300_000); // 5 minutes max
      return NextResponse.json({ videoUrl: url });
    }

    /* -------- VEO 3.1 (Google DeepMind) -------- */
    if (provider === "veo") {
      console.log("[Video Generate] Processing Veo request");

      // Determine generation type: TEXT_2_VIDEO (no images) or FIRST_AND_LAST_FRAMES_2_VIDEO (1-2 images)
      const hasImages = imageUrls && imageUrls.length > 0;
      const genType: "TEXT_2_VIDEO" | "FIRST_AND_LAST_FRAMES_2_VIDEO" = hasImages
        ? "FIRST_AND_LAST_FRAMES_2_VIDEO"
        : "TEXT_2_VIDEO";

      // Validate aspect ratio (only 16:9 and 9:16 supported, not Auto)
      let aspect: "16:9" | "9:16" = "16:9";
      if (aspectRatio === "9:16") {
        aspect = "9:16";
      }

      // Use provided model or default to veo3_fast
      const veoModel = model === "veo3" ? "veo3" : "veo3_fast";

      console.log("[Video Generate] Veo params:", { genType, aspect, veoModel, hasImages, imageCount: imageUrls?.length || 0 });

      try {
        const taskId = await veoGenerate({
          prompt,
          model: veoModel,
          generationType: genType,
          aspectRatio: aspect,
          imageUrls: hasImages ? imageUrls : undefined,
          seeds: typeof seeds === "number" ? seeds : undefined,
        });

        console.log("[Video Generate] Veo taskId:", taskId);

        const { url } = await veoPoll(taskId, 420_000); // 7 minutes max for Veo
        console.log("[Video Generate] Veo completed, url:", url);
        return NextResponse.json({ videoUrl: url });
      } catch (veoError: any) {
        console.log("[Video Generate] Veo error:", veoError?.message);
        throw veoError;
      }
    }

    /* -------- SORA (OpenAI Storyboard) -------- */
    if (provider === "sora") {
      if (!input) {
        return NextResponse.json({ error: "Sora requires input object" }, { status: 400 });
      }

      const payload = {
        model: model || "sora-2-pro-storyboard",
        callBackUrl: "",
        input: {
          prompt, // Overall theme/story
          n_frames: input.n_frames || "15",
          aspect_ratio: input.aspect_ratio || "landscape",
          ...(input.image_urls && input.image_urls.length > 0 ? { image_urls: input.image_urls } : {}),
          ...(input.shots && input.shots.length > 0 ? { shots: input.shots } : {}),
        },
      };

      const taskId = await kieCreateTask(payload);
      const { url } = await kiePoll(taskId, 480_000); // 8 minutes max for Sora
      return NextResponse.json({ videoUrl: url });
    }

    return NextResponse.json({ error: `Provider ${provider} not supported` }, { status: 400 });
  } catch (err: any) {
    console.log("[Video Generate] Unhandled error:", err?.message, err?.stack);
    return NextResponse.json({ error: err?.message || "Unexpected error" }, { status: 500 });
  }
}
