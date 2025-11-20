// src/lib/models.ts

export type Provider = "nanobanana" | "seedream";

export type ModelDef = {
  id: string;            // internal id used by UI
  label: string;         // shown in the dropdown
  version: string;       // for display
  provider: Provider;
  // provider-specific name (e.g., KIE model string or internal alias)
  providerName: string;
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
    label: "Nano Banana",
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

export function getModelById(id: string): ModelDef | undefined {
  return MODEL_LIST.find((m) => m.id === id);
}
