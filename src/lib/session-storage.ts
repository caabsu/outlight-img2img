// src/lib/session-storage.ts
// Utilities for persisting session state across page refreshes

const STORAGE_KEYS = {
  IMAGE_STUDIO: "ol_image_studio_session",
  VIDEO_STUDIO: "ol_video_studio_session",
  AD_STUDIO: "ol_ad_studio_session",
} as const;

// Debounce helper to avoid excessive writes
function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let timeout: NodeJS.Timeout | null = null;
  return ((...args: any[]) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), ms);
  }) as T;
}

// Generic save/load functions
export function saveToStorage<T>(key: string, data: T): void {
  if (typeof window === "undefined") return;
  const json = JSON.stringify(data);
  try {
    localStorage.setItem(key, json);
  } catch (err: any) {
    // Handle quota exceeded error by clearing old data and retrying
    if (err?.name === "QuotaExceededError" || err?.code === 22) {
      console.warn("localStorage quota exceeded, clearing old session data...");
      try {
        // Clear the specific key and retry
        localStorage.removeItem(key);
        localStorage.setItem(key, json);
      } catch {
        // If still failing, clear all our session keys
        console.warn("Still failing, clearing all session storage...");
        localStorage.removeItem(STORAGE_KEYS.IMAGE_STUDIO);
        localStorage.removeItem(STORAGE_KEYS.VIDEO_STUDIO);
        localStorage.removeItem(STORAGE_KEYS.AD_STUDIO);
        try {
          localStorage.setItem(key, json);
        } catch {
          console.error("Failed to save even after clearing storage");
        }
      }
    } else {
      console.warn("Failed to save to localStorage:", err);
    }
  }
}

export function loadFromStorage<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const json = localStorage.getItem(key);
    if (!json) return null;
    return JSON.parse(json) as T;
  } catch (err) {
    console.warn("Failed to load from localStorage:", err);
    return null;
  }
}

// Create a debounced save function
export function createDebouncedSave<T>(key: string, delayMs = 500) {
  return debounce((data: T) => saveToStorage(key, data), delayMs);
}

// ============ IMAGE STUDIO ============

export type SerializedRun = {
  id: string;
  name: string;
  startedAt: number;
  modelId: string;
  modelNameDisplay: string;
  profileId: string;
  profileName: string;
  prompts: string[];
  status: "idle" | "done" | "cancelled" | "error"; // Running runs become "cancelled" on reload
  error: string | null;
  images: Array<{ id: string; prompt: string; imageDataUrl: string }>;
  activeIdx: number;
  selectedIdx: number[]; // Set<number> serialized as array
  progress: { done: number; total: number };
  speed: number;
};

export type ImageStudioSession = {
  version: 1;
  savedAt: number;
  promptsText: string;
  modelId: string;
  // Model options
  nbAspectRatio: string;
  nbResolution: string;
  sd45AspectRatio: string;
  sd45Quality: string;
  sdSize: string;
  sdRes: string;
  sdMax: number;
  sdSeed: number | "";
  // GPT 1.5 options
  gpt15Size: string;
  gpt15Quality: string;
  gpt15Background: string;
  // Layout
  promptColumnWidth: number;
  speed: number;
  // References (URLs only, not large data URIs to avoid quota issues)
  customUrls: string[];
  // Runs
  runs: SerializedRun[];
  activeRunId: string | null;
};

export function serializeImageRun(run: any): SerializedRun {
  // Filter images to only keep HTTP URLs (not large data URIs) to avoid localStorage quota issues
  const filteredImages = (run.images || [])
    .filter((img: any) => img.imageDataUrl && img.imageDataUrl.startsWith("http"))
    .slice(-20); // Keep only last 20 images per run to limit storage

  return {
    id: run.id,
    name: run.name,
    startedAt: run.startedAt,
    modelId: run.modelId,
    modelNameDisplay: run.modelNameDisplay,
    profileId: run.profileId,
    profileName: run.profileName,
    prompts: run.prompts,
    // Convert running to cancelled since we can't resume
    status: run.status === "running" ? "cancelled" : run.status,
    error: run.error,
    images: filteredImages,
    activeIdx: filteredImages.length > 0 ? Math.min(run.activeIdx, filteredImages.length - 1) : 0,
    selectedIdx: (Array.from(run.selectedIdx || []) as number[]).filter((idx) => idx < filteredImages.length),
    progress: run.progress,
    speed: run.speed,
  };
}

export function deserializeImageRun(data: SerializedRun): any {
  return {
    ...data,
    selectedIdx: new Set(data.selectedIdx || []),
    controller: null, // Can't restore AbortController
    debug: null,
  };
}

export function saveImageStudioSession(session: ImageStudioSession): void {
  saveToStorage(STORAGE_KEYS.IMAGE_STUDIO, session);
}

export function loadImageStudioSession(): ImageStudioSession | null {
  return loadFromStorage<ImageStudioSession>(STORAGE_KEYS.IMAGE_STUDIO);
}

export const debouncedSaveImageSession = createDebouncedSave<ImageStudioSession>(
  STORAGE_KEYS.IMAGE_STUDIO,
  1000
);

// ============ VIDEO STUDIO ============

export type SerializedVideoRun = {
  id: string;
  name: string;
  productName?: string;
  startedAt: number;
  modelId: string;
  modelLabel: string;
  isBatch: boolean;
  prompts: string[];
  status: "idle" | "done" | "cancelled" | "error";
  error: string | null;
  videos: Array<{ id: string; prompt: string; url: string }>;
  activeIdx: number;
  selectedIdx: number[];
  progress: { done: number; total: number };
  speed: number;
};

export type VideoStudioSession = {
  version: 1;
  savedAt: number;
  promptsText: string;
  videoModel: string;
  // Model options - Kling 2.6
  kling26Duration?: string;
  kling26Aspect?: string;
  kling26Sound?: boolean;
  // Model options - Veo
  veoAspect: string;
  // Model options - Sora
  soraFrames: string;
  soraAspect: string;
  // General
  videoParallel: number;
  // References
  customUrl: string;
  batchVideoImages: string[];
  // Runs
  videoRuns: SerializedVideoRun[];
  activeVideoRunId: string | null;
};

export function serializeVideoRun(run: any): SerializedVideoRun {
  return {
    id: run.id,
    name: run.name,
    productName: run.productName,
    startedAt: run.startedAt,
    modelId: run.modelId,
    modelLabel: run.modelLabel,
    isBatch: run.isBatch ?? false,
    prompts: run.prompts,
    status: run.status === "running" ? "cancelled" : run.status,
    error: run.error,
    videos: run.videos || [],
    activeIdx: run.activeIdx,
    selectedIdx: Array.from(run.selectedIdx || []),
    progress: run.progress,
    speed: run.speed,
  };
}

export function deserializeVideoRun(data: SerializedVideoRun): any {
  return {
    id: data.id,
    name: data.name,
    productName: data.productName,
    startedAt: data.startedAt,
    modelId: data.modelId,
    modelLabel: data.modelLabel,
    isBatch: data.isBatch ?? false,
    prompts: data.prompts,
    status: data.status,
    error: data.error,
    videos: data.videos || [],
    activeIdx: data.activeIdx,
    selectedIdx: new Set(data.selectedIdx || []),
    progress: data.progress,
    speed: data.speed,
    controller: null, // Can't restore AbortController
  };
}

export function saveVideoStudioSession(session: VideoStudioSession): void {
  saveToStorage(STORAGE_KEYS.VIDEO_STUDIO, session);
}

export function loadVideoStudioSession(): VideoStudioSession | null {
  return loadFromStorage<VideoStudioSession>(STORAGE_KEYS.VIDEO_STUDIO);
}

export const debouncedSaveVideoSession = createDebouncedSave<VideoStudioSession>(
  STORAGE_KEYS.VIDEO_STUDIO,
  1000
);

// ============ AD STUDIO ============

export type AdStudioSession = {
  version: 1;
  savedAt: number;
  theme: string;
  modelId: string;
  quantity: number;
  speed: number;
  aspectRatios: Record<string, boolean>;
  includeBothRatios: boolean;
  selectedProductId: string | null;
  modelOptions: Record<string, string>;
  lastCampaign: {
    concepts: Array<{ name: string; description: string; headline?: string; tagline?: string; prompts: Record<string, string> }>;
    images: Array<{ conceptIndex: number; ratio: string; url: string; prompt: string }>;
    logEntries: Array<{ type: string; message: string; timestamp: number; phase?: string }>;
    status: "done" | "error" | "cancelled";
  } | null;
};

export function saveAdStudioSession(session: AdStudioSession): void {
  saveToStorage(STORAGE_KEYS.AD_STUDIO, session);
}

export function loadAdStudioSession(): AdStudioSession | null {
  return loadFromStorage<AdStudioSession>(STORAGE_KEYS.AD_STUDIO);
}

export const debouncedSaveAdSession = createDebouncedSave<AdStudioSession>(
  STORAGE_KEYS.AD_STUDIO,
  1000
);
