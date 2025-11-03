export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// ---- ENV ----
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const KIE_BASE = process.env.KIE_API_BASE || "https://api.kie.ai";
const KIE_KEY = process.env.KIE_API_KEY!;

// ---- TYPES from your UI ----
type VideoProvider = "kling" | "veo" | "sora";

type PostBody = {
  provider?: VideoProvider;
  model?: string;
  // mode: "image-to-video" | "text-to-video" (for Kling)
  mode?: "image-to-video" | "text-to-video";
  // shared
  prompt: string;
  duration?: "5" | "10";          // KIE expects string "5" | "10"
  negative_prompt?: string;
  cfg_scale?: number;             // 0..1
  aspect_ratio?: "16:9" | "9:16" | "1:1"; // text2video only

  // image-to-video reference (Kling)
  productId?: string | null;
  customUrl?: string | null;      // direct URL if using custom

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

async function getReferenceUrl(productId: string | null | undefined, customUrl: string | null | undefined) {
  const trimmedCustom = customUrl?.trim();
  if (trimmedCustom) return trimmedCustom;
  if (!productId) throw new Error("Reference image URL required (image-to-video).");
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
      mode,
      model,
      prompt,
      duration = "5",
      negative_prompt,
      cfg_scale,
      aspect_ratio,
      productId = null,
      customUrl = null,
      // Veo
      aspectRatio,
      generationType,
      imageUrls,
      seeds,
      // Sora
      input,
    } = body;

    if (!prompt) return NextResponse.json({ error: "Missing prompt" }, { status: 400 });

    /* -------- KLING -------- */
    if (provider === "kling") {
      if (mode !== "image-to-video" && mode !== "text-to-video") {
        return NextResponse.json({ error: "Invalid mode for Kling" }, { status: 400 });
      }

      // Build payloads exactly per KIE docs
      if (mode === "image-to-video") {
        const image_url = await getReferenceUrl(productId, customUrl);
        const payload = {
          model: model || "kling/v2-5-turbo-image-to-video-pro",
          callBackUrl: "", // optional; leave blank for polling
          input: {
            prompt,
            image_url,                 // must be a PUBLIC url < 10MB
            duration,                  // "5" | "10"
            ...(negative_prompt ? { negative_prompt } : {}),
            ...(typeof cfg_scale === "number" ? { cfg_scale } : {}),
          },
        };
        const taskId = await kieCreateTask(payload);
        const { url } = await kiePoll(taskId, 300_000); // 5 minutes max
        return NextResponse.json({ videoUrl: url });
      }

      // text-to-video
      const payload = {
        model: model || "kling/v2-5-turbo-text-to-video-pro",
        callBackUrl: "",
        input: {
          prompt,
          duration,
          ...(aspect_ratio ? { aspect_ratio } : {}),
          ...(negative_prompt ? { negative_prompt } : {}),
          ...(typeof cfg_scale === "number" ? { cfg_scale } : {}),
        },
      };
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
