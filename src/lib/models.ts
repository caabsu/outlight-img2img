// src/lib/models.ts

export type Provider = "nanobanana" | "seedream" | "kie" | "openai";

export type ModelDef = {
  id: string;            // internal id used by UI
  label: string;         // shown in the dropdown
  version: string;       // for display
  provider: Provider;
  // provider-specific name (e.g., KIE model string or internal alias)
  providerName: string;
  // Optional UI helpers
  aspectRatioOptions?: readonly string[];
  resolutionOptions?: readonly string[];
  qualityOptions?: readonly string[];  // e.g., ["basic", "high"] for Seedream 4.5
  sizeOptions?: readonly string[];     // e.g., ["1024x1024", "1536x1024"] for GPT 1.5
  backgroundOptions?: readonly string[]; // e.g., ["opaque", "transparent"] for GPT 1.5
  // whether the model REQUIRES a reference image
  requiresReference?: boolean;
  // UI capability flags (only Seedream needs these now)
  supportsSize?: boolean;
  supportsResolution?: boolean;
  supportsMaxImages?: boolean;
  supportsSeed?: boolean;
  // Max concurrent requests (for APIs with rate limits like KIE)
  maxConcurrency?: number;
};

export const NB2_ASPECT_RATIOS = [
  "auto", "1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1",
  "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9",
] as const;

export const NB2_RESOLUTIONS = ["1K", "2K", "4K"] as const;

export const NB2_OUTPUT_FORMATS = ["jpg", "png"] as const;

export const MODEL_LIST: ModelDef[] = [
  {
    id: "nanobanana-2",
    label: "Nano Banana 2",
    version: "v2",
    provider: "kie",
    providerName: "nano-banana-2",
    requiresReference: false,
    aspectRatioOptions: NB2_ASPECT_RATIOS,
    resolutionOptions: NB2_RESOLUTIONS,
    maxConcurrency: 5,
  },
  {
    id: "nanobanana-3-pro",
    label: "Nano Banana Pro",
    version: "v3-pro",
    provider: "nanobanana",
    providerName: "gemini-3-pro-image-preview",
    requiresReference: false,
    aspectRatioOptions: [
      "1:1",
      "2:3",
      "3:2",
      "3:4",
      "4:3",
      "4:5",
      "5:4",
      "9:16",
      "16:9",
      "21:9",
    ],
    resolutionOptions: ["1K", "2K", "4K"],
    // KIE API supports concurrent tasks - each request creates its own async task
    // Allow up to 5 concurrent requests to significantly speed up batch generation
    maxConcurrency: 5,
  },
  {
    id: "seedream-4.5",
    label: "Seedream 4.5",
    version: "v4.5",
    provider: "seedream",
    providerName: "seedream/4.5-text-to-image",
    requiresReference: false,
    aspectRatioOptions: [
      "1:1",
      "4:3",
      "3:4",
      "16:9",
      "9:16",
      "2:3",
      "3:2",
      "21:9",
    ],
    qualityOptions: ["basic", "high"],
    maxConcurrency: 5,  // Allow concurrent requests for faster batch generation
  },
  {
    id: "gpt-1.5",
    label: "GPT 1.5",
    version: "v1.5",
    provider: "kie",
    providerName: "gpt-image/1.5-text-to-image",
    requiresReference: false,
    sizeOptions: [
      "auto",
      "1024x1024",
      "1536x1024",
      "1024x1536",
    ],
    qualityOptions: ["auto", "low", "medium", "high"],
    backgroundOptions: ["auto", "opaque", "transparent"],
    maxConcurrency: 5,
  },
];

export const IMAGE_SIZES = [
  "square",
  "square_hd",
  "portrait_4_3",
  "portrait_3_2",
  "portrait_16_9",
  "landscape_4_3",
  "landscape_3_2",
  "landscape_16_9",
  "landscape_21_9",
] as const;

export const IMAGE_RESOLUTIONS = ["1K", "2K", "4K"] as const;

export const NANOBANANA_ASPECT_RATIOS = [
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9",
] as const;

export const NANOBANANA_RESOLUTIONS = ["1K", "2K", "4K"] as const;

export const SEEDREAM_QUALITY_OPTIONS = ["basic", "high"] as const;

export const GPT15_SIZE_OPTIONS = ["auto", "1024x1024", "1536x1024", "1024x1536"] as const;
export const GPT15_QUALITY_OPTIONS = ["auto", "low", "medium", "high"] as const;
export const GPT15_BACKGROUND_OPTIONS = ["auto", "opaque", "transparent"] as const;

export function getModelById(id: string): ModelDef | undefined {
  return MODEL_LIST.find((m) => m.id === id);
}
