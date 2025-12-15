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

    /* -------- VEO (Google DeepMind) -------- */
    if (provider === "veo") {
      const payload: any = {
        model: model || "veo3_fast",
        callBackUrl: "",
        input: {
          prompt,
          generationType: generationType || "TEXT_2_VIDEO",
        },
      };

      // Add aspect ratio if provided
      if (aspectRatio && aspectRatio !== "Auto") {
        payload.input.aspectRatio = aspectRatio;
      }

      // Add image URLs if provided
      if (imageUrls && imageUrls.length > 0) {
        payload.input.imageUrls = imageUrls;
      }

      // Add seed if provided
      if (typeof seeds === "number") {
        payload.input.seeds = seeds;
      }

      const taskId = await kieCreateTask(payload);
      const { url } = await kiePoll(taskId, 360_000); // 6 minutes max for Veo
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
