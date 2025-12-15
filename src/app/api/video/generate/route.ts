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
async function veoGenerate(payload: {
  prompt: string;
  model?: string;
  imageUrls?: string[];
  generationType?: string;
  aspectRatio?: string;
  seeds?: number;
}) {
  const res = await fetch(`${KIE_BASE}/api/v1/veo/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KIE_KEY}`,
    },
    body: JSON.stringify({
      prompt: payload.prompt,
      model: payload.model || "veo3_fast",
      ...(payload.imageUrls && payload.imageUrls.length > 0 ? { imageUrls: payload.imageUrls } : {}),
      ...(payload.generationType ? { generationType: payload.generationType } : {}),
      ...(payload.aspectRatio ? { aspectRatio: payload.aspectRatio } : {}),
      ...(typeof payload.seeds === "number" ? { seeds: payload.seeds } : {}),
      enableTranslation: true,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.code !== 200) {
    const msg = json?.message || json?.msg || `Veo generate failed (${res.status})`;
    throw new Error(msg);
  }
  const taskId = json?.data?.taskId as string | undefined;
  if (!taskId) throw new Error("Veo taskId missing");
  return taskId;
}

async function veoPoll(taskId: string, maxMs = 360_000) {
  const start = Date.now();
  let lastFlag = 0;
  while (Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 3000)); // Poll every 3s for Veo
    const res = await fetch(`${KIE_BASE}/api/v1/veo/record-info?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${KIE_KEY}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.code !== 200) {
      const msg = json?.message || json?.msg || "Veo query failed";
      throw new Error(msg);
    }

    const data = json?.data;
    lastFlag = data?.successFlag ?? 0;

    // successFlag: 0 = generating, 1 = success, 2 = failed, 3 = generation failed
    if (lastFlag === 1) {
      const urls: string[] = data?.response?.resultUrls || [];
      if (!urls.length) throw new Error("Veo returned no resultUrls");
      return { url: urls[0] as string };
    }
    if (lastFlag === 2 || lastFlag === 3) {
      const errMsg = data?.errorMessage || data?.response?.errorMessage || "Veo generation failed";
      throw new Error(errMsg);
    }
  }
  throw new Error(`Veo generation timed out (last flag: ${lastFlag})`);
}

export async function POST(req: Request) {
  try {
    if (!KIE_KEY) {
      return NextResponse.json({ error: "KIE_API_KEY missing" }, { status: 500 });
    }

    const body = (await req.json()) as PostBody;
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
      // Determine generation type based on images
      let effectiveGenType = generationType;
      if (!effectiveGenType) {
        if (imageUrls && imageUrls.length > 0) {
          // Auto-detect: 1-2 images = FIRST_AND_LAST_FRAMES_2_VIDEO, 3+ = REFERENCE_2_VIDEO
          effectiveGenType = imageUrls.length >= 3 ? "REFERENCE_2_VIDEO" : "FIRST_AND_LAST_FRAMES_2_VIDEO";
        } else {
          effectiveGenType = "TEXT_2_VIDEO";
        }
      }

      // REFERENCE_2_VIDEO only supports veo3_fast and 16:9
      const effectiveModel = effectiveGenType === "REFERENCE_2_VIDEO" ? "veo3_fast" : (model || "veo3_fast");
      const effectiveAspect = effectiveGenType === "REFERENCE_2_VIDEO" ? "16:9" : (aspectRatio || "16:9");

      const taskId = await veoGenerate({
        prompt,
        model: effectiveModel,
        imageUrls: imageUrls && imageUrls.length > 0 ? imageUrls : undefined,
        generationType: effectiveGenType,
        aspectRatio: effectiveAspect,
        seeds: typeof seeds === "number" ? seeds : undefined,
      });

      const { url } = await veoPoll(taskId, 420_000); // 7 minutes max for Veo
      return NextResponse.json({ videoUrl: url });
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
    return NextResponse.json({ error: err?.message || "Unexpected error" }, { status: 500 });
  }
}
