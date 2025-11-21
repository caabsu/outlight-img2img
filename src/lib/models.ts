// src/lib/models.ts

export type Provider = "nanobanana" | "seedream";

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
  // whether the model REQUIRES a reference image
  requiresReference?: boolean;
  // UI capability flags (only Seedream needs these now)
  supportsSize?: boolean;
  supportsResolution?: boolean;
  supportsMaxImages?: boolean;
  supportsSeed?: boolean;
};

export const MODEL_LIST: ModelDef[] = [
  {
    id: "nanobanana-2",
    label: "Nano Banana (Legacy)",
    version: "v2.5",
    provider: "nanobanana",
    providerName: "gemini-2.5-flash-image",
    requiresReference: false,
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
  },
  {
    id: "seedream-v4-edit",
    label: "Seedream",
    version: "v4-edit",
    provider: "seedream",
    providerName: "bytedance/seedream-v4-edit",
    requiresReference: true,
    supportsSize: true,
    supportsResolution: true,
    supportsMaxImages: true,
    supportsSeed: true,
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

export function getModelById(id: string): ModelDef | undefined {
  return MODEL_LIST.find((m) => m.id === id);
}
