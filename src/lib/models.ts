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
  formatOptions?: readonly string[];
  moderationOptions?: readonly string[];
  booleanOptions?: readonly {
    key: string;
    label: string;
    falseLabel?: string;
    trueLabel?: string;
  }[];
  // whether the model REQUIRES a reference image
  requiresReference?: boolean;
  // UI capability flags (only Seedream needs these now)
  supportsSize?: boolean;
  supportsResolution?: boolean;
  supportsMaxImages?: boolean;
  supportsSeed?: boolean;
  // Max concurrent requests (for APIs with rate limits like KIE)
  maxConcurrency?: number;
  // Per-image cost as listed on KIE.ai (display string)
  pricing?: string;
};

export const NB2_ASPECT_RATIOS = [
  "auto", "1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1",
  "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9",
] as const;

export const NB2_RESOLUTIONS = ["1K", "2K", "4K"] as const;

export const NB2_OUTPUT_FORMATS = ["jpg", "png"] as const;

export const GPT2_ASPECT_RATIOS = [
  "auto",
  "1:1",
  "5:4",
  "9:16",
  "21:9",
  "16:9",
  "4:3",
  "3:2",
  "4:5",
  "3:4",
  "2:3",
] as const;

export const GPT2_RESOLUTIONS = ["1K", "2K", "4K"] as const;

export const GPT2_QUALITY_OPTIONS = ["auto", "low", "medium", "high"] as const;

export const GPT2_BACKGROUND_OPTIONS = ["auto", "opaque"] as const;

export const GPT2_OUTPUT_FORMATS = ["png", "jpeg", "webp"] as const;

export const GPT2_MODERATION_OPTIONS = ["auto", "low"] as const;

export const MODEL_LIST: ModelDef[] = [
  {
    id: "nanobanana-2-lite",
    label: "Nano Banana 2 Lite",
    version: "v2-lite",
    provider: "kie",
    providerName: "nano-banana-2-lite",
    requiresReference: false,
    aspectRatioOptions: NB2_ASPECT_RATIOS,
    maxConcurrency: 5,
    pricing: "$0.02 / image",
  },
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
    pricing: "$0.04–$0.09 / image (1K–4K)",
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
    pricing: "$0.0325 / image",
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
    pricing: "$0.02 med · $0.11 high",
  },
  {
    id: "gpt-2",
    label: "GPT Image 2",
    version: "v2",
    provider: "kie",
    providerName: "gpt-image-2",
    aspectRatioOptions: GPT2_ASPECT_RATIOS,
    resolutionOptions: GPT2_RESOLUTIONS,
    qualityOptions: GPT2_QUALITY_OPTIONS,
    backgroundOptions: GPT2_BACKGROUND_OPTIONS,
    formatOptions: GPT2_OUTPUT_FORMATS,
    moderationOptions: GPT2_MODERATION_OPTIONS,
    requiresReference: false,
    maxConcurrency: 5,
    pricing: "$0.03–$0.08 / image (1K–4K)",
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
