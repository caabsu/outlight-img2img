export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel Serverless Functions on Pro plan require 1..800 seconds.
// Keep this above our KIE polling windows (<= 600s) while staying within limits.
export const maxDuration = 800;

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
  GPT2_ASPECT_RATIOS,
  GPT2_RESOLUTIONS,
  GPT2_QUALITY_OPTIONS,
  GPT2_BACKGROUND_OPTIONS,
  GPT2_OUTPUT_FORMATS,
  GPT2_MODERATION_OPTIONS,
  NB2_ASPECT_RATIOS,
  NB2_RESOLUTIONS,
  NB2_OUTPUT_FORMATS,
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
    image_size?: string;       // shared: GPT Image 2/Nano Banana resolution, Seedream edit size
    image_resolution?: string; // seedream edit
    max_images?: number;       // seedream edit
    seed?: number | null;      // seedream edit
    // KIE image config
    aspect_ratio?: string;     // shared: GPT Image 2, Nano Banana, Seedream 4.5
    // seedream 4.5 text-to-image
    quality?: string;          // "basic" or "high" for Seedream, or "auto"|"low"|"medium"|"high" for GPT
    // GPT 1.5 options
    gpt_size?: string;         // "auto"|"1024x1024"|"1536x1024"|"1024x1536"
    gpt_background?: string;   // "auto"|"opaque"|"transparent" for GPT 1.5, "auto"|"opaque" for GPT Image 2
    // GPT Image 2 options
    gpt2_size?: string;        // legacy preset size from ads/UGC flows
    output_format?: string;    // "png"|"jpeg"|"webp"
    output_compression?: number | string; // 0-100 for jpeg/webp
    moderation?: string;       // "auto"|"low"
    // Nano Banana 2 options
    nb_output_format?: string;    // "jpg"|"png"
    google_search?: boolean;
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

type Gpt2Options = {
  aspect_ratio: (typeof GPT2_ASPECT_RATIOS)[number];
  resolution: (typeof GPT2_RESOLUTIONS)[number];
  quality: (typeof GPT2_QUALITY_OPTIONS)[number];
  background: (typeof GPT2_BACKGROUND_OPTIONS)[number];
  output_format: (typeof GPT2_OUTPUT_FORMATS)[number];
  output_compression?: number;
  moderation: (typeof GPT2_MODERATION_OPTIONS)[number];
};

  const SAFETY_OFF = [
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
];

/* ========================= HELPERS ========================= */
function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function clampPercentage(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function inferGpt2ControlsFromLegacySize(size: string | undefined): Partial<Gpt2Options> {
  switch (size) {
    case "1536x864":
      return { aspect_ratio: "16:9", resolution: "1K" };
    case "864x1536":
      return { aspect_ratio: "9:16", resolution: "1K" };
    case "1536x1024":
      return { aspect_ratio: "3:2", resolution: "1K" };
    case "1024x1536":
      return { aspect_ratio: "2:3", resolution: "1K" };
    case "2048x2048":
      return { aspect_ratio: "1:1", resolution: "2K" };
    case "2560x1440":
      return { aspect_ratio: "16:9", resolution: "2K" };
    case "1440x2560":
      return { aspect_ratio: "9:16", resolution: "2K" };
    case "2880x2880":
      return { aspect_ratio: "1:1", resolution: "2K" };
    case "3840x2160":
      return { aspect_ratio: "16:9", resolution: "4K" };
    case "2160x3840":
      return { aspect_ratio: "9:16", resolution: "4K" };
    default:
      return {};
  }
}

type RateLimiter = {
  schedule<T>(fn: () => Promise<T>, options?: { signal?: AbortSignal }): Promise<T>;
};

function createRateLimiter({
  concurrency,
  minIntervalMs,
}: {
  concurrency: number;
  minIntervalMs: number;
}): RateLimiter {
  const safeConcurrency = Math.max(1, Math.floor(concurrency));
  const safeMinIntervalMs = Math.max(0, Math.floor(minIntervalMs));

  let active = 0;
  let lastStartMs = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const queue: Array<{
    fn: () => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
    signal?: AbortSignal;
  }> = [];

  const pump = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    while (active < safeConcurrency && queue.length > 0) {
      const item = queue.shift()!;
      if (item.signal?.aborted) {
        const err = Object.assign(new Error("Aborted"), { name: "AbortError" });
        item.reject(err);
        continue;
      }

      const now = Date.now();
      const waitMs = Math.max(0, safeMinIntervalMs - (now - lastStartMs));
      if (waitMs > 0) {
        queue.unshift(item);
        timer = setTimeout(pump, waitMs);
        return;
      }

      active++;
      lastStartMs = Date.now();

      Promise.resolve()
        .then(item.fn)
        .then(item.resolve, item.reject)
        .finally(() => {
          active--;
          pump();
        });
    }
  };

  return {
    schedule<T>(fn: () => Promise<T>, options?: { signal?: AbortSignal }) {
      return new Promise<T>((resolve, reject) => {
        queue.push({
          fn,
          resolve: resolve as (value: unknown) => void,
          reject,
          signal: options?.signal,
        });
        pump();
      });
    },
  };
}

const kieCreateTaskLimiter = createRateLimiter({
  concurrency: envNumber("KIE_CREATE_TASK_CONCURRENCY", 1),
  minIntervalMs: envNumber("KIE_CREATE_TASK_MIN_INTERVAL_MS", 1000),
});

const kieRecordInfoLimiter = createRateLimiter({
  concurrency: envNumber("KIE_RECORD_INFO_CONCURRENCY", 10),
  minIntervalMs: envNumber("KIE_RECORD_INFO_MIN_INTERVAL_MS", 0),
});

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

function isTransientStatus(status: number): boolean {
  return [408, 429, 500, 502, 503, 504].includes(status);
}

/**
 * Many upstream (KIE/provider) failures are explicitly retryable even though they
 * arrive as a "fail" state — e.g. "Internal Error, Please try again later.",
 * overloads, timeouts and rate limits. Recreating the task usually succeeds.
 * This classifier decides whether the WHOLE task should be retried.
 */
function isTransientFailMessage(message: unknown): boolean {
  if (typeof message !== "string" || !message) return false;
  const m = message.toLowerCase();
  const transientNeedles = [
    "internal error",
    "try again",
    "retry",
    "timeout",
    "timed out",
    "temporar",          // temporary / temporarily
    "overload",          // overloaded
    "rate limit",
    "too many request",
    "service unavailable",
    "server error",
    "bad gateway",
    "gateway time",
    "capacity",
    "busy",
    "please wait",
    "unavailable",
    "502",
    "503",
    "504",
  ];
  // Some messages are hard failures even if they contain a generic word — never retry these.
  const hardNeedles = [
    "file type not supported",
    "content policy",
    "safety",
    "moderation",
    "nsfw",
    "invalid",
    "not allowed",
    "unsupported",
    "billing",
    "insufficient",
    "quota exceeded",
  ];
  if (hardNeedles.some((n) => m.includes(n))) return false;
  return transientNeedles.some((n) => m.includes(n));
}

function retryDelayMs(attempt: number, retryAfterHeader: string | null, status?: number): number {
  const retryAfterSeconds = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : NaN;
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) return retryAfterSeconds * 1000;
  const initial = status === 429 ? 1500 : 500;
  const base = Math.min(30_000, initial * 2 ** (attempt - 1));
  return base + Math.floor(Math.random() * 500);
}

async function sleep(ms: number, signal?: AbortSignal) {
  if (!signal) return new Promise<void>((r) => setTimeout(r, ms));
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const onAbort = () => {
      clearTimeout(t);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort);
  });
}

type KieCreateTaskResult = {
  taskId?: string;
  createJson: any;
  status: number;
  attempts: number;
  transient: boolean;
};

async function kieCreateTaskWithRetry(
  payload: any,
  signal: AbortSignal | undefined,
  label: string,
  maxAttempts = 8
): Promise<KieCreateTaskResult> {
  let lastStatus = 0;
  let lastJson: any = {};
  let lastTransient = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) return { createJson: lastJson, status: 499, attempts: attempt, transient: true };

    const res = await kieCreateTaskLimiter.schedule(
      () =>
        fetch(`${KIE_BASE}/api/v1/jobs/createTask`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${KIE_KEY}` },
          body: JSON.stringify(payload),
          signal,
        }),
      { signal }
    );
    const json = await res.json().catch(() => ({}));
    lastStatus = res.status;
    lastJson = json;

    const taskId = json?.data?.taskId as string | undefined;
    if (res.ok && json?.code === 200 && taskId) {
      return { taskId, createJson: json, status: res.status, attempts: attempt, transient: false };
    }

    const msgText = String(json?.message || json?.msg || "").toLowerCase();
    const hardFailure =
      msgText.includes("file type not supported") ||
      msgText.includes("image_input file type not supported") ||
      msgText.includes("input_urls file type not supported");

    lastTransient = (isTransientStatus(res.status) || isTransientStatus(Number(json?.code))) && !hardFailure;

    if (hardFailure) {
      return { createJson: json, status: res.status, attempts: attempt, transient: false };
    }
    if (lastTransient && attempt < maxAttempts) {
      const statusForDelay = res.status === 200 ? Number(json?.code) : res.status;
      const delay = retryDelayMs(attempt, res.headers.get("retry-after"), statusForDelay);
      console.warn(
        `[${label}] createTask transient failure (attempt ${attempt}/${maxAttempts}) http=${res.status} code=${json?.code}; retrying in ${delay}ms`
      );
      await sleep(delay, signal);
      continue;
    }

    return { createJson: json, status: res.status, attempts: attempt, transient: lastTransient };
  }

  return { createJson: lastJson, status: lastStatus, attempts: maxAttempts, transient: lastTransient };
}

type KiePollResult =
  | { ok: true; url: string; polls: number; lastState: string }
  | { ok: false; status: number; error: string; debug?: unknown; polls: number; lastState: string; transient: boolean };

async function kieRecordInfo(taskId: string, signal: AbortSignal | undefined) {
  const url = `${KIE_BASE}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`;
  const res = await kieRecordInfoLimiter.schedule(
    () =>
      fetch(url, {
        headers: { Authorization: `Bearer ${KIE_KEY}` },
        signal,
      }),
    { signal }
  );
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

async function kiePollForResultUrl({
  taskId,
  signal,
  label,
  maxMs,
  initialDelayMs = 2000,
  maxDelayMs = 15000,
  logEvery = 0,
}: {
  taskId: string;
  signal: AbortSignal | undefined;
  label: string;
  maxMs: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  logEvery?: number;
}): Promise<KiePollResult> {
  const started = Date.now();
  let pollDelayMs = Math.max(250, Math.floor(initialDelayMs));
  const maxDelay = Math.max(pollDelayMs, Math.floor(maxDelayMs));

  let pollCount = 0;
  let lastState = "waiting";

  while (Date.now() - started < maxMs) {
    const jitter = Math.floor(Math.random() * Math.min(500, Math.max(50, pollDelayMs / 4)));
    await sleep(pollDelayMs + jitter, signal);
    if (signal?.aborted) {
      return { ok: false, status: 499, error: "Request cancelled", polls: pollCount, lastState, transient: false };
    }

    pollCount++;
    const { res, json } = await kieRecordInfo(taskId, signal);

    if (!res.ok || json?.code !== 200) {
      const transient = isTransientStatus(res.status) || isTransientStatus(Number(json?.code));
      if (transient) {
        pollDelayMs = Math.min(maxDelay, Math.floor(pollDelayMs * 1.5));
        if (pollCount === 1 || (logEvery > 0 && pollCount % logEvery === 0)) {
          console.warn(
            `[${label}] Task ${taskId} poll #${pollCount}: transient (http=${res.status}, code=${json?.code}) nextDelay=${pollDelayMs}ms`
          );
        }
        continue;
      }

      const msg = json?.message || json?.msg || `${label} query failed`;
      return {
        ok: false,
        status: 502,
        error: msg,
        debug: json || null,
        polls: pollCount,
        lastState,
        transient: isTransientFailMessage(msg),
      };
    }

    const { urls, parseError } = extractKieResultUrls(json?.data?.resultJson);
    lastState = normalizeKieState(json?.data?.state) || "unknown";

    if (logEvery > 0 && (pollCount === 1 || pollCount % logEvery === 0)) {
      console.log(`[${label}] Task ${taskId} poll #${pollCount} FULL response:`, JSON.stringify(json, null, 2));
    } else if (logEvery > 0) {
      console.log(`[${label}] Task ${taskId} poll #${pollCount}: state=${lastState}`);
    }

    if (urls.length) {
      return { ok: true, url: urls[0], polls: pollCount, lastState };
    }

    if (parseError && isKieSuccessState(lastState)) {
      return {
        ok: false,
        status: 502,
        error: `Malformed ${label} resultJson`,
        debug: { taskId, state: lastState },
        polls: pollCount,
        lastState,
        transient: true, // success state but unparseable payload — a fresh task usually returns clean JSON
      };
    }

    if (isKieFailState(lastState)) {
      const failMsg = json?.data?.failMsg || json?.data?.failureReason || `${label} reported failure`;
      return {
        ok: false,
        status: 502,
        error: failMsg,
        debug: { taskId, state: lastState, failMsg },
        polls: pollCount,
        lastState,
        transient: isTransientFailMessage(failMsg),
      };
    }

    if (pollDelayMs > initialDelayMs) {
      pollDelayMs = Math.max(initialDelayMs, Math.floor(pollDelayMs * 0.9));
    }
  }

  return {
    ok: false,
    status: 504,
    error: `${label} generation timed out (last state: ${lastState})`,
    polls: pollCount,
    lastState,
    // A stuck task can free up on a fresh submission, but only retry if we still
    // have wall-clock budget — runKieTask enforces that.
    transient: true,
  };
}

type RunKieResult =
  | { ok: true; url: string }
  | { ok: false; status: number; error: string; debug?: unknown };

/**
 * Resilient KIE task runner: creates a task and polls for the result, and on a
 * TRANSIENT failure (e.g. "Internal Error, Please try again later.", overloads,
 * malformed payloads, or a stuck task that timed out) it recreates the task and
 * retries the whole cycle with backoff — bounded by a wall-clock budget so total
 * time stays safely under the route's maxDuration.
 *
 * This is the single point that turns intermittent upstream 502s into successes.
 */
async function runKieTask({
  payload,
  signal,
  label,
  pollMaxMs,
  // Retry the whole create+poll cycle up to 5x: a transient upstream outage
  // (e.g. gpt-image-2 "Internal Error") can outlast 2-3 attempts. The
  // totalBudgetMs guard below caps total wall-clock regardless of this count.
  maxAttempts = 5,
  totalBudgetMs = 720_000, // keep under maxDuration (800s) with margin
  logEvery = 0,
}: {
  payload: any;
  signal: AbortSignal | undefined;
  label: string;
  pollMaxMs: number;
  maxAttempts?: number;
  totalBudgetMs?: number;
  logEvery?: number;
}): Promise<RunKieResult> {
  const startedAt = Date.now();
  let last: { status: number; error: string; debug?: unknown } = {
    status: 502,
    error: `${label} failed`,
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) return { ok: false, status: 499, error: "Request cancelled" };

    const elapsed = Date.now() - startedAt;
    const remaining = totalBudgetMs - elapsed;
    // Need enough headroom to create + poll meaningfully; otherwise stop retrying.
    if (attempt > 1 && remaining < 20_000) {
      console.warn(`[${label}] out of retry budget after attempt ${attempt - 1} (remaining=${remaining}ms)`);
      break;
    }

    // 1) create task (kieCreateTaskWithRetry already retries transient create errors internally)
    const create = await kieCreateTaskWithRetry(payload, signal, label);
    if (!create.taskId) {
      const msg = create.createJson?.message || create.createJson?.msg || `${label} createTask failed`;
      last = { status: create.transient ? 503 : 502, error: msg, debug: create.createJson || null };
      const retryable = create.transient || isTransientFailMessage(msg);
      if (retryable && attempt < maxAttempts) {
        const delay = Math.min(8_000, 1_000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 400);
        console.warn(`[${label}] create failed (attempt ${attempt}/${maxAttempts}); retrying whole task in ${delay}ms — ${msg}`);
        await sleep(delay, signal);
        continue;
      }
      return { ok: false, ...last };
    }

    // 2) poll, capping this attempt's poll window to the remaining wall-clock budget
    const thisPollMs = Math.max(15_000, Math.min(pollMaxMs, totalBudgetMs - (Date.now() - startedAt) - 5_000));
    const poll = await kiePollForResultUrl({
      taskId: create.taskId,
      signal,
      label,
      maxMs: thisPollMs,
      logEvery,
    });

    if (poll.ok) return { ok: true, url: poll.url };

    last = { status: poll.status, error: poll.error, debug: poll.debug ?? null };
    if (poll.transient && attempt < maxAttempts) {
      // Longer backoff (cap 15s) gives a wobbling upstream more time to recover
      // between full task recreations than the default create-retry backoff.
      const delay = Math.min(15_000, 2_000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 400);
      console.warn(
        `[${label}] task ${create.taskId} failed transiently (attempt ${attempt}/${maxAttempts}); recreating in ${delay}ms — ${poll.error}`
      );
      await sleep(delay, signal);
      continue;
    }
    return { ok: false, ...last };
  }

  return { ok: false, ...last };
}

async function fetchImageAsBase64(url: string): Promise<{ mime: string; base64: string }> {
  const parsed = parseDataUrl(url);
  if (parsed) return parsed;
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      // helps some CDNs
      "User-Agent": "Outlight/1.0 (+image-fetch)",
      // Prefer formats we can reliably pass through downstream (and that most providers accept).
      Accept: "image/webp,image/png,image/jpeg,image/*,*/*;q=0.8",
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

    const normalizeGpt2 = (): Gpt2Options => {
      const aspectRatioSet = new Set<string>(GPT2_ASPECT_RATIOS);
      const resolutionSet = new Set<string>(GPT2_RESOLUTIONS);
      const qualitySet = new Set<string>(GPT2_QUALITY_OPTIONS);
      const backgroundSet = new Set<string>(GPT2_BACKGROUND_OPTIONS);
      const formatSet = new Set<string>(GPT2_OUTPUT_FORMATS);
      const moderationSet = new Set<string>(GPT2_MODERATION_OPTIONS);
      const inferred = inferGpt2ControlsFromLegacySize(options?.gpt2_size);
      const aspect_ratio = aspectRatioSet.has(options?.aspect_ratio || "")
        ? (options!.aspect_ratio as Gpt2Options["aspect_ratio"])
        : inferred.aspect_ratio || "auto";
      let resolution = resolutionSet.has(options?.image_size || "")
        ? (options!.image_size as Gpt2Options["resolution"])
        : inferred.resolution || "1K";

      if (aspect_ratio === "auto") resolution = "1K";
      if (aspect_ratio === "1:1" && resolution === "4K") resolution = "2K";

      const quality = qualitySet.has(options?.quality || "")
        ? (options!.quality as Gpt2Options["quality"])
        : "auto";
      const background = backgroundSet.has(options?.gpt_background || "")
        ? (options!.gpt_background as Gpt2Options["background"])
        : "auto";
      const output_format = formatSet.has(options?.output_format || "")
        ? (options!.output_format as Gpt2Options["output_format"])
        : "png";
      const moderation = moderationSet.has(options?.moderation || "")
        ? (options!.moderation as Gpt2Options["moderation"])
        : "auto";
      const output_compression =
        output_format === "jpeg" || output_format === "webp"
          ? clampPercentage(options?.output_compression)
          : undefined;

      return { aspect_ratio, resolution, quality, background, output_format, output_compression, moderation };
    };

    /* -------- GPT Image 2 via KIE -------- */
    if (modelId === "gpt-2") {
      const gpt2Opts = normalizeGpt2();

      if (!KIE_KEY) {
        return NextResponse.json({ error: "KIE API key missing for GPT Image 2" }, { status: 500 });
      }

      const hasReferences = referenceUrls.length > 0;
      const modeLabel = hasReferences ? "GPT Image 2 Image-to-Image" : "GPT Image 2 Text-to-Image";

      if (hasReferences) {
        const badUrl = referenceUrls.find((u) => !/^https?:\/\//i.test(u));
        if (badUrl) {
          return NextResponse.json(
            { error: "GPT Image 2 Image-to-Image via KIE requires public HTTP/HTTPS URLs for reference images" },
            { status: 400 }
          );
        }
      }

      const payload = hasReferences
        ? {
            model: "gpt-image-2-image-to-image",
            callBackUrl: "",
            input: {
              prompt,
              input_urls: referenceUrls.slice(0, 16),
              aspect_ratio: gpt2Opts.aspect_ratio,
              resolution: gpt2Opts.resolution,
              quality: gpt2Opts.quality,
              background: gpt2Opts.background,
              output_format: gpt2Opts.output_format,
              ...(gpt2Opts.output_compression !== undefined
                ? { output_compression: gpt2Opts.output_compression }
                : {}),
              moderation: gpt2Opts.moderation,
            },
          }
        : {
            model: "gpt-image-2-text-to-image",
            callBackUrl: "",
            input: {
              prompt,
              aspect_ratio: gpt2Opts.aspect_ratio,
              resolution: gpt2Opts.resolution,
              quality: gpt2Opts.quality,
              background: gpt2Opts.background,
              output_format: gpt2Opts.output_format,
              ...(gpt2Opts.output_compression !== undefined
                ? { output_compression: gpt2Opts.output_compression }
                : {}),
              moderation: gpt2Opts.moderation,
            },
          };

      const result = await runKieTask({
        payload,
        signal: req.signal,
        label: modeLabel,
        pollMaxMs: 300_000,
      });

      if (!result.ok) {
        return NextResponse.json(
          { error: result.error, debug: result.debug ?? null },
          { status: result.status }
        );
      }

      await logUsage(profileId, modelId);
      return NextResponse.json({ imageDataUrl: result.url });
    }

    /* -------- GPT Image 1.5 via KIE (auto-switch: text-to-image or image-to-image) -------- */
    if (modelId === "gpt-1.5") {
      if (!KIE_KEY) return NextResponse.json({ error: "KIE API key missing" }, { status: 500 });

      const gpt15Opts = normalizeGpt15();
      const hasReferences = referenceUrls.length > 0;
      const modeLabel = hasReferences ? "GPT 1.5 Image-to-Image" : "GPT 1.5 Text-to-Image";

      const aspectRatioSet = new Set(["1:1", "2:3", "3:2"]);
      const aspect_ratio = aspectRatioSet.has(options?.aspect_ratio || "")
        ? options!.aspect_ratio!
        : gpt15Opts.size === "1024x1024"
          ? "1:1"
          : gpt15Opts.size === "1024x1536"
            ? "2:3"
            : gpt15Opts.size === "1536x1024"
              ? "3:2"
              : "1:1";

      const quality = gpt15Opts.quality === "high" ? "high" : "medium";

      if (hasReferences) {
        const badUrl = referenceUrls.find((u) => !/^https?:\/\//i.test(u));
        if (badUrl) {
          return NextResponse.json(
            { error: "GPT 1.5 Image-to-Image requires public HTTP/HTTPS URLs for reference images" },
            { status: 400 }
          );
        }
      }

      const payload = hasReferences
        ? {
            model: "gpt-image/1.5-image-to-image",
            callBackUrl: "",
            input: {
              input_urls: referenceUrls.slice(0, 8),
              prompt,
              aspect_ratio,
              quality,
            },
          }
        : {
            model: "gpt-image/1.5-text-to-image",
            callBackUrl: "",
            input: {
              prompt,
              aspect_ratio,
              quality,
            },
          };

      const result = await runKieTask({
        payload,
        signal: req.signal,
        label: modeLabel,
        pollMaxMs: 300_000,
      });

      if (!result.ok) {
        return NextResponse.json(
          { error: result.error, debug: result.debug ?? null },
          { status: result.status }
        );
      }

      await logUsage(profileId, modelId);
      return NextResponse.json({ imageDataUrl: result.url });
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

      const result = await runKieTask({
        payload,
        signal: req.signal,
        label: modeLabel,
        pollMaxMs: 300_000,
      });

      if (!result.ok) {
        return NextResponse.json(
          { error: result.error, debug: result.debug ?? null },
          { status: result.status }
        );
      }
      await logUsage(profileId, modelId);
      return NextResponse.json({ imageDataUrl: result.url });
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

      const result = await runKieTask({
        payload,
        signal: req.signal,
        label: "Seedream",
        pollMaxMs: 300_000,
      });

      if (!result.ok) {
        return NextResponse.json(
          { error: result.error, debug: result.debug ?? null },
          { status: result.status }
        );
      }
      await logUsage(profileId, modelId);
      return NextResponse.json({ imageDataUrl: result.url });
    }

    /* -------- Nano Banana 2 via KIE -------- */
    if (modelId === "nanobanana-2") {
      if (!KIE_KEY) return NextResponse.json({ error: "KIE API key missing" }, { status: 500 });

      // Validate aspect ratio
      const nb2ArSet = new Set<string>(NB2_ASPECT_RATIOS);
      const aspect_ratio = nb2ArSet.has(options?.aspect_ratio || "")
        ? options!.aspect_ratio! : "auto";

      // Validate resolution
      const nb2ResSet = new Set<string>(NB2_RESOLUTIONS);
      const resolution = nb2ResSet.has(options?.image_size || "")
        ? options!.image_size! : "1K";

      // Validate output format
      const nb2FmtSet = new Set<string>(NB2_OUTPUT_FORMATS);
      const output_format = nb2FmtSet.has(options?.nb_output_format || "")
        ? options!.nb_output_format! : "jpg";

      // Google search toggle
      const google_search = options?.google_search === true;

      // Build input
      const inputPayload: Record<string, any> = {
        prompt,
        aspect_ratio,
        resolution,
        output_format,
        google_search,
      };

      // Reference images (up to 14, must be HTTP URLs)
      const httpRefs = referenceUrls.filter(u => /^https?:\/\//i.test(u));
      if (httpRefs.length > 0) {
        inputPayload.image_input = httpRefs.slice(0, 14);
      }

      // Reject data: URIs
      if (referenceUrls.length > httpRefs.length) {
        return NextResponse.json(
          { error: "Nano Banana 2 requires public HTTP/HTTPS URLs for reference images" },
          { status: 400 }
        );
      }

      const payload = {
        model: "nano-banana-2",
        callBackUrl: "",
        input: inputPayload,
      };

      const modeLabel = httpRefs.length > 0 ? "Nano Banana 2 Image-to-Image" : "Nano Banana 2";

      const result = await runKieTask({
        payload,
        signal: req.signal,
        label: modeLabel,
        pollMaxMs: 600_000,
        logEvery: 10,
      });

      if (!result.ok) {
        return NextResponse.json({ error: result.error, debug: result.debug ?? null }, { status: result.status });
      }

      await logUsage(profileId, modelId);
      return NextResponse.json({ imageDataUrl: result.url });
    }

    /* -------- Nano Banana 2 Lite via KIE -------- */
    if (modelId === "nanobanana-2-lite") {
      if (!KIE_KEY) return NextResponse.json({ error: "KIE API key missing" }, { status: 500 });

      // Validate aspect ratio (same set as Nano Banana 2)
      const liteArSet = new Set<string>(NB2_ASPECT_RATIOS);
      const aspect_ratio = liteArSet.has(options?.aspect_ratio || "")
        ? options!.aspect_ratio! : "auto";

      const inputPayload: Record<string, any> = {
        prompt,
        aspect_ratio,
      };

      // Reference images (up to 10, must be HTTP URLs)
      const httpRefs = referenceUrls.filter((u) => /^https?:\/\//i.test(u));
      if (httpRefs.length > 0) {
        inputPayload.image_urls = httpRefs.slice(0, 10);
      }

      // Reject data: URIs
      if (referenceUrls.length > httpRefs.length) {
        return NextResponse.json(
          { error: "Nano Banana 2 Lite requires public HTTP/HTTPS URLs for reference images" },
          { status: 400 }
        );
      }

      const payload = {
        model: "nano-banana-2-lite",
        callBackUrl: "",
        input: inputPayload,
      };

      const modeLabel = httpRefs.length > 0 ? "Nano Banana 2 Lite Image-to-Image" : "Nano Banana 2 Lite";

      const result = await runKieTask({
        payload,
        signal: req.signal,
        label: modeLabel,
        pollMaxMs: 600_000,
        logEvery: 10,
      });

      if (!result.ok) {
        return NextResponse.json({ error: result.error, debug: result.debug ?? null }, { status: result.status });
      }

      await logUsage(profileId, modelId);
      return NextResponse.json({ imageDataUrl: result.url });
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

      const result = await runKieTask({
        payload,
        signal: req.signal,
        label: "Nano Banana",
        pollMaxMs: 600_000,
        logEvery: 10,
      });

      if (!result.ok) {
        return NextResponse.json(
          { error: result.error, debug: result.debug ?? null },
          { status: result.status }
        );
      }
      await logUsage(profileId, modelId);
      return NextResponse.json({ imageDataUrl: result.url });
    }

    return NextResponse.json({ error: "Unsupported model" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Unexpected error" }, { status: 500 });
  }
}
